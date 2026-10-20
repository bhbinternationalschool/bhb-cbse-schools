part of "api_client.dart";

/* ─── Principal home cards (approved requests, 20 Oct 2026) ──────────
 * mr_mv9y435vx6e5  Notices & news: create from the app
 * mr_mv9y9nazs38w  "Collected today" → the whole school's receipts
 * mr_mv9yf8qf6y0j  "Active staff" → Staff list → a colleague's profile
 * mr_mv9ym54sdge3  "Present today" / "Absent" → the list, filtered
 * mr_mva0mcxt0c3h  Staff today → what each person did today
 */

/// Which of today's staff rows a principal card opens.
enum StaffTodayFilter { present, absent }

/// Present = P, L (late) or HD (half day) — the server's count
/// (lib/staffToday isPresentStatus), so a card and its list agree.
bool isStaffPresentStatus(String s) => s == "P" || s == "L" || s == "HD";

List<StaffAttendanceRow> filterStaffToday(
  List<StaffAttendanceRow> rows,
  StaffTodayFilter? filter,
) => switch (filter) {
  StaffTodayFilter.present =>
    rows.where((r) => isStaffPresentStatus(r.status)).toList(),
  StaffTodayFilter.absent => rows.where((r) => r.status == "A").toList(),
  null => rows,
};

class StaffActivityItem {
  StaffActivityItem.fromJson(Map<String, dynamic> j)
    : kind = _s(j, "kind"),
      count = _i(j, "count"),
      qty = _i(j, "qty"),
      firstAt = _s(j, "firstAt"),
      lastAt = _s(j, "lastAt"),
      details = ((j["details"] as List?) ?? const [])
          .map((e) => e.toString())
          .toList();

  final String kind;
  final int count;
  final int qty;
  final String firstAt;
  final String lastAt;
  final List<String> details;
}

class StaffActivityPerson {
  StaffActivityPerson.fromJson(Map<String, dynamic> j)
    : staffId = _s(j, "staffId"),
      fullName = _s(j, "fullName"),
      designation = _s(j, "designation"),
      status = _s(j, "status"),
      items = _list(j, "items").map(StaffActivityItem.fromJson).toList();

  final String staffId;
  final String fullName;
  final String designation;
  final String status;
  final List<StaffActivityItem> items;

  /// Activities other than punching in and out.
  int get workCount => items
      .where((i) => i.kind != "punch_in" && i.kind != "punch_out")
      .fold(0, (n, i) => n + i.count);
}

class StaffActivityToday {
  StaffActivityToday.fromJson(Map<String, dynamic> j)
    : date = _s(j, "date"),
      auditKnown = _b(j, "auditKnown"),
      staff = _list(j, "staff").map(StaffActivityPerson.fromJson).toList();

  final String date;

  /// false = the audit log could not be read: marks entered, leave decided
  /// and the like are missing from the list, not zero.
  final bool auditKnown;
  final List<StaffActivityPerson> staff;
}

class ColleagueProfileField {
  ColleagueProfileField.fromJson(Map<String, dynamic> j)
    : key = _s(j, "key"),
      label = _s(j, "label"),
      hindi = _s(j, "hindi"),
      group = _s(j, "group"),
      value = _s(j, "value");

  final String key;
  final String label;
  final String hindi;
  final String group;
  final String value;
}

class ColleagueProfile {
  ColleagueProfile.fromJson(Map<String, dynamic> j)
    : id = _s(_map(j, "staff"), "id"),
      empCode = _s(_map(j, "staff"), "empCode"),
      fullName = _s(_map(j, "staff"), "fullName"),
      photoUrl = _s(_map(j, "staff"), "photoUrl"),
      designation = _s(_map(j, "staff"), "designation"),
      department = _s(_map(j, "staff"), "department"),
      joiningDate = _s(_map(j, "staff"), "joiningDate"),
      mobile = _s(_map(j, "staff"), "mobile"),
      classTeacherOf =
          ((_map(j, "staff")["classTeacherOf"] as List?) ?? const [])
              .map((e) => e.toString())
              .toList(),
      fields = _list(j, "fields").map(ColleagueProfileField.fromJson).toList();

  final String id;
  final String empCode;
  final String fullName;
  final String photoUrl;
  final String designation;
  final String department;
  final String joiningDate;
  final String mobile;
  final List<String> classTeacherOf;
  final List<ColleagueProfileField> fields;
}

Map<String, dynamic> _map(Map<String, dynamic> j, String k) =>
    (j[k] as Map<String, dynamic>?) ?? const {};

/// What the compose form sends; checked before it goes (the server checks
/// again). null = fine, else the message to show.
String? noticeDraftProblem({required String title, required String body}) {
  if (title.trim().isEmpty) return "title";
  if (body.trim().isEmpty) return "body";
  if (title.trim().length > 200) return "title_long";
  if (body.trim().length > 5000) return "body_long";
  return null;
}

extension HomeCardsApi on ApiClient {
  Future<StaffActivityToday> fetchStaffActivityToday() async =>
      StaffActivityToday.fromJson(
        await _getData("/api/v1/principal/lists?kind=staff_activity"),
      );

  Future<ColleagueProfile> fetchColleagueProfile(String staffId) async =>
      ColleagueProfile.fromJson(
        await _getData("/api/v1/staff/roster/${Uri.encodeComponent(staffId)}"),
      );

  /// The whole school's receipts on a day — the principal's "Collected
  /// today". With [academicYearCode] the list counts what the card counts.
  Future<DayCollections> fetchSchoolCollections({
    String academicYearCode = "",
  }) async => DayCollections.fromJson(
    await _getData(
      "/api/v1/staff/fees/collections?scope=all"
      "${academicYearCode.isEmpty ? "" : "&academicYearCode=${Uri.encodeComponent(academicYearCode)}"}",
    ),
  );

  /// Publish a notice (`kind: "notice"`) or a news item (`"news"`).
  Future<void> publishNotice({
    required String kind,
    required String title,
    required String body,
    String audience = "all",
    bool pinned = false,
    String summary = "",
  }) async {
    await _postData("/api/v1/staff/notices", {
      "kind": kind,
      "title": title.trim(),
      "body": body.trim(),
      if (kind == "notice") "audience": audience,
      if (kind == "notice") "pinned": pinned,
      if (kind == "news" && summary.trim().isNotEmpty)
        "summary": summary.trim(),
    });
  }
}
