part of "api_client.dart";

// Staff self-service: my salary advances, outdoor duty, my payslip PDF.
// Every route here is scoped by the server to the signed-in member of staff
// — nothing sent from the phone names whose record it is.

/// One recovery against an advance — from salary (with its payslip month)
/// or returned to the school in cash / transfer.
class AdvanceRecoveryInfo {
  AdvanceRecoveryInfo.fromJson(Map<String, dynamic> j)
    : month = _s(j, "month"),
      method = _s(j, "method"),
      amount = _d(j, "amount"),
      recoveredAt = _s(j, "recoveredAt"),
      note = _s(j, "note");

  /// YYYY-MM when recovered from salary; empty for a return.
  final String month;

  /// "salary" | "return_to_school"
  final String method;
  final double amount;
  final String recoveredAt;
  final String note;

  bool get fromSalary => method == "salary";
}

/// A salary advance given to me (GET /api/v1/staff/my-advances).
class StaffAdvanceInfo {
  StaffAdvanceInfo.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      amount = _d(j, "amount"),
      givenDate = _s(j, "givenDate"),
      note = _s(j, "note"),
      status = _s(j, "status"),
      recovered = _d(j, "recovered"),
      outstanding = _d(j, "outstanding"),
      recoveries = _list(
        j,
        "recoveries",
      ).map(AdvanceRecoveryInfo.fromJson).toList();

  final String id;
  final double amount;
  final String givenDate;
  final String note;

  /// "open" | "closed"
  final String status;
  final double recovered;
  final double outstanding;
  final List<AdvanceRecoveryInfo> recoveries;

  bool get closed => status == "closed" || outstanding <= 0;

  /// The payslip months this advance was recovered in, oldest first, each
  /// once ("2026-08", "2026-09").
  List<String> get salaryMonths {
    final months = <String>{
      for (final r in recoveries)
        if (r.fromSalary && r.month.isNotEmpty) r.month,
    }.toList()..sort();
    return months;
  }
}

class MyAdvances {
  MyAdvances.fromJson(Map<String, dynamic> j)
    : outstanding = _d(j, "outstanding"),
      advances = _list(j, "advances").map(StaffAdvanceInfo.fromJson).toList();

  final double outstanding;
  final List<StaffAdvanceInfo> advances;
}

/// Purposes the ERP accepts (lib/staffAttendance OUTDOOR_DUTY_PURPOSE_LABELS);
/// anything else is filed as "other" by the server.
const kOutdoorDutyPurposes = <(String, String, String)>[
  ("bank", "Bank work", "बैंक का काम"),
  ("inspection", "Inspection / audit", "निरीक्षण / ऑडिट"),
  ("vendor_meeting", "Vendor meeting", "विक्रेता से मीटिंग"),
  ("admission_survey", "Admission survey", "प्रवेश सर्वे"),
  ("official_errand", "Official errand", "दफ़्तर का काम"),
  ("other", "Other", "अन्य"),
];

String outdoorPurposeLabel(String code) {
  for (final p in kOutdoorDutyPurposes) {
    if (p.$1 == code) return p.$2;
  }
  return "Other";
}

/// An outdoor-duty session (lib/staffAttendance OutdoorDutySession).
class OutdoorDutySession {
  OutdoorDutySession.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      purpose = _s(j, "purpose"),
      destination = _s(j, "destination"),
      note = _s(j, "note"),
      startedAt = _s(j, "startedAt"),
      endedAt = _s(j, "endedAt"),
      status = _s(j, "status"),
      hasStartGeo = j["startGeo"] is Map,
      hasEndGeo = j["endGeo"] is Map;

  final String id;
  final String purpose;
  final String destination;
  final String note;
  final String startedAt;
  final String endedAt;

  /// "active" | "ended"
  final String status;
  final bool hasStartGeo;
  final bool hasEndGeo;

  bool get active => status == "active";
}

extension SelfServiceApi on ApiClient {
  /// My salary advances: given, recovered, outstanding.
  Future<MyAdvances> fetchMyAdvances() async =>
      MyAdvances.fromJson(await _getData("/api/v1/staff/my-advances"));

  /// My active outdoor duty, or null.
  Future<OutdoorDutySession?> fetchOutdoorDuty() async {
    final data = await _getData("/api/v1/staff/attendance/outdoor");
    final a = data["active"];
    return a is Map
        ? OutdoorDutySession.fromJson(Map<String, dynamic>.from(a))
        : null;
  }

  /// Check out for outdoor duty (start). Location is optional for the
  /// server, as on the web; sent when the phone has a fix.
  Future<OutdoorDutySession> startOutdoorDuty({
    required String purpose,
    required String destination,
    String note = "",
    double? lat,
    double? lng,
    double? accuracyM,
  }) async {
    final data = await _postData("/api/v1/staff/attendance/outdoor", {
      "action": "start",
      "purpose": purpose,
      "destination": destination,
      "note": note,
      if (lat != null && lng != null) ...{
        "lat": lat,
        "lng": lng,
        "accuracyM": ?accuracyM,
      },
    });
    return OutdoorDutySession.fromJson(
      Map<String, dynamic>.from(data["session"] as Map),
    );
  }

  /// Check back in from outdoor duty (end).
  Future<OutdoorDutySession> endOutdoorDuty({
    required String sessionId,
    double? lat,
    double? lng,
    double? accuracyM,
  }) async {
    final data = await _postData("/api/v1/staff/attendance/outdoor", {
      "action": "end",
      "sessionId": sessionId,
      if (lat != null && lng != null) ...{
        "lat": lat,
        "lng": lng,
        "accuracyM": ?accuracyM,
      },
    });
    return OutdoorDutySession.fromJson(
      Map<String, dynamic>.from(data["session"] as Map),
    );
  }

  /// The FYI the web sends after an outdoor-duty check-out / check-in: a
  /// short message to leadership (POST /api/v1/staff/broadcast, audience
  /// "leadership"). Best effort — the duty is already filed, so a failure
  /// here is swallowed, exactly as on the web.
  Future<void> pingLeadership(String body) async {
    try {
      await http.post(
        _uri("/api/v1/staff/broadcast"),
        headers: await _authHeaders(),
        body: jsonEncode({
          "audience": "leadership",
          "body": body,
          "dryRun": false,
        }),
      );
    } catch (_) {
      // FYI only.
    }
  }

  /// My payslip for a month as PDF bytes (the slip's pdfUrl), fetched with
  /// the session like a receipt PDF.
  Future<List<int>> fetchPayslipPdf(String pdfUrl) async {
    final res = await http.get(_uri(pdfUrl), headers: await imageHeaders());
    if (res.statusCode != 200) _throwFrom(res);
    return res.bodyBytes;
  }
}
