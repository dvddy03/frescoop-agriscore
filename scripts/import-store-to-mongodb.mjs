import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { MongoClient } from 'mongodb';

const __dirname = path.dirname(fileURLToPath(import.meta.url));
const rootDir = path.resolve(__dirname, '..');
const defaultStorePath = path.join(rootDir, 'server', 'data', 'store.json');

await loadEnvFile(path.join(rootDir, '.env'));

if (process.argv.includes('--help') || process.argv.includes('-h')) {
  console.log('Usage: npm run migrate:atlas -- [path/to/store.json]');
  console.log('Requires MONGODB_URI, optional MONGODB_DB. Defaults to server/data/store.json.');
  process.exit(0);
}

const mongoUri = String(process.env.MONGODB_URI || '').trim();
if (!mongoUri) {
  console.error('MONGODB_URI est requis pour importer vers MongoDB Atlas.');
  process.exit(1);
}

const storePath = path.resolve(rootDir, process.argv[2] || defaultStorePath);
const raw = await readFile(storePath, 'utf8');
const store = JSON.parse(raw || '{}');
if (!store || typeof store !== 'object' || Array.isArray(store)) {
  console.error(`Store invalide: ${storePath}`);
  process.exit(1);
}

const client = new MongoClient(mongoUri);
try {
  await client.connect();
  const db = client.db(process.env.MONGODB_DB || 'frescoop');
  await db.collection('store').replaceOne(
    { _id: 'main' },
    { _id: 'main', ...store },
    { upsert: true },
  );
  console.log(`Store importe dans MongoDB Atlas depuis ${storePath}`);
} finally {
  await client.close();
}

async function loadEnvFile(filePath) {
  try {
    const rawEnv = await readFile(filePath, 'utf8');
    rawEnv.split(/\r?\n/).forEach((line) => {
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
