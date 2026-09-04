import "../../core/api/api_client.dart";

/// The two figures on the parent home that used to be a dash.
///
/// Both come from endpoints the app already calls one tap later, so the
/// home shows the same numbers the module screens do — never a separate,
/// possibly disagreeing, summary. A dash stays the answer when the school
/// has recorded nothing, per the rule that unknown must not become fact.

/// "94%" — presence over the days the register was actually marked, with a
/// late arrival counted as present (the child was there). Dash until the
/// first register is marked.
String attendanceTileValue(AttendanceHistory? h) {
  if (h == null || h.markedDays <= 0) return "—";
  final present = h.presentDays + h.lateDays;
  final pct = (present * 100 / h.markedDays).round().clamp(0, 100);
  return "$pct%";
}

/// Homework posts and diary notes dated within the last seven days, as
/// "3 new" — "0 new" is a real answer once the feed loads.
String homeworkTileValue(HomeworkFeed? feed, DateTime now) {
  if (feed == null) return "—";
  final cutoff = DateTime(
    now.year,
    now.month,
    now.day,
  ).subtract(const Duration(days: 6));
  var n = 0;
  for (final item in feed.items) {
    final d = DateTime.tryParse(item.date);
    if (d == null) continue;
    final day = DateTime(d.year, d.month, d.day);
    if (!day.isBefore(cutoff) && !day.isAfter(now)) n++;
  }
  return "$n new";
}
