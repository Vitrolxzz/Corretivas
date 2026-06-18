import 'dotenv/config';
import express from 'express';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { Readable } from 'node:stream';
import sharp from 'sharp';
import { normalizeClientName } from './clientNames.js';
import { closePool, query, withTransaction } from './db.js';
import { buildDashboardReport } from './dashboardReports.js';
import { initializeFirebase } from './firebase.js';
import { migrate } from './migrate.js';
import { buildAppointmentScheduledNotification, sendAppointmentScheduledNotification } from './notifications.js';
import { createV1Router } from './v1/router.js';

const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..');
const distDir = path.join(rootDir, 'dist');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(rootDir, 'data');
const uploadDir = path.join(dataDir, 'uploads');
const legacyUploadDir = path.join(rootDir, 'data', 'uploads');
const apkDownloadUrl =
  process.env.APK_DOWNLOAD_URL || 'https://github.com/Vitrolxzz/Corretivas/releases/latest/download/Corretivas.apk';

const app = express();
const port = Number(process.env.PORT || 3001);
const sseClients = new Set();
app.locals.v1Events = new Set();

const defaultAllowedOrigins = [
  'http://localhost:5173',
  'http://localhost:3001',
  'https://corretivas.up.railway.app',
  'https://corretivas-a1d3d.web.app',
  'https://corretivas-a1d3d.firebaseapp.com',
  'https://corretivas-1b.web.app',
  'https://corretivas-1b.firebaseapp.com',
  'https://corretivas-5e7d7.web.app',
  'https://corretivas-5e7d7.firebaseapp.com',
];
const allowedOrigins = new Set(
  (process.env.CORS_ORIGINS || defaultAllowedOrigins.join(','))
    .split(',')
    .map((origin) => origin.trim())
    .filter(Boolean),
);

const healthOptions = new Set(['Ok', 'Nulo']);
const appointmentStatuses = new Set(['agendada', 'realizada', 'cancelada']);
const appointmentVisitTypes = new Set(['normal', 'garantia', 'retorno']);
const turnstileStatuses = new Set(['Aguardando montagem', 'Em andamento', 'Agendada', 'Finalizada', 'Entregue']);
const caseSituations = new Set(['com problema', 'em observação', 'em testes', 'ok']);

mkdirSync(uploadDir, { recursive: true });

app.use((req, res, next) => {
  const origin = req.get('origin');

  if (origin && allowedOrigins.has(origin)) {
    res.setHeader('Access-Control-Allow-Origin', origin);
    res.setHeader('Vary', 'Origin');
    res.setHeader('Access-Control-Allow-Credentials', 'true');
    res.setHeader('Access-Control-Allow-Headers', 'Content-Type, Authorization, X-Corretivas-Mobile, X-Operator-Name, X-Device-Id, X-FCM-Token');
    res.setHeader('Access-Control-Allow-Methods', 'GET, POST, PUT, PATCH, DELETE, OPTIONS');
  }

  if (req.method === 'OPTIONS') {
    res.status(204).end();
    return;
  }

  next();
});

app.use(express.json({ limit: '25mb' }));
app.use('/api/uploads', express.static(uploadDir));
if (legacyUploadDir !== uploadDir && existsSync(legacyUploadDir)) {
  app.use('/api/uploads', express.static(legacyUploadDir));
}

function basicHealthPayload() {
  return {
    ok: true,
    service: 'corretivas',
    backend: process.env.DATA_BACKEND || 'sqlite',
    uptime: Math.round(process.uptime()),
  };
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function serveApkDownload(req, res) {
  const upstream = await fetch(apkDownloadUrl, {
    method: req.method === 'HEAD' ? 'HEAD' : 'GET',
    redirect: 'follow',
  });

  if (!upstream.ok) {
    const error = new Error('Nao foi possivel baixar o APK.');
    error.status = upstream.status || 502;
    throw error;
  }

  const contentLength = upstream.headers.get('content-length');

  res.setHeader('Content-Type', 'application/vnd.android.package-archive');
  res.setHeader('Content-Disposition', 'attachment; filename="Corretivas.apk"');
  res.setHeader('Cache-Control', 'no-store');

  if (contentLength) {
    res.setHeader('Content-Length', contentLength);
  }

  if (req.method === 'HEAD') {
    res.status(200).end();
    return;
  }

  if (!upstream.body) {
    res.status(200).end();
    return;
  }

  Readable.fromWeb(upstream.body).pipe(res);
}

app.get(['/Corretivas.apk', '/download/Corretivas.apk', '/downloads/Corretivas.apk'], asyncRoute(serveApkDownload));
app.head(['/Corretivas.apk', '/download/Corretivas.apk', '/downloads/Corretivas.apk'], asyncRoute(serveApkDownload));

function requestOrigin(req) {
  const forwardedProto = String(req.get('x-forwarded-proto') || '').split(',')[0].trim();
  const forwardedHost = String(req.get('x-forwarded-host') || '').split(',')[0].trim();
  const proto = forwardedProto || req.protocol || 'http';
  const host = forwardedHost || req.get('host') || '';

  return host ? `${proto}://${host}` : '';
}

function publicPhotoUrl(req, publicPath) {
  const text = String(publicPath || '').trim();

  if (!text || /^https?:\/\//i.test(text) || text.startsWith('gs://')) {
    return text;
  }

  if (text.startsWith('/')) {
    return `${requestOrigin(req)}${text}`;
  }

  return text;
}

function addPublicPhotoUrl(req, record) {
  return {
    ...record,
    publicUrl: publicPhotoUrl(req, record.publicPath),
  };
}

function cleanText(value) {
  if (value === null || value === undefined) {
    return '';
  }

  return String(value).trim();
}

function removeStoredPhotoFile(storagePath) {
  const text = cleanText(storagePath);

  if (!text || text.startsWith('gs://')) {
    return;
  }

  const filePath = path.resolve(text);
  const allowedRoots = [uploadDir, legacyUploadDir].map((dir) => path.resolve(dir));
  const isUploadFile = allowedRoots.some((dir) => filePath === dir || filePath.startsWith(`${dir}${path.sep}`));

  if (!isUploadFile) {
    return;
  }

  try {
    if (existsSync(filePath)) {
      unlinkSync(filePath);
    }
  } catch (error) {
    console.warn(`Nao foi possivel apagar anexo ${filePath}: ${error.message}`);
  }
}

function cleanClientName(value) {
  return normalizeClientName(cleanText(value));
}

function normalizeTechnicianName(value) {
  const text = cleanText(value);

  if (text.toLocaleLowerCase('pt-BR') === 'vittor') {
    return 'Vittor';
  }

  return text;
}

function cleanDate(value) {
  const text = cleanText(value);

  if (!text) {
    return null;
  }

  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})$/);
  if (isoMatch) {
    return `${isoMatch[1]}-${isoMatch[2]}-${isoMatch[3]}`;
  }

  const brMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
  }

  const brShortMatch = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (brShortMatch) {
    return `${new Date().getFullYear()}-${brShortMatch[2].padStart(2, '0')}-${brShortMatch[1].padStart(2, '0')}`;
  }

  if (!/^\d{4}-\d{2}-\d{2}$/.test(text)) {
    const error = new Error('Data invalida. Use o formato AAAA-MM-DD.');
    error.status = 400;
    throw error;
  }

  return text;
}

function cleanDifficulty(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const number = Number(value);
  if (!Number.isInteger(number) || number < 1 || number > 5) {
    const error = new Error('Dificuldade deve ser um numero de 1 a 5.');
    error.status = 400;
    throw error;
  }

  return number;
}

function cleanHealthStatus(value) {
  const normalized = cleanText(value) || 'Nulo';

  if (!healthOptions.has(normalized)) {
    const error = new Error('Status deve ser Ok ou Nulo.');
    error.status = 400;
    throw error;
  }

  return normalized;
}

function cleanCaseSituation(value) {
  const normalized = cleanText(value) || 'com problema';

  if (!caseSituations.has(normalized)) {
    const error = new Error('Situacao de monitoramento invalida.');
    error.status = 400;
    throw error;
  }

  return normalized;
}

function cleanMoney(value) {
  if (value === null || value === undefined || value === '') {
    return 0;
  }

  const normalized = String(value).replace(',', '.');
  const number = Number(normalized);

  if (!Number.isFinite(number) || number < 0) {
    const error = new Error('Valor invalido.');
    error.status = 400;
    throw error;
  }

  return Math.round(number * 100) / 100;
}

function cleanAppointmentStatus(value) {
  const normalized = cleanText(value) || 'agendada';

  if (!appointmentStatuses.has(normalized)) {
    const error = new Error('Status de agendamento invalido.');
    error.status = 400;
    throw error;
  }

  return normalized;
}

function cleanAppointmentVisitType(value) {
  const normalized = cleanText(value).toLowerCase();

  if (!normalized) {
    return '';
  }

  if (!appointmentVisitTypes.has(normalized)) {
    const error = new Error('Tipo de visita invalido. Use normal, garantia ou retorno.');
    error.status = 400;
    throw error;
  }

  return normalized;
}

function cleanTurnstileStatus(value) {
  const normalized = cleanText(value) || 'Aguardando montagem';

  if (!turnstileStatuses.has(normalized)) {
    const error = new Error('Status de catraca invalido.');
    error.status = 400;
    throw error;
  }

  return normalized;
}

function limitFromQuery(value, fallback = 50) {
  const parsed = Number(value || fallback);

  if (!Number.isFinite(parsed)) {
    return fallback;
  }

  return Math.min(200, Math.max(10, Math.trunc(parsed)));
}

function pageFromQuery(value) {
  const parsed = Number(value || 1);

  if (!Number.isFinite(parsed)) {
    return 1;
  }

  return Math.max(1, Math.trunc(parsed));
}

function dateToJson(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  const text = String(value).trim();
  const brMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})$/);
  if (brMatch) {
    return `${brMatch[3]}-${brMatch[2].padStart(2, '0')}-${brMatch[1].padStart(2, '0')}`;
  }

  const brShortMatch = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (brShortMatch) {
    return `${new Date().getFullYear()}-${brShortMatch[2].padStart(2, '0')}-${brShortMatch[1].padStart(2, '0')}`;
  }

  return text.slice(0, 10);
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysText(dateText, amount) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function currentMonthRange() {
  const now = new Date();
  const start = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
  const end = new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth() + 1, 1));

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    label: start.toISOString().slice(0, 7),
  };
}

function monthRange(month) {
  const text = cleanText(month) || currentMonthRange().label;

  if (!/^\d{4}-\d{2}$/.test(text)) {
    const error = new Error('Mes invalido. Use o formato AAAA-MM.');
    error.status = 400;
    throw error;
  }

  const [year, monthNumber] = text.split('-').map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));

  return {
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
    label: text,
  };
}

function dateFiltersFromQuery(queryParams) {
  const startDate = cleanDate(queryParams.startDate || queryParams.from || queryParams.date);
  const endDate = cleanDate(queryParams.endDate || queryParams.to || queryParams.date);

  return { startDate, endDate };
}

function likeParam(value) {
  return `%${cleanText(value)}%`;
}

function periodToJson(row) {
  return {
    id: Number(row.id),
    year: Number(row.year),
    status: row.status,
    startedAt: dateToJson(row.started_at),
    closedAt: row.closed_at ? new Date(row.closed_at).toISOString() : null,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function correctiveToJson(row) {
  return {
    id: Number(row.id),
    periodId: Number(row.period_id),
    occurrenceDate: dateToJson(row.occurrence_date),
    client: row.client,
    contact: row.contact,
    requesterName: row.requester_name,
    reason: row.reason,
    resolution: row.resolution,
    difficulty: row.difficulty === null ? null : Number(row.difficulty),
    technician: row.technician,
    backupStatus: row.backup_status,
    firewallStatus: row.firewall_status,
    powerOptionsStatus: row.power_options_status,
    solutionDate: dateToJson(row.solution_date),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function caseToJson(row) {
  return {
    id: Number(row.id),
    clientName: row.client_name,
    startDate: dateToJson(row.start_date),
    situation: row.situation,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function commandToJson(row) {
  return {
    id: Number(row.id),
    periodId: Number(row.period_id),
    bakery: row.bakery,
    dmConf: row.dm_conf,
    dmCad: row.dm_cad,
    dmImp: row.dm_imp,
    exactaRegistrar: row.exacta_registrar,
    clientRegistrar: row.client_registrar,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function appointmentToJson(row) {
  return {
    id: Number(row.id),
    clientName: row.client_name,
    address: row.address,
    reportedProblem: row.reported_problem,
    notes: row.notes,
    annotations: row.annotations,
    visitType: row.visit_type,
    visitDate: dateToJson(row.visit_date),
    technician: row.technician,
    visitValue: Number(row.visit_value || 0),
    partsValue: Number(row.parts_value || 0),
    status: row.status,
    conflictCount: Number(row.conflict_count || 0),
    photoCount: Number(row.photo_count || 0),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function turnstileDueStatus(row) {
  if (row.status === 'Entregue') {
    return 'completed';
  }

  const due = dateToJson(row.expected_delivery_date);

  if (!due) {
    return 'normal';
  }

  const today = todayText();

  if (due < today) {
    return 'overdue';
  }

  if (due <= addDaysText(today, 3)) {
    return 'soon';
  }

  return 'normal';
}

function turnstileToJson(row) {
  return {
    id: Number(row.id),
    clientName: row.client_name,
    model: row.model,
    clientAddress: row.client_address,
    expectedDeliveryDate: dateToJson(row.expected_delivery_date),
    notes: row.notes,
    status: row.status,
    dueStatus: turnstileDueStatus(row),
    photoCount: Number(row.photo_count || 0),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function systemNoteToJson(row) {
  return {
    id: Number(row.id),
    title: row.title,
    content: row.content,
    createdBy: row.created_by,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function companyToJson(row) {
  return {
    id: Number(row.id),
    name: row.name,
    cnpj: row.cnpj,
    systemName: row.system_name,
    xml: row.xml,
    ip: row.ip,
    port: row.port,
    turnstileType: row.turnstile_type,
    anydesk: row.anydesk,
    notes: row.notes,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function turnstilePhotoToJson(row) {
  return {
    id: Number(row.id),
    turnstileId: Number(row.turnstile_id),
    fileName: row.file_name,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    originalSizeBytes: Number(row.original_size_bytes || 0),
    optimizedWidth: row.optimized_width === null || row.optimized_width === undefined ? null : Number(row.optimized_width),
    optimizedHeight: row.optimized_height === null || row.optimized_height === undefined ? null : Number(row.optimized_height),
    publicPath: row.public_path,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function appointmentPhotoToJson(row) {
  return {
    id: Number(row.id),
    appointmentId: Number(row.appointment_id),
    fileName: row.file_name,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    originalSizeBytes: Number(row.original_size_bytes || 0),
    optimizedWidth: row.optimized_width === null || row.optimized_width === undefined ? null : Number(row.optimized_width),
    optimizedHeight: row.optimized_height === null || row.optimized_height === undefined ? null : Number(row.optimized_height),
    publicPath: row.public_path,
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function correctivePayload(body) {
  return {
    occurrenceDate: cleanDate(body.occurrenceDate),
    client: cleanClientName(body.client),
    contact: cleanText(body.contact),
    requesterName: cleanText(body.requesterName),
    reason: cleanText(body.reason),
    resolution: cleanText(body.resolution),
    difficulty: cleanDifficulty(body.difficulty),
    technician: normalizeTechnicianName(body.technician),
    backupStatus: cleanHealthStatus(body.backupStatus),
    firewallStatus: cleanHealthStatus(body.firewallStatus),
    powerOptionsStatus: cleanHealthStatus(body.powerOptionsStatus),
    solutionDate: cleanDate(body.solutionDate),
  };
}

function casePayload(body) {
  return {
    clientName: cleanClientName(body.clientName),
    startDate: cleanDate(body.startDate),
    situation: cleanCaseSituation(body.situation),
  };
}

function commandPayload(body) {
  return {
    bakery: cleanClientName(body.bakery),
    dmConf: cleanText(body.dmConf),
    dmCad: cleanText(body.dmCad),
    dmImp: cleanText(body.dmImp),
    exactaRegistrar: normalizeTechnicianName(body.exactaRegistrar),
    clientRegistrar: normalizeTechnicianName(body.clientRegistrar),
  };
}

function appointmentPayload(body) {
  return {
    clientName: cleanClientName(body.clientName),
    address: cleanText(body.address),
    reportedProblem: cleanText(body.reportedProblem),
    notes: cleanText(body.notes),
    annotations: cleanText(body.annotations),
    visitType: cleanAppointmentVisitType(body.visitType),
    visitDate: cleanDate(body.visitDate),
    technician: normalizeTechnicianName(body.technician),
    visitValue: cleanMoney(body.visitValue),
    partsValue: cleanMoney(body.partsValue),
    status: cleanAppointmentStatus(body.status),
  };
}

function turnstilePayload(body) {
  return {
    clientName: cleanClientName(body.clientName),
    model: cleanText(body.model),
    clientAddress: cleanText(body.clientAddress),
    expectedDeliveryDate: cleanDate(body.expectedDeliveryDate),
    notes: cleanText(body.notes),
    status: cleanTurnstileStatus(body.status),
  };
}

function systemNotePayload(body) {
  const title = cleanText(body.title);
  const content = cleanText(body.content);

  if (!title && !content) {
    const error = new Error('Informe um titulo ou uma anotacao.');
    error.status = 400;
    throw error;
  }

  return {
    title,
    content,
    createdBy: cleanText(body.createdBy) || 'Sistema web',
  };
}

function cleanCompanyXml(value) {
  const normalized = cleanText(value).toLocaleLowerCase('pt-BR');

  if (!normalized || normalized === 'nao') {
    return 'não';
  }

  if (normalized === 'sim' || normalized === 'não') {
    return normalized;
  }

  const error = new Error('XML invalido. Use sim ou não.');
  error.status = 400;
  throw error;
}

function companyPayload(body) {
  return {
    name: cleanText(body.name),
    cnpj: cleanText(body.cnpj),
    systemName: cleanText(body.systemName),
    xml: cleanCompanyXml(body.xml),
    ip: cleanText(body.ip),
    port: cleanText(body.port),
    turnstileType: cleanText(body.turnstileType),
    anydesk: cleanText(body.anydesk),
    notes: cleanText(body.notes),
  };
}

function appointmentVisitTypeSummaryFromRow(row) {
  const total = Number(row?.total || 0);
  const garantia = Number(row?.garantia || 0);
  const retorno = Number(row?.retorno || 0);
  const average = (value) => (total ? Math.round((Number(value || 0) / total) * 100) : 0);

  return {
    total,
    garantia: {
      total: garantia,
      average: average(garantia),
    },
    retorno: {
      total: retorno,
      average: average(retorno),
    },
  };
}

function appointmentVisitTypeChartFromRow(row) {
  const total = Number(row?.total || 0);
  const normal = Number(row?.normal || 0);
  const garantia = Number(row?.garantia || 0);
  const retorno = Number(row?.retorno || 0);
  const semTipo = Math.max(0, total - normal - garantia - retorno);
  const percent = (value) => (total ? Math.round((Number(value || 0) / total) * 100) : 0);

  return [
    { label: 'Normal', value: normal, percent: percent(normal) },
    { label: 'Garantia', value: garantia, percent: percent(garantia) },
    { label: 'Retorno', value: retorno, percent: percent(retorno) },
    { label: 'Sem tipo', value: semTipo, percent: percent(semTipo) },
  ].filter((rowItem) => rowItem.value > 0);
}

async function optimizeImage(buffer) {
  const image = sharp(buffer, { failOn: 'warning' }).rotate();
  const optimized = await image
    .resize({
      width: 1600,
      height: 1600,
      fit: 'inside',
      withoutEnlargement: true,
    })
    .jpeg({
      quality: 82,
      mozjpeg: true,
    })
    .toBuffer({ resolveWithObject: true });

  return {
    buffer: optimized.data,
    mimeType: 'image/jpeg',
    extension: '.jpg',
    width: optimized.info.width,
    height: optimized.info.height,
  };
}

function broadcast(payload) {
  const message = `event: change\ndata: ${JSON.stringify(payload)}\n\n`;

  for (const client of sseClients) {
    client.write(message);
  }

  for (const listener of app.locals.v1Events) {
    listener(payload);
  }
}

function valueFromColumn(row, column) {
  const source = column[1];
  return typeof source === 'function' ? source(row) : row[source];
}

function escapeCsv(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return `"${text.replaceAll('"', '""')}"`;
}

function escapeHtml(value) {
  const text = value === null || value === undefined ? '' : String(value);
  return text
    .replaceAll('&', '&amp;')
    .replaceAll('<', '&lt;')
    .replaceAll('>', '&gt;')
    .replaceAll('"', '&quot;')
    .replaceAll("'", '&#39;');
}

function sendCsv(res, filename, columns, rows) {
  const csv = [
    columns.map(([label]) => escapeCsv(label)).join(';'),
    ...rows.map((row) => columns.map((column) => escapeCsv(valueFromColumn(row, column))).join(';')),
  ].join('\n');

  res.setHeader('Content-Type', 'text/csv; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.csv"`);
  res.send(`\ufeff${csv}`);
}

function sendExcel(res, filename, title, columns, rows) {
  const tableHead = columns.map(([label]) => `<th>${escapeHtml(label)}</th>`).join('');
  const tableRows = rows
    .map(
      (row) =>
        `<tr>${columns.map((column) => `<td>${escapeHtml(valueFromColumn(row, column))}</td>`).join('')}</tr>`,
    )
    .join('');
  const html = `<!doctype html>
<html>
<head><meta charset="utf-8"><title>${escapeHtml(title)}</title></head>
<body>
<h1>${escapeHtml(title)}</h1>
<table border="1">
<thead><tr>${tableHead}</tr></thead>
<tbody>${tableRows}</tbody>
</table>
</body>
</html>`;

  res.setHeader('Content-Type', 'application/vnd.ms-excel; charset=utf-8');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.xls"`);
  res.send(`\ufeff${html}`);
}

function pdfSafe(value) {
  return String(value === null || value === undefined ? '' : value)
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/[^\x20-\x7E]/g, ' ');
}

function pdfEscape(value) {
  return pdfSafe(value).replaceAll('\\', '\\\\').replaceAll('(', '\\(').replaceAll(')', '\\)');
}

function wrapLine(text, size = 96) {
  const clean = pdfSafe(text);
  const lines = [];

  for (let index = 0; index < clean.length; index += size) {
    lines.push(clean.slice(index, index + size));
  }

  return lines.length ? lines : [''];
}

function buildPdf(title, lines) {
  const pageLines = [];
  let current = [];

  for (const line of lines) {
    for (const wrapped of wrapLine(line)) {
      current.push(wrapped);

      if (current.length >= 38) {
        pageLines.push(current);
        current = [];
      }
    }
  }

  if (current.length || !pageLines.length) {
    pageLines.push(current);
  }

  const objects = [];
  const addObject = (body) => {
    objects.push(body);
    return objects.length;
  };

  const catalogId = addObject('');
  const pagesId = addObject('');
  const fontId = addObject('<< /Type /Font /Subtype /Type1 /BaseFont /Helvetica >>');
  const pageIds = [];

  for (const linesForPage of pageLines) {
    const content = [
      'BT',
      '/F1 15 Tf',
      '40 800 Td',
      `(${pdfEscape(title)}) Tj`,
      '/F1 9 Tf',
      '0 -24 Td',
      ...linesForPage.flatMap((line) => [`(${pdfEscape(line)}) Tj`, '0 -14 Td']),
      'ET',
    ].join('\n');
    const contentId = addObject(`<< /Length ${Buffer.byteLength(content, 'latin1')} >>\nstream\n${content}\nendstream`);
    const pageId = addObject(
      `<< /Type /Page /Parent ${pagesId} 0 R /MediaBox [0 0 595 842] /Resources << /Font << /F1 ${fontId} 0 R >> >> /Contents ${contentId} 0 R >>`,
    );
    pageIds.push(pageId);
  }

  objects[catalogId - 1] = `<< /Type /Catalog /Pages ${pagesId} 0 R >>`;
  objects[pagesId - 1] = `<< /Type /Pages /Kids [${pageIds.map((id) => `${id} 0 R`).join(' ')}] /Count ${pageIds.length} >>`;

  let pdf = '%PDF-1.4\n';
  const offsets = [0];

  objects.forEach((body, index) => {
    offsets.push(Buffer.byteLength(pdf, 'latin1'));
    pdf += `${index + 1} 0 obj\n${body}\nendobj\n`;
  });

  const xrefOffset = Buffer.byteLength(pdf, 'latin1');
  pdf += `xref\n0 ${objects.length + 1}\n0000000000 65535 f \n`;
  for (let index = 1; index <= objects.length; index += 1) {
    pdf += `${String(offsets[index]).padStart(10, '0')} 00000 n \n`;
  }
  pdf += `trailer\n<< /Size ${objects.length + 1} /Root ${catalogId} 0 R >>\nstartxref\n${xrefOffset}\n%%EOF`;

  return Buffer.from(pdf, 'latin1');
}

function sendPdf(res, filename, title, columns, rows) {
  const lines = rows.map((row) =>
    columns
      .map(([label, source]) => `${label}: ${valueFromColumn(row, [label, source]) ?? ''}`)
      .join(' | '),
  );

  res.setHeader('Content-Type', 'application/pdf');
  res.setHeader('Content-Disposition', `attachment; filename="${filename}.pdf"`);
  res.send(buildPdf(title, lines));
}

function sendTableExport(res, format, filename, title, columns, rows) {
  if (format === 'pdf') {
    sendPdf(res, filename, title, columns, rows);
    return;
  }

  if (format === 'xls' || format === 'xlsx' || format === 'excel') {
    sendExcel(res, filename, title, columns, rows);
    return;
  }

  sendCsv(res, filename, columns, rows);
}

function formatCurrency(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

async function getActivePeriod(client = { query }) {
  const { rows } = await client.query(
    `SELECT * FROM periods WHERE status = 'active' ORDER BY year DESC LIMIT 1`,
  );

  return rows[0] || null;
}

async function getPeriodByIdOrActive(periodId) {
  if (periodId) {
    const { rows } = await query('SELECT * FROM periods WHERE id = $1', [Number(periodId)]);
    return rows[0] || null;
  }

  return getActivePeriod();
}

async function requireWritablePeriod(periodId) {
  const period = await getPeriodByIdOrActive(periodId);

  if (!period) {
    const error = new Error('Periodo nao encontrado.');
    error.status = 404;
    throw error;
  }

  if (period.status !== 'active') {
    const error = new Error('Este periodo esta encerrado e pode ser apenas consultado.');
    error.status = 409;
    throw error;
  }

  return period;
}

async function ensureRecordPeriodIsWritable(table, id) {
  const { rows } = await query(
    `SELECT p.status
     FROM ${table} item
     INNER JOIN periods p ON p.id = item.period_id
     WHERE item.id = $1`,
    [Number(id)],
  );

  if (!rows[0]) {
    const error = new Error('Registro nao encontrado.');
    error.status = 404;
    throw error;
  }

  if (rows[0].status !== 'active') {
    const error = new Error('Este registro pertence a um periodo encerrado.');
    error.status = 409;
    throw error;
  }
}

app.get(
  '/api/health',
  asyncRoute(async (_req, res) => {
    const db = await query(`SELECT datetime('now') AS now`);
    const active = await getActivePeriod();
    res.json({
      ...basicHealthPayload(),
      databaseTime: db.rows[0].now,
      activePeriod: active && periodToJson(active),
    });
  }),
);

app.get('/health', (_req, res) => {
  res.json(basicHealthPayload());
});

app.get('/api/events', (req, res) => {
  res.writeHead(200, {
    'Content-Type': 'text/event-stream',
    'Cache-Control': 'no-cache, no-transform',
    Connection: 'keep-alive',
    'X-Accel-Buffering': 'no',
  });

  res.write(`event: ready\ndata: ${JSON.stringify({ ok: true })}\n\n`);
  sseClients.add(res);

  req.on('close', () => {
    sseClients.delete(res);
  });
});

setInterval(() => {
  for (const client of sseClients) {
    client.write(`event: ping\ndata: ${Date.now()}\n\n`);
  }
}, 25_000).unref();

initializeFirebase();
app.use('/api/v1', createV1Router({ broadcast }));

app.get(
  '/api/periods',
  asyncRoute(async (_req, res) => {
    const { rows } = await query('SELECT * FROM periods ORDER BY year DESC');
    res.json({ periods: rows.map(periodToJson) });
  }),
);

app.get(
  '/api/periods/active',
  asyncRoute(async (_req, res) => {
    const period = await getActivePeriod();
    res.json({ period: period && periodToJson(period) });
  }),
);

app.post(
  '/api/periods/close',
  asyncRoute(async (req, res) => {
    const nextYear = Number(req.body?.nextYear);

    const result = await withTransaction(async (client) => {
      const activeResult = await client.query(
        `SELECT * FROM periods WHERE status = 'active' ORDER BY year DESC LIMIT 1`,
      );
      const active = activeResult.rows[0];

      if (!active) {
        const error = new Error('Nenhum periodo ativo encontrado.');
        error.status = 404;
        throw error;
      }

      const targetYear = Number.isInteger(nextYear) && nextYear > active.year ? nextYear : active.year + 1;
      const existing = await client.query('SELECT id FROM periods WHERE year = $1', [targetYear]);

      if (existing.rows[0]) {
        const error = new Error(`O periodo ${targetYear} ja existe.`);
        error.status = 409;
        throw error;
      }

      await client.query(`UPDATE periods SET status = 'closed', closed_at = datetime('now') WHERE id = $1`, [
        active.id,
      ]);

      const created = await client.query(
        `INSERT INTO periods (year, status, started_at)
         VALUES ($1, 'active', $2)
         RETURNING *`,
        [targetYear, `${targetYear}-01-01`],
      );

      return { closed: active, active: created.rows[0] };
    });

    broadcast({ table: 'periods', action: 'closed', activePeriodId: Number(result.active.id) });
    res.status(201).json({
      closed: periodToJson({ ...result.closed, status: 'closed', closed_at: new Date() }),
      active: periodToJson(result.active),
    });
  }),
);

app.get(
  '/api/dashboard',
  asyncRoute(async (req, res) => {
    const period = await getPeriodByIdOrActive(req.query.periodId);

    if (!period) {
      res.json({ stats: null });
      return;
    }

    const month = currentMonthRange();
    const today = todayText();
    const soon = addDaysText(today, 3);

    const [
      correctives,
      commands,
      monitors,
      todayAppointments,
      upcomingAppointments,
      openCorrectives,
      completedCorrectivesMonth,
      appointmentsMonth,
      pendingTurnstiles,
      dueSoonTurnstiles,
      turnstileStatus,
      attendanceByClient,
      monthlyActivity,
      visitTypeShare,
    ] = await Promise.all([
      query('SELECT COUNT(*) AS total FROM corrective_occurrences WHERE period_id = $1', [period.id]),
      query('SELECT COUNT(*) AS total FROM command_registrations WHERE period_id = $1', [period.id]),
      query(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN situation = 'com problema' THEN 1 ELSE 0 END) AS problem,
          SUM(CASE WHEN situation = 'em observação' THEN 1 ELSE 0 END) AS watching,
          SUM(CASE WHEN situation = 'em testes' THEN 1 ELSE 0 END) AS testing,
          SUM(CASE WHEN situation = 'ok' THEN 1 ELSE 0 END) AS ok
         FROM case_monitors`,
      ),
      query(`SELECT COUNT(*) AS total FROM appointments WHERE visit_date = $1 AND status <> 'cancelada'`, [today]),
      query(
        `SELECT *, 0 AS conflict_count
         FROM appointments
         WHERE visit_date >= $1 AND status <> 'cancelada'
         ORDER BY visit_date ASC, id ASC
         LIMIT 8`,
        [today],
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM corrective_occurrences
         WHERE period_id = $1 AND (solution_date IS NULL OR solution_date = '')`,
        [period.id],
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM corrective_occurrences
         WHERE period_id = $1 AND solution_date >= $2 AND solution_date < $3`,
        [period.id, month.start, month.end],
      ),
      query(
        `SELECT COUNT(*) AS total, COALESCE(SUM(visit_value), 0) AS visit_total, COALESCE(SUM(parts_value), 0) AS parts_total
         FROM appointments
         WHERE status = 'realizada' AND visit_date >= $1 AND visit_date < $2`,
        [month.start, month.end],
      ),
      query(`SELECT COUNT(*) AS total FROM turnstiles WHERE status <> 'Entregue'`),
      query(
        `SELECT COUNT(*) AS total
         FROM turnstiles
         WHERE status <> 'Entregue'
           AND expected_delivery_date IS NOT NULL
           AND expected_delivery_date >= $1
           AND expected_delivery_date <= $2`,
        [today, soon],
      ),
      query(
        `SELECT status, COUNT(*) AS total
         FROM turnstiles
         GROUP BY status
         ORDER BY total DESC`,
      ),
      query(
        `SELECT client, SUM(total) AS total
         FROM (
           SELECT client AS client, COUNT(*) AS total
           FROM corrective_occurrences
           WHERE period_id = $1 AND solution_date >= $2 AND solution_date < $3 AND client <> ''
           GROUP BY client
           UNION ALL
           SELECT client_name AS client, COUNT(*) AS total
           FROM appointments
           WHERE status = 'realizada' AND visit_date >= $2 AND visit_date < $3 AND client_name <> ''
           GROUP BY client_name
         )
         GROUP BY client
         ORDER BY total DESC, client ASC
         LIMIT 10`,
        [period.id, month.start, month.end],
      ),
      query(
        `SELECT month, SUM(correctives) AS correctives, SUM(appointments) AS appointments
         FROM (
           SELECT substr(COALESCE(solution_date, occurrence_date), 1, 7) AS month, COUNT(*) AS correctives, 0 AS appointments
           FROM corrective_occurrences
           WHERE period_id = $1 AND COALESCE(solution_date, occurrence_date) IS NOT NULL
           GROUP BY substr(COALESCE(solution_date, occurrence_date), 1, 7)
           UNION ALL
           SELECT substr(visit_date, 1, 7) AS month, 0 AS correctives, COUNT(*) AS appointments
           FROM appointments
           WHERE status <> 'cancelada' AND visit_date IS NOT NULL
           GROUP BY substr(visit_date, 1, 7)
         )
         WHERE month IS NOT NULL AND month <> ''
         GROUP BY month
         ORDER BY month DESC
         LIMIT 6`,
        [period.id],
      ),
      query(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN visit_type = 'normal' THEN 1 ELSE 0 END) AS normal,
          SUM(CASE WHEN visit_type = 'garantia' THEN 1 ELSE 0 END) AS garantia,
          SUM(CASE WHEN visit_type = 'retorno' THEN 1 ELSE 0 END) AS retorno
         FROM appointments`,
      ),
    ]);

    const completedInMonth = Number(completedCorrectivesMonth.rows[0].total || 0);
    const appointmentsDone = Number(appointmentsMonth.rows[0].total || 0);

    res.json({
      period: periodToJson(period),
      stats: {
        correctives: Number(correctives.rows[0].total || 0),
        commands: Number(commands.rows[0].total || 0),
        monitors: monitors.rows[0],
        todayAppointments: Number(todayAppointments.rows[0].total || 0),
        upcomingAppointments: upcomingAppointments.rows.length,
        openCorrectives: Number(openCorrectives.rows[0].total || 0),
        completedCorrectivesMonth: completedInMonth,
        pendingTurnstiles: Number(pendingTurnstiles.rows[0].total || 0),
        dueSoonTurnstiles: Number(dueSoonTurnstiles.rows[0].total || 0),
        attendancesMonth: completedInMonth + appointmentsDone,
        visitsMonth: appointmentsDone,
        visitValueMonth: Number(appointmentsMonth.rows[0].visit_total || 0),
        partsValueMonth: Number(appointmentsMonth.rows[0].parts_total || 0),
      },
      lists: {
        upcomingAppointments: upcomingAppointments.rows.map(appointmentToJson),
      },
      charts: {
        turnstileStatus: turnstileStatus.rows.map((row) => ({ label: row.status, value: Number(row.total || 0) })),
        attendanceByClient: attendanceByClient.rows.map((row) => ({
          label: row.client,
          value: Number(row.total || 0),
          percent:
            completedInMonth + appointmentsDone
              ? Math.round((Number(row.total || 0) / (completedInMonth + appointmentsDone)) * 1000) / 10
              : 0,
        })),
        monthlyActivity: monthlyActivity.rows
          .map((row) => ({
            label: row.month,
            correctives: Number(row.correctives || 0),
            appointments: Number(row.appointments || 0),
          }))
          .reverse(),
        visitTypeShare: appointmentVisitTypeChartFromRow(visitTypeShare.rows[0]),
      },
    });
  }),
);

app.get(
  '/api/dashboard/report',
  asyncRoute(async (req, res) => {
    const report = await buildDashboardReport(req.query.metric, {
      periodId: req.query.periodId,
    });

    res.json(report);
  }),
);

app.get(
  '/api/notes',
  asyncRoute(async (req, res) => {
    const page = pageFromQuery(req.query.page);
    const limit = limitFromQuery(req.query.limit);
    const offset = (page - 1) * limit;
    const params = [];
    const whereParts = [];
    const search = cleanText(req.query.search);

    if (search) {
      params.push(likeParam(search));
      whereParts.push(`(
        title LIKE $${params.length} COLLATE NOCASE
        OR content LIKE $${params.length} COLLATE NOCASE
        OR created_by LIKE $${params.length} COLLATE NOCASE
      )`);
    }

    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const total = await query(`SELECT COUNT(*) AS total FROM system_notes ${where}`, params);
    const { rows } = await query(
      `SELECT *
       FROM system_notes
       ${where}
       ORDER BY updated_at DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    res.json({
      records: rows.map(systemNoteToJson),
      total: Number(total.rows[0].total || 0),
      page,
      limit,
    });
  }),
);

app.post(
  '/api/notes',
  asyncRoute(async (req, res) => {
    const payload = systemNotePayload(req.body || {});
    const { rows } = await query(
      `INSERT INTO system_notes (title, content, created_by)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [payload.title, payload.content, payload.createdBy],
    );
    const record = systemNoteToJson(rows[0]);
    broadcast({ table: 'system_notes', action: 'created', id: record.id });
    res.status(201).json({ record });
  }),
);

app.get(
  '/api/notes/:id',
  asyncRoute(async (req, res) => {
    const { rows } = await query('SELECT * FROM system_notes WHERE id = $1', [Number(req.params.id)]);

    if (!rows[0]) {
      const error = new Error('Anotacao nao encontrada.');
      error.status = 404;
      throw error;
    }

    res.json({ record: systemNoteToJson(rows[0]) });
  }),
);

app.put(
  '/api/notes/:id',
  asyncRoute(async (req, res) => {
    const current = await query('SELECT * FROM system_notes WHERE id = $1', [Number(req.params.id)]);

    if (!current.rows[0]) {
      const error = new Error('Anotacao nao encontrada.');
      error.status = 404;
      throw error;
    }

    const payload = systemNotePayload({
      ...(req.body || {}),
      createdBy: cleanText(req.body?.createdBy) || current.rows[0].created_by,
    });
    const { rows } = await query(
      `UPDATE system_notes
       SET title = $2,
           content = $3,
           created_by = $4
       WHERE id = $1
       RETURNING *`,
      [Number(req.params.id), payload.title, payload.content, payload.createdBy],
    );

    const record = systemNoteToJson(rows[0]);
    broadcast({ table: 'system_notes', action: 'updated', id: record.id });
    res.json({ record });
  }),
);

app.delete(
  '/api/notes/:id',
  asyncRoute(async (req, res) => {
    await query('DELETE FROM system_notes WHERE id = $1', [Number(req.params.id)]);
    broadcast({ table: 'system_notes', action: 'deleted', id: Number(req.params.id) });
    res.status(204).end();
  }),
);

app.get(
  '/api/companies',
  asyncRoute(async (req, res) => {
    const page = pageFromQuery(req.query.page);
    const limit = limitFromQuery(req.query.limit);
    const offset = (page - 1) * limit;
    const params = [];
    const whereParts = [];
    const search = cleanText(req.query.search);

    if (search) {
      params.push(likeParam(search));
      whereParts.push(`(
        name LIKE $${params.length} COLLATE NOCASE
        OR cnpj LIKE $${params.length} COLLATE NOCASE
      )`);
    }

    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const total = await query(`SELECT COUNT(*) AS total FROM companies ${where}`, params);
    const { rows } = await query(
      `SELECT *
       FROM companies
       ${where}
       ORDER BY name COLLATE NOCASE, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    res.json({
      records: rows.map(companyToJson),
      total: Number(total.rows[0].total || 0),
      page,
      limit,
    });
  }),
);

app.get(
  '/api/companies/:id',
  asyncRoute(async (req, res) => {
    const { rows } = await query('SELECT * FROM companies WHERE id = $1', [Number(req.params.id)]);

    if (!rows[0]) {
      const error = new Error('Empresa nao encontrada.');
      error.status = 404;
      throw error;
    }

    res.json({ record: companyToJson(rows[0]) });
  }),
);

app.post(
  '/api/companies',
  asyncRoute(async (req, res) => {
    const payload = companyPayload(req.body || {});
    const { rows } = await query(
      `INSERT INTO companies (
        name, cnpj, system_name, xml, ip, port, turnstile_type, anydesk, notes
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9)
      RETURNING *`,
      [
        payload.name,
        payload.cnpj,
        payload.systemName,
        payload.xml,
        payload.ip,
        payload.port,
        payload.turnstileType,
        payload.anydesk,
        payload.notes,
      ],
    );
    const record = companyToJson(rows[0]);
    broadcast({ table: 'companies', action: 'created', id: record.id });
    res.status(201).json({ record });
  }),
);

app.put(
  '/api/companies/:id',
  asyncRoute(async (req, res) => {
    const payload = companyPayload(req.body || {});
    const { rows } = await query(
      `UPDATE companies
       SET name = $2,
           cnpj = $3,
           system_name = $4,
           xml = $5,
           ip = $6,
           port = $7,
           turnstile_type = $8,
           anydesk = $9,
           notes = $10
       WHERE id = $1
       RETURNING *`,
      [
        Number(req.params.id),
        payload.name,
        payload.cnpj,
        payload.systemName,
        payload.xml,
        payload.ip,
        payload.port,
        payload.turnstileType,
        payload.anydesk,
        payload.notes,
      ],
    );

    if (!rows[0]) {
      const error = new Error('Empresa nao encontrada.');
      error.status = 404;
      throw error;
    }

    const record = companyToJson(rows[0]);
    broadcast({ table: 'companies', action: 'updated', id: record.id });
    res.json({ record });
  }),
);

app.delete(
  '/api/companies/:id',
  asyncRoute(async (req, res) => {
    await query('DELETE FROM companies WHERE id = $1', [Number(req.params.id)]);
    broadcast({ table: 'companies', action: 'deleted', id: Number(req.params.id) });
    res.status(204).end();
  }),
);

app.get(
  '/api/appointments',
  asyncRoute(async (req, res) => {
    const page = pageFromQuery(req.query.page);
    const limit = limitFromQuery(req.query.limit);
    const offset = (page - 1) * limit;
    const baseParams = [];
    const baseWhereParts = [];
    const search = cleanText(req.query.search);
    const technician = cleanText(req.query.technician);
    const visitType = cleanAppointmentVisitType(req.query.visitType);
    const { startDate, endDate } = dateFiltersFromQuery(req.query);

    if (search) {
      baseParams.push(likeParam(search));
      baseWhereParts.push(`(
        client_name LIKE $${baseParams.length} COLLATE NOCASE
        OR address LIKE $${baseParams.length} COLLATE NOCASE
        OR reported_problem LIKE $${baseParams.length} COLLATE NOCASE
        OR notes LIKE $${baseParams.length} COLLATE NOCASE
        OR annotations LIKE $${baseParams.length} COLLATE NOCASE
        OR technician LIKE $${baseParams.length} COLLATE NOCASE
      )`);
    }

    if (technician) {
      baseParams.push(technician);
      baseWhereParts.push(`technician = $${baseParams.length} COLLATE NOCASE`);
    }

    if (startDate) {
      baseParams.push(startDate);
      baseWhereParts.push(`visit_date >= $${baseParams.length}`);
    }

    if (endDate) {
      baseParams.push(endDate);
      baseWhereParts.push(`visit_date <= $${baseParams.length}`);
    }

    const params = [...baseParams];
    const whereParts = [...baseWhereParts];

    if (visitType) {
      params.push(visitType);
      whereParts.push(`visit_type = $${params.length}`);
    }

    const baseWhere = baseWhereParts.length ? baseWhereParts.join(' AND ') : '1 = 1';
    const where = whereParts.length ? whereParts.join(' AND ') : '1 = 1';
    const [total, typeSummary] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM appointments WHERE ${where}`, params),
      query(
        `SELECT
          COUNT(*) AS total,
          SUM(CASE WHEN visit_type = 'garantia' THEN 1 ELSE 0 END) AS garantia,
          SUM(CASE WHEN visit_type = 'retorno' THEN 1 ELSE 0 END) AS retorno
         FROM appointments
         WHERE ${baseWhere}`,
        baseParams,
      ),
    ]);
    const rows = await query(
      `SELECT appointments.*, 0 AS conflict_count, (
        SELECT COUNT(*) FROM appointment_photos WHERE appointment_id = appointments.id
      ) AS photo_count
       FROM appointments
       WHERE ${where}
       ORDER BY COALESCE(visit_date, '0001-01-01') DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    res.json({
      records: rows.rows.map(appointmentToJson),
      total: Number(total.rows[0].total || 0),
      visitTypeSummary: appointmentVisitTypeSummaryFromRow(typeSummary.rows[0]),
      page,
      limit,
    });
  }),
);

app.get(
  '/api/appointments/photos/:photoId/download',
  asyncRoute(async (req, res) => {
    const { rows } = await query('SELECT * FROM appointment_photos WHERE id = $1', [Number(req.params.photoId)]);

    if (!rows[0]) {
      const error = new Error('Foto nao encontrada.');
      error.status = 404;
      throw error;
    }

    res.download(rows[0].storage_path, rows[0].original_name || rows[0].file_name);
  }),
);

app.delete(
  '/api/appointments/photos/:photoId',
  asyncRoute(async (req, res) => {
    const photoId = Number(req.params.photoId);
    const { rows } = await query('SELECT * FROM appointment_photos WHERE id = $1', [photoId]);

    if (!rows[0]) {
      const error = new Error('Foto nao encontrada.');
      error.status = 404;
      throw error;
    }

    await query('DELETE FROM appointment_photos WHERE id = $1', [photoId]);
    removeStoredPhotoFile(rows[0].storage_path);
    broadcast({ table: 'appointment_photos', action: 'deleted', id: photoId, appointmentId: Number(rows[0].appointment_id) });
    res.status(204).end();
  }),
);

app.get(
  '/api/appointments/:id',
  asyncRoute(async (req, res) => {
    const { rows } = await query(
      `SELECT appointments.*, 0 AS conflict_count, (
        SELECT COUNT(*) FROM appointment_photos WHERE appointment_id = appointments.id
       ) AS photo_count
       FROM appointments
       WHERE id = $1`,
      [Number(req.params.id)],
    );

    if (!rows[0]) {
      const error = new Error('Agendamento nao encontrado.');
      error.status = 404;
      throw error;
    }

    res.json({ record: appointmentToJson(rows[0]) });
  }),
);

app.post(
  '/api/appointments',
  asyncRoute(async (req, res) => {
    const payload = appointmentPayload(req.body);
    const inserted = await query(
      `INSERT INTO appointments (
        client_name, address, reported_problem, notes, annotations, visit_type,
        visit_date, visit_time, technician, visit_value, parts_value, status
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, NULL, $8, $9, $10, $11)
      RETURNING *`,
      [
        payload.clientName,
        payload.address,
        payload.reportedProblem,
        payload.notes,
        payload.annotations,
        payload.visitType,
        payload.visitDate,
        payload.technician,
        payload.visitValue,
        payload.partsValue,
        payload.status,
      ],
    );

    const record = appointmentToJson(inserted.rows[0]);
    const notification = buildAppointmentScheduledNotification(record);
    broadcast({ table: 'appointments', action: 'created', id: record.id, notification });
    await sendAppointmentScheduledNotification(record);
    res.status(201).json({ record });
  }),
);

app.put(
  '/api/appointments/:id',
  asyncRoute(async (req, res) => {
    const payload = appointmentPayload(req.body);
    const updated = await query(
      `UPDATE appointments
       SET client_name = $2,
           address = $3,
           reported_problem = $4,
           notes = $5,
           annotations = $6,
           visit_type = $7,
           visit_date = $8,
           visit_time = NULL,
           technician = $9,
           visit_value = $10,
           parts_value = $11,
           status = $12
       WHERE id = $1
       RETURNING *`,
      [
        Number(req.params.id),
        payload.clientName,
        payload.address,
        payload.reportedProblem,
        payload.notes,
        payload.annotations,
        payload.visitType,
        payload.visitDate,
        payload.technician,
        payload.visitValue,
        payload.partsValue,
        payload.status,
      ],
    );

    if (!updated.rows[0]) {
      const error = new Error('Agendamento nao encontrado.');
      error.status = 404;
      throw error;
    }

    broadcast({ table: 'appointments', action: 'updated', id: Number(req.params.id) });
    res.json({ record: appointmentToJson(updated.rows[0]) });
  }),
);

app.patch(
  '/api/appointments/:id/date',
  asyncRoute(async (req, res) => {
    const visitDate = cleanDate(req.body?.visitDate);
    const updated = await query(
      `UPDATE appointments
       SET visit_date = $2,
           visit_time = NULL
       WHERE id = $1
       RETURNING *`,
      [Number(req.params.id), visitDate],
    );

    if (!updated.rows[0]) {
      const error = new Error('Agendamento nao encontrado.');
      error.status = 404;
      throw error;
    }

    broadcast({ table: 'appointments', action: 'rescheduled', id: Number(req.params.id) });
    res.json({ record: appointmentToJson(updated.rows[0]) });
  }),
);

app.delete(
  '/api/appointments/:id',
  asyncRoute(async (req, res) => {
    await query('DELETE FROM appointments WHERE id = $1', [Number(req.params.id)]);
    broadcast({ table: 'appointments', action: 'deleted', id: Number(req.params.id) });
    res.status(204).end();
  }),
);

app.get(
  '/api/appointments/:id/photos',
  asyncRoute(async (req, res) => {
    const { rows } = await query(
      `SELECT *
       FROM appointment_photos
       WHERE appointment_id = $1
       ORDER BY created_at DESC, id DESC`,
      [Number(req.params.id)],
    );

    res.json({ records: rows.map((row) => addPublicPhotoUrl(req, appointmentPhotoToJson(row))) });
  }),
);

app.post(
  '/api/appointments/:id/photos',
  asyncRoute(async (req, res) => {
    const appointmentId = Number(req.params.id);
    const existing = await query('SELECT id FROM appointments WHERE id = $1', [appointmentId]);

    if (!existing.rows[0]) {
      const error = new Error('Agendamento nao encontrado.');
      error.status = 404;
      throw error;
    }

    const originalName = cleanText(req.body?.fileName || req.body?.originalName || 'foto.jpg');
    const uploadedBy = cleanText(req.body?.uploadedBy);
    let mimeType = cleanText(req.body?.mimeType);
    let base64 = cleanText(req.body?.dataBase64 || req.body?.data);
    const dataUrlMatch = base64.match(/^data:([^;]+);base64,(.+)$/);

    if (dataUrlMatch) {
      mimeType = mimeType || dataUrlMatch[1];
      base64 = dataUrlMatch[2];
    }

    if (!mimeType.startsWith('image/')) {
      const error = new Error('Apenas imagens podem ser anexadas.');
      error.status = 400;
      throw error;
    }

    const buffer = Buffer.from(base64, 'base64');

    if (!buffer.length) {
      const error = new Error('Imagem invalida.');
      error.status = 400;
      throw error;
    }

    const optimized = await optimizeImage(buffer);
    const fileName = `${randomUUID()}${optimized.extension}`;
    const relativeDir = path.join('agendamentos', String(appointmentId));
    const absoluteDir = path.join(uploadDir, relativeDir);
    mkdirSync(absoluteDir, { recursive: true });
    const storagePath = path.join(absoluteDir, fileName);
    writeFileSync(storagePath, optimized.buffer);
    const publicPath = `/api/uploads/${relativeDir.replaceAll(path.sep, '/')}/${fileName}`;

    const inserted = await query(
      `INSERT INTO appointment_photos (
        appointment_id, file_name, original_name, mime_type, size_bytes,
        original_size_bytes, optimized_width, optimized_height,
        storage_path, public_path, uploaded_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        appointmentId,
        fileName,
        originalName,
        optimized.mimeType,
        optimized.buffer.length,
        buffer.length,
        optimized.width,
        optimized.height,
        storagePath,
        publicPath,
        uploadedBy,
      ],
    );

    broadcast({ table: 'appointment_photos', action: 'created', appointmentId });
    res.status(201).json({ record: addPublicPhotoUrl(req, appointmentPhotoToJson(inserted.rows[0])) });
  }),
);

app.get(
  '/api/correctives',
  asyncRoute(async (req, res) => {
    const period = await getPeriodByIdOrActive(req.query.periodId);

    if (!period) {
      res.json({ period: null, records: [], total: 0, page: 1, limit: 50 });
      return;
    }

    const page = pageFromQuery(req.query.page);
    const limit = limitFromQuery(req.query.limit);
    const offset = (page - 1) * limit;
    const params = [period.id];
    let where = 'period_id = $1';
    const search = cleanText(req.query.search);

    if (search) {
      params.push(`%${search}%`);
      const index = params.length;
      where += ` AND (
        client LIKE $${index} COLLATE NOCASE
        OR contact LIKE $${index} COLLATE NOCASE
        OR requester_name LIKE $${index} COLLATE NOCASE
        OR reason LIKE $${index} COLLATE NOCASE
        OR resolution LIKE $${index} COLLATE NOCASE
        OR technician LIKE $${index} COLLATE NOCASE
      )`;
    }

    const total = await query(`SELECT COUNT(*) AS total FROM corrective_occurrences WHERE ${where}`, params);
    const rows = await query(
      `SELECT *
       FROM corrective_occurrences
       WHERE ${where}
       ORDER BY COALESCE(occurrence_date, '0001-01-01') DESC, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    res.json({
      period: periodToJson(period),
      records: rows.rows.map(correctiveToJson),
      total: total.rows[0].total,
      page,
      limit,
    });
  }),
);

app.get(
  '/api/correctives/:id',
  asyncRoute(async (req, res) => {
    const { rows } = await query('SELECT * FROM corrective_occurrences WHERE id = $1', [Number(req.params.id)]);

    if (!rows[0]) {
      const error = new Error('Ocorrencia nao encontrada.');
      error.status = 404;
      throw error;
    }

    res.json({ record: correctiveToJson(rows[0]) });
  }),
);

app.post(
  '/api/correctives',
  asyncRoute(async (req, res) => {
    const period = await requireWritablePeriod(req.body?.periodId);
    const payload = correctivePayload(req.body);
    const inserted = await query(
      `INSERT INTO corrective_occurrences (
        period_id, occurrence_date, client, contact, requester_name, reason, resolution,
        difficulty, technician, backup_status, firewall_status, power_options_status, solution_date
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11, $12, $13)
      RETURNING *`,
      [
        period.id,
        payload.occurrenceDate,
        payload.client,
        payload.contact,
        payload.requesterName,
        payload.reason,
        payload.resolution,
        payload.difficulty,
        payload.technician,
        payload.backupStatus,
        payload.firewallStatus,
        payload.powerOptionsStatus,
        payload.solutionDate,
      ],
    );

    broadcast({ table: 'correctives', action: 'created', periodId: Number(period.id) });
    res.status(201).json({ record: correctiveToJson(inserted.rows[0]) });
  }),
);

app.put(
  '/api/correctives/:id',
  asyncRoute(async (req, res) => {
    await ensureRecordPeriodIsWritable('corrective_occurrences', req.params.id);
    const payload = correctivePayload(req.body);
    const updated = await query(
      `UPDATE corrective_occurrences
       SET occurrence_date = $2,
           client = $3,
           contact = $4,
           requester_name = $5,
           reason = $6,
           resolution = $7,
           difficulty = $8,
           technician = $9,
           backup_status = $10,
           firewall_status = $11,
           power_options_status = $12,
           solution_date = $13
       WHERE id = $1
       RETURNING *`,
      [
        Number(req.params.id),
        payload.occurrenceDate,
        payload.client,
        payload.contact,
        payload.requesterName,
        payload.reason,
        payload.resolution,
        payload.difficulty,
        payload.technician,
        payload.backupStatus,
        payload.firewallStatus,
        payload.powerOptionsStatus,
        payload.solutionDate,
      ],
    );

    broadcast({ table: 'correctives', action: 'updated', id: Number(req.params.id) });
    res.json({ record: correctiveToJson(updated.rows[0]) });
  }),
);

app.delete(
  '/api/correctives/:id',
  asyncRoute(async (req, res) => {
    await ensureRecordPeriodIsWritable('corrective_occurrences', req.params.id);
    await query('DELETE FROM corrective_occurrences WHERE id = $1', [Number(req.params.id)]);
    broadcast({ table: 'correctives', action: 'deleted', id: Number(req.params.id) });
    res.status(204).end();
  }),
);

app.get(
  '/api/cases',
  asyncRoute(async (req, res) => {
    const page = pageFromQuery(req.query.page);
    const limit = limitFromQuery(req.query.limit);
    const offset = (page - 1) * limit;
    const params = [];
    const whereParts = [];
    const search = cleanText(req.query.search);
    const situation = cleanText(req.query.situation);

    if (search) {
      params.push(`%${search}%`);
      whereParts.push(`client_name LIKE $${params.length} COLLATE NOCASE`);
    }

    if (situation) {
      if (!caseSituations.has(situation)) {
        const error = new Error('Situacao de monitoramento invalida.');
        error.status = 400;
        throw error;
      }
      params.push(situation);
      whereParts.push(`situation = $${params.length}`);
    }

    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const total = await query(`SELECT COUNT(*) AS total FROM case_monitors ${where}`, params);
    const { rows } = await query(
      `SELECT *
       FROM case_monitors
       ${where}
       ORDER BY
        CASE situation
          WHEN 'com problema' THEN 1
          WHEN 'em observação' THEN 2
          WHEN 'em testes' THEN 3
          ELSE 4
        END,
        COALESCE(start_date, '0001-01-01') DESC,
        id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    res.json({
      records: rows.map(caseToJson),
      total: Number(total.rows[0].total || 0),
      page,
      limit,
    });
  }),
);

app.get(
  '/api/cases/:id',
  asyncRoute(async (req, res) => {
    const { rows } = await query('SELECT * FROM case_monitors WHERE id = $1', [Number(req.params.id)]);

    if (!rows[0]) {
      const error = new Error('Caso nao encontrado.');
      error.status = 404;
      throw error;
    }

    res.json({ record: caseToJson(rows[0]) });
  }),
);

app.post(
  '/api/cases',
  asyncRoute(async (req, res) => {
    const payload = casePayload(req.body);
    const inserted = await query(
      `INSERT INTO case_monitors (client_name, start_date, situation)
       VALUES ($1, $2, $3)
       RETURNING *`,
      [payload.clientName, payload.startDate, payload.situation],
    );

    broadcast({ table: 'cases', action: 'created' });
    res.status(201).json({ record: caseToJson(inserted.rows[0]) });
  }),
);

app.put(
  '/api/cases/:id',
  asyncRoute(async (req, res) => {
    const payload = casePayload(req.body);
    const updated = await query(
      `UPDATE case_monitors
       SET client_name = $2,
           start_date = $3,
           situation = $4
       WHERE id = $1
       RETURNING *`,
      [Number(req.params.id), payload.clientName, payload.startDate, payload.situation],
    );

    if (!updated.rows[0]) {
      const error = new Error('Registro nao encontrado.');
      error.status = 404;
      throw error;
    }

    broadcast({ table: 'cases', action: 'updated', id: Number(req.params.id) });
    res.json({ record: caseToJson(updated.rows[0]) });
  }),
);

app.delete(
  '/api/cases/:id',
  asyncRoute(async (req, res) => {
    await query('DELETE FROM case_monitors WHERE id = $1', [Number(req.params.id)]);
    broadcast({ table: 'cases', action: 'deleted', id: Number(req.params.id) });
    res.status(204).end();
  }),
);

app.get(
  '/api/commands',
  asyncRoute(async (req, res) => {
    const period = await getPeriodByIdOrActive(req.query.periodId);
    const page = pageFromQuery(req.query.page);
    const limit = limitFromQuery(req.query.limit);
    const offset = (page - 1) * limit;

    if (!period) {
      res.json({ period: null, records: [], total: 0, page: 1, limit: 50 });
      return;
    }

    const params = [period.id];
    let where = 'period_id = $1';
    const search = cleanText(req.query.search);

    if (search) {
      params.push(`%${search}%`);
      where += ` AND (
        bakery LIKE $${params.length} COLLATE NOCASE
        OR dm_conf LIKE $${params.length} COLLATE NOCASE
        OR dm_cad LIKE $${params.length} COLLATE NOCASE
        OR dm_imp LIKE $${params.length} COLLATE NOCASE
        OR exacta_registrar LIKE $${params.length} COLLATE NOCASE
        OR client_registrar LIKE $${params.length} COLLATE NOCASE
      )`;
    }

    const total = await query(`SELECT COUNT(*) AS total FROM command_registrations WHERE ${where}`, params);
    const { rows } = await query(
      `SELECT *
       FROM command_registrations
       WHERE ${where}
       ORDER BY id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    res.json({
      period: periodToJson(period),
      records: rows.map(commandToJson),
      total: Number(total.rows[0].total || 0),
      page,
      limit,
    });
  }),
);

app.get(
  '/api/commands/:id',
  asyncRoute(async (req, res) => {
    const { rows } = await query('SELECT * FROM command_registrations WHERE id = $1', [Number(req.params.id)]);

    if (!rows[0]) {
      const error = new Error('Comanda nao encontrada.');
      error.status = 404;
      throw error;
    }

    res.json({ record: commandToJson(rows[0]) });
  }),
);

app.post(
  '/api/commands',
  asyncRoute(async (req, res) => {
    const period = await requireWritablePeriod(req.body?.periodId);
    const payload = commandPayload(req.body);
    const inserted = await query(
      `INSERT INTO command_registrations (
        period_id, bakery, dm_conf, dm_cad, dm_imp, exacta_registrar, client_registrar
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7)
      RETURNING *`,
      [
        period.id,
        payload.bakery,
        payload.dmConf,
        payload.dmCad,
        payload.dmImp,
        payload.exactaRegistrar,
        payload.clientRegistrar,
      ],
    );

    broadcast({ table: 'commands', action: 'created', periodId: Number(period.id) });
    res.status(201).json({ record: commandToJson(inserted.rows[0]) });
  }),
);

app.put(
  '/api/commands/:id',
  asyncRoute(async (req, res) => {
    await ensureRecordPeriodIsWritable('command_registrations', req.params.id);
    const payload = commandPayload(req.body);
    const updated = await query(
      `UPDATE command_registrations
       SET bakery = $2,
           dm_conf = $3,
           dm_cad = $4,
           dm_imp = $5,
           exacta_registrar = $6,
           client_registrar = $7
       WHERE id = $1
       RETURNING *`,
      [
        Number(req.params.id),
        payload.bakery,
        payload.dmConf,
        payload.dmCad,
        payload.dmImp,
        payload.exactaRegistrar,
        payload.clientRegistrar,
      ],
    );

    broadcast({ table: 'commands', action: 'updated', id: Number(req.params.id) });
    res.json({ record: commandToJson(updated.rows[0]) });
  }),
);

app.delete(
  '/api/commands/:id',
  asyncRoute(async (req, res) => {
    await ensureRecordPeriodIsWritable('command_registrations', req.params.id);
    await query('DELETE FROM command_registrations WHERE id = $1', [Number(req.params.id)]);
    broadcast({ table: 'commands', action: 'deleted', id: Number(req.params.id) });
    res.status(204).end();
  }),
);

app.get(
  '/api/turnstiles',
  asyncRoute(async (req, res) => {
    const page = pageFromQuery(req.query.page);
    const limit = limitFromQuery(req.query.limit);
    const offset = (page - 1) * limit;
    const params = [];
    const whereParts = [];
    const search = cleanText(req.query.search || req.query.client);
    const status = cleanText(req.query.status);
    const { startDate, endDate } = dateFiltersFromQuery(req.query);

    if (search) {
      params.push(likeParam(search));
      whereParts.push(`(
        client_name LIKE $${params.length} COLLATE NOCASE
        OR model LIKE $${params.length} COLLATE NOCASE
        OR client_address LIKE $${params.length} COLLATE NOCASE
        OR notes LIKE $${params.length} COLLATE NOCASE
      )`);
    }

    if (status) {
      if (!turnstileStatuses.has(status)) {
        const error = new Error('Status de catraca invalido.');
        error.status = 400;
        throw error;
      }

      params.push(status);
      whereParts.push(`status = $${params.length}`);
    }

    if (startDate) {
      params.push(startDate);
      whereParts.push(`expected_delivery_date >= $${params.length}`);
    }

    if (endDate) {
      params.push(endDate);
      whereParts.push(`expected_delivery_date <= $${params.length}`);
    }

    const where = whereParts.length ? whereParts.join(' AND ') : '1 = 1';
    const total = await query(`SELECT COUNT(*) AS total FROM turnstiles WHERE ${where}`, params);
    const rows = await query(
      `SELECT turnstiles.*, (
        SELECT COUNT(*) FROM turnstile_photos WHERE turnstile_id = turnstiles.id
       ) AS photo_count
       FROM turnstiles
       WHERE ${where}
       ORDER BY
        CASE status
          WHEN 'Aguardando montagem' THEN 1
          WHEN 'Em andamento' THEN 2
          WHEN 'Agendada' THEN 3
          WHEN 'Finalizada' THEN 4
          ELSE 5
        END,
        COALESCE(expected_delivery_date, '9999-12-31') ASC,
        id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
      [...params, limit, offset],
    );

    res.json({
      records: rows.rows.map(turnstileToJson),
      total: Number(total.rows[0].total || 0),
      page,
      limit,
      statuses: [...turnstileStatuses],
    });
  }),
);

app.get(
  '/api/turnstiles/photos/:photoId/download',
  asyncRoute(async (req, res) => {
    const { rows } = await query('SELECT * FROM turnstile_photos WHERE id = $1', [Number(req.params.photoId)]);

    if (!rows[0]) {
      const error = new Error('Foto nao encontrada.');
      error.status = 404;
      throw error;
    }

    res.download(rows[0].storage_path, rows[0].original_name || rows[0].file_name);
  }),
);

app.delete(
  '/api/turnstiles/photos/:photoId',
  asyncRoute(async (req, res) => {
    const photoId = Number(req.params.photoId);
    const { rows } = await query('SELECT * FROM turnstile_photos WHERE id = $1', [photoId]);

    if (!rows[0]) {
      const error = new Error('Foto nao encontrada.');
      error.status = 404;
      throw error;
    }

    await query('DELETE FROM turnstile_photos WHERE id = $1', [photoId]);
    removeStoredPhotoFile(rows[0].storage_path);
    broadcast({ table: 'turnstile_photos', action: 'deleted', id: photoId, turnstileId: Number(rows[0].turnstile_id) });
    res.status(204).end();
  }),
);

app.get(
  '/api/turnstiles/:id',
  asyncRoute(async (req, res) => {
    const { rows } = await query(
      `SELECT turnstiles.*, (
        SELECT COUNT(*) FROM turnstile_photos WHERE turnstile_id = turnstiles.id
       ) AS photo_count
       FROM turnstiles
       WHERE id = $1`,
      [Number(req.params.id)],
    );

    if (!rows[0]) {
      const error = new Error('Catraca nao encontrada.');
      error.status = 404;
      throw error;
    }

    res.json({ record: turnstileToJson(rows[0]) });
  }),
);

app.post(
  '/api/turnstiles',
  asyncRoute(async (req, res) => {
    const payload = turnstilePayload(req.body);
    const inserted = await query(
      `INSERT INTO turnstiles (
        client_name, model, client_address, expected_delivery_date, notes, status
      )
      VALUES ($1, $2, $3, $4, $5, $6)
      RETURNING *`,
      [
        payload.clientName,
        payload.model,
        payload.clientAddress,
        payload.expectedDeliveryDate,
        payload.notes,
        payload.status,
      ],
    );

    broadcast({ table: 'turnstiles', action: 'created' });
    res.status(201).json({ record: turnstileToJson(inserted.rows[0]) });
  }),
);

app.put(
  '/api/turnstiles/:id',
  asyncRoute(async (req, res) => {
    const payload = turnstilePayload(req.body);
    const updated = await query(
      `UPDATE turnstiles
       SET client_name = $2,
           model = $3,
           client_address = $4,
           expected_delivery_date = $5,
           notes = $6,
           status = $7
       WHERE id = $1
       RETURNING *`,
      [
        Number(req.params.id),
        payload.clientName,
        payload.model,
        payload.clientAddress,
        payload.expectedDeliveryDate,
        payload.notes,
        payload.status,
      ],
    );

    if (!updated.rows[0]) {
      const error = new Error('Catraca nao encontrada.');
      error.status = 404;
      throw error;
    }

    broadcast({ table: 'turnstiles', action: 'updated', id: Number(req.params.id) });
    res.json({ record: turnstileToJson(updated.rows[0]) });
  }),
);

app.patch(
  '/api/turnstiles/:id/status',
  asyncRoute(async (req, res) => {
    const status = cleanTurnstileStatus(req.body?.status);
    const updated = await query(
      `UPDATE turnstiles
       SET status = $2
       WHERE id = $1
       RETURNING *`,
      [Number(req.params.id), status],
    );

    if (!updated.rows[0]) {
      const error = new Error('Catraca nao encontrada.');
      error.status = 404;
      throw error;
    }

    broadcast({ table: 'turnstiles', action: 'moved', id: Number(req.params.id), status });
    res.json({ record: turnstileToJson(updated.rows[0]) });
  }),
);

app.delete(
  '/api/turnstiles/:id',
  asyncRoute(async (req, res) => {
    await query('DELETE FROM turnstiles WHERE id = $1', [Number(req.params.id)]);
    broadcast({ table: 'turnstiles', action: 'deleted', id: Number(req.params.id) });
    res.status(204).end();
  }),
);

app.get(
  '/api/turnstiles/:id/photos',
  asyncRoute(async (req, res) => {
    const { rows } = await query(
      `SELECT *
       FROM turnstile_photos
       WHERE turnstile_id = $1
       ORDER BY created_at DESC, id DESC`,
      [Number(req.params.id)],
    );

    res.json({ records: rows.map((row) => addPublicPhotoUrl(req, turnstilePhotoToJson(row))) });
  }),
);

app.post(
  '/api/turnstiles/:id/photos',
  asyncRoute(async (req, res) => {
    const turnstileId = Number(req.params.id);
    const existing = await query('SELECT id FROM turnstiles WHERE id = $1', [turnstileId]);

    if (!existing.rows[0]) {
      const error = new Error('Catraca nao encontrada.');
      error.status = 404;
      throw error;
    }

    const originalName = cleanText(req.body?.fileName || req.body?.originalName || 'foto.jpg');
    const uploadedBy = cleanText(req.body?.uploadedBy);
    let mimeType = cleanText(req.body?.mimeType);
    let base64 = cleanText(req.body?.dataBase64 || req.body?.data);
    const dataUrlMatch = base64.match(/^data:([^;]+);base64,(.+)$/);

    if (dataUrlMatch) {
      mimeType = mimeType || dataUrlMatch[1];
      base64 = dataUrlMatch[2];
    }

    if (!mimeType.startsWith('image/')) {
      const error = new Error('Apenas imagens podem ser anexadas.');
      error.status = 400;
      throw error;
    }

    const buffer = Buffer.from(base64, 'base64');

    if (!buffer.length) {
      const error = new Error('Imagem invalida.');
      error.status = 400;
      throw error;
    }

    const optimized = await optimizeImage(buffer);
    const fileName = `${randomUUID()}${optimized.extension}`;
    const relativeDir = path.join('catracas', String(turnstileId));
    const absoluteDir = path.join(uploadDir, relativeDir);
    mkdirSync(absoluteDir, { recursive: true });
    const storagePath = path.join(absoluteDir, fileName);
    writeFileSync(storagePath, optimized.buffer);
    const publicPath = `/api/uploads/${relativeDir.replaceAll(path.sep, '/')}/${fileName}`;

    const inserted = await query(
      `INSERT INTO turnstile_photos (
        turnstile_id, file_name, original_name, mime_type, size_bytes,
        original_size_bytes, optimized_width, optimized_height,
        storage_path, public_path, uploaded_by
      )
      VALUES ($1, $2, $3, $4, $5, $6, $7, $8, $9, $10, $11)
      RETURNING *`,
      [
        turnstileId,
        fileName,
        originalName,
        optimized.mimeType,
        optimized.buffer.length,
        buffer.length,
        optimized.width,
        optimized.height,
        storagePath,
        publicPath,
        uploadedBy,
      ],
    );

    broadcast({ table: 'turnstile_photos', action: 'created', turnstileId });
    res.status(201).json({ record: addPublicPhotoUrl(req, turnstilePhotoToJson(inserted.rows[0])) });
  }),
);

app.get(
  '/api/options/clients',
  asyncRoute(async (_req, res) => {
    const { rows } = await query(
      `SELECT DISTINCT client AS name
       FROM corrective_occurrences
       WHERE client <> ''
       UNION
       SELECT DISTINCT client_name AS name
       FROM case_monitors
       WHERE client_name <> ''
       UNION
       SELECT DISTINCT bakery AS name
       FROM command_registrations
       WHERE bakery <> ''
       UNION
       SELECT DISTINCT client_name AS name
       FROM appointments
       WHERE client_name <> ''
       UNION
       SELECT DISTINCT client_name AS name
       FROM turnstiles
       WHERE client_name <> ''
       ORDER BY name
       LIMIT 500`,
    );

    res.json({ clients: rows.map((row) => row.name) });
  }),
);

app.get(
  '/api/options/technicians',
  asyncRoute(async (_req, res) => {
    const { rows } = await query(
      `SELECT DISTINCT technician AS name
       FROM corrective_occurrences
       WHERE technician <> ''
       UNION
       SELECT DISTINCT technician AS name
       FROM appointments
       WHERE technician <> ''
       UNION
       SELECT DISTINCT exacta_registrar AS name
       FROM command_registrations
       WHERE exacta_registrar <> ''
       UNION
       SELECT DISTINCT client_registrar AS name
       FROM command_registrations
       WHERE client_registrar <> ''
       ORDER BY name
       LIMIT 500`,
    );

    res.json({ technicians: rows.map((row) => row.name) });
  }),
);

app.get(
  '/api/search',
  asyncRoute(async (req, res) => {
    const search = cleanText(req.query.q);

    if (search.length < 2) {
      res.json({ query: search, groups: [] });
      return;
    }

    const like = likeParam(search);
    const [clients, correctives, commands, appointments, turnstiles, notes, companies] = await Promise.all([
      query(
        `SELECT name
         FROM (
           SELECT client AS name FROM corrective_occurrences WHERE client <> ''
           UNION
           SELECT client_name AS name FROM case_monitors WHERE client_name <> ''
           UNION
           SELECT bakery AS name FROM command_registrations WHERE bakery <> ''
           UNION
           SELECT client_name AS name FROM appointments WHERE client_name <> ''
           UNION
           SELECT client_name AS name FROM turnstiles WHERE client_name <> ''
         )
         WHERE name LIKE $1 COLLATE NOCASE
         ORDER BY name
         LIMIT 8`,
        [like],
      ),
      query(
        `SELECT id, client, reason, occurrence_date
         FROM corrective_occurrences
         WHERE client LIKE $1 COLLATE NOCASE
            OR reason LIKE $1 COLLATE NOCASE
            OR technician LIKE $1 COLLATE NOCASE
         ORDER BY COALESCE(occurrence_date, '0001-01-01') DESC, id DESC
         LIMIT 8`,
        [like],
      ),
      query(
        `SELECT id, bakery, dm_conf, dm_cad, dm_imp
         FROM command_registrations
         WHERE bakery LIKE $1 COLLATE NOCASE
            OR dm_conf LIKE $1 COLLATE NOCASE
            OR dm_cad LIKE $1 COLLATE NOCASE
            OR dm_imp LIKE $1 COLLATE NOCASE
         ORDER BY id DESC
         LIMIT 8`,
        [like],
      ),
      query(
        `SELECT id, client_name, technician, visit_date, reported_problem, notes
         FROM appointments
         WHERE client_name LIKE $1 COLLATE NOCASE
            OR technician LIKE $1 COLLATE NOCASE
            OR reported_problem LIKE $1 COLLATE NOCASE
            OR notes LIKE $1 COLLATE NOCASE
         ORDER BY COALESCE(visit_date, '9999-12-31') ASC, id DESC
         LIMIT 8`,
        [like],
      ),
      query(
        `SELECT id, client_name, model, expected_delivery_date, status
         FROM turnstiles
         WHERE client_name LIKE $1 COLLATE NOCASE
            OR model LIKE $1 COLLATE NOCASE
            OR status LIKE $1 COLLATE NOCASE
         ORDER BY COALESCE(expected_delivery_date, '9999-12-31') ASC, id DESC
         LIMIT 8`,
        [like],
      ),
      query(
        `SELECT id, title, content, created_by
         FROM system_notes
         WHERE title LIKE $1 COLLATE NOCASE
            OR content LIKE $1 COLLATE NOCASE
            OR created_by LIKE $1 COLLATE NOCASE
         ORDER BY updated_at DESC, id DESC
         LIMIT 8`,
        [like],
      ),
      query(
        `SELECT id, name, cnpj, system_name
         FROM companies
         WHERE name LIKE $1 COLLATE NOCASE
            OR cnpj LIKE $1 COLLATE NOCASE
         ORDER BY name COLLATE NOCASE, id DESC
         LIMIT 8`,
        [like],
      ),
    ]);

    const groups = [
      {
        category: 'Clientes',
        type: 'client',
        items: clients.rows.map((row) => ({
          id: row.name,
          label: row.name,
          description: 'Historico completo do cliente',
        })),
      },
      {
        category: 'Ocorrencias',
        type: 'corrective',
        items: correctives.rows.map((row) => ({
          id: Number(row.id),
          label: row.client || `Ocorrencia #${row.id}`,
          description: `${dateToJson(row.occurrence_date) || '-'} - ${row.reason || 'Sem motivo informado'}`,
        })),
      },
      {
        category: 'Comandas',
        type: 'command',
        items: commands.rows.map((row) => ({
          id: Number(row.id),
          label: row.bakery || `Comanda #${row.id}`,
          description: [row.dm_conf, row.dm_cad, row.dm_imp].filter(Boolean).join(' | ') || 'Cadastro de comanda',
        })),
      },
      {
        category: 'Agendamentos',
        type: 'appointment',
        items: appointments.rows.map((row) => ({
          id: Number(row.id),
          label: row.client_name || `Agendamento #${row.id}`,
          description: `${dateToJson(row.visit_date) || '-'} - ${row.technician || 'Sem tecnico'} - ${[
            row.reported_problem,
            row.notes,
          ].filter(Boolean).join(' | ')}`,
        })),
      },
      {
        category: 'Catracas',
        type: 'turnstile',
        items: turnstiles.rows.map((row) => ({
          id: Number(row.id),
          label: row.client_name || `Catraca #${row.id}`,
          description: `${row.model || 'Sem modelo'} - ${row.status} - ${dateToJson(row.expected_delivery_date) || '-'}`,
        })),
      },
      {
        category: 'Anotacoes',
        type: 'note',
        items: notes.rows.map((row) => ({
          id: Number(row.id),
          label: row.title || `Anotacao #${row.id}`,
          description: [row.content, row.created_by].filter(Boolean).join(' | ') || 'Anotacao do sistema',
        })),
      },
      {
        category: 'Empresas',
        type: 'company',
        items: companies.rows.map((row) => ({
          id: Number(row.id),
          label: row.name || `Empresa #${row.id}`,
          description: [row.cnpj, row.system_name].filter(Boolean).join(' | ') || 'Cadastro de empresa',
        })),
      },
    ].filter((group) => group.items.length);

    res.json({ query: search, groups });
  }),
);

app.get(
  '/api/clients/history',
  asyncRoute(async (req, res) => {
    const name = cleanText(req.query.name);

    if (!name) {
      const error = new Error('Cliente nao informado.');
      error.status = 400;
      throw error;
    }

    const [correctives, commands, appointments, turnstiles, profile] = await Promise.all([
      query(
        `SELECT *
         FROM corrective_occurrences
         WHERE client = $1 COLLATE NOCASE
         ORDER BY COALESCE(occurrence_date, '0001-01-01') DESC, id DESC`,
        [name],
      ),
      query(
        `SELECT *
         FROM command_registrations
         WHERE bakery = $1 COLLATE NOCASE
         ORDER BY id DESC`,
        [name],
      ),
      query(
        `SELECT appointments.*, 0 AS conflict_count, (
          SELECT COUNT(*) FROM appointment_photos WHERE appointment_id = appointments.id
         ) AS photo_count
         FROM appointments
         WHERE client_name = $1 COLLATE NOCASE
         ORDER BY COALESCE(visit_date, '0001-01-01') DESC, id DESC`,
        [name],
      ),
      query(
        `SELECT turnstiles.*, (
          SELECT COUNT(*) FROM turnstile_photos WHERE turnstile_id = turnstiles.id
         ) AS photo_count
         FROM turnstiles
         WHERE client_name = $1 COLLATE NOCASE
         ORDER BY COALESCE(expected_delivery_date, '0001-01-01') DESC, id DESC`,
        [name],
      ),
      query(
        `SELECT
          (SELECT contact FROM corrective_occurrences WHERE client = $1 COLLATE NOCASE AND contact <> '' ORDER BY id DESC LIMIT 1) AS contact,
          (SELECT requester_name FROM corrective_occurrences WHERE client = $1 COLLATE NOCASE AND requester_name <> '' ORDER BY id DESC LIMIT 1) AS requester_name,
          (SELECT address FROM appointments WHERE client_name = $1 COLLATE NOCASE AND address <> '' ORDER BY id DESC LIMIT 1) AS appointment_address,
          (SELECT client_address FROM turnstiles WHERE client_name = $1 COLLATE NOCASE AND client_address <> '' ORDER BY id DESC LIMIT 1) AS turnstile_address`,
        [name],
      ),
    ]);

    const appointmentRecords = appointments.rows.map(appointmentToJson);
    const correctiveRecords = correctives.rows.map(correctiveToJson);
    const lastDates = [
      ...appointmentRecords.map((record) => record.visitDate),
      ...correctiveRecords.map((record) => record.solutionDate || record.occurrenceDate),
    ].filter(Boolean);
    const totalBilled = appointmentRecords.reduce(
      (sum, record) => sum + Number(record.visitValue || 0) + Number(record.partsValue || 0),
      0,
    );

    res.json({
      client: {
        name,
        address: profile.rows[0]?.appointment_address || profile.rows[0]?.turnstile_address || '',
        contact: profile.rows[0]?.contact || '',
        requesterName: profile.rows[0]?.requester_name || '',
      },
      history: {
        correctives: correctiveRecords,
        commands: commands.rows.map(commandToJson),
        appointments: appointmentRecords,
        turnstiles: turnstiles.rows.map(turnstileToJson),
      },
      indicators: {
        totalAttendances: correctiveRecords.length + appointmentRecords.length,
        totalCommands: commands.rows.length,
        totalBilled,
        lastAttendance: lastDates.sort().at(-1) || null,
      },
    });
  }),
);

app.get(
  '/api/technicians',
  asyncRoute(async (req, res) => {
    const page = pageFromQuery(req.query.page);
    const limit = limitFromQuery(req.query.limit);
    const offset = (page - 1) * limit;
    const { startDate, endDate } = dateFiltersFromQuery(req.query);
    const appointmentParams = [];
    const appointmentWhere = [`technician <> ''`];
    const correctiveParams = [];
    const correctiveWhere = [`technician <> ''`];

    if (startDate) {
      appointmentParams.push(startDate);
      appointmentWhere.push(`visit_date >= $${appointmentParams.length}`);
      correctiveParams.push(startDate);
      correctiveWhere.push(`COALESCE(solution_date, occurrence_date) >= $${correctiveParams.length}`);
    }

    if (endDate) {
      appointmentParams.push(endDate);
      appointmentWhere.push(`visit_date <= $${appointmentParams.length}`);
      correctiveParams.push(endDate);
      correctiveWhere.push(`COALESCE(solution_date, occurrence_date) <= $${correctiveParams.length}`);
    }

    const appointmentSql = `SELECT technician AS name,
        SUM(CASE WHEN status = 'realizada' THEN 1 ELSE 0 END) AS visits_done,
        0 AS correctives_done,
        COUNT(*) AS appointments,
        COALESCE(SUM(CASE WHEN status = 'realizada' THEN visit_value ELSE 0 END), 0) AS visit_total,
        COALESCE(SUM(CASE WHEN status = 'realizada' THEN parts_value ELSE 0 END), 0) AS parts_total
      FROM appointments
      WHERE ${appointmentWhere.join(' AND ')}
      GROUP BY technician`;

    const correctiveSql = `SELECT technician AS name,
        0 AS visits_done,
        SUM(CASE WHEN solution_date IS NOT NULL AND solution_date <> '' THEN 1 ELSE 0 END) AS correctives_done,
        0 AS appointments,
        0 AS visit_total,
        0 AS parts_total
      FROM corrective_occurrences
      WHERE ${correctiveWhere.join(' AND ')}
      GROUP BY technician`;

    const aggregateSql = `SELECT name,
        SUM(visits_done) AS visits_done,
        SUM(correctives_done) AS correctives_done,
        SUM(appointments) AS appointments,
        SUM(visit_total) AS visit_total,
        SUM(parts_total) AS parts_total
       FROM (
        ${appointmentSql}
        UNION ALL
        ${correctiveSql}
       )
       WHERE name <> ''
       GROUP BY name`;
    const [total, result] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM (${aggregateSql}) AS technicians_total`, appointmentParams),
      query(
        `${aggregateSql}
       ORDER BY visits_done DESC, correctives_done DESC, name ASC
       LIMIT $${appointmentParams.length + 1} OFFSET $${appointmentParams.length + 2}`,
        [...appointmentParams, limit, offset],
      ),
    ]);

    res.json({
      records: result.rows.map((row) => ({
        name: row.name,
        visitsDone: Number(row.visits_done || 0),
        correctivesDone: Number(row.correctives_done || 0),
        appointments: Number(row.appointments || 0),
        visitTotal: Number(row.visit_total || 0),
        partsTotal: Number(row.parts_total || 0),
      })),
      total: Number(total.rows[0].total || 0),
      page,
      limit,
    });
  }),
);

app.get(
  '/api/technicians/history',
  asyncRoute(async (req, res) => {
    const name = cleanText(req.query.name);

    if (!name) {
      const error = new Error('Tecnico nao informado.');
      error.status = 400;
      throw error;
    }

    const { startDate, endDate } = dateFiltersFromQuery(req.query);
    const buildDateClause = (column, params) => {
      const clauses = [];

      if (startDate) {
        params.push(startDate);
        clauses.push(`${column} >= $${params.length}`);
      }

      if (endDate) {
        params.push(endDate);
        clauses.push(`${column} <= $${params.length}`);
      }

      return clauses.length ? ` AND ${clauses.join(' AND ')}` : '';
    };

    const appointmentParams = [name];
    const correctiveParams = [name];
    const commandParams = [name];
    const appointmentDateClause = buildDateClause('visit_date', appointmentParams);
    const correctiveDateClause = buildDateClause('COALESCE(solution_date, occurrence_date)', correctiveParams);
    const commandDateClause = buildDateClause('substr(created_at, 1, 10)', commandParams);

    const [appointments, correctives, commands] = await Promise.all([
      query(
        `SELECT appointments.*, 0 AS conflict_count, (
          SELECT COUNT(*) FROM appointment_photos WHERE appointment_id = appointments.id
         ) AS photo_count
         FROM appointments
         WHERE technician = $1 COLLATE NOCASE${appointmentDateClause}
         ORDER BY COALESCE(visit_date, '0001-01-01') DESC, id DESC`,
        appointmentParams,
      ),
      query(
        `SELECT *
         FROM corrective_occurrences
         WHERE technician = $1 COLLATE NOCASE${correctiveDateClause}
         ORDER BY COALESCE(solution_date, occurrence_date, '0001-01-01') DESC, id DESC`,
        correctiveParams,
      ),
      query(
        `SELECT *
         FROM command_registrations
         WHERE (exacta_registrar = $1 COLLATE NOCASE OR client_registrar = $1 COLLATE NOCASE)${commandDateClause}
         ORDER BY id DESC`,
        commandParams,
      ),
    ]);

    res.json({
      technician: name,
      history: {
        appointments: appointments.rows.map(appointmentToJson),
        correctives: correctives.rows.map(correctiveToJson),
        commands: commands.rows.map(commandToJson),
      },
    });
  }),
);

app.get(
  '/api/reports/daily',
  asyncRoute(async (req, res) => {
    const page = pageFromQuery(req.query.page);
    const limit = limitFromQuery(req.query.limit);
    const offset = (page - 1) * limit;
    const { startDate, endDate } = dateFiltersFromQuery(req.query);
    const start = startDate || todayText();
    const end = endDate || start;
    const params = [start, end, start, end];
    const reportSql = `SELECT client AS client, technician, occurrence_date AS date, reason AS problem,
          CASE WHEN solution_date IS NOT NULL AND solution_date <> '' THEN 'concluida' ELSE 'aberta' END AS status,
          0 AS visit_value, 0 AS parts_value, 'Ocorrencia' AS source
         FROM corrective_occurrences
         WHERE occurrence_date >= $1 AND occurrence_date <= $2
         UNION ALL
         SELECT client_name AS client, technician, visit_date AS date, reported_problem AS problem,
          status, visit_value, parts_value, 'Agendamento' AS source
         FROM appointments
         WHERE visit_date >= $3 AND visit_date <= $4`;
    const [total, records] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM (${reportSql}) AS daily_report_total`, params),
      query(
        `SELECT *
         FROM (${reportSql}) AS daily_report
         ORDER BY date DESC, source ASC
         LIMIT $5 OFFSET $6`,
        [...params, limit, offset],
      ),
    ]);

    res.json({
      records: records.rows,
      total: Number(total.rows[0].total || 0),
      page,
      limit,
    });
  }),
);

app.get(
  '/api/reports/monthly',
  asyncRoute(async (req, res) => {
    const month = monthRange(req.query.month);
    const [attendances, visits, correctives, clients, deliveredTurnstiles, topTechnicians] = await Promise.all([
      query(
        `SELECT COUNT(*) AS total
         FROM (
           SELECT id FROM corrective_occurrences WHERE COALESCE(solution_date, occurrence_date) >= $1 AND COALESCE(solution_date, occurrence_date) < $2
           UNION ALL
           SELECT id FROM appointments WHERE visit_date >= $1 AND visit_date < $2 AND status <> 'cancelada'
         )`,
        [month.start, month.end],
      ),
      query(`SELECT COUNT(*) AS total FROM appointments WHERE visit_date >= $1 AND visit_date < $2`, [
        month.start,
        month.end,
      ]),
      query(
        `SELECT COUNT(*) AS total
         FROM corrective_occurrences
         WHERE COALESCE(solution_date, occurrence_date) >= $1 AND COALESCE(solution_date, occurrence_date) < $2`,
        [month.start, month.end],
      ),
      query(
        `SELECT COUNT(DISTINCT client) AS total
         FROM (
           SELECT client AS client FROM corrective_occurrences WHERE COALESCE(solution_date, occurrence_date) >= $1 AND COALESCE(solution_date, occurrence_date) < $2 AND client <> ''
           UNION ALL
           SELECT client_name AS client FROM appointments WHERE visit_date >= $1 AND visit_date < $2 AND client_name <> ''
           UNION ALL
           SELECT client_name AS client FROM turnstiles WHERE expected_delivery_date >= $1 AND expected_delivery_date < $2 AND client_name <> ''
         )`,
        [month.start, month.end],
      ),
      query(
        `SELECT COUNT(*) AS total
         FROM turnstiles
         WHERE status = 'Entregue' AND expected_delivery_date >= $1 AND expected_delivery_date < $2`,
        [month.start, month.end],
      ),
      query(
        `SELECT name, SUM(total) AS total
         FROM (
           SELECT technician AS name, COUNT(*) AS total
           FROM corrective_occurrences
           WHERE technician <> '' AND COALESCE(solution_date, occurrence_date) >= $1 AND COALESCE(solution_date, occurrence_date) < $2
           GROUP BY technician
           UNION ALL
           SELECT technician AS name, COUNT(*) AS total
           FROM appointments
           WHERE technician <> '' AND visit_date >= $1 AND visit_date < $2
           GROUP BY technician
         )
         GROUP BY name
         ORDER BY total DESC, name ASC
         LIMIT 5`,
        [month.start, month.end],
      ),
    ]);

    res.json({
      month: month.label,
      totals: {
        attendances: Number(attendances.rows[0].total || 0),
        visits: Number(visits.rows[0].total || 0),
        correctives: Number(correctives.rows[0].total || 0),
        clients: Number(clients.rows[0].total || 0),
        deliveredTurnstiles: Number(deliveredTurnstiles.rows[0].total || 0),
      },
      topTechnicians: topTechnicians.rows.map((row) => ({ name: row.name, total: Number(row.total || 0) })),
    });
  }),
);

app.get(
  '/api/notifications',
  asyncRoute(async (_req, res) => {
    const today = todayText();
    const soon = addDaysText(today, 3);
    const [todayVisits, soonTurnstiles, overdueTurnstiles, overdueAppointments, pendingCorrectives] =
      await Promise.all([
        query(
          `SELECT id, client_name, technician, visit_date
           FROM appointments
         WHERE visit_date = $1 AND status = 'agendada'
           ORDER BY id ASC
           LIMIT 20`,
          [today],
        ),
        query(
          `SELECT id, client_name, model, expected_delivery_date
           FROM turnstiles
           WHERE status <> 'Entregue'
             AND expected_delivery_date >= $1
             AND expected_delivery_date <= $2
           ORDER BY expected_delivery_date ASC, id ASC
           LIMIT 20`,
          [today, soon],
        ),
        query(
          `SELECT id, client_name, model, expected_delivery_date
           FROM turnstiles
           WHERE status <> 'Entregue'
             AND expected_delivery_date < $1
           ORDER BY expected_delivery_date ASC, id ASC
           LIMIT 20`,
          [today],
        ),
        query(
          `SELECT id, client_name, technician, visit_date
           FROM appointments
           WHERE status = 'agendada'
             AND visit_date < $1
           ORDER BY visit_date ASC, id ASC
           LIMIT 20`,
          [today],
        ),
        query(
          `SELECT id, client, reason, occurrence_date
           FROM corrective_occurrences
           WHERE solution_date IS NULL OR solution_date = ''
           ORDER BY COALESCE(occurrence_date, '0001-01-01') ASC, id ASC
           LIMIT 20`,
        ),
      ]);

    const notifications = [
      ...todayVisits.rows.map((row) => ({
        key: `appointment:today:${row.id}:${dateToJson(row.visit_date)}`,
        type: 'appointment',
        severity: 'info',
        id: Number(row.id),
        title: 'Visita agendada para hoje',
        message: `${row.client_name || 'Cliente'} - ${row.technician || 'sem tecnico'}`,
      })),
      ...soonTurnstiles.rows.map((row) => ({
        key: `turnstile:soon:${row.id}:${dateToJson(row.expected_delivery_date)}`,
        type: 'turnstile',
        severity: 'warning',
        id: Number(row.id),
        title: 'Catraca proxima da entrega',
        message: `${row.client_name || 'Cliente'} - ${row.model || 'sem modelo'} - ${dateToJson(row.expected_delivery_date)}`,
      })),
      ...overdueTurnstiles.rows.map((row) => ({
        key: `turnstile:overdue:${row.id}:${dateToJson(row.expected_delivery_date)}`,
        type: 'turnstile',
        severity: 'danger',
        id: Number(row.id),
        title: 'Catraca atrasada',
        message: `${row.client_name || 'Cliente'} - ${dateToJson(row.expected_delivery_date)}`,
      })),
      ...overdueAppointments.rows.map((row) => ({
        key: `appointment:overdue:${row.id}:${dateToJson(row.visit_date)}`,
        type: 'appointment',
        severity: 'danger',
        id: Number(row.id),
        title: 'Agendamento atrasado',
        message: `${row.client_name || 'Cliente'} - ${dateToJson(row.visit_date)}`,
      })),
      ...pendingCorrectives.rows.map((row) => ({
        key: `corrective:pending:${row.id}`,
        type: 'corrective',
        severity: 'warning',
        id: Number(row.id),
        title: 'Ocorrencia pendente',
        message: `${row.client || 'Cliente'} - ${row.reason || 'sem motivo'}`,
      })),
    ];

    const keys = notifications.map((item) => item.key);
    const readRows = keys.length
      ? await query(
          `SELECT notification_key
           FROM notification_reads
           WHERE notification_key IN (${keys.map((_, index) => `$${index + 1}`).join(', ')})`,
          keys,
        )
      : { rows: [] };
    const readKeys = new Set(readRows.rows.map((row) => row.notification_key));
    const records = notifications.map((item) => ({ ...item, read: readKeys.has(item.key) }));

    res.json({
      count: records.filter((item) => !item.read).length,
      total: records.length,
      notifications: records,
    });
  }),
);

app.post(
  '/api/notifications/read',
  asyncRoute(async (req, res) => {
    const keys = Array.isArray(req.body?.keys)
      ? req.body.keys.map(cleanText).filter(Boolean)
      : [cleanText(req.body?.key)].filter(Boolean);

    if (!keys.length) {
      const error = new Error('Nenhuma notificacao informada.');
      error.status = 400;
      throw error;
    }

    for (const key of keys) {
      await query(
        `INSERT INTO notification_reads (notification_key, read_at)
         VALUES ($1, datetime('now'))
         ON CONFLICT (notification_key) DO UPDATE SET read_at = excluded.read_at`,
        [key],
      );
    }

    broadcast({ table: 'notifications', action: 'read' });
    res.json({ ok: true, count: keys.length });
  }),
);

app.get(
  '/api/export/correctives.csv',
  asyncRoute(async (req, res) => {
    const period = await getPeriodByIdOrActive(req.query.periodId);

    if (!period) {
      res.status(404).json({ error: 'Periodo nao encontrado.' });
      return;
    }

    const { rows } = await query(
      `SELECT *
       FROM corrective_occurrences
       WHERE period_id = $1
       ORDER BY COALESCE(occurrence_date, '0001-01-01') DESC, id DESC`,
      [period.id],
    );

    const columns = [
      ['Data', 'occurrence_date'],
      ['Cliente', 'client'],
      ['Contato', 'contact'],
      ['Nome solicitante', 'requester_name'],
      ['Motivo', 'reason'],
      ['Resolução', 'resolution'],
      ['Dificuldade', 'difficulty'],
      ['Técnico', 'technician'],
      ['Backup', 'backup_status'],
      ['Firewall', 'firewall_status'],
      ['Opções de Energia', 'power_options_status'],
      ['Data de Solução', 'solution_date'],
    ];

    const escapeCsv = (value) => {
      const text = value === null || value === undefined ? '' : String(value);
      return `"${text.replaceAll('"', '""')}"`;
    };

    const csv = [
      columns.map(([label]) => escapeCsv(label)).join(';'),
      ...rows.map((row) => columns.map(([, key]) => escapeCsv(row[key])).join(';')),
    ].join('\n');

    res.setHeader('Content-Type', 'text/csv; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="corretivas-${period.year}.csv"`);
    res.send(`\ufeff${csv}`);
  }),
);

app.get(
  '/api/export/:resource.:format',
  asyncRoute(async (req, res) => {
    const resource = cleanText(req.params.resource);
    const format = cleanText(req.params.format);
    const period = await getPeriodByIdOrActive(req.query.periodId);

    if (resource === 'correctives') {
      if (!period) {
        res.status(404).json({ error: 'Periodo nao encontrado.' });
        return;
      }

      const { rows } = await query(
        `SELECT *
         FROM corrective_occurrences
         WHERE period_id = $1
         ORDER BY COALESCE(occurrence_date, '0001-01-01') DESC, id DESC`,
        [period.id],
      );
      const columns = [
        ['Data', 'occurrence_date'],
        ['Cliente', 'client'],
        ['Contato', 'contact'],
        ['Solicitante', 'requester_name'],
        ['Problema', 'reason'],
        ['Resolucao', 'resolution'],
        ['Dificuldade', 'difficulty'],
        ['Tecnico', 'technician'],
        ['Status', (row) => (row.solution_date ? 'concluida' : 'aberta')],
        ['Data solucao', 'solution_date'],
      ];

      sendTableExport(res, format, `corretivas-${period.year}`, `Corretivas ${period.year}`, columns, rows);
      return;
    }

    if (resource === 'appointments') {
      const params = [];
      const whereParts = [];
      const search = cleanText(req.query.search);
      const technician = cleanText(req.query.technician);
      const visitType = cleanAppointmentVisitType(req.query.visitType);
      const { startDate, endDate } = dateFiltersFromQuery(req.query);

      if (search) {
        params.push(likeParam(search));
        whereParts.push(`(
          client_name LIKE $${params.length} COLLATE NOCASE
          OR address LIKE $${params.length} COLLATE NOCASE
          OR reported_problem LIKE $${params.length} COLLATE NOCASE
          OR notes LIKE $${params.length} COLLATE NOCASE
          OR annotations LIKE $${params.length} COLLATE NOCASE
          OR technician LIKE $${params.length} COLLATE NOCASE
        )`);
      }

      if (technician) {
        params.push(technician);
        whereParts.push(`technician = $${params.length} COLLATE NOCASE`);
      }

      if (visitType) {
        params.push(visitType);
        whereParts.push(`visit_type = $${params.length}`);
      }

      if (startDate) {
        params.push(startDate);
        whereParts.push(`visit_date >= $${params.length}`);
      }

      if (endDate) {
        params.push(endDate);
        whereParts.push(`visit_date <= $${params.length}`);
      }

      const where = whereParts.length ? whereParts.join(' AND ') : '1 = 1';
      const { rows } = await query(
        `SELECT *
         FROM appointments
         WHERE ${where}
         ORDER BY COALESCE(visit_date, '9999-12-31') ASC, id DESC`,
        params,
      );
      const columns = [
        ['Cliente', 'client_name'],
        ['Endereco', 'address'],
        ['Problema', 'reported_problem'],
        ['Observacoes', 'notes'],
        ['Tipo visita', 'visit_type'],
        ['Data', 'visit_date'],
        ['Tecnico', 'technician'],
        ['Valor visita', (row) => formatCurrency(row.visit_value)],
        ['Valor pecas', (row) => formatCurrency(row.parts_value)],
        ['Status', 'status'],
      ];

      sendTableExport(res, format, 'agendamentos', 'Agendamentos', columns, rows);
      return;
    }

    if (resource === 'turnstiles') {
      const params = [];
      const whereParts = [];
      const search = cleanText(req.query.search || req.query.client);
      const status = cleanText(req.query.status);
      const { startDate, endDate } = dateFiltersFromQuery(req.query);

      if (search) {
        params.push(likeParam(search));
        whereParts.push(`(
          client_name LIKE $${params.length} COLLATE NOCASE
          OR model LIKE $${params.length} COLLATE NOCASE
          OR client_address LIKE $${params.length} COLLATE NOCASE
          OR notes LIKE $${params.length} COLLATE NOCASE
        )`);
      }

      if (status) {
        params.push(status);
        whereParts.push(`status = $${params.length}`);
      }

      if (startDate) {
        params.push(startDate);
        whereParts.push(`expected_delivery_date >= $${params.length}`);
      }

      if (endDate) {
        params.push(endDate);
        whereParts.push(`expected_delivery_date <= $${params.length}`);
      }

      const where = whereParts.length ? whereParts.join(' AND ') : '1 = 1';
      const { rows } = await query(
        `SELECT *
         FROM turnstiles
         WHERE ${where}
         ORDER BY COALESCE(expected_delivery_date, '9999-12-31') ASC, id DESC`,
        params,
      );
      const columns = [
        ['Cliente', 'client_name'],
        ['Modelo', 'model'],
        ['Endereco', 'client_address'],
        ['Entrega prevista', 'expected_delivery_date'],
        ['Status', 'status'],
        ['Prazo', (row) => turnstileDueStatus(row)],
        ['Observacoes', 'notes'],
      ];

      sendTableExport(res, format, 'catracas', 'Catracas para montagem', columns, rows);
      return;
    }

    if (resource === 'technicians') {
      const { startDate, endDate } = dateFiltersFromQuery(req.query);
      const params = [];
      const appointmentWhere = [`technician <> ''`];
      const correctiveWhere = [`technician <> ''`];

      if (startDate) {
        params.push(startDate);
        appointmentWhere.push(`visit_date >= $${params.length}`);
        correctiveWhere.push(`COALESCE(solution_date, occurrence_date) >= $${params.length}`);
      }

      if (endDate) {
        params.push(endDate);
        appointmentWhere.push(`visit_date <= $${params.length}`);
        correctiveWhere.push(`COALESCE(solution_date, occurrence_date) <= $${params.length}`);
      }

      const { rows } = await query(
        `SELECT name,
          SUM(visits_done) AS visits_done,
          SUM(correctives_done) AS correctives_done,
          SUM(appointments) AS appointments,
          SUM(visit_total) AS visit_total,
          SUM(parts_total) AS parts_total
         FROM (
          SELECT technician AS name,
            SUM(CASE WHEN status = 'realizada' THEN 1 ELSE 0 END) AS visits_done,
            0 AS correctives_done,
            COUNT(*) AS appointments,
            COALESCE(SUM(CASE WHEN status = 'realizada' THEN visit_value ELSE 0 END), 0) AS visit_total,
            COALESCE(SUM(CASE WHEN status = 'realizada' THEN parts_value ELSE 0 END), 0) AS parts_total
          FROM appointments
          WHERE ${appointmentWhere.join(' AND ')}
          GROUP BY technician
          UNION ALL
          SELECT technician AS name,
            0 AS visits_done,
            SUM(CASE WHEN solution_date IS NOT NULL AND solution_date <> '' THEN 1 ELSE 0 END) AS correctives_done,
            0 AS appointments,
            0 AS visit_total,
            0 AS parts_total
          FROM corrective_occurrences
          WHERE ${correctiveWhere.join(' AND ')}
          GROUP BY technician
         )
         GROUP BY name
         ORDER BY visits_done DESC, correctives_done DESC, name ASC`,
        params,
      );
      const columns = [
        ['Tecnico', 'name'],
        ['Visitas realizadas', 'visits_done'],
        ['Ocorrencias concluidas', 'correctives_done'],
        ['Agendamentos', 'appointments'],
        ['Valor visitas', (row) => formatCurrency(row.visit_total)],
        ['Valor pecas', (row) => formatCurrency(row.parts_total)],
      ];

      sendTableExport(res, format, 'tecnicos', 'Indicadores por tecnico', columns, rows);
      return;
    }

    if (resource === 'daily-report') {
      const { startDate, endDate } = dateFiltersFromQuery(req.query);
      const start = startDate || todayText();
      const end = endDate || start;
      const [correctives, appointments] = await Promise.all([
        query(
          `SELECT client AS client, technician, occurrence_date AS date, reason AS problem,
            CASE WHEN solution_date IS NOT NULL AND solution_date <> '' THEN 'concluida' ELSE 'aberta' END AS status,
            0 AS visit_value, 0 AS parts_value, 'Ocorrencia' AS source
           FROM corrective_occurrences
           WHERE occurrence_date >= $1 AND occurrence_date <= $2`,
          [start, end],
        ),
        query(
          `SELECT client_name AS client, technician, visit_date AS date, reported_problem AS problem,
            status, visit_value, parts_value, 'Agendamento' AS source
           FROM appointments
           WHERE visit_date >= $1 AND visit_date <= $2`,
          [start, end],
        ),
      ]);
      const rows = [...correctives.rows, ...appointments.rows];
      const columns = [
        ['Tipo', 'source'],
        ['Cliente', 'client'],
        ['Tecnico', 'technician'],
        ['Data', 'date'],
        ['Problema', 'problem'],
        ['Status', 'status'],
        ['Valor visita', (row) => formatCurrency(row.visit_value)],
        ['Valor pecas', (row) => formatCurrency(row.parts_value)],
      ];

      sendTableExport(res, format, 'relatorio-diario', 'Relatorio diario', columns, rows);
      return;
    }

    if (resource === 'monthly-report') {
      const month = monthRange(req.query.month);
      const [summary, technicians] = await Promise.all([
        query(
          `SELECT 'Total de atendimentos' AS indicador,
            (SELECT COUNT(*) FROM corrective_occurrences WHERE COALESCE(solution_date, occurrence_date) >= $1 AND COALESCE(solution_date, occurrence_date) < $2)
            + (SELECT COUNT(*) FROM appointments WHERE visit_date >= $1 AND visit_date < $2 AND status <> 'cancelada') AS valor
           UNION ALL
           SELECT 'Total de visitas', (SELECT COUNT(*) FROM appointments WHERE visit_date >= $1 AND visit_date < $2)
           UNION ALL
           SELECT 'Total de ocorrencias', (SELECT COUNT(*) FROM corrective_occurrences WHERE COALESCE(solution_date, occurrence_date) >= $1 AND COALESCE(solution_date, occurrence_date) < $2)
           UNION ALL
           SELECT 'Clientes atendidos', (
             SELECT COUNT(DISTINCT client)
             FROM (
               SELECT client AS client FROM corrective_occurrences WHERE COALESCE(solution_date, occurrence_date) >= $1 AND COALESCE(solution_date, occurrence_date) < $2 AND client <> ''
               UNION ALL
               SELECT client_name AS client FROM appointments WHERE visit_date >= $1 AND visit_date < $2 AND client_name <> ''
             )
           )
           UNION ALL
           SELECT 'Catracas entregues', (SELECT COUNT(*) FROM turnstiles WHERE status = 'Entregue' AND expected_delivery_date >= $1 AND expected_delivery_date < $2)`,
          [month.start, month.end],
        ),
        query(
          `SELECT name AS indicador, total AS valor
           FROM (
             SELECT name, SUM(total) AS total
             FROM (
               SELECT technician AS name, COUNT(*) AS total
               FROM corrective_occurrences
               WHERE technician <> '' AND COALESCE(solution_date, occurrence_date) >= $1 AND COALESCE(solution_date, occurrence_date) < $2
               GROUP BY technician
               UNION ALL
               SELECT technician AS name, COUNT(*) AS total
               FROM appointments
               WHERE technician <> '' AND visit_date >= $1 AND visit_date < $2
               GROUP BY technician
             )
             GROUP BY name
             ORDER BY total DESC, name ASC
             LIMIT 5
           )`,
          [month.start, month.end],
        ),
      ]);
      const rows = [
        ...summary.rows,
        ...technicians.rows.map((row) => ({ indicador: `Tecnico: ${row.indicador}`, valor: row.valor })),
      ];
      const columns = [
        ['Indicador', 'indicador'],
        ['Valor', 'valor'],
      ];

      sendTableExport(res, format, `relatorio-mensal-${month.label}`, `Relatorio mensal ${month.label}`, columns, rows);
      return;
    }

    const error = new Error('Exportacao nao encontrada.');
    error.status = 404;
    throw error;
  }),
);

if (existsSync(distDir)) {
  app.use(express.static(distDir));
  app.get(/.*/, (_req, res) => {
    res.sendFile(path.join(distDir, 'index.html'));
  });
} else {
  app.get('/', (_req, res) => {
    res.json({
      ...basicHealthPayload(),
      webBuild: false,
      message: 'API ativa. Execute npm run build para gerar o sistema web.',
    });
  });
}

app.use((error, _req, res, _next) => {
  const status = error.status || 500;

  if (status >= 500) {
    console.error(error);
  }

  res.status(status).json({
    error: error.message || 'Erro interno do servidor.',
  });
});

const server = await migrate()
  .then(
    () =>
      new Promise((resolve) => {
        const instance = app.listen(port, '0.0.0.0', () => {
          console.log(`Corretivas API rodando em http://localhost:${port}`);
          resolve(instance);
        });
      }),
  )
  .catch((error) => {
    console.error('Nao foi possivel iniciar o servidor.');
    console.error(error);
    process.exit(1);
  });

async function shutdown() {
  server.close(async () => {
    await closePool();
    process.exit(0);
  });
}

process.on('SIGINT', shutdown);
process.on('SIGTERM', shutdown);
