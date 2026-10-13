import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/guide/screen_guides.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";
import "section_picker.dart";

/// The school's register legend (web lib/attendance.ts). L is LATE — not
/// leave; leave is LE.
const kRegisterLegend = [
  ("P", "Present", "उपस्थित", AppColors.success),
  ("A", "Absent", "अनुपस्थित", AppColors.danger),
  ("L", "Late", "देर से", AppColors.warning),
  ("HD", "Half day", "आधा दिन", AppColors.info),
  ("LE", "Leave / excused", "छुट्टी", Color(0xFF534AB7)),
];

Color _markColor(String m) {
  for (final l in kRegisterLegend) {
    if (l.$1 == m) return l.$4;
  }
  return AppColors.ink;
}

/// What one cell of the register shows: the mark; "H" on a holiday; "–"
/// before the child's admission; "" for a future day or a working day
/// nobody marked (never shown as present).
String monthCell(MonthRegisterStudent s, MonthRegisterDay d) {
  if (!d.working) return "H";
  if (d.date.compareTo(s.startsOn) < 0) return "–";
  if (d.future) return "";
  return s.marks[d.date] ?? "";
}

/// A day's headcount, as the web export counts it: P / L = 1, HD = ½.
double dayHeadcount(List<MonthRegisterStudent> students, MonthRegisterDay d) {
  if (!d.working || d.future) return 0;
  var n = 0.0;
  for (final s in students) {
    final m = monthCell(s, d);
    n += m == "P" || m == "L" ? 1 : (m == "HD" ? 0.5 : 0);
  }
  return n;
}

String _num(double n) =>
    n == n.truncateToDouble() ? "${n.toInt()}" : n.toStringAsFixed(1);

const _monthNames = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
];

String monthTitle(String ym) {
  final m = RegExp(r"^(\d{4})-(\d{2})$").firstMatch(ym);
  if (m == null) return ym;
  final i = int.parse(m[2]!) - 1;
  return i < 0 || i > 11 ? ym : "${_monthNames[i]} ${m[1]}";
}

const _weekday = ["Mo", "Tu", "We", "Th", "Fr", "Sa", "Su"];

/// Month attendance register: children down, days across, the school's
/// marks, holidays and Sundays shaded, month and session totals per child
/// (GET /api/v1/attendance/month). Read-only here — a day is marked from
/// the Attendance register; back-dating a month stays on the web ERP.
class MonthRegisterScreen extends StatefulWidget {
  const MonthRegisterScreen({super.key, required this.api});

  final ApiClient api;

  @override
  State<MonthRegisterScreen> createState() => _MonthRegisterScreenState();
}

class _MonthRegisterScreenState extends State<MonthRegisterScreen> {
  List<ClassRef> _classes = const [];
  (String, String, String)? _section;
  String _month = "";
  MonthRegister? _data;
  String? _error;
  bool _loading = true;

  @override
  void initState() {
    super.initState();
    _start();
  }

  Future<void> _start() async {
    try {
      final summary = await widget.api.fetchStaffSummary();
      _classes = summary.classes;
      final ct = summary.classTeacherOf;
      if (ct != null) {
        _section = (
          ct.classId,
          ct.sectionId,
          "${ct.className} ${ct.sectionName}",
        );
      } else if (_classes.length == 1 && _classes.first.sections.length == 1) {
        final c = _classes.first;
        _section = (
          c.id,
          c.sections.first.id,
          "${c.name} ${c.sections.first.name}",
        );
      }
      if (_section == null) {
        if (mounted) setState(() => _loading = false);
        if (mounted && _classes.isNotEmpty) await _pickSection();
        return;
      }
      await _load();
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = context.l10n.homeCouldNotReachServerCheckConnection;
          _loading = false;
        });
      }
    }
  }

  Future<void> _load() async {
    final sec = _section;
    if (sec == null) return;
    setState(() {
      _loading = true;
      _error = null;
    });
    try {
      final data = await widget.api.fetchMonthRegister(
        classId: sec.$1,
        sectionId: sec.$2,
        month: _month,
      );
      if (!mounted) return;
      setState(() {
        _data = data;
        _month = data.month;
        _loading = false;
      });
    } on ApiException catch (e) {
      if (mounted) {
        setState(() {
          _error = e.message;
          _loading = false;
        });
      }
    } catch (_) {
      if (mounted) {
        setState(() {
          _error = context.l10n.homeCouldNotReachServerCheckConnection;
          _loading = false;
        });
      }
    }
  }

  Future<void> _pickSection() async {
    if (_classes.isEmpty) return;
    final picked = await showModalBottomSheet<(String, String, String)>(
      context: context,
      backgroundColor: Colors.white,
      isScrollControlled: true,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => SectionPicker(classes: _classes),
    );
    if (picked == null || !mounted) return;
    setState(() {
      _section = picked;
      _month = "";
      _data = null;
    });
    await _load();
  }

  /// [step] +1 = the next (newer) month, -1 = the one before. `months` is
  /// newest first and holds only the session's months up to today.
  void _go(int step) {
    final months = _data?.months ?? const [];
    final i = months.indexOf(_month);
    final j = i - step;
    if (i < 0 || j < 0 || j >= months.length) return;
    setState(() => _month = months[j]);
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final data = _data;
    final months = data?.months ?? const <String>[];
    final i = months.indexOf(_month);
    return Scaffold(
      appBar: AppBar(
        title: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            const Text(
              "Month register · मासिक रजिस्टर",
              style: AppText.titleMedium,
            ),
            if (_section != null)
              Text(
                _section!.$3,
                style: AppText.labelMedium.copyWith(
                  color: const Color(0xFFB8C0D4),
                ),
              ),
          ],
        ),
        actions: [
          if (_classes.length > 1 ||
              (_classes.isNotEmpty && _classes.first.sections.length > 1))
            IconButton(
              tooltip: "Change class",
              icon: const Icon(Icons.swap_horiz),
              onPressed: _pickSection,
            ),
          const ScreenGuideButton(
            guideId: "month-register",
            screenLabel: "Month register",
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
                  tooltip: "Previous month",
                  onPressed: _loading || i < 0 || i >= months.length - 1
                      ? null
                      : () => _go(-1),
                  icon: const Icon(Icons.chevron_left),
                ),
                Expanded(
                  child: Text(
                    _month.isEmpty ? "" : monthTitle(_month),
                    textAlign: TextAlign.center,
                    style: AppText.titleSmallInk,
                  ),
                ),
                IconButton(
                  tooltip: "Next month",
                  onPressed: _loading || i <= 0 ? null : () => _go(1),
                  icon: const Icon(Icons.chevron_right),
                ),
              ],
            ),
          ),
          if (_loading)
            const LinearProgressIndicator(
              minHeight: 2,
              color: AppColors.primary,
            ),
          Expanded(child: _body(data)),
        ],
      ),
    );
  }

  Widget _body(MonthRegister? data) {
    if (_error != null && data == null) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              const Icon(
                Icons.cloud_off_outlined,
                size: 40,
                color: AppColors.muted,
              ),
              const SizedBox(height: 12),
              Text(_error!, textAlign: TextAlign.center),
              const SizedBox(height: 12),
              FilledButton(
                onPressed: _section == null ? _start : _load,
                child: Text(context.l10n.retry),
              ),
            ],
          ),
        ),
      );
    }
    if (_section == null && !_loading) {
      return Center(
        child: Padding(
          padding: const EdgeInsets.all(24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            children: [
              Text(
                _classes.isEmpty
                    ? "You have no classes yet — ask the office to add yours (Staff → Duties)."
                    : "Choose a class to see its month.",
                textAlign: TextAlign.center,
                style: AppText.bodyMediumMuted,
              ),
              if (_classes.isNotEmpty) ...[
                const SizedBox(height: 12),
                FilledButton(
                  onPressed: _pickSection,
                  child: Text(context.l10n.chooseClassSection),
                ),
              ],
            ],
          ),
        ),
      );
    }
    if (data == null) return const SizedBox.shrink();
    return RefreshIndicator(
      onRefresh: _load,
      color: AppColors.primary,
      child: ListView(
        physics: const AlwaysScrollableScrollPhysics(),
        padding: const EdgeInsets.fromLTRB(12, 8, 12, 24),
        children: [
          if (_error != null)
            Padding(
              padding: const EdgeInsets.only(bottom: 8),
              child: Text(
                _error!,
                style: AppText.bodySmall.copyWith(color: AppColors.danger),
              ),
            ),
          if (data.students.isEmpty)
            Padding(
              padding: const EdgeInsets.all(24),
              child: Text(
                context.l10n.noActiveStudentsInThisSection,
                textAlign: TextAlign.center,
                style: AppText.bodyMediumMuted,
              ),
            )
          else
            MonthRegisterGrid(register: data),
          const SizedBox(height: 12),
          _Legend(),
        ],
      ),
    );
  }
}

/// The grid: the name column stays put, the days scroll sideways.
class MonthRegisterGrid extends StatelessWidget {
  const MonthRegisterGrid({super.key, required this.register});

  final MonthRegister register;

  static const _rowH = 40.0;
  static const _headH = 40.0;
  static const _cellW = 32.0;
  static const _nameW = 138.0;
  static const _line = Color(0xFFE4E2DA);
  static const _holiday = Color(0xFFF1EFE8);

  @override
  Widget build(BuildContext context) {
    final days = register.days;
    final students = register.students;

    Widget cell(
      String text, {
      Color? bg,
      Color? fg,
      double w = _cellW,
      double h = _rowH,
      bool bold = true,
      String? tip,
    }) {
      final box = Container(
        width: w,
        height: h,
        alignment: Alignment.center,
        decoration: BoxDecoration(
          color: bg,
          border: const Border(
            right: BorderSide(color: _line, width: 0.5),
            bottom: BorderSide(color: _line, width: 0.5),
          ),
        ),
        child: Text(
          text,
          style: TextStyle(
            fontSize: text.length > 2 ? 10 : 12,
            fontWeight: bold ? FontWeight.w700 : FontWeight.w400,
            color: fg ?? AppColors.ink,
          ),
        ),
      );
      return tip == null || tip.isEmpty
          ? box
          : Tooltip(message: tip, child: box);
    }

    // Pinned: names with this month's present / working days.
    final pinned = Column(
      children: [
        Container(
          width: _nameW,
          height: _headH,
          alignment: Alignment.centerLeft,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          decoration: const BoxDecoration(
            color: AppColors.surface,
            border: Border(
              right: BorderSide(color: _line),
              bottom: BorderSide(color: _line),
            ),
          ),
          child: const Text("Child · P/W", style: AppText.labelMediumMuted),
        ),
        for (final s in students)
          Container(
            width: _nameW,
            height: _rowH,
            padding: const EdgeInsets.symmetric(horizontal: 8),
            decoration: const BoxDecoration(
              border: Border(
                right: BorderSide(color: _line),
                bottom: BorderSide(color: _line, width: 0.5),
              ),
            ),
            child: Column(
              mainAxisAlignment: MainAxisAlignment.center,
              crossAxisAlignment: CrossAxisAlignment.start,
              children: [
                Text(
                  "${s.rollNo.isEmpty ? "" : "${s.rollNo}. "}${s.name}",
                  maxLines: 1,
                  overflow: TextOverflow.ellipsis,
                  style: AppText.labelMediumInk.copyWith(
                    fontWeight: FontWeight.w600,
                  ),
                ),
                Text(
                  "${_num(s.month.presentDays)}/${s.month.workingDays}"
                  "${s.month.unmarkedDays > 0 ? " · ${s.month.unmarkedDays} unmarked" : ""}",
                  maxLines: 1,
                  style: AppText.labelSmallMuted,
                ),
              ],
            ),
          ),
        Container(
          width: _nameW,
          height: _rowH,
          alignment: Alignment.centerLeft,
          padding: const EdgeInsets.symmetric(horizontal: 8),
          decoration: const BoxDecoration(
            color: AppColors.surface,
            border: Border(right: BorderSide(color: _line)),
          ),
          child: const Text(
            "Present (headcount)",
            style: AppText.labelSmallMuted,
          ),
        ),
      ],
    );

    final scrolled = Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        Row(
          children: [
            for (final d in days)
              _DayHead(
                day: d,
                width: _cellW,
                height: _headH,
                holidayBg: _holiday,
                line: _line,
              ),
            cell(
              "Month\nP/W",
              bg: AppColors.surface,
              w: 52,
              h: _headH,
              fg: AppColors.muted,
            ),
            cell(
              "Session\n%",
              bg: AppColors.surface,
              w: 58,
              h: _headH,
              fg: AppColors.muted,
            ),
          ],
        ),
        for (final s in students)
          Row(
            children: [
              for (final d in days)
                () {
                  final v = monthCell(s, d);
                  return cell(
                    v,
                    bg: d.working ? null : _holiday,
                    fg: v == "H" || v == "–" ? AppColors.muted : _markColor(v),
                    bold: v != "H" && v != "–",
                    tip: d.working ? null : d.label,
                  );
                }(),
              cell(
                "${_num(s.month.presentDays)}/${s.month.workingDays}",
                w: 52,
                bold: false,
              ),
              cell(
                s.session.percent == null
                    ? "—"
                    : "${_num(s.session.percent!)}%",
                w: 58,
                bold: false,
                tip:
                    "${_num(s.session.presentDays)} of ${s.session.workingDays} working days this session",
              ),
            ],
          ),
        Row(
          children: [
            for (final d in days)
              cell(
                !d.working
                    ? "H"
                    : d.future
                    ? ""
                    : _num(dayHeadcount(students, d)),
                bg: AppColors.surface,
                fg: AppColors.muted,
                bold: false,
              ),
            cell("", bg: AppColors.surface, w: 52),
            cell("", bg: AppColors.surface, w: 58),
          ],
        ),
      ],
    );

    return Container(
      decoration: BoxDecoration(
        color: Colors.white,
        border: Border.all(color: _line),
        borderRadius: BorderRadius.circular(10),
      ),
      clipBehavior: Clip.antiAlias,
      child: Row(
        crossAxisAlignment: CrossAxisAlignment.start,
        children: [
          pinned,
          Expanded(
            child: SingleChildScrollView(
              scrollDirection: Axis.horizontal,
              child: scrolled,
            ),
          ),
        ],
      ),
    );
  }
}

class _DayHead extends StatelessWidget {
  const _DayHead({
    required this.day,
    required this.width,
    required this.height,
    required this.holidayBg,
    required this.line,
  });

  final MonthRegisterDay day;
  final double width;
  final double height;
  final Color holidayBg;
  final Color line;

  @override
  Widget build(BuildContext context) {
    final dt = DateTime.tryParse(day.date);
    final wd = dt == null ? "" : _weekday[dt.weekday - 1];
    final box = Container(
      width: width,
      height: height,
      alignment: Alignment.center,
      decoration: BoxDecoration(
        color: day.working ? AppColors.surface : holidayBg,
        border: Border(
          right: BorderSide(color: line, width: 0.5),
          bottom: BorderSide(color: line),
        ),
      ),
      child: Column(
        mainAxisAlignment: MainAxisAlignment.center,
        children: [
          Text(
            "${dt?.day ?? ""}",
            style: TextStyle(
              fontSize: 12,
              fontWeight: FontWeight.w700,
              color: day.working ? AppColors.ink : AppColors.muted,
            ),
          ),
          Text(
            day.working ? (day.half ? "½" : wd) : "H",
            style: TextStyle(
              fontSize: 10,
              color: day.working ? AppColors.muted : AppColors.danger,
            ),
          ),
        ],
      ),
    );
    final tip = [
      if (day.label.isNotEmpty) day.label,
      if (day.half) "Half day for this class",
      if (day.future) "Not yet",
    ].join(" · ");
    return tip.isEmpty ? box : Tooltip(message: tip, child: box);
  }
}

class _Legend extends StatelessWidget {
  @override
  Widget build(BuildContext context) {
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(12),
        child: Column(
          crossAxisAlignment: CrossAxisAlignment.start,
          children: [
            Text(
              "Legend · संकेत",
              style: AppText.labelMediumMuted.copyWith(
                fontWeight: FontWeight.w700,
              ),
            ),
            const SizedBox(height: 6),
            Wrap(
              spacing: 14,
              runSpacing: 6,
              children: [
                for (final l in kRegisterLegend)
                  Text.rich(
                    TextSpan(
                      children: [
                        TextSpan(
                          text: "${l.$1} ",
                          style: TextStyle(
                            fontWeight: FontWeight.w800,
                            color: l.$4,
                          ),
                        ),
                        TextSpan(text: "${l.$2} · ${l.$3}"),
                      ],
                    ),
                    style: AppText.bodySmallInk,
                  ),
                const Text(
                  "H  Holiday / Sunday · अवकाश",
                  style: AppText.bodySmallInk,
                ),
                const Text("–  Before admission", style: AppText.bodySmallInk),
                const Text(
                  "blank  Not marked (not counted present)",
                  style: AppText.bodySmallInk,
                ),
                const Text(
                  "½  Half holiday for the class",
                  style: AppText.bodySmallInk,
                ),
              ],
            ),
            const SizedBox(height: 6),
            const Text(
              "P/W = days present / working days. Present counts P and L as 1, HD as ½. Mark a day from Attendance.",
              style: AppText.bodySmallMuted,
            ),
          ],
        ),
      ),
    );
  }
}
