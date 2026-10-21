import "../../core/api/api_client.dart";

/// The marks the month register takes — the web register's own
/// (lib/attendanceMonthRegister MONTH_STATUSES): P present, A absent,
/// L late (NOT leave), HD half day, LE leave / excused. "H" is a holiday
/// of the calendar, never a mark.
const kMonthMarks = ["P", "A", "L", "HD", "LE"];

/// A cell this person may change: the server said canEdit (class teacher of
/// the section, or the office / leadership, with attendance·edit), the day
/// is a working day, not after today, and not before the child's start.
/// Back-dating is the web's rule: any past working day of the session.
bool monthCellMarkable(
  MonthRegister r,
  MonthRegisterStudent s,
  MonthRegisterDay d,
) => r.canEdit && d.working && !d.future && d.date.compareTo(s.startsOn) >= 0;

/// Unsaved changes to a month register, per day: date → studentId →
/// status ("" = clear that child's mark). Only cells that differ from what
/// is saved are kept, so the save names nothing it did not change.
class MonthRegisterEdits {
  final Map<String, Map<String, String>> _byDate = {};

  bool get isEmpty => _byDate.isEmpty;

  /// Changed cells across the month.
  int get count => _byDate.values.fold(0, (n, d) => n + d.length);

  bool isEdited(MonthRegisterStudent s, MonthRegisterDay d) =>
      _byDate[d.date]?.containsKey(s.id) ?? false;

  /// What the cell holds now: the unsaved change, else the saved mark.
  String valueOf(MonthRegisterStudent s, MonthRegisterDay d) =>
      _byDate[d.date]?[s.id] ?? s.marks[d.date] ?? "";

  /// Sets one cell. Setting it back to what is saved drops the change.
  void set(MonthRegisterStudent s, MonthRegisterDay d, String next) {
    if (next.isNotEmpty && !kMonthMarks.contains(next)) return;
    final saved = s.marks[d.date] ?? "";
    final day = _byDate.putIfAbsent(d.date, () => {});
    if (next == saved) {
      day.remove(s.id);
    } else {
      day[s.id] = next;
    }
    if (day.isEmpty) _byDate.remove(d.date);
  }

  /// "Fill this day": every markable child with no mark on [d] (saved or
  /// unsaved) gets [mark]. Marks already there stay — the teacher then taps
  /// the exceptions. Touches [d] only. Returns how many cells were filled.
  int fillDay(MonthRegister r, MonthRegisterDay d, {String mark = "P"}) {
    if (!kMonthMarks.contains(mark)) return 0;
    var n = 0;
    for (final s in r.students) {
      if (!monthCellMarkable(r, s, d)) continue;
      if (valueOf(s, d).isNotEmpty) continue;
      set(s, d, mark);
      n++;
    }
    return n;
  }

  void clear() => _byDate.clear();

  /// The POST /api/v1/attendance/month `days` body: only changed days, only
  /// changed children. Date order.
  List<Map<String, dynamic>> payload() {
    final dates = _byDate.keys.toList()..sort();
    return [
      for (final date in dates)
        {
          "date": date,
          "marks": [
            for (final e in _byDate[date]!.entries)
              {"studentId": e.key, "status": e.value},
          ],
        },
    ];
  }
}
