import { createServer } from 'node:http';
import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';
import { mkdir, readFile, rename, stat, writeFile } from 'node:fs/promises';
import { createReadStream } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';
import { createMutex } from './mutex.js';
import { buildSeededAdmins, buildSeededDemoUser, getAdminPasswordHash, getDemoPasswordHash, getMobileDemoPasswordHash } from './seed-config.js';
import { generateLocalAnswer } from './chatbot-fallback.js';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const dataDir = process.env.FRESCOOP_DATA_DIR || path.join(__dirname, 'data');
const dbPath = path.join(dataDir, 'store.json');
const distDir = path.join(rootDir, 'dist');
const envPath = path.join(rootDir, '.env');

await loadEnvFile(envPath);

const storeMutex = createMutex();

// ============================================================================
// AUTH TOKEN SYSTEM
// ============================================================================
const TOKEN_SECRET = process.env.TOKEN_SECRET || randomBytes(32).toString('hex');
const TOKEN_EXPIRY_MS = 7 * 24 * 60 * 60 * 1000; // 7 days

function createToken(userId, role) {
  const payload = JSON.stringify({ uid: userId, role, exp: Date.now() + TOKEN_EXPIRY_MS });
  const sig = createHash('sha256').update(payload + TOKEN_SECRET).digest('hex');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}

function verifyToken(token) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch { return null; }
  const expected = createHash('sha256').update(payload + TOKEN_SECRET).digest('hex');
  if (sig.length !== expected.length) return null;
  try {
    if (!timingSafeEqual(Buffer.from(sig, 'hex'), Buffer.from(expected, 'hex'))) return null;
  } catch { return null; }
  try {
    const data = JSON.parse(payload);
    if (!data.uid || !data.exp || Date.now() > data.exp) return null;
    return data;
  } catch { return null; }
}

function getTokenFromRequest(request) {
  const auth = request.headers.authorization || '';
  if (auth.startsWith('Bearer ')) return auth.slice(7);
  return null;
}

function requireAuth(request) {
  const token = getTokenFromRequest(request);
  const data = verifyToken(token);
  return data; // null if invalid
}

// ============================================================================
// PASSWORD RESET TOKENS (in-memory, expire after 15 minutes)
// ============================================================================
const resetTokens = new Map();
const RESET_TOKEN_EXPIRY_MS = 15 * 60 * 1000;

function generateResetCode() {
  return randomBytes(3).toString('hex').toUpperCase();
}

setInterval(() => {
  const now = Date.now();
  for (const [key, data] of resetTokens) {
    if (now > data.expiresAt) resetTokens.delete(key);
  }
}, 60_000);

// ============================================================================
// RATE LIMITER
// ============================================================================
const rateBuckets = new Map();
const RATE_WINDOW_MS = 60_000;
const RATE_MAX_REQUESTS = 120;
const AUTH_RATE_MAX = 10;

function checkRateLimit(ip, isAuthEndpoint = false) {
  const now = Date.now();
  const key = isAuthEndpoint ? `auth:${ip}` : ip;
  const max = isAuthEndpoint ? AUTH_RATE_MAX : RATE_MAX_REQUESTS;
  let bucket = rateBuckets.get(key);
  if (!bucket || now - bucket.start > RATE_WINDOW_MS) {
    bucket = { start: now, count: 0 };
    rateBuckets.set(key, bucket);
  }
  bucket.count++;
  if (bucket.count > max) return false;
  return true;
}

// Cleanup stale buckets every 5 minutes
setInterval(() => {
  const now = Date.now();
  for (const [key, bucket] of rateBuckets) {
    if (now - bucket.start > RATE_WINDOW_MS * 2) rateBuckets.delete(key);
  }
}, 300_000);

// ============================================================================
// MONGODB
// ============================================================================
const mongoUri = String(process.env.MONGODB_URI || '').trim();
// FRESCOOP_REQUIRE_MONGODB ignoré — le serveur démarre toujours (fallback fichier local)
const configuredSeedMode = readSeedMode(process.env.FRESCOOP_SEED_MODE);
const productionLike = process.env.NODE_ENV === 'production' || Boolean(mongoUri);
const useDemoSeedData = configuredSeedMode
  ? configuredSeedMode === 'demo'
  : !productionLike;
let mongoDb = null;
if (mongoUri) {
  const attempts = [
    { tlsAllowInvalidCertificates: true },
    { tls: true, tlsAllowInvalidCertificates: true },
    {},
  ];
  for (const opts of attempts) {
    try {
      const client = new MongoClient(mongoUri, {
        ...opts,
        serverSelectionTimeoutMS: 15000,
        connectTimeoutMS: 15000,
      });
      await client.connect();
      mongoDb = client.db(process.env.MONGODB_DB || 'frescoop');
      console.log('[MongoDB] Connecté à Atlas — données persistantes');
      break;
    } catch (err) {
      console.warn('[MongoDB] Tentative échouée:', err.message);
    }
  }
  if (!mongoDb) {
    console.error('[MongoDB] Impossible de se connecter après 3 tentatives. Fallback fichier local.');
  }
} else {
  console.warn('[DB] MONGODB_URI non configuré — stockage fichier local.');
}

// In-memory cache for resilience when filesystem is ephemeral
let memoryStoreCache = null;

// ============================================================================
// CLOUDINARY
// ============================================================================
const cloudinaryCloudName = process.env.CLOUDINARY_CLOUD_NAME || '';
const cloudinaryApiKey = process.env.CLOUDINARY_API_KEY || '';
const cloudinaryApiSecret = process.env.CLOUDINARY_API_SECRET || '';

const port = Number(process.env.FRESCOOP_API_PORT || process.env.PORT || 4174);
const apiOnly = process.argv.includes('--api-only');
const host = process.env.FRESCOOP_HOST || process.env.HOST || '0.0.0.0';
const seededAdminPasswordHash = getAdminPasswordHash();
const seededDemoPasswordHash = getDemoPasswordHash();
const mobileDemoPasswordHash = getMobileDemoPasswordHash();
const seededAdmins = buildSeededAdmins();
const seededDemoUser = buildSeededDemoUser();

const paydunyaMode = (process.env.PAYDUNYA_MODE || 'test').toLowerCase();
const paydunyaApiBase = paydunyaMode === 'live'
  ? 'https://app.paydunya.com/api/v1'
  : 'https://app.paydunya.com/sandbox-api/v1';

const emptyStore = {
  users: [...seededAdmins, seededDemoUser],
  products: [],
  dossiers: [],
  attestations: [],
  transactions: [],
  proofs: [],
  hubs: [],
  activityProofs: [],
  orders: [],
  messages: [],
  notifications: [],
  cooperatives: [],
  crates: [],
  lots: [],
  lotPhotos: [],
  sensorDevices: [],
  sensorReadings: [],
  qualityAssessments: [],
  buyers: [],
  buyerOrders: [],
  reservations: [],
  dispatches: [],
  paymentRecords: [],
  payoutRecords: [],
  consentRecords: [],
  economicProfiles: [],
  partnerOffers: [],
  alerts: [],
  auditLogs: [],
  kpiAggregates: [],
  loans: [],
  surveyLeads: [],
};

const mimeTypes = {
  '.html': 'text/html;charset=utf-8',
  '.js': 'text/javascript;charset=utf-8',
  '.css': 'text/css;charset=utf-8',
  '.json': 'application/json;charset=utf-8',
  '.svg': 'image/svg+xml',
  '.png': 'image/png',
  '.jpg': 'image/jpeg',
  '.jpeg': 'image/jpeg',
  '.ico': 'image/x-icon',
};

await mkdir(dataDir, { recursive: true });
await ensureDatabase();

createServer(async (request, response) => {
  const origin = request.headers.origin || '*';
  const allowedOrigins = process.env.CORS_ORIGINS ? process.env.CORS_ORIGINS.split(',').map(s => s.trim()) : null;
  const corsOrigin = allowedOrigins ? (allowedOrigins.includes(origin) ? origin : allowedOrigins[0]) : origin;
  response.setHeader('Access-Control-Allow-Origin', corsOrigin);
  response.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  response.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  response.setHeader('X-Content-Type-Options', 'nosniff');
  response.setHeader('X-Frame-Options', 'DENY');

  if (request.method === 'OPTIONS') {
    response.writeHead(204);
    response.end();
    return;
  }

  // Rate limiting
  const clientIp = request.headers['x-forwarded-for']?.split(',')[0]?.trim() || request.socket.remoteAddress || '0.0.0.0';
  const isAuthRoute = request.url?.startsWith('/api/auth/');
  if (!checkRateLimit(clientIp, isAuthRoute)) {
    sendJson(response, 429, { error: 'Trop de requêtes. Réessayez dans une minute.' });
    return;
  }

  try {
    if (request.url?.startsWith('/api/health')) {
      sendJson(response, 200, { ok: true, mode: apiOnly ? 'api-only' : 'static', db: mongoDb ? 'mongodb' : 'json' });
      return;
    }

    if (request.url?.startsWith('/api/auth/')) {
      await handleAuth(request, response);
      return;
    }

    if (request.url?.startsWith('/api/upload')) {
      const authData = requireAuth(request);
      if (!authData) { sendJson(response, 401, { error: 'Non autorisé' }); return; }
      await handleUpload(request, response);
      return;
    }

    if (request.url?.startsWith('/api/activity-proofs')) {
      const authData = requireAuth(request);
      if (!authData) { sendJson(response, 401, { error: 'Non autorisé' }); return; }
      await handleActivityProofs(request, response, authData);
      return;
    }

    if (request.url?.startsWith('/api/paydunya/')) {
      await handlePaydunya(request, response);
      return;
    }

    if (request.url?.startsWith('/api/yaay/chat')) {
      await handleYaayChat(request, response);
      return;
    }

    if (request.url?.startsWith('/api/demo-data') && request.method === 'DELETE') {
      const authData = requireAuth(request);
      if (!authData || authData.role !== 'admin') {
        sendJson(response, 403, { error: 'Accès réservé aux administrateurs' });
        return;
      }
      const result = await storeMutex.withLock(async () => {
        const store = await readStore();
        const demoPatterns = ['-demo-', 'coop-', 'buyer-', 'lot-', 'hub-', 'crate-', 'sensor-', 'reading-', 'qa-', 'border-', 'dispatch-', 'payrec-', 'payout-', 'consent-', 'ecopro-', 'offer-', 'alert-demo', 'audit-demo', 'kpi-'];
        const seedPatterns = /^(prd-\d|ord-\d|txn-\d|pay-\d|dos-\d|prf-\d|att-\d|lot-\d|hub-\d|usr-demo-\d)/;
        const isDemo = (item) => {
          const id = String(item?.id || '');
          return demoPatterns.some((p) => id.includes(p)) || seedPatterns.test(id);
        };
        const cleaned = {};
        for (const key of Object.keys(store)) {
          if (Array.isArray(store[key])) {
            cleaned[key] = store[key].filter((item) => !isDemo(item));
          } else {
            cleaned[key] = store[key];
          }
        }
        await writeStore(cleaned);
        const removed = Object.keys(store).reduce((sum, k) => sum + (Array.isArray(store[k]) ? store[k].length - (cleaned[k]?.length || 0) : 0), 0);
        return { status: 200, body: { ok: true, removed, message: `${removed} entités démo supprimées.` } };
      });
      sendJson(response, result.status, result.body);
      return;
    }

    if (request.url?.startsWith('/api/store/backups') || request.url?.startsWith('/api/store/restore')) {
      const authData = requireAuth(request);
      if (!authData || authData.role !== 'admin') {
        sendJson(response, 403, { error: 'Accès réservé aux administrateurs' });
        return;
      }
      await handleStoreBackups(request, response);
      return;
    }

    if (request.url?.startsWith('/api/store')) {
      await handleStore(request, response);
      return;
    }

    if (apiOnly) {
      sendJson(response, 404, { error: 'Not found' });
      return;
    }

    await serveStatic(request, response);
  } catch (error) {
    sendJson(response, 500, { error: error.message || 'Server error' });
  }
}).listen(port, host, () => {
  const displayHost = host === '0.0.0.0' ? 'localhost' : host;
  console.log(`FresCoop API listening on http://${displayHost}:${port}`);
  console.log(`PayDunya mode: ${paydunyaMode} (${paydunyaApiBase})`);
});

// ============================================================================
// AUTH ENDPOINTS
// ============================================================================
async function handleAuth(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  const endpoint = url.pathname.replace('/api/auth/', '');

  if (endpoint === 'login' && request.method === 'POST') {
    const body = await readBody(request);
    const { email, password } = JSON.parse(body || '{}');
    if (!email || !password) {
      sendJson(response, 400, { error: 'Email et mot de passe requis' });
      return;
    }
    const loginResult = await storeMutex.withLock(async () => {
      const store = await readStore();
      const normalized = String(email).trim().toLowerCase();
      const target = store.users.find((u) => String(u?.email || '').trim().toLowerCase() === normalized);
      if (!target) return { status: 401, body: { error: 'Aucun compte avec cet e-mail' } };
      const acctStatus = String(target.status || 'Actif').toLowerCase();
      if (acctStatus === 'suspendu' || acctStatus === 'inactif' || acctStatus === 'bloque' || acctStatus === 'bloqué') {
        return { status: 403, body: { error: 'Votre compte est suspendu. Contactez un administrateur.' } };
      }
      const hash = createHash('sha256').update(password).digest('hex');
      if (!isAcceptedPasswordHash(target, hash)) {
        if (!target.passwordHash) {
          target.passwordHash = hash;
          await writeStore(store);
          console.log(`[Auth] Recovered passwordHash for ${target.email} (was missing)`);
        } else {
          return { status: 401, body: { error: 'Mot de passe incorrect' } };
        }
      }
      const token = createToken(target.id, target.role);
      return { status: 200, body: { ok: true, token, user: sanitizeUser(target) } };
    });
    sendJson(response, loginResult.status, loginResult.body);
    return;
  }

  if (endpoint === 'register' && request.method === 'POST') {
    const body = await readBody(request);
    const data = JSON.parse(body || '{}');
    const { name, email, password, role, phone, organization, region, gender } = data;

    if (!name || !email || !password) {
      sendJson(response, 400, { error: 'Nom, email et mot de passe requis' });
      return;
    }
    if (typeof email !== 'string' || !/^[^\s@]+@[^\s@]+\.[^\s@]+$/.test(email.trim())) {
      sendJson(response, 400, { error: 'Format email invalide' });
      return;
    }
    if (password.length < 6) {
      sendJson(response, 400, { error: 'Le mot de passe doit faire au moins 6 caractères' });
      return;
    }
    const allowedRoles = ['agriculteur', 'acheteur', 'acheteurB2B', 'transporteur', 'agent', 'agentTerrain', 'client', 'partenaire'];
    if (role && !allowedRoles.includes(role)) {
      sendJson(response, 400, { error: 'Rôle invalide' });
      return;
    }

    const regResult = await storeMutex.withLock(async () => {
      const store = await readStore();
      const normalized = email.trim().toLowerCase();
      if (store.users.some((u) => String(u?.email || '').trim().toLowerCase() === normalized)) {
        return { status: 409, body: { error: 'Un compte existe déjà avec cet e-mail' } };
      }
      const hash = createHash('sha256').update(password).digest('hex');
      const now = new Date().toISOString();
      const parsedBody = JSON.parse(body || '{}');
      const gpsLat = parsedBody.gpsLat ? Number(parsedBody.gpsLat) : null;
      const gpsLng = parsedBody.gpsLng ? Number(parsedBody.gpsLng) : null;

      let assignedHubId = null;
      if (gpsLat && gpsLng && (role || 'agriculteur') === 'agriculteur') {
        const hubs = store.hubs || [];
        let minDist = Infinity;
        for (const hub of hubs) {
          if (!hub.gpsLat || !hub.gpsLng) continue;
          const usage = (hub.currentStockKg || 0) / (hub.capacityKg || 1);
          if (usage > 0.95) continue;
          const dist = haversineKm(gpsLat, gpsLng, hub.gpsLat, hub.gpsLng);
          if (dist < minDist && dist <= 25) {
            minDist = dist;
            assignedHubId = hub.id;
          }
        }
      }

      const newUser = {
        id: `usr-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`,
        createdAt: now,
        name: String(name).trim().slice(0, 100),
        email: email.trim().slice(0, 200),
        phone: String(phone || '').trim().slice(0, 30),
        role: role || 'agriculteur',
        status: (role || 'agriculteur') === 'client' ? 'Actif' : 'En attente',
        organization: String(organization || '').trim().slice(0, 100),
        region: String(region || '').trim().slice(0, 100),
        gender: gender === 'F' || gender === 'M' ? gender : '',
        bio: '',
        passwordHash: hash,
        gpsLat,
        gpsLng,
        assignedHubId,
        agentProfile: (role === 'agentTerrain' && data.agentProfile) ? String(data.agentProfile).trim() : '',
        verificationScore: 0,
        verificationLevel: 0,
      };
      const updates = { ...store, users: [...store.users, newUser] };
      if (newUser.status === 'En attente') {
        const notif = {
          id: `notif-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`,
          createdAt: now,
          type: 'approval_request',
          title: `Nouvelle inscription ${newUser.role}`,
          body: `${newUser.name} (${newUser.email}) demande à être validé comme ${newUser.role}.`,
          recipientRole: 'admin',
          path: newUser.role === 'agriculteur' ? '/verification' : '/utilisateurs',
          relatedId: newUser.id,
          targetUserId: newUser.id,
          read: false,
        };
        updates.notifications = [notif, ...(store.notifications || [])];
      }
      await writeStore(updates);
      const token = createToken(newUser.id, newUser.role);
      return { status: 201, body: { ok: true, token, user: sanitizeUser(newUser) } };
    });
    sendJson(response, regResult.status, regResult.body);
    return;
  }

  if (endpoint === 'me' && request.method === 'GET') {
    const authData = requireAuth(request);
    if (!authData) { sendJson(response, 401, { error: 'Non autorisé' }); return; }
    const store = await readStore();
    const user = store.users.find((u) => u.id === authData.uid);
    if (!user) { sendJson(response, 404, { error: 'Utilisateur introuvable' }); return; }
    sendJson(response, 200, { ok: true, user: sanitizeUser(user) });
    return;
  }

  if (endpoint === 'forgot-password' && request.method === 'POST') {
    const body = await readBody(request);
    const { email } = JSON.parse(body || '{}');
    if (!email) {
      sendJson(response, 400, { error: 'Email requis' });
      return;
    }
    const store = await readStore();
    const normalized = String(email).trim().toLowerCase();
    const target = store.users.find((u) => String(u?.email || '').trim().toLowerCase() === normalized);
    if (!target) {
      sendJson(response, 200, { ok: true, message: 'Si ce compte existe, un code de réinitialisation a été généré.' });
      return;
    }
    const code = generateResetCode();
    resetTokens.set(normalized, {
      code,
      userId: target.id,
      expiresAt: Date.now() + RESET_TOKEN_EXPIRY_MS,
      attempts: 0,
    });
    console.log(`[Auth] Reset code for ${normalized}: ${code}`);
    sendJson(response, 200, {
      ok: true,
      message: 'Code de réinitialisation généré.',
      hint: `Code: ${code} (valable 15 minutes)`,
      code,
    });
    return;
  }

  if (endpoint === 'reset-password' && request.method === 'POST') {
    const body = await readBody(request);
    const { email, code, newPassword } = JSON.parse(body || '{}');
    if (!email || !code || !newPassword) {
      sendJson(response, 400, { error: 'Email, code et nouveau mot de passe requis' });
      return;
    }
    if (newPassword.length < 6) {
      sendJson(response, 400, { error: 'Le mot de passe doit faire au moins 6 caractères' });
      return;
    }
    const normalized = String(email).trim().toLowerCase();
    const resetData = resetTokens.get(normalized);
    if (!resetData) {
      sendJson(response, 400, { error: 'Aucun code de réinitialisation trouvé. Demandez un nouveau code.' });
      return;
    }
    if (Date.now() > resetData.expiresAt) {
      resetTokens.delete(normalized);
      sendJson(response, 400, { error: 'Code expiré. Demandez un nouveau code.' });
      return;
    }
    resetData.attempts++;
    if (resetData.attempts > 5) {
      resetTokens.delete(normalized);
      sendJson(response, 429, { error: 'Trop de tentatives. Demandez un nouveau code.' });
      return;
    }
    if (resetData.code !== code.trim().toUpperCase()) {
      sendJson(response, 400, { error: `Code incorrect. ${5 - resetData.attempts} tentative(s) restante(s).` });
      return;
    }
    const store = await readStore();
    const target = store.users.find((u) => u.id === resetData.userId);
    if (!target) {
      sendJson(response, 404, { error: 'Utilisateur introuvable' });
      return;
    }
    target.passwordHash = createHash('sha256').update(newPassword).digest('hex');
    await writeStore(store);
    resetTokens.delete(normalized);
    const token = createToken(target.id, target.role);
    sendJson(response, 200, {
      ok: true,
      message: 'Mot de passe réinitialisé avec succès.',
      token,
      user: sanitizeUser(target),
    });
    return;
  }

  if (endpoint === 'set-password' && request.method === 'POST') {
    const authData = requireAuth(request);
    if (!authData || authData.role !== 'admin') {
      sendJson(response, 403, { error: 'Réservé aux administrateurs' });
      return;
    }
    const body = await readBody(request);
    const { userId, email, passwordHash: newHash, password } = JSON.parse(body || '{}');
    if (!newHash && !password) {
      sendJson(response, 400, { error: 'passwordHash ou password requis' });
      return;
    }
    const hash = newHash || createHash('sha256').update(password).digest('hex');
    const store = await readStore();
    const normalizedEmail = email ? String(email).trim().toLowerCase() : '';
    const target = store.users.find((u) =>
      (userId && u.id === userId) || (normalizedEmail && String(u.email || '').trim().toLowerCase() === normalizedEmail)
    );
    if (!target) {
      sendJson(response, 404, { error: 'Utilisateur introuvable' });
      return;
    }
    target.passwordHash = hash;
    await writeStore(store);
    sendJson(response, 200, { ok: true, userId: target.id, email: target.email });
    return;
  }

  if (endpoint === 'bulk-set-password' && request.method === 'POST') {
    const authData = requireAuth(request);
    if (!authData || authData.role !== 'admin') {
      sendJson(response, 403, { error: 'Réservé aux administrateurs' });
      return;
    }
    const body = await readBody(request);
    const { entries } = JSON.parse(body || '{}');
    if (!Array.isArray(entries) || entries.length === 0) {
      sendJson(response, 400, { error: 'entries[] requis (tableau de {email, passwordHash ou password})' });
      return;
    }
    const store = await readStore();
    const results = [];
    for (const entry of entries) {
      const { email, passwordHash: h, password: p } = entry || {};
      const hash = h || (p ? createHash('sha256').update(p).digest('hex') : null);
      if (!email || !hash) { results.push({ email, ok: false, error: 'données manquantes' }); continue; }
      const normalized = String(email).trim().toLowerCase();
      const target = store.users.find((u) => String(u.email || '').trim().toLowerCase() === normalized);
      if (!target) { results.push({ email, ok: false, error: 'introuvable' }); continue; }
      target.passwordHash = hash;
      results.push({ email, ok: true, userId: target.id });
    }
    await writeStore(store);
    sendJson(response, 200, { ok: true, results });
    return;
  }

  sendJson(response, 404, { error: 'Endpoint auth inconnu' });
}

// ============================================================================
// GEO UTILITIES
// ============================================================================
function haversineKm(lat1, lng1, lat2, lng2) {
  const R = 6371;
  const dLat = (lat2 - lat1) * Math.PI / 180;
  const dLng = (lng2 - lng1) * Math.PI / 180;
  const a = Math.sin(dLat / 2) ** 2 + Math.cos(lat1 * Math.PI / 180) * Math.cos(lat2 * Math.PI / 180) * Math.sin(dLng / 2) ** 2;
  return R * 2 * Math.atan2(Math.sqrt(a), Math.sqrt(1 - a));
}

// ============================================================================
// ACTIVITY PROOFS - Farmer verification system
// ============================================================================
const PROOF_SCORES = {
  attestation_chef: 20,
  carte_cooperative: 25,
  parrainage_agriculteurs: 15,
  mobile_money_agri: 15,
  historique_livraisons: 20,
  photo_exploitation: 20,
  gps_exploitation: 20,
  recu_intrants: 15,
  contrat_vente: 15,
  carte_exploitant: 30,
  visite_agent: 40,
};

function computeProofScore(proofs) {
  if (!Array.isArray(proofs) || proofs.length === 0) return 0;
  const validProofs = proofs.filter((p) => p.status === 'valide' || p.status === 'auto_valide');
  return Math.min(100, validProofs.reduce((sum, p) => sum + (PROOF_SCORES[p.proofType] || 10), 0));
}

function getVerificationLevel(score) {
  if (score >= 60) return 2;
  if (score >= 30) return 1;
  return 0;
}

async function handleActivityProofs(request, response, authData) {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);

  if (request.method === 'POST') {
    const body = await readBody(request);
    const data = JSON.parse(body || '{}');
    const { proofType, description, attachment, gpsLat, gpsLng, sponsorIds, agentId } = data;

    if (!proofType) {
      sendJson(response, 400, { error: 'Type de preuve requis' });
      return;
    }

    const result = await storeMutex.withLock(async () => {
      const store = await readStore();
      const now = new Date().toISOString();

      const existingProof = (store.activityProofs || []).find(
        (p) => p.userId === authData.uid && p.proofType === proofType && ['valide', 'auto_valide', 'en_attente', 'en_attente_agent'].includes(p.status)
      );
      if (existingProof) {
        return { status: 409, body: { error: 'Vous avez deja soumis ce type de preuve.' } };
      }

      const canAutoValidate = ['historique_livraisons', 'parrainage_agriculteurs', 'mobile_money_agri'].includes(proofType);
      let autoValid = false;

      if (proofType === 'historique_livraisons') {
        const userOrders = (store.orders || []).filter((o) => o.sellerId === authData.uid && o.status === 'Livree');
        autoValid = userOrders.length >= 3;
      }
      if (proofType === 'parrainage_agriculteurs' && Array.isArray(sponsorIds)) {
        const validSponsors = sponsorIds.filter((sid) => {
          const sponsor = store.users.find((u) => u.id === sid);
          return sponsor && sponsor.role === 'agriculteur' && sponsor.status === 'Actif';
        });
        autoValid = validSponsors.length >= 2;
      }

      const isAgentVisit = proofType === 'visite_agent' && agentId;
      const proofStatus = autoValid ? 'auto_valide' : isAgentVisit ? 'en_attente_agent' : 'en_attente';

      const proof = {
        id: `aproof-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`,
        createdAt: now,
        userId: authData.uid,
        proofType,
        description: String(description || '').trim().slice(0, 500),
        attachment: attachment || null,
        gpsLat: gpsLat ? Number(gpsLat) : null,
        gpsLng: gpsLng ? Number(gpsLng) : null,
        sponsorIds: sponsorIds || [],
        agentId: agentId || null,
        status: proofStatus,
        score: PROOF_SCORES[proofType] || 10,
        reviewedAt: autoValid ? now : null,
        reviewedBy: autoValid ? 'system' : null,
      };

      const updatedProofs = [...(store.activityProofs || []), proof];
      const userProofs = updatedProofs.filter((p) => p.userId === authData.uid);
      const totalScore = computeProofScore(userProofs);
      const level = getVerificationLevel(totalScore);

      const userUpdate = {};
      if (totalScore >= 30) {
        userUpdate.verificationScore = totalScore;
        userUpdate.verificationLevel = level;
        if (level >= 1) {
          const user = store.users.find((u) => u.id === authData.uid);
          if (user && user.status === 'En attente') {
            userUpdate.status = 'Actif';
            userUpdate.approvedAt = now;
            userUpdate.approvedBy = 'system_verification';
          }
        }
      } else {
        userUpdate.verificationScore = totalScore;
        userUpdate.verificationLevel = 0;
      }

      const updatedUsers = store.users.map((u) =>
        u.id === authData.uid ? { ...u, ...userUpdate } : u
      );

      const updates = { ...store, activityProofs: updatedProofs, users: updatedUsers };

      if (totalScore >= 30 && userUpdate.status === 'Actif') {
        const notif = {
          id: `notif-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`,
          createdAt: now,
          type: 'account-status',
          title: 'Compte active automatiquement',
          body: `Votre score de verification (${totalScore}/100) a permis l activation automatique de votre compte.`,
          recipientId: authData.uid,
          path: '/',
          read: false,
        };
        updates.notifications = [notif, ...(store.notifications || [])];
      }

      if (!autoValid) {
        const farmerName = store.users.find((u) => u.id === authData.uid)?.name || 'Agriculteur';
        if (isAgentVisit) {
          const agentNotif = {
            id: `notif-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`,
            createdAt: now,
            type: 'agent_confirm_visit',
            title: 'Confirmation de visite terrain',
            body: `${farmerName} demande votre confirmation de visite terrain. Confirmez-vous avoir visite son exploitation ?`,
            recipientId: agentId,
            path: '/verification',
            relatedId: proof.id,
            targetUserId: authData.uid,
            read: false,
          };
          updates.notifications = [agentNotif, ...(updates.notifications || store.notifications || [])];
        } else {
          const adminNotif = {
            id: `notif-${Date.now().toString(36)}-${randomBytes(4).toString('hex')}`,
            createdAt: now,
            type: 'proof_review',
            title: 'Preuve d activite a valider',
            body: `${farmerName} a soumis une preuve (${proofType}).`,
            recipientRole: 'admin',
            path: '/verification',
            relatedId: proof.id,
            read: false,
          };
          updates.notifications = [adminNotif, ...(updates.notifications || store.notifications || [])];
        }
      }

      await writeStore(updates);
      return { status: 201, body: { ok: true, proof, score: totalScore, level } };
    });

    sendJson(response, result.status, result.body);
    return;
  }

  if (request.method === 'GET') {
    const store = await readStore();
    const userId = url.searchParams.get('userId');
    let proofs;
    if ((authData.role === 'admin' || authData.role === 'agentTerrain') && userId) {
      proofs = (store.activityProofs || []).filter((p) => p.userId === userId);
    } else if (authData.role === 'admin') {
      proofs = store.activityProofs || [];
    } else if (authData.role === 'agentTerrain') {
      const allProofs = store.activityProofs || [];
      const ownReview = allProofs.filter((p) => p.agentId === authData.uid);
      const pendingReview = allProofs.filter((p) => p.status === 'en_attente');
      proofs = [...new Map([...ownReview, ...pendingReview].map((p) => [p.id, p])).values()];
    } else {
      proofs = (store.activityProofs || []).filter((p) => p.userId === authData.uid);
    }
    const score = computeProofScore(proofs);
    sendJson(response, 200, { ok: true, proofs, score, level: getVerificationLevel(score) });
    return;
  }

  if (request.method === 'PATCH') {
    if (authData.role !== 'admin' && authData.role !== 'agentTerrain') {
      sendJson(response, 403, { error: 'Acces reserve aux administrateurs et agents terrain' });
      return;
    }
    const body = await readBody(request);
    const { proofId, status: newStatus } = JSON.parse(body || '{}');
    if (!proofId || !['valide', 'rejete'].includes(newStatus)) {
      sendJson(response, 400, { error: 'proofId et status (valide/rejete) requis' });
      return;
    }

    const result = await storeMutex.withLock(async () => {
      const store = await readStore();
      const now = new Date().toISOString();
      const proofIdx = (store.activityProofs || []).findIndex((p) => p.id === proofId);
      if (proofIdx === -1) return { status: 404, body: { error: 'Preuve introuvable' } };

      const targetProof = (store.activityProofs || [])[proofIdx];
      if (targetProof.status === 'en_attente_agent' && authData.role === 'agentTerrain' && targetProof.agentId !== authData.uid) {
        return { status: 403, body: { error: 'Seul l agent designe peut confirmer cette visite' } };
      }

      const updatedProofs = [...(store.activityProofs || [])];
      updatedProofs[proofIdx] = { ...updatedProofs[proofIdx], status: newStatus, reviewedAt: now, reviewedBy: authData.uid };

      const targetUserId = updatedProofs[proofIdx].userId;
      const userProofs = updatedProofs.filter((p) => p.userId === targetUserId);
      const totalScore = computeProofScore(userProofs);
      const level = getVerificationLevel(totalScore);

      const updatedUsers = store.users.map((u) => {
        if (u.id !== targetUserId) return u;
        const patch = { verificationScore: totalScore, verificationLevel: level };
        if (level >= 1 && u.status === 'En attente') {
          patch.status = 'Actif';
          patch.approvedAt = now;
          patch.approvedBy = authData.uid;
        }
        return { ...u, ...patch };
      });

      const updates = { ...store, activityProofs: updatedProofs, users: updatedUsers };
      await writeStore(updates);
      return { status: 200, body: { ok: true, score: totalScore, level } };
    });

    sendJson(response, result.status, result.body);
    return;
  }

  sendJson(response, 405, { error: 'Method not allowed' });
}

function sanitizeUser(user) {
  if (!user || typeof user !== 'object') return user;
  const { passwordHash, ...safe } = user;
  return safe;
}

function sanitizeStoreForClient(store) {
  return {
    ...store,
    users: (store.users || []).map(sanitizeUser),
  };
}

// ============================================================================
// CLOUDINARY UPLOAD
// ============================================================================
async function handleUpload(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }
  if (!cloudinaryCloudName || !cloudinaryApiKey || !cloudinaryApiSecret) {
    sendJson(response, 500, { error: 'Cloudinary non configuré' });
    return;
  }
  try {
    const body = await readBody(request);
    const data = JSON.parse(body || '{}');
    const file = data.file; // base64 data URL
    if (!file || !file.startsWith('data:')) {
      sendJson(response, 400, { error: 'Fichier manquant (data URL attendue)' });
      return;
    }
    const timestamp = Math.floor(Date.now() / 1000);
    const folder = data.folder || 'frescoop';
    const paramsToSign = `folder=${folder}&timestamp=${timestamp}`;
    const signature = createHash('sha1').update(paramsToSign + cloudinaryApiSecret).digest('hex');

    const formBody = new URLSearchParams({
      file,
      folder,
      timestamp: String(timestamp),
      api_key: cloudinaryApiKey,
      signature,
    });

    const res = await fetch(
      `https://api.cloudinary.com/v1_1/${cloudinaryCloudName}/image/upload`,
      { method: 'POST', body: formBody },
    );
    const result = await res.json();
    if (result.secure_url) {
      sendJson(response, 200, {
        ok: true,
        url: result.secure_url,
        public_id: result.public_id,
        width: result.width,
        height: result.height,
      });
    } else {
      sendJson(response, 400, { ok: false, error: result.error?.message || 'Échec upload Cloudinary', raw: result });
    }
  } catch (err) {
    sendJson(response, 500, { ok: false, error: err.message });
  }
}

async function handlePaydunya(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  const endpoint = url.pathname.replace('/api/paydunya/', '');

  if (!process.env.PAYDUNYA_MASTER_KEY) {
    sendJson(response, 500, { error: 'PayDunya credentials not configured' });
    return;
  }

  const headers = {
    'Content-Type': 'application/json',
    'PAYDUNYA-MASTER-KEY': process.env.PAYDUNYA_MASTER_KEY,
    'PAYDUNYA-PRIVATE-KEY': process.env.PAYDUNYA_PRIVATE_KEY,
    'PAYDUNYA-TOKEN': process.env.PAYDUNYA_TOKEN,
  };

  if (endpoint === 'create-invoice' && request.method === 'POST') {
    const body = await readBody(request);
    const data = JSON.parse(body || '{}');
    const storeName = process.env.PAYDUNYA_STORE_NAME || 'FresCoop';
    const origin = `${request.headers['x-forwarded-proto'] || 'http'}://${request.headers.host}`;

    const payload = {
      invoice: {
        total_amount: Number(data.amount) || 0,
        description: data.description || 'Paiement commande FresCoop',
      },
      store: {
        name: storeName,
        tagline: 'Commerce agricole, preuve économique',
        phone: data.storePhone || '',
        postal_address: data.storeAddress || 'Dakar, Senegal',
        website_url: origin,
      },
      custom_data: {
        order_ids: data.orderIds || [],
        payer_id: data.payerId || '',
        receipt_code: data.receiptCode || '',
      },
      actions: {
        callback_url: `${origin}/api/paydunya/ipn`,
        return_url: `${origin}/paiement?status=success&token=__TOKEN__`,
        cancel_url: `${origin}/paiement?status=cancel`,
      },
    };

    try {
      const pdRes = await fetch(`${paydunyaApiBase}/checkout-invoice/create`, {
        method: 'POST',
        headers,
        body: JSON.stringify(payload),
      });
      const result = await pdRes.json();
      if (result?.response_code === '00') {
        sendJson(response, 200, {
          ok: true,
          token: result.token,
          url: result.response_text,
          mode: paydunyaMode,
        });
      } else {
        sendJson(response, 400, {
          ok: false,
          error: result?.response_text || 'Echec creation facture PayDunya',
          raw: result,
        });
      }
    } catch (error) {
      sendJson(response, 502, { ok: false, error: error.message });
    }
    return;
  }

  if (endpoint.startsWith('confirm/') && request.method === 'GET') {
    const token = endpoint.replace('confirm/', '');
    if (!token) {
      sendJson(response, 400, { error: 'Token manquant' });
      return;
    }
    try {
      const pdRes = await fetch(`${paydunyaApiBase}/checkout-invoice/confirm/${encodeURIComponent(token)}`, {
        method: 'GET',
        headers,
      });
      const result = await pdRes.json();
      const confirmed = result?.status === 'completed';
      sendJson(response, 200, {
        ok: true,
        confirmed,
        status: result?.status || 'unknown',
        amount: Number(result?.invoice?.total_amount) || 0,
        customer: result?.customer || null,
        receiptUrl: result?.receipt_url || '',
        customData: result?.custom_data || {},
        raw: result,
      });
    } catch (error) {
      sendJson(response, 502, { ok: false, error: error.message });
    }
    return;
  }

  if (endpoint === 'ipn' && request.method === 'POST') {
    const body = await readBody(request);
    let ipnData;
    try { ipnData = JSON.parse(body || '{}'); } catch { ipnData = {}; }
    console.log('[PayDunya IPN]', JSON.stringify(ipnData).slice(0, 500));
    // Verify IPN by checking the payment status with PayDunya API
    const ipnToken = ipnData?.data?.hash || ipnData?.token || '';
    if (ipnToken && process.env.PAYDUNYA_MASTER_KEY) {
      try {
        const verifyRes = await fetch(`${paydunyaApiBase}/checkout-invoice/confirm/${encodeURIComponent(ipnToken)}`, {
          method: 'GET',
          headers,
        });
        const verifyResult = await verifyRes.json();
        if (verifyResult?.status === 'completed') {
          console.log('[PayDunya IPN] Paiement vérifié:', ipnToken);
        } else {
          console.warn('[PayDunya IPN] Statut non confirmé:', verifyResult?.status);
        }
      } catch (err) {
        console.error('[PayDunya IPN] Erreur vérification:', err.message);
      }
    }
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 404, { error: 'Endpoint PayDunya inconnu' });
}

async function handleYaayChat(request, response) {
  if (request.method !== 'POST') {
    sendJson(response, 405, { error: 'Method not allowed' });
    return;
  }

  const apiKey = process.env.OPENROUTER_API_KEY;
  if (!apiKey) {
    try {
      const body = await readBody(request);
      const payload = JSON.parse(body || '{}');
      const { message, lang = 'fr', context = {} } = payload;
      const fallbackAnswer = generateLocalAnswer(message || '', lang, context);
      sendJson(response, 200, {
        ok: true,
        answer: fallbackAnswer || "Je suis FresCoop AI. Posez-moi vos questions sur la plateforme.",
        model: 'frescoop-local-fallback',
      });
    } catch (err) {
      sendJson(response, 200, {
        ok: true,
        answer: "Je suis FresCoop AI. Posez-moi vos questions sur les prix, la vente, le crédit, ou l'anti-gaspi.",
        model: 'frescoop-local-fallback',
      });
    }
    return;
  }

  try {
    const body = await readBody(request);
    const payload = JSON.parse(body || '{}');
    const { message, lang = 'fr', context = {}, history = [] } = payload;

    if (!message || typeof message !== 'string') {
      sendJson(response, 400, { error: 'message requis' });
      return;
    }

    // ========= BYPASS SÉRÈRE =========
    // Les LLM gratuits ne maîtrisent pas le sérère (faible corpus d'entraînement).
    // On utilise un moteur local hand-crafted + encadrement FR pour éviter les
    // réponses wolof déguisées. C'est la solution la plus honnête et la plus fiable.
    if (lang === 'sr') {
      const answer = generateSerereAnswer(message, context);
      sendJson(response, 200, {
        ok: true,
        answer,
        model: 'frescoop-serere-local',
      });
      return;
    }

    const langLabel = {
      fr: 'français',
      wo: 'wolof',
      pul: 'pulaar',
    }[lang] || 'français';

    const systemPrompt = buildSystemPrompt(langLabel, context, lang);

    // Few-shot bilingue sérère pour ancrer le vocabulaire avant la vraie question
    const fewShotSerere = lang === 'sr'
      ? [
          { role: 'user', content: 'Nafio, le ma ŋ kirim penaar ?' },
          {
            role: 'assistant',
            content:
              'Nafio ! Hiin hannde e marché FresCoop : tomates ndewoh 700 F/kg, oignon 450 F/kg. Da onglet "Marché" ole ya kirim ma tedd — mi fa kala kirim ak njeg yi.',
          },
          { role: 'user', content: 'Le mbaane haat ana ?' },
          {
            role: 'assistant',
            content:
              'Yaad ŋ pendol ! Da "Bancabilité" ole score ma (0-100) mi leng ole vente ma ak paiement ma PayDunya. Score haat pe 70 → dossier ma eligible le BNDE ole SFD partenaire.',
          },
        ]
      : [];

    const messages = [
      { role: 'system', content: systemPrompt },
      ...fewShotSerere,
      ...((Array.isArray(history) ? history : []).slice(-6).map((h) => ({
        role: h.from === 'user' ? 'user' : 'assistant',
        content: String(h.text || '').slice(0, 500),
      }))),
      { role: 'user', content: message.slice(0, 1000) },
    ];

    const modelList = (process.env.OPENROUTER_MODELS ||
      process.env.OPENROUTER_MODEL ||
      'openai/gpt-oss-120b:free,meta-llama/llama-3.3-70b-instruct:free,google/gemma-3-27b-it:free'
    )
      .split(',')
      .map((m) => m.trim())
      .filter(Boolean);

    let result = null;
    const errors = [];
    for (const model of modelList) {
      try {
        result = await callOpenRouter(apiKey, model, messages);
        if (result?.answer) {
          // Validation langue : si la réponse est contaminée par du wolof
          // alors qu'on a demandé autre chose, on retente avec prompt correctif
          const answer = result.answer;
          const looksWolof = /\b(njëg|njeg|salamaleekum|nangadef|jerejef|jërëjëf|baax na|lu nga|nanga|ndank|lan la|demal|jëfandiko|jaaykat|jaay)\b/i.test(answer);
          const wantsNotWolof = lang !== 'wo' && lang !== 'fr';
          if (wantsNotWolof && looksWolof) {
            // Retry avec instruction corrective (température basse pour coller au few-shot)
            const retry = await callOpenRouter(
              apiKey,
              model,
              [
                ...messages,
                { role: 'assistant', content: answer },
                {
                  role: 'user',
                  content:
                    lang === 'sr'
                      ? "Ta réponse précédente contient du wolof (njëg, salamaleekum, etc.). Reformule EXACTEMENT la même information mais en SÉRÈRE UNIQUEMENT. Utilise : Nafio (bonjour), hiin (prix), fandu (acheter), yaad (merci), pendol ma (dis-moi), kirim (marchandise). Si un mot n'existe pas en sérère, écris-le en français entre parenthèses. N'utilise aucun mot wolof."
                      : "Ta réponse contient du wolof. Reformule en " + langLabel + " uniquement.",
                },
              ],
              { temperature: 0.4, top_p: 0.8 },
            ).catch(() => null);
            if (retry?.answer) {
              // Double-check : si toujours wolof après retry, on ajoute un disclaimer honnête
              const looksStillWolof = /\b(njëg|njeg|salamaleekum|jerejef|jërëjëf)\b/i.test(retry.answer);
              if (looksStillWolof && lang === 'sr') {
                result = {
                  ...retry,
                  answer:
                    retry.answer +
                    '\n\n— Note : certaines expressions peuvent sembler proches du wolof. La traduction parfaite en sérère demande une relecture humaine.',
                };
              } else {
                result = retry;
              }
            }
          }
          break;
        }
      } catch (err) {
        errors.push(`${model}: ${err?.message || 'err'}`);
        continue;
      }
    }

    if (!result || !result.answer) {
      const fallbackAnswer = generateLocalAnswer(message, lang, { ...context, stats: context.stats, userName: context.userName });
      if (fallbackAnswer) {
        sendJson(response, 200, { ok: true, answer: fallbackAnswer, model: 'frescoop-local-fallback' });
        return;
      }
      throw new Error(`Aucun modèle n'a répondu. ${errors.join(' | ')}`);
    }

    // Formatage pro : normalise les espaces, retire les blocs markdown lourds
    let finalAnswer = String(result.answer || '').trim();
    // Retire les balises ``` mal fermées
    finalAnswer = finalAnswer.replace(/```[\s\S]*?```/g, (m) => m.replace(/```/g, ''));
    // Compacte les retours à la ligne multiples (max 2)
    finalAnswer = finalAnswer.replace(/\n{3,}/g, '\n\n');

    sendJson(response, 200, {
      ok: true,
      answer: finalAnswer,
      model: result.model,
    });
  } catch (error) {
    console.error('[Yaay]', error?.message || error);
    sendJson(response, 502, {
      ok: false,
      error: error?.message || 'Erreur IA',
      fallback: true,
    });
  }
}

// ============================================================================
// MOTEUR SÉRÈRE HAND-CRAFTED
// ----------------------------------------------------------------------------
// Les LLM gratuits ne connaissent pas le sérère. Au lieu de les laisser
// répondre en faux sérère (wolof déguisé), on fournit ici des réponses
// authentiques en alternance sérère / français — comme le font les locuteurs
// sérère dans la vie réelle sur des sujets modernes (commerce, tech, banque).
// Les formules d'accueil et mots-clés sont en vrai sérère seereer.
// ============================================================================

function normalizeSerere(s) {
  return String(s || '')
    .toLowerCase()
    .normalize('NFD')
    .replace(/[̀-ͯ]/g, '')
    .replace(/[^a-z0-9\s]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function generateSerereAnswer(message, context) {
  const stats = context.stats || {};
  const text = normalizeSerere(message);
  const words = text.split(' ');

  const has = (patterns) => patterns.some((p) => text.includes(p));

  // Salutations (sérère authentique)
  if (has(['nafio', 'nafiyo', 'mbaa kaa', 'asalam', 'bonjour', 'bonsoir', 'salut'])) {
    const name = context.userName ? context.userName.split(' ')[0] : '';
    return `Nafio ${name} 🌱\n\nMi tedd FresCoop AI. Da mbaane wallu la :\n\n• Njeg kirim (prix du marché)\n• Felax njeg (vendre)\n• Haat (crédit bancaire)\n• Anti-gaspi\n• Suivi lot\n• Pay PayDunya\n\nPendol ma — pose ta question en sérère ou français, je réponds selon ce que je sais en sérère.`;
  }

  // Qui es-tu
  if (has(['ma kan', 'ma tedd', 'qui es tu', 'qui es-tu', 'ton nom', 'tu es'])) {
    return `Mi tedd FresCoop AI 🤖\n\nMi a ŋ ofi (je suis l'assistant intelligent) pour la plateforme FresCoop — 4 langues : français, wolof, pulaar, sérère. Le mbaane wallu la ak njeg, felax, haat walla paiement.`;
  }

  // Merci
  if (has(['yaad', 'yaɗ', 'merci', 'jerejef'])) {
    return `Yaad ma 🌱 (merci aussi à toi). Pendol ma bu nga am laaj (pose-moi une autre question si besoin).`;
  }

  // Prix du jour / cours
  if (has(['njeg', 'hiin', 'kirim penaar', 'prix', 'cours', 'tarif', 'cout', 'combien'])) {
    const n = stats.products || 0;
    return `📊 Njeg hannde (prix du jour)\n\nDa Marché ole ya kirim penaar : ${n} produits aktif.\n\nExempl :\n• Tomates : 500-900 FCFA/kg\n• Oignon : 400-500 FCFA/kg\n• Mangues Kent : 700-1100 FCFA/kg\n• Mil : 22 000 FCFA/sac 50kg\n\nDa onglet "Marché" ole kirim ma tedd ak njeg yi (consulte l'onglet Marché pour voir tous les produits et leur prix en temps réel).`;
  }

  // Vendre / publier produit
  if (has(['felax', 'fandu', 'vendre', 'publier', 'poster', 'njeeygol', 'mettre en vente'])) {
    return `💡 Le mbaane felax kirim ma (comment vendre tes produits) :\n\n1. Inscription : crée un compte "Agriculteur"\n2. Onglet Produits → bouton + (plus) → photos, prix, quantité, zone\n3. Da Marché ole acheteurs (B2B + clients) a ŋ see ma kirim (les acheteurs verront ton produit)\n4. Order → pay PayDunya (Wave, Orange Money, Free Money, carte)\n5. Agent terrain walla transporteur livre le kirim\n\nChaque vente renforce ma score de bancabilité (0-100) pour demander un crédit.`;
  }

  // Crédit / bancabilité
  if (has(['haat', 'credit', 'banq', 'bnde', 'microcred', 'bancabilite', 'pret', 'emprunt'])) {
    return `🏦 Haat ana (crédit bancaire) — FresCoop calcule ton score 0-100 :\n\n• Volume de ventes : 30 points\n• Régularité des preuves PayDunya : 25 points\n• Diversification catégories : 20 points\n• Attestations validées : 25 points\n\nScore ≥ 70 = dossier éligible chez BNDE, Microcred walla SFD partenaire. Exportable en PDF depuis l'onglet Bancabilité.\n\nPe felax lu bari e FresCoop, score ma a ŋ baax (plus tu vends, plus ton score grimpe).`;
  }

  // Anti-gaspi
  if (has(['ŋoox', 'noox', 'anti gaspi', 'antigaspi', 'gaspillage', 'perte', 'peremption', 'dlc', 'flash', 'sauver'])) {
    return `♻️ Anti-gaspi FresCoop — 3 niveaux d'alerte automatique :\n\n🔴 Critique (≤24h) : remise -40% automatique\n🟡 Élevé (2-3j) : remise -25%\n🟠 Surveillance (4-6j) : remise -15%\n\nL'agriculteur applique la remise en un clic → acheteurs B2B notifiés par SMS + push. Pe felax ak njeg reduit (tu vends avec prix cassé) et tu évites la perte.\n\nImpact ODD 12 : Consommation responsable.`;
  }

  // Traçabilité / lots / QR
  if (has(['lot', 'suivi', 'tracabilite', 'traçabilite', 'qr', 'froid', 'temperature', 'ndaroo'])) {
    const n = stats.lots || 0;
    const h = stats.hubs || 0;
    return `Traçabilité FresCoop - chaque lot a un QR code unique\n\nLe QR expose:\n- Origine (parcelle, village)\n- Photos qualité à la récolte\n- Température hub froid en temps réel\n- Historique statuts (récolté -> livré -> payé)\n- Commande + paiement associés\n\nActuellement: ${n} lots tracés et ${h} hubs solaires pilotes. Scan QR depuis l’onglet Lots.`;
  }

  // USSD
  if (has(['ussd', 'telephone 2g', '384', 'sans internet', 'sans smartphone', 'simple'])) {
    return `📞 USSD *384*FRES# — pour les téléphones 2G sans Internet\n\nMenu disponible en wolof, pulaar, français :\n1. Njeg du jour\n2. Déclarer une vente\n3. Mon solde FresCoop\n4. Alerte anti-gaspi\n5. Contacter agent terrain\n\nFrais opérateur standards. 100% couverture rurale — clé de l'inclusion pour les productrices et producteurs sans smartphone.`;
  }

  // Paiement
  if (has(['pay', 'paiement', 'wave', 'orange money', 'paydunya', 'regler', 'facture', 'recu'])) {
    return `💳 Paiement sécurisé via PayDunya :\n\n• Wave\n• Orange Money\n• Free Money\n• Cartes Visa / Mastercard\n• Virement bancaire\n• Paiement à la livraison\n\nL'argent ne transite pas par FresCoop — il va directement du client au producteur. Commission transparente 2%. Reçu automatique dans "Mon espace → Paiement".`;
  }

  // Attestations
  if (has(['attestation', 'certificat', 'document officiel', 'dossier', 'preuve'])) {
    const n = stats.transactions || 0;
    return `📄 Attestations FresCoop — documents officiels signés\n\nChaque attestation contient :\n• Ton identité + période d'activité\n• Volume de transactions (${n} enregistrées)\n• Validation terrain par agent FresCoop\n• QR code de vérification (frescoop.sn/verify)\n• Exportable PDF pour banques et partenaires\n\nDa onglet Attestations ole a ŋ kirim ma (va dans l'onglet Attestations pour voir tes documents).`;
  }

  // Hubs
  if (has(['hub', 'stockage', 'entrepot', 'solaire', 'capacite', 'batterie'])) {
    const h = stats.hubs || 0;
    return `Micro-hubs solaires FresCoop\n\n${h} hubs actifs dans le pilote UEMOA - stockage froid partagé:\n\n- Température contrôlée en temps réel\n- Panneaux solaires + batterie\n- Capacité moyenne 2-3 tonnes\n- Pertes post-récolte réduites de 35%\n\nVision 2027: hubs pilotes dans plusieurs bassins agricoles UEMOA. ODD 8 travail décent + ODD 12 anti-gaspi.`;
  }

  // Impact / UEMOA / ODD
  if (has(['impact', 'uemoa', 'odd', 'femmes', 'productrices', 'inclusion', 'environnement'])) {
    const women = stats.producers || 0;
    return `Impact FresCoop - ODD activés\n\nODD 1: revenus protégés\nODD 5: ${women} productrices actives\nODD 8: accès crédit via bancabilité\nODD 12: anti-gaspi et consommation responsable\n\nCandidat Hackathon Filières Agricoles UEMOA 2026. Onglet Impact -> graphiques avant / après FresCoop.`;
  }

  // Commandes
  if (has(['order', 'commande', 'acheter', 'achat', 'panier', 'livraison', 'statut'])) {
    const n = stats.orders || 0;
    return `🛒 Commandes FresCoop — ${n} au total\n\nCycle d'une commande :\n\n1. Client ajoute au panier depuis le Marché\n2. Validation → commande partagée avec producteur + agent terrain\n3. Paiement sécurisé PayDunya\n4. Statuts : Paiement confirmé → Préparation → Prête → En livraison → Livrée\n5. Reçu PDF automatique\n\nChaque statut déclenche une notification à l'acheteur, au vendeur et à l'agent terrain concerné.`;
  }

  // Aide / support / contact
  if (has(['aide', 'support', 'probleme', 'contact', 'appeler', 'email'])) {
    return `📞 Aide FresCoop — équipe terrain 7j/7 :\n\n📧 support@frescoop.sn\n📞 +221 33 800 00 00\n💬 WhatsApp +221 77 000 00 00\n🤖 Mi (FresCoop AI) — 24/7 e 4 langues (fr, wo, pul, sr)\n\nCentre d'aide complet : Profil → Centre d'aide. FAQ + tutoriels vidéo.`;
  }

  // FresCoop c'est quoi
  if (has(['frescoop', 'c est quoi', 'cest quoi', 'plateforme', 'mission', 'presentation', 'projet'])) {
    return `FresCoop - plateforme agri-fintech pour les filières agricoles UEMOA (2026)\n\n3 briques intégrées:\n\n- Micro-hubs solaires: stockage froid partagé, 35% de pertes en moins\n- Intelligence marché: bon prix, bon acheteur, bon délai\n- Preuve économique portable: historique de ventes -> accès crédit\n\nMission: protéger le revenu des productrices, producteurs et coopératives UEMOA, réduire le gaspillage, sécuriser les paiements et ouvrir l’inclusion financière.`;
  }

  // Fallback honnête : mélange formules sérère + réponse français
  return `Mi yenoh a yaad (je comprends ta question). Le mbaane wallu la e sérère exactement pour ce sujet, donc je te réponds en français pour être utile :\n\nJe suis spécialisé sur FresCoop : njeg (prix), felax (vendre), haat (crédit), anti-gaspi, suivi des lots, paiement PayDunya, attestations, USSD *384*FRES#.\n\nPendol ma (pose-moi une question) plus précise sur un de ces sujets, ou change de langue (français, wolof, pulaar) avec les boutons en haut si tu préfères.`;
}

function buildSystemPrompt(langLabel, context, langCode) {
  const stats = context.stats || {};
  const userRole = context.userRole || 'utilisateur';
  const userName = context.userName || '';

  // Directive de langue stricte selon le code demandé
  const languageDirective = (() => {
    switch (langCode) {
      case 'wo':
        return `⚠️ LANGUE OBLIGATOIRE : WOLOF uniquement (Sénégal).
Exemples de mots wolof à utiliser : salamaleekum (bonjour), njëg (prix), jaay (vendre), jënd (acheter), jërëjëf (merci), baax na (c'est bien).
N'utilise JAMAIS le français, le pulaar ni le sérère dans ta réponse.`;
      case 'pul':
        return `⚠️ LANGUE OBLIGATOIRE : PULAAR (Fulfulde) uniquement.
Exemples : mbaa kaa (bonjour), coggu (prix), njeeygol (vendre), a jaaraama (merci), mi faami (j'ai compris).
N'utilise JAMAIS le français, le wolof ni le sérère dans ta réponse.`;
      case 'sr':
        return `⚠️ LANGUE OBLIGATOIRE : SÉRÈRE (Seereer) uniquement.
TRÈS IMPORTANT : le sérère N'EST PAS le wolof. Ce sont deux langues différentes, ne les confonds surtout pas.
Exemples de mots sérère corrects : Nafio (bonjour), Mbaa kaa (salutations), fandu (acheter), hiin (prix), yaad (merci), pendol ma (dis-moi), ma kan (qui es-tu), ɗof (je), wañ (manger), nax (aller), felax / kirim (marchandise).
Si tu ne connais pas la traduction exacte d'un mot en sérère, écris-le en français entre parenthèses plutôt que d'inventer ou d'écrire en wolof.
N'utilise JAMAIS le wolof, le pulaar ni le français dans ta réponse (sauf quelques mots techniques difficilement traduisibles).`;
      case 'fr':
      default:
        return `⚠️ LANGUE OBLIGATOIRE : FRANÇAIS uniquement.`;
    }
  })();

  return `Tu es FresCoop AI, l’assistant intelligent et ADAPTATIF de FresCoop - plateforme agri-fintech créée pour le Hackathon Filières Agricoles UEMOA 2026. Si on te demande ton nom, réponds "Je suis FresCoop AI".

${languageDirective}


TON RÔLE PRINCIPAL :
Tu es un expert AGRI-FIN-TECH qui aide productrices, producteurs, commerçantes, commerçants, acheteurs B2B, transporteurs, agents terrain, partenaires finance et administrateurs.

TES DOMAINES D'EXPERTISE (tu réponds en DÉTAIL et avec SUBSTANCE) :
- **Agriculture sénégalaise et ouest-africaine** : calendrier cultural, variétés locales, techniques, irrigation, rendements par hectare, marchés régionaux, filières (maraîchage, céréales, fruits, élevage, transformation, bissap, arachide, mil, niébé, riz de la vallée, etc.)
- **Commerce agricole UEMOA** : prix, concurrence avec importations, négociation, saisonnalité, stratégie vente B2B vs particuliers
- **Micro-hubs solaires** : fonctionnement chaîne du froid, -35% de pertes post-récolte, dimensionnement panneaux, capacité stockage
- **Intelligence marché FresCoop** : prix, recommandation d'acheteurs, anti-gaspi (alertes DLC, ventes éclair -15/-25/-40%)
- **Bancabilité** : score 0-100, dossier crédit, BNDE, Microcred, SFD, preuve économique portable, historique de ventes
- **Traçabilité** : QR codes, photos qualité, température, lots, chaîne de garde
- **Paiement** : paiement partenaire interopérable, PayDunya, Wave, Orange Money, Free Money, cartes, virements, mobile money
- **USSD** : *384*FRES# pour téléphones 2G sans Internet
- **Attestations** : document officiel avec QR et signature, exportable PDF pour les banques
- **ODD** : 1 pauvreté, 5 genre, 8 travail décent, 12 anti-gaspi

CONTEXTE ACTUEL DE LA PLATEFORME :
- Productrices et producteurs actifs : ${stats.producers || 0}
- Produits publiés : ${stats.products || 0}
- Commandes totales : ${stats.orders || 0}
- Lots tracés : ${stats.lots || 0}
- Micro-hubs solaires : ${stats.hubs || 0}
- Transactions enregistrées : ${stats.transactions || 0}

UTILISATEUR ACTUEL :
- Nom : ${userName || 'Utilisateur'}
- Rôle : ${userRole}

REGLES DE REPONSE (IMPORTANT) :
1. ADAPTE-TOI A LA QUESTION : Si on te pose une question imprevue (strategie, chiffres sectoriels, culture locale, conseil business), REPONDS avec ton savoir general. N'envoie JAMAIS l'utilisateur vers un onglet si tu peux repondre directement.
2. NE REPETE PAS LA MEME REPONSE : meme si la question touche les prix, donne une reponse NOUVELLE adaptee au contexte exact.
3. REPONDS COURT : 2-4 phrases pour une question simple, 5-8 phrases maximum pour une question complexe. Jamais de listes a puces, jamais de tableaux.
4. FORMAT TEXTE BRUT OBLIGATOIRE : ecris en texte simple, sans aucun formatage markdown. Pas de ** (gras), pas de *, pas de #, pas de |, pas de tableaux, pas de listes a puces avec - ou *. Ecris des phrases naturelles comme dans une conversation SMS.
5. LANGUE : ${langLabel} UNIQUEMENT. Respecte strictement la directive langue. Ne melange JAMAIS les langues locales.
6. EMOJIS : 0 a 2 maximum.
7. CHIFFRES : utilise les stats du contexte si pertinent, sinon donne des ordres de grandeur réalistes pour les filières UEMOA (prix tomate 500-900 F/kg selon saison, mil 22 000 F/sac de 50kg, etc.).
8. TON : direct, chaleureux, concret. Tu t’adresses à quelqu’un qui a une activité réelle à gérer.
9. REFUS : decline uniquement les questions vraiment hors-sujet (politique partisane, sexe, violence). Sinon tu improvises intelligemment.

EXEMPLES DE QUESTIONS IMPRÉVUES QUE TU DOIS SAVOIR GÉRER :
- "J'ai 50 kg de tomates qui vont pourrir demain, que faire ?"  → conseils anti-gaspi concrets + action immédiate sur FresCoop
- "Est-ce que le prix du riz va baisser en juin ?"  → contexte saisonnier + récoltes vallée fleuve
- "Comment négocier avec un gros acheteur ?"  → 3 conseils pratiques
- "Parle-moi de la sécheresse au Sahel"  → réponse factuelle + lien avec résilience FresCoop
- "Quelle variété de mangue est la mieux pour l'export ?"  → Kent, Keitt, conseils logistique froid
- "Bonjour" → salutation courte personnalisée

N'invente pas de faits précis que tu ne connais pas. Mais utilise ta culture générale agricole/économique/sénégalaise pour donner de la valeur à chaque réponse.`;
}

function callOpenRouter(apiKey, model, messages, options = {}) {
  return new Promise(async (resolve, reject) => {
    try {
      const res = await fetch('https://openrouter.ai/api/v1/chat/completions', {
        method: 'POST',
        headers: {
          'Authorization': `Bearer ${apiKey}`,
          'Content-Type': 'application/json',
          'HTTP-Referer': 'https://frescoop.sn',
          'X-Title': 'FresCoop AI Assistant',
        },
        body: JSON.stringify({
          model,
          messages,
          temperature: options.temperature ?? 0.75,
          max_tokens: options.max_tokens ?? 700,
          top_p: options.top_p ?? 0.9,
        }),
      });
      if (!res.ok) {
        const errText = await res.text();
        reject(new Error(`OpenRouter ${res.status}: ${errText.slice(0, 200)}`));
        return;
      }
      const data = await res.json();
      const answer = data?.choices?.[0]?.message?.content?.trim();
      if (!answer) {
        reject(new Error('Réponse vide'));
        return;
      }
      resolve({ answer, model: data.model || model });
    } catch (err) {
      reject(err);
    }
  });
}

const backupsDir = path.join(dataDir, 'backups');
await mkdir(backupsDir, { recursive: true });

async function handleStore(request, response) {
  if (request.method === 'GET') {
    const store = await readStore();
    sendJson(response, 200, sanitizeStoreForClient(store));
    return;
  }

  if (request.method === 'PUT') {
    const authData = requireAuth(request);
    if (!authData) {
      sendJson(response, 401, { error: 'Non autorisé. Connectez-vous pour modifier les données.' });
      return;
    }
    const storeUrl = new URL(request.url || '/', `http://${request.headers.host}`);
    const forceWrite = storeUrl.searchParams.get('force') === 'true';
    const body = await readBody(request);
    let parsed;
    try {
      parsed = JSON.parse(body || '{}');
    } catch {
      sendJson(response, 400, { error: 'JSON invalide' });
      return;
    }
    if (!parsed || typeof parsed !== 'object' || Array.isArray(parsed)) {
      sendJson(response, 400, { error: 'Le store doit être un objet' });
      return;
    }
    // Validate that known keys are arrays
    for (const key of Object.keys(emptyStore)) {
      if (key in parsed && !Array.isArray(parsed[key])) {
        sendJson(response, 400, { error: `Le champ "${key}" doit être un tableau` });
        return;
      }
    }
    let incoming = normalizeStore(parsed);
    let currentStoreForMerge = null;

    // === PROTECTION ANTI-RÉGRESSION ===
    if (!forceWrite) {
      try {
        const current = await readStore();
        currentStoreForMerge = current;
        const checks = [
          { key: 'users', min: 3 },
          { key: 'products', min: 5 },
          { key: 'orders', min: 2 },
          { key: 'lots', min: 2 },
        ];
        for (const { key, min } of checks) {
          const cur = (current[key] || []).length;
          const next = (incoming[key] || []).length;
          if (cur > min && next < cur * 0.7) {
            console.warn(`[Store] PUT rejected: ${key} would drop from ${cur} to ${next} (-${Math.round((1 - next / cur) * 100)}%). Possible stale client.`);
            sendJson(response, 409, {
              ok: false,
              error: `Sauvegarde refusée : cette opération supprimerait trop de ${key} (${cur} → ${next}). Votre version locale est probablement périmée. Rechargez la page.`,
              code: 'stale_client',
            });
            return;
          }
        }
      } catch {
        // readStore failed, on continue quand même
      }
    }
    if (!currentStoreForMerge) {
      currentStoreForMerge = await readStore().catch(() => null);
    }
    incoming = preservePrivateUserFields(incoming, currentStoreForMerge);

    // === MERGE SERVER-CREATED DATA ===
    // Le client peut ne pas avoir les données créées côté serveur entre son dernier sync et ce PUT.
    // On merge : les entrées serveur absentes du PUT sont préservées.
    if (currentStoreForMerge) {
      const mergeKeys = ['notifications', 'activityProofs'];
      for (const key of mergeKeys) {
        if (Array.isArray(currentStoreForMerge[key])) {
          const incomingIds = new Set((incoming[key] || []).map((item) => item.id));
          const serverOnly = currentStoreForMerge[key].filter((item) => item && item.id && !incomingIds.has(item.id));
          if (serverOnly.length > 0) {
            incoming[key] = [...serverOnly, ...(incoming[key] || [])];
          }
        }
      }
    }

    // === BACKUP ROTATIF ===
    // On garde les 10 dernières versions pour pouvoir restaurer en cas d'incident.
    try {
      const prev = await readFile(dbPath, 'utf8');
      if (prev && prev.length > 100) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await writeFile(path.join(backupsDir, `store-${stamp}.json`), prev, 'utf8');
        // Garder seulement les 10 plus récents
        const fsMod = await import('node:fs/promises');
        const files = (await fsMod.readdir(backupsDir))
          .filter((f) => f.startsWith('store-') && f.endsWith('.json'))
          .sort()
          .reverse();
        for (const old of files.slice(10)) {
          try { await fsMod.unlink(path.join(backupsDir, old)); } catch {}
        }
      }
    } catch {}

    await writeStore(incoming);
    sendJson(response, 200, { ok: true });
    return;
  }

  sendJson(response, 405, { error: 'Method not allowed' });
}

// Endpoint de restauration : GET /api/store/backups liste les backups
// POST /api/store/restore?name=xxx restaure une version précédente
async function handleStoreBackups(request, response) {
  const fsMod = await import('node:fs/promises');
  const url = new URL(request.url || '/', `http://${request.headers.host}`);

  if (request.method === 'GET' && url.pathname.endsWith('/backups')) {
    const files = (await fsMod.readdir(backupsDir).catch(() => []))
      .filter((f) => f.startsWith('store-') && f.endsWith('.json'))
      .sort()
      .reverse();
    const list = await Promise.all(
      files.map(async (name) => {
        const full = path.join(backupsDir, name);
        const info = await stat(full);
        const content = JSON.parse(await readFile(full, 'utf8'));
        return {
          name,
          size: info.size,
          mtime: info.mtime,
          counts: {
            users: (content.users || []).length,
            products: (content.products || []).length,
            orders: (content.orders || []).length,
            lots: (content.lots || []).length,
          },
        };
      }),
    );
    sendJson(response, 200, { ok: true, backups: list });
    return;
  }

  if (request.method === 'POST' && url.pathname.endsWith('/restore')) {
    const name = url.searchParams.get('name');
    if (!name || !/^store-[\w\-T:.]+\.json$/.test(name)) {
      sendJson(response, 400, { error: 'Nom de backup invalide' });
      return;
    }
    const src = path.join(backupsDir, name);
    try {
      const content = await readFile(src, 'utf8');
      // On sauvegarde d'abord la version actuelle
      const current = await readFile(dbPath, 'utf8').catch(() => '');
      if (current) {
        const stamp = new Date().toISOString().replace(/[:.]/g, '-');
        await writeFile(path.join(backupsDir, `store-pre-restore-${stamp}.json`), current, 'utf8');
      }
      // Puis on restaure
      await writeFile(dbPath, content, 'utf8');
      const restored = JSON.parse(content);
      sendJson(response, 200, {
        ok: true,
        restored: name,
        counts: {
          users: (restored.users || []).length,
          products: (restored.products || []).length,
          orders: (restored.orders || []).length,
        },
      });
    } catch (err) {
      sendJson(response, 500, { error: err.message || 'Erreur restauration' });
    }
    return;
  }

  sendJson(response, 404, { error: 'Endpoint backup inconnu' });
}

async function serveStatic(request, response) {
  const url = new URL(request.url || '/', `http://${request.headers.host}`);
  const decoded = decodeURIComponent(url.pathname).replace(/^\/+/, '');
  let filePath = path.resolve(distDir, decoded);

  // Path traversal protection: ensure resolved path stays within distDir
  if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
    response.writeHead(403, { 'Content-Type': 'text/plain' });
    response.end('Forbidden');
    return;
  }

  try {
    const info = await stat(filePath);
    if (info.isDirectory()) filePath = path.join(filePath, 'index.html');
  } catch {
    filePath = path.join(distDir, 'index.html');
  }

  // Double-check after fallback
  if (!filePath.startsWith(distDir + path.sep) && filePath !== distDir) {
    response.writeHead(403, { 'Content-Type': 'text/plain' });
    response.end('Forbidden');
    return;
  }

  const ext = path.extname(filePath);
  response.writeHead(200, { 'Content-Type': mimeTypes[ext] || 'application/octet-stream' });
  createReadStream(filePath).pipe(response);
}

async function ensureDatabase() {
  if (mongoDb) {
    const col = mongoDb.collection('store');
    const doc = await col.findOne({ _id: 'main' });
    if (!doc) {
      const initial = await createInitialStore();
      await col.insertOne({ _id: 'main', ...initial });
      console.log(`[MongoDB] Store initial cree (${useDemoSeedData ? 'avec' : 'sans'} donnees demo)`);
    }
    return;
  }
  try {
    const existing = await readFile(dbPath, 'utf8');
    const parsed = JSON.parse(existing || '{}');
    if (useDemoSeedData && (!parsed.products || parsed.products.length === 0)) {
      const initial = await createInitialStore();
      await writeFile(dbPath, JSON.stringify(initial, null, 2), 'utf8');
      console.log('[Store] Donnees demo pre-chargees (store etait vide)');
    }
  } catch {
    const initial = await createInitialStore();
    await writeFile(dbPath, JSON.stringify(initial, null, 2), 'utf8');
    console.log(`[Store] Store initial cree (${useDemoSeedData ? 'avec' : 'sans'} donnees demo)`);
  }
}

async function createInitialStore() {
  if (useDemoSeedData) {
    return loadSeedDataIfAvailable();
  }
  return normalizeStore({});
}

async function loadSeedDataIfAvailable() {
  const seedPath = path.join(__dirname, 'seed-data.json');
  try {
    const raw = await readFile(seedPath, 'utf8');
    const data = JSON.parse(raw);
    return { ...emptyStore, ...data, users: [...emptyStore.users, ...(data.users || []).filter((u) => !emptyStore.users.some((s) => s.email === u.email))] };
  } catch {
    return emptyStore;
  }
}

async function readStore() {
  if (mongoDb) {
    const doc = await mongoDb.collection('store').findOne({ _id: 'main' });
    if (!doc) return normalizeStore({});
    const { _id, ...data } = doc;
    return normalizeStore(data);
  }
  try {
    const raw = await readFile(dbPath, 'utf8');
    const parsed = normalizeStore(JSON.parse(raw || '{}'));
    memoryStoreCache = parsed;
    return parsed;
  } catch {
    if (memoryStoreCache) return memoryStoreCache;
    return normalizeStore({});
  }
}

async function writeStore(data) {
  memoryStoreCache = data;
  if (mongoDb) {
    await mongoDb.collection('store').replaceOne({ _id: 'main' }, { _id: 'main', ...data }, { upsert: true });
    return;
  }
  try {
    const tmpPath = dbPath + '.tmp.' + Date.now();
    await writeFile(tmpPath, JSON.stringify(data, null, 2), 'utf8');
    await rename(tmpPath, dbPath);
  } catch (err) {
    console.error('[Store] Erreur écriture fichier (données gardées en mémoire):', err.message);
  }
}

function normalizeStore(value) {
  const store = Object.fromEntries(Object.keys(emptyStore).map((key) => [key, Array.isArray(value?.[key]) ? value[key] : []]));
  store.users = ensureSeedAdmin(store.users);
  store.orders = dedupeOrders(store.orders);
  store.notifications = normalizeNotifications(store.notifications);
  return store;
}

function preservePrivateUserFields(incoming, current) {
  if (!Array.isArray(incoming?.users)) return incoming;
  if (!current || !Array.isArray(current?.users)) return incoming;
  const currentById = new Map(current.users.map((user) => [user.id, user]));
  const currentByEmail = new Map(current.users.map((user) => [String(user.email || '').trim().toLowerCase(), user]));
  return {
    ...incoming,
    users: incoming.users.map((user) => {
      if (!user || typeof user !== 'object') return user;
      const previous = currentById.get(user.id) || currentByEmail.get(String(user.email || '').trim().toLowerCase());
      if (!previous) return user;
      // Always preserve existing passwordHash from DB - never let client overwrite with empty
      if (previous.passwordHash && !user.passwordHash) {
        return { ...user, passwordHash: previous.passwordHash };
      }
      // If client sends a hash (admin creation), keep the client's hash
      return user;
    }),
  };
}

function isAcceptedPasswordHash(user, hash) {
  if (!user || !hash) return false;
  if (hash === user.passwordHash) return true;

  const email = String(user.email || '').trim().toLowerCase();
  const seededAdminEmails = new Set(seededAdmins.map((admin) => admin.email.toLowerCase()));
  const legacyAdminEmails = new Set([
    'richef360@gmail.com',
    'dsenghor96@gmail.com',
    'nyacine183@gmail.com',
    'seydinalimamoulayeyade@gmail.com',
    'diagnealia03@gmail.com',
    'manediop945@gmail.com',
  ]);

  if ((seededAdminEmails.has(email) || legacyAdminEmails.has(email))
    && [seededAdminPasswordHash, seededDemoPasswordHash, mobileDemoPasswordHash].includes(hash)) {
    return true;
  }

  if ((email === seededDemoUser.email || user.id === seededDemoUser.id) && [seededDemoPasswordHash, mobileDemoPasswordHash].includes(hash)) {
    return true;
  }

  return false;
}

function dedupeOrders(orders) {
  const seen = new Set();
  return (Array.isArray(orders) ? orders : []).filter((order) => {
    if (!order || typeof order !== 'object') return false;
    const key = getOrderDuplicateKey(order);
    if (seen.has(key)) return false;
    seen.add(key);
    return true;
  });
}

function getOrderDuplicateKey(order) {
  const quantity = Number(order.quantity || 0);
  const unitPrice = Number(order.unitPrice ?? order.productSnapshot?.price ?? 0);
  const totalPrice = Number(order.totalPrice ?? quantity * unitPrice);
  return [
    String(order.createdAt || order.updatedAt || '').slice(0, 10),
    order.productId || normalizeText(order.productSnapshot?.name),
    order.sellerId || '',
    order.clientId || '',
    quantity,
    order.unit || order.productSnapshot?.unit || '',
    unitPrice,
    totalPrice,
    order.status || '',
    order.paymentStatus || '',
    normalizeText(order.message || ''),
  ].join('|');
}

function normalizeText(value) {
  return String(value || '')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .trim()
    .toLowerCase();
}

function normalizeNotifications(items) {
  return (Array.isArray(items) ? items : []).map((item) => (
    item && typeof item === 'object'
      ? {
          ...item,
          read: Boolean(item.read || item.readAt),
          title: sanitizeNotificationText(item.title),
          body: sanitizeNotificationText(item.body),
        }
      : item
  )).filter(Boolean);
}

function sanitizeNotificationText(value) {
  return String(value || '')
    .replace(/Statut\s*(?:\u2192|\u00e2\u2020\u2019|\uFFFD+)\s*/g, 'Statut: ')
    .replace(/Confirm\uFFFD+e/g, 'Confirm\u00e9e')
    .replace(/annul\uFFFD+e/g, 'annul\u00e9e')
    .replace(/pay\uFFFD+\(s\)/g, 'paye(s)')
    .replace(/pr\uFFFD+parer/g, 'preparer');
}

function ensureSeedAdmin(users) {
  let result = [...users];
  for (const admin of seededAdmins) {
    const email = admin.email.toLowerCase();
    const exists = result.some((u) => String(u?.email || '').trim().toLowerCase() === email);
    if (!exists) {
      result = [admin, ...result];
    } else {
      result = result.map((u) =>
        String(u?.email || '').trim().toLowerCase() === email
          ? { ...u, role: 'admin', status: 'Actif', passwordHash: admin.passwordHash }
          : u
      );
    }
  }
  const demoExists = result.some((u) => u.id === seededDemoUser.id || String(u?.email || '').trim().toLowerCase() === seededDemoUser.email);
  if (!demoExists) {
    result = [...result, seededDemoUser];
  }
  return result;
}

function readBody(request) {
  return new Promise((resolve, reject) => {
    let body = '';
    request.on('data', (chunk) => {
      body += chunk;
      if (body.length > 18 * 1024 * 1024) {
        request.destroy();
        reject(new Error('Payload too large'));
      }
    });
    request.on('end', () => resolve(body));
    request.on('error', reject);
  });
}

function sendJson(response, statusCode, payload) {
  response.writeHead(statusCode, {
    'Content-Type': 'application/json;charset=utf-8',
    'Cache-Control': 'no-store',
  });
  response.end(JSON.stringify(payload));
}

async function loadEnvFile(filePath) {
  try {
    const raw = await readFile(filePath, 'utf8');
    raw.split(/\r?\n/).forEach((line) => {
      const trimmed = line.trim();
      if (!trimmed || trimmed.startsWith('#')) return;
      const eq = trimmed.indexOf('=');
      if (eq === -1) return;
      const key = trimmed.slice(0, eq).trim();
      let value = trimmed.slice(eq + 1).trim();
      if ((value.startsWith('"') && value.endsWith('"')) || (value.startsWith("'") && value.endsWith("'"))) {
        value = value.slice(1, -1);
      }
      if (!(key in process.env)) process.env[key] = value;
    });
  } catch {
    // .env optional
  }
}

function isEnabledEnv(value) {
  return ['1', 'true', 'yes', 'on'].includes(String(value || '').trim().toLowerCase());
}

function readSeedMode(value) {
  const mode = String(value || '').trim().toLowerCase();
  if (!mode || mode === 'auto') return '';
  if (['demo', 'seed', 'true', '1', 'yes', 'on'].includes(mode)) return 'demo';
  if (['none', 'empty', 'false', '0', 'no', 'off'].includes(mode)) return 'none';
  console.warn(`[Config] FRESCOOP_SEED_MODE="${mode}" inconnu; mode auto utilise.`);
  return '';
}
