import { countSnapshot, readSqliteSnapshot, writeBackup } from './common.js';

const snapshot = readSqliteSnapshot();
const targetDir = writeBackup(snapshot);

console.log(`Backup criado em: ${targetDir}`);
console.table(countSnapshot(snapshot));
