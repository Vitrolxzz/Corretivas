import { query } from '../db.js';
import { FieldValue, firestore } from '../firebase.js';

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
      visitDate: 'visit_date',
      visitTime: 'visit_time',
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

function normalizeClientName(value) {
  return String(value || '').trim().toLocaleUpperCase('pt-BR');
}

function normalizeTechnicianName(value) {
  const text = String(value || '').trim();

  if (text.toLocaleLowerCase('pt-BR') === 'vittor') {
    return 'Vittor';
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

  if (backend() === 'firebase') {
    const db = firestore();
    const snapshot = await db.collection(config.collection).limit(limit).get();
    return snapshot.docs.map((doc) => ({ id: doc.id, ...doc.data() }));
  }

  if (resource === 'clientes') {
    const { rows } = await query(
      `SELECT name, MAX(address) AS address, MAX(contact) AS contact, MAX(notes) AS notes
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
       ORDER BY name COLLATE NOCASE
       LIMIT $1`,
      [limit],
    );
    return rows.map((row) => ({ id: row.name, ...row }));
  }

  const { rows } = await query(`SELECT * FROM ${config.table} ORDER BY id DESC LIMIT $1`, [limit]);
  return rows.map((row) => toApi(row, config));
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
