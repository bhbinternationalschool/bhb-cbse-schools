import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/theme/app_theme.dart";
import "../../core/ui/haptics.dart";
import "bus_run_screen.dart";

/// Bus register — the day's runs (morning pick-up, afternoon drop, one per
/// timed shift) on the same server record as the web ERP's Transport → Bus
/// register (/api/v1/transport/register/*).
///
/// Whose buses are listed is the server's answer, never the phone's: a
/// driver or attendant sees only the bus linked to them in Staff → Duties or
/// Fleet; the office and leadership see the whole fleet, plus the exception
/// list (bus register against the class register).
class BusRegisterScreen extends StatefulWidget {
  const BusRegisterScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<BusRegisterScreen> createState() => _BusRegisterScreenState();
}

/// YYYY-MM-DD [days] before [isoDate] (the server's IST "today").
String shiftIsoDate(String isoDate, int days) {
  final d = DateTime.tryParse(isoDate);
  if (d == null) return isoDate;
  final t = DateTime.utc(d.year, d.month, d.day).add(Duration(days: days));
  String two(int n) => n.toString().padLeft(2, "0");
  return "${t.year}-${two(t.month)}-${two(t.day)}";
}

/// "13 Oct" from YYYY-MM-DD.
String shortIsoDate(String isoDate) {
  const months = [
    "Jan",
    "Feb",
    "Mar",
    "Apr",
    "May",
    "Jun",
    "Jul",
    "Aug",
    "Sep",
    "Oct",
    "Nov",
    "Dec",
  ];
  final d = DateTime.tryParse(isoDate);
  if (d == null) return isoDate;
  return "${d.day} ${months[d.month - 1]}";
}

/// Today / Yesterday / pick a day — the server's "today", not the phone's.
class TransportDayPicker extends StatelessWidget {
  const TransportDayPicker({
    super.key,
    required this.date,
    required this.today,
    required this.onPick,
  });

  final String date;
  final String today;
  final ValueChanged<String> onPick;

  @override
  Widget build(BuildContext context) {
    final yesterday = shiftIsoDate(today, -1);
    final other = date != today && date != yesterday;
    return Wrap(
      spacing: 8,
      runSpacing: 6,
      crossAxisAlignment: WrapCrossAlignment.center,
      children: [
        ChoiceChip(
          label: const Text("Today · आज"),
          selected: date == today,
          onSelected: (_) => onPick(today),
        ),
        ChoiceChip(
          label: const Text("Yesterday · कल"),
          selected: date == yesterday,
          onSelected: (_) => onPick(yesterday),
        ),
        ActionChip(
          avatar: const Icon(Icons.calendar_today_outlined, size: 16),
          label: Text(other ? shortIsoDate(date) : "Other day"),
          onPressed: () async {
            final t = DateTime.tryParse(today) ?? DateTime.now();
            final picked = await showDatePicker(
              context: context,
              initialDate: DateTime.tryParse(date) ?? t,
              firstDate: t.subtract(const Duration(days: 92)),
              lastDate: t,
            );
            if (picked == null) return;
            String two(int n) => n.toString().padLeft(2, "0");
            onPick("${picked.year}-${two(picked.month)}-${two(picked.day)}");
          },
        ),
      ],
    );
  }
}

class _BusRegisterScreenState extends State<BusRegisterScreen> {
  RegisterRunsDay? _day;
  String _date = "";
  String? _error;
  bool _loading = true;

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
      final d = await widget.api.fetchRegisterRuns(date: _date);
      if (!mounted) return;
      setState(() {
        _day = d;
        _date = d.date;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (!mounted) return;
      setState(() {
        _error = e.message;
        _loading = false;
      });
    } catch (_) {
      if (!mounted) return;
      setState(() {
        _error =
            "Could not reach the school — check the internet. "
            "स्कूल सर्वर से संपर्क नहीं हुआ।";
        _loading = false;
      });
    }
  }

  Future<void> _openRun(RegisterRun run) async {
    Haptics.tap();
    await Navigator.of(context).push(
      MaterialPageRoute(
        builder: (_) => BusRunScreen(
          api: widget.api,
          date: _date,
          routeId: run.routeId,
          trip: run.trip,
          shiftId: run.shiftId,
          title: run.routeName.isEmpty ? run.name : run.routeName,
        ),
      ),
    );
    if (mounted) await _load();
  }

  @override
  Widget build(BuildContext context) {
    final day = _day;
    return Scaffold(
      appBar: AppBar(
        title: const Text("Bus register · बस रजिस्टर"),
        actions: [
          const ScreenGuideButton(
            guideId: "bus-register",
            screenLabel: "Bus register",
          ),
          IconButton(
            tooltip: "Month · महीना",
            icon: const Icon(Icons.calendar_month_outlined),
            onPressed: () => Navigator.of(context).push(
              MaterialPageRoute(
                builder: (_) => BusRegisterMonthScreen(
                  api: widget.api,
                  month: (day?.date ?? "").length >= 7
                      ? day!.date.substring(0, 7)
                      : "",
                ),
              ),
            ),
          ),
          IconButton(
            tooltip: "Refresh",
            icon: const Icon(Icons.refresh),
            onPressed: _load,
          ),
        ],
      ),
      body: _loading && day == null
          ? const Center(child: CircularProgressIndicator())
          : _error != null && day == null
          ? _ErrorRetry(message: _error!, onRetry: _load)
          : RefreshIndicator(
              onRefresh: _load,
              child: ListView(
                physics: const AlwaysScrollableScrollPhysics(),
                padding: const EdgeInsets.all(16),
                children: [
                  if (day != null) ...[
                    TransportDayPicker(
                      date: _date,
                      today: day.today,
                      onPick: (d) {
                        _date = d;
                        _load();
                      },
                    ),
                    const SizedBox(height: 10),
                    if (_error != null)
                      _Note(text: _error!, color: AppColors.danger),
                    if (day.unlinked)
                      const _Note(
                        text:
                            "You are not linked to a bus yet. Ask the office to "
                            "link you in Staff → Duties or Fleet.\n"
                            "आप अभी किसी बस से जुड़े नहीं हैं — दफ़्तर से "
                            "Staff → Duties या Fleet में जुड़वाएँ।",
                        color: AppColors.warning,
                      ),
                    if (!day.classesKnown)
                      const _Note(
                        text:
                            "The class list could not be read, so every rider "
                            "of the route is shown on each run.",
                        color: AppColors.warning,
                      ),
                    if (day.fleetWide)
                      Card(
                        child: ListTile(
                          leading: const Icon(
                            Icons.rule_outlined,
                            color: AppColors.danger,
                          ),
                          title: const Text(
                            "Exceptions · अपवाद",
                            style: TextStyle(fontWeight: FontWeight.w600),
                          ),
                          subtitle: const Text(
                            "Bus register against the class register",
                          ),
                          trailing: const Icon(Icons.chevron_right),
                          onTap: () => Navigator.of(context).push(
                            MaterialPageRoute(
                              builder: (_) => BusExceptionsScreen(
                                api: widget.api,
                                date: _date,
                              ),
                            ),
                          ),
                        ),
                      ),
                    for (final trip in const ["AM", "PM"]) ...[
                      if (day.runs.any((r) => r.trip == trip)) ...[
                        const SizedBox(height: 12),
                        Text(
                          trip == "AM"
                              ? "Morning pick-up · सुबह — लेना"
                              : "Afternoon drop · दोपहर — छोड़ना",
                          style: AppText.titleMediumInk,
                        ),
                        const SizedBox(height: 6),
                        for (final run in day.runs.where((r) => r.trip == trip))
                          _RunCard(run: run, onTap: () => _openRun(run)),
                      ],
                    ],
                    if (day.runs.isEmpty && !day.unlinked)
                      const _Note(
                        text: "No runs on this day. · इस दिन कोई फेरा नहीं।",
                        color: AppColors.muted,
                      ),
                  ],
                ],
              ),
            ),
    );
  }
}

class _RunCard extends StatelessWidget {
  const _RunCard({required this.run, required this.onTap});

  final RegisterRun run;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final c = run.counts;
    final done = c != null && c.riders > 0 && c.unmarked == 0;
    return Card(
      child: InkWell(
        borderRadius: BorderRadius.circular(12),
        onTap: onTap,
        child: Padding(
          padding: const EdgeInsets.all(14),
          child: Column(
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Row(
                children: [
                  Expanded(
                    child: Text(
                      [
                        run.routeName,
                        if (run.busNo.isNotEmpty) "Bus ${run.busNo}",
                      ].join(" · "),
                      style: AppText.titleMediumInk,
                    ),
                  ),
                  if (c != null)
                    Text(
                      "${c.marked} / ${c.riders}",
                      style: AppText.titleLarge.copyWith(
                        color: done ? AppColors.success : AppColors.ink,
                      ),
                    ),
                ],
              ),
              const SizedBox(height: 2),
              Text(
                [
                  run.name,
                  if (run.departTime.isNotEmpty) run.departTime,
                  if (run.vehicleName.isNotEmpty) run.vehicleName,
                ].join(" · "),
                style: AppText.bodySmallMuted,
              ),
              if (c != null) ...[
                const SizedBox(height: 8),
                Wrap(
                  spacing: 6,
                  runSpacing: 4,
                  children: [
                    _CountChip("Boarded", c.boarded, AppColors.success),
                    if (run.trip == "PM")
                      _CountChip("Dropped", c.dropped, AppColors.info),
                    _CountChip("Not boarded", c.notBoarded, AppColors.danger),
                    _CountChip("Not marked", c.unmarked, AppColors.muted),
                  ],
                ),
              ],
              if (run.unresolved > 0) ...[
                const SizedBox(height: 6),
                Text(
                  "${run.unresolved} child(ren) could not be placed on a run — "
                  "shown on every run of this route.",
                  style: AppText.labelMedium.copyWith(color: AppColors.warning),
                ),
              ],
            ],
          ),
        ),
      ),
    );
  }
}

class _CountChip extends StatelessWidget {
  const _CountChip(this.label, this.n, this.color);

  final String label;
  final int n;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.1),
      borderRadius: BorderRadius.circular(8),
    ),
    child: Text(
      "$label $n",
      style: AppText.labelMedium.copyWith(
        color: color,
        fontWeight: FontWeight.w700,
      ),
    ),
  );
}

class _Note extends StatelessWidget {
  const _Note({required this.text, required this.color});

  final String text;
  final Color color;

  @override
  Widget build(BuildContext context) => Container(
    width: double.infinity,
    margin: const EdgeInsets.only(bottom: 10),
    padding: const EdgeInsets.all(12),
    decoration: BoxDecoration(
      color: color.withValues(alpha: 0.08),
      borderRadius: BorderRadius.circular(12),
      border: Border.all(color: color.withValues(alpha: 0.3)),
    ),
    child: Text(text, style: AppText.bodyMedium.copyWith(color: color)),
  );
}

class _ErrorRetry extends StatelessWidget {
  const _ErrorRetry({required this.message, required this.onRetry});

  final String message;
  final Future<void> Function() onRetry;

  @override
  Widget build(BuildContext context) => Center(
    child: Padding(
      padding: const EdgeInsets.all(24),
      child: Column(
        mainAxisSize: MainAxisSize.min,
        children: [
          Text(message, textAlign: TextAlign.center, style: AppText.bodyLarge),
          const SizedBox(height: 12),
          FilledButton(
            onPressed: onRetry,
            child: const Text("Try again · दोबारा"),
          ),
        ],
      ),
    ),
  );
}

// ------------------------------------------------------------- exceptions

/// Office / leadership: children whose bus register and class register
/// disagree. Only definite marks are compared; a section with no class
/// register is counted, never read as "absent".
class BusExceptionsScreen extends StatefulWidget {
  const BusExceptionsScreen({super.key, required this.api, required this.date});

  final ApiClient api;
  final String date;

  @override
  State<BusExceptionsScreen> createState() => _BusExceptionsScreenState();
}

class _BusExceptionsScreenState extends State<BusExceptionsScreen> {
  late Future<RegisterExceptions> _future;

  @override
  void initState() {
    super.initState();
    _future = widget.api.fetchRegisterExceptions(date: widget.date);
  }

  Future<void> _reload() async {
    final f = widget.api.fetchRegisterExceptions(date: widget.date);
    setState(() => _future = f);
    await f.then((_) {}, onError: (_) {});
  }

  static String _status(String? s) => switch (s) {
    "boarded" => "boarded",
    "dropped" => "dropped",
    "not_boarded" => "not boarded",
    _ => "not marked",
  };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: Text("Exceptions · ${shortIsoDate(widget.date)}"),
        actions: const [
          ScreenGuideButton(
            guideId: "bus-exceptions",
            screenLabel: "Bus exceptions",
          ),
        ],
      ),
      body: FutureBuilder<RegisterExceptions>(
        future: _future,
        builder: (context, snap) {
          if (snap.connectionState != ConnectionState.done) {
            return const Center(child: CircularProgressIndicator());
          }
          if (snap.hasError) {
            final e = snap.error;
            return _ErrorRetry(
              message: e is ApiException
                  ? e.message
                  : "Could not reach the school — check the internet.",
              onRetry: _reload,
            );
          }
          final x = snap.data!;
          return RefreshIndicator(
            onRefresh: _reload,
            child: ListView(
              physics: const AlwaysScrollableScrollPhysics(),
              padding: const EdgeInsets.all(16),
              children: [
                if (!x.classRegisterOk)
                  const _Note(
                    text:
                        "The class register could not be read — only "
                        "\"came by bus, not on the drop\" is checked.",
                    color: AppColors.warning,
                  )
                else if ((x.sectionsWithoutRegister ?? 0) > 0)
                  _Note(
                    text:
                        "${x.sectionsWithoutRegister} of ${x.riderSections} "
                        "sections have no class register for this day — "
                        "their children are not checked.",
                    color: AppColors.warning,
                  ),
                if (x.unchecked > 0)
                  _Note(
                    text:
                        "${x.unchecked} child(ren) marked on the bus could not "
                        "be checked against a class register.",
                    color: AppColors.muted,
                  ),
                if (x.exceptions.isEmpty)
                  const _Note(
                    text: "No exceptions among the marks so far.",
                    color: AppColors.success,
                  ),
                for (final e in x.exceptions)
                  Card(
                    child: Padding(
                      padding: const EdgeInsets.all(12),
                      child: Column(
                        crossAxisAlignment: CrossAxisAlignment.start,
                        children: [
                          Text(
                            e.label,
                            style: AppText.labelMedium.copyWith(
                              color: e.kind == "boarded_absent"
                                  ? AppColors.danger
                                  : AppColors.warning,
                              fontWeight: FontWeight.w700,
                            ),
                          ),
                          const SizedBox(height: 4),
                          Text(
                            e.fullName.isEmpty ? e.studentId : e.fullName,
                            style: AppText.titleMediumInk,
                          ),
                          Text(
                            [
                              if (e.className.isNotEmpty) e.className,
                              if (e.routeName.isNotEmpty) e.routeName,
                              if (e.stopName.isNotEmpty) e.stopName,
                            ].join(" · "),
                            style: AppText.bodySmallMuted,
                          ),
                          const SizedBox(height: 4),
                          Text(
                            "Morning: ${_status(e.amStatus)} · "
                            "Drop: ${_status(e.pmStatus)} · "
                            "Class: ${e.classMark.isEmpty ? "—" : e.classMark}",
                            style: AppText.bodySmallInk,
                          ),
                        ],
                      ),
                    ),
                  ),
              ],
            ),
          );
        },
      ),
    );
  }
}

// ------------------------------------------------------------------ month

/// Month-wise boarding per child — the old ERP's transport attendance
/// report. A child with no marks is listed with nothing counted, never as
/// absent. Crew see only their own bus.
class BusRegisterMonthScreen extends StatefulWidget {
  const BusRegisterMonthScreen({super.key, required this.api, this.month = ""});

  final ApiClient api;

  /// YYYY-MM; empty = this month.
  final String month;

  @override
  State<BusRegisterMonthScreen> createState() => _BusRegisterMonthScreenState();
}

/// YYYY-MM moved by [delta] months.
String shiftMonth(String month, int delta) {
  final parts = month.split("-");
  if (parts.length != 2) return month;
  final y = int.tryParse(parts[0]);
  final m = int.tryParse(parts[1]);
  if (y == null || m == null) return month;
  final idx = y * 12 + (m - 1) + delta;
  return "${idx ~/ 12}-${(idx % 12 + 1).toString().padLeft(2, "0")}";
}

class _BusRegisterMonthScreenState extends State<BusRegisterMonthScreen> {
  late String _month;
  Future<RegisterMonth>? _future;

  @override
  void initState() {
    super.initState();
    final now = DateTime.now();
    _month = widget.month.isNotEmpty
        ? widget.month
        : "${now.year}-${now.month.toString().padLeft(2, "0")}";
    _future = widget.api.fetchRegisterMonth(month: _month);
  }

  void _go(int delta) {
    setState(() {
      _month = shiftMonth(_month, delta);
      _future = widget.api.fetchRegisterMonth(month: _month);
    });
  }

  static String _code(String? s) => switch (s) {
    "boarded" => "B",
    "dropped" => "D",
    "not_boarded" => "N",
    _ => "–",
  };

  @override
  Widget build(BuildContext context) {
    return Scaffold(
      appBar: AppBar(
        title: const Text("Bus register — month"),
        actions: const [
          ScreenGuideButton(
            guideId: "bus-register-month",
            screenLabel: "Bus register month",
          ),
        ],
      ),
      body: Column(
        children: [
          Padding(
            padding: const EdgeInsets.fromLTRB(8, 8, 8, 0),
            child: Row(
              children: [
                IconButton(
                  onPressed: () => _go(-1),
                  icon: const Icon(Icons.chevron_left),
                ),
                Expanded(
                  child: Text(
                    _month,
                    textAlign: TextAlign.center,
                    style: AppText.titleMediumInk,
                  ),
                ),
                IconButton(
                  onPressed: () => _go(1),
                  icon: const Icon(Icons.chevron_right),
                ),
              ],
            ),
          ),
          Expanded(
            child: FutureBuilder<RegisterMonth>(
              future: _future,
              builder: (context, snap) {
                if (snap.connectionState != ConnectionState.done) {
                  return const Center(child: CircularProgressIndicator());
                }
                if (snap.hasError) {
                  final e = snap.error;
                  return _ErrorRetry(
                    message: e is ApiException
                        ? e.message
                        : "Could not reach the school — check the internet.",
                    onRetry: () async => _go(0),
                  );
                }
                final m = snap.data!;
                if (m.rows.isEmpty) {
                  return const Center(
                    child: Text("No riders on your bus this month."),
                  );
                }
                return ListView(
                  padding: const EdgeInsets.all(12),
                  children: [
                    Text(
                      "B = boarded · D = dropped · N = not boarded · "
                      "– = not marked (never counted as absent)",
                      style: AppText.labelMediumMuted,
                    ),
                    const SizedBox(height: 8),
                    for (final r in m.rows)
                      Card(
                        child: ExpansionTile(
                          title: Text(
                            r.fullName.isEmpty ? r.studentId : r.fullName,
                            style: AppText.titleSmallInk,
                          ),
                          subtitle: Text(
                            [
                              if (r.className.isNotEmpty) r.className,
                              if (r.routeName.isNotEmpty) r.routeName,
                              "Morning ${r.amRidden} · Drop ${r.pmRidden} · "
                                  "Not boarded ${r.notBoarded}",
                            ].join(" · "),
                            style: AppText.bodySmallMuted,
                          ),
                          childrenPadding: const EdgeInsets.fromLTRB(
                            16,
                            0,
                            16,
                            12,
                          ),
                          children: [
                            if (r.days.isEmpty)
                              const Align(
                                alignment: Alignment.centerLeft,
                                child: Text("Nothing marked this month."),
                              )
                            else
                              Wrap(
                                spacing: 6,
                                runSpacing: 6,
                                children: [
                                  for (final d in m.dates)
                                    if (r.days[d] != null)
                                      Chip(
                                        visualDensity: VisualDensity.compact,
                                        label: Text(
                                          "${int.tryParse(d.substring(8)) ?? d}: "
                                          "${_code(r.days[d]!.am)}/${_code(r.days[d]!.pm)}",
                                        ),
                                      ),
                                ],
                              ),
                          ],
                        ),
                      ),
                  ],
                );
              },
            ),
          ),
        ],
      ),
    );
  }
}
