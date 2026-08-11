import "dart:convert";

import "package:flutter_secure_storage/flutter_secure_storage.dart";
import "package:http/http.dart" as http;

import "../config/app_config.dart";

/// Session cookie minted by the ERP (see web /api/auth/*).
const _cookieName = "bhb_demo_session";
const _cookieKey = "bhb_session_cookie";
const _guardianKey = "bhb_guardian_name";
const _personaKey = "bhb_persona";

class ApiException implements Exception {
  ApiException(this.message, [this.statusCode]);

  final String message;
  final int? statusCode;

  @override
  String toString() => message;
}

class ParentChild {
  const ParentChild({
    required this.id,
    required this.fullName,
    required this.admissionNo,
    required this.className,
    required this.sectionName,
    required this.rollNo,
    required this.photoUrl,
    required this.openBalancePaise,
    required this.openBalanceLabel,
  });

  factory ParentChild.fromJson(Map<String, dynamic> j) => ParentChild(
        id: j["id"] as String,
        fullName: (j["fullName"] as String).trim().replaceAll(RegExp(r"\s+"), " "),
        admissionNo: (j["admissionNo"] as String?) ?? "",
        className: (j["className"] as String?) ?? "",
        sectionName: (j["sectionName"] as String?) ?? "",
        rollNo: (j["rollNo"] as String?) ?? "",
        photoUrl: j["photoUrl"] as String?,
        openBalancePaise: (j["openBalancePaise"] as num?)?.toInt() ?? 0,
        openBalanceLabel: (j["openBalanceLabel"] as String?) ?? "₹0",
      );

  final String id;
  final String fullName;
  final String admissionNo;
  final String className;
  final String sectionName;
  final String rollNo;
  final String? photoUrl;
  final int openBalancePaise;
  final String openBalanceLabel;

  String get classLabel {
    final cls = className.isEmpty ? "—" : className;
    final sec = sectionName.isEmpty ? "" : " $sectionName";
    final roll = rollNo.isEmpty ? "" : " · Roll $rollNo";
    return "Class $cls$sec$roll";
  }

  String get initials {
    final parts =
        fullName.split(" ").where((p) => p.isNotEmpty).take(2).toList();
    return parts.map((p) => p[0].toUpperCase()).join();
  }
}

class ParentSummary {
  const ParentSummary({
    required this.guardianName,
    required this.children,
    required this.totalOpenBalanceLabel,
  });

  factory ParentSummary.fromJson(Map<String, dynamic> j) => ParentSummary(
        guardianName: (j["guardianName"] as String?) ?? "Parent",
        children: ((j["children"] as List?) ?? const [])
            .map((c) => ParentChild.fromJson(c as Map<String, dynamic>))
            .toList(),
        totalOpenBalanceLabel: (j["totalOpenBalanceLabel"] as String?) ?? "₹0",
      );

  final String guardianName;
  final List<ParentChild> children;
  final String totalOpenBalanceLabel;
}

class SectionRef {
  const SectionRef({required this.id, required this.name});

  factory SectionRef.fromJson(Map<String, dynamic> j) =>
      SectionRef(id: j["id"] as String, name: (j["name"] as String?) ?? "");

  final String id;
  final String name;
}

class ClassRef {
  const ClassRef({required this.id, required this.name, required this.sections});

  factory ClassRef.fromJson(Map<String, dynamic> j) => ClassRef(
        id: j["id"] as String,
        name: (j["name"] as String?) ?? "",
        sections: ((j["sections"] as List?) ?? const [])
            .map((s) => SectionRef.fromJson(s as Map<String, dynamic>))
            .toList(),
      );

  final String id;
  final String name;
  final List<SectionRef> sections;
}

class ClassTeacherInfo {
  const ClassTeacherInfo({
    required this.classId,
    required this.sectionId,
    required this.className,
    required this.sectionName,
    required this.studentCount,
    required this.attendanceMarked,
    required this.markedCount,
  });

  factory ClassTeacherInfo.fromJson(Map<String, dynamic> j) => ClassTeacherInfo(
        classId: j["classId"] as String,
        sectionId: j["sectionId"] as String,
        className: (j["className"] as String?) ?? "",
        sectionName: (j["sectionName"] as String?) ?? "",
        studentCount: (j["studentCount"] as num?)?.toInt() ?? 0,
        attendanceMarked: j["attendanceMarked"] == true,
        markedCount: (j["markedCount"] as num?)?.toInt() ?? 0,
      );

  final String classId;
  final String sectionId;
  final String className;
  final String sectionName;
  final int studentCount;
  final bool attendanceMarked;
  final int markedCount;
}

class PeriodToday {
  const PeriodToday({
    required this.periodNo,
    required this.startTime,
    required this.subjectName,
    required this.className,
    required this.sectionName,
  });

  factory PeriodToday.fromJson(Map<String, dynamic> j) => PeriodToday(
        periodNo: (j["periodNo"] as num?)?.toInt() ?? 0,
        startTime: (j["startTime"] as String?) ?? "",
        subjectName: (j["subjectName"] as String?) ?? "",
        className: (j["className"] as String?) ?? "",
        sectionName: (j["sectionName"] as String?) ?? "",
      );

  final int periodNo;
  final String startTime;
  final String subjectName;
  final String className;
  final String sectionName;
}

class StaffSummary {
  const StaffSummary({
    required this.fullName,
    required this.date,
    required this.classTeacherOf,
    required this.periodsToday,
    required this.classes,
  });

  factory StaffSummary.fromJson(Map<String, dynamic> j) => StaffSummary(
        fullName: (j["fullName"] as String?) ?? "Staff",
        date: (j["date"] as String?) ?? "",
        classTeacherOf: j["classTeacherOf"] == null
            ? null
            : ClassTeacherInfo.fromJson(
                j["classTeacherOf"] as Map<String, dynamic>),
        periodsToday: ((j["periodsToday"] as List?) ?? const [])
            .map((p) => PeriodToday.fromJson(p as Map<String, dynamic>))
            .toList(),
        classes: ((j["classes"] as List?) ?? const [])
            .map((c) => ClassRef.fromJson(c as Map<String, dynamic>))
            .toList(),
      );

  final String fullName;
  final String date;
  final ClassTeacherInfo? classTeacherOf;
  final List<PeriodToday> periodsToday;
  final List<ClassRef> classes;
}

class RosterStudent {
  RosterStudent({
    required this.id,
    required this.fullName,
    required this.rollNo,
    required this.photoUrl,
    required this.status,
  });

  factory RosterStudent.fromJson(Map<String, dynamic> j) => RosterStudent(
        id: j["id"] as String,
        fullName: (j["fullName"] as String)
            .trim()
            .replaceAll(RegExp(r"\s+"), " "),
        rollNo: (j["rollNo"] as String?) ?? "",
        photoUrl: j["photoUrl"] as String?,
        status: j["status"] as String?,
      );

  final String id;
  final String fullName;
  final String rollNo;
  final String? photoUrl;

  /// P / A / L / HD / LE, or null when unmarked.
  String? status;
}

class AttendanceRoster {
  const AttendanceRoster({
    required this.date,
    required this.attendanceMarked,
    required this.students,
  });

  factory AttendanceRoster.fromJson(Map<String, dynamic> j) => AttendanceRoster(
        date: (j["date"] as String?) ?? "",
        attendanceMarked: j["attendanceMarked"] == true,
        students: ((j["students"] as List?) ?? const [])
            .map((s) => RosterStudent.fromJson(s as Map<String, dynamic>))
            .toList(),
      );

  final String date;
  final bool attendanceMarked;
  final List<RosterStudent> students;
}

class ApiClient {
  ApiClient(this.config);

  final AppConfig config;
  final _storage = const FlutterSecureStorage();

  Uri _uri(String path) => Uri.parse("${config.apiBaseUrl}$path");

  Future<String?> sessionCookie() => _storage.read(key: _cookieKey);

  Future<String?> guardianName() => _storage.read(key: _guardianKey);

  Future<bool> hasSession() async =>
      (await sessionCookie())?.isNotEmpty == true;

  Future<String?> persona() => _storage.read(key: _personaKey);

  Future<void> signOut() async {
    await _storage.delete(key: _cookieKey);
    await _storage.delete(key: _guardianKey);
    await _storage.delete(key: _personaKey);
  }

  Future<void> _storeSession(Map<String, dynamic>? session) async {
    final name = session?["fullName"] as String?;
    if (name != null) await _storage.write(key: _guardianKey, value: name);
    final persona = session?["persona"] as String?;
    if (persona != null) await _storage.write(key: _personaKey, value: persona);
  }

  Future<Map<String, String>> _authHeaders() async {
    final cookie = await sessionCookie();
    return {
      "Content-Type": "application/json",
      if (cookie != null && cookie.isNotEmpty) "Cookie": "$_cookieName=$cookie",
    };
  }

  void _captureCookie(http.Response res) {
    final setCookie = res.headers["set-cookie"];
    if (setCookie == null) return;
    final m = RegExp("$_cookieName=([^;,]+)").firstMatch(setCookie);
    if (m != null) {
      _storage.write(key: _cookieKey, value: m.group(1));
    }
  }

  Never _throwFrom(http.Response res) {
    String message = "Request failed (${res.statusCode})";
    try {
      final body = jsonDecode(res.body) as Map<String, dynamic>;
      final err = body["error"];
      if (err is String && err.isNotEmpty) message = err;
      if (err is Map && err["message"] is String) {
        message = err["message"] as String;
      }
    } catch (_) {/* keep default */}
    throw ApiException(message, res.statusCode);
  }

  /// Step 1 — send the WhatsApp OTP to a registered parent mobile.
  Future<String> requestOtp(String mobile) async {
    final res = await http.post(
      _uri("/api/auth/otp/request"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({"mobile": mobile}),
    );
    if (res.statusCode != 200) _throwFrom(res);
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return (body["maskedMobile"] as String?) ?? "your WhatsApp";
  }

  /// Step 2 — verify the OTP; the ERP mints the session cookie.
  Future<void> verifyOtp(String mobile, String code) async {
    final res = await http.post(
      _uri("/api/auth/otp/verify"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({"mobile": mobile, "code": code}),
    );
    if (res.statusCode != 200) _throwFrom(res);
    _captureCookie(res);
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    await _storeSession(body["session"] as Map<String, dynamic>?);
  }

  /// Staff sign-in: Supabase email+password → ERP session cookie.
  Future<void> staffLogin(String email, String password) async {
    if (!config.supabaseConfigured) {
      throw ApiException(
        "Staff login is not configured in this build (missing Supabase keys).",
      );
    }
    final tokenRes = await http.post(
      Uri.parse("${config.supabaseUrl}/auth/v1/token?grant_type=password"),
      headers: {
        "Content-Type": "application/json",
        "apikey": config.supabaseAnonKey,
      },
      body: jsonEncode({"email": email, "password": password}),
    );
    if (tokenRes.statusCode != 200) {
      String message = "Email or password is incorrect.";
      try {
        final body = jsonDecode(tokenRes.body) as Map<String, dynamic>;
        final desc = body["error_description"] ?? body["msg"];
        if (desc is String && desc.isNotEmpty) message = desc;
      } catch (_) {/* keep default */}
      throw ApiException(message, tokenRes.statusCode);
    }
    final token =
        (jsonDecode(tokenRes.body) as Map<String, dynamic>)["access_token"]
            as String?;
    if (token == null) throw ApiException("Sign-in failed. Try again.");

    final res = await http.post(
      _uri("/api/auth/session"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({"accessToken": token}),
    );
    if (res.statusCode != 200) _throwFrom(res);
    _captureCookie(res);
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    await _storeSession(body["session"] as Map<String, dynamic>?);
  }

  /// Dev-only login against a server running with demo auth (never production).
  /// Lets the emulator sign in without real credentials or WhatsApp OTPs.
  /// Parent: pass a householdId. Staff: persona "staff".
  Future<void> devLogin({String? householdId, String persona = "parent"}) async {
    final res = await http.post(
      _uri("/api/auth/demo"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({
        "persona": persona,
        if (householdId != null && householdId.isNotEmpty)
          "householdId": householdId,
      }),
    );
    if (res.statusCode != 200) _throwFrom(res);
    _captureCookie(res);
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    await _storeSession(body["session"] as Map<String, dynamic>?);
  }

  /// The parent home screen payload — real children + fee dues.
  Future<ParentSummary> fetchParentSummary() async {
    final res = await http.get(
      _uri("/api/v1/parent/summary"),
      headers: await _authHeaders(),
    );
    if (res.statusCode != 200) _throwFrom(res);
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return ParentSummary.fromJson(body["data"] as Map<String, dynamic>);
  }

  /// The teacher home screen payload — identity, class-teacher section,
  /// today's periods, and the class/section list for attendance marking.
  Future<StaffSummary> fetchStaffSummary() async {
    final res = await http.get(
      _uri("/api/v1/staff/summary"),
      headers: await _authHeaders(),
    );
    if (res.statusCode != 200) _throwFrom(res);
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return StaffSummary.fromJson(body["data"] as Map<String, dynamic>);
  }

  Future<AttendanceRoster> fetchAttendanceRoster({
    required String classId,
    required String sectionId,
    required String date,
  }) async {
    final res = await http.get(
      _uri(
        "/api/v1/attendance/roster?classId=$classId&sectionId=$sectionId&date=$date",
      ),
      headers: await _authHeaders(),
    );
    if (res.statusCode != 200) _throwFrom(res);
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return AttendanceRoster.fromJson(body["data"] as Map<String, dynamic>);
  }

  Future<void> markAttendance({
    required String classId,
    required String sectionId,
    required String date,
    required Map<String, String> statusByStudent,
  }) async {
    final res = await http.post(
      _uri("/api/v1/attendance/mark"),
      headers: await _authHeaders(),
      body: jsonEncode({
        "classId": classId,
        "sectionId": sectionId,
        "date": date,
        "marks": [
          for (final e in statusByStudent.entries)
            {"studentId": e.key, "status": e.value},
        ],
      }),
    );
    if (res.statusCode != 200) _throwFrom(res);
  }
}
