import 'dart:async';
import 'dart:convert';

import 'package:fl_chart/fl_chart.dart' as charts;
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'src/core/api_client.dart';
import 'src/core/theme.dart';

void main() {
  runApp(const CorretivasMobile());
}

class CorretivasMobile extends StatelessWidget {
  const CorretivasMobile({super.key});

  @override
  Widget build(BuildContext context) {
    return MaterialApp(
      title: 'Corretivas',
      debugShowCheckedModeBanner: false,
      theme: CorretivasTheme.dark(),
      home: const OperatorAccessPage(),
    );
  }
}

class AppConfig {
  static const apiBaseUrl = String.fromEnvironment('API_BASE_URL',
      defaultValue: 'https://corretivas.up.railway.app');
}

class OperatorAccessPage extends StatefulWidget {
  const OperatorAccessPage({super.key});

  @override
  State<OperatorAccessPage> createState() => _OperatorAccessPageState();
}

class _OperatorAccessPageState extends State<OperatorAccessPage> {
  static const _operatorNameKey = 'operator_name';
  static const _apiBaseUrlKey = 'api_base_url';

  final _operatorName = TextEditingController();
  final _apiBase = TextEditingController(text: AppConfig.apiBaseUrl);
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _loadSavedAccess();
  }

  Future<void> _loadSavedAccess() async {
    final prefs = await SharedPreferences.getInstance();
    if (!mounted) return;

    _operatorName.text = prefs.getString(_operatorNameKey) ?? '';
    _apiBase.text = prefs.getString(_apiBaseUrlKey) ?? AppConfig.apiBaseUrl;
  }

  @override
  void dispose() {
    _operatorName.dispose();
    _apiBase.dispose();
    super.dispose();
  }

  Future<void> _enter() async {
    final operatorName =
        _operatorName.text.trim().replaceAll(RegExp(r'\s+'), ' ');
    final apiBase = _apiBase.text.trim();

    if (operatorName.isEmpty) {
      setState(() => _error = 'Informe seu nome para acessar.');
      return;
    }

    if (apiBase.isEmpty) {
      setState(() => _error = 'Informe a URL da API.');
      return;
    }

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final prefs = await SharedPreferences.getInstance();
      await prefs.setString(_operatorNameKey, operatorName);
      await prefs.setString(_apiBaseUrlKey, apiBase);

      if (!mounted) return;
      final api = ApiClient(baseUrl: apiBase, operatorName: operatorName);
      Navigator.of(context).pushReplacement(
          MaterialPageRoute(builder: (_) => HomePage(api: api)));
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      body: SafeArea(
        child: ListView(
          padding: const EdgeInsets.all(22),
          children: [
            const SizedBox(height: 36),
            const Icon(Icons.storage_rounded,
                color: CorretivasTheme.accent, size: 42),
            const SizedBox(height: 10),
            Text('Corretivas',
                style: Theme.of(context)
                    .textTheme
                    .headlineMedium
                    ?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 8),
            const Text(
                'Informe seu nome para registrar suas alteracoes no sistema.',
                style: TextStyle(color: CorretivasTheme.muted)),
            const SizedBox(height: 28),
            TextField(
              controller: _operatorName,
              textCapitalization: TextCapitalization.words,
              decoration: const InputDecoration(labelText: 'Seu nome'),
              onSubmitted: (_) => _enter(),
            ),
            const SizedBox(height: 12),
            ExpansionTile(
              tilePadding: EdgeInsets.zero,
              childrenPadding: EdgeInsets.zero,
              title: const Text('Configuracao da API'),
              subtitle: Text(_apiBase.text,
                  maxLines: 1, overflow: TextOverflow.ellipsis),
              children: [
                TextField(
                    controller: _apiBase,
                    decoration: const InputDecoration(labelText: 'URL da API')),
              ],
            ),
            if (_error != null) ...[
              const SizedBox(height: 12),
              Text(_error!,
                  style: const TextStyle(color: CorretivasTheme.danger)),
            ],
            const SizedBox(height: 18),
            FilledButton.icon(
              onPressed: _loading ? null : _enter,
              icon: _loading
                  ? const SizedBox(
                      width: 18,
                      height: 18,
                      child: CircularProgressIndicator(strokeWidth: 2))
                  : const Icon(Icons.person_rounded),
              label: const Text('Entrar'),
            ),
          ],
        ),
      ),
    );
  }
}

class HomePage extends StatefulWidget {
  const HomePage({required this.api, super.key});

  final ApiClient api;

  @override
  State<HomePage> createState() => _HomePageState();
}

class _HomePageState extends State<HomePage> {
  final _queue = OfflineQueue();
  int _index = 0;
  StreamSubscription<Map<String, dynamic>>? _events;
  int _refreshKey = 0;

  @override
  void initState() {
    super.initState();
    _events = widget.api.events().listen((_) {
      if (mounted) {
        setState(() => _refreshKey++);
      }
    }, onError: (_) {});
    _queue.flush(widget.api).catchError((_) => 0);
  }

  @override
  void dispose() {
    _events?.cancel();
    super.dispose();
  }

  void _selectTab(int value) {
    setState(() {
      _index = value;
      _refreshKey++;
    });
  }

  @override
  Widget build(BuildContext context) {
    final pages = [
      DashboardPage(api: widget.api, refreshKey: _refreshKey),
      ResourcePage(
          api: widget.api,
          title: 'Agendamentos',
          resource: 'agendamentos',
          icon: Icons.calendar_month_rounded,
          refreshKey: _refreshKey),
      ResourcePage(
          api: widget.api,
          title: 'Ocorrencias',
          resource: 'ocorrencias',
          icon: Icons.assignment_rounded,
          refreshKey: _refreshKey),
      ResourcePage(
          api: widget.api,
          title: 'Comandas',
          resource: 'comandas',
          icon: Icons.checklist_rounded,
          refreshKey: _refreshKey),
      ResourcePage(
          api: widget.api,
          title: 'Catracas',
          resource: 'catracas',
          icon: Icons.build_rounded,
          photos: true,
          refreshKey: _refreshKey),
      ResourcePage(
          api: widget.api,
          title: 'Clientes',
          resource: 'clientes',
          icon: Icons.people_rounded,
          refreshKey: _refreshKey),
      ResourcePage(
          api: widget.api,
          title: 'Tecnicos',
          resource: 'tecnicos',
          icon: Icons.engineering_rounded,
          refreshKey: _refreshKey),
    ];

    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text('Corretivas'),
            Text(
              widget.api.operatorName,
              style:
                  const TextStyle(color: CorretivasTheme.muted, fontSize: 12),
              overflow: TextOverflow.ellipsis,
            ),
          ],
        ),
        actions: [
          IconButton(
            tooltip: 'Alterar usuario',
            onPressed: () {
              Navigator.of(context).pushReplacement(MaterialPageRoute(
                  builder: (_) => const OperatorAccessPage()));
            },
            icon: const Icon(Icons.person_rounded),
          ),
          IconButton(
            tooltip: 'Sincronizar pendencias',
            onPressed: () async {
              try {
                final count = await _queue.flush(widget.api);
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(
                    SnackBar(content: Text('$count operacoes sincronizadas.')));
              } catch (error) {
                if (!context.mounted) return;
                ScaffoldMessenger.of(context).showSnackBar(SnackBar(
                    content: Text(
                        'Nao foi possivel sincronizar: ${apiErrorMessage(error)}')));
              }
            },
            icon: const Icon(Icons.sync_rounded),
          ),
        ],
      ),
      body: pages[_index],
      bottomNavigationBar: NavigationBar(
        selectedIndex: _index > 4 ? 4 : _index,
        onDestinationSelected: _selectTab,
        destinations: const [
          NavigationDestination(
              icon: Icon(Icons.dashboard_rounded), label: 'Dashboard'),
          NavigationDestination(
              icon: Icon(Icons.calendar_month_rounded), label: 'Agenda'),
          NavigationDestination(
              icon: Icon(Icons.assignment_rounded), label: 'Ocorrencias'),
          NavigationDestination(
              icon: Icon(Icons.checklist_rounded), label: 'Comandas'),
          NavigationDestination(
              icon: Icon(Icons.more_horiz_rounded), label: 'Mais'),
        ],
      ),
      drawer: NavigationDrawer(
        selectedIndex: _index,
        onDestinationSelected: (value) {
          Navigator.pop(context);
          _selectTab(value);
        },
        children: const [
          Padding(
            padding: EdgeInsets.all(16),
            child: Text('Areas do sistema',
                style: TextStyle(fontWeight: FontWeight.w700)),
          ),
          NavigationDrawerDestination(
              icon: Icon(Icons.dashboard_rounded), label: Text('Dashboard')),
          NavigationDrawerDestination(
              icon: Icon(Icons.calendar_month_rounded),
              label: Text('Agendamentos')),
          NavigationDrawerDestination(
              icon: Icon(Icons.assignment_rounded), label: Text('Ocorrencias')),
          NavigationDrawerDestination(
              icon: Icon(Icons.checklist_rounded), label: Text('Comandas')),
          NavigationDrawerDestination(
              icon: Icon(Icons.build_rounded), label: Text('Catracas')),
          NavigationDrawerDestination(
              icon: Icon(Icons.people_rounded), label: Text('Clientes')),
          NavigationDrawerDestination(
              icon: Icon(Icons.engineering_rounded), label: Text('Tecnicos')),
        ],
      ),
    );
  }
}

class DashboardPage extends StatefulWidget {
  const DashboardPage({required this.api, required this.refreshKey, super.key});

  final ApiClient api;
  final int refreshKey;

  @override
  State<DashboardPage> createState() => _DashboardPageState();
}

class _DashboardPageState extends State<DashboardPage> {
  Map<String, dynamic>? _dashboard;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant DashboardPage oldWidget) {
    super.didUpdateWidget(oldWidget);
    if (oldWidget.refreshKey != widget.refreshKey) {
      _load();
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final data = await widget.api.get('/dashboard');
      if (mounted) {
        setState(() => _dashboard = data);
      }
    } catch (error) {
      if (mounted) {
        setState(() => _error = error.toString());
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final stats = (_dashboard?['stats'] as Map<String, dynamic>?) ?? {};
    final charts = (_dashboard?['charts'] as Map<String, dynamic>?) ?? {};
    final lists = (_dashboard?['lists'] as Map<String, dynamic>?) ?? {};
    final period = (_dashboard?['period'] as Map<String, dynamic>?);
    final upcomingAppointments =
        listOfMaps(lists['upcomingAppointments']).take(8).toList();

    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          Row(
            children: [
              const Icon(Icons.dashboard_rounded,
                  color: CorretivasTheme.accent),
              const SizedBox(width: 10),
              Expanded(
                child: Text('Dashboard',
                    style: Theme.of(context)
                        .textTheme
                        .titleLarge
                        ?.copyWith(fontWeight: FontWeight.w700)),
              ),
              IconButton(
                  tooltip: 'Atualizar',
                  onPressed: _load,
                  icon: const Icon(Icons.refresh_rounded)),
            ],
          ),
          if (_loading) const LinearProgressIndicator(),
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(top: 12),
              child: Text(_error!,
                  style: const TextStyle(color: CorretivasTheme.danger)),
            ),
          const SizedBox(height: 10),
          _MetricGrid(items: [
            _MetricItem(
                icon: Icons.calendar_today_rounded,
                label: 'Agendamentos do dia',
                value: numberText(stats['todayAppointments'])),
            _MetricItem(
                icon: Icons.event_available_rounded,
                label: 'Proximas visitas',
                value: numberText(stats['upcomingAppointments'])),
            _MetricItem(
                icon: Icons.assignment_rounded,
                label: 'Ocorrencias abertas',
                value: numberText(stats['openCorrectives'])),
            _MetricItem(
                icon: Icons.check_circle_rounded,
                label: 'Concluidas no mes',
                value: numberText(stats['completedCorrectivesMonth'])),
            _MetricItem(
                icon: Icons.build_rounded,
                label: 'Catracas pendentes',
                value: numberText(stats['pendingTurnstiles'])),
            _MetricItem(
                icon: Icons.warning_rounded,
                label: 'Prazos proximos',
                value: numberText(stats['dueSoonTurnstiles'])),
            _MetricItem(
                icon: Icons.fact_check_rounded,
                label: 'Atendimentos no mes',
                value: numberText(stats['attendancesMonth'])),
            _MetricItem(
                icon: Icons.checklist_rounded,
                label: 'Comandas',
                value: numberText(stats['commands'])),
          ]),
          _DashboardSection(
            title: 'Atendimentos por cliente no mes',
            icon: Icons.pie_chart_rounded,
            child: _DashboardDonutChart(
                rows: listOfMaps(charts['attendanceByClient'])),
          ),
          _DashboardSection(
            title: 'Atividade operacional',
            icon: Icons.bar_chart_rounded,
            child:
                _DashboardMiniBars(rows: listOfMaps(charts['monthlyActivity'])),
          ),
          _DashboardSection(
            title: 'Proximas visitas agendadas',
            icon: Icons.calendar_month_rounded,
            child: upcomingAppointments.isEmpty
                ? const _DashboardEmpty(label: 'Nenhuma visita futura.')
                : Column(
                    children: upcomingAppointments
                        .map((record) => _UpcomingAppointmentTile(
                              api: widget.api,
                              record: record,
                            ))
                        .toList(),
                  ),
          ),
          _DashboardSection(
            title: 'Periodo ativo',
            icon: Icons.archive_rounded,
            child: _PeriodSummary(period: period),
          ),
        ],
      ),
    );
  }
}

class _MetricItem {
  const _MetricItem(
      {required this.icon, required this.label, required this.value});

  final IconData icon;
  final String label;
  final String value;
}

class _MetricGrid extends StatelessWidget {
  const _MetricGrid({required this.items});

  final List<_MetricItem> items;

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      childAspectRatio: 1.35,
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      children: items.map((item) => _MetricTile(item: item)).toList(),
    );
  }
}

class _MetricTile extends StatelessWidget {
  const _MetricTile({required this.item});

  final _MetricItem item;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Icon(item.icon, color: CorretivasTheme.accent, size: 22),
            const Spacer(),
            Text(item.value,
                style:
                    const TextStyle(fontWeight: FontWeight.w800, fontSize: 24)),
            const SizedBox(height: 2),
            Text(item.label,
                maxLines: 2,
                overflow: TextOverflow.ellipsis,
                style: const TextStyle(
                    color: CorretivasTheme.muted, fontSize: 12)),
          ],
        ),
      ),
    );
  }
}

class _DashboardSection extends StatelessWidget {
  const _DashboardSection(
      {required this.title, required this.icon, required this.child});

  final String title;
  final IconData icon;
  final Widget child;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Card(
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Icon(icon, color: CorretivasTheme.accent),
                  const SizedBox(width: 8),
                  Expanded(
                      child: Text(title,
                          style: const TextStyle(
                              fontWeight: FontWeight.w700, fontSize: 16))),
                ],
              ),
              const SizedBox(height: 14),
              child,
            ],
          ),
        ),
      ),
    );
  }
}

class _DashboardDonutChart extends StatelessWidget {
  const _DashboardDonutChart({required this.rows});

  final List<Map<String, dynamic>> rows;

  static const _colors = [
    CorretivasTheme.accent,
    CorretivasTheme.amber,
    Color(0xFF6AA7FF),
    Color(0xFFF26475),
    Color(0xFF9B8CFF),
  ];

  @override
  Widget build(BuildContext context) {
    final total =
        rows.fold<double>(0, (sum, row) => sum + numberValue(row['value']));

    if (total <= 0) {
      return const _DashboardEmpty(label: 'Sem dados para o grafico.');
    }

    return Column(
      children: [
        SizedBox(
          height: 190,
          child: charts.PieChart(
            charts.PieChartData(
              centerSpaceRadius: 44,
              sectionsSpace: 2,
              sections: rows.asMap().entries.map((entry) {
                final index = entry.key;
                final row = entry.value;
                final value = numberValue(row['value']);
                final percent = total > 0 ? (value / total) * 100 : 0;
                return charts.PieChartSectionData(
                  value: value,
                  color: _colors[index % _colors.length],
                  radius: 42,
                  title: '${percent.round()}%',
                  titleStyle: const TextStyle(
                      color: Colors.black,
                      fontSize: 11,
                      fontWeight: FontWeight.w800),
                );
              }).toList(),
            ),
          ),
        ),
        const SizedBox(height: 8),
        ...rows.asMap().entries.map((entry) {
          final index = entry.key;
          final row = entry.value;
          return Padding(
            padding: const EdgeInsets.only(bottom: 7),
            child: Row(
              children: [
                Container(
                  width: 10,
                  height: 10,
                  decoration: BoxDecoration(
                    color: _colors[index % _colors.length],
                    borderRadius: BorderRadius.circular(3),
                  ),
                ),
                const SizedBox(width: 8),
                Expanded(
                    child: Text(row['label']?.toString() ?? '-',
                        overflow: TextOverflow.ellipsis)),
                Text('${numberText(row['value'])} (${row['percent'] ?? 0}%)',
                    style: const TextStyle(color: CorretivasTheme.muted)),
              ],
            ),
          );
        }),
      ],
    );
  }
}

class _DashboardMiniBars extends StatelessWidget {
  const _DashboardMiniBars({required this.rows});

  final List<Map<String, dynamic>> rows;

  @override
  Widget build(BuildContext context) {
    if (rows.isEmpty) {
      return const _DashboardEmpty(label: 'Sem dados para o grafico.');
    }

    final maxValue = rows.fold<double>(1, (max, row) {
      final total =
          numberValue(row['correctives']) + numberValue(row['appointments']);
      return total > max ? total : max;
    });

    return Column(
      children: rows.map((row) {
        final correctives = numberValue(row['correctives']);
        final appointments = numberValue(row['appointments']);
        final correctiveWidth = (correctives / maxValue).clamp(0.0, 1.0);
        final appointmentWidth = (appointments / maxValue).clamp(0.0, 1.0);

        return Padding(
          padding: const EdgeInsets.only(bottom: 12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(child: Text(row['label']?.toString() ?? '-')),
                  Text('${correctives.round()} / ${appointments.round()}',
                      style: const TextStyle(color: CorretivasTheme.muted)),
                ],
              ),
              const SizedBox(height: 7),
              _BarTrack(
                  widthFactor: correctiveWidth, color: CorretivasTheme.accent),
              const SizedBox(height: 4),
              _BarTrack(
                  widthFactor: appointmentWidth, color: CorretivasTheme.amber),
            ],
          ),
        );
      }).toList(),
    );
  }
}

class _BarTrack extends StatelessWidget {
  const _BarTrack({required this.widthFactor, required this.color});

  final double widthFactor;
  final Color color;

  @override
  Widget build(BuildContext context) {
    return ClipRRect(
      borderRadius: BorderRadius.circular(999),
      child: Container(
        height: 8,
        color: Colors.white.withValues(alpha: 0.08),
        alignment: Alignment.centerLeft,
        child: FractionallySizedBox(
          widthFactor: widthFactor.clamp(0.04, 1.0),
          child: Container(color: color),
        ),
      ),
    );
  }
}

class _UpcomingAppointmentTile extends StatelessWidget {
  const _UpcomingAppointmentTile({required this.api, required this.record});

  final ApiClient api;
  final Map<String, dynamic> record;

  @override
  Widget build(BuildContext context) {
    return Card(
      margin: const EdgeInsets.only(bottom: 8),
      child: ListTile(
        contentPadding: const EdgeInsets.symmetric(horizontal: 12, vertical: 6),
        title: Text(record['clientName']?.toString() ?? 'Cliente'),
        subtitle: Text(
          '${formatDateText(record['visitDate'])} ${record['visitTime'] ?? ''}\n${record['technician']?.toString().isNotEmpty == true ? record['technician'] : 'Sem tecnico'}',
          maxLines: 2,
          overflow: TextOverflow.ellipsis,
        ),
        trailing: const Icon(Icons.chevron_right_rounded),
        onTap: () {
          Navigator.of(context).push(
            MaterialPageRoute(
              builder: (_) => ResourceDetailPage(
                api: api,
                title: 'Agendamentos',
                resource: 'agendamentos',
                icon: Icons.calendar_month_rounded,
                record: record,
              ),
            ),
          );
        },
      ),
    );
  }
}

class _PeriodSummary extends StatelessWidget {
  const _PeriodSummary({required this.period});

  final Map<String, dynamic>? period;

  @override
  Widget build(BuildContext context) {
    if (period == null) {
      return const _DashboardEmpty(label: 'Sem periodo ativo.');
    }

    return Row(
      children: [
        const Icon(Icons.archive_rounded,
            color: CorretivasTheme.accent, size: 34),
        const SizedBox(width: 12),
        Expanded(
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(period!['year']?.toString() ?? '-',
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, fontSize: 24)),
              const Text('Aberto',
                  style: TextStyle(color: CorretivasTheme.muted)),
            ],
          ),
        ),
      ],
    );
  }
}

class _DashboardEmpty extends StatelessWidget {
  const _DashboardEmpty({required this.label});

  final String label;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Center(
        child:
            Text(label, style: const TextStyle(color: CorretivasTheme.muted)),
      ),
    );
  }
}

class ResourcePage extends StatefulWidget {
  const ResourcePage({
    required this.api,
    required this.title,
    required this.resource,
    required this.icon,
    required this.refreshKey,
    this.photos = false,
    super.key,
  });

  final ApiClient api;
  final String title;
  final String resource;
  final IconData icon;
  final int refreshKey;
  final bool photos;

  @override
  State<ResourcePage> createState() => _ResourcePageState();
}

class _ResourcePageState extends State<ResourcePage> {
  final _queue = OfflineQueue();
  final _search = TextEditingController();
  List<Map<String, dynamic>> _records = [];
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  @override
  void didUpdateWidget(covariant ResourcePage oldWidget) {
    super.didUpdateWidget(oldWidget);

    if (oldWidget.resource != widget.resource ||
        oldWidget.refreshKey != widget.refreshKey) {
      _load();
    }
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final data = await widget.api.get('/${widget.resource}');
      final records = (data['records'] as List<dynamic>? ?? [])
          .cast<Map<String, dynamic>>();

      if (!mounted) return;
      setState(() => _records = records);
    } catch (error) {
      setState(() => _error = error.toString());
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  List<Map<String, dynamic>> get _filtered {
    final term = _search.text.toLowerCase().trim();

    if (term.isEmpty) {
      return _records;
    }

    return _records
        .where((record) => jsonEncode(record).toLowerCase().contains(term))
        .toList();
  }

  Future<void> _openEditor([Map<String, dynamic>? record]) async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => ResourceEditor(
          api: widget.api, resource: widget.resource, record: record),
    );

    if (saved == true) {
      _load();
    }
  }

  Future<void> _openDetail(Map<String, dynamic> record) async {
    final changed = await Navigator.of(context).push<bool>(
      MaterialPageRoute(
        builder: (_) => ResourceDetailPage(
          api: widget.api,
          title: widget.title,
          resource: widget.resource,
          icon: widget.icon,
          photos: widget.photos,
          record: record,
        ),
      ),
    );

    if (changed == true) {
      _load();
    }
  }

  Future<void> _delete(Map<String, dynamic> record) async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Excluir registro?'),
        content: Text(recordTitle(record)),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancelar')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Excluir')),
        ],
      ),
    );

    if (confirmed != true) return;

    try {
      await widget.api.delete('/${widget.resource}/${record['id']}');
      _load();
    } catch (error) {
      if (!isOfflineError(error)) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text('Erro ao excluir: ${apiErrorMessage(error)}')));
        return;
      }

      await _queue.enqueue(
        'DELETE',
        '/${widget.resource}/${record['id']}',
        null,
        operatorName: widget.api.operatorName,
      );
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Sem conexao com a API. Exclusao entrou na fila.')));
    }
  }

  Future<void> _pickPhoto(Map<String, dynamic> record) async {
    final image = await ImagePicker().pickImage(
        source: ImageSource.camera, imageQuality: 78, maxWidth: 1600);

    if (image == null) return;

    final bytes = await image.readAsBytes();
    await widget.api.post('/catracas/${record['id']}/anexos', {
      'fileName': image.name,
      'mimeType': image.mimeType ?? 'image/jpeg',
      'dataBase64':
          'data:${image.mimeType ?? 'image/jpeg'};base64,${base64Encode(bytes)}',
      'uploadedBy': widget.api.operatorName,
    });

    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('Foto enviada.')));
  }

  @override
  Widget build(BuildContext context) {
    return RefreshIndicator(
      onRefresh: _load,
      child: ListView(
        padding: const EdgeInsets.all(14),
        children: [
          Row(
            children: [
              Icon(widget.icon, color: CorretivasTheme.accent),
              const SizedBox(width: 10),
              Expanded(
                  child: Text(widget.title,
                      style: Theme.of(context)
                          .textTheme
                          .titleLarge
                          ?.copyWith(fontWeight: FontWeight.w700))),
              IconButton(
                  onPressed: () => _openEditor(),
                  icon: const Icon(Icons.add_rounded)),
            ],
          ),
          const SizedBox(height: 10),
          TextField(
            controller: _search,
            decoration: const InputDecoration(
                prefixIcon: Icon(Icons.search_rounded), labelText: 'Buscar'),
            onChanged: (_) => setState(() {}),
          ),
          if (_loading)
            const Padding(
                padding: EdgeInsets.all(28),
                child: Center(child: CircularProgressIndicator()))
          else if (_error != null)
            Padding(
                padding: const EdgeInsets.all(16),
                child: Text(_error!,
                    style: const TextStyle(color: CorretivasTheme.danger)))
          else
            ..._filtered.map((record) => Card(
                  child: ListTile(
                    onTap: () => _openDetail(record),
                    title: Text(recordTitle(record)),
                    subtitle: Text(recordSubtitle(record),
                        maxLines: 3, overflow: TextOverflow.ellipsis),
                    leading: Icon(widget.icon, color: CorretivasTheme.accent),
                    trailing: PopupMenuButton<String>(
                      onSelected: (value) {
                        if (value == 'detail') _openDetail(record);
                        if (value == 'edit') _openEditor(record);
                        if (value == 'delete') _delete(record);
                        if (value == 'photo') _pickPhoto(record);
                      },
                      itemBuilder: (_) => [
                        const PopupMenuItem(
                            value: 'detail', child: Text('Ver detalhes')),
                        const PopupMenuItem(
                            value: 'edit', child: Text('Editar')),
                        if (widget.photos)
                          const PopupMenuItem(
                              value: 'photo', child: Text('Enviar foto')),
                        const PopupMenuItem(
                            value: 'delete', child: Text('Excluir')),
                      ],
                    ),
                  ),
                )),
        ],
      ),
    );
  }
}

class ResourceEditor extends StatefulWidget {
  const ResourceEditor(
      {required this.api, required this.resource, this.record, super.key});

  final ApiClient api;
  final String resource;
  final Map<String, dynamic>? record;

  @override
  State<ResourceEditor> createState() => _ResourceEditorState();
}

class _ResourceEditorState extends State<ResourceEditor> {
  final _queue = OfflineQueue();
  late final Map<String, TextEditingController> _controllers;

  @override
  void initState() {
    super.initState();
    final keys = editorFields(widget.resource);
    _controllers = {
      for (final key in keys)
        key: TextEditingController(
            text: widget.record?[key]?.toString() ??
                defaultValue(widget.resource, key)),
    };
  }

  Future<void> _save() async {
    final body = {
      for (final entry in _controllers.entries)
        entry.key: editorValue(widget.resource, entry.key, entry.value.text)
    };

    try {
      if (widget.record == null) {
        await widget.api.post('/${widget.resource}', body);
      } else {
        await widget.api
            .put('/${widget.resource}/${widget.record!['id']}', body);
      }

      if (!mounted) return;
      Navigator.pop(context, true);
    } catch (error) {
      if (!isOfflineError(error)) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text('Erro ao salvar: ${apiErrorMessage(error)}')));
        return;
      }

      await _queue.enqueue(
        widget.record == null ? 'POST' : 'PUT',
        widget.record == null
            ? '/${widget.resource}'
            : '/${widget.resource}/${widget.record!['id']}',
        body,
        operatorName: widget.api.operatorName,
      );
      if (!mounted) return;
      Navigator.pop(context, true);
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Sem conexao com a API. Operacao entrou na fila.')));
    }
  }

  @override
  Widget build(BuildContext context) {
    return SafeArea(
      child: Padding(
        padding: EdgeInsets.only(
          left: 16,
          right: 16,
          top: 16,
          bottom: MediaQuery.of(context).viewInsets.bottom + 16,
        ),
        child: ListView(
          shrinkWrap: true,
          children: [
            Text(widget.record == null ? 'Novo registro' : 'Editar registro',
                style: Theme.of(context)
                    .textTheme
                    .titleLarge
                    ?.copyWith(fontWeight: FontWeight.w700)),
            const SizedBox(height: 14),
            ..._controllers.entries.map((entry) => Padding(
                  padding: const EdgeInsets.only(bottom: 10),
                  child: TextField(
                    controller: entry.value,
                    keyboardType: dateFieldKeys.contains(entry.key)
                        ? TextInputType.datetime
                        : numberFieldKeys.contains(entry.key)
                            ? const TextInputType.numberWithOptions(
                                decimal: true)
                            : TextInputType.text,
                    minLines: entry.key.toLowerCase().contains('notes') ||
                            entry.key.toLowerCase().contains('problem')
                        ? 2
                        : 1,
                    maxLines: 4,
                    decoration: InputDecoration(
                      labelText: fieldLabel(entry.key),
                      hintText: dateFieldKeys.contains(entry.key)
                          ? 'dd/mm/aaaa ou dd/mm'
                          : null,
                    ),
                  ),
                )),
            FilledButton.icon(
                onPressed: _save,
                icon: const Icon(Icons.save_rounded),
                label: const Text('Salvar')),
          ],
        ),
      ),
    );
  }
}

class ResourceDetailPage extends StatefulWidget {
  const ResourceDetailPage({
    required this.api,
    required this.title,
    required this.resource,
    required this.icon,
    required this.record,
    this.photos = false,
    super.key,
  });

  final ApiClient api;
  final String title;
  final String resource;
  final IconData icon;
  final Map<String, dynamic> record;
  final bool photos;

  @override
  State<ResourceDetailPage> createState() => _ResourceDetailPageState();
}

class _ResourceDetailPageState extends State<ResourceDetailPage> {
  final _queue = OfflineQueue();
  late Map<String, dynamic> _record;
  bool _loading = false;
  String? _error;

  @override
  void initState() {
    super.initState();
    _record = Map<String, dynamic>.from(widget.record);
    _load();
  }

  String get _recordId => _record['id']?.toString() ?? '';

  String get _recordPath =>
      '/${widget.resource}/${Uri.encodeComponent(_recordId)}';

  Future<void> _load() async {
    if (_recordId.isEmpty) return;

    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final data = await widget.api.get(_recordPath);
      final record =
          (data['record'] as Map<String, dynamic>? ?? <String, dynamic>{});

      if (!mounted) return;
      setState(() => _record = record);
    } catch (error) {
      if (!mounted) return;
      setState(
          () => _error = 'Nao foi possivel atualizar. Mostrando dados locais.');
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  Future<void> _openEditor() async {
    final saved = await showModalBottomSheet<bool>(
      context: context,
      isScrollControlled: true,
      builder: (_) => ResourceEditor(
          api: widget.api, resource: widget.resource, record: _record),
    );

    if (!mounted) return;

    if (saved == true) {
      Navigator.pop(context, true);
    }
  }

  Future<void> _delete() async {
    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Excluir registro?'),
        content: Text(recordTitle(_record)),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancelar')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Excluir')),
        ],
      ),
    );

    if (confirmed != true || _recordId.isEmpty) return;

    try {
      await widget.api.delete(_recordPath);
    } catch (error) {
      if (!isOfflineError(error)) {
        if (!mounted) return;
        ScaffoldMessenger.of(context).showSnackBar(SnackBar(
            content: Text('Erro ao excluir: ${apiErrorMessage(error)}')));
        return;
      }

      await _queue.enqueue(
        'DELETE',
        _recordPath,
        null,
        operatorName: widget.api.operatorName,
      );

      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(const SnackBar(
          content: Text('Sem conexao com a API. Exclusao entrou na fila.')));
    }

    if (!mounted) return;
    Navigator.pop(context, true);
  }

  Future<void> _pickPhoto() async {
    if (_recordId.isEmpty) return;

    final image = await ImagePicker().pickImage(
        source: ImageSource.camera, imageQuality: 78, maxWidth: 1600);

    if (image == null) return;

    final bytes = await image.readAsBytes();
    await widget.api
        .post('/catracas/${Uri.encodeComponent(_recordId)}/anexos', {
      'fileName': image.name,
      'mimeType': image.mimeType ?? 'image/jpeg',
      'dataBase64':
          'data:${image.mimeType ?? 'image/jpeg'};base64,${base64Encode(bytes)}',
      'uploadedBy': widget.api.operatorName,
    });

    if (!mounted) return;
    ScaffoldMessenger.of(context)
        .showSnackBar(const SnackBar(content: Text('Foto enviada.')));
  }

  @override
  Widget build(BuildContext context) {
    final fields = detailFields(widget.resource, _record);

    return Scaffold(
      appBar: AppBar(
        title: Text(widget.title),
        actions: [
          IconButton(
              tooltip: 'Editar',
              onPressed: _openEditor,
              icon: const Icon(Icons.edit_rounded)),
          if (widget.photos)
            IconButton(
                tooltip: 'Enviar foto',
                onPressed: _pickPhoto,
                icon: const Icon(Icons.photo_camera_rounded)),
          IconButton(
              tooltip: 'Excluir',
              onPressed: _delete,
              icon: const Icon(Icons.delete_outline_rounded)),
        ],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.all(14),
          children: [
            if (_loading) const LinearProgressIndicator(),
            if (_error != null)
              Padding(
                padding: const EdgeInsets.only(bottom: 12),
                child: Text(_error!,
                    style: const TextStyle(color: CorretivasTheme.amber)),
              ),
            Card(
              child: Padding(
                padding: const EdgeInsets.all(14),
                child: Row(
                  children: [
                    Icon(widget.icon, color: CorretivasTheme.accent, size: 32),
                    const SizedBox(width: 12),
                    Expanded(
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(recordTitle(_record),
                              style: Theme.of(context)
                                  .textTheme
                                  .titleLarge
                                  ?.copyWith(fontWeight: FontWeight.w700)),
                          const SizedBox(height: 4),
                          Text(widget.title,
                              style: const TextStyle(
                                  color: CorretivasTheme.muted)),
                        ],
                      ),
                    ),
                  ],
                ),
              ),
            ),
            const SizedBox(height: 8),
            ...fields.map((key) => _DetailField(
                  label: fieldLabel(key),
                  value: detailValue(_record[key]),
                )),
          ],
        ),
      ),
      bottomNavigationBar: SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(14, 8, 14, 14),
          child: Row(
            children: [
              Expanded(
                child: OutlinedButton.icon(
                  onPressed: _openEditor,
                  icon: const Icon(Icons.edit_rounded),
                  label: const Text('Editar'),
                ),
              ),
              const SizedBox(width: 10),
              Expanded(
                child: FilledButton.icon(
                  onPressed: _load,
                  icon: const Icon(Icons.refresh_rounded),
                  label: const Text('Atualizar'),
                ),
              ),
            ],
          ),
        ),
      ),
    );
  }
}

class _DetailField extends StatelessWidget {
  const _DetailField({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(label, style: const TextStyle(color: CorretivasTheme.muted)),
            const SizedBox(height: 6),
            SelectableText(
              value,
              style: const TextStyle(fontSize: 15, height: 1.35),
            ),
          ],
        ),
      ),
    );
  }
}

String recordTitle(Map<String, dynamic> record) {
  return (record['clientName'] ??
          record['client'] ??
          record['name'] ??
          record['bakery'] ??
          record['model'] ??
          record['id'] ??
          'Registro')
      .toString();
}

String recordSubtitle(Map<String, dynamic> record) {
  final ignored = {'id', 'createdAt', 'updatedAt'};
  return record.entries
      .where((entry) =>
          !ignored.contains(entry.key) &&
          entry.value != null &&
          entry.value.toString().isNotEmpty)
      .take(5)
      .map((entry) {
    return '${fieldLabel(entry.key)}: ${entry.value}';
  }).join('\n');
}

List<Map<String, dynamic>> listOfMaps(dynamic value) {
  if (value is! List) return const [];

  return value
      .whereType<Map>()
      .map((record) => Map<String, dynamic>.from(record))
      .toList();
}

double numberValue(dynamic value) {
  if (value is num) return value.toDouble();
  return double.tryParse(value?.toString() ?? '') ?? 0;
}

String numberText(dynamic value) {
  return numberValue(value).round().toString();
}

String formatDateText(dynamic value) {
  final text = value?.toString() ?? '';

  if (!RegExp(r'^\d{4}-\d{2}-\d{2}').hasMatch(text)) {
    return text.isEmpty ? '-' : text;
  }

  final date = text.substring(0, 10).split('-');
  return '${date[2]}/${date[1]}/${date[0]}';
}

List<String> detailFields(String resource, Map<String, dynamic> record) {
  final keys = <String>[];
  final hidden = hiddenDetailFields(resource);

  void add(String key, {bool knownField = false}) {
    if (hidden.contains(key)) return;
    if (keys.contains(key)) return;
    if (knownField || record.containsKey(key)) {
      keys.add(key);
    }
  }

  add('id');

  for (final key in editorFields(resource)) {
    add(key, knownField: true);
  }

  for (final key in [
    'periodId',
    'difficulty',
    'backupStatus',
    'firewallStatus',
    'powerOptionsStatus',
    'createdAt',
    'updatedAt',
    'userName',
    'userEmail',
    'operation',
    'resource',
    'recordId',
    'beforeValue',
    'afterValue',
  ]) {
    add(key);
  }

  final remaining = record.keys
      .where((key) => !keys.contains(key) && !hidden.contains(key))
      .toList()
    ..sort();
  keys.addAll(remaining);

  return keys;
}

Set<String> hiddenDetailFields(String resource) {
  return switch (resource) {
    'ocorrencias' => {'periodId', 'sourceHash'},
    _ => const <String>{},
  };
}

String detailValue(dynamic value) {
  if (value == null) return '-';

  if (value is Map || value is List) {
    return const JsonEncoder.withIndent('  ').convert(value);
  }

  final text = value.toString().trim();
  return text.isEmpty ? '-' : text;
}

List<String> editorFields(String resource) {
  return switch (resource) {
    'clientes' => ['name', 'address', 'contact', 'notes'],
    'tecnicos' => ['name', 'email', 'phone', 'role'],
    'ocorrencias' => [
        'occurrenceDate',
        'client',
        'contact',
        'requesterName',
        'reason',
        'resolution',
        'technician',
        'solutionDate',
      ],
    'agendamentos' => [
        'clientName',
        'address',
        'reportedProblem',
        'visitDate',
        'visitTime',
        'technician',
        'visitValue',
        'partsValue',
        'status'
      ],
    'comandas' => [
        'bakery',
        'dmConf',
        'dmCad',
        'dmImp',
        'exactaRegistrar',
        'clientRegistrar'
      ],
    'catracas' => [
        'clientName',
        'model',
        'clientAddress',
        'expectedDeliveryDate',
        'notes',
        'status'
      ],
    _ => ['name', 'notes'],
  };
}

String defaultValue(String resource, String key) {
  if (resource == 'agendamentos' && key == 'status') return 'agendada';
  if (resource == 'catracas' && key == 'status') return 'Aguardando montagem';
  return '';
}

const dateFieldKeys = {
  'occurrenceDate',
  'solutionDate',
  'visitDate',
  'expectedDeliveryDate',
};

const numberFieldKeys = {'difficulty', 'visitValue', 'partsValue'};

dynamic editorValue(String resource, String key, String value) {
  final text = value.trim();
  final nullableFields = {...dateFieldKeys, 'visitTime'};

  if (numberFieldKeys.contains(key)) {
    if (text.isEmpty) return key == 'difficulty' ? null : 0;
    return num.tryParse(text.replaceAll(',', '.')) ?? text;
  }

  if (nullableFields.contains(key) && text.isEmpty) {
    return null;
  }

  if (dateFieldKeys.contains(key)) {
    return normalizeDateInput(text);
  }

  if (key == 'status' && text.isEmpty) {
    return defaultValue(resource, key);
  }

  return text;
}

String normalizeDateInput(String value) {
  final text = value.trim();
  final isoMatch = RegExp(r'^(\d{4})-(\d{2})-(\d{2})$').firstMatch(text);
  if (isoMatch != null) {
    return '${isoMatch.group(1)}-${isoMatch.group(2)}-${isoMatch.group(3)}';
  }

  final brMatch = RegExp(r'^(\d{1,2})/(\d{1,2})/(\d{4})$').firstMatch(text);
  if (brMatch != null) {
    return '${brMatch.group(3)}-${brMatch.group(2)!.padLeft(2, '0')}-${brMatch.group(1)!.padLeft(2, '0')}';
  }

  final brShortMatch = RegExp(r'^(\d{1,2})/(\d{1,2})$').firstMatch(text);
  if (brShortMatch != null) {
    return '${DateTime.now().year}-${brShortMatch.group(2)!.padLeft(2, '0')}-${brShortMatch.group(1)!.padLeft(2, '0')}';
  }

  return text;
}

String fieldLabel(String key) {
  const labels = {
    'id': 'ID',
    'periodId': 'Periodo',
    'name': 'Nome',
    'address': 'Endereco',
    'contact': 'Contato',
    'notes': 'Observacoes',
    'email': 'E-mail',
    'phone': 'Telefone',
    'role': 'Perfil',
    'occurrenceDate': 'Data',
    'client': 'Cliente',
    'requesterName': 'Solicitante',
    'reason': 'Motivo',
    'resolution': 'Resolucao',
    'difficulty': 'Dificuldade',
    'backupStatus': 'Backup',
    'firewallStatus': 'Firewall',
    'powerOptionsStatus': 'Opcoes de energia',
    'technician': 'Tecnico',
    'solutionDate': 'Data de solucao',
    'clientName': 'Cliente',
    'reportedProblem': 'Problema relatado',
    'visitDate': 'Data da visita',
    'visitTime': 'Horario',
    'visitValue': 'Valor da visita',
    'partsValue': 'Valor das pecas',
    'status': 'Status',
    'bakery': 'Padaria',
    'dmConf': 'D/M Conf.',
    'dmCad': 'D/M Cad.',
    'dmImp': 'D/M Imp.',
    'exactaRegistrar': 'Cadastrador Exacta',
    'clientRegistrar': 'Cadastrador Cliente',
    'model': 'Modelo',
    'clientAddress': 'Endereco',
    'expectedDeliveryDate': 'Entrega prevista',
    'createdAt': 'Criado em',
    'updatedAt': 'Atualizado em',
    'userName': 'Usuario',
    'userEmail': 'Identificacao',
    'operation': 'Operacao',
    'resource': 'Area',
    'recordId': 'Registro',
    'beforeValue': 'Valor anterior',
    'afterValue': 'Valor atualizado',
  };
  return labels[key] ?? key;
}
