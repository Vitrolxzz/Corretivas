import 'dotenv/config';
import crypto from 'node:crypto';
import path from 'node:path';
import readXlsxFile from 'read-excel-file/node';
import { closePool, query } from '../server/db.js';
import { migrate } from '../server/migrate.js';

const defaultExcelPath =
  process.env.EXCEL_PATH || 'C:\\Users\\Vittor\\OneDrive\\ASSIST TECNICA\\CORRETIVAS 2026 ATUAL.xlsx';

const workbookPath = process.argv[2] ? path.resolve(process.argv[2]) : defaultExcelPath;
const targetYear = Number(process.env.IMPORT_YEAR || process.argv[3] || 2026);

function cleanText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).replace(/\s+/g, ' ').trim();
}

function toIsoDateFromParts(day, month, year) {
  const fullYear = year < 100 ? 2000 + year : year;
  const date = new Date(Date.UTC(fullYear, month - 1, day));

  if (
    date.getUTCFullYear() !== fullYear ||
    date.getUTCMonth() !== month - 1 ||
    date.getUTCDate() !== day
  ) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function parseExcelSerialDate(value) {
  if (!Number.isFinite(value)) {
    return null;
  }

  const utcMilliseconds = Math.round((value - 25569) * 86_400 * 1000);
  const date = new Date(utcMilliseconds);

  if (Number.isNaN(date.getTime())) {
    return null;
  }

  return date.toISOString().slice(0, 10);
}

function parseDate(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  if (value instanceof Date && !Number.isNaN(value.getTime())) {
    return value.toISOString().slice(0, 10);
  }

  if (typeof value === 'number') {
    return parseExcelSerialDate(value);
  }

  const text = cleanText(value);

  if (!text) {
    return null;
  }

  const iso = text.match(/\b(\d{4})-(\d{2})-(\d{2})\b/);
  if (iso) {
    return `${iso[1]}-${iso[2]}-${iso[3]}`;
  }

  const br = text.match(/\b(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})\b/);
  if (br) {
    return toIsoDateFromParts(Number(br[1]), Number(br[2]), Number(br[3]));
  }

  const numeric = Number(text);
  if (Number.isFinite(numeric) && numeric > 20_000) {
    return parseExcelSerialDate(numeric);
  }

  return null;
}

function normalizeHealth(value) {
  const text = cleanText(value).toLowerCase();

  if (text === 'ok' || text === 'sim' || text === 's') {
    return 'Ok';
  }

  return 'Nulo';
}

function normalizeDifficulty(value) {
  const number = Number(cleanText(value));

  if (Number.isInteger(number) && number >= 1 && number <= 5) {
    return number;
  }

  return null;
}

function hashRecord(record) {
  return crypto
    .createHash('sha256')
    .update(JSON.stringify(record))
    .digest('hex');
}

async function getOrCreatePeriod(year) {
  const active = await query(`SELECT id FROM periods WHERE status = 'active' LIMIT 1`);
  const status = active.rows[0] ? 'closed' : 'active';
  const result = await query(
    `INSERT INTO periods (year, status, started_at)
     VALUES ($1, $2, $3)
     ON CONFLICT (year) DO UPDATE SET year = EXCLUDED.year
     RETURNING *`,
    [year, status, `${year}-01-01`],
  );

  return result.rows[0];
}

function rowToRecord(row) {
  return {
    occurrenceDate: parseDate(row[0]),
    client: cleanText(row[1]),
    contact: cleanText(row[2]),
    requesterName: cleanText(row[3]),
    reason: cleanText(row[4]),
    resolution: cleanText(row[5]),
    difficulty: normalizeDifficulty(row[6]),
    technician: cleanText(row[7]),
    backupStatus: normalizeHealth(row[8]),
    firewallStatus: normalizeHealth(row[9]),
    powerOptionsStatus: normalizeHealth(row[10]),
    solutionDate: parseDate(row[12]),
  };
}

async function importWorkbook() {
  await migrate();

  const sheets = await readXlsxFile(workbookPath);
  const worksheet = sheets.find((sheet) => sheet.sheet.toLowerCase().includes('corretiva'));

  if (!worksheet) {
    throw new Error('Nao encontrei uma aba de corretivas na planilha.');
  }

  const period = await getOrCreatePeriod(targetYear);
  let inserted = 0;
  let skipped = 0;

  for (const row of worksheet.data.slice(3)) {
    const record = rowToRecord(row);

    if (!record.client && !record.reason && !record.resolution) {
      skipped += 1;
      continue;
    }

    const sourceHash = hashRecord(record);
    const result = await query(
      `INSERT INTO corrective_occurrences (
        period_id, occurrence_date, client, contact, requester_name, reason, resolution,
        difficulty, technician, backup_status, firewall_status, power_options_status,
        solution_date, source_hash
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13, $14)
      ON CONFLICT (period_id, source_hash) DO NOTHING
      RETURNING id`,
      [
        period.id,
        record.occurrenceDate,
        record.client,
        record.contact,
        record.requesterName,
        record.reason,
        record.resolution,
        record.difficulty,
        record.technician,
        record.backupStatus,
        record.firewallStatus,
        record.powerOptionsStatus,
        record.solutionDate,
        sourceHash,
      ],
    );

    if (result.rows[0]) {
      inserted += 1;
    } else {
      skipped += 1;
    }
  }

  return { sheetName: worksheet.sheet, periodYear: period.year, inserted, skipped };
}

importWorkbook()
  .then(async (result) => {
    console.log(
      `Importacao concluida: ${result.inserted} registros inseridos, ${result.skipped} ignorados, aba "${result.sheetName}", periodo ${result.periodYear}.`,
    );
    await closePool();
  })
  .catch(async (error) => {
    console.error('Falha ao importar planilha.');
    console.error(error);
    await closePool();
    process.exitCode = 1;
  });
