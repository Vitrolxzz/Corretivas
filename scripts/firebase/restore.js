import path from 'node:path';
import { restoreSqliteBackup, rootDir } from './common.js';

const backupPath = process.argv[2] ? path.resolve(process.argv[2]) : '';

if (!backupPath) {
  console.error('Informe a pasta do backup. Exemplo: node scripts/firebase/restore.js backups/corretivas-AAAA');
  process.exit(1);
}

restoreSqliteBackup(backupPath);
console.log(`Backup restaurado a partir de: ${backupPath}`);
console.log(`Projeto: ${rootDir}`);
