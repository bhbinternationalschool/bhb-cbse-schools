part of "api_client.dart";

// Online classes — the parent's list and Join, the teacher's list,
// scheduling and "who joined". Mirrors /api/v1/parent/online-classes and
// /api/v1/staff/online-classes; the phase words come from the server so the
// phone never argues with the clock.

// ---------------------------------------------------------------- parent

class OnlineClassInfo {
  OnlineClassInfo.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      title = _s(j, "title"),
      subjectName = _s(j, "subjectName"),
      teacherName = _s(j, "teacherName"),
      date = _s(j, "date"),
      startTime = _s(j, "startTime"),
      endTime = _s(j, "endTime"),
      provider = _s(j, "provider"),
      status = _s(j, "status"),
      phase = _s(j, "phase"),
      canJoin = _b(j, "canJoin"),
      joined = _b(j, "joined"),
      note = _s(j, "note");

  final String id;
  final String title;
  final String subjectName;
  final String teacherName;
  final String date;
  final String startTime;
  final String endTime;
  final String provider;
  final String status;

  /// upcoming | joinable | live | over | cancelled
  final String phase;
  final bool canJoin;
  final bool joined;
  final String note;

  bool get isCancelled => phase == "cancelled";
  bool get isOver => phase == "over";
  bool get isLive => phase == "live";
}

class OnlineClassList {
  OnlineClassList.fromJson(Map<String, dynamic> j)
    : today = _s(j, "today"),
      sessions = _list(j, "sessions").map(OnlineClassInfo.fromJson).toList();

  final String today;
  final List<OnlineClassInfo> sessions;
}

// ---------------------------------------------------------------- staff

class StaffOnlineClass {
  StaffOnlineClass.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      classId = _s(j, "classId"),
      sectionId = _s(j, "sectionId"),
      className = _s(j, "className"),
      sectionName = _s(j, "sectionName"),
      subjectName = _s(j, "subjectName"),
      teacherId = _s(j, "teacherId"),
      teacherName = _s(j, "teacherName"),
      title = _s(j, "title"),
      date = _s(j, "date"),
      startTime = _s(j, "startTime"),
      endTime = _s(j, "endTime"),
      periodNo = (j["periodNo"] as num?)?.toInt(),
      provider = _s(j, "provider"),
      joinUrl = _s(j, "joinUrl"),
      meetingCode = _s(j, "meetingCode"),
      status = _s(j, "status"),
      phase = _s(j, "phase"),
      joinedCount = _i(j, "joinedCount"),
      announcedAt = _s(j, "announcedAt"),
      note = _s(j, "note");

  final String id;
  final String classId;
  final String sectionId;
  final String className;
  final String sectionName;
  final String subjectName;
  final String teacherId;
  final String teacherName;
  final String title;
  final String date;
  final String startTime;
  final String endTime;
  final int? periodNo;
  final String provider;
  final String joinUrl;
  final String meetingCode;
  final String status;
  final String phase;
  final int joinedCount;
  final String announcedAt;
  final String note;

  String get sectionLabel => "$className $sectionName".trim();
  String get heading => title.isNotEmpty ? title : (subjectName.isNotEmpty ? subjectName : "Online class");
}

class OnlineClassSectionOption {
  OnlineClassSectionOption.fromJson(Map<String, dynamic> j)
    : classId = _s(j, "classId"),
      sectionId = _s(j, "sectionId"),
      className = _s(j, "className"),
      sectionName = _s(j, "sectionName");
  final String classId;
  final String sectionId;
  final String className;
  final String sectionName;
  String get label => "$className $sectionName".trim();
  String get key => "$classId|$sectionId";
}

class OnlineClassBellPeriod {
  OnlineClassBellPeriod.fromJson(Map<String, dynamic> j)
    : no = _i(j, "no"),
      label = _s(j, "label"),
      startTime = _s(j, "startTime"),
      endTime = _s(j, "endTime");
  final int no;
  final String label;
  final String startTime;
  final String endTime;
}

class OnlineClassGoogleStatus {
  OnlineClassGoogleStatus.fromJson(Map<String, dynamic> j)
    : oauthConfigured = _b(j, "oauthConfigured"),
      connected = _b(j, "connected"),
      email = _s(j, "email"),
      canMeet = _b(j, "canMeet"),
      connectUrl = _s(j, "connectUrl");
  final bool oauthConfigured;
  final bool connected;
  final String email;
  final bool canMeet;
  final String connectUrl;
}

class StaffOnlineClassListing {
  StaffOnlineClassListing.fromJson(Map<String, dynamic> j)
    : today = _s(j, "today"),
      staffId = _s(j, "staffId"),
      unrestricted = _b(j, "unrestricted"),
      canSchedule = _b(j, "canSchedule"),
      sessions = _list(j, "sessions").map(StaffOnlineClass.fromJson).toList(),
      sections = _list(j, "sections").map(OnlineClassSectionOption.fromJson).toList(),
      subjects = _list(j, "subjects")
          .map((s) => (id: _s(s, "id"), name: _s(s, "name")))
          .toList(),
      bell = _list(j, "bell").map(OnlineClassBellPeriod.fromJson).toList(),
      google = OnlineClassGoogleStatus.fromJson(
        Map<String, dynamic>.from((j["google"] as Map?) ?? const {}),
      );

  final String today;
  final String staffId;
  final bool unrestricted;
  final bool canSchedule;
  final List<StaffOnlineClass> sessions;
  final List<OnlineClassSectionOption> sections;
  final List<({String id, String name})> subjects;
  final List<OnlineClassBellPeriod> bell;
  final OnlineClassGoogleStatus google;
}

class OnlineClassAttendanceRow {
  OnlineClassAttendanceRow.fromJson(Map<String, dynamic> j)
    : studentId = _s(j, "studentId"),
      fullName = _s(j, "fullName"),
      rollNo = _s(j, "rollNo"),
      joined = _b(j, "joined"),
      source = _s(j, "source"),
      minutes = _i(j, "minutes");
  final String studentId;
  final String fullName;
  final String rollNo;
  final bool joined;
  final String source;
  final int minutes;
}

class OnlineClassAttendance {
  OnlineClassAttendance.fromJson(Map<String, dynamic> j)
    : total = _i(j, "total"),
      joined = _i(j, "joined"),
      canSync = _b(j, "canSync"),
      rows = _list(j, "rows").map(OnlineClassAttendanceRow.fromJson).toList();
  final int total;
  final int joined;
  final bool canSync;
  final List<OnlineClassAttendanceRow> rows;
}

extension OnlineClassesApi on ApiClient {
  Future<OnlineClassList> fetchOnlineClasses(String studentId) async =>
      OnlineClassList.fromJson(
        await _getData(
          "/api/v1/parent/online-classes?studentId=${Uri.encodeQueryComponent(studentId)}",
        ),
      );

  /// Records the join and returns the link. 409 = window not open yet.
  Future<String> joinOnlineClass({
    required String sessionId,
    required String studentId,
  }) async {
    final res = await http.post(
      _uri("/api/v1/parent/online-classes/join"),
      headers: {...await _authHeaders(), "x-app-platform": "android"},
      body: jsonEncode({"sessionId": sessionId, "studentId": studentId}),
    );
    if (res.statusCode != 200) _throwFrom(res);
    final decoded = jsonDecode(res.body) as Map<String, dynamic>;
    return _s(Map<String, dynamic>.from(decoded["data"] as Map), "joinUrl");
  }

  Future<StaffOnlineClassListing> fetchStaffOnlineClasses({
    String range = "week",
  }) async => StaffOnlineClassListing.fromJson(
    await _getData("/api/v1/staff/online-classes?range=$range"),
  );

  Future<StaffOnlineClass> scheduleOnlineClass({
    required String classId,
    required String sectionId,
    required String subjectId,
    required String date,
    required String startTime,
    required String endTime,
    int? periodNo,
    required String provider,
    String joinUrl = "",
    String title = "",
    String note = "",
    bool announce = true,
  }) async {
    final data = await _postData("/api/v1/staff/online-classes", {
      "classId": classId,
      "sectionId": sectionId,
      "subjectId": subjectId,
      "date": date,
      "startTime": startTime,
      "endTime": endTime,
      "periodNo": periodNo,
      "provider": provider,
      "joinUrl": joinUrl,
      "title": title,
      "note": note,
      "announce": announce,
    });
    return StaffOnlineClass.fromJson(
      Map<String, dynamic>.from(data["session"] as Map),
    );
  }

  /// start | end | cancel | reopen
  Future<StaffOnlineClass> onlineClassAction(String id, String action) async {
    final res = await http.patch(
      _uri("/api/v1/staff/online-classes"),
      headers: await _authHeaders(),
      body: jsonEncode({"id": id, "action": action}),
    );
    if (res.statusCode != 200) _throwFrom(res);
    final decoded = jsonDecode(res.body) as Map<String, dynamic>;
    final data = Map<String, dynamic>.from(decoded["data"] as Map);
    return StaffOnlineClass.fromJson(
      Map<String, dynamic>.from(data["session"] as Map),
    );
  }

  Future<OnlineClassAttendance> fetchOnlineClassAttendance(String id) async =>
      OnlineClassAttendance.fromJson(
        await _getData("/api/v1/staff/online-classes/$id/attendance"),
      );

  Future<String> syncOnlineClassAttendance(String id) async {
    final data = await _postData("/api/v1/staff/online-classes/$id/attendance", {});
    final unmatched = ((data["unmatched"] as List?) ?? const []).join(", ");
    return "${_i(data, "participants")} in the room, ${_i(data, "matched")} matched"
        "${unmatched.isEmpty ? "" : " · not matched: $unmatched"}";
  }
}
