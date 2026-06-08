import { countSnapshot, firebaseContext, readSqliteSnapshot, tableCollections } from './common.js';

const requireFirebase = process.argv.includes('--firebase');
const snapshot = readSqliteSnapshot();
const sqliteCounts = countSnapshot(snapshot);
const report = { sqlite: sqliteCounts, firebase: null, inconsistencies: [] };

if (requireFirebase) {
  const { db } = await firebaseContext();
  const firebaseCounts = {};

  for (const [table, collection] of tableCollections) {
    const snapshotCount = await db.collection(collection).count().get();
    firebaseCounts[table] = snapshotCount.data().count;

    if (firebaseCounts[table] < sqliteCounts[table]) {
      report.inconsistencies.push({
        table,
        collection,
        sqlite: sqliteCounts[table],
        firebase: firebaseCounts[table],
        message: 'Firebase possui menos registros que o SQLite.',
      });
    }
  }

  report.firebase = firebaseCounts;
}

console.log(JSON.stringify(report, null, 2));

if (report.inconsistencies.length) {
  process.exitCode = 1;
}
