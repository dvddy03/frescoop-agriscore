import { createHash, randomBytes, timingSafeEqual } from 'node:crypto';

export function createToken(userId, role, secret, expiryMs = 7 * 24 * 60 * 60 * 1000) {
  const payload = JSON.stringify({ uid: userId, role, exp: Date.now() + expiryMs });
  const sig = createHash('sha256').update(payload + secret).digest('hex');
  return Buffer.from(payload).toString('base64url') + '.' + sig;
}

export function verifyToken(token, secret) {
  if (!token || typeof token !== 'string') return null;
  const dot = token.lastIndexOf('.');
  if (dot === -1) return null;
  const payloadB64 = token.slice(0, dot);
  const sig = token.slice(dot + 1);
  let payload;
  try {
    payload = Buffer.from(payloadB64, 'base64url').toString('utf8');
  } catch { return null; }
  const expected = createHash('sha256').update(payload + secret).digest('hex');
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

export function normalizeStore(value, emptyStore) {
  const store = Object.fromEntries(Object.keys(emptyStore).map((key) => [key, Array.isArray(value?.[key]) ? value[key] : []]));
  return store;
}

export function dedupeOrders(orders) {
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
    .replace(/[̀-ͯ]/g, '')
    .trim()
    .toLowerCase();
}

export function preservePrivateUserFields(incoming, current) {
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
      if (previous.passwordHash && !user.passwordHash) {
        return { ...user, passwordHash: previous.passwordHash };
      }
      return user;
    }),
  };
}

export function checkRateLimit(buckets, ip, isAuthEndpoint = false, windowMs = 60000, maxRequests = 120, authMax = 10) {
  const now = Date.now();
  const key = isAuthEndpoint ? `auth:${ip}` : ip;
  const max = isAuthEndpoint ? authMax : maxRequests;
  let bucket = buckets.get(key);
  if (!bucket || now - bucket.start > windowMs) {
    bucket = { start: now, count: 0 };
    buckets.set(key, bucket);
  }
  bucket.count++;
  return bucket.count <= max;
}
