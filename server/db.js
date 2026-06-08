import 'dotenv/config';
import { mkdirSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, 'data'));

mkdirSync(dataDir, { recursive: true });

export const databasePath = path.resolve(process.env.SQLITE_PATH || path.join(dataDir, 'corretivas.sqlite'));
export const db = new DatabaseSync(databasePath);

db.exec(`
  PRAGMA foreign_keys = ON;
  PRAGMA journal_mode = WAL;
  PRAGMA synchronous = NORMAL;
  PRAGMA temp_store = MEMORY;
  PRAGMA busy_timeout = 5000;
`);

function paramsForSql(params) {
  if (!Array.isArray(params)) {
    return params;
  }

  return Object.fromEntries(params.map((value, index) => [String(index + 1), value]));
}

export function getDefaultYear() {
  return Number(process.env.DEFAULT_YEAR || new Date().getFullYear());
}

export async function query(text, params = []) {
  const values = paramsForSql(params);
  const statement = db.prepare(text);
  const rows = Array.isArray(params) && params.length === 0 ? statement.all() : statement.all(values);

  return {
    rows: rows.map((row) => ({ ...row })),
    rowCount: rows.length,
  };
}

export async function exec(text) {
  db.exec(text);
}

export async function withTransaction(callback) {
  const client = {
    query,
  };

  db.exec('BEGIN IMMEDIATE');

  try {
    const result = await callback(client);
    db.exec('COMMIT');
    return result;
  } catch (error) {
    db.exec('ROLLBACK');
    throw error;
  }
}

export async function closePool() {
  db.close();
}
