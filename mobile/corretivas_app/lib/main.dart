import 'dart:async';
import 'dart:convert';
import 'dart:math';

import 'package:fl_chart/fl_chart.dart' as charts;
import 'package:flutter/material.dart';
import 'package:image_picker/image_picker.dart';
import 'package:shared_preferences/shared_preferences.dart';

import 'src/core/api_client.dart';
import 'src/core/notification_service.dart';
import 'src/core/theme.dart';

Future<void> main() async {
  WidgetsFlutterBinding.ensureInitialized();
  await MobileNotificationService.initialize();
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

const noChargeAppointmentVisitTypes = {'garantia', 'retorno'};

bool isNoChargeAppointmentType(dynamic value) {
  return noChargeAppointmentVisitTypes
      .contains(value?.toString().trim().toLowerCase());
}

class OperatorAccessPage extends StatefulWidget {
  const OperatorAccessPage({super.key});

  @override
  State<OperatorAccessPage> createState() => _OperatorAccessPageState();
}

class _OperatorAccessPageState extends State<OperatorAccessPage> {
  static const _operatorNameKey = 'operator_name';
  static const _apiBaseUrlKey = 'api_base_url';
  static const _deviceIdKey = 'device_id';

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

  Future<String> _loadOrCreateDeviceId(SharedPreferences prefs) async {
    final saved = prefs.getString(_deviceIdKey)?.trim();

    if (saved != null && saved.isNotEmpty) {
      return saved;
    }

    final random = Random.secure();
    final deviceId = List<int>.generate(16, (_) => random.nextInt(256))
        .map((value) => value.toRadixString(16).padLeft(2, '0'))
        .join();

    await prefs.setString(_deviceIdKey, deviceId);
    return deviceId;
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
      final deviceId = await _loadOrCreateDeviceId(prefs);

      if (!mounted) return;
      final api = ApiClient(
        baseUrl: apiBase,
        operatorName: operatorName,
        deviceId: deviceId,
      );
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
  StreamSubscription<String>? _tokenEvents;
  int _refreshKey = 0;

  @override
  void initState() {
    super.initState();
    MobileNotificationService.registerToken(widget.api)
        .catchError((_) => false);
    _tokenEvents = MobileNotificationService.tokenStream.listen((_) {
      MobileNotificationService.registerToken(widget.api)
          .catchError((_) => false);
    });
    _events = widget.api.events().listen((event) {
      MobileNotificationService.handleRealtimeEvent(
        event,
        deviceId: widget.api.deviceId,
      ).catchError((_) {});
      if (mounted) {
        setState(() => _refreshKey++);
      }
    }, onError: (_) {});
    _queue.flush(widget.api).catchError((_) => 0);
  }

  @override
  void dispose() {
    _events?.cancel();
    _tokenEvents?.cancel();
    super.dispose();
  }

  void _selectTab(int value) {
    setState(() {
      _index = value;
      _refreshKey++;
    });
  }

  Future<void> _openMoreMenu() async {
    await showModalBottomSheet<void>(
      context: context,
      showDragHandle: true,
      builder: (context) => SafeArea(
        child: ListView(
          shrinkWrap: true,
          padding: const EdgeInsets.fromLTRB(12, 4, 12, 12),
          children: [
            ListTile(
              leading: const Icon(Icons.note_alt_rounded,
                  color: CorretivasTheme.accent),
              title: const Text('Anotacoes'),
              onTap: () {
                Navigator.pop(context);
                _selectTab(6);
              },
            ),
            ListTile(
              leading: const Icon(Icons.business_rounded,
                  color: CorretivasTheme.accent),
              title: const Text('Empresas'),
              onTap: () {
                Navigator.pop(context);
                _selectTab(5);
              },
            ),
            ListTile(
              leading: const Icon(Icons.build_rounded,
                  color: CorretivasTheme.accent),
              title: const Text('Catracas'),
              onTap: () {
                Navigator.pop(context);
                _selectTab(4);
              },
            ),
            ListTile(
              leading: const Icon(Icons.people_rounded,
                  color: CorretivasTheme.accent),
              title: const Text('Clientes'),
              onTap: () {
                Navigator.pop(context);
                _selectTab(7);
              },
            ),
            ListTile(
              leading: const Icon(Icons.engineering_rounded,
                  color: CorretivasTheme.accent),
              title: const Text('Tecnicos'),
              onTap: () {
                Navigator.pop(context);
                _selectTab(8);
              },
            ),
          ],
        ),
      ),
    );
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
          photos: true,
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
          title: 'Empresas',
          resource: 'empresas',
          icon: Icons.business_rounded,
          refreshKey: _refreshKey),
      ResourcePage(
          api: widget.api,
          title: 'Anotacoes',
          resource: 'anotacoes',
          icon: Icons.note_alt_rounded,
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
        onDestinationSelected: (value) {
          if (value == 4) {
            _openMoreMenu();
            return;
          }

          _selectTab(value);
        },
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
              icon: Icon(Icons.business_rounded), label: Text('Empresas')),
          NavigationDrawerDestination(
              icon: Icon(Icons.note_alt_rounded), label: Text('Anotacoes')),
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
          _MetricGrid(onMetricTap: _openMetricReport, items: [
            _MetricItem(
                metric: 'todayAppointments',
                icon: Icons.calendar_today_rounded,
                label: 'Agendamentos do dia',
                value: numberText(stats['todayAppointments'])),
            _MetricItem(
                metric: 'upcomingAppointments',
                icon: Icons.event_available_rounded,
                label: 'Proximas visitas',
                value: numberText(stats['upcomingAppointments'])),
            _MetricItem(
                metric: 'openCorrectives',
                icon: Icons.assignment_rounded,
                label: 'Ocorrencias abertas',
                value: numberText(stats['openCorrectives'])),
            _MetricItem(
                metric: 'completedCorrectivesMonth',
                icon: Icons.check_circle_rounded,
                label: 'Concluidas no mes',
                value: numberText(stats['completedCorrectivesMonth'])),
            _MetricItem(
                metric: 'pendingTurnstiles',
                icon: Icons.build_rounded,
                label: 'Catracas pendentes',
                value: numberText(stats['pendingTurnstiles'])),
            _MetricItem(
                metric: 'dueSoonTurnstiles',
                icon: Icons.warning_rounded,
                label: 'Prazos proximos',
                value: numberText(stats['dueSoonTurnstiles'])),
            _MetricItem(
                metric: 'attendancesMonth',
                icon: Icons.fact_check_rounded,
                label: 'Atendimentos no mes',
                value: numberText(stats['attendancesMonth'])),
            _MetricItem(
                metric: 'commands',
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
            title: 'Visitas por tipo',
            icon: Icons.pie_chart_rounded,
            child: _DashboardDonutChart(
                rows: listOfMaps(charts['visitTypeShare'])),
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

  void _openMetricReport(String metric) {
    Navigator.of(context).push(MaterialPageRoute(
      builder: (_) => DashboardReportPage(api: widget.api, metric: metric),
    ));
  }
}

class _MetricItem {
  const _MetricItem(
      {required this.metric,
      required this.icon,
      required this.label,
      required this.value});

  final String metric;
  final IconData icon;
  final String label;
  final String value;
}

class _MetricGrid extends StatelessWidget {
  const _MetricGrid({required this.items, required this.onMetricTap});

  final List<_MetricItem> items;
  final ValueChanged<String> onMetricTap;

  @override
  Widget build(BuildContext context) {
    return GridView.count(
      crossAxisCount: 2,
      shrinkWrap: true,
      physics: const NeverScrollableScrollPhysics(),
      childAspectRatio: 1.35,
      mainAxisSpacing: 8,
      crossAxisSpacing: 8,
      children: items
          .map((item) =>
              _MetricTile(item: item, onTap: () => onMetricTap(item.metric)))
          .toList(),
    );
  }
}

class _MetricTile extends StatelessWidget {
  const _MetricTile({required this.item, required this.onTap});

  final _MetricItem item;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      clipBehavior: Clip.antiAlias,
      child: InkWell(
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(12),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Icon(item.icon, color: CorretivasTheme.accent, size: 22),
              const Spacer(),
              Text(item.value,
                  style: const TextStyle(
                      fontWeight: FontWeight.w800, fontSize: 24)),
              const SizedBox(height: 2),
              Text(item.label,
                  maxLines: 2,
                  overflow: TextOverflow.ellipsis,
                  style: const TextStyle(
                      color: CorretivasTheme.muted, fontSize: 12)),
            ],
          ),
        ),
      ),
    );
  }
}

class DashboardReportPage extends StatefulWidget {
  const DashboardReportPage(
      {required this.api, required this.metric, super.key});

  final ApiClient api;
  final String metric;

  @override
  State<DashboardReportPage> createState() => _DashboardReportPageState();
}

class _DashboardReportPageState extends State<DashboardReportPage> {
  Map<String, dynamic>? _report;
  bool _loading = true;
  String? _error;

  @override
  void initState() {
    super.initState();
    _load();
  }

  Future<void> _load() async {
    setState(() {
      _loading = true;
      _error = null;
    });

    try {
      final data = await widget.api.get(
          '/dashboard/report?metric=${Uri.encodeComponent(widget.metric)}');
      if (mounted) {
        setState(() => _report = data);
      }
    } catch (error) {
      if (mounted) {
        setState(() => _error = apiErrorMessage(error));
      }
    } finally {
      if (mounted) {
        setState(() => _loading = false);
      }
    }
  }

  @override
  Widget build(BuildContext context) {
    final columns = listOfMaps(_report?['columns']);
    final records = listOfMaps(_report?['records']);

    return Scaffold(
      appBar: AppBar(
        title: Text(_report?['title']?.toString() ?? 'Relatorio'),
        actions: [
          IconButton(
              tooltip: 'Atualizar',
              onPressed: _load,
              icon: const Icon(Icons.refresh_rounded)),
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
                    style: const TextStyle(color: CorretivasTheme.danger)),
              ),
            if (_report != null) ...[
              Card(
                child: Padding(
                  padding: const EdgeInsets.all(14),
                  child: Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      Text(_report!['title']?.toString() ?? 'Relatorio',
                          style: Theme.of(context)
                              .textTheme
                              .titleLarge
                              ?.copyWith(fontWeight: FontWeight.w800)),
                      const SizedBox(height: 6),
                      Text(_report!['description']?.toString() ?? '',
                          style: const TextStyle(color: CorretivasTheme.muted)),
                      const SizedBox(height: 14),
                      Wrap(
                        spacing: 8,
                        runSpacing: 8,
                        children: [
                          _ReportBadge(
                              label: 'Total',
                              value: numberText(_report!['total'])),
                          _ReportBadge(
                              label: 'Exibindo',
                              value: records.length.toString()),
                          if ((_report!['month'] ?? '').toString().isNotEmpty)
                            _ReportBadge(
                                label: 'Mes',
                                value: _report!['month'].toString()),
                        ],
                      ),
                    ],
                  ),
                ),
              ),
              const SizedBox(height: 8),
              if (records.isEmpty)
                const _DashboardEmpty(
                    label: 'Nenhum registro encontrado para este indicador.')
              else
                ...records.map((record) =>
                    _DashboardReportRecord(columns: columns, record: record)),
            ],
          ],
        ),
      ),
    );
  }
}

class _ReportBadge extends StatelessWidget {
  const _ReportBadge({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      padding: const EdgeInsets.symmetric(horizontal: 10, vertical: 8),
      decoration: BoxDecoration(
        border: Border.all(color: CorretivasTheme.line),
        borderRadius: BorderRadius.circular(10),
        color: CorretivasTheme.panelSoft,
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(label,
              style:
                  const TextStyle(color: CorretivasTheme.muted, fontSize: 11)),
          Text(value, style: const TextStyle(fontWeight: FontWeight.w800)),
        ],
      ),
    );
  }
}

class _DashboardReportRecord extends StatelessWidget {
  const _DashboardReportRecord({required this.columns, required this.record});

  final List<Map<String, dynamic>> columns;
  final Map<String, dynamic> record;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(14),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: columns.map((column) {
            final key = column['key']?.toString() ?? '';
            final label = column['label']?.toString() ?? key;
            final type = column['type']?.toString() ?? 'text';
            final value = formatReportValue(record[key], type);

            return Padding(
              padding: const EdgeInsets.only(bottom: 9),
              child: Column(
                crossAxisAlignment: CrossAxisAlignment.start,
                children: [
                  Text(label,
                      style: const TextStyle(
                          color: CorretivasTheme.muted, fontSize: 12)),
                  const SizedBox(height: 2),
                  SelectableText(value),
                ],
              ),
            );
          }).toList(),
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
          '${formatDateText(record['visitDate'])}\n${record['technician']?.toString().isNotEmpty == true ? record['technician'] : 'Sem tecnico'}',
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
  static const _pageSize = 50;
  final _queue = OfflineQueue();
  final _search = TextEditingController();
  List<Map<String, dynamic>> _records = [];
  String _visitTypeFilter = '';
  Map<String, dynamic>? _visitTypeSummary;
  int _page = 1;
  int _total = 0;
  bool _loading = true;
  String? _error;

  int get _totalPages => max(1, (_total / _pageSize).ceil());

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
      if (oldWidget.resource != widget.resource &&
          widget.resource != 'agendamentos') {
        _visitTypeFilter = '';
      }
      _page = 1;
      _load();
    }
  }

  Future<void> _load({int? page}) async {
    final requestedPage = page ?? _page;
    setState(() {
      _loading = true;
      _error = null;
      _page = requestedPage;
    });

    try {
      final params = <String, String>{
        'page': requestedPage.toString(),
        'limit': _pageSize.toString(),
      };

      if (widget.resource == 'agendamentos' && _visitTypeFilter.isNotEmpty) {
        params['visitType'] = _visitTypeFilter;
      }

      if (widget.resource == 'empresas' && _search.text.trim().isNotEmpty) {
        params['search'] = _search.text.trim();
      }

      final query = params.isEmpty
          ? ''
          : '?${params.entries.map((entry) => '${Uri.encodeComponent(entry.key)}=${Uri.encodeComponent(entry.value)}').join('&')}';
      final data = await widget.api.get('/${widget.resource}$query');
      final records = (data['records'] as List<dynamic>? ?? [])
          .cast<Map<String, dynamic>>();
      final summary = data['visitTypeSummary'] is Map<String, dynamic>
          ? Map<String, dynamic>.from(data['visitTypeSummary'])
          : null;

      if (!mounted) return;
      setState(() {
        _records = records;
        _total = data.containsKey('total')
            ? numberValue(data['total']).round()
            : records.length;
        _visitTypeSummary = widget.resource == 'agendamentos' ? summary : null;
      });
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
    final id = Uri.encodeComponent(record['id']?.toString() ?? '');
    await widget.api.post('/${widget.resource}/$id/anexos', {
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
            onChanged: (_) {
              if (widget.resource == 'empresas') {
                _load(page: 1);
                return;
              }

              setState(() => _page = 1);
            },
          ),
          if (widget.resource == 'agendamentos') ...[
            const SizedBox(height: 10),
            DropdownButtonFormField<String>(
              initialValue: _visitTypeFilter,
              decoration: const InputDecoration(labelText: 'Tipo visita'),
              items: const [
                DropdownMenuItem(value: '', child: Text('Todos os tipos')),
                DropdownMenuItem(value: 'normal', child: Text('normal')),
                DropdownMenuItem(value: 'garantia', child: Text('garantia')),
                DropdownMenuItem(value: 'retorno', child: Text('retorno')),
              ],
              onChanged: (value) {
                setState(() => _visitTypeFilter = value ?? '');
                _load(page: 1);
              },
            ),
          ],
          if (widget.resource == 'agendamentos' && _visitTypeSummary != null)
            _VisitTypeSummary(summary: _visitTypeSummary!),
          if (_loading)
            const Padding(
                padding: EdgeInsets.all(28),
                child: Center(child: CircularProgressIndicator()))
          else if (_error != null)
            Padding(
                padding: const EdgeInsets.all(16),
                child: Text(_error!,
                    style: const TextStyle(color: CorretivasTheme.danger)))
          else ...[
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
            _MobilePaginationControls(
              page: _page,
              totalPages: _totalPages,
              total: _total,
              onPrevious: _page <= 1 ? null : () => _load(page: _page - 1),
              onNext:
                  _page >= _totalPages ? null : () => _load(page: _page + 1),
            ),
          ],
        ],
      ),
    );
  }
}

class _MobilePaginationControls extends StatelessWidget {
  const _MobilePaginationControls({
    required this.page,
    required this.totalPages,
    required this.total,
    required this.onPrevious,
    required this.onNext,
  });

  final int page;
  final int totalPages;
  final int total;
  final VoidCallback? onPrevious;
  final VoidCallback? onNext;

  @override
  Widget build(BuildContext context) {
    return Padding(
      padding: const EdgeInsets.symmetric(vertical: 12),
      child: Row(
        children: [
          Expanded(
            child: OutlinedButton(
              onPressed: onPrevious,
              child: const Text('Anterior'),
            ),
          ),
          Padding(
            padding: const EdgeInsets.symmetric(horizontal: 12),
            child: Text(
              'Pagina $page de $totalPages\n$total registros',
              textAlign: TextAlign.center,
              style:
                  const TextStyle(color: CorretivasTheme.muted, fontSize: 12),
            ),
          ),
          Expanded(
            child: OutlinedButton(
              onPressed: onNext,
              child: const Text('Proxima'),
            ),
          ),
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

    if (widget.resource == 'agendamentos' &&
        isNoChargeAppointmentType(body['visitType'])) {
      body['visitValue'] = 0;
      body['partsValue'] = 0;
    }

    if (widget.resource == 'anotacoes' &&
        (body['createdBy']?.toString().trim().isEmpty ?? true)) {
      body['createdBy'] = widget.api.operatorName;
    }

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

  Widget _buildEditorField(MapEntry<String, TextEditingController> entry) {
    if (widget.resource == 'empresas' && entry.key == 'xml') {
      final raw = entry.value.text.trim().toLowerCase();
      final current = raw == 'sim' ? 'sim' : 'não';

      if (entry.value.text != current) {
        entry.value.text = current;
      }

      return DropdownButtonFormField<String>(
        initialValue: current,
        decoration: InputDecoration(labelText: fieldLabel(entry.key)),
        items: const [
          DropdownMenuItem(value: 'sim', child: Text('sim')),
          DropdownMenuItem(value: 'não', child: Text('não')),
        ],
        onChanged: (value) {
          entry.value.text = value ?? 'não';
        },
      );
    }

    if (widget.resource == 'agendamentos' && entry.key == 'visitType') {
      final raw = entry.value.text.trim().toLowerCase();
      final current = appointmentVisitTypeOptions.contains(raw) ? raw : '';

      if (entry.value.text != current) {
        entry.value.text = current;
      }

      return DropdownButtonFormField<String>(
        initialValue: current,
        decoration: InputDecoration(labelText: fieldLabel(entry.key)),
        items: const [
          DropdownMenuItem(value: '', child: Text('Selecione')),
          DropdownMenuItem(value: 'normal', child: Text('normal')),
          DropdownMenuItem(value: 'garantia', child: Text('garantia')),
          DropdownMenuItem(value: 'retorno', child: Text('retorno')),
        ],
        onChanged: (value) {
          setState(() {
            entry.value.text = value ?? '';
            if (isNoChargeAppointmentType(entry.value.text)) {
              _controllers['visitValue']?.clear();
              _controllers['partsValue']?.clear();
            }
          });
        },
      );
    }

    if (widget.resource == 'agendamentos' && entry.key == 'status') {
      final raw = entry.value.text.trim();
      final current = appointmentStatusOptions.contains(raw) ? raw : 'agendada';

      if (entry.value.text != current) {
        entry.value.text = current;
      }

      return DropdownButtonFormField<String>(
        initialValue: current,
        decoration: InputDecoration(labelText: fieldLabel(entry.key)),
        items: appointmentStatusOptions
            .map((status) =>
                DropdownMenuItem(value: status, child: Text(status)))
            .toList(),
        onChanged: (value) {
          if (value != null) {
            entry.value.text = value;
          }
        },
      );
    }

    return TextField(
      controller: entry.value,
      keyboardType: dateFieldKeys.contains(entry.key)
          ? TextInputType.datetime
          : numberFieldKeys.contains(entry.key)
              ? const TextInputType.numberWithOptions(decimal: true)
              : TextInputType.text,
      minLines: entry.key.toLowerCase().contains('notes') ||
              entry.key.toLowerCase().contains('problem')
          ? 2
          : 1,
      maxLines: 4,
      decoration: InputDecoration(
        labelText: fieldLabel(entry.key),
        hintText:
            dateFieldKeys.contains(entry.key) ? 'dd/mm/aaaa ou dd/mm' : null,
      ),
    );
  }

  bool _shouldShowEditorField(String key) {
    if (widget.resource != 'agendamentos') return true;
    if (key != 'visitValue' && key != 'partsValue') return true;
    return !isNoChargeAppointmentType(_controllers['visitType']?.text);
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
            ..._controllers.entries
                .where((entry) => _shouldShowEditorField(entry.key))
                .map((entry) => Padding(
                      padding: const EdgeInsets.only(bottom: 10),
                      child: _buildEditorField(entry),
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

class _VisitTypeSummary extends StatelessWidget {
  const _VisitTypeSummary({required this.summary});

  final Map<String, dynamic> summary;

  int _toInt(dynamic value) {
    if (value is num) return value.round();
    return num.tryParse(value?.toString() ?? '')?.round() ?? 0;
  }

  int _value(String group, String key) {
    final data = summary[group];
    if (data is Map<String, dynamic>) {
      return _toInt(data[key]);
    }
    return 0;
  }

  @override
  Widget build(BuildContext context) {
    final total = _toInt(summary['total']);
    final garantiaTotal = _value('garantia', 'total');
    final garantiaAverage = _value('garantia', 'average');
    final retornoTotal = _value('retorno', 'total');
    final retornoAverage = _value('retorno', 'average');

    return Padding(
      padding: const EdgeInsets.only(top: 10),
      child: Wrap(
        spacing: 8,
        runSpacing: 8,
        children: [
          _SmallSummaryCard(label: 'Total geral', value: total.toString()),
          _SmallSummaryCard(
              label: 'Garantia',
              value: '$garantiaTotal (${garantiaAverage.toString()}%)'),
          _SmallSummaryCard(
              label: 'Retorno',
              value: '$retornoTotal (${retornoAverage.toString()}%)'),
        ],
      ),
    );
  }
}

class _SmallSummaryCard extends StatelessWidget {
  const _SmallSummaryCard({required this.label, required this.value});

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) {
    return Container(
      width: 116,
      padding: const EdgeInsets.all(12),
      decoration: BoxDecoration(
        color: CorretivasTheme.panelSoft,
        borderRadius: BorderRadius.circular(12),
        border: Border.all(color: CorretivasTheme.line),
      ),
      child: Column(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          Text(value,
              style:
                  const TextStyle(fontSize: 17, fontWeight: FontWeight.w800)),
          const SizedBox(height: 4),
          Text(label,
              maxLines: 2,
              overflow: TextOverflow.ellipsis,
              style:
                  const TextStyle(color: CorretivasTheme.muted, fontSize: 12)),
        ],
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
        .post('/${widget.resource}/${Uri.encodeComponent(_recordId)}/anexos', {
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

  Future<void> _openPhotos() async {
    if (_recordId.isEmpty) return;

    try {
      final data = await widget.api
          .get('/${widget.resource}/${Uri.encodeComponent(_recordId)}/anexos');
      final photos = listOfMaps(data['records']);

      if (!mounted) return;

      if (photos.isEmpty) {
        ScaffoldMessenger.of(context).showSnackBar(
            const SnackBar(content: Text('Nenhuma imagem anexada.')));
        return;
      }

      await showModalBottomSheet<void>(
        context: context,
        isScrollControlled: true,
        builder: (context) => _PhotoGallerySheet(
          api: widget.api,
          resource: widget.resource,
          recordId: _recordId,
          photos: photos,
        ),
      );
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(
              'Nao foi possivel abrir imagem: ${apiErrorMessage(error)}')));
    }
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
            if (widget.photos) _OpenImageField(onTap: _openPhotos),
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

class _OpenImageField extends StatelessWidget {
  const _OpenImageField({required this.onTap});

  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    return Card(
      child: ListTile(
        onTap: onTap,
        leading: const Icon(Icons.image_rounded, color: CorretivasTheme.accent),
        title: const Text('Abrir imagem'),
        trailing: const Icon(Icons.chevron_right_rounded),
      ),
    );
  }
}

class _PhotoGallerySheet extends StatefulWidget {
  const _PhotoGallerySheet({
    required this.api,
    required this.resource,
    required this.recordId,
    required this.photos,
  });

  final ApiClient api;
  final String resource;
  final String recordId;
  final List<Map<String, dynamic>> photos;

  @override
  State<_PhotoGallerySheet> createState() => _PhotoGallerySheetState();
}

class _PhotoGallerySheetState extends State<_PhotoGallerySheet> {
  late final List<Map<String, dynamic>> _photos;

  @override
  void initState() {
    super.initState();
    _photos = List<Map<String, dynamic>>.from(widget.photos);
  }

  String _resolveImageUrl(Object? value) {
    final raw = (value ?? '').toString().trim();

    if (raw.isEmpty || raw.startsWith('gs://')) {
      return '';
    }

    if (raw.startsWith('http://') ||
        raw.startsWith('https://') ||
        raw.startsWith('data:')) {
      return raw;
    }

    if (!raw.startsWith('/')) {
      return raw;
    }

    final base = widget.api.baseUrl.endsWith('/')
        ? widget.api.baseUrl.substring(0, widget.api.baseUrl.length - 1)
        : widget.api.baseUrl;
    return '$base$raw';
  }

  String _imageUrl(Map<String, dynamic> photo) {
    final publicPath = _resolveImageUrl(photo['publicPath']);

    if (publicPath.isNotEmpty) {
      return publicPath;
    }

    return _resolveImageUrl(photo['publicUrl']);
  }

  Future<void> _deletePhoto(Map<String, dynamic> photo) async {
    final photoId = (photo['id'] ?? '').toString();

    if (photoId.isEmpty) {
      return;
    }

    final confirmed = await showDialog<bool>(
      context: context,
      builder: (context) => AlertDialog(
        title: const Text('Apagar imagem?'),
        content: const Text('A imagem sera removida deste registro.'),
        actions: [
          TextButton(
              onPressed: () => Navigator.pop(context, false),
              child: const Text('Cancelar')),
          FilledButton(
              onPressed: () => Navigator.pop(context, true),
              child: const Text('Apagar')),
        ],
      ),
    );

    if (confirmed != true) {
      return;
    }

    try {
      await widget.api.delete(
          '/${widget.resource}/${Uri.encodeComponent(widget.recordId)}/anexos/${Uri.encodeComponent(photoId)}');

      if (!mounted) return;

      setState(() {
        _photos.removeWhere((item) => (item['id'] ?? '').toString() == photoId);
      });
      ScaffoldMessenger.of(context)
          .showSnackBar(const SnackBar(content: Text('Imagem apagada.')));
    } catch (error) {
      if (!mounted) return;
      ScaffoldMessenger.of(context).showSnackBar(SnackBar(
          content: Text(
              'Nao foi possivel apagar imagem: ${apiErrorMessage(error)}')));
    }
  }

  @override
  Widget build(BuildContext context) {
    final itemCount = _photos.isEmpty ? 2 : _photos.length + 1;

    return SafeArea(
      child: DraggableScrollableSheet(
        expand: false,
        initialChildSize: 0.82,
        minChildSize: 0.45,
        maxChildSize: 0.95,
        builder: (context, controller) => ListView.separated(
          controller: controller,
          padding: const EdgeInsets.all(14),
          itemCount: itemCount,
          separatorBuilder: (_, __) => const SizedBox(height: 12),
          itemBuilder: (context, index) {
            if (index == 0) {
              return Row(
                children: [
                  const Icon(Icons.image_rounded,
                      color: CorretivasTheme.accent),
                  const SizedBox(width: 10),
                  Expanded(
                    child: Text('Imagens anexadas',
                        style: Theme.of(context)
                            .textTheme
                            .titleMedium
                            ?.copyWith(fontWeight: FontWeight.w700)),
                  ),
                ],
              );
            }

            if (_photos.isEmpty) {
              return const Card(
                child: Padding(
                  padding: EdgeInsets.all(18),
                  child: Text('Nenhuma imagem anexada.',
                      style: TextStyle(color: CorretivasTheme.muted)),
                ),
              );
            }

            final photo = _photos[index - 1];
            final imageUrl = _imageUrl(photo);
            final label = (photo['originalName'] ?? photo['fileName'] ?? '')
                .toString()
                .trim();

            return Card(
              clipBehavior: Clip.antiAlias,
              child: Stack(
                children: [
                  Column(
                    crossAxisAlignment: CrossAxisAlignment.start,
                    children: [
                      AspectRatio(
                        aspectRatio: 4 / 3,
                        child: Image.network(
                          imageUrl,
                          fit: BoxFit.cover,
                          errorBuilder: (_, __, ___) => const Center(
                            child: Text('Imagem indisponivel',
                                style: TextStyle(color: CorretivasTheme.muted)),
                          ),
                        ),
                      ),
                      if (label.isNotEmpty)
                        Padding(
                          padding: const EdgeInsets.all(12),
                          child: Text(label,
                              maxLines: 2, overflow: TextOverflow.ellipsis),
                        ),
                    ],
                  ),
                  Positioned(
                    top: 8,
                    right: 8,
                    child: IconButton(
                      tooltip: 'Apagar imagem',
                      onPressed: () => _deletePhoto(photo),
                      icon: const Icon(Icons.delete_outline_rounded),
                      color: CorretivasTheme.danger,
                      style: IconButton.styleFrom(
                        backgroundColor: Colors.black54,
                      ),
                    ),
                  ),
                ],
              ),
            );
          },
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
          record['title'] ??
          record['name'] ??
          record['bakery'] ??
          record['model'] ??
          record['id'] ??
          'Registro')
      .toString();
}

String recordSubtitle(Map<String, dynamic> record) {
  final ignored = <String>{
    'id',
    'createdAt',
    'updatedAt',
    'photoCount',
    'photo_count',
    'annotations',
  };

  if (isNoChargeAppointmentType(record['visitType'] ?? record['visit_type'])) {
    ignored.addAll({'visitValue', 'partsValue', 'visit_value', 'parts_value'});
  }

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

String formatDateTimeText(dynamic value) {
  final text = value?.toString() ?? '';

  if (text.isEmpty) {
    return '-';
  }

  final date = formatDateText(text);
  final timeMatch = RegExp(r'T(\d{2}):(\d{2})').firstMatch(text);

  if (timeMatch == null) {
    return date;
  }

  return '$date ${timeMatch.group(1)}:${timeMatch.group(2)}';
}

String formatMoneyText(dynamic value) {
  final fixed = numberValue(value).toStringAsFixed(2).replaceAll('.', ',');
  return 'R\$ $fixed';
}

String formatReportValue(dynamic value, String type) {
  if (value == null || value.toString().trim().isEmpty) {
    return '-';
  }

  if (type == 'date') {
    return formatDateText(value);
  }

  if (type == 'datetime') {
    return formatDateTimeText(value);
  }

  if (type == 'money') {
    return formatMoneyText(value);
  }

  return value.toString();
}

List<String> detailFields(String resource, Map<String, dynamic> record) {
  final keys = <String>[];
  final hidden = hiddenDetailFields(resource, record);

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

Set<String> hiddenDetailFields(String resource, Map<String, dynamic> record) {
  final hidden = switch (resource) {
    'ocorrencias' => {'periodId', 'sourceHash'},
    'agendamentos' => {
        'photoCount',
        'photo_count',
        'annotations',
        'visitTime',
        'visit_time',
      },
    'catracas' => {'photoCount', 'photo_count'},
    _ => const <String>{},
  };

  if (resource == 'agendamentos' &&
      isNoChargeAppointmentType(record['visitType'] ?? record['visit_type'])) {
    return {
      ...hidden,
      'visitValue',
      'partsValue',
      'visit_value',
      'parts_value'
    };
  }

  return hidden;
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
        'notes',
        'visitDate',
        'technician',
        'visitValue',
        'partsValue',
        'visitType',
        'status'
      ],
    'comandas' => [
        'bakery',
        'quantity',
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
    'empresas' => [
        'name',
        'cnpj',
        'systemName',
        'xml',
        'ip',
        'port',
        'turnstileType',
        'anydesk',
        'notes',
      ],
    'anotacoes' => [
        'title',
        'content',
      ],
    _ => ['name', 'notes'],
  };
}

String defaultValue(String resource, String key) {
  if (resource == 'agendamentos' && key == 'status') return 'agendada';
  if (resource == 'comandas' && key == 'quantity') return '1';
  if (resource == 'catracas' && key == 'status') return 'Aguardando montagem';
  if (resource == 'empresas' && key == 'xml') return 'não';
  return '';
}

const dateFieldKeys = {
  'occurrenceDate',
  'solutionDate',
  'visitDate',
  'expectedDeliveryDate',
};

const numberFieldKeys = {'difficulty', 'quantity', 'visitValue', 'partsValue'};

const appointmentStatusOptions = ['agendada', 'realizada', 'cancelada'];
const appointmentVisitTypeOptions = ['normal', 'garantia', 'retorno'];

dynamic editorValue(String resource, String key, String value) {
  final text = value.trim();
  final nullableFields = {...dateFieldKeys};

  if (isClientField(resource, key)) {
    return text.toUpperCase();
  }

  if (isTechnicianField(resource, key)) {
    return normalizeTechnicianInput(text);
  }

  if (numberFieldKeys.contains(key)) {
    if (text.isEmpty) {
      if (key == 'difficulty') return null;
      if (key == 'quantity') return 1;
      return 0;
    }
    return num.tryParse(text.replaceAll(',', '.')) ?? text;
  }

  if (nullableFields.contains(key) && text.isEmpty) {
    return null;
  }

  if (dateFieldKeys.contains(key)) {
    return normalizeDateInput(text);
  }

  if (resource == 'agendamentos' && key == 'status') {
    return appointmentStatusOptions.contains(text) ? text : 'agendada';
  }

  if (resource == 'agendamentos' && key == 'visitType') {
    final normalized = text.toLowerCase();
    return appointmentVisitTypeOptions.contains(normalized) ? normalized : '';
  }

  if (resource == 'empresas' && key == 'xml') {
    final normalized = text.toLowerCase();
    return normalized == 'sim' ? 'sim' : 'não';
  }

  if (key == 'status' && text.isEmpty) {
    return defaultValue(resource, key);
  }

  return text;
}

bool isClientField(String resource, String key) {
  return (resource == 'clientes' && key == 'name') ||
      (resource == 'ocorrencias' && key == 'client') ||
      (resource == 'agendamentos' && key == 'clientName') ||
      (resource == 'comandas' && key == 'bakery') ||
      (resource == 'catracas' && key == 'clientName');
}

bool isTechnicianField(String resource, String key) {
  return (resource == 'tecnicos' && key == 'name') ||
      key == 'technician' ||
      key == 'exactaRegistrar' ||
      key == 'clientRegistrar';
}

String normalizeTechnicianInput(String value) {
  if (value.toLowerCase() == 'vittor') {
    return 'Vittor';
  }

  return value;
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
    'title': 'Titulo',
    'content': 'Anotacao',
    'name': 'Nome',
    'cnpj': 'CNPJ',
    'systemName': 'Sistema',
    'xml': 'XML',
    'ip': 'IP',
    'port': 'Porta',
    'turnstileType': 'Tipo catraca',
    'anydesk': 'Anydesk',
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
    'visitValue': 'Valor da visita',
    'partsValue': 'Valor das pecas',
    'visitType': 'Tipo visita',
    'status': 'Status',
    'bakery': 'Padaria',
    'quantity': 'Quantidade',
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
    'createdBy': 'Criado por',
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
