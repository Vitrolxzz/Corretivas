import { query } from '../db.js';
import { FieldValue, firestore } from '../firebase.js';
import { normalizeClientName } from '../clientNames.js';

const resources = {
  clientes: {
    table: 'clients',
    collection: 'clientes',
    clientFields: ['name'],
    fields: {
      name: 'name',
      address: 'address',
      contact: 'contact',
      notes: 'notes',
    },
  },
  tecnicos: {
    table: 'technicians',
    collection: 'tecnicos',
    technicianFields: ['name'],
    fields: {
      name: 'name',
      email: 'email',
      phone: 'phone',
      role: 'role',
      active: 'active',
    },
  },
  ocorrencias: {
    table: 'corrective_occurrences',
    collection: 'ocorrencias',
    dateFields: ['occurrenceDate', 'solutionDate'],
    clientFields: ['client'],
    technicianFields: ['technician'],
    fields: {
      periodId: 'period_id',
      occurrenceDate: 'occurrence_date',
      client: 'client',
      contact: 'contact',
      requesterName: 'requester_name',
      reason: 'reason',
      resolution: 'resolution',
      difficulty: 'difficulty',
      technician: 'technician',
      backupStatus: 'backup_status',
      firewallStatus: 'firewall_status',
      powerOptionsStatus: 'power_options_status',
      solutionDate: 'solution_date',
    },
  },
  agendamentos: {
    table: 'appointments',
    collection: 'agendamentos',
    dateFields: ['visitDate'],
    clientFields: ['clientName'],
    technicianFields: ['technician'],
    fields: {
      clientName: 'client_name',
      address: 'address',
      reportedProblem: 'reported_problem',
      notes: 'notes',
      annotations: 'annotations',
      visitType: 'visit_type',
      visitDate: 'visit_date',
      technician: 'technician',
      visitValue: 'visit_value',
      partsValue: 'parts_value',
      status: 'status',
    },
  },
  comandas: {
    table: 'command_registrations',
    collection: 'comandas',
    clientFields: ['bakery'],
    technicianFields: ['exactaRegistrar', 'clientRegistrar'],
    fields: {
      periodId: 'period_id',
      bakery: 'bakery',
      dmConf: 'dm_conf',
      dmCad: 'dm_cad',
      dmImp: 'dm_imp',
      exactaRegistrar: 'exacta_registrar',
      clientRegistrar: 'client_registrar',
    },
  },
  catracas: {
    table: 'turnstiles',
    collection: 'catracas',
    dateFields: ['expectedDeliveryDate'],
    clientFields: ['clientName'],
    fields: {
      clientName: 'client_name',
      model: 'model',
      clientAddress: 'client_address',
      expectedDeliveryDate: 'expected_delivery_date',
      notes: 'notes',
      status: 'status',
    },
  },
  anotacoes: {
    table: 'system_notes',
    collection: 'anotacoes',
    fields: {
      title: 'title',
      content: 'content',
      createdBy: 'created_by',
    },
  },
  empresas: {
    table: 'companies',
    collection: 'empresas',
    fields: {
      name: 'name',
      cnpj: 'cnpj',
      systemName: 'system_name',
      xml: 'xml',
      ip: 'ip',
      port: 'port',
      turnstileType: 'turnstile_type',
      anydesk: 'anydesk',
      notes: 'notes',
    },
  },
  auditoria: {
    table: 'audit_logs',
    collection: 'auditoria',
    fields: {
      userId: 'user_id',
      userEmail: 'user_email',
      userName: 'user_name',
      operation: 'operation',
      resource: 'resource',
      recordId: 'record_id',
      beforeValue: 'before_value',
      afterValue: 'after_value',
    },
  },
  logs: {
    table: 'system_logs',
    collection: 'logs',
    fields: {
      level: 'level',
      message: 'message',
      context: 'context',
    },
  },
  fcm_tokens: {
    table: 'fcm_tokens',
    collection: 'fcm_tokens',
    fields: {
      userId: 'user_id',
      token: 'token',
      platform: 'platform',
    },
  },
};

export function resourceConfig(name) {
  const config = resources[name];
  if (!config) {
    const error = new Error('Recurso nao encontrado.');
    error.status = 404;
    throw error;
  }
  return config;
}

function backend() {
  return process.env.DATA_BACKEND === 'firebase' && firestore() ? 'firebase' : 'sqlite';
}

function normalizeDate(value) {
  if (value === null || value === undefined || value === '') {
    return null;
  }

  const text = String(value).trim();
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

  const error = new Error('Data invalida. Use o formato AAAA-MM-DD, DD/MM/AAAA ou DD/MM.');
  error.status = 400;
  throw error;
}

function normalizeTechnicianName(value) {
  const text = String(value || '').trim();

  if (text.toLocaleLowerCase('pt-BR') === 'vittor') {
    return 'Vittor';
  }

  return text;
}

function normalizeAppointmentVisitType(value) {
  const text = String(value || '').trim().toLowerCase();

  if (!text) {
    return '';
  }

  if (text !== 'normal' && text !== 'garantia' && text !== 'retorno') {
    const error = new Error('Tipo visita invalido. Use normal, garantia ou retorno.');
    error.status = 400;
    throw error;
  }

  return text;
}

function normalizePayload(body, config) {
  const normalized = { ...body };

  for (const field of config.dateFields || []) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      normalized[field] = normalizeDate(normalized[field]);
    }
  }

  for (const field of config.clientFields || []) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      normalized[field] = normalizeClientName(normalized[field]);
    }
  }

  for (const field of config.technicianFields || []) {
    if (Object.prototype.hasOwnProperty.call(normalized, field)) {
      normalized[field] = normalizeTechnicianName(normalized[field]);
    }
  }

  if (config.table === 'appointments' && Object.prototype.hasOwnProperty.call(normalized, 'visitType')) {
    normalized.visitType = normalizeAppointmentVisitType(normalized.visitType);
    if (normalized.visitType === 'garantia' || normalized.visitType === 'retorno') {
      normalized.visitValue = 0;
      normalized.partsValue = 0;
    }
  }

  if (config.table === 'system_notes') {
    const title = String(normalized.title || '').trim();
    const content = String(normalized.content || '').trim();

    if (!title && !content) {
      const error = new Error('Informe um titulo ou uma anotacao.');
      error.status = 400;
      throw error;
    }
  }

  if (config.table === 'companies' && Object.prototype.hasOwnProperty.call(normalized, 'xml')) {
    const text = String(normalized.xml || '').trim().toLowerCase();
    normalized.xml = !text || text === 'nao' ? 'não' : text;

    if (normalized.xml !== 'sim' && normalized.xml !== 'não') {
      const error = new Error('XML invalido. Use sim ou não.');
      error.status = 400;
      throw error;
    }
  }

  return normalized;
}

function toApi(row, config) {
  const inverted = Object.fromEntries(Object.entries(config.fields).map(([apiKey, dbKey]) => [dbKey, apiKey]));
  const record = {};

  for (const [key, value] of Object.entries(row)) {
    record[inverted[key] || key.replace(/_([a-z])/g, (_, letter) => letter.toUpperCase())] = value;
  }

  if (record.id !== undefined) {
    record.id = String(record.id);
  }

  return record;
}

function toDb(body, config) {
  const mapped = {};
  const normalized = normalizePayload(body, config);

  for (const [apiKey, dbKey] of Object.entries(config.fields)) {
    if (Object.prototype.hasOwnProperty.call(normalized, apiKey)) {
      mapped[dbKey] = normalized[apiKey];
    }
  }

  return mapped;
}

export async function listRecords(resource, options = {}) {
  const config = resourceConfig(resource);
  const limit = Math.min(200, Math.max(1, Number(options.limit || 50)));
  const page = Math.max(1, Math.trunc(Number(options.page || 1)) || 1);
  const offset = (page - 1) * limit;
  const paginated = (records, total) => ({
    records,
    total: Number(total || 0),
    page,
    limit,
  });

  if (backend() === 'firebase') {
    const db = firestore();
    let ref = db.collection(config.collection);

    if (resource === 'agendamentos') {
      const visitType = normalizeAppointmentVisitType(options.visitType);

      if (visitType) {
        ref = ref.where('visitType', '==', visitType);
      }
    }

    const snapshot = await ref.get();
    const records = snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
    return paginated(records.slice(offset, offset + limit), records.length);
  }

  if (resource === 'clientes') {
    const baseSql = `SELECT name, MAX(address) AS address, MAX(contact) AS contact, MAX(notes) AS notes
       FROM (
         SELECT name, address, contact, notes FROM clients WHERE name <> ''
         UNION ALL
         SELECT client AS name, '' AS address, contact, requester_name AS notes FROM corrective_occurrences WHERE client <> ''
         UNION ALL
         SELECT client_name AS name, address, '' AS contact, reported_problem AS notes FROM appointments WHERE client_name <> ''
         UNION ALL
         SELECT bakery AS name, '' AS address, '' AS contact, '' AS notes FROM command_registrations WHERE bakery <> ''
         UNION ALL
         SELECT client_name AS name, client_address AS address, '' AS contact, notes FROM turnstiles WHERE client_name <> ''
       )
       GROUP BY name
       ORDER BY name COLLATE NOCASE`;
    const [total, result] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM (${baseSql}) AS clients_total`),
      query(`${baseSql} LIMIT $1 OFFSET $2`, [limit, offset]),
    ]);
    return paginated(
      result.rows.map((row) => ({ id: row.name, ...row })),
      total.rows[0].total,
    );
  }

  if (resource === 'agendamentos') {
    const visitType = normalizeAppointmentVisitType(options.visitType);
    const params = [];
    const whereParts = [];

    if (visitType) {
      params.push(visitType);
      whereParts.push(`visit_type = $${params.length}`);
    }

    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const [total, result] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM appointments ${where}`, params),
      query(
        `SELECT appointments.*, 0 AS conflict_count, (
        SELECT COUNT(*) FROM appointment_photos WHERE appointment_id = appointments.id
       ) AS photo_count
       FROM appointments
       ${where}
       ORDER BY id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);
    return paginated(result.rows.map((row) => toApi(row, config)), total.rows[0].total);
  }

  if (resource === 'catracas') {
    const [total, result] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM turnstiles`),
      query(
        `SELECT turnstiles.*, (
        SELECT COUNT(*) FROM turnstile_photos WHERE turnstile_id = turnstiles.id
       ) AS photo_count
       FROM turnstiles
       ORDER BY id DESC
       LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
    ]);
    return paginated(result.rows.map((row) => toApi(row, config)), total.rows[0].total);
  }

  if (resource === 'anotacoes') {
    const [total, result] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM system_notes`),
      query(
        `SELECT *
       FROM system_notes
       ORDER BY updated_at DESC, id DESC
       LIMIT $1 OFFSET $2`,
        [limit, offset],
      ),
    ]);
    return paginated(result.rows.map((row) => toApi(row, config)), total.rows[0].total);
  }

  if (resource === 'empresas') {
    const search = String(options.search || '').trim();
    const params = [];
    const whereParts = [];

    if (search) {
      params.push(`%${search}%`);
      whereParts.push(`(
        name LIKE $${params.length} COLLATE NOCASE
        OR cnpj LIKE $${params.length} COLLATE NOCASE
      )`);
    }

    const where = whereParts.length ? `WHERE ${whereParts.join(' AND ')}` : '';
    const [total, result] = await Promise.all([
      query(`SELECT COUNT(*) AS total FROM companies ${where}`, params),
      query(
        `SELECT *
       FROM companies
       ${where}
       ORDER BY name COLLATE NOCASE, id DESC
       LIMIT $${params.length + 1} OFFSET $${params.length + 2}`,
        [...params, limit, offset],
      ),
    ]);
    return paginated(result.rows.map((row) => toApi(row, config)), total.rows[0].total);
  }

  const [total, result] = await Promise.all([
    query(`SELECT COUNT(*) AS total FROM ${config.table}`),
    query(`SELECT * FROM ${config.table} ORDER BY id DESC LIMIT $1 OFFSET $2`, [limit, offset]),
  ]);
  return paginated(result.rows.map((row) => toApi(row, config)), total.rows[0].total);
}

export async function appointmentVisitTypeSummary() {
  if (backend() === 'firebase') {
    const snapshot = await firestore().collection('agendamentos').get();
    const rows = snapshot.docs.map((doc) => doc.data());
    const total = rows.length;
    const garantia = rows.filter((row) => row.visitType === 'garantia').length;
    const retorno = rows.filter((row) => row.visitType === 'retorno').length;
    const average = (value) => (total ? Math.round((Number(value || 0) / total) * 100) : 0);

    return {
      total,
      garantia: { total: garantia, average: average(garantia) },
      retorno: { total: retorno, average: average(retorno) },
    };
  }

  const { rows } = await query(
    `SELECT
      COUNT(*) AS total,
      SUM(CASE WHEN visit_type = 'garantia' THEN 1 ELSE 0 END) AS garantia,
      SUM(CASE WHEN visit_type = 'retorno' THEN 1 ELSE 0 END) AS retorno
     FROM appointments`,
  );
  const total = Number(rows[0]?.total || 0);
  const garantia = Number(rows[0]?.garantia || 0);
  const retorno = Number(rows[0]?.retorno || 0);
  const average = (value) => (total ? Math.round((Number(value || 0) / total) * 100) : 0);

  return {
    total,
    garantia: { total: garantia, average: average(garantia) },
    retorno: { total: retorno, average: average(retorno) },
  };
}

export async function getRecord(resource, id) {
  const config = resourceConfig(resource);

  if (backend() === 'firebase') {
    const doc = await firestore().collection(config.collection).doc(String(id)).get();

    if (!doc.exists) {
      return null;
    }

    return { id: doc.id, ...doc.data() };
  }

  if (resource === 'agendamentos') {
    const { rows } = await query(
      `SELECT appointments.*, (
        SELECT COUNT(*) FROM appointment_photos WHERE appointment_id = appointments.id
       ) AS photo_count
       FROM appointments
       WHERE id = $1`,
      [Number(id)],
    );
    return rows[0] ? toApi(rows[0], config) : null;
  }

  if (resource === 'catracas') {
    const { rows } = await query(
      `SELECT turnstiles.*, (
        SELECT COUNT(*) FROM turnstile_photos WHERE turnstile_id = turnstiles.id
       ) AS photo_count
       FROM turnstiles
       WHERE id = $1`,
      [Number(id)],
    );
    return rows[0] ? toApi(rows[0], config) : null;
  }

  const { rows } = await query(`SELECT * FROM ${config.table} WHERE id = $1`, [Number(id)]);
  return rows[0] ? toApi(rows[0], config) : null;
}

export async function createRecord(resource, body) {
  const config = resourceConfig(resource);
  const normalizedBody = normalizePayload(body, config);

  if (backend() === 'firebase') {
    const payload = { ...normalizedBody, createdAt: FieldValue.serverTimestamp(), updatedAt: FieldValue.serverTimestamp() };
    const doc = await firestore().collection(config.collection).add(payload);
    return { id: doc.id, ...payload };
  }

  const mapped = toDb(normalizedBody, config);

  if ((resource === 'ocorrencias' || resource === 'comandas') && !mapped.period_id) {
    const active = await query(`SELECT id FROM periods WHERE status = 'active' ORDER BY year DESC LIMIT 1`);
    mapped.period_id = active.rows[0]?.id;
  }

  const columns = Object.keys(mapped);
  const values = Object.values(mapped);
  const placeholders = columns.map((_, index) => `$${index + 1}`).join(', ');
  const result = await query(
    `INSERT INTO ${config.table} (${columns.join(', ')})
     VALUES (${placeholders})
     RETURNING *`,
    values,
  );
  return toApi(result.rows[0], config);
}

export async function updateRecord(resource, id, body) {
  const config = resourceConfig(resource);
  const normalizedBody = normalizePayload(body, config);

  if (backend() === 'firebase') {
    const ref = firestore().collection(config.collection).doc(String(id));
    await ref.set({ ...normalizedBody, updatedAt: FieldValue.serverTimestamp() }, { merge: true });
    const updated = await ref.get();
    return { id: updated.id, ...updated.data() };
  }

  const mapped = toDb(normalizedBody, config);
  const columns = Object.keys(mapped);

  if (!columns.length) {
    return getRecord(resource, id);
  }

  const setters = columns.map((column, index) => `${column} = $${index + 2}`).join(', ');
  const result = await query(
    `UPDATE ${config.table}
     SET ${setters}
     WHERE id = $1
     RETURNING *`,
    [Number(id), ...Object.values(mapped)],
  );
  return result.rows[0] ? toApi(result.rows[0], config) : null;
}

export async function deleteRecord(resource, id) {
  const config = resourceConfig(resource);

  if (backend() === 'firebase') {
    await firestore().collection(config.collection).doc(String(id)).delete();
    return true;
  }

  await query(`DELETE FROM ${config.table} WHERE id = $1`, [Number(id)]);
  return true;
}

export async function auditLog({ user, operation, resource, recordId, beforeValue, afterValue }) {
  const payload = {
    userId: user?.uid || '',
    userEmail: user?.email || '',
    userName: user?.name || user?.email || '',
    operation,
    resource,
    recordId: String(recordId || ''),
    beforeValue: beforeValue ? JSON.stringify(beforeValue) : null,
    afterValue: afterValue ? JSON.stringify(afterValue) : null,
  };

  await createRecord('auditoria', payload);
}
