import { fileURLToPath } from 'node:url';
import { closePool, databasePath, getDefaultYear, query } from './db.js';

const schema = [
  `CREATE TABLE IF NOT EXISTS periods (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    year INTEGER NOT NULL UNIQUE,
    status TEXT NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    started_at TEXT NOT NULL DEFAULT (date('now')),
    closed_at TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE UNIQUE INDEX IF NOT EXISTS periods_single_active_idx
    ON periods (status)
    WHERE status = 'active'`,
  `CREATE TABLE IF NOT EXISTS corrective_occurrences (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id INTEGER NOT NULL REFERENCES periods(id) ON DELETE RESTRICT,
    occurrence_date TEXT,
    client TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    requester_name TEXT NOT NULL DEFAULT '',
    reason TEXT NOT NULL DEFAULT '',
    resolution TEXT NOT NULL DEFAULT '',
    difficulty INTEGER CHECK (difficulty BETWEEN 1 AND 5),
    technician TEXT NOT NULL DEFAULT '',
    backup_status TEXT NOT NULL DEFAULT 'Nulo' CHECK (backup_status IN ('Ok', 'Nulo')),
    firewall_status TEXT NOT NULL DEFAULT 'Nulo' CHECK (firewall_status IN ('Ok', 'Nulo')),
    power_options_status TEXT NOT NULL DEFAULT 'Nulo' CHECK (power_options_status IN ('Ok', 'Nulo')),
    solution_date TEXT,
    source_hash TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (period_id, source_hash)
  )`,
  `CREATE INDEX IF NOT EXISTS corrective_period_date_idx
    ON corrective_occurrences (period_id, occurrence_date DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS corrective_client_idx
    ON corrective_occurrences (client COLLATE NOCASE)`,
  `CREATE INDEX IF NOT EXISTS corrective_period_client_idx
    ON corrective_occurrences (period_id, client COLLATE NOCASE, id DESC)`,
  `CREATE TABLE IF NOT EXISTS case_monitors (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL DEFAULT '',
    start_date TEXT,
    situation TEXT NOT NULL DEFAULT 'com problema'
      CHECK (situation IN ('com problema', 'em observação', 'em testes', 'ok')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS case_monitor_situation_idx
    ON case_monitors (situation, start_date DESC, id DESC)`,
  `CREATE INDEX IF NOT EXISTS case_monitor_client_idx
    ON case_monitors (client_name COLLATE NOCASE)`,
  `CREATE TABLE IF NOT EXISTS command_registrations (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    period_id INTEGER NOT NULL REFERENCES periods(id) ON DELETE RESTRICT,
    bakery TEXT NOT NULL DEFAULT '',
    dm_conf TEXT NOT NULL DEFAULT '',
    dm_cad TEXT NOT NULL DEFAULT '',
    dm_imp TEXT NOT NULL DEFAULT '',
    exacta_registrar TEXT NOT NULL DEFAULT '',
    client_registrar TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS command_period_bakery_idx
    ON command_registrations (period_id, bakery COLLATE NOCASE, id DESC)`,
  `CREATE TABLE IF NOT EXISTS clients (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    contact TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (name COLLATE NOCASE)
  )`,
  `CREATE INDEX IF NOT EXISTS client_name_idx
    ON clients (name COLLATE NOCASE)`,
  `CREATE TABLE IF NOT EXISTS technicians (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    name TEXT NOT NULL DEFAULT '',
    email TEXT NOT NULL DEFAULT '',
    phone TEXT NOT NULL DEFAULT '',
    role TEXT NOT NULL DEFAULT 'tecnico',
    active INTEGER NOT NULL DEFAULT 1,
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (name COLLATE NOCASE)
  )`,
  `CREATE INDEX IF NOT EXISTS technician_name_idx
    ON technicians (name COLLATE NOCASE)`,
  `CREATE TABLE IF NOT EXISTS appointments (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL DEFAULT '',
    address TEXT NOT NULL DEFAULT '',
    reported_problem TEXT NOT NULL DEFAULT '',
    notes TEXT NOT NULL DEFAULT '',
    visit_date TEXT,
    visit_time TEXT,
    technician TEXT NOT NULL DEFAULT '',
    visit_value REAL NOT NULL DEFAULT 0,
    parts_value REAL NOT NULL DEFAULT 0,
    status TEXT NOT NULL DEFAULT 'agendada'
      CHECK (status IN ('agendada', 'realizada', 'cancelada')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS appointment_date_idx
    ON appointments (visit_date, visit_time, id DESC)`,
  `CREATE INDEX IF NOT EXISTS appointment_technician_idx
    ON appointments (technician COLLATE NOCASE, visit_date, id DESC)`,
  `CREATE INDEX IF NOT EXISTS appointment_client_idx
    ON appointments (client_name COLLATE NOCASE, id DESC)`,
  `CREATE TABLE IF NOT EXISTS turnstiles (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    client_name TEXT NOT NULL DEFAULT '',
    model TEXT NOT NULL DEFAULT '',
    client_address TEXT NOT NULL DEFAULT '',
    expected_delivery_date TEXT,
    notes TEXT NOT NULL DEFAULT '',
    status TEXT NOT NULL DEFAULT 'Aguardando montagem'
      CHECK (status IN ('Aguardando montagem', 'Em andamento', 'Agendada', 'Finalizada', 'Entregue')),
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS turnstile_status_due_idx
    ON turnstiles (status, expected_delivery_date, id DESC)`,
  `CREATE INDEX IF NOT EXISTS turnstile_client_idx
    ON turnstiles (client_name COLLATE NOCASE, id DESC)`,
  `CREATE TABLE IF NOT EXISTS turnstile_photos (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    turnstile_id INTEGER NOT NULL REFERENCES turnstiles(id) ON DELETE CASCADE,
    file_name TEXT NOT NULL DEFAULT '',
    original_name TEXT NOT NULL DEFAULT '',
    mime_type TEXT NOT NULL DEFAULT '',
    size_bytes INTEGER NOT NULL DEFAULT 0,
    original_size_bytes INTEGER NOT NULL DEFAULT 0,
    optimized_width INTEGER,
    optimized_height INTEGER,
    storage_path TEXT NOT NULL DEFAULT '',
    public_path TEXT NOT NULL DEFAULT '',
    uploaded_by TEXT NOT NULL DEFAULT '',
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS turnstile_photo_turnstile_idx
    ON turnstile_photos (turnstile_id, created_at DESC, id DESC)`,
  `CREATE TABLE IF NOT EXISTS notification_reads (
    notification_key TEXT PRIMARY KEY,
    read_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TABLE IF NOT EXISTS fcm_tokens (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT '',
    token TEXT NOT NULL DEFAULT '',
    platform TEXT NOT NULL DEFAULT 'android',
    created_at TEXT NOT NULL DEFAULT (datetime('now')),
    updated_at TEXT NOT NULL DEFAULT (datetime('now')),
    UNIQUE (token)
  )`,
  `CREATE TABLE IF NOT EXISTS audit_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    user_id TEXT NOT NULL DEFAULT '',
    user_email TEXT NOT NULL DEFAULT '',
    user_name TEXT NOT NULL DEFAULT '',
    operation TEXT NOT NULL DEFAULT '',
    resource TEXT NOT NULL DEFAULT '',
    record_id TEXT NOT NULL DEFAULT '',
    before_value TEXT,
    after_value TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE INDEX IF NOT EXISTS audit_resource_idx
    ON audit_logs (resource, record_id, created_at DESC)`,
  `CREATE TABLE IF NOT EXISTS system_logs (
    id INTEGER PRIMARY KEY AUTOINCREMENT,
    level TEXT NOT NULL DEFAULT 'info',
    message TEXT NOT NULL DEFAULT '',
    context TEXT,
    created_at TEXT NOT NULL DEFAULT (datetime('now'))
  )`,
  `CREATE TRIGGER IF NOT EXISTS periods_set_updated_at
    AFTER UPDATE ON periods
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE periods SET updated_at = datetime('now') WHERE id = NEW.id;
    END`,
  `CREATE TRIGGER IF NOT EXISTS corrective_set_updated_at
    AFTER UPDATE ON corrective_occurrences
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE corrective_occurrences SET updated_at = datetime('now') WHERE id = NEW.id;
    END`,
  `CREATE TRIGGER IF NOT EXISTS case_monitor_set_updated_at
    AFTER UPDATE ON case_monitors
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE case_monitors SET updated_at = datetime('now') WHERE id = NEW.id;
    END`,
  `CREATE TRIGGER IF NOT EXISTS command_registration_set_updated_at
    AFTER UPDATE ON command_registrations
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE command_registrations SET updated_at = datetime('now') WHERE id = NEW.id;
    END`,
  `CREATE TRIGGER IF NOT EXISTS appointment_set_updated_at
    AFTER UPDATE ON appointments
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE appointments SET updated_at = datetime('now') WHERE id = NEW.id;
    END`,
  `CREATE TRIGGER IF NOT EXISTS turnstile_set_updated_at
    AFTER UPDATE ON turnstiles
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE turnstiles SET updated_at = datetime('now') WHERE id = NEW.id;
    END`,
  `CREATE TRIGGER IF NOT EXISTS client_set_updated_at
    AFTER UPDATE ON clients
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE clients SET updated_at = datetime('now') WHERE id = NEW.id;
    END`,
  `CREATE TRIGGER IF NOT EXISTS technician_set_updated_at
    AFTER UPDATE ON technicians
    FOR EACH ROW
    WHEN NEW.updated_at = OLD.updated_at
    BEGIN
      UPDATE technicians SET updated_at = datetime('now') WHERE id = NEW.id;
    END`,
];

function yearStart(year) {
  return `${year}-01-01`;
}

async function ensureColumn(table, column, definition) {
  const existing = await query(`PRAGMA table_info(${table})`);
  const hasColumn = existing.rows.some((row) => row.name === column);

  if (!hasColumn) {
    await query(`ALTER TABLE ${table} ADD COLUMN ${column} ${definition}`);
  }
}

export async function migrate() {
  for (const statement of schema) {
    await query(statement);
  }

  await ensureColumn('turnstile_photos', 'original_size_bytes', 'INTEGER NOT NULL DEFAULT 0');
  await ensureColumn('turnstile_photos', 'optimized_width', 'INTEGER');
  await ensureColumn('turnstile_photos', 'optimized_height', 'INTEGER');
  await ensureColumn('audit_logs', 'user_name', "TEXT NOT NULL DEFAULT ''");
  await ensureColumn('appointments', 'notes', "TEXT NOT NULL DEFAULT ''");

  const defaultYear = getDefaultYear();
  await query(
    `INSERT INTO periods (year, status, started_at)
     SELECT $1, 'active', $2
     WHERE NOT EXISTS (SELECT 1 FROM periods WHERE status = 'active')
     ON CONFLICT (year) DO NOTHING`,
    [defaultYear, yearStart(defaultYear)],
  );

  await query(
    `INSERT INTO periods (year, status, started_at)
     VALUES ($1, 'closed', $2)
     ON CONFLICT (year) DO NOTHING`,
    [defaultYear, yearStart(defaultYear)],
  );
}

const isCli = process.argv[1] === fileURLToPath(import.meta.url);

if (isCli) {
  migrate()
    .then(async () => {
      console.log(`Banco de dados migrado com sucesso: ${databasePath}`);
      await closePool();
    })
    .catch(async (error) => {
      console.error('Falha ao migrar banco de dados.');
      console.error(error);
      await closePool();
      process.exitCode = 1;
    });
}
