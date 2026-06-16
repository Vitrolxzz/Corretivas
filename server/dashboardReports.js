import { query } from './db.js';

const reportLimit = 120;

const reportDefinitions = {
  todayAppointments: {
    title: 'Agendamentos do dia',
    description: 'Visitas agendadas para hoje que ainda nao foram canceladas.',
    columns: [
      ['Cliente', 'client'],
      ['Data', 'date', 'date'],
      ['Horario', 'time'],
      ['Tecnico', 'technician'],
      ['Status', 'status'],
      ['Problema', 'details'],
    ],
  },
  upcomingAppointments: {
    title: 'Proximas visitas',
    description: 'Proximas visitas agendadas, ordenadas pela data mais proxima.',
    columns: [
      ['Cliente', 'client'],
      ['Data', 'date', 'date'],
      ['Horario', 'time'],
      ['Tecnico', 'technician'],
      ['Status', 'status'],
      ['Problema', 'details'],
    ],
  },
  openCorrectives: {
    title: 'Ocorrencias abertas',
    description: 'Ocorrencias do periodo ativo que ainda nao possuem data de solucao.',
    columns: [
      ['Cliente', 'client'],
      ['Data', 'date', 'date'],
      ['Tecnico', 'technician'],
      ['Solicitante', 'requester'],
      ['Contato', 'contact'],
      ['Problema', 'details'],
    ],
  },
  completedCorrectivesMonth: {
    title: 'Ocorrencias concluidas no mes',
    description: 'Ocorrencias finalizadas dentro do mes atual.',
    columns: [
      ['Cliente', 'client'],
      ['Data abertura', 'date', 'date'],
      ['Data solucao', 'solutionDate', 'date'],
      ['Tecnico', 'technician'],
      ['Problema', 'details'],
      ['Resolucao', 'resolution'],
    ],
  },
  pendingTurnstiles: {
    title: 'Catracas pendentes',
    description: 'Catracas que ainda nao foram marcadas como entregues.',
    columns: [
      ['Cliente', 'client'],
      ['Modelo', 'model'],
      ['Entrega prevista', 'date', 'date'],
      ['Status', 'status'],
      ['Endereco', 'address'],
      ['Observacoes', 'details'],
    ],
  },
  dueSoonTurnstiles: {
    title: 'Catracas com prazo proximo',
    description: 'Catracas pendentes com entrega prevista para os proximos 3 dias.',
    columns: [
      ['Cliente', 'client'],
      ['Modelo', 'model'],
      ['Entrega prevista', 'date', 'date'],
      ['Status', 'status'],
      ['Endereco', 'address'],
      ['Observacoes', 'details'],
    ],
  },
  attendancesMonth: {
    title: 'Atendimentos no mes',
    description: 'Ocorrencias concluidas e visitas realizadas dentro do mes atual.',
    columns: [
      ['Tipo', 'type'],
      ['Cliente', 'client'],
      ['Data', 'date', 'date'],
      ['Tecnico', 'technician'],
      ['Status', 'status'],
      ['Detalhes', 'details'],
      ['Valor', 'value', 'money'],
    ],
  },
  commands: {
    title: 'Comandas',
    description: 'Comandas cadastradas no periodo ativo.',
    columns: [
      ['Padaria', 'client'],
      ['D/M Conf.', 'dmConf'],
      ['D/M Cad.', 'dmCad'],
      ['D/M Imp.', 'dmImp'],
      ['Cadastrador Exacta', 'exactaRegistrar'],
      ['Cadastrador Cliente', 'clientRegistrar'],
      ['Criado em', 'createdAt', 'datetime'],
    ],
  },
};

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

function dateToJson(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString().slice(0, 10);
  }

  return String(value).slice(0, 10);
}

function dateTimeToJson(value) {
  if (!value) {
    return null;
  }

  if (value instanceof Date) {
    return value.toISOString();
  }

  return String(value);
}

async function getPeriod(periodId) {
  if (periodId) {
    const { rows } = await query('SELECT * FROM periods WHERE id = $1', [Number(periodId)]);
    return rows[0] || null;
  }

  const { rows } = await query(`SELECT * FROM periods WHERE status = 'active' ORDER BY year DESC LIMIT 1`);
  return rows[0] || null;
}

function columnsFor(metric) {
  return (reportDefinitions[metric]?.columns || []).map(([label, key, type]) => ({
    label,
    key,
    type: type || 'text',
  }));
}

function normalizeRows(rows) {
  return rows.map((row) => {
    const record = { ...row };

    for (const key of ['date', 'solutionDate']) {
      if (record[key]) {
        record[key] = dateToJson(record[key]);
      }
    }

    if (record.createdAt) {
      record.createdAt = dateTimeToJson(record.createdAt);
    }

    if (record.value !== undefined) {
      record.value = Number(record.value || 0);
    }

    return record;
  });
}

async function count(sql, params) {
  const { rows } = await query(sql, params);
  return Number(rows[0]?.total || 0);
}

export async function buildDashboardReport(metric, options = {}) {
  const definition = reportDefinitions[metric];

  if (!definition) {
    const error = new Error('Relatorio do dashboard nao encontrado.');
    error.status = 404;
    throw error;
  }

  const period = await getPeriod(options.periodId);
  const today = todayText();
  const soon = addDaysText(today, 3);
  const month = currentMonthRange();
  let total = 0;
  let rows = [];

  if (!period) {
    return {
      metric,
      title: definition.title,
      description: 'Nenhum periodo ativo encontrado.',
      total: 0,
      columns: columnsFor(metric),
      records: [],
      generatedAt: new Date().toISOString(),
    };
  }

  if (metric === 'todayAppointments') {
    total = await count(`SELECT COUNT(*) AS total FROM appointments WHERE visit_date = $1 AND status <> 'cancelada'`, [today]);
    ({ rows } = await query(
      `SELECT id, client_name AS client, visit_date AS date, visit_time AS time, technician, status, reported_problem AS details
       FROM appointments
       WHERE visit_date = $1 AND status <> 'cancelada'
       ORDER BY COALESCE(visit_time, '') ASC, id ASC
       LIMIT $2`,
      [today, reportLimit],
    ));
  }

  if (metric === 'upcomingAppointments') {
    total = await count(`SELECT COUNT(*) AS total FROM appointments WHERE visit_date >= $1 AND status <> 'cancelada'`, [today]);
    ({ rows } = await query(
      `SELECT id, client_name AS client, visit_date AS date, visit_time AS time, technician, status, reported_problem AS details
       FROM appointments
       WHERE visit_date >= $1 AND status <> 'cancelada'
       ORDER BY visit_date ASC, COALESCE(visit_time, '') ASC, id ASC
       LIMIT $2`,
      [today, reportLimit],
    ));
  }

  if (metric === 'openCorrectives') {
    total = await count(
      `SELECT COUNT(*) AS total
       FROM corrective_occurrences
       WHERE period_id = $1 AND (solution_date IS NULL OR solution_date = '')`,
      [period.id],
    );
    ({ rows } = await query(
      `SELECT id, client, occurrence_date AS date, technician, requester_name AS requester, contact, reason AS details
       FROM corrective_occurrences
       WHERE period_id = $1 AND (solution_date IS NULL OR solution_date = '')
       ORDER BY COALESCE(occurrence_date, '0001-01-01') DESC, id DESC
       LIMIT $2`,
      [period.id, reportLimit],
    ));
  }

  if (metric === 'completedCorrectivesMonth') {
    total = await count(
      `SELECT COUNT(*) AS total
       FROM corrective_occurrences
       WHERE period_id = $1 AND solution_date >= $2 AND solution_date < $3`,
      [period.id, month.start, month.end],
    );
    ({ rows } = await query(
      `SELECT id, client, occurrence_date AS date, solution_date AS solutionDate, technician, reason AS details, resolution
       FROM corrective_occurrences
       WHERE period_id = $1 AND solution_date >= $2 AND solution_date < $3
       ORDER BY solution_date DESC, id DESC
       LIMIT $4`,
      [period.id, month.start, month.end, reportLimit],
    ));
  }

  if (metric === 'pendingTurnstiles') {
    total = await count(`SELECT COUNT(*) AS total FROM turnstiles WHERE status <> 'Entregue'`, []);
    ({ rows } = await query(
      `SELECT id, client_name AS client, model, client_address AS address, expected_delivery_date AS date, status, notes AS details
       FROM turnstiles
       WHERE status <> 'Entregue'
       ORDER BY COALESCE(expected_delivery_date, '9999-12-31') ASC, id DESC
       LIMIT $1`,
      [reportLimit],
    ));
  }

  if (metric === 'dueSoonTurnstiles') {
    total = await count(
      `SELECT COUNT(*) AS total
       FROM turnstiles
       WHERE status <> 'Entregue'
         AND expected_delivery_date IS NOT NULL
         AND expected_delivery_date >= $1
         AND expected_delivery_date <= $2`,
      [today, soon],
    );
    ({ rows } = await query(
      `SELECT id, client_name AS client, model, client_address AS address, expected_delivery_date AS date, status, notes AS details
       FROM turnstiles
       WHERE status <> 'Entregue'
         AND expected_delivery_date IS NOT NULL
         AND expected_delivery_date >= $1
         AND expected_delivery_date <= $2
       ORDER BY expected_delivery_date ASC, id DESC
       LIMIT $3`,
      [today, soon, reportLimit],
    ));
  }

  if (metric === 'attendancesMonth') {
    total = await count(
      `SELECT COUNT(*) AS total
       FROM (
         SELECT id FROM corrective_occurrences WHERE period_id = $1 AND solution_date >= $2 AND solution_date < $3
         UNION ALL
         SELECT id FROM appointments WHERE status = 'realizada' AND visit_date >= $2 AND visit_date < $3
       )`,
      [period.id, month.start, month.end],
    );
    ({ rows } = await query(
      `SELECT *
       FROM (
         SELECT 'Ocorrencia' AS type, id, client AS client, solution_date AS date, technician, 'concluida' AS status, reason AS details, 0 AS value
         FROM corrective_occurrences
         WHERE period_id = $1 AND solution_date >= $2 AND solution_date < $3
         UNION ALL
         SELECT 'Visita' AS type, id, client_name AS client, visit_date AS date, technician, status, reported_problem AS details,
           COALESCE(visit_value, 0) + COALESCE(parts_value, 0) AS value
         FROM appointments
         WHERE status = 'realizada' AND visit_date >= $2 AND visit_date < $3
       )
       ORDER BY date DESC, id DESC
       LIMIT $4`,
      [period.id, month.start, month.end, reportLimit],
    ));
  }

  if (metric === 'commands') {
    total = await count(`SELECT COUNT(*) AS total FROM command_registrations WHERE period_id = $1`, [period.id]);
    ({ rows } = await query(
      `SELECT id, bakery AS client, dm_conf AS dmConf, dm_cad AS dmCad, dm_imp AS dmImp,
        exacta_registrar AS exactaRegistrar, client_registrar AS clientRegistrar, created_at AS createdAt
       FROM command_registrations
       WHERE period_id = $1
       ORDER BY id DESC
       LIMIT $2`,
      [period.id, reportLimit],
    ));
  }

  return {
    metric,
    title: definition.title,
    description: definition.description,
    total,
    limit: reportLimit,
    period: { id: Number(period.id), year: Number(period.year), status: period.status },
    month: metric.includes('Month') || metric === 'attendancesMonth' ? month.label : undefined,
    columns: columnsFor(metric),
    records: normalizeRows(rows),
    generatedAt: new Date().toISOString(),
  };
}
