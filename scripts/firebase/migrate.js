import { existsSync } from 'node:fs';
import path from 'node:path';
import { countSnapshot, firebaseContext, readSqliteSnapshot, tableCollections, writeBackup } from './common.js';

const apply = process.argv.includes('--apply');

function docId(table, row) {
  if (row.id !== undefined && row.id !== null) {
    return String(row.id);
  }

  if (row.notification_key) {
    return row.notification_key.replace(/[/?#[\]]/g, '_');
  }

  return Buffer.from(JSON.stringify(row)).toString('base64url').slice(0, 120);
}

function normalizeRow(row) {
  return Object.fromEntries(
    Object.entries(row).map(([key, value]) => [key, value === undefined ? null : value]),
  );
}

async function commitInBatches(db, collection, rows, table) {
  let batch = db.batch();
  let pending = 0;
  let written = 0;

  for (const row of rows) {
    const ref = db.collection(collection).doc(docId(table, row));
    batch.set(
      ref,
      {
        ...normalizeRow(row),
        legacyTable: table,
        migratedAt: new Date().toISOString(),
      },
      { merge: true },
    );
    pending += 1;
    written += 1;

    if (pending >= 450) {
      await batch.commit();
      batch = db.batch();
      pending = 0;
    }
  }

  if (pending) {
    await batch.commit();
  }

  return written;
}

async function uploadPhotos(bucket, rows) {
  if (!bucket) {
    return { skipped: rows.length, uploaded: 0 };
  }

  let uploaded = 0;
  let skipped = 0;

  for (const row of rows) {
    if (!row.storage_path || !existsSync(row.storage_path)) {
      skipped += 1;
      continue;
    }

    const destination = `anexos/catracas/${row.turnstile_id}/${path.basename(row.storage_path)}`;
    await bucket.upload(row.storage_path, {
      destination,
      metadata: {
        contentType: row.mime_type || 'image/jpeg',
        metadata: {
          legacyPhotoId: String(row.id),
          originalName: row.original_name || row.file_name || '',
        },
      },
    });
    uploaded += 1;
  }

  return { uploaded, skipped };
}

const snapshot = readSqliteSnapshot();
const backupPath = writeBackup(snapshot);

console.log(`Backup pre-migracao criado em: ${backupPath}`);
console.table(countSnapshot(snapshot));

if (!apply) {
  console.log('Dry-run concluido. Execute com --apply para gravar no Firebase.');
  process.exit(0);
}

const { db, bucket } = await firebaseContext();
const report = {};

for (const [table, collection] of tableCollections) {
  const rows = snapshot[table] || [];
  report[collection] = await commitInBatches(db, collection, rows, table);
}

report.storage = await uploadPhotos(bucket, snapshot.turnstile_photos || []);
await db.collection('relatorios').doc(`migracao-${Date.now()}`).set({
  type: 'sql-to-firebase',
  createdAt: new Date().toISOString(),
  backupPath,
  counts: countSnapshot(snapshot),
  report,
});

console.log('Migracao concluida.');
console.table(report);
