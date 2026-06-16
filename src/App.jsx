import { lazy, Suspense, useCallback, useEffect, useMemo, useState } from 'react';
import {
  AlertTriangle,
  Archive,
  BarChart3,
  Bell,
  CalendarDays,
  CheckCircle2,
  ClipboardList,
  Database,
  Download,
  Edit3,
  FileSpreadsheet,
  FileText,
  Flame,
  Image as ImageIcon,
  LayoutDashboard,
  ListChecks,
  MonitorCheck,
  PieChart,
  Plus,
  Power,
  Printer,
  RefreshCw,
  Save,
  Search,
  ShieldCheck,
  Trash2,
  Upload,
  Users,
  Wrench,
  X,
} from 'lucide-react';
import { eventSource, exportUrl, photoDownloadUrl, photoImageUrl, request } from './api.js';

const CalendarView = lazy(() => import('./CalendarView.jsx'));

const tabs = [
  { id: 'dashboard', label: 'Dashboard', icon: LayoutDashboard },
  { id: 'appointments', label: 'Agendamentos', icon: CalendarDays },
  { id: 'correctives', label: 'Ocorrencias', icon: ClipboardList },
  { id: 'commands', label: 'Cadastro de Comandas', icon: ListChecks },
  { id: 'turnstiles', label: 'Catracas para Montagem', icon: Wrench },
];

const healthOptions = ['Ok', 'Nulo'];
const situations = ['com problema', 'em observaÃ§Ã£o', 'em testes', 'ok'];
const difficultyOptions = [
  { value: '1', label: '1 - muito facil' },
  { value: '2', label: '2 - facil' },
  { value: '3', label: '3 - medio' },
  { value: '4', label: '4 - dificil' },
  { value: '5', label: '5 - muito dificil' },
];
const appointmentStatuses = ['agendada', 'realizada', 'cancelada'];
const appointmentVisitTypes = ['garantia', 'retorno'];
const turnstileStatuses = ['Aguardando montagem', 'Em andamento', 'Agendada', 'Finalizada', 'Entregue'];
const dashboardMetricTiles = [
  { metric: 'todayAppointments', icon: CalendarDays, label: 'Agendamentos do dia', stat: 'todayAppointments' },
  { metric: 'upcomingAppointments', icon: CalendarDays, label: 'Proximas visitas', stat: 'upcomingAppointments' },
  { metric: 'openCorrectives', icon: ClipboardList, label: 'Ocorrencias abertas', stat: 'openCorrectives' },
  { metric: 'completedCorrectivesMonth', icon: CheckCircle2, label: 'Concluidas no mes', stat: 'completedCorrectivesMonth' },
  { metric: 'pendingTurnstiles', icon: Wrench, label: 'Catracas pendentes', stat: 'pendingTurnstiles' },
  { metric: 'dueSoonTurnstiles', icon: AlertTriangle, label: 'Prazos proximos', stat: 'dueSoonTurnstiles' },
  { metric: 'attendancesMonth', icon: MonitorCheck, label: 'Atendimentos no mes', stat: 'attendancesMonth' },
  { metric: 'commands', icon: ListChecks, label: 'Comandas', stat: 'commands' },
];

const emptyCorrective = {
  occurrenceDate: '',
  client: '',
  contact: '',
  requesterName: '',
  reason: '',
  resolution: '',
  difficulty: '',
  technician: '',
  backupStatus: 'Nulo',
  firewallStatus: 'Nulo',
  powerOptionsStatus: 'Nulo',
  solutionDate: '',
};

const emptyCase = {
  clientName: '',
  startDate: '',
  situation: 'com problema',
};

const emptyCommand = {
  bakery: '',
  dmConf: '',
  dmCad: '',
  dmImp: '',
  exactaRegistrar: '',
  clientRegistrar: '',
};

const emptyAppointment = {
  clientName: '',
  address: '',
  reportedProblem: '',
  notes: '',
  annotations: '',
  visitType: '',
  visitDate: '',
  visitTime: '',
  technician: '',
  visitValue: '',
  partsValue: '',
  status: 'agendada',
};

const emptyTurnstile = {
  clientName: '',
  model: '',
  clientAddress: '',
  expectedDeliveryDate: '',
  notes: '',
  status: 'Aguardando montagem',
};

function formatDate(value) {
  if (!value) {
    return '-';
  }

  const text = String(value).trim();
  const isoMatch = text.match(/^(\d{4})-(\d{2})-(\d{2})/);

  if (isoMatch) {
    return `${isoMatch[3]}/${isoMatch[2]}/${isoMatch[1]}`;
  }

  const brMatch = text.match(/^(\d{1,2})\/(\d{1,2})\/(\d{4})/);
  if (brMatch) {
    return `${brMatch[1].padStart(2, '0')}/${brMatch[2].padStart(2, '0')}/${brMatch[3]}`;
  }

  const brShortMatch = text.match(/^(\d{1,2})\/(\d{1,2})$/);
  if (brShortMatch) {
    return `${brShortMatch[1].padStart(2, '0')}/${brShortMatch[2].padStart(2, '0')}/${new Date().getFullYear()}`;
  }

  return text;
}

function formatMoney(value) {
  return Number(value || 0).toLocaleString('pt-BR', { style: 'currency', currency: 'BRL' });
}

function currentMonth() {
  return new Date().toISOString().slice(0, 7);
}

function normalizeForForm(record) {
  return Object.fromEntries(
    Object.entries(record).map(([key, value]) => [key, value === null || value === undefined ? '' : value]),
  );
}

function normalizeClientInput(value) {
  return String(value || '').toLocaleUpperCase('pt-BR');
}

function normalizeTechnicianInput(value) {
  const text = String(value || '');

  if (text.toLocaleLowerCase('pt-BR') === 'vittor') {
    return 'Vittor';
  }

  return text;
}

function fileToDataUrl(file) {
  return new Promise((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(reader.result);
    reader.onerror = () => reject(reader.error);
    reader.readAsDataURL(file);
  });
}

function Field({ label, children, wide = false }) {
  return (
    <label className={`field ${wide ? 'field-wide' : ''}`}>
      <span>{label}</span>
      {children}
    </label>
  );
}

function IconAction({ title, onClick, children, danger = false, type = 'button', disabled = false }) {
  return (
    <button
      className={`icon-action ${danger ? 'danger' : ''}`}
      type={type}
      onClick={onClick}
      title={title}
      aria-label={title}
      disabled={disabled}
    >
      {children}
    </button>
  );
}

function StatusPill({ value }) {
  const token = String(value || 'nulo')
    .normalize('NFD')
    .replace(/[\u0300-\u036f]/g, '')
    .replace(/\s+/g, '-')
    .toLowerCase();
  return <span className={`status-pill ${token}`}>{value || '-'}</span>;
}

function PeriodBadge({ period }) {
  if (!period) {
    return <span className="period-badge muted">Sem periodo</span>;
  }

  return <span className={`period-badge ${period.status}`}>{period.year}</span>;
}

function StatTile({ icon: Icon, label, value, accent, onClick }) {
  const Wrapper = onClick ? 'button' : 'div';

  return (
    <Wrapper className={`stat-tile ${accent ? `accent-${accent}` : ''} ${onClick ? 'clickable' : ''}`} type={onClick ? 'button' : undefined} onClick={onClick}>
      <Icon size={19} />
      <div>
        <strong>{value ?? '-'}</strong>
        <span>{label}</span>
      </div>
    </Wrapper>
  );
}

function formatReportValue(value, type) {
  if (value === null || value === undefined || value === '') {
    return '-';
  }

  if (type === 'date') {
    return formatDate(value);
  }

  if (type === 'datetime') {
    return new Date(value).toLocaleString('pt-BR');
  }

  if (type === 'money') {
    return formatMoney(value);
  }

  return String(value);
}

function DashboardReportPanel({ report, loading, onClose }) {
  if (loading) {
    return (
      <section className="list-panel detail-panel dashboard-report-panel">
        <div className="section-title">
          <h2>Carregando relatorio</h2>
          <RefreshCw className="spin" size={18} />
        </div>
      </section>
    );
  }

  if (!report) {
    return null;
  }

  const columns = report.columns || [];
  const records = report.records || [];

  return (
    <section className="list-panel detail-panel dashboard-report-panel">
      <div className="section-title">
        <div>
          <h2>{report.title}</h2>
          <p>{report.description}</p>
        </div>
        <IconAction title="Fechar relatorio" onClick={onClose}>
          <X size={18} />
        </IconAction>
      </div>
      <div className="report-summary">
        <StatTile icon={FileText} label="Total encontrado" value={report.total ?? records.length} />
        <StatTile icon={ListChecks} label="Exibindo" value={records.length} />
        {report.month && <StatTile icon={CalendarDays} label="Mes de referencia" value={report.month} />}
      </div>
      <div className="table-wrap compact-table">
        <table>
          <thead>
            <tr>
              {columns.map((column) => (
                <th key={column.key}>{column.label}</th>
              ))}
            </tr>
          </thead>
          <tbody>
            {records.map((record, index) => (
              <tr key={`${record.id || 'row'}-${index}`}>
                {columns.map((column) => (
                  <td key={column.key}>{formatReportValue(record[column.key], column.type)}</td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
        {!records.length && <EmptyState label="Nenhum registro encontrado para este indicador." />}
      </div>
    </section>
  );
}

function EmptyState({ label }) {
  return <div className="empty-state">{label}</div>;
}

function ExportButtons({ resource, params = {}, compact = false }) {
  return (
    <div className={`export-buttons ${compact ? 'compact' : ''}`}>
      <a className="secondary-button small" href={exportUrl(resource, 'pdf', params)}>
        <FileText size={16} />
        PDF
      </a>
      <a className="secondary-button small" href={exportUrl(resource, 'xls', params)}>
        <FileSpreadsheet size={16} />
        Excel
      </a>
      <button className="secondary-button small" type="button" onClick={() => window.print()}>
        <Printer size={16} />
        Imprimir
      </button>
    </div>
  );
}

function MiniBarChart({ rows = [], keys = ['value'] }) {
  const max = Math.max(1, ...rows.flatMap((row) => keys.map((key) => Number(row[key] || 0))));

  if (!rows.length) {
    return <EmptyState label="Sem dados para o grafico." />;
  }

  return (
    <div className="mini-bars">
      {rows.map((row) => (
        <div className="mini-bar-row" key={row.label}>
          <span>{row.label}</span>
          <div className="mini-bar-track">
            {keys.map((key, index) => (
              <i
                key={key}
                className={`mini-bar-fill tone-${index + 1}`}
                style={{ width: `${Math.max(4, (Number(row[key] || 0) / max) * 100)}%` }}
                title={`${key}: ${row[key] || 0}`}
              />
            ))}
          </div>
          <strong>{keys.map((key) => row[key] || 0).join(' / ')}</strong>
        </div>
      ))}
    </div>
  );
}

function DonutChart({ rows = [] }) {
  const total = rows.reduce((sum, row) => sum + Number(row.value || 0), 0);
  let offset = 25;

  if (!total) {
    return <EmptyState label="Sem dados para o grafico." />;
  }

  return (
    <div className="donut-layout">
      <svg className="donut-chart" viewBox="0 0 42 42" role="img" aria-label="Grafico de pizza">
        <circle cx="21" cy="21" r="15.9" fill="transparent" stroke="rgba(255,255,255,0.08)" strokeWidth="6" />
        {rows.map((row, index) => {
          const value = (Number(row.value || 0) / total) * 100;
          const currentOffset = offset;
          offset -= value;

          return (
            <circle
              key={row.label}
              cx="21"
              cy="21"
              r="15.9"
              fill="transparent"
              stroke={`var(--chart-${(index % 5) + 1})`}
              strokeWidth="6"
              strokeDasharray={`${value} ${100 - value}`}
              strokeDashoffset={currentOffset}
            />
          );
        })}
      </svg>
      <div className="chart-legend">
        {rows.map((row, index) => (
          <button className="legend-row" key={row.label} type="button">
            <i style={{ background: `var(--chart-${(index % 5) + 1})` }} />
            <span>{row.label}</span>
            <strong>{row.percent ?? Math.round((Number(row.value || 0) / total) * 100)}%</strong>
          </button>
        ))}
      </div>
    </div>
  );
}

function GlobalSearch({ onOpen, showToast }) {
  const [term, setTerm] = useState('');
  const [groups, setGroups] = useState([]);
  const [open, setOpen] = useState(false);

  useEffect(() => {
    const search = term.trim();

    if (search.length < 2) {
      setGroups([]);
      return undefined;
    }

    const timer = window.setTimeout(() => {
      request(`/api/search?q=${encodeURIComponent(search)}`)
        .then((data) => setGroups(data.groups || []))
        .catch((error) => showToast(error.message, 'error'));
    }, 260);

    return () => window.clearTimeout(timer);
  }, [term, showToast]);

  return (
    <div className="global-search">
      <div className="search-box">
        <Search size={17} />
        <input
          placeholder="Pesquisa global"
          value={term}
          onChange={(event) => {
            setTerm(event.target.value);
            setOpen(true);
          }}
          onFocus={() => setOpen(true)}
        />
      </div>
      {open && term.trim().length >= 2 && (
        <div className="search-results">
          {groups.length ? (
            groups.map((group) => (
              <div className="search-group" key={group.category}>
                <strong>{group.category}</strong>
                {group.items.map((item) => (
                  <button
                    key={`${group.type}-${item.id}`}
                    type="button"
                    onClick={() => {
                      setOpen(false);
                      setTerm('');
                      onOpen({ ...item, type: group.type });
                    }}
                  >
                    <span>{item.label}</span>
                    <small>{item.description}</small>
                  </button>
                ))}
              </div>
            ))
          ) : (
            <EmptyState label="Nenhum resultado encontrado." />
          )}
        </div>
      )}
    </div>
  );
}

function NotificationCenter({ notifications, onOpen, onReadAll }) {
  const [open, setOpen] = useState(false);
  const count = notifications?.count || 0;
  const total = notifications?.total || notifications?.notifications?.length || 0;

  return (
    <div className="notification-center">
      <button className="icon-action notification-button" type="button" onClick={() => setOpen((value) => !value)}>
        <Bell size={18} />
        {count > 0 && <span>{count}</span>}
      </button>
      {open && (
        <div className="notification-popover">
          <div className="popover-title">
            <div>
              <strong>Notificacoes</strong>
              <small>{count} nao lidas de {total}</small>
            </div>
            {count > 0 && (
              <button className="secondary-button small" type="button" onClick={onReadAll}>
                Marcar lidas
              </button>
            )}
          </div>
          {(notifications?.notifications || []).length ? (
            notifications.notifications.map((item, index) => (
              <button
                className={`notification-item ${item.severity} ${item.read ? 'read' : 'unread'}`}
                key={item.key || `${item.type}-${item.id}-${index}`}
                type="button"
                onClick={() => {
                  setOpen(false);
                  onOpen(item);
                }}
              >
                <span>{item.title}</span>
                <small>{item.message}</small>
              </button>
            ))
          ) : (
            <EmptyState label="Nenhuma notificacao ativa." />
          )}
        </div>
      )}
    </div>
  );
}

export default function App() {
  const [activeTab, setActiveTab] = useState('dashboard');
  const [periods, setPeriods] = useState([]);
  const [selectedPeriodId, setSelectedPeriodId] = useState('');
  const [dashboard, setDashboard] = useState(null);
  const [dashboardReport, setDashboardReport] = useState(null);
  const [dashboardReportLoading, setDashboardReportLoading] = useState(false);
  const [clients, setClients] = useState([]);
  const [technicianOptions, setTechnicianOptions] = useState([]);
  const [notifications, setNotifications] = useState({ count: 0, notifications: [] });
  const [toast, setToast] = useState(null);
  const [refreshKey, setRefreshKey] = useState(0);
  const [loading, setLoading] = useState(true);

  const [correctives, setCorrectives] = useState([]);
  const [correctivesTotal, setCorrectivesTotal] = useState(0);
  const [correctivesPage, setCorrectivesPage] = useState(1);
  const [correctivesSearch, setCorrectivesSearch] = useState('');
  const [correctiveForm, setCorrectiveForm] = useState(emptyCorrective);
  const [editingCorrectiveId, setEditingCorrectiveId] = useState(null);

  const [cases, setCases] = useState([]);
  const [caseSearch, setCaseSearch] = useState('');
  const [caseSituation, setCaseSituation] = useState('');
  const [caseForm, setCaseForm] = useState(emptyCase);
  const [editingCaseId, setEditingCaseId] = useState(null);

  const [commands, setCommands] = useState([]);
  const [commandSearch, setCommandSearch] = useState('');
  const [commandForm, setCommandForm] = useState(emptyCommand);
  const [editingCommandId, setEditingCommandId] = useState(null);

  const [appointments, setAppointments] = useState([]);
  const [appointmentsTotal, setAppointmentsTotal] = useState(0);
  const [appointmentsPage, setAppointmentsPage] = useState(1);
  const [appointmentsSearch, setAppointmentsSearch] = useState('');
  const [appointmentsTechnician, setAppointmentsTechnician] = useState('');
  const [appointmentsVisitType, setAppointmentsVisitType] = useState('');
  const [appointmentsStartDate, setAppointmentsStartDate] = useState('');
  const [appointmentsEndDate, setAppointmentsEndDate] = useState('');
  const [appointmentForm, setAppointmentForm] = useState(emptyAppointment);
  const [editingAppointmentId, setEditingAppointmentId] = useState(null);
  const [appointmentsMode, setAppointmentsMode] = useState('list');
  const [appointmentPhotos, setAppointmentPhotos] = useState([]);

  const [turnstiles, setTurnstiles] = useState([]);
  const [turnstilesTotal, setTurnstilesTotal] = useState(0);
  const [turnstilesSearch, setTurnstilesSearch] = useState('');
  const [turnstilesStatus, setTurnstilesStatus] = useState('');
  const [turnstilesStartDate, setTurnstilesStartDate] = useState('');
  const [turnstilesEndDate, setTurnstilesEndDate] = useState('');
  const [turnstileForm, setTurnstileForm] = useState(emptyTurnstile);
  const [editingTurnstileId, setEditingTurnstileId] = useState(null);
  const [turnstilesMode, setTurnstilesMode] = useState('kanban');
  const [turnstilePhotos, setTurnstilePhotos] = useState([]);

  const [technicians, setTechnicians] = useState([]);
  const [technicianStartDate, setTechnicianStartDate] = useState('');
  const [technicianEndDate, setTechnicianEndDate] = useState('');
  const [technicianHistory, setTechnicianHistory] = useState(null);

  const [dailyStartDate, setDailyStartDate] = useState(new Date().toISOString().slice(0, 10));
  const [dailyEndDate, setDailyEndDate] = useState(new Date().toISOString().slice(0, 10));
  const [dailyReport, setDailyReport] = useState([]);
  const [monthlyReportMonth, setMonthlyReportMonth] = useState(currentMonth());
  const [monthlyReport, setMonthlyReport] = useState(null);
  const [clientHistory, setClientHistory] = useState(null);

  const selectedPeriod = useMemo(
    () => periods.find((period) => String(period.id) === String(selectedPeriodId)) || null,
    [periods, selectedPeriodId],
  );
  const activePeriod = useMemo(() => periods.find((period) => period.status === 'active') || null, [periods]);
  const periodWritable = selectedPeriod?.status === 'active';
  const totalCorrectivePages = Math.max(1, Math.ceil(correctivesTotal / 50));
  const totalAppointmentPages = Math.max(1, Math.ceil(appointmentsTotal / 50));

  const appointmentExportParams = {
    search: appointmentsSearch,
    technician: appointmentsTechnician,
    visitType: appointmentsVisitType,
    startDate: appointmentsStartDate,
    endDate: appointmentsEndDate,
  };
  const turnstileExportParams = {
    search: turnstilesSearch,
    status: turnstilesStatus,
    startDate: turnstilesStartDate,
    endDate: turnstilesEndDate,
  };
  const technicianExportParams = {
    startDate: technicianStartDate,
    endDate: technicianEndDate,
  };
  const dailyExportParams = {
    startDate: dailyStartDate,
    endDate: dailyEndDate,
  };

  const appointmentEvents = useMemo(
    () =>
      appointments
        .filter((record) => record.visitDate)
        .map((record) => ({
          id: String(record.id),
          title: `${record.visitTime || ''} ${record.clientName}`.trim(),
          start: record.visitTime ? `${record.visitDate}T${record.visitTime}:00` : record.visitDate,
          classNames: record.conflictCount > 0 ? ['event-conflict'] : [],
          extendedProps: { record },
        })),
    [appointments],
  );

  const showToast = useCallback((message, type = 'success') => {
    setToast({ message, type });
    window.clearTimeout(showToast.timer);
    showToast.timer = window.setTimeout(() => setToast(null), 3400);
  }, []);

  const loadPeriods = useCallback(async () => {
    const data = await request('/api/periods');
    setPeriods(data.periods);
    setSelectedPeriodId((current) => {
      const exists = data.periods.some((period) => String(period.id) === String(current));
      const active = data.periods.find((period) => period.status === 'active');
      return exists ? current : String(active?.id || data.periods[0]?.id || '');
    });
  }, []);

  const loadDashboard = useCallback(async () => {
    const params = selectedPeriodId ? `?periodId=${selectedPeriodId}` : '';
    const data = await request(`/api/dashboard${params}`);
    setDashboard(data);
  }, [selectedPeriodId]);

  const loadClients = useCallback(async () => {
    const data = await request('/api/options/clients');
    setClients(data.clients);
  }, []);

  const loadTechnicianOptions = useCallback(async () => {
    const data = await request('/api/options/technicians');
    setTechnicianOptions(data.technicians);
  }, []);

  const loadNotifications = useCallback(async () => {
    const data = await request('/api/notifications');
    setNotifications(data);
  }, []);

  const loadCorrectives = useCallback(async () => {
    if (!selectedPeriodId) {
      setCorrectives([]);
      setCorrectivesTotal(0);
      return;
    }

    const params = new URLSearchParams({
      periodId: selectedPeriodId,
      page: String(correctivesPage),
      limit: '50',
    });

    if (correctivesSearch.trim()) {
      params.set('search', correctivesSearch.trim());
    }

    const data = await request(`/api/correctives?${params}`);
    setCorrectives(data.records);
    setCorrectivesTotal(data.total);
  }, [selectedPeriodId, correctivesPage, correctivesSearch]);

  const loadCases = useCallback(async () => {
    const params = new URLSearchParams();

    if (caseSearch.trim()) {
      params.set('search', caseSearch.trim());
    }

    if (caseSituation) {
      params.set('situation', caseSituation);
    }

    const suffix = params.toString() ? `?${params}` : '';
    const data = await request(`/api/cases${suffix}`);
    setCases(data.records);
  }, [caseSearch, caseSituation]);

  const loadCommands = useCallback(async () => {
    if (!selectedPeriodId) {
      setCommands([]);
      return;
    }

    const params = new URLSearchParams({ periodId: selectedPeriodId });

    if (commandSearch.trim()) {
      params.set('search', commandSearch.trim());
    }

    const data = await request(`/api/commands?${params}`);
    setCommands(data.records);
  }, [selectedPeriodId, commandSearch]);

  const loadAppointments = useCallback(async () => {
    const params = new URLSearchParams({ page: String(appointmentsPage), limit: '50' });

    if (appointmentsSearch.trim()) {
      params.set('search', appointmentsSearch.trim());
    }

    if (appointmentsTechnician) {
      params.set('technician', appointmentsTechnician);
    }

    if (appointmentsVisitType) {
      params.set('visitType', appointmentsVisitType);
    }

    if (appointmentsStartDate) {
      params.set('startDate', appointmentsStartDate);
    }

    if (appointmentsEndDate) {
      params.set('endDate', appointmentsEndDate);
    }

    const data = await request(`/api/appointments?${params}`);
    setAppointments(data.records);
    setAppointmentsTotal(data.total);
  }, [appointmentsPage, appointmentsSearch, appointmentsTechnician, appointmentsVisitType, appointmentsStartDate, appointmentsEndDate]);

  const loadAppointmentPhotos = useCallback(async (id) => {
    if (!id) {
      setAppointmentPhotos([]);
      return;
    }

    const data = await request(`/api/appointments/${id}/photos`);
    setAppointmentPhotos(data.records);
  }, []);

  const loadTurnstiles = useCallback(async () => {
    const params = new URLSearchParams({ limit: '200' });

    if (turnstilesSearch.trim()) {
      params.set('search', turnstilesSearch.trim());
    }

    if (turnstilesStatus) {
      params.set('status', turnstilesStatus);
    }

    if (turnstilesStartDate) {
      params.set('startDate', turnstilesStartDate);
    }

    if (turnstilesEndDate) {
      params.set('endDate', turnstilesEndDate);
    }

    const data = await request(`/api/turnstiles?${params}`);
    setTurnstiles(data.records);
    setTurnstilesTotal(data.total);
  }, [turnstilesSearch, turnstilesStatus, turnstilesStartDate, turnstilesEndDate]);

  const loadTurnstilePhotos = useCallback(async (id) => {
    if (!id) {
      setTurnstilePhotos([]);
      return;
    }

    const data = await request(`/api/turnstiles/${id}/photos`);
    setTurnstilePhotos(data.records);
  }, []);

  const loadTechnicians = useCallback(async () => {
    const params = new URLSearchParams();

    if (technicianStartDate) {
      params.set('startDate', technicianStartDate);
    }

    if (technicianEndDate) {
      params.set('endDate', technicianEndDate);
    }

    const suffix = params.toString() ? `?${params}` : '';
    const data = await request(`/api/technicians${suffix}`);
    setTechnicians(data.records);
  }, [technicianStartDate, technicianEndDate]);

  const loadDailyReport = useCallback(async () => {
    const params = new URLSearchParams({ startDate: dailyStartDate, endDate: dailyEndDate });
    const data = await request(`/api/reports/daily?${params}`);
    setDailyReport(data.records);
  }, [dailyStartDate, dailyEndDate]);

  const loadMonthlyReport = useCallback(async () => {
    const data = await request(`/api/reports/monthly?month=${encodeURIComponent(monthlyReportMonth)}`);
    setMonthlyReport(data);
  }, [monthlyReportMonth]);

  useEffect(() => {
    const source = eventSource();
    source.addEventListener('change', () => setRefreshKey((current) => current + 1));
    return () => source.close();
  }, []);

  useEffect(() => {
    loadPeriods()
      .catch((error) => showToast(error.message, 'error'))
      .finally(() => setLoading(false));
  }, [loadPeriods, refreshKey, showToast]);

  useEffect(() => {
    if (!selectedPeriodId) {
      return;
    }

    Promise.all([
      loadDashboard(),
      loadClients(),
      loadTechnicianOptions(),
      loadNotifications(),
      loadCorrectives(),
      loadCases(),
      loadCommands(),
      loadAppointments(),
      loadTurnstiles(),
      loadTechnicians(),
      loadDailyReport(),
      loadMonthlyReport(),
    ]).catch((error) => showToast(error.message, 'error'));
  }, [
    selectedPeriodId,
    loadDashboard,
    loadClients,
    loadTechnicianOptions,
    loadNotifications,
    loadCorrectives,
    loadCases,
    loadCommands,
    loadAppointments,
    loadTurnstiles,
    loadTechnicians,
    loadDailyReport,
    loadMonthlyReport,
    refreshKey,
    showToast,
  ]);

  useEffect(() => {
    setCorrectivesPage(1);
  }, [correctivesSearch, selectedPeriodId]);

  useEffect(() => {
    setAppointmentsPage(1);
  }, [appointmentsSearch, appointmentsTechnician, appointmentsVisitType, appointmentsStartDate, appointmentsEndDate]);

  function updateCorrective(field, value) {
    const normalizedValue = field === 'client'
      ? normalizeClientInput(value)
      : field === 'technician'
        ? normalizeTechnicianInput(value)
        : value;
    setCorrectiveForm((current) => ({ ...current, [field]: normalizedValue }));
  }

  function updateCase(field, value) {
    const normalizedValue = field === 'clientName' ? normalizeClientInput(value) : value;
    setCaseForm((current) => ({ ...current, [field]: normalizedValue }));
  }

  function updateCommand(field, value) {
    const normalizedValue = field === 'bakery'
      ? normalizeClientInput(value)
      : field === 'exactaRegistrar' || field === 'clientRegistrar'
        ? normalizeTechnicianInput(value)
        : value;
    setCommandForm((current) => ({ ...current, [field]: normalizedValue }));
  }

  function updateAppointment(field, value) {
    const normalizedValue = field === 'clientName'
      ? normalizeClientInput(value)
      : field === 'technician'
        ? normalizeTechnicianInput(value)
        : value;
    setAppointmentForm((current) => ({ ...current, [field]: normalizedValue }));
  }

  function updateTurnstile(field, value) {
    const normalizedValue = field === 'clientName' ? normalizeClientInput(value) : value;
    setTurnstileForm((current) => ({ ...current, [field]: normalizedValue }));
  }

  async function refreshOperationalData() {
    await Promise.all([
      loadDashboard(),
      loadNotifications(),
      loadClients(),
      loadTechnicianOptions(),
      loadTechnicians(),
      loadMonthlyReport(),
    ]);
  }

  async function saveCorrective(event) {
    event.preventDefault();
    const method = editingCorrectiveId ? 'PUT' : 'POST';
    const path = editingCorrectiveId ? `/api/correctives/${editingCorrectiveId}` : '/api/correctives';

    try {
      await request(path, {
        method,
        body: { ...correctiveForm, periodId: selectedPeriodId },
      });
      setCorrectiveForm(emptyCorrective);
      setEditingCorrectiveId(null);
      await Promise.all([loadCorrectives(), loadDailyReport(), refreshOperationalData()]);
      showToast(editingCorrectiveId ? 'Ocorrencia atualizada.' : 'Ocorrencia registrada.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function saveCase(event) {
    event.preventDefault();
    const method = editingCaseId ? 'PUT' : 'POST';
    const path = editingCaseId ? `/api/cases/${editingCaseId}` : '/api/cases';

    try {
      await request(path, { method, body: caseForm });
      setCaseForm(emptyCase);
      setEditingCaseId(null);
      await Promise.all([loadCases(), refreshOperationalData()]);
      showToast(editingCaseId ? 'Caso atualizado.' : 'Caso adicionado.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function saveCommand(event) {
    event.preventDefault();
    const method = editingCommandId ? 'PUT' : 'POST';
    const path = editingCommandId ? `/api/commands/${editingCommandId}` : '/api/commands';

    try {
      await request(path, {
        method,
        body: { ...commandForm, periodId: selectedPeriodId },
      });
      setCommandForm(emptyCommand);
      setEditingCommandId(null);
      await Promise.all([loadCommands(), refreshOperationalData()]);
      showToast(editingCommandId ? 'Comanda atualizada.' : 'Comanda cadastrada.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function saveAppointment(event) {
    event.preventDefault();
    const method = editingAppointmentId ? 'PUT' : 'POST';
    const path = editingAppointmentId ? `/api/appointments/${editingAppointmentId}` : '/api/appointments';

    try {
      const data = await request(path, { method, body: appointmentForm });
      const id = editingAppointmentId || data.record.id;
      setEditingAppointmentId(id);
      setAppointmentForm(
        normalizeForForm({
          clientName: data.record.clientName,
          address: data.record.address,
          reportedProblem: data.record.reportedProblem,
          notes: data.record.notes,
          annotations: data.record.annotations,
          visitType: data.record.visitType,
          visitDate: data.record.visitDate,
          visitTime: data.record.visitTime,
          technician: data.record.technician,
          visitValue: data.record.visitValue,
          partsValue: data.record.partsValue,
          status: data.record.status,
        }),
      );
      await Promise.all([loadAppointments(), loadDailyReport(), refreshOperationalData(), loadAppointmentPhotos(id)]);
      showToast(editingAppointmentId ? 'Agendamento atualizado.' : 'Agendamento cadastrado.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function saveTurnstile(event) {
    event.preventDefault();
    const method = editingTurnstileId ? 'PUT' : 'POST';
    const path = editingTurnstileId ? `/api/turnstiles/${editingTurnstileId}` : '/api/turnstiles';

    try {
      const data = await request(path, { method, body: turnstileForm });
      const id = editingTurnstileId || data.record.id;
      setEditingTurnstileId(id);
      await Promise.all([loadTurnstiles(), refreshOperationalData(), loadTurnstilePhotos(id)]);
      showToast(editingTurnstileId ? 'Catraca atualizada.' : 'Catraca cadastrada.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function deleteRecord(path, reload, label) {
    if (!window.confirm(`Excluir ${label}?`)) {
      return;
    }

    try {
      await request(path, { method: 'DELETE' });
      await reload();
      showToast('Registro excluido.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function closeCurrentPeriod() {
    if (!activePeriod) {
      return;
    }

    const nextYear = activePeriod.year + 1;
    const confirmed = window.confirm(`Encerrar ${activePeriod.year} e iniciar ${nextYear}?`);

    if (!confirmed) {
      return;
    }

    try {
      const data = await request('/api/periods/close', {
        method: 'POST',
        body: { nextYear },
      });
      await loadPeriods();
      setSelectedPeriodId(String(data.active.id));
      setCorrectiveForm(emptyCorrective);
      setCommandForm(emptyCommand);
      setEditingCorrectiveId(null);
      setEditingCommandId(null);
      showToast(`Periodo ${data.closed.year} encerrado. ${data.active.year} esta ativo.`);
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  function editCorrective(record) {
    setEditingCorrectiveId(record.id);
    setCorrectiveForm(
      normalizeForForm({
        occurrenceDate: record.occurrenceDate,
        client: record.client,
        contact: record.contact,
        requesterName: record.requesterName,
        reason: record.reason,
        resolution: record.resolution,
        difficulty: record.difficulty,
        technician: record.technician,
        backupStatus: record.backupStatus,
        firewallStatus: record.firewallStatus,
        powerOptionsStatus: record.powerOptionsStatus,
        solutionDate: record.solutionDate,
      }),
    );
    setActiveTab('correctives');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function editCase(record) {
    setEditingCaseId(record.id);
    setCaseForm(
      normalizeForForm({
        clientName: record.clientName,
        startDate: record.startDate,
        situation: record.situation,
      }),
    );
    setActiveTab('correctives');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function editCommand(record) {
    setEditingCommandId(record.id);
    setCommandForm(
      normalizeForForm({
        bakery: record.bakery,
        dmConf: record.dmConf,
        dmCad: record.dmCad,
        dmImp: record.dmImp,
        exactaRegistrar: record.exactaRegistrar,
        clientRegistrar: record.clientRegistrar,
      }),
    );
    setActiveTab('commands');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function editAppointment(record) {
    setEditingAppointmentId(record.id);
    setAppointmentForm(
      normalizeForForm({
        clientName: record.clientName,
        address: record.address,
        reportedProblem: record.reportedProblem,
        notes: record.notes,
        annotations: record.annotations,
        visitType: record.visitType,
        visitDate: record.visitDate,
        visitTime: record.visitTime,
        technician: record.technician,
        visitValue: record.visitValue,
        partsValue: record.partsValue,
        status: record.status,
      }),
    );
    loadAppointmentPhotos(record.id).catch((error) => showToast(error.message, 'error'));
    setActiveTab('appointments');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  function editTurnstile(record) {
    setEditingTurnstileId(record.id);
    setTurnstileForm(
      normalizeForForm({
        clientName: record.clientName,
        model: record.model,
        clientAddress: record.clientAddress,
        expectedDeliveryDate: record.expectedDeliveryDate,
        notes: record.notes,
        status: record.status,
      }),
    );
    loadTurnstilePhotos(record.id).catch((error) => showToast(error.message, 'error'));
    setActiveTab('turnstiles');
    window.scrollTo({ top: 0, behavior: 'smooth' });
  }

  async function openClientHistory(name) {
    try {
      const data = await request(`/api/clients/history?name=${encodeURIComponent(name)}`);
      setClientHistory(data);
      setTechnicianHistory(null);
      setActiveTab('dashboard');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function openTechnicianHistory(name) {
    try {
      const params = new URLSearchParams({ name });

      if (technicianStartDate) {
        params.set('startDate', technicianStartDate);
      }

      if (technicianEndDate) {
        params.set('endDate', technicianEndDate);
      }

      const data = await request(`/api/technicians/history?${params}`);
      setTechnicianHistory(data);
      setClientHistory(null);
      setActiveTab('dashboard');
      window.scrollTo({ top: 0, behavior: 'smooth' });
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function openGlobalResult(item) {
    try {
      if (item.type === 'client') {
        await openClientHistory(item.id);
        return;
      }

      if (item.type === 'corrective') {
        const data = await request(`/api/correctives/${item.id}`);
        editCorrective(data.record);
        return;
      }

      if (item.type === 'command') {
        const data = await request(`/api/commands/${item.id}`);
        editCommand(data.record);
        return;
      }

      if (item.type === 'appointment') {
        const data = await request(`/api/appointments/${item.id}`);
        editAppointment(data.record);
        return;
      }

      if (item.type === 'turnstile') {
        const data = await request(`/api/turnstiles/${item.id}`);
        editTurnstile(data.record);
      }
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function openNotification(item) {
    if (item.key && !item.read) {
      await request('/api/notifications/read', { method: 'POST', body: { key: item.key } });
      await loadNotifications();
    }

    await openGlobalResult({ id: item.id, type: item.type === 'turnstile' ? 'turnstile' : item.type });
  }

  async function markAllNotificationsRead() {
    const keys = (notifications?.notifications || []).filter((item) => !item.read).map((item) => item.key).filter(Boolean);

    if (!keys.length) {
      return;
    }

    try {
      await request('/api/notifications/read', { method: 'POST', body: { keys } });
      await loadNotifications();
      showToast('Notificacoes marcadas como lidas.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function moveAppointment(info) {
    const record = info.event.extendedProps.record;
    const start = info.event.start;
    const visitDate = start?.toISOString().slice(0, 10);
    const visitTime = start && !info.event.allDay ? start.toTimeString().slice(0, 5) : record.visitTime;

    try {
      await request(`/api/appointments/${record.id}/date`, {
        method: 'PATCH',
        body: { visitDate, visitTime },
      });
      await Promise.all([loadAppointments(), refreshOperationalData()]);
      showToast('Agendamento remarcado.');
    } catch (error) {
      info.revert();
      showToast(error.message, 'error');
    }
  }

  async function moveTurnstile(recordId, status) {
    try {
      await request(`/api/turnstiles/${recordId}/status`, { method: 'PATCH', body: { status } });
      await Promise.all([loadTurnstiles(), refreshOperationalData()]);
      showToast('Status da catraca atualizado.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function uploadPhotos(event) {
    const files = Array.from(event.target.files || []);

    if (!editingTurnstileId || !files.length) {
      return;
    }

    try {
      for (const file of files) {
        const dataBase64 = await fileToDataUrl(file);
        await request(`/api/turnstiles/${editingTurnstileId}/photos`, {
          method: 'POST',
          body: {
            fileName: file.name,
            mimeType: file.type,
            dataBase64,
            uploadedBy: 'web',
          },
        });
      }

      event.target.value = '';
      await Promise.all([loadTurnstilePhotos(editingTurnstileId), loadTurnstiles(), refreshOperationalData()]);
      showToast('Fotos anexadas.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function uploadAppointmentPhotos(event) {
    const files = Array.from(event.target.files || []);

    if (!editingAppointmentId || !files.length) {
      return;
    }

    try {
      for (const file of files) {
        const dataBase64 = await fileToDataUrl(file);
        await request(`/api/appointments/${editingAppointmentId}/photos`, {
          method: 'POST',
          body: {
            fileName: file.name,
            mimeType: file.type,
            dataBase64,
            uploadedBy: 'web',
          },
        });
      }

      event.target.value = '';
      await Promise.all([loadAppointmentPhotos(editingAppointmentId), loadAppointments(), refreshOperationalData()]);
      showToast('Fotos anexadas.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function deleteTurnstilePhoto(photoId) {
    if (!window.confirm('Apagar esta imagem?')) {
      return;
    }

    try {
      await request(`/api/turnstiles/photos/${photoId}`, { method: 'DELETE' });
      await Promise.all([loadTurnstilePhotos(editingTurnstileId), loadTurnstiles(), refreshOperationalData()]);
      showToast('Imagem apagada.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function deleteAppointmentPhoto(photoId) {
    if (!window.confirm('Apagar esta imagem?')) {
      return;
    }

    try {
      await request(`/api/appointments/photos/${photoId}`, { method: 'DELETE' });
      await Promise.all([loadAppointmentPhotos(editingAppointmentId), loadAppointments(), refreshOperationalData()]);
      showToast('Imagem apagada.');
    } catch (error) {
      showToast(error.message, 'error');
    }
  }

  async function openDashboardReport(metric) {
    setDashboardReportLoading(true);
    setDashboardReport(null);

    try {
      const params = new URLSearchParams({ metric });

      if (selectedPeriodId) {
        params.set('periodId', selectedPeriodId);
      }

      const report = await request(`/api/dashboard/report?${params}`);
      setDashboardReport(report);
    } catch (error) {
      showToast(error.message, 'error');
    } finally {
      setDashboardReportLoading(false);
    }
  }

  if (loading) {
    return (
      <main className="app-shell">
        <div className="loading-panel">
          <RefreshCw className="spin" />
          <span>Carregando Corretivas</span>
        </div>
      </main>
    );
  }

  return (
    <main className="app-shell">
      <header className="topbar">
        <div>
          <div className="brand-row">
            <Database size={25} />
            <h1>Corretivas</h1>
          </div>
          <div className="header-meta">
            <PeriodBadge period={selectedPeriod} />
            <span>{periodWritable ? 'Ativo para lancamento' : 'Consulta encerrada'}</span>
          </div>
        </div>

        <GlobalSearch onOpen={openGlobalResult} showToast={showToast} />

        <div className="topbar-actions">
          <NotificationCenter notifications={notifications} onOpen={openNotification} onReadAll={markAllNotificationsRead} />
          <div className="period-control">
            <CalendarDays size={18} />
            <select value={selectedPeriodId} onChange={(event) => setSelectedPeriodId(event.target.value)}>
              {periods.map((period) => (
                <option key={period.id} value={period.id}>
                  {period.year} - {period.status === 'active' ? 'ativo' : 'encerrado'}
                </option>
              ))}
            </select>
          </div>
        </div>
      </header>

      <nav className="tabs" aria-label="Secoes">
        {tabs.map((tab) => {
          const Icon = tab.icon;
          return (
            <button
              key={tab.id}
              className={activeTab === tab.id ? 'active' : ''}
              type="button"
              onClick={() => setActiveTab(tab.id)}
            >
              <Icon size={18} />
              <span>{tab.label}</span>
            </button>
          );
        })}
      </nav>

      {toast && <div className={`toast ${toast.type}`}>{toast.message}</div>}

      {activeTab === 'dashboard' && (
        <section className="workspace">
          <section className="stats-grid expanded">
            {dashboardMetricTiles.map((tile) => (
              <StatTile
                key={tile.metric}
                icon={tile.icon}
                label={tile.label}
                value={dashboard?.stats?.[tile.stat]}
                onClick={() => openDashboardReport(tile.metric)}
              />
            ))}
          </section>

          <DashboardReportPanel
            report={dashboardReport}
            loading={dashboardReportLoading}
            onClose={() => {
              setDashboardReport(null);
              setDashboardReportLoading(false);
            }}
          />

          {(clientHistory || technicianHistory) && (
            <section className="list-panel detail-panel">
              <div className="section-title">
                <h2>{clientHistory ? 'Historico completo do cliente' : 'Historico completo do tecnico'}</h2>
                <IconAction
                  title="Fechar historico"
                  onClick={() => {
                    setClientHistory(null);
                    setTechnicianHistory(null);
                  }}
                >
                  <X size={18} />
                </IconAction>
              </div>

              {clientHistory && (
                <div className="detail-grid">
                  <div className="summary-card">
                    <h3>{clientHistory.client.name}</h3>
                    <p>{clientHistory.client.address || 'Endereco nao informado'}</p>
                    <p>{clientHistory.client.contact || 'Contato nao informado'}</p>
                  </div>
                  <div className="summary-strip">
                    <StatTile icon={ClipboardList} label="Atendimentos" value={clientHistory.indicators.totalAttendances} />
                    <StatTile icon={ListChecks} label="Comandas" value={clientHistory.indicators.totalCommands} />
                    <StatTile icon={Download} label="Faturado" value={formatMoney(clientHistory.indicators.totalBilled)} />
                    <StatTile icon={CalendarDays} label="Ultimo atendimento" value={formatDate(clientHistory.indicators.lastAttendance)} />
                  </div>
                  <HistoryTables history={clientHistory.history} openClientHistory={openClientHistory} />
                </div>
              )}

              {technicianHistory && (
                <div className="detail-grid">
                  <div className="summary-card">
                    <h3>{technicianHistory.technician}</h3>
                    <p>Visitas, ocorrencias e comandas vinculadas.</p>
                    <ExportButtons resource="technicians" params={technicianExportParams} compact />
                  </div>
                  <HistoryTables history={technicianHistory.history} openClientHistory={openClientHistory} />
                </div>
              )}
            </section>
          )}

          <section className="workspace two-column dashboard-grid">
            <div className="list-panel">
              <div className="section-title">
                <h2>Atendimentos por cliente no mes</h2>
                <PieChart size={18} />
              </div>
              <DonutChart rows={dashboard?.charts?.attendanceByClient || []} />
            </div>

            <div className="list-panel">
              <div className="section-title">
                <h2>Atividade operacional</h2>
                <BarChart3 size={18} />
              </div>
              <MiniBarChart rows={dashboard?.charts?.monthlyActivity || []} keys={['correctives', 'appointments']} />
            </div>
          </section>

          <section className="workspace two-column dashboard-grid">
            <div className="list-panel">
              <div className="section-title">
                <h2>Proximas visitas agendadas</h2>
              </div>
              <div className="compact-list">
                {(dashboard?.lists?.upcomingAppointments || []).map((record) => (
                  <button key={record.id} type="button" onClick={() => editAppointment(record)}>
                    <strong>{record.clientName}</strong>
                    <span>
                      {formatDate(record.visitDate)} {record.visitTime || ''} - {record.technician || 'Sem tecnico'}
                    </span>
                  </button>
                ))}
                {!(dashboard?.lists?.upcomingAppointments || []).length && <EmptyState label="Nenhuma visita futura." />}
              </div>
            </div>

            <div className="entry-panel compact-panel period-panel">
              <div className="section-title">
                <h2>Periodo ativo</h2>
              </div>
              <div className="active-period-display">
                <Archive size={30} />
                <strong>{activePeriod?.year || '-'}</strong>
                <span>{activePeriod ? 'Aberto' : 'Sem periodo ativo'}</span>
              </div>
              <button className="primary-button close-period" type="button" onClick={closeCurrentPeriod} disabled={!activePeriod}>
                <Archive size={18} />
                Encerrar ano e iniciar proximo
              </button>
            </div>
          </section>

          <section className="workspace two-column dashboard-grid">
            <div className="list-panel">
              <div className="section-title">
                <h2>Gestao de tecnicos</h2>
                <ExportButtons resource="technicians" params={technicianExportParams} compact />
              </div>
              <div className="toolbar">
                <Field label="Inicio">
                  <input type="date" value={technicianStartDate} onChange={(event) => setTechnicianStartDate(event.target.value)} />
                </Field>
                <Field label="Fim">
                  <input type="date" value={technicianEndDate} onChange={(event) => setTechnicianEndDate(event.target.value)} />
                </Field>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Tecnico</th>
                      <th>Visitas</th>
                      <th>Ocorrencias concluidas</th>
                      <th>Agendamentos</th>
                      <th>Valor visitas</th>
                      <th>Valor pecas</th>
                    </tr>
                  </thead>
                  <tbody>
                    {technicians.map((record) => (
                      <tr key={record.name}>
                        <td>
                          <button className="text-link" type="button" onClick={() => openTechnicianHistory(record.name)}>
                            {record.name}
                          </button>
                        </td>
                        <td>{record.visitsDone}</td>
                        <td>{record.correctivesDone}</td>
                        <td>{record.appointments}</td>
                        <td>{formatMoney(record.visitTotal)}</td>
                        <td>{formatMoney(record.partsTotal)}</td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!technicians.length && <EmptyState label="Nenhum tecnico encontrado." />}
              </div>
            </div>

            <div className="list-panel">
              <div className="section-title">
                <h2>Relatorio mensal automatico</h2>
                <ExportButtons resource="monthly-report" params={{ month: monthlyReportMonth }} compact />
              </div>
              <div className="toolbar">
                <Field label="Mes">
                  <input type="month" value={monthlyReportMonth} onChange={(event) => setMonthlyReportMonth(event.target.value)} />
                </Field>
              </div>
              <div className="summary-strip stacked">
                <StatTile icon={MonitorCheck} label="Atendimentos" value={monthlyReport?.totals?.attendances} />
                <StatTile icon={CalendarDays} label="Visitas" value={monthlyReport?.totals?.visits} />
                <StatTile icon={ClipboardList} label="Ocorrencias" value={monthlyReport?.totals?.correctives} />
                <StatTile icon={Users} label="Clientes" value={monthlyReport?.totals?.clients} />
                <StatTile icon={Wrench} label="Catracas entregues" value={monthlyReport?.totals?.deliveredTurnstiles} />
              </div>
              <div className="compact-list">
                {(monthlyReport?.topTechnicians || []).map((record) => (
                  <button key={record.name} type="button" onClick={() => openTechnicianHistory(record.name)}>
                    <strong>{record.name}</strong>
                    <span>{record.total} atendimentos</span>
                  </button>
                ))}
              </div>
            </div>
          </section>
        </section>
      )}

      {activeTab === 'appointments' && (
        <section className="workspace two-column">
          <form className="entry-panel compact-panel" onSubmit={saveAppointment}>
            <div className="section-title">
              <h2>{editingAppointmentId ? 'Editar agendamento' : 'Novo agendamento'}</h2>
              {editingAppointmentId && (
                <IconAction
                  title="Cancelar edicao"
                  onClick={() => {
                    setEditingAppointmentId(null);
                    setAppointmentForm(emptyAppointment);
                    setAppointmentPhotos([]);
                  }}
                >
                  <X size={18} />
                </IconAction>
              )}
            </div>
            <div className="form-grid single-column">
              <Field label="Nome do cliente">
                <input
                  list="client-list"
                  value={appointmentForm.clientName}
                  onChange={(event) => updateAppointment('clientName', event.target.value)}
                />
              </Field>
              <Field label="Endereco">
                <input value={appointmentForm.address} onChange={(event) => updateAppointment('address', event.target.value)} />
              </Field>
              <Field label="Problema relatado">
                <textarea
                  rows="3"
                  value={appointmentForm.reportedProblem}
                  onChange={(event) => updateAppointment('reportedProblem', event.target.value)}
                />
              </Field>
              <Field label="Observacoes">
                <textarea rows="3" value={appointmentForm.notes} onChange={(event) => updateAppointment('notes', event.target.value)} />
              </Field>
              <div className="notes-block">
                <div className="notes-block-title">
                  <strong>Anotacoes do agendamento</strong>
                  <span>Informacoes importantes para a proxima visita</span>
                </div>
                <textarea
                  rows="4"
                  value={appointmentForm.annotations}
                  onChange={(event) => updateAppointment('annotations', event.target.value)}
                />
              </div>
              <div className="form-grid two-fields">
                <Field label="Data da visita">
                  <input
                    type="date"
                    value={appointmentForm.visitDate}
                    onChange={(event) => updateAppointment('visitDate', event.target.value)}
                  />
                </Field>
                <Field label="Horario">
                  <input
                    type="time"
                    value={appointmentForm.visitTime}
                    onChange={(event) => updateAppointment('visitTime', event.target.value)}
                  />
                </Field>
              </div>
              <Field label="Tecnico responsavel">
                <input
                  list="technician-list"
                  value={appointmentForm.technician}
                  onChange={(event) => updateAppointment('technician', event.target.value)}
                />
              </Field>
              <div className="form-grid two-fields">
                <Field label="Valor da visita">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={appointmentForm.visitValue}
                    onChange={(event) => updateAppointment('visitValue', event.target.value)}
                  />
                </Field>
                <Field label="Valor das pecas">
                  <input
                    type="number"
                    min="0"
                    step="0.01"
                    value={appointmentForm.partsValue}
                    onChange={(event) => updateAppointment('partsValue', event.target.value)}
                  />
                </Field>
              </div>
              <div className="form-grid two-fields">
                <Field label="Tipo visita">
                  <select value={appointmentForm.visitType} onChange={(event) => updateAppointment('visitType', event.target.value)}>
                    <option value="">Selecione</option>
                    {appointmentVisitTypes.map((type) => (
                      <option key={type} value={type}>
                        {type}
                      </option>
                    ))}
                  </select>
                </Field>
                <Field label="Status">
                  <select value={appointmentForm.status} onChange={(event) => updateAppointment('status', event.target.value)}>
                    {appointmentStatuses.map((status) => (
                      <option key={status}>{status}</option>
                    ))}
                  </select>
                </Field>
              </div>
            </div>
            <div className="form-actions">
              <button className="primary-button" type="submit">
                <Save size={18} />
                {editingAppointmentId ? 'Salvar edicao' : 'Cadastrar'}
              </button>
            </div>

            {editingAppointmentId && (
              <div className="photo-panel">
                <div className="section-title">
                  <h2>Anexo de fotos</h2>
                  <label className="secondary-button small file-button">
                    <Upload size={16} />
                    Enviar
                    <input type="file" accept="image/*" multiple onChange={uploadAppointmentPhotos} />
                  </label>
                </div>
                <div className="photo-grid">
                  {appointmentPhotos.map((photo) => (
                    <div className="photo-card" key={photo.id}>
                      <a href={photoDownloadUrl(photo.id, 'appointments')} title="Baixar imagem">
                        <img src={photoImageUrl(photo)} alt={photo.originalName || photo.fileName} />
                        <span>{photo.originalName || photo.fileName}</span>
                      </a>
                      <IconAction title="Apagar imagem" danger onClick={() => deleteAppointmentPhoto(photo.id)}>
                        <Trash2 size={15} />
                      </IconAction>
                    </div>
                  ))}
                  {!appointmentPhotos.length && <EmptyState label="Nenhuma foto anexada." />}
                </div>
              </div>
            )}
          </form>

          <div className="list-panel">
            <div className="section-title">
              <h2>Controle de visitas tecnicas</h2>
              <ExportButtons resource="appointments" params={appointmentExportParams} compact />
            </div>
            <div className="toolbar">
              <div className="search-box">
                <Search size={17} />
                <input placeholder="Buscar cliente" value={appointmentsSearch} onChange={(event) => setAppointmentsSearch(event.target.value)} />
              </div>
              <select value={appointmentsTechnician} onChange={(event) => setAppointmentsTechnician(event.target.value)}>
                <option value="">Todos os tecnicos</option>
                {technicianOptions.map((technician) => (
                  <option key={technician}>{technician}</option>
                ))}
              </select>
              <select value={appointmentsVisitType} onChange={(event) => setAppointmentsVisitType(event.target.value)}>
                <option value="">Todos os tipos</option>
                {appointmentVisitTypes.map((type) => (
                  <option key={type} value={type}>
                    {type}
                  </option>
                ))}
              </select>
              <input type="date" value={appointmentsStartDate} onChange={(event) => setAppointmentsStartDate(event.target.value)} />
              <input type="date" value={appointmentsEndDate} onChange={(event) => setAppointmentsEndDate(event.target.value)} />
              <div className="segmented">
                <button className={appointmentsMode === 'list' ? 'active' : ''} type="button" onClick={() => setAppointmentsMode('list')}>
                  Lista
                </button>
                <button
                  className={appointmentsMode === 'calendar' ? 'active' : ''}
                  type="button"
                  onClick={() => setAppointmentsMode('calendar')}
                >
                  Calendario
                </button>
              </div>
              <span className="counter">{appointmentsTotal} registros</span>
            </div>

            {appointmentsMode === 'calendar' ? (
              <div className="calendar-panel">
                <Suspense
                  fallback={
                    <div className="loading-panel embedded">
                      <RefreshCw className="spin" />
                      <span>Carregando calendario</span>
                    </div>
                  }
                >
                  <CalendarView events={appointmentEvents} onEventDrop={moveAppointment} onEventClick={editAppointment} />
                </Suspense>
              </div>
            ) : (
              <>
                <div className="table-wrap">
                  <table>
                    <thead>
                      <tr>
                        <th>Data</th>
                        <th>Cliente</th>
                        <th>Endereco</th>
                        <th>Problema</th>
                        <th>Tecnico</th>
                        <th>Valores</th>
                        <th>Fotos</th>
                        <th>Tipo visita</th>
                        <th>Status</th>
                        <th className="actions-heading">Acoes</th>
                      </tr>
                    </thead>
                    <tbody>
                      {appointments.map((record) => (
                        <tr key={record.id}>
                          <td>
                            {formatDate(record.visitDate)}
                            {record.visitTime ? ` ${record.visitTime}` : ''}
                            {record.conflictCount > 0 && <StatusPill value="Conflito" />}
                          </td>
                          <td>
                            <button className="text-link" type="button" onClick={() => openClientHistory(record.clientName)}>
                              {record.clientName}
                            </button>
                          </td>
                          <td>{record.address}</td>
                          <td className="long-cell">
                            <div>{record.reportedProblem}</div>
                            {record.notes && <small className="cell-note">Obs: {record.notes}</small>}
                            {record.annotations && <small className="cell-note">Anotacoes: {record.annotations}</small>}
                          </td>
                          <td>{record.technician}</td>
                          <td>
                            {formatMoney(record.visitValue)}
                            <br />
                            {formatMoney(record.partsValue)}
                          </td>
                          <td>
                            {record.photoCount > 0 ? (
                              <span className="photo-count">
                                <ImageIcon size={13} /> {record.photoCount}
                              </span>
                            ) : (
                              0
                            )}
                          </td>
                          <td>{record.visitType || '-'}</td>
                          <td>
                            <StatusPill value={record.status} />
                          </td>
                          <td className="row-actions">
                            <IconAction title="Editar" onClick={() => editAppointment(record)}>
                              <Edit3 size={17} />
                            </IconAction>
                            <IconAction
                              title="Excluir"
                              danger
                              onClick={() =>
                                deleteRecord(`/api/appointments/${record.id}`, () =>
                                  Promise.all([loadAppointments(), refreshOperationalData()]),
                                'agendamento')
                              }
                            >
                              <Trash2 size={17} />
                            </IconAction>
                          </td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                  {!appointments.length && <EmptyState label="Nenhum agendamento encontrado." />}
                </div>
                <div className="pagination">
                  <button
                    type="button"
                    disabled={appointmentsPage <= 1}
                    onClick={() => setAppointmentsPage((page) => Math.max(1, page - 1))}
                  >
                    Anterior
                  </button>
                  <span>
                    Pagina {appointmentsPage} de {totalAppointmentPages}
                  </span>
                  <button
                    type="button"
                    disabled={appointmentsPage >= totalAppointmentPages}
                    onClick={() => setAppointmentsPage((page) => Math.min(totalAppointmentPages, page + 1))}
                  >
                    Proxima
                  </button>
                </div>
              </>
            )}
          </div>
        </section>
      )}

      {activeTab === 'correctives' && (
        <section className="workspace">
          <section className="workspace correctives-workspace">
            <form className="entry-panel" onSubmit={saveCorrective}>
              <div className="section-title">
                <h2>{editingCorrectiveId ? 'Editar ocorrencia' : 'Nova ocorrencia'}</h2>
                {editingCorrectiveId && (
                  <IconAction
                    title="Cancelar edicao"
                    onClick={() => {
                      setEditingCorrectiveId(null);
                      setCorrectiveForm(emptyCorrective);
                    }}
                  >
                    <X size={18} />
                  </IconAction>
                )}
              </div>

              <fieldset disabled={!periodWritable}>
                <div className="form-grid correctives-grid">
                  <Field label="Data">
                    <input
                      type="date"
                      value={correctiveForm.occurrenceDate}
                      onChange={(event) => updateCorrective('occurrenceDate', event.target.value)}
                    />
                  </Field>
                  <Field label="Cliente">
                    <input
                      list="client-list"
                      value={correctiveForm.client}
                      onChange={(event) => updateCorrective('client', event.target.value)}
                    />
                  </Field>
                  <Field label="Contato">
                    <input value={correctiveForm.contact} onChange={(event) => updateCorrective('contact', event.target.value)} />
                  </Field>
                  <Field label="Nome solicitante">
                    <input
                      value={correctiveForm.requesterName}
                      onChange={(event) => updateCorrective('requesterName', event.target.value)}
                    />
                  </Field>
                  <Field label="Motivo" wide>
                    <textarea rows="3" value={correctiveForm.reason} onChange={(event) => updateCorrective('reason', event.target.value)} />
                  </Field>
                  <Field label="Resolucao" wide>
                    <textarea
                      rows="3"
                      value={correctiveForm.resolution}
                      onChange={(event) => updateCorrective('resolution', event.target.value)}
                    />
                  </Field>
                  <Field label="Dificuldade">
                    <select value={correctiveForm.difficulty} onChange={(event) => updateCorrective('difficulty', event.target.value)}>
                      <option value="">Sem nota</option>
                      {difficultyOptions.map((option) => (
                        <option key={option.value} value={option.value}>
                          {option.label}
                        </option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Tecnico">
                    <input
                      list="technician-list"
                      value={correctiveForm.technician}
                      onChange={(event) => updateCorrective('technician', event.target.value)}
                    />
                  </Field>
                  <Field label="Backup">
                    <select value={correctiveForm.backupStatus} onChange={(event) => updateCorrective('backupStatus', event.target.value)}>
                      {healthOptions.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Firewall">
                    <select
                      value={correctiveForm.firewallStatus}
                      onChange={(event) => updateCorrective('firewallStatus', event.target.value)}
                    >
                      {healthOptions.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Opcoes de Energia">
                    <select
                      value={correctiveForm.powerOptionsStatus}
                      onChange={(event) => updateCorrective('powerOptionsStatus', event.target.value)}
                    >
                      {healthOptions.map((option) => (
                        <option key={option}>{option}</option>
                      ))}
                    </select>
                  </Field>
                  <Field label="Data de Solucao">
                    <input
                      type="date"
                      value={correctiveForm.solutionDate}
                      onChange={(event) => updateCorrective('solutionDate', event.target.value)}
                    />
                  </Field>
                </div>
              </fieldset>

              <div className="form-actions">
                <button className="primary-button" type="submit" disabled={!periodWritable}>
                  <Save size={18} />
                  {editingCorrectiveId ? 'Salvar edicao' : 'Registrar ocorrencia'}
                </button>
              </div>
            </form>

            <div className="list-panel">
              <div className="section-title">
                <h2>Ocorrencias do periodo</h2>
                <ExportButtons resource="correctives" params={{ periodId: selectedPeriodId }} compact />
              </div>
              <div className="toolbar">
                <div className="search-box">
                  <Search size={17} />
                  <input placeholder="Buscar" value={correctivesSearch} onChange={(event) => setCorrectivesSearch(event.target.value)} />
                </div>
                <span className="counter">{correctivesTotal} registros</span>
              </div>

              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Data</th>
                      <th>Cliente</th>
                      <th>Contato</th>
                      <th>Solicitante</th>
                      <th>Motivo</th>
                      <th>Resolucao</th>
                      <th>Dificuldade</th>
                      <th>Tecnico</th>
                      <th>Bkp, Opc. Enrg, FW</th>
                      <th>Data de Solucao</th>
                      <th className="actions-heading">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {correctives.map((record) => (
                      <tr key={record.id}>
                        <td>{formatDate(record.occurrenceDate)}</td>
                        <td>
                          <button className="text-link" type="button" onClick={() => openClientHistory(record.client)}>
                            {record.client}
                          </button>
                        </td>
                        <td>{record.contact}</td>
                        <td>{record.requesterName}</td>
                        <td className="long-cell">{record.reason}</td>
                        <td className="long-cell">{record.resolution}</td>
                        <td>{record.difficulty || '-'}</td>
                        <td>{record.technician}</td>
                        <td>
                          <StatusPill value={record.backupStatus} />
                          <StatusPill value={record.firewallStatus} />
                          <StatusPill value={record.powerOptionsStatus} />
                        </td>
                        <td>{formatDate(record.solutionDate)}</td>
                        <td className="row-actions">
                          <IconAction title="Editar" disabled={!periodWritable} onClick={() => editCorrective(record)}>
                            <Edit3 size={17} />
                          </IconAction>
                          <IconAction
                            title="Excluir"
                            danger
                            disabled={!periodWritable}
                            onClick={() =>
                              deleteRecord(`/api/correctives/${record.id}`, () =>
                                Promise.all([loadCorrectives(), refreshOperationalData()]),
                              'ocorrencia')
                            }
                          >
                            <Trash2 size={17} />
                          </IconAction>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!correctives.length && <EmptyState label="Nenhuma ocorrencia encontrada." />}
              </div>

              <div className="pagination">
                <button type="button" disabled={correctivesPage <= 1} onClick={() => setCorrectivesPage((page) => Math.max(1, page - 1))}>
                  Anterior
                </button>
                <span>
                  Pagina {correctivesPage} de {totalCorrectivePages}
                </span>
                <button
                  type="button"
                  disabled={correctivesPage >= totalCorrectivePages}
                  onClick={() => setCorrectivesPage((page) => Math.min(totalCorrectivePages, page + 1))}
                >
                  Proxima
                </button>
              </div>
            </div>
          </section>

          <section className="workspace two-column dashboard-grid">
            <div className="list-panel">
              <div className="section-title">
                <h2>Dashboard de atendimentos</h2>
                <PieChart size={18} />
              </div>
              <DonutChart rows={dashboard?.charts?.attendanceByClient || []} />
            </div>

            <div className="list-panel">
              <div className="section-title">
                <h2>Relatorio diario</h2>
                <ExportButtons resource="daily-report" params={dailyExportParams} compact />
              </div>
              <div className="toolbar">
                <Field label="Inicio">
                  <input type="date" value={dailyStartDate} onChange={(event) => setDailyStartDate(event.target.value)} />
                </Field>
                <Field label="Fim">
                  <input type="date" value={dailyEndDate} onChange={(event) => setDailyEndDate(event.target.value)} />
                </Field>
              </div>
              <div className="table-wrap compact-table">
                <table>
                  <thead>
                    <tr>
                      <th>Tipo</th>
                      <th>Cliente</th>
                      <th>Tecnico</th>
                      <th>Data</th>
                      <th>Problema</th>
                      <th>Status</th>
                      <th>Valores</th>
                    </tr>
                  </thead>
                  <tbody>
                    {dailyReport.map((record, index) => (
                      <tr key={`${record.source}-${index}`}>
                        <td>{record.source}</td>
                        <td>{record.client}</td>
                        <td>{record.technician}</td>
                        <td>{formatDate(record.date)}</td>
                        <td className="long-cell">{record.problem}</td>
                        <td>
                          <StatusPill value={record.status} />
                        </td>
                        <td>
                          {formatMoney(record.visit_value)}
                          <br />
                          {formatMoney(record.parts_value)}
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!dailyReport.length && <EmptyState label="Nenhum registro no periodo." />}
              </div>
            </div>
          </section>

          <section className="workspace two-column">
            <form className="entry-panel compact-panel" onSubmit={saveCase}>
              <div className="section-title">
                <h2>{editingCaseId ? 'Editar caso monitorado' : 'Novo caso monitorado'}</h2>
                {editingCaseId && (
                  <IconAction
                    title="Cancelar edicao"
                    onClick={() => {
                      setEditingCaseId(null);
                      setCaseForm(emptyCase);
                    }}
                  >
                    <X size={18} />
                  </IconAction>
                )}
              </div>
              <div className="form-grid single-column">
                <Field label="Cliente">
                  <input list="client-list" value={caseForm.clientName} onChange={(event) => updateCase('clientName', event.target.value)} />
                </Field>
                <Field label="Data de inicio">
                  <input type="date" value={caseForm.startDate} onChange={(event) => updateCase('startDate', event.target.value)} />
                </Field>
                <Field label="Situacao">
                  <select value={caseForm.situation} onChange={(event) => updateCase('situation', event.target.value)}>
                    {situations.map((situation) => (
                      <option key={situation}>{situation}</option>
                    ))}
                  </select>
                </Field>
              </div>
              <div className="form-actions">
                <button className="primary-button" type="submit">
                  <Save size={18} />
                  {editingCaseId ? 'Salvar edicao' : 'Adicionar caso'}
                </button>
              </div>
            </form>

            <div className="list-panel">
              <div className="section-title">
                <h2>Casos monitorados</h2>
              </div>
              <div className="toolbar">
                <div className="search-box">
                  <Search size={17} />
                  <input placeholder="Buscar cliente" value={caseSearch} onChange={(event) => setCaseSearch(event.target.value)} />
                </div>
                <select value={caseSituation} onChange={(event) => setCaseSituation(event.target.value)}>
                  <option value="">Todas as situacoes</option>
                  {situations.map((situation) => (
                    <option key={situation}>{situation}</option>
                  ))}
                </select>
              </div>
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Data de inicio</th>
                      <th>Situacao</th>
                      <th className="actions-heading">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {cases.map((record) => (
                      <tr key={record.id}>
                        <td>{record.clientName}</td>
                        <td>{formatDate(record.startDate)}</td>
                        <td>
                          <StatusPill value={record.situation} />
                        </td>
                        <td className="row-actions">
                          <IconAction title="Editar" onClick={() => editCase(record)}>
                            <Edit3 size={17} />
                          </IconAction>
                          <IconAction
                            title="Excluir"
                            danger
                            onClick={() =>
                              deleteRecord(`/api/cases/${record.id}`, () => Promise.all([loadCases(), refreshOperationalData()]), 'caso')
                            }
                          >
                            <Trash2 size={17} />
                          </IconAction>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!cases.length && <EmptyState label="Nenhum caso encontrado." />}
              </div>
            </div>
          </section>
        </section>
      )}

      {activeTab === 'commands' && (
        <section className="workspace two-column">
          <form className="entry-panel compact-panel" onSubmit={saveCommand}>
            <div className="section-title">
              <h2>{editingCommandId ? 'Editar comanda' : 'Nova comanda'}</h2>
              {editingCommandId && (
                <IconAction
                  title="Cancelar edicao"
                  onClick={() => {
                    setEditingCommandId(null);
                    setCommandForm(emptyCommand);
                  }}
                >
                  <X size={18} />
                </IconAction>
              )}
            </div>
            <fieldset disabled={!periodWritable}>
              <div className="form-grid single-column">
                <Field label="Padaria">
                  <input list="client-list" value={commandForm.bakery} onChange={(event) => updateCommand('bakery', event.target.value)} />
                </Field>
                <Field label="D/M Conf.">
                  <input value={commandForm.dmConf} onChange={(event) => updateCommand('dmConf', event.target.value)} />
                </Field>
                <Field label="D/M Cad.">
                  <input value={commandForm.dmCad} onChange={(event) => updateCommand('dmCad', event.target.value)} />
                </Field>
                <Field label="D/M Imp.">
                  <input value={commandForm.dmImp} onChange={(event) => updateCommand('dmImp', event.target.value)} />
                </Field>
                <Field label="Cadastrador Exacta">
                  <input
                    list="technician-list"
                    value={commandForm.exactaRegistrar}
                    onChange={(event) => updateCommand('exactaRegistrar', event.target.value)}
                  />
                </Field>
                <Field label="Cadastrador Cliente">
                  <input
                    list="technician-list"
                    value={commandForm.clientRegistrar}
                    onChange={(event) => updateCommand('clientRegistrar', event.target.value)}
                  />
                </Field>
              </div>
            </fieldset>
            <div className="form-actions">
              <button className="primary-button" type="submit" disabled={!periodWritable}>
                <Plus size={18} />
                {editingCommandId ? 'Salvar edicao' : 'Cadastrar comanda'}
              </button>
            </div>
          </form>

          <div className="list-panel">
            <div className="section-title">
              <h2>Comandas do periodo</h2>
            </div>
            <div className="toolbar">
              <div className="search-box">
                <Search size={17} />
                <input placeholder="Buscar" value={commandSearch} onChange={(event) => setCommandSearch(event.target.value)} />
              </div>
            </div>
            <div className="table-wrap">
              <table>
                <thead>
                  <tr>
                    <th>Padaria</th>
                    <th>D/M Conf.</th>
                    <th>D/M Cad.</th>
                    <th>D/M Imp.</th>
                    <th>Cadastrador Exacta</th>
                    <th>Cadastrador Cliente</th>
                    <th className="actions-heading">Acoes</th>
                  </tr>
                </thead>
                <tbody>
                  {commands.map((record) => (
                    <tr key={record.id}>
                      <td>
                        <button className="text-link" type="button" onClick={() => openClientHistory(record.bakery)}>
                          {record.bakery}
                        </button>
                      </td>
                      <td>{record.dmConf}</td>
                      <td>{record.dmCad}</td>
                      <td>{record.dmImp}</td>
                      <td>{record.exactaRegistrar}</td>
                      <td>{record.clientRegistrar}</td>
                      <td className="row-actions">
                        <IconAction title="Editar" disabled={!periodWritable} onClick={() => editCommand(record)}>
                          <Edit3 size={17} />
                        </IconAction>
                        <IconAction
                          title="Excluir"
                          danger
                          disabled={!periodWritable}
                          onClick={() =>
                            deleteRecord(`/api/commands/${record.id}`, () => Promise.all([loadCommands(), refreshOperationalData()]), 'comanda')
                          }
                        >
                          <Trash2 size={17} />
                        </IconAction>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
              {!commands.length && <EmptyState label="Nenhuma comanda encontrada." />}
            </div>
          </div>
        </section>
      )}

      {activeTab === 'turnstiles' && (
        <section className="workspace two-column">
          <form className="entry-panel compact-panel" onSubmit={saveTurnstile}>
            <div className="section-title">
              <h2>{editingTurnstileId ? 'Editar catraca' : 'Nova catraca'}</h2>
              {editingTurnstileId && (
                <IconAction
                  title="Cancelar edicao"
                  onClick={() => {
                    setEditingTurnstileId(null);
                    setTurnstileForm(emptyTurnstile);
                    setTurnstilePhotos([]);
                  }}
                >
                  <X size={18} />
                </IconAction>
              )}
            </div>
            <div className="form-grid single-column">
              <Field label="Nome do cliente">
                <input list="client-list" value={turnstileForm.clientName} onChange={(event) => updateTurnstile('clientName', event.target.value)} />
              </Field>
              <Field label="Modelo da catraca">
                <input value={turnstileForm.model} onChange={(event) => updateTurnstile('model', event.target.value)} />
              </Field>
              <Field label="Endereco do cliente">
                <input value={turnstileForm.clientAddress} onChange={(event) => updateTurnstile('clientAddress', event.target.value)} />
              </Field>
              <Field label="Data prevista de entrega">
                <input
                  type="date"
                  value={turnstileForm.expectedDeliveryDate}
                  onChange={(event) => updateTurnstile('expectedDeliveryDate', event.target.value)}
                />
              </Field>
              <Field label="Status">
                <select value={turnstileForm.status} onChange={(event) => updateTurnstile('status', event.target.value)}>
                  {turnstileStatuses.map((status) => (
                    <option key={status}>{status}</option>
                  ))}
                </select>
              </Field>
              <Field label="Observacoes">
                <textarea rows="4" value={turnstileForm.notes} onChange={(event) => updateTurnstile('notes', event.target.value)} />
              </Field>
            </div>
            <div className="form-actions">
              <button className="primary-button" type="submit">
                <Save size={18} />
                {editingTurnstileId ? 'Salvar edicao' : 'Cadastrar'}
              </button>
            </div>

            {editingTurnstileId && (
              <div className="photo-panel">
                <div className="section-title">
                  <h2>Anexo de fotos</h2>
                  <label className="secondary-button small file-button">
                    <Upload size={16} />
                    Enviar
                    <input type="file" accept="image/*" multiple onChange={uploadPhotos} />
                  </label>
                </div>
                <div className="photo-grid">
                  {turnstilePhotos.map((photo) => (
                    <div className="photo-card" key={photo.id}>
                      <a href={photoDownloadUrl(photo.id)} title="Baixar imagem">
                        <img src={photoImageUrl(photo)} alt={photo.originalName || photo.fileName} />
                        <span>{photo.originalName || photo.fileName}</span>
                      </a>
                      <IconAction title="Apagar imagem" danger onClick={() => deleteTurnstilePhoto(photo.id)}>
                        <Trash2 size={15} />
                      </IconAction>
                    </div>
                  ))}
                  {!turnstilePhotos.length && <EmptyState label="Nenhuma foto anexada." />}
                </div>
              </div>
            )}
          </form>

          <div className="list-panel">
            <div className="section-title">
              <h2>Catracas para montagem</h2>
              <ExportButtons resource="turnstiles" params={turnstileExportParams} compact />
            </div>
            <div className="toolbar">
              <div className="search-box">
                <Search size={17} />
                <input placeholder="Buscar cliente" value={turnstilesSearch} onChange={(event) => setTurnstilesSearch(event.target.value)} />
              </div>
              <select value={turnstilesStatus} onChange={(event) => setTurnstilesStatus(event.target.value)}>
                <option value="">Todos os status</option>
                {turnstileStatuses.map((status) => (
                  <option key={status}>{status}</option>
                ))}
              </select>
              <input type="date" value={turnstilesStartDate} onChange={(event) => setTurnstilesStartDate(event.target.value)} />
              <input type="date" value={turnstilesEndDate} onChange={(event) => setTurnstilesEndDate(event.target.value)} />
              <div className="segmented">
                <button className={turnstilesMode === 'kanban' ? 'active' : ''} type="button" onClick={() => setTurnstilesMode('kanban')}>
                  Kanban
                </button>
                <button className={turnstilesMode === 'list' ? 'active' : ''} type="button" onClick={() => setTurnstilesMode('list')}>
                  Lista
                </button>
              </div>
              <span className="counter">{turnstilesTotal} registros</span>
            </div>

            {turnstilesMode === 'kanban' ? (
              <div className="kanban-board">
                {turnstileStatuses.map((status) => (
                  <div
                    className="kanban-column"
                    key={status}
                    onDragOver={(event) => event.preventDefault()}
                    onDrop={(event) => moveTurnstile(event.dataTransfer.getData('text/plain'), status)}
                  >
                    <div className="kanban-title">
                      <strong>{status}</strong>
                      <span>{turnstiles.filter((record) => record.status === status).length}</span>
                    </div>
                    {turnstiles
                      .filter((record) => record.status === status)
                      .map((record) => (
                        <button
                          className={`kanban-card due-${record.dueStatus}`}
                          key={record.id}
                          type="button"
                          draggable
                          onDragStart={(event) => event.dataTransfer.setData('text/plain', String(record.id))}
                          onClick={() => editTurnstile(record)}
                        >
                          <strong>{record.clientName}</strong>
                          <span>{record.model || 'Sem modelo'}</span>
                          <small>{formatDate(record.expectedDeliveryDate)}</small>
                          {record.photoCount > 0 && (
                            <em>
                              <ImageIcon size={13} /> {record.photoCount}
                            </em>
                          )}
                        </button>
                      ))}
                  </div>
                ))}
              </div>
            ) : (
              <div className="table-wrap">
                <table>
                  <thead>
                    <tr>
                      <th>Cliente</th>
                      <th>Modelo</th>
                      <th>Endereco</th>
                      <th>Entrega</th>
                      <th>Status</th>
                      <th>Prazo</th>
                      <th>Fotos</th>
                      <th className="actions-heading">Acoes</th>
                    </tr>
                  </thead>
                  <tbody>
                    {turnstiles.map((record) => (
                      <tr key={record.id} className={`due-${record.dueStatus}`}>
                        <td>
                          <button className="text-link" type="button" onClick={() => openClientHistory(record.clientName)}>
                            {record.clientName}
                          </button>
                        </td>
                        <td>{record.model}</td>
                        <td>{record.clientAddress}</td>
                        <td>{formatDate(record.expectedDeliveryDate)}</td>
                        <td>
                          <StatusPill value={record.status} />
                        </td>
                        <td>
                          <StatusPill
                            value={
                              record.dueStatus === 'overdue'
                                ? 'Vencido'
                                : record.dueStatus === 'soon'
                                  ? 'Proximo'
                                  : record.dueStatus === 'completed'
                                    ? 'Concluido'
                                    : 'Normal'
                            }
                          />
                        </td>
                        <td>{record.photoCount}</td>
                        <td className="row-actions">
                          <IconAction title="Editar" onClick={() => editTurnstile(record)}>
                            <Edit3 size={17} />
                          </IconAction>
                          <IconAction
                            title="Excluir"
                            danger
                            onClick={() =>
                              deleteRecord(`/api/turnstiles/${record.id}`, () => Promise.all([loadTurnstiles(), refreshOperationalData()]), 'catraca')
                            }
                          >
                            <Trash2 size={17} />
                          </IconAction>
                        </td>
                      </tr>
                    ))}
                  </tbody>
                </table>
                {!turnstiles.length && <EmptyState label="Nenhuma catraca encontrada." />}
              </div>
            )}
          </div>
        </section>
      )}

      <datalist id="client-list">
        {clients.map((client) => (
          <option key={client} value={client} />
        ))}
      </datalist>

      <datalist id="technician-list">
        {technicianOptions.map((technician) => (
          <option key={technician} value={technician} />
        ))}
      </datalist>

      <footer className="footer-strip">
        <span>
          <ShieldCheck size={15} /> Backup
        </span>
        <span>
          <Flame size={15} /> Firewall
        </span>
        <span>
          <Power size={15} /> Opcoes de Energia
        </span>
      </footer>
    </main>
  );
}

function HistoryTables({ history, openClientHistory }) {
  return (
    <div className="history-tables">
      <div className="table-wrap compact-table">
        <table>
          <thead>
            <tr>
              <th>Tipo</th>
              <th>Cliente</th>
              <th>Data</th>
              <th>Detalhe</th>
              <th>Status</th>
            </tr>
          </thead>
          <tbody>
            {(history?.correctives || []).map((record) => (
              <tr key={`cor-${record.id}`}>
                <td>Ocorrencia</td>
                <td>
                  <button className="text-link" type="button" onClick={() => openClientHistory(record.client)}>
                    {record.client}
                  </button>
                </td>
                <td>{formatDate(record.solutionDate || record.occurrenceDate)}</td>
                <td className="long-cell">{record.reason}</td>
                <td>{record.solutionDate ? 'concluida' : 'aberta'}</td>
              </tr>
            ))}
            {(history?.appointments || []).map((record) => (
              <tr key={`age-${record.id}`}>
                <td>Agendamento</td>
                <td>
                  <button className="text-link" type="button" onClick={() => openClientHistory(record.clientName)}>
                    {record.clientName}
                  </button>
                </td>
                <td>{formatDate(record.visitDate)}</td>
                <td className="long-cell">
                  <div>{record.reportedProblem}</div>
                  {record.notes && <small className="cell-note">Obs: {record.notes}</small>}
                </td>
                <td>{record.status}</td>
              </tr>
            ))}
            {(history?.commands || []).map((record) => (
              <tr key={`cmd-${record.id}`}>
                <td>Comanda</td>
                <td>
                  <button className="text-link" type="button" onClick={() => openClientHistory(record.bakery)}>
                    {record.bakery}
                  </button>
                </td>
                <td>-</td>
                <td className="long-cell">{[record.dmConf, record.dmCad, record.dmImp].filter(Boolean).join(' | ')}</td>
                <td>-</td>
              </tr>
            ))}
            {(history?.turnstiles || []).map((record) => (
              <tr key={`cat-${record.id}`}>
                <td>Catraca</td>
                <td>
                  <button className="text-link" type="button" onClick={() => openClientHistory(record.clientName)}>
                    {record.clientName}
                  </button>
                </td>
                <td>{formatDate(record.expectedDeliveryDate)}</td>
                <td className="long-cell">{record.model}</td>
                <td>{record.status}</td>
              </tr>
            ))}
          </tbody>
        </table>
        {![
          ...(history?.correctives || []),
          ...(history?.appointments || []),
          ...(history?.commands || []),
          ...(history?.turnstiles || []),
        ].length && <EmptyState label="Nenhum historico encontrado." />}
      </div>
    </div>
  );
}
