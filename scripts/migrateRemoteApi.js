import 'dotenv/config';
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { countSnapshot, readSqliteSnapshot, sqlitePath, writeBackup } from './firebase/common.js';

const defaultBaseUrl = process.env.REMOTE_API_URL || 'https://corretivas.up.railway.app';

const options = parseArgs(process.argv.slice(2));
const baseUrl = normalizeBaseUrl(options.baseUrl || defaultBaseUrl);
const apply = options.apply;
const force = options.force;
const operatorName = options.operatorName || 'Migracao Railway';

const resources = [
  {
    resource: 'clientes',
    table: 'clients',
    fields: {
      name: 'name',
      address: 'address',
      contact: 'contact',
      notes: 'notes',
    },
  },
  {
    resource: 'tecnicos',
    table: 'technicians',
    fields: {
      name: 'name',
      email: 'email',
      phone: 'phone',
      role: 'role',
      active: 'active',
    },
  },
  {
    resource: 'ocorrencias',
    table: 'corrective_occurrences',
    fields: {
      occurrence_date: 'occurrenceDate',
      client: 'client',
      contact: 'contact',
      requester_name: 'requesterName',
      reason: 'reason',
      resolution: 'resolution',
      difficulty: 'difficulty',
      technician: 'technician',
      backup_status: 'backupStatus',
      firewall_status: 'firewallStatus',
      power_options_status: 'powerOptionsStatus',
      solution_date: 'solutionDate',
    },
  },
  {
    resource: 'agendamentos',
    table: 'appointments',
    fields: {
      client_name: 'clientName',
      address: 'address',
      reported_problem: 'reportedProblem',
      notes: 'notes',
      annotations: 'annotations',
      visit_type: 'visitType',
      visit_date: 'visitDate',
      visit_time: 'visitTime',
      technician: 'technician',
      visit_value: 'visitValue',
      parts_value: 'partsValue',
      status: 'status',
    },
  },
  {
    resource: 'comandas',
    table: 'command_registrations',
    fields: {
      bakery: 'bakery',
      quantity: 'quantity',
      dm_conf: 'dmConf',
      dm_cad: 'dmCad',
      dm_imp: 'dmImp',
      exacta_registrar: 'exactaRegistrar',
      client_registrar: 'clientRegistrar',
    },
  },
  {
    resource: 'catracas',
    table: 'turnstiles',
    fields: {
      client_name: 'clientName',
      model: 'model',
      client_address: 'clientAddress',
      expected_delivery_date: 'expectedDeliveryDate',
      notes: 'notes',
      status: 'status',
    },
  },
  {
    resource: 'anotacoes',
    table: 'system_notes',
    fields: {
      title: 'title',
      content: 'content',
      created_by: 'createdBy',
    },
  },
  {
    resource: 'empresas',
    table: 'companies',
    fields: {
      name: 'name',
      cnpj: 'cnpj',
      system_name: 'systemName',
      xml: 'xml',
      ip: 'ip',
      port: 'port',
      turnstile_type: 'turnstileType',
      anydesk: 'anydesk',
      notes: 'notes',
    },
  },
];

function parseArgs(args) {
  return args.reduce(
    (parsed, arg) => {
      if (arg === '--apply') {
        parsed.apply = true;
        return parsed;
      }

      if (arg === '--force') {
        parsed.force = true;
        return parsed;
      }

      const [key, value] = arg.split('=');
      if (key === '--base-url') {
        parsed.baseUrl = value;
      }
      if (key === '--operator') {
        parsed.operatorName = value;
      }
      return parsed;
    },
    { apply: false, force: false },
  );
}

function normalizeBaseUrl(value) {
  return String(value || '').replace(/\/+$/, '');
}

function checkpointSqlite() {
  const db = new DatabaseSync(sqlitePath);
  try {
    db.exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } finally {
    db.close();
  }
}

function payloadFromRow(row, fields) {
  return Object.fromEntries(
    Object.entries(fields)
      .filter(([dbKey]) => row[dbKey] !== undefined)
      .map(([dbKey, apiKey]) => [apiKey, row[dbKey]]),
  );
}

async function request(method, route, body) {
  const response = await fetch(`${baseUrl}${route}`, {
    method,
    headers: {
      'Content-Type': 'application/json',
      'X-Corretivas-Mobile': 'true',
      'X-Operator-Name': operatorName,
    },
    body: body ? JSON.stringify(body) : undefined,
  });

  if (!response.ok) {
    const text = await response.text();
    throw new Error(`${method} ${route} falhou com HTTP ${response.status}: ${text}`);
  }

  if (response.status === 204) {
    return null;
  }

  return response.json();
}

async function remoteCount(resource) {
  const data = await request('GET', `/api/v1/${resource}?limit=1`);
  return Array.isArray(data.records) ? data.records.length : 0;
}

async function assertRemoteIsReady() {
  const health = await request('GET', '/api/v1/health');
  if (!health.ok) {
    throw new Error('API remota nao retornou ok=true.');
  }
  return health;
}

async function assertRemoteIsEmpty() {
  const nonEmpty = [];

  for (const config of resources) {
    const count = await remoteCount(config.resource);
    if (count > 0) {
      nonEmpty.push(config.resource);
    }
  }

  if (nonEmpty.length && !force) {
    throw new Error(
      `A API remota ja possui dados em: ${nonEmpty.join(', ')}. Use --force somente se quiser importar mesmo assim.`,
    );
  }
}

async function importResource(config, rows) {
  let imported = 0;
  const idMap = new Map();

  for (const row of rows.sort((a, b) => Number(a.id) - Number(b.id))) {
    const payload = payloadFromRow(row, config.fields);
    const result = await request('POST', `/api/v1/${config.resource}`, payload);
    imported += 1;
    idMap.set(String(row.id), String(result.record.id));

    if (imported % 50 === 0) {
      console.log(`${config.resource}: ${imported}/${rows.length}`);
    }
  }

  return idMap;
}

function photoFilePath(photo) {
  if (photo.storage_path && existsSync(photo.storage_path)) {
    return photo.storage_path;
  }

  if (photo.public_path) {
    const relative = photo.public_path.replace(/^\/api\/uploads\//, '');
    const candidate = path.join(path.dirname(sqlitePath), 'uploads', relative);
    if (existsSync(candidate)) {
      return candidate;
    }
  }

  return null;
}

async function importPhotos(photos, idMap, options) {
  let imported = 0;

  for (const photo of photos) {
    const remoteRecordId = idMap.get(String(photo[options.idField]));
    const filePath = photoFilePath(photo);

    if (!remoteRecordId || !filePath) {
      console.warn(`Foto ignorada por falta de ${options.label}/arquivo: ${photo.id}`);
      continue;
    }

    await request('POST', `/api/${options.resource}/${remoteRecordId}/photos`, {
      fileName: photo.original_name || photo.file_name || 'foto.jpg',
      mimeType: photo.mime_type || 'image/jpeg',
      uploadedBy: photo.uploaded_by || operatorName,
      dataBase64: readFileSync(filePath).toString('base64'),
    });
    imported += 1;
  }

  return imported;
}

checkpointSqlite();
const snapshot = readSqliteSnapshot();
const localCounts = countSnapshot(snapshot);

console.log(`API remota: ${baseUrl}`);
console.table(localCounts);

const health = await assertRemoteIsReady();
console.log(`API remota OK: backend=${health.backend}, authRequired=${health.authRequired}`);

await assertRemoteIsEmpty();

if (!apply) {
  console.log('Modo simulacao. Nenhum dado foi enviado.');
  console.log(`Para importar, execute: node scripts/migrateRemoteApi.js --base-url=${baseUrl} --apply`);
  process.exit(0);
}

const backupPath = writeBackup(snapshot);
console.log(`Backup local criado antes da migracao: ${backupPath}`);

const idMaps = {};
for (const config of resources) {
  const rows = snapshot[config.table] || [];
  idMaps[config.resource] = await importResource(config, rows);
  console.log(`${config.resource}: ${rows.length} importados`);
}

const importedTurnstilePhotos = await importPhotos(snapshot.turnstile_photos || [], idMaps.catracas, {
  resource: 'turnstiles',
  idField: 'turnstile_id',
  label: 'catraca',
});
const importedAppointmentPhotos = await importPhotos(snapshot.appointment_photos || [], idMaps.agendamentos, {
  resource: 'appointments',
  idField: 'appointment_id',
  label: 'agendamento',
});
console.log(`fotos de catracas: ${importedTurnstilePhotos} importadas`);
console.log(`fotos de agendamentos: ${importedAppointmentPhotos} importadas`);
console.log('Migracao finalizada.');
