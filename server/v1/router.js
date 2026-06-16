import express from 'express';
import { existsSync, mkdirSync, unlinkSync, writeFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import sharp from 'sharp';
import { z } from 'zod';
import { buildDashboardReport } from '../dashboardReports.js';
import { query } from '../db.js';
import { firebaseAuth, firebaseConfigured, firebaseMessaging, firebaseStorageBucket } from '../firebase.js';
import { logger } from '../logger.js';
import { buildAppointmentScheduledNotification, sendAppointmentScheduledNotification } from '../notifications.js';
import { auditLog, createRecord, deleteRecord, getRecord, listRecords, updateRecord } from './repository.js';
import { requireAuth, signApiToken, validateLocalPassword } from './security.js';

const writableRoles = ['admin', 'operacional'];
const technicianWritableRoles = ['admin', 'operacional', 'tecnico'];
const readRoles = ['admin', 'operacional', 'tecnico', 'leitura'];
const __filename = fileURLToPath(import.meta.url);
const __dirname = path.dirname(__filename);
const rootDir = path.resolve(__dirname, '..', '..');
const dataDir = process.env.DATA_DIR ? path.resolve(process.env.DATA_DIR) : path.join(rootDir, 'data');
const uploadDir = path.join(dataDir, 'uploads');
const legacyUploadDir = path.join(rootDir, 'data', 'uploads');

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

function photoRecordToJson(req, row, ownerKey) {
  return {
    id: String(row.id),
    [ownerKey]: String(row[ownerKey] || ''),
    fileName: row.file_name,
    originalName: row.original_name,
    mimeType: row.mime_type,
    sizeBytes: Number(row.size_bytes || 0),
    originalSizeBytes: Number(row.original_size_bytes || 0),
    optimizedWidth: row.optimized_width === null || row.optimized_width === undefined ? null : Number(row.optimized_width),
    optimizedHeight: row.optimized_height === null || row.optimized_height === undefined ? null : Number(row.optimized_height),
    publicPath: row.public_path,
    publicUrl: publicPhotoUrl(req, row.public_path),
    uploadedBy: row.uploaded_by,
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
  };
}

function removeLocalStoredPhotoFile(storagePath) {
  const text = String(storagePath || '').trim();

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
    logger.warn({ error: error.message, filePath }, 'Nao foi possivel apagar anexo local');
  }
}

async function removeStoredPhotoFile(row) {
  const publicPath = String(row?.public_path || '').trim();

  if (publicPath.startsWith('gs://')) {
    const bucket = firebaseStorageBucket();

    if (!bucket) {
      return;
    }

    const withoutScheme = publicPath.slice('gs://'.length);
    const storagePath = withoutScheme.split('/').slice(1).join('/');

    if (storagePath) {
      try {
        await bucket.file(storagePath).delete({ ignoreNotFound: true });
      } catch (error) {
        logger.warn({ error: error.message, storagePath }, 'Nao foi possivel apagar anexo do Firebase Storage');
      }
    }

    return;
  }

  removeLocalStoredPhotoFile(row?.storage_path);
}

function todayText() {
  return new Date().toISOString().slice(0, 10);
}

function addDaysText(dateText, amount) {
  const date = new Date(`${dateText}T00:00:00`);
  date.setUTCDate(date.getUTCDate() + amount);
  return date.toISOString().slice(0, 10);
}

function monthRange(month) {
  const label = month && /^\d{4}-\d{2}$/.test(month) ? month : new Date().toISOString().slice(0, 7);
  const [year, monthNumber] = label.split('-').map(Number);
  const start = new Date(Date.UTC(year, monthNumber - 1, 1));
  const end = new Date(Date.UTC(year, monthNumber, 1));

  return {
    label,
    start: start.toISOString().slice(0, 10),
    end: end.toISOString().slice(0, 10),
  };
}

function dateToJson(value) {
  if (!value) {
    return null;
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

function appointmentToJson(row) {
  return {
    id: String(row.id),
    clientName: row.client_name,
    address: row.address,
    reportedProblem: row.reported_problem,
    notes: row.notes,
    visitDate: dateToJson(row.visit_date),
    visitTime: row.visit_time,
    technician: row.technician,
    visitValue: Number(row.visit_value || 0),
    partsValue: Number(row.parts_value || 0),
    status: row.status,
    conflictCount: Number(row.conflict_count || 0),
    createdAt: row.created_at ? new Date(row.created_at).toISOString() : null,
    updatedAt: row.updated_at ? new Date(row.updated_at).toISOString() : null,
  };
}

function normalizeOperatorName(value) {
  return String(value || '')
    .replace(/[\r\n\t]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 80);
}

function mobileUserFromRequest(req) {
  if (process.env.API_V1_ALLOW_MOBILE_NAME_AUTH === 'false') {
    return null;
  }

  const isMobile = String(req.get('x-corretivas-mobile') || '').toLowerCase() === 'true';
  const name = normalizeOperatorName(req.get('x-operator-name'));

  if (!isMobile || !name) {
    return null;
  }

  const uid = Buffer.from(name.toLowerCase(), 'utf8').toString('base64url').slice(0, 80);

  return {
    uid: `mobile:${uid}`,
    email: `${name} (app mobile)`,
    name,
    role: 'operacional',
    provider: 'mobile-name',
  };
}

function roleAllowed(user, roles) {
  return roles.length === 0 || roles.includes(user.role) || user.role === 'admin';
}

function authGate(roles = readRoles) {
  const mobileNameAuth = (req, res, next) => {
    const mobileUser = mobileUserFromRequest(req);

    if (!mobileUser) {
      return false;
    }

    if (!roleAllowed(mobileUser, roles)) {
      res.status(403).json({ error: 'Permissao insuficiente.' });
      return true;
    }

    req.user = mobileUser;
    next();
    return true;
  };

  if (process.env.API_V1_REQUIRE_AUTH === 'true') {
    const auth = requireAuth(roles);
    return (req, res, next) => {
      if (mobileNameAuth(req, res, next)) {
        return;
      }

      auth(req, res, next);
    };
  }

  return (req, res, next) => {
    if (mobileNameAuth(req, res, next)) {
      return;
    }

    req.user = req.user || { uid: 'dev', email: 'dev@local', role: 'admin', name: 'Desenvolvimento' };
    next();
  };
}

function asyncRoute(handler) {
  return (req, res, next) => Promise.resolve(handler(req, res, next)).catch(next);
}

async function firebasePasswordLogin(email, password) {
  if (!process.env.FIREBASE_WEB_API_KEY) {
    const error = new Error('FIREBASE_WEB_API_KEY nao configurada.');
    error.status = 503;
    throw error;
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:signInWithPassword?key=${process.env.FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ email, password, returnSecureToken: true }),
    },
  );
  const data = await response.json();

  if (!response.ok) {
    const error = new Error(data.error?.message || 'Falha no login Firebase.');
    error.status = 401;
    throw error;
  }

  return data;
}

async function recoverFirebasePassword(email) {
  if (!process.env.FIREBASE_WEB_API_KEY) {
    const error = new Error('FIREBASE_WEB_API_KEY nao configurada.');
    error.status = 503;
    throw error;
  }

  const response = await fetch(
    `https://identitytoolkit.googleapis.com/v1/accounts:sendOobCode?key=${process.env.FIREBASE_WEB_API_KEY}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ requestType: 'PASSWORD_RESET', email }),
    },
  );

  if (!response.ok) {
    const data = await response.json();
    const error = new Error(data.error?.message || 'Falha ao enviar recuperacao de senha.');
    error.status = 400;
    throw error;
  }
}

export function createV1Router({ broadcast }) {
  const router = express.Router();
  const loginSchema = z.object({ email: z.string().email(), password: z.string().min(1) });
  const recoverSchema = z.object({ email: z.string().email() });
  const fcmSchema = z.object({
    token: z.string().min(10),
    platform: z.string().default('android'),
  });
  const photoSchema = z.object({
    fileName: z.string().default('foto.jpg'),
    mimeType: z.string().default('image/jpeg'),
    dataBase64: z.string().min(10),
    uploadedBy: z.string().default('android'),
  });

  router.get('/health', (_req, res) => {
    res.json({
      ok: true,
      version: 'v1',
      backend: process.env.DATA_BACKEND === 'firebase' && firebaseConfigured() ? 'firebase' : 'sqlite',
      firebaseConfigured: firebaseConfigured(),
      authRequired: process.env.API_V1_REQUIRE_AUTH === 'true',
    });
  });

  router.get(
    '/dashboard',
    authGate(readRoles),
    asyncRoute(async (_req, res) => {
      const periodResult = await query(`SELECT * FROM periods WHERE status = 'active' ORDER BY year DESC LIMIT 1`);
      const period = periodResult.rows[0];

      if (!period) {
        res.json({ stats: null, lists: {}, charts: {} });
        return;
      }

      const month = monthRange();
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
      ] = await Promise.all([
        query('SELECT COUNT(*) AS total FROM corrective_occurrences WHERE period_id = $1', [period.id]),
        query('SELECT COUNT(*) AS total FROM command_registrations WHERE period_id = $1', [period.id]),
        query(
          `SELECT
            COUNT(*) AS total,
            SUM(CASE WHEN situation = 'com problema' THEN 1 ELSE 0 END) AS problem,
            SUM(CASE WHEN situation LIKE 'em observa%' THEN 1 ELSE 0 END) AS watching,
            SUM(CASE WHEN situation = 'em testes' THEN 1 ELSE 0 END) AS testing,
            SUM(CASE WHEN situation = 'ok' THEN 1 ELSE 0 END) AS ok
           FROM case_monitors`,
        ),
        query(`SELECT COUNT(*) AS total FROM appointments WHERE visit_date = $1 AND status <> 'cancelada'`, [today]),
        query(
          `SELECT *, (
            SELECT COUNT(*)
            FROM appointments same
            WHERE same.id <> appointments.id
              AND same.visit_date = appointments.visit_date
              AND COALESCE(same.visit_time, '') = COALESCE(appointments.visit_time, '')
              AND same.technician = appointments.technician
              AND same.status <> 'cancelada'
          ) AS conflict_count
           FROM appointments
           WHERE visit_date >= $1 AND status <> 'cancelada'
           ORDER BY visit_date ASC, COALESCE(visit_time, '') ASC, id ASC
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
      ]);

      const completedInMonth = Number(completedCorrectivesMonth.rows[0].total || 0);
      const appointmentsDone = Number(appointmentsMonth.rows[0].total || 0);
      const attendancesMonth = completedInMonth + appointmentsDone;

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
          attendancesMonth,
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
            percent: attendancesMonth ? Math.round((Number(row.total || 0) / attendancesMonth) * 1000) / 10 : 0,
          })),
          monthlyActivity: monthlyActivity.rows
            .map((row) => ({
              label: row.month,
              correctives: Number(row.correctives || 0),
              appointments: Number(row.appointments || 0),
            }))
            .reverse(),
        },
      });
    }),
  );

  router.get(
    '/dashboard/report',
    authGate(readRoles),
    asyncRoute(async (req, res) => {
      const report = await buildDashboardReport(req.query.metric, {
        periodId: req.query.periodId,
      });

      res.json(report);
    }),
  );

  router.post(
    '/auth/login',
    asyncRoute(async (req, res) => {
      const { email, password } = loginSchema.parse(req.body);

      if (firebaseConfigured() && process.env.FIREBASE_WEB_API_KEY) {
        const session = await firebasePasswordLogin(email, password);
        const auth = firebaseAuth();
        const user = auth ? await auth.getUser(session.localId) : null;
        const role = user?.customClaims?.role || user?.customClaims?.perfil || 'leitura';
        res.json({
          token: session.idToken,
          refreshToken: session.refreshToken,
          expiresIn: Number(session.expiresIn || 3600),
          user: {
            uid: session.localId,
            email,
            name: user?.displayName || email,
            role,
          },
        });
        return;
      }

      const ok = await validateLocalPassword(password);
      const allowedEmail = process.env.ADMIN_EMAIL || email;

      if (!ok || email !== allowedEmail) {
        const error = new Error('Credenciais invalidas.');
        error.status = 401;
        throw error;
      }

      const user = { uid: 'local-admin', email, name: 'Administrador', role: 'admin' };
      res.json({ token: signApiToken(user), expiresIn: 43_200, user });
    }),
  );

  router.post(
    '/auth/recover',
    asyncRoute(async (req, res) => {
      const { email } = recoverSchema.parse(req.body);

      if (firebaseConfigured()) {
        await recoverFirebasePassword(email);
      }

      res.json({ ok: true });
    }),
  );

  router.get('/auth/session', authGate(readRoles), (req, res) => {
    res.json({ user: req.user });
  });

  router.post('/auth/logout', authGate(readRoles), (_req, res) => {
    res.json({ ok: true });
  });

  router.get('/sync/events', (req, res) => {
    res.writeHead(200, {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    });
    res.write(`event: ready\ndata: ${JSON.stringify({ ok: true, version: 'v1' })}\n\n`);
    const listener = (payload) => res.write(`event: change\ndata: ${JSON.stringify(payload)}\n\n`);
    req.app.locals.v1Events.add(listener);
    req.on('close', () => req.app.locals.v1Events.delete(listener));
  });

  router.post(
    '/fcm/tokens',
    authGate(readRoles),
    asyncRoute(async (req, res) => {
      const payload = fcmSchema.parse(req.body);
      const { rows } = await query(
        `INSERT INTO fcm_tokens (user_id, token, platform)
         VALUES ($1, $2, $3)
         ON CONFLICT (token)
         DO UPDATE SET
           user_id = excluded.user_id,
           platform = excluded.platform,
           updated_at = datetime('now')
         RETURNING *`,
        [req.user.uid, payload.token, payload.platform],
      );
      const record = rows[0];
      await createRecord('auditoria', {
        userId: req.user.uid,
        userEmail: req.user.email,
        userName: req.user.name,
        operation: 'fcm-token',
        resource: 'fcm_tokens',
        recordId: payload.token,
        afterValue: JSON.stringify(payload),
      });
      res.status(201).json({ ok: true, record });
    }),
  );

  router.post(
    '/catracas/:id/anexos',
    authGate(technicianWritableRoles),
    asyncRoute(async (req, res) => {
      const payload = photoSchema.parse(req.body);
      const turnstile = await getRecord('catracas', req.params.id);

      if (!turnstile) {
        res.status(404).json({ error: 'Catraca nao encontrada.' });
        return;
      }

      const dataUrlMatch = payload.dataBase64.match(/^data:([^;]+);base64,(.+)$/);
      const mimeType = dataUrlMatch?.[1] || payload.mimeType;
      const base64 = dataUrlMatch?.[2] || payload.dataBase64;

      if (!mimeType.startsWith('image/')) {
        res.status(400).json({ error: 'Apenas imagens podem ser anexadas.' });
        return;
      }

      const originalBuffer = Buffer.from(base64, 'base64');
      const optimized = await sharp(originalBuffer, { failOn: 'warning' })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      const fileName = `${randomUUID()}.jpg`;
      const storagePath = `anexos/catracas/${req.params.id}/${fileName}`;
      let publicPath = '';
      const bucket = firebaseStorageBucket();

      if (process.env.DATA_BACKEND === 'firebase' && bucket) {
        const file = bucket.file(storagePath);
        await file.save(optimized.data, {
          metadata: {
            contentType: 'image/jpeg',
            metadata: {
              originalName: payload.fileName,
              uploadedBy: payload.uploadedBy,
            },
          },
        });
        publicPath = `gs://${bucket.name}/${storagePath}`;
      } else {
        const relativeDir = path.join('catracas', String(req.params.id));
        const absoluteDir = path.join(uploadDir, relativeDir);
        mkdirSync(absoluteDir, { recursive: true });
        const absolutePath = path.join(absoluteDir, fileName);
        writeFileSync(absolutePath, optimized.data);
        publicPath = `/api/uploads/${relativeDir.replaceAll(path.sep, '/')}/${fileName}`;
        await query(
          `INSERT INTO turnstile_photos (
            turnstile_id, file_name, original_name, mime_type, size_bytes,
            original_size_bytes, optimized_width, optimized_height,
            storage_path, public_path, uploaded_by
          )
          VALUES ($1, $2, $3, 'image/jpeg', $4, $5, $6, $7, $8, $9, $10)`,
          [
            Number(req.params.id),
            fileName,
            payload.fileName,
            optimized.data.length,
            originalBuffer.length,
            optimized.info.width,
            optimized.info.height,
            absolutePath,
            publicPath,
            payload.uploadedBy,
          ],
        );
      }

      await auditLog({
        user: req.user,
        operation: 'upload',
        resource: 'catracas/anexos',
        recordId: req.params.id,
        afterValue: { fileName, publicPath, sizeBytes: optimized.data.length },
      });
      broadcast({ version: 'v1', resource: 'catracas', action: 'photo-uploaded', id: req.params.id });
      res.status(201).json({
        record: {
          fileName,
          publicPath,
          mimeType: 'image/jpeg',
          sizeBytes: optimized.data.length,
          originalSizeBytes: originalBuffer.length,
          optimizedWidth: optimized.info.width,
          optimizedHeight: optimized.info.height,
        },
      });
    }),
  );

  router.get(
    '/catracas/:id/anexos',
    authGate(readRoles),
    asyncRoute(async (req, res) => {
      const { rows } = await query(
        `SELECT *
         FROM turnstile_photos
         WHERE turnstile_id = $1
         ORDER BY created_at DESC, id DESC`,
        [Number(req.params.id)],
      );

      res.json({ records: rows.map((row) => photoRecordToJson(req, row, 'turnstile_id')) });
    }),
  );

  router.delete(
    '/catracas/:id/anexos/:photoId',
    authGate(technicianWritableRoles),
    asyncRoute(async (req, res) => {
      const { rows } = await query(
        `SELECT *
         FROM turnstile_photos
         WHERE id = $1 AND turnstile_id = $2`,
        [Number(req.params.photoId), Number(req.params.id)],
      );

      if (!rows[0]) {
        res.status(404).json({ error: 'Foto nao encontrada.' });
        return;
      }

      await query('DELETE FROM turnstile_photos WHERE id = $1', [Number(req.params.photoId)]);
      await removeStoredPhotoFile(rows[0]);
      await auditLog({
        user: req.user,
        operation: 'delete',
        resource: 'catracas/anexos',
        recordId: req.params.photoId,
        beforeValue: photoRecordToJson(req, rows[0], 'turnstile_id'),
      });
      broadcast({ version: 'v1', resource: 'catracas', action: 'photo-deleted', id: req.params.id, photoId: req.params.photoId });
      res.status(204).end();
    }),
  );

  router.post(
    '/agendamentos/:id/anexos',
    authGate(technicianWritableRoles),
    asyncRoute(async (req, res) => {
      const payload = photoSchema.parse(req.body);
      const appointment = await getRecord('agendamentos', req.params.id);

      if (!appointment) {
        res.status(404).json({ error: 'Agendamento nao encontrado.' });
        return;
      }

      const dataUrlMatch = payload.dataBase64.match(/^data:([^;]+);base64,(.+)$/);
      const mimeType = dataUrlMatch?.[1] || payload.mimeType;
      const base64 = dataUrlMatch?.[2] || payload.dataBase64;

      if (!mimeType.startsWith('image/')) {
        res.status(400).json({ error: 'Apenas imagens podem ser anexadas.' });
        return;
      }

      const originalBuffer = Buffer.from(base64, 'base64');
      const optimized = await sharp(originalBuffer, { failOn: 'warning' })
        .rotate()
        .resize({ width: 1600, height: 1600, fit: 'inside', withoutEnlargement: true })
        .jpeg({ quality: 82, mozjpeg: true })
        .toBuffer({ resolveWithObject: true });

      const fileName = `${randomUUID()}.jpg`;
      const storagePath = `anexos/agendamentos/${req.params.id}/${fileName}`;
      let publicPath = '';
      const bucket = firebaseStorageBucket();

      if (process.env.DATA_BACKEND === 'firebase' && bucket) {
        const file = bucket.file(storagePath);
        await file.save(optimized.data, {
          metadata: {
            contentType: 'image/jpeg',
            metadata: {
              originalName: payload.fileName,
              uploadedBy: payload.uploadedBy,
            },
          },
        });
        publicPath = `gs://${bucket.name}/${storagePath}`;
      } else {
        const relativeDir = path.join('agendamentos', String(req.params.id));
        const absoluteDir = path.join(uploadDir, relativeDir);
        mkdirSync(absoluteDir, { recursive: true });
        const absolutePath = path.join(absoluteDir, fileName);
        writeFileSync(absolutePath, optimized.data);
        publicPath = `/api/uploads/${relativeDir.replaceAll(path.sep, '/')}/${fileName}`;
        await query(
          `INSERT INTO appointment_photos (
            appointment_id, file_name, original_name, mime_type, size_bytes,
            original_size_bytes, optimized_width, optimized_height,
            storage_path, public_path, uploaded_by
          )
          VALUES ($1, $2, $3, 'image/jpeg', $4, $5, $6, $7, $8, $9, $10)`,
          [
            Number(req.params.id),
            fileName,
            payload.fileName,
            optimized.data.length,
            originalBuffer.length,
            optimized.info.width,
            optimized.info.height,
            absolutePath,
            publicPath,
            payload.uploadedBy,
          ],
        );
      }

      await auditLog({
        user: req.user,
        operation: 'upload',
        resource: 'agendamentos/anexos',
        recordId: req.params.id,
        afterValue: { fileName, publicPath, sizeBytes: optimized.data.length },
      });
      broadcast({ version: 'v1', resource: 'agendamentos', action: 'photo-uploaded', id: req.params.id });
      res.status(201).json({
        record: {
          fileName,
          publicPath,
          mimeType: 'image/jpeg',
          sizeBytes: optimized.data.length,
          originalSizeBytes: originalBuffer.length,
          optimizedWidth: optimized.info.width,
          optimizedHeight: optimized.info.height,
        },
      });
    }),
  );

  router.get(
    '/agendamentos/:id/anexos',
    authGate(readRoles),
    asyncRoute(async (req, res) => {
      const { rows } = await query(
        `SELECT *
         FROM appointment_photos
         WHERE appointment_id = $1
         ORDER BY created_at DESC, id DESC`,
        [Number(req.params.id)],
      );

      res.json({ records: rows.map((row) => photoRecordToJson(req, row, 'appointment_id')) });
    }),
  );

  router.delete(
    '/agendamentos/:id/anexos/:photoId',
    authGate(technicianWritableRoles),
    asyncRoute(async (req, res) => {
      const { rows } = await query(
        `SELECT *
         FROM appointment_photos
         WHERE id = $1 AND appointment_id = $2`,
        [Number(req.params.photoId), Number(req.params.id)],
      );

      if (!rows[0]) {
        res.status(404).json({ error: 'Foto nao encontrada.' });
        return;
      }

      await query('DELETE FROM appointment_photos WHERE id = $1', [Number(req.params.photoId)]);
      await removeStoredPhotoFile(rows[0]);
      await auditLog({
        user: req.user,
        operation: 'delete',
        resource: 'agendamentos/anexos',
        recordId: req.params.photoId,
        beforeValue: photoRecordToJson(req, rows[0], 'appointment_id'),
      });
      broadcast({ version: 'v1', resource: 'agendamentos', action: 'photo-deleted', id: req.params.id, photoId: req.params.photoId });
      res.status(204).end();
    }),
  );

  router.get(
    '/relatorios/diario',
    authGate(readRoles),
    asyncRoute(async (req, res) => {
      const start = req.query.startDate || req.query.date || todayText();
      const end = req.query.endDate || req.query.date || start;
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

      res.json({ records: [...correctives.rows, ...appointments.rows] });
    }),
  );

  router.get(
    '/relatorios/mensal',
    authGate(readRoles),
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

  router.get(
    '/notificacoes',
    authGate(readRoles),
    asyncRoute(async (_req, res) => {
      const today = todayText();
      const [todayVisits, pendingCorrectives] = await Promise.all([
        query(
          `SELECT id, client_name, technician, visit_date
           FROM appointments
           WHERE visit_date = $1 AND status = 'agendada'
           ORDER BY COALESCE(visit_time, '') ASC, id ASC
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
      const records = [
        ...todayVisits.rows.map((row) => ({
          type: 'appointment',
          id: row.id,
          title: 'Visita agendada para hoje',
          message: `${row.client_name || 'Cliente'} - ${row.technician || 'sem tecnico'}`,
        })),
        ...pendingCorrectives.rows.map((row) => ({
          type: 'corrective',
          id: row.id,
          title: 'Ocorrencia pendente',
          message: `${row.client || 'Cliente'} - ${row.reason || 'sem motivo'}`,
        })),
      ];
      res.json({ records, count: records.length });
    }),
  );

  router.post(
    '/notificacoes/push',
    authGate(['admin', 'operacional']),
    asyncRoute(async (req, res) => {
      const title = String(req.body?.title || 'Corretivas');
      const body = String(req.body?.body || 'Nova notificacao');
      const tokens = Array.isArray(req.body?.tokens) ? req.body.tokens.filter(Boolean) : [];
      const messaging = firebaseMessaging();

      if (!messaging || !tokens.length) {
        await createRecord('logs', {
          level: 'info',
          message: 'Push registrado sem envio FCM',
          context: JSON.stringify({ title, body, tokens: tokens.length }),
        });
        res.json({ sent: 0, skipped: tokens.length });
        return;
      }

      const result = await messaging.sendEachForMulticast({ tokens, notification: { title, body } });
      res.json({ sent: result.successCount, failed: result.failureCount });
    }),
  );

  const domains = ['clientes', 'ocorrencias', 'agendamentos', 'comandas', 'catracas', 'tecnicos', 'auditoria', 'logs'];

  for (const domain of domains) {
    const writeRoles = domain === 'ocorrencias' || domain === 'agendamentos' || domain === 'catracas'
      ? technicianWritableRoles
      : writableRoles;

    router.get(
      `/${domain}`,
      authGate(readRoles),
      asyncRoute(async (req, res) => {
        const records = await listRecords(domain, req.query);
        res.json({ records });
      }),
    );

    router.get(
      `/${domain}/:id`,
      authGate(readRoles),
      asyncRoute(async (req, res) => {
        const record = await getRecord(domain, req.params.id);

        if (!record) {
          res.status(404).json({ error: 'Registro nao encontrado.' });
          return;
        }

        res.json({ record });
      }),
    );

    router.post(
      `/${domain}`,
      authGate(writeRoles),
      asyncRoute(async (req, res) => {
        const record = await createRecord(domain, req.body || {});
        await auditLog({ user: req.user, operation: 'create', resource: domain, recordId: record.id, afterValue: record });
        const event = { version: 'v1', resource: domain, action: 'created', id: record.id };

        if (domain === 'agendamentos') {
          event.notification = buildAppointmentScheduledNotification(record);
          event.sourceDeviceId = String(req.get('x-device-id') || '');
          await sendAppointmentScheduledNotification(record, {
            excludeToken: req.get('x-fcm-token'),
          });
        }

        broadcast(event);
        res.status(201).json({ record });
      }),
    );

    router.put(
      `/${domain}/:id`,
      authGate(writeRoles),
      asyncRoute(async (req, res) => {
        const before = await getRecord(domain, req.params.id);
        const record = await updateRecord(domain, req.params.id, req.body || {});

        if (!record) {
          res.status(404).json({ error: 'Registro nao encontrado.' });
          return;
        }

        await auditLog({ user: req.user, operation: 'update', resource: domain, recordId: record.id, beforeValue: before, afterValue: record });
        broadcast({ version: 'v1', resource: domain, action: 'updated', id: record.id });
        res.json({ record });
      }),
    );

    router.delete(
      `/${domain}/:id`,
      authGate(writableRoles),
      asyncRoute(async (req, res) => {
        const before = await getRecord(domain, req.params.id);
        await deleteRecord(domain, req.params.id);
        await auditLog({ user: req.user, operation: 'delete', resource: domain, recordId: req.params.id, beforeValue: before });
        broadcast({ version: 'v1', resource: domain, action: 'deleted', id: req.params.id });
        res.status(204).end();
      }),
    );
  }

  router.use((error, _req, res, _next) => {
    if (error instanceof z.ZodError) {
      res.status(400).json({ error: 'Dados invalidos.', details: error.flatten() });
      return;
    }

    logger.error({ stack: error.stack }, error.message);
    res.status(error.status || 500).json({ error: error.message || 'Erro interno.' });
  });

  return router;
}
