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
      minutes = _i(j, "minutes"),
      registerStatus = _s(j, "registerStatus"),
      proposedStatus = _s(j, "proposedStatus");
  final String studentId;
  final String fullName;
  final String rollNo;
  final bool joined;
  final String source;
  final int minutes;

  /// What the register already says for this date ('' when unmarked).
  final String registerStatus;

  /// P / A proposal for "Mark register from this class".
  final String proposedStatus;
}

class OnlineClassRegisterInfo {
  OnlineClassRegisterInfo.fromJson(Map<String, dynamic> j)
    : markedBy = _s(j, "markedBy"),
      present = _i(j, "present"),
      count = _i(j, "count");
  final String markedBy;
  final int present;
  final int count;
}

class OnlineClassAttendance {
  OnlineClassAttendance.fromJson(Map<String, dynamic> j)
    : date = _s(j, "date"),
      total = _i(j, "total"),
      joined = _i(j, "joined"),
      canSync = _b(j, "canSync"),
      canMarkRegister = _b(j, "canMarkRegister"),
      register = j["register"] is Map
          ? OnlineClassRegisterInfo.fromJson(
              Map<String, dynamic>.from(j["register"] as Map),
            )
          : null,
      rows = _list(j, "rows").map(OnlineClassAttendanceRow.fromJson).toList();
  final String date;
  final int total;
  final int joined;
  final bool canSync;
  final bool canMarkRegister;
  final OnlineClassRegisterInfo? register;
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

  /// Write the section's register for the class's date. Returns a one-line
  /// summary ("22 present of 30 · 8 absent alerts sent").
  Future<String> markRegisterFromOnlineClass(
    String id, {
    required Map<String, String> marks,
    String remark = "",
  }) async {
    final data = await _postData("/api/v1/staff/online-classes/$id/mark-register", {
      "marks": [
        for (final e in marks.entries) {"studentId": e.key, "status": e.value},
      ],
      "remark": remark,
    });
    final alerts = _i(data, "absentAlerts");
    return "${_i(data, "present")} present of ${_i(data, "markCount")}"
        "${alerts > 0 ? " · $alerts absent alerts sent" : ""}";
  }

  Future<String> syncOnlineClassAttendance(String id) async {
    final data = await _postData("/api/v1/staff/online-classes/$id/attendance", {});
    final unmatched = ((data["unmatched"] as List?) ?? const []).join(", ");
    return "${_i(data, "participants")} in the room, ${_i(data, "matched")} matched"
        "${unmatched.isEmpty ? "" : " · not matched: $unmatched"}";
  }
}

// ---------------------------------------------------------------- Q&A

class ParentClassQuestion {
  ParentClassQuestion.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      orderNo = _i(j, "orderNo"),
      text = _s(j, "text"),
      askedAt = _s(j, "askedAt"),
      closed = _b(j, "closed"),
      answerId = j["answer"] is Map ? _s(Map<String, dynamic>.from(j["answer"] as Map), "id") : "",
      answerPhotoUrl = j["answer"] is Map ? _s(Map<String, dynamic>.from(j["answer"] as Map), "photoUrl") : "",
      verdict = j["answer"] is Map ? _s(Map<String, dynamic>.from(j["answer"] as Map), "verdict") : "";
  final String id;
  final int orderNo;
  final String text;
  final String askedAt;
  final bool closed;
  final String answerId;
  final String answerPhotoUrl;

  /// '' (not checked yet) | right | wrong | partial
  final String verdict;
  bool get answered => answerId.isNotEmpty;
}

class WallAnswer {
  WallAnswer.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      studentId = _s(j, "studentId"),
      fullName = _s(j, "fullName"),
      rollNo = _s(j, "rollNo"),
      submittedAt = _s(j, "submittedAt"),
      text = _s(j, "text"),
      verdict = _s(j, "verdict"),
      photoUrl = _s(j, "photoUrl");
  final String id;
  final String studentId;
  final String fullName;
  final String rollNo;
  final String submittedAt;
  final String text;
  String verdict;
  final String photoUrl;
}

class WallQuestion {
  WallQuestion.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      orderNo = _i(j, "orderNo"),
      text = _s(j, "text"),
      closed = _s(j, "closedAt").isNotEmpty,
      answered = _i(Map<String, dynamic>.from((j["tally"] as Map?) ?? const {}), "answered"),
      right = _i(Map<String, dynamic>.from((j["tally"] as Map?) ?? const {}), "right"),
      wrong = _i(Map<String, dynamic>.from((j["tally"] as Map?) ?? const {}), "wrong"),
      unchecked = _i(Map<String, dynamic>.from((j["tally"] as Map?) ?? const {}), "unchecked"),
      answers = _list(j, "answers").map(WallAnswer.fromJson).toList(),
      notAnswered = _list(j, "notAnswered").map((n) => _s(n, "fullName")).toList();
  final String id;
  final int orderNo;
  final String text;
  final bool closed;
  final int answered;
  final int right;
  final int wrong;
  final int unchecked;
  final List<WallAnswer> answers;
  final List<String> notAnswered;
}

class AnswerWall {
  AnswerWall.fromJson(Map<String, dynamic> j)
    : status = _s(j, "status"),
      rosterCount = _i(j, "rosterCount"),
      questions = _list(j, "questions").map(WallQuestion.fromJson).toList();
  final String status;
  final int rosterCount;
  final List<WallQuestion> questions;
}

class ClassSummaryInfo {
  ClassSummaryInfo.fromJson(Map<String, dynamic> j)
    : taughtNote = _s(j, "taughtNote"),
      topic = _s(j, "topic"),
      summaryEn = _s(j, "summaryEn"),
      homeworkTitle = _s(j, "homeworkTitle"),
      homeworkBody = _s(j, "homeworkBody"),
      homeworkDue = _s(j, "homeworkDue"),
      generatedAt = _s(j, "generatedAt"),
      homeworkPostId = _s(j, "homeworkPostId");
  final String taughtNote;
  final String topic;
  final String summaryEn;
  final String homeworkTitle;
  final String homeworkBody;
  final String homeworkDue;
  final String generatedAt;
  final String homeworkPostId;
  bool get posted => homeworkPostId.isNotEmpty;
}

extension OnlineClassQaApi on ApiClient {
  Future<List<ParentClassQuestion>> fetchOnlineClassQuestions({
    required String sessionId,
    required String studentId,
  }) async {
    final d = await _getData(
      "/api/v1/parent/online-classes/questions?sessionId=${Uri.encodeQueryComponent(sessionId)}&studentId=${Uri.encodeQueryComponent(studentId)}",
    );
    return _list(d, "questions").map(ParentClassQuestion.fromJson).toList();
  }

  Future<void> submitOnlineClassAnswer({
    required String sessionId,
    required String questionId,
    required String studentId,
    required String filePath,
    required String mimeType,
  }) async {
    final req = http.MultipartRequest("POST", _uri("/api/v1/parent/online-classes/answer"));
    final headers = await _authHeaders();
    headers.remove("Content-Type");
    req.headers.addAll(headers);
    req.fields["sessionId"] = sessionId;
    req.fields["questionId"] = questionId;
    req.fields["studentId"] = studentId;
    req.files.add(
      await http.MultipartFile.fromPath(
        "file",
        filePath,
        filename: "answer.jpg",
        contentType: MediaType.parse(mimeType),
      ),
    );
    final res = await http.Response.fromStream(await req.send());
    if (res.statusCode != 200) _throwFrom(res);
  }

  Future<AnswerWall> fetchOnlineClassWall(String sessionId) async =>
      AnswerWall.fromJson(await _getData("/api/v1/staff/online-classes/$sessionId/questions"));

  Future<int> askOnlineClassQuestion(String sessionId, String text) async {
    final d = await _postData("/api/v1/staff/online-classes/$sessionId/questions", {"text": text});
    return _i(d, "pushed");
  }

  Future<void> _patchQa(String sessionId, Map<String, dynamic> body) async {
    final res = await http.patch(
      _uri("/api/v1/staff/online-classes/$sessionId/questions"),
      headers: await _authHeaders(),
      body: jsonEncode(body),
    );
    if (res.statusCode != 200) _throwFrom(res);
  }

  Future<void> markOnlineClassAnswer(String sessionId, String answerId, String verdict) =>
      _patchQa(sessionId, {"answerId": answerId, "verdict": verdict});

  Future<void> closeOnlineClassQuestion(String sessionId, String questionId, bool closed) =>
      _patchQa(sessionId, {"questionId": questionId, "closed": closed});

  Future<({ClassSummaryInfo? summary, bool canPost})> fetchOnlineClassSummary(String sessionId) async {
    final d = await _getData("/api/v1/staff/online-classes/$sessionId/summary");
    return (
      summary: d["summary"] is Map
          ? ClassSummaryInfo.fromJson(Map<String, dynamic>.from(d["summary"] as Map))
          : null,
      canPost: _b(d, "canPostHomework"),
    );
  }

  Future<ClassSummaryInfo> generateOnlineClassSummary(String sessionId, String taughtNote) async {
    final d = await _postData("/api/v1/staff/online-classes/$sessionId/summary", {"taughtNote": taughtNote});
    return ClassSummaryInfo.fromJson(Map<String, dynamic>.from(d["summary"] as Map));
  }

  Future<ClassSummaryInfo> _patchSummary(String sessionId, Map<String, dynamic> body) async {
    final res = await http.patch(
      _uri("/api/v1/staff/online-classes/$sessionId/summary"),
      headers: await _authHeaders(),
      body: jsonEncode(body),
    );
    if (res.statusCode != 200) _throwFrom(res);
    final decoded = jsonDecode(res.body) as Map<String, dynamic>;
    final d = Map<String, dynamic>.from(decoded["data"] as Map);
    return ClassSummaryInfo.fromJson(Map<String, dynamic>.from(d["summary"] as Map));
  }

  Future<ClassSummaryInfo> saveOnlineClassSummary(String sessionId, Map<String, String> patch) =>
      _patchSummary(sessionId, {"patch": patch});

  Future<ClassSummaryInfo> postOnlineClassHomework(String sessionId) =>
      _patchSummary(sessionId, {"post": true});
}
