import "package:flutter/material.dart";

import "../../core/api/api_client.dart";
import "../../core/i18n/locale_controller.dart";
import "../../core/theme/app_theme.dart";

/// How one day kind looks on the calendar — the app's copy of the web's
/// KIND_STYLE (apps/web/src/components/staff/MyPayWorkspace.tsx), so the
/// phone and "My pay & attendance" on the web colour a day the same way.
class StaffDayStyle {
  const StaffDayStyle({
    required this.background,
    required this.foreground,
    required this.name,
    required this.hindi,
    this.dashed = false,
    this.bold = false,
    this.faded = false,
  });

  final Color background;
  final Color foreground;
  final String name;
  final String hindi;

  /// "Not marked" is a dashed red outline, not a fill.
  final bool dashed;
  final bool bold;

  /// Days still to come.
  final bool faded;
}

const _sunken = Color(0xFFF1EFE8);
const _successSoft = Color(0xFFE3F3EA);
const _warningSoft = Color(0xFFFBEEDC);
const _infoSoft = Color(0xFFE4EBFB);
const _dangerSoft = Color(0xFFFBE7E5);
const _violet = Color(0xFF534AB7);

/// Kind → colours and words. An unknown kind (a newer server) shows plain.
StaffDayStyle staffDayStyle(String kind) => switch (kind) {
  "present" => const StaffDayStyle(
    background: _successSoft,
    foreground: AppColors.success,
    name: "Present",
    hindi: "उपस्थित",
  ),
  "late" => const StaffDayStyle(
    background: _warningSoft,
    foreground: AppColors.warning,
    name: "Late",
    hindi: "देर से",
  ),
  "half_day" => const StaffDayStyle(
    background: _infoSoft,
    foreground: AppColors.info,
    name: "Half day",
    hindi: "आधा दिन",
  ),
  "absent" => const StaffDayStyle(
    background: _dangerSoft,
    foreground: AppColors.danger,
    name: "Absent",
    hindi: "अनुपस्थित",
  ),
  "not_marked" => const StaffDayStyle(
    background: Colors.transparent,
    foreground: AppColors.danger,
    name: "Not marked",
    hindi: "दर्ज नहीं",
    dashed: true,
  ),
  "leave" => const StaffDayStyle(
    background: _sunken,
    foreground: _violet,
    name: "Leave",
    hindi: "छुट्टी",
    bold: true,
  ),
  "holiday" => const StaffDayStyle(
    background: _sunken,
    foreground: AppColors.muted,
    name: "Holiday",
    hindi: "अवकाश",
  ),
  "unpaid_holiday" => const StaffDayStyle(
    background: _sunken,
    foreground: AppColors.danger,
    name: "Unpaid holiday",
    hindi: "अवैतनिक अवकाश",
  ),
  "exempt" => const StaffDayStyle(
    background: _successSoft,
    foreground: AppColors.success,
    name: "No attendance kept",
    hindi: "हाज़िरी नहीं रखी जाती",
  ),
  _ => const StaffDayStyle(
    background: Colors.transparent,
    foreground: AppColors.muted,
    name: "",
    hindi: "",
    faded: true,
  ),
};

/// The legend's kinds, in the web's order.
const kStaffLegendKinds = <String>[
  "present",
  "late",
  "half_day",
  "leave",
  "absent",
  "not_marked",
  "holiday",
];

/// Empty cells before day 1 in a Sunday-first week (the web's grid starts on
/// Sunday too). "2026-10" → 4, because 1 Oct 2026 is a Thursday.
int calendarLeadingBlanks(String month) {
  final p = month.split("-");
  final y = p.isNotEmpty ? int.tryParse(p[0]) : null;
  final m = p.length > 1 ? int.tryParse(p[1]) : null;
  if (y == null || m == null || m < 1 || m > 12) return 0;
  return DateTime.utc(y, m, 1).weekday % 7;
}

/// "2026-01" shifted by -1 → "2025-12".
String shiftMonth(String month, int by) {
  final p = month.split("-");
  final y = int.tryParse(p.first) ?? DateTime.now().year;
  final m = p.length > 1 ? (int.tryParse(p[1]) ?? 1) : 1;
  final d = DateTime.utc(y, m + by, 1);
  return "${d.year}-${d.month.toString().padLeft(2, "0")}";
}

const _monthsEn = [
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
const _monthsHi = [
  "जनवरी",
  "फ़रवरी",
  "मार्च",
  "अप्रैल",
  "मई",
  "जून",
  "जुलाई",
  "अगस्त",
  "सितंबर",
  "अक्टूबर",
  "नवंबर",
  "दिसंबर",
];

/// "2026-10" → "October 2026" (or "अक्टूबर 2026").
String fullMonthLabel(String month, {bool hindi = false}) {
  final p = month.split("-");
  final m = p.length > 1 ? int.tryParse(p[1]) ?? 0 : 0;
  if (m < 1 || m > 12) return month;
  return "${(hindi ? _monthsHi : _monthsEn)[m - 1]} ${p[0]}";
}

String _thisMonth() {
  // The school runs on IST; the phone's clock is close enough to pick the
  // opening month, and the server's own "today" takes over once loaded.
  final now = DateTime.now().toUtc().add(const Duration(hours: 5, minutes: 30));
  return "${now.year}-${now.month.toString().padLeft(2, "0")}";
}

/// My attendance for a month, as a calendar — coloured by what payroll will
/// count, with the month's totals and each day's punch on tap. Director,
/// 13 Oct 2026: "show them their attendance in calendar view". Data from
/// /api/v1/staff/my-attendance (lib/staffMonthCalendar.ts on the server).
class MyAttendanceCalendarScreen extends StatefulWidget {
  const MyAttendanceCalendarScreen({
    super.key,
    required this.api,
    this.initialMonth,
  });

  final ApiClient api;

  /// YYYY-MM; this month when null.
  final String? initialMonth;

  @override
  State<MyAttendanceCalendarScreen> createState() =>
      _MyAttendanceCalendarScreenState();
}

class _MyAttendanceCalendarScreenState
    extends State<MyAttendanceCalendarScreen> {
  late String _month;
  late String _latest;
  StaffAttendanceMonth? _data;
  String? _error;
  int _ticket = 0;

  bool get _hi => Localizations.localeOf(context).languageCode == "hi";
  String _t(String en, String hi) => _hi ? hi : en;

  @override
  void initState() {
    super.initState();
    _latest = _thisMonth();
    final asked = widget.initialMonth ?? "";
    _month =
        RegExp(r"^\d{4}-\d{2}$").hasMatch(asked) &&
            asked.compareTo(_latest) <= 0
        ? asked
        : _latest;
    _load();
  }

  Future<void> _load() async {
    final ticket = ++_ticket;
    final month = _month;
    setState(() => _error = null);
    try {
      final d = await widget.api.fetchMyAttendance(month);
      if (!mounted || ticket != _ticket) return;
      setState(() {
        _data = d;
        if (d.today.length >= 7) _latest = d.today.substring(0, 7);
      });
    } on ApiException catch (e) {
      if (mounted && ticket == _ticket) setState(() => _error = e.message);
    } catch (_) {
      if (mounted && ticket == _ticket) {
        setState(
          () => _error = context.l10n.homeCouldNotReachServerCheckConnection,
        );
      }
    }
  }

  void _go(int by) {
    final next = shiftMonth(_month, by);
    if (next.compareTo(_latest) > 0) return;
    setState(() {
      _month = next;
      _data = null;
    });
    _load();
  }

  @override
  Widget build(BuildContext context) {
    final data = _data?.month == _month ? _data : null;
    return Scaffold(
      appBar: AppBar(
        title: Text(
          _t("My attendance", "मेरी हाज़िरी"),
          style: AppText.titleMedium,
        ),
        actions: const [LanguageToggle(onLight: true)],
      ),
      body: RefreshIndicator(
        onRefresh: _load,
        color: AppColors.primary,
        child: ListView(
          physics: const AlwaysScrollableScrollPhysics(),
          padding: const EdgeInsets.fromLTRB(16, 12, 16, 32),
          children: [
            _monthBar(),
            const SizedBox(height: 12),
            if (data == null && _error != null)
              _errorCard()
            else if (data == null)
              const Padding(
                padding: EdgeInsets.symmetric(vertical: 48),
                child: Center(
                  child: CircularProgressIndicator(color: AppColors.primary),
                ),
              )
            else ...[
              if (data.exempt) _exemptNote(),
              _counts(data.counts),
              const SizedBox(height: 12),
              _grid(data),
              const SizedBox(height: 12),
              _legend(),
              const SizedBox(height: 10),
              Text(
                data.exempt
                    ? _t(
                        "You are not required to keep attendance, so days without a register count as present.",
                        "आपको हाज़िरी नहीं लगानी होती, इसलिए बिना रजिस्टर वाले दिन उपस्थित गिने जाते हैं।",
                      )
                    : _t(
                        "“Not marked” means no attendance was recorded that working day — payroll counts it as absent. Punch in every day, or ask the office to correct it before the payroll run.",
                        "“दर्ज नहीं” का अर्थ है उस कार्य-दिवस की हाज़िरी नहीं लगी — वेतन में इसे अनुपस्थित गिना जाता है। रोज़ पंच करें, या वेतन बनने से पहले कार्यालय से सुधार करवाएँ।",
                      ),
                style: AppText.labelMediumMuted,
              ),
            ],
          ],
        ),
      ),
    );
  }

  Widget _monthBar() {
    final atLatest = _month.compareTo(_latest) >= 0;
    return Row(
      children: [
        IconButton.outlined(
          tooltip: _t("Previous month", "पिछला महीना"),
          onPressed: () => _go(-1),
          icon: const Icon(Icons.chevron_left),
        ),
        Expanded(
          child: Row(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              const Icon(
                Icons.calendar_month_outlined,
                size: 18,
                color: AppColors.primary,
              ),
              const SizedBox(width: 6),
              Text(
                fullMonthLabel(_month, hindi: _hi),
                style: AppText.titleSmallInk.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
            ],
          ),
        ),
        IconButton.outlined(
          tooltip: _t("Next month", "अगला महीना"),
          // No month after this one — there is nothing to show yet.
          onPressed: atLatest ? null : () => _go(1),
          icon: const Icon(Icons.chevron_right),
        ),
      ],
    );
  }

  Widget _errorCard() => Card(
    child: Padding(
      padding: const EdgeInsets.all(16),
      child: Column(
        children: [
          const Icon(
            Icons.cloud_off_outlined,
            size: 36,
            color: AppColors.muted,
          ),
          const SizedBox(height: 8),
          Text(_error!, textAlign: TextAlign.center),
          const SizedBox(height: 8),
          FilledButton(onPressed: _load, child: Text(context.l10n.retry)),
        ],
      ),
    ),
  );

  Widget _exemptNote() => Card(
    color: ModuleTone.green.background,
    margin: const EdgeInsets.only(bottom: 12),
    child: ListTile(
      leading: Icon(
        Icons.verified_outlined,
        color: ModuleTone.green.foreground,
      ),
      title: Text(
        _t("Exempt from attendance", "हाज़िरी से छूट"),
        style: AppText.bodyMediumInk.copyWith(fontWeight: FontWeight.w600),
      ),
      subtitle: Text(
        _t(
          "Days without a register count as present.",
          "बिना रजिस्टर वाले दिन उपस्थित गिने जाते हैं।",
        ),
        style: AppText.bodySmallMuted,
      ),
    ),
  );

  Widget _counts(StaffCalendarCounts c) {
    String n(double v) =>
        v == v.roundToDouble() ? v.toInt().toString() : v.toStringAsFixed(1);
    final items = <(int, String, String, Color)>[
      (c.present, "Present", "उपस्थित", AppColors.success),
      (c.late, "Late", "देर से", AppColors.warning),
      (c.halfDay, "Half day", "आधा दिन", AppColors.info),
      (c.absent, "Absent", "अनुपस्थित", AppColors.danger),
      (c.leave, "Leave", "छुट्टी", _violet),
      (c.holidays, "Holidays", "अवकाश", AppColors.muted),
      (c.notMarked, "Not marked", "दर्ज नहीं", AppColors.danger),
    ];
    return Column(
      crossAxisAlignment: CrossAxisAlignment.start,
      children: [
        GridView.count(
          crossAxisCount: 4,
          shrinkWrap: true,
          physics: const NeverScrollableScrollPhysics(),
          mainAxisSpacing: 8,
          crossAxisSpacing: 8,
          childAspectRatio: 1.25,
          children: [
            for (final (count, en, hi, color) in items)
              Container(
                decoration: BoxDecoration(
                  color: Colors.white,
                  borderRadius: BorderRadius.circular(12),
                  border: Border.all(color: const Color(0xFFE4E2DA)),
                ),
                alignment: Alignment.center,
                padding: const EdgeInsets.symmetric(horizontal: 2),
                child: Column(
                  mainAxisSize: MainAxisSize.min,
                  children: [
                    Text(
                      "$count",
                      style: AppText.titleMedium.copyWith(
                        color: color,
                        fontWeight: FontWeight.w700,
                      ),
                    ),
                    Text(
                      _t(en, hi),
                      maxLines: 1,
                      overflow: TextOverflow.ellipsis,
                      style: AppText.labelSmallMuted,
                    ),
                  ],
                ),
              ),
          ],
        ),
        if (c.lwpDays > 0) ...[
          const SizedBox(height: 8),
          Text(
            _t(
              "Loss-of-pay days this month: ${n(c.lwpDays)}",
              "इस महीने वेतन कटौती के दिन: ${n(c.lwpDays)}",
            ),
            style: AppText.bodySmall.copyWith(
              color: AppColors.danger,
              fontWeight: FontWeight.w600,
            ),
          ),
        ],
      ],
    );
  }

  Widget _grid(StaffAttendanceMonth data) {
    final weekdays = _hi
        ? const ["र", "सो", "मं", "बु", "गु", "शु", "श"]
        : const ["S", "M", "T", "W", "T", "F", "S"];
    final blanks = calendarLeadingBlanks(data.month);
    return Card(
      child: Padding(
        padding: const EdgeInsets.all(8),
        child: Column(
          children: [
            Row(
              children: [
                for (final w in weekdays)
                  Expanded(
                    child: Center(
                      child: Text(
                        w,
                        style: AppText.labelSmallMuted.copyWith(
                          fontWeight: FontWeight.w600,
                        ),
                      ),
                    ),
                  ),
              ],
            ),
            const SizedBox(height: 4),
            GridView.count(
              crossAxisCount: 7,
              shrinkWrap: true,
              physics: const NeverScrollableScrollPhysics(),
              mainAxisSpacing: 4,
              crossAxisSpacing: 4,
              children: [
                for (var i = 0; i < blanks; i++) const SizedBox.shrink(),
                for (final d in data.days)
                  _DayCell(
                    day: d,
                    isToday: d.date == data.today,
                    onTap: () => _showDay(d),
                  ),
              ],
            ),
          ],
        ),
      ),
    );
  }

  Widget _legend() => Wrap(
    spacing: 6,
    runSpacing: 6,
    children: [
      for (final k in kStaffLegendKinds)
        Builder(
          builder: (_) {
            final s = staffDayStyle(k);
            return Container(
              padding: const EdgeInsets.symmetric(horizontal: 8, vertical: 3),
              decoration: BoxDecoration(
                color: s.background,
                borderRadius: BorderRadius.circular(6),
                border: s.dashed ? Border.all(color: s.foreground) : null,
              ),
              child: Text(
                _t(s.name, s.hindi),
                style: AppText.labelSmall.copyWith(
                  color: s.foreground,
                  fontWeight: s.bold ? FontWeight.w700 : FontWeight.w500,
                ),
              ),
            );
          },
        ),
    ],
  );

  void _showDay(StaffCalendarDay d) {
    final s = staffDayStyle(d.kind);
    final dt = DateTime.tryParse(d.date);
    const wdEn = [
      "Monday",
      "Tuesday",
      "Wednesday",
      "Thursday",
      "Friday",
      "Saturday",
      "Sunday",
    ];
    const wdHi = [
      "सोमवार",
      "मंगलवार",
      "बुधवार",
      "गुरुवार",
      "शुक्रवार",
      "शनिवार",
      "रविवार",
    ];
    final heading = dt == null
        ? d.date
        : "${(_hi ? wdHi : wdEn)[dt.weekday - 1]}, ${dt.day} "
              "${fullMonthLabel(d.date.substring(0, 7), hindi: _hi)}";
    final label = d.label.isNotEmpty
        ? d.label
        : d.kind == "future"
        ? _t("Still to come", "अभी आना है")
        : "—";
    showModalBottomSheet<void>(
      context: context,
      backgroundColor: Colors.white,
      shape: const RoundedRectangleBorder(
        borderRadius: BorderRadius.vertical(top: Radius.circular(24)),
      ),
      builder: (context) => SafeArea(
        child: Padding(
          padding: const EdgeInsets.fromLTRB(20, 20, 20, 24),
          child: Column(
            mainAxisSize: MainAxisSize.min,
            crossAxisAlignment: CrossAxisAlignment.start,
            children: [
              Text(
                heading,
                style: AppText.titleSmallInk.copyWith(
                  fontWeight: FontWeight.w700,
                ),
              ),
              const SizedBox(height: 10),
              Row(
                children: [
                  Container(
                    width: 12,
                    height: 12,
                    decoration: BoxDecoration(
                      color: s.dashed ? Colors.transparent : s.foreground,
                      shape: BoxShape.circle,
                      border: s.dashed ? Border.all(color: s.foreground) : null,
                    ),
                  ),
                  const SizedBox(width: 8),
                  Expanded(
                    child: Text(
                      label,
                      style: AppText.bodyLargeInk.copyWith(
                        color: s.foreground,
                        fontWeight: FontWeight.w600,
                      ),
                    ),
                  ),
                ],
              ),
              if (d.inTime.isNotEmpty || d.outTime.isNotEmpty) ...[
                const SizedBox(height: 12),
                _SheetRow(_t("In", "आगमन"), d.inTime.isEmpty ? "—" : d.inTime),
                _SheetRow(
                  _t("Out", "प्रस्थान"),
                  d.outTime.isEmpty ? "—" : d.outTime,
                ),
              ],
              if (d.way.isNotEmpty)
                _SheetRow(_t("Punched by", "पंच का तरीका"), d.way),
            ],
          ),
        ),
      ),
    );
  }
}

class _DayCell extends StatelessWidget {
  const _DayCell({
    required this.day,
    required this.isToday,
    required this.onTap,
  });

  final StaffCalendarDay day;
  final bool isToday;
  final VoidCallback onTap;

  @override
  Widget build(BuildContext context) {
    final s = staffDayStyle(day.kind);
    final hindi = Localizations.localeOf(context).languageCode == "hi";
    final timed =
        (day.kind == "present" || day.kind == "late") && day.inTime.isNotEmpty;
    final under = timed
        ? day.inTime
        : day.kind == "future"
        ? ""
        : (hindi ? s.hindi : s.name).split(" ").first;
    return Opacity(
      opacity: s.faded ? 0.5 : 1,
      child: Material(
        color: s.background,
        shape: RoundedRectangleBorder(
          borderRadius: BorderRadius.circular(8),
          side: isToday
              ? const BorderSide(color: AppColors.accent, width: 2)
              : s.dashed
              ? BorderSide(color: s.foreground)
              : BorderSide.none,
        ),
        child: InkWell(
          borderRadius: BorderRadius.circular(8),
          onTap: onTap,
          child: Column(
            mainAxisAlignment: MainAxisAlignment.center,
            children: [
              Text(
                "${int.tryParse(day.date.length >= 10 ? day.date.substring(8, 10) : "") ?? ""}",
                style: AppText.bodyMedium.copyWith(
                  color: s.foreground,
                  fontWeight: FontWeight.w700,
                ),
              ),
              if (under.isNotEmpty)
                Text(
                  under,
                  maxLines: 1,
                  overflow: TextOverflow.clip,
                  style: TextStyle(
                    fontSize: 8.5,
                    height: 1.1,
                    color: s.foreground,
                    fontWeight: s.bold ? FontWeight.w700 : FontWeight.w500,
                  ),
                ),
            ],
          ),
        ),
      ),
    );
  }
}

class _SheetRow extends StatelessWidget {
  const _SheetRow(this.label, this.value);

  final String label;
  final String value;

  @override
  Widget build(BuildContext context) => Padding(
    padding: const EdgeInsets.symmetric(vertical: 3),
    child: Row(
      children: [
        SizedBox(
          width: 110,
          child: Text(label, style: AppText.bodyMediumMuted),
        ),
        Expanded(child: Text(value, style: AppText.bodyMediumInk)),
      ],
    ),
  );
}
