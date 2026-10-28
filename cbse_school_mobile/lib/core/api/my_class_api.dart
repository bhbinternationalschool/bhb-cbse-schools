part of "api_client.dart";

// My class (the class teacher's own children and their UDISE+ class sheet)
// and the month attendance register. Server routes:
//   GET  /api/v1/staff/class-students[?sectionId=]
//   POST /api/v1/staff/class-sheet
//   GET  /api/v1/attendance/month?classId&sectionId&month=YYYY-MM
//   POST /api/v1/attendance/month   (one register write per changed day)
// The helpers _s / _i / _d / _b / _list live in staff_api.dart (same library).

/// Every value of a `{key: value}` object as text; a missing object is empty.
Map<String, String> _mcStrMap(Object? raw) {
  if (raw is! Map) return const {};
  return {
    for (final e in raw.entries)
      "${e.key}": e.value == null ? "" : "${e.value}",
  };
}

// ------------------------------------------------------------- my class

class ClassStudentHousehold {
  ClassStudentHousehold.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      revisionAt = _s(j, "revisionAt"),
      fields = _mcStrMap(j["fields"]);

  final String id;
  final String revisionAt;

  /// whatsappMobile, mobile, altMobile, guardianName, address, locality,
  /// city, pincode — as the record holds them ("" when not recorded).
  final Map<String, String> fields;
}

class ClassStudent {
  ClassStudent.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      admissionNo = _s(j, "admissionNo"),
      classLabel = _s(j, "classLabel"),
      photoUrl = _s(j, "photoUrl"),
      revisionAt = _s(j, "revisionAt"),
      fields = _mcStrMap(j["fields"]),
      household = j["household"] is Map
          ? ClassStudentHousehold.fromJson(
              Map<String, dynamic>.from(j["household"] as Map),
            )
          : null,
      heightCm = _mcStr(j["measure"], "heightCm"),
      weightKg = _mcStr(j["measure"], "weightKg"),
      measuredOn = _mcStr(j["measure"], "measuredOn"),
      fatherQualification = _s(_mcObj(j["sheet"]), "fatherQualification"),
      motherQualification = _s(_mcObj(j["sheet"]), "motherQualification"),
      isCwsn = _b(_mcObj(j["sheet"]), "isCwsn"),
      whatsappNumber = _s(_mcObj(j["whatsapp"]), "number"),
      whatsappStatus = _s(_mcObj(j["whatsapp"]), "status");

  final String id;
  final String admissionNo;
  final String classLabel;

  /// An ERP path (/api/file/…) or "" — load with [ApiClient.imageHeaders].
  final String photoUrl;

  /// The record's revision when read: sent back on save so a record someone
  /// else saved in between is refused, not overwritten.
  final String revisionAt;

  /// fullName, gender, dob, bloodGroup, religion, category, motherTongue,
  /// placeOfBirth, rollNo, fatherName, motherName, fatherMobile,
  /// motherMobile, emergencyName, emergencyMobile.
  final Map<String, String> fields;
  final ClassStudentHousehold? household;
  final String heightCm;
  final String weightKg;
  final String measuredOn;
  final String fatherQualification;
  final String motherQualification;
  final bool isCwsn;

  /// The number the school messages ("" = none on record).
  final String whatsappNumber;

  /// missing | not_on | unchecked | on
  final String whatsappStatus;

  String get fullName => fields["fullName"] ?? "";
  String get rollNo => fields["rollNo"] ?? "";
  String get dob => fields["dob"] ?? "";
}

/// One value of an object as text — "" when absent; numbers as typed.
String _mcStr(Object? raw, String k) => _mcStrMap(raw)[k] ?? "";

Map<String, dynamic> _mcObj(Object? raw) =>
    raw is Map ? Map<String, dynamic>.from(raw) : const {};

class ClassStudentsData {
  ClassStudentsData.fromJson(Map<String, dynamic> j)
    : academicYearCode = _s(j, "academicYearCode"),
      sections = _list(
        j,
        "sections",
      ).map((x) => (id: _s(x, "id"), label: _s(x, "label"))).toList(),
      sectionId = _s(j, "sectionId"),
      verdictsAvailable = j["verdictsAvailable"] != false,
      students = _list(j, "students").map(ClassStudent.fromJson).toList();

  final String academicYearCode;

  /// Office / leadership only: every section, to pick one. Empty for a
  /// class teacher, whose own children come without picking.
  final List<({String id, String label})> sections;
  final String sectionId;

  /// False when the WhatsApp check results could not be read — "unchecked"
  /// then means "unknown", not "never checked".
  final bool verdictsAvailable;
  final List<ClassStudent> students;
}

class ClassSheetRowResult {
  ClassSheetRowResult.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      ok = _b(j, "ok"),
      error = _s(j, "error"),
      conflict = _b(j, "conflict"),
      updatedAt = _s(j, "updatedAt");

  final String id;
  final bool ok;
  final String error;

  /// Someone else saved this child's record in between — nothing written.
  final bool conflict;
  final String updatedAt;
}

class ClassSheetSaveResult {
  ClassSheetSaveResult.fromJson(Map<String, dynamic> j)
    : measuredOn = _s(j, "measuredOn"),
      saved = _i(j, "saved"),
      results = _list(j, "results").map(ClassSheetRowResult.fromJson).toList();

  final String measuredOn;
  final int saved;
  final List<ClassSheetRowResult> results;
}

// ------------------------------------------------------- month register

class MonthRegisterDay {
  MonthRegisterDay.fromJson(Map<String, dynamic> j)
    : date = _s(j, "date"),
      working = _b(j, "working"),
      half = _b(j, "half"),
      label = _s(j, "label"),
      future = _b(j, "future");

  final String date;

  /// Open for this class (a half holiday is still a working day).
  final bool working;
  final bool half;

  /// Why it is not a full working day ("Sunday Holiday", "Diwali"…).
  final String label;

  /// After today (IST) — nothing can be marked yet.
  final bool future;
}

class MonthDaysSummary {
  MonthDaysSummary.fromJson(Map<String, dynamic> j)
    : workingDays = _i(j, "workingDays"),
      presentDays = _d(j, "presentDays"),
      unmarkedDays = _i(j, "unmarkedDays"),
      percent = (j["percent"] as num?)?.toDouble();

  final int workingDays;

  /// P / L = 1, HD = ½ (lib/studentWorkingDays on the server).
  final double presentDays;

  /// Working days nobody marked — never read as presence.
  final int unmarkedDays;

  /// Null with no working days yet.
  final double? percent;
}

class MonthRegisterStudent {
  MonthRegisterStudent.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      name = _s(j, "name"),
      rollNo = _s(j, "rollNo"),
      admissionNo = _s(j, "admissionNo"),
      joinedOn = _s(j, "joinedOn"),
      startsOn = _s(j, "startsOn"),
      marks = _mcStrMap(j["marks"]),
      month = MonthDaysSummary.fromJson(_mcObj(j["month"])),
      session = MonthDaysSummary.fromJson(_mcObj(j["session"]));

  final String id;
  final String name;
  final String rollNo;
  final String admissionNo;
  final String joinedOn;

  /// First markable day: the day after admission, or the session start.
  final String startsOn;

  /// date → P / A / L / HD / LE. A working day missing here is unmarked.
  final Map<String, String> marks;
  final MonthDaysSummary month;
  final MonthDaysSummary session;
}

class MonthRegister {
  MonthRegister.fromJson(Map<String, dynamic> j)
    : academicYearCode = _s(j, "academicYearCode"),
      today = _s(j, "today"),
      months = ((j["months"] as List?) ?? const []).map((e) => "$e").toList(),
      canEdit = _b(j, "canEdit"),
      month = _s(j, "month"),
      days = _list(j, "days").map(MonthRegisterDay.fromJson).toList(),
      students = _list(
        j,
        "students",
      ).map(MonthRegisterStudent.fromJson).toList();

  final String academicYearCode;
  final String today;

  /// The session's months up to the current one, NEWEST first.
  final List<String> months;
  final bool canEdit;
  final String month;
  final List<MonthRegisterDay> days;
  final List<MonthRegisterStudent> students;
}

/// What a month-register save did: days written, and every change the
/// server refused (a future day, a holiday, a child not admitted yet…) or
/// could not write — nothing is dropped silently.
class MonthRegisterSaveResult {
  MonthRegisterSaveResult.fromJson(Map<String, dynamic> j)
    : saved = ((j["saved"] as List?) ?? const []).map((e) => "$e").toList(),
      refused = ((j["refused"] as List?) ?? const []).map((e) => "$e").toList(),
      failed = ((j["failed"] as List?) ?? const []).map((e) => "$e").toList();

  final List<String> saved;
  final List<String> refused;
  final List<String> failed;

  List<String> get problems => [...refused, ...failed];
}

extension MyClassApi on ApiClient {
  /// The class teacher's children (or, for the office, [sectionId]'s).
  Future<ClassStudentsData> fetchClassStudents({String sectionId = ""}) async {
    final q = sectionId.isEmpty
        ? ""
        : "?sectionId=${Uri.encodeQueryComponent(sectionId)}";
    return ClassStudentsData.fromJson(
      await _getData("/api/v1/staff/class-students$q"),
    );
  }

  /// One round of the class sheet. Each row is `{id, revisionAt, values}`
  /// with only the values the teacher changed; the server checks and saves
  /// each child on its own and refuses a child saved by someone else since
  /// [revisionAt].
  Future<ClassSheetSaveResult> saveClassSheet({
    required String measuredOn,
    required List<Map<String, dynamic>> rows,
  }) async => ClassSheetSaveResult.fromJson(
    await _postData("/api/v1/staff/class-sheet", {
      "measuredOn": measuredOn,
      "rows": rows,
    }),
  );

  /// The month register for a section; [month] "" = the server's default
  /// (the current month of the session).
  Future<MonthRegister> fetchMonthRegister({
    required String classId,
    required String sectionId,
    String month = "",
  }) async {
    final q = [
      "classId=${Uri.encodeQueryComponent(classId)}",
      "sectionId=${Uri.encodeQueryComponent(sectionId)}",
      if (month.isNotEmpty) "month=${Uri.encodeQueryComponent(month)}",
    ].join("&");
    return MonthRegister.fromJson(
      await _getData("/api/v1/attendance/month?$q"),
    );
  }

  /// Saves edited cells of the month register. [days] is
  /// `[{date, marks: [{studentId, status}]}]` with only the changed
  /// children — the server merges each day over what is saved and writes
  /// one register per changed day (never the whole month). Only the class
  /// teacher or the office may (403 otherwise).
  Future<MonthRegisterSaveResult> saveMonthRegister({
    required String classId,
    required String sectionId,
    required String month,
    required List<Map<String, dynamic>> days,
  }) async => MonthRegisterSaveResult.fromJson(
    await _postData("/api/v1/attendance/month", {
      "classId": classId,
      "sectionId": sectionId,
      "month": month,
      "days": days,
    }),
  );
}
