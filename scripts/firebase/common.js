import 'dotenv/config';
import { copyFileSync, cpSync, existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DatabaseSync } from 'node:sqlite';
import { firestore, firebaseStorageBucket, initializeFirebase } from '../../server/firebase.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
export const rootDir = path.resolve(__dirname, '..', '..');
export const dataDir = path.resolve(process.env.DATA_DIR || path.join(rootDir, 'data'));
export const sqlitePath = path.resolve(process.env.SQLITE_PATH || path.join(dataDir, 'corretivas.sqlite'));
export const backupDir = path.resolve(process.env.BACKUP_DIR || path.join(rootDir, 'backups'));

export const tableCollections = [
  ['periods', 'periodos'],
  ['clients', 'clientes'],
  ['technicians', 'tecnicos'],
  ['corrective_occurrences', 'ocorrencias'],
  ['appointments', 'agendamentos'],
  ['command_registrations', 'comandas'],
  ['turnstiles', 'catracas'],
  ['turnstile_photos', 'anexos'],
  ['appointment_photos', 'anexos_agendamentos'],
  ['notification_reads', 'notificacoes_lidas'],
  ['fcm_tokens', 'fcm_tokens'],
  ['audit_logs', 'auditoria'],
  ['system_logs', 'logs'],
];

export function timestamp() {
  return new Date().toISOString().replace(/[:.]/g, '-');
}

export function openDatabase(file = sqlitePath) {
  return new DatabaseSync(file);
}

export function readSqliteSnapshot(file = sqlitePath) {
  if (!existsSync(file)) {
    throw new Error(`Banco SQLite nao encontrado: ${file}`);
  }

  const db = openDatabase(file);
  const snapshot = {};

  try {
    for (const [table] of tableCollections) {
      const exists = db
        .prepare(`SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?`)
        .get(table);
      snapshot[table] = exists ? db.prepare(`SELECT * FROM ${table}`).all() : [];
    }
  } finally {
    db.close();
  }

  return snapshot;
}

export function writeBackup(snapshot = readSqliteSnapshot()) {
  mkdirSync(backupDir, { recursive: true });
  const targetDir = path.join(backupDir, `corretivas-${timestamp()}`);
  mkdirSync(targetDir, { recursive: true });
  const jsonPath = path.join(targetDir, 'sqlite-snapshot.json');
  writeFileSync(
    jsonPath,
    JSON.stringify(
      {
        createdAt: new Date().toISOString(),
        sqlitePath,
        tables: snapshot,
      },
      null,
      2,
    ),
  );

  if (existsSync(sqlitePath)) {
    copyFileSync(sqlitePath, path.join(targetDir, 'corretivas.sqlite'));
  }

  const uploadsPath = path.join(dataDir, 'uploads');
  if (existsSync(uploadsPath)) {
    cpSync(uploadsPath, path.join(targetDir, 'uploads'), { recursive: true });
  }

  return targetDir;
}

export function restoreSqliteBackup(backupPath, targetFile = sqlitePath) {
  const backupSqlite = path.join(backupPath, 'corretivas.sqlite');

  if (!existsSync(backupSqlite)) {
    throw new Error(`Backup SQLite nao encontrado: ${backupSqlite}`);
  }

  mkdirSync(path.dirname(targetFile), { recursive: true });
  copyFileSync(backupSqlite, targetFile);
  const backupUploads = path.join(backupPath, 'uploads');

  if (existsSync(backupUploads)) {
    const targetUploads = path.join(path.dirname(targetFile), 'uploads');
    rmSync(targetUploads, { recursive: true, force: true });
    cpSync(backupUploads, targetUploads, { recursive: true });
  }
}

export function loadBackupJson(backupPath) {
  const jsonPath = path.join(backupPath, 'sqlite-snapshot.json');

  if (!existsSync(jsonPath)) {
    throw new Error(`Snapshot nao encontrado: ${jsonPath}`);
  }

  return JSON.parse(readFileSync(jsonPath, 'utf8'));
}

export async function firebaseContext() {
  initializeFirebase();
  const db = firestore();

  if (!db) {
    throw new Error('Firebase nao configurado. Defina FIREBASE_PROJECT_ID e credenciais de service account.');
  }

  return {
    db,
    bucket: firebaseStorageBucket(),
  };
}

export function countSnapshot(snapshot) {
  return Object.fromEntries(tableCollections.map(([table]) => [table, snapshot[table]?.length || 0]));
}
