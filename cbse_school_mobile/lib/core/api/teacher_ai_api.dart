part of "api_client.dart";

// Teacher AI tools (13 Oct 2026) — the web ERP's AI helpers for teachers on
// the phone: answer-sheet marks, question paper, remedial worksheet, lesson
// plan, PTM brief. Every reply is a SUGGESTION: nothing here saves anything
// by itself, and what the teacher did with a draft is reported back to the
// ERP's ai_generations log (accepted / edited / rejected), as the web does.
//
// Answer-sheet marks and the outcome report call the web routes directly
// (/api/ai/answer-sheet-marks already checks the app session and the
// teacher's subject scope). The other tools go through
// /api/v1/staff/ai/<tool>, which read the chapters / facts on the server and
// call the same generators as the web.

double? _aiNum(Map<String, dynamic> j, String k) => (j[k] as num?)?.toDouble();

List<String> _aiStrings(Map<String, dynamic> j, String k) =>
    ((j[k] as List?) ?? const []).map((e) => e.toString()).toList();

/// A long AI call the screen can cancel. Pass one to a tool call and call
/// [cancel] from the "Stop" button: the request is dropped on the phone
/// (the server may still finish; its draft is simply never shown).
class AiCall {
  http.Client? _client;
  bool _cancelled = false;

  bool get cancelled => _cancelled;

  void cancel() {
    _cancelled = true;
    _client?.close();
  }
}

/// Thrown when the teacher pressed Stop. Screens ignore it quietly.
class AiCancelled implements Exception {
  const AiCancelled();
}

// ---------------------------------------------------------------- pickers

class AiTargetSubject {
  AiTargetSubject.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      name = _s(j, "name"),
      code = _s(j, "code");

  final String id;
  final String name;
  final String code;
}

class AiTargetClass {
  AiTargetClass.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      name = _s(j, "name"),
      subjects = _list(j, "subjects").map(AiTargetSubject.fromJson).toList();

  final String id;
  final String name;
  final List<AiTargetSubject> subjects;
}

class AiTopic {
  AiTopic.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      code = _s(j, "code"),
      title = _s(j, "title");

  final String id;
  final String code;
  final String title;

  String get label => code.isEmpty ? title : "$code · $title";
}

class AiChapter {
  AiChapter.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      code = _s(j, "code"),
      title = _s(j, "title"),
      plannedPeriods = _i(j, "plannedPeriods"),
      hasOutcomes = _b(j, "hasOutcomes"),
      topics = _list(j, "topics").map(AiTopic.fromJson).toList();

  final String id;
  final String code;
  final String title;
  final int plannedPeriods;
  final bool hasOutcomes;
  final List<AiTopic> topics;

  String get label => code.isEmpty ? title : "$code · $title";
}

class AiUnits {
  AiUnits.fromJson(Map<String, dynamic> j)
    : available = _b(j, "available"),
      chapters = _list(j, "chapters").map(AiChapter.fromJson).toList();

  /// false = the Teaching plan could not be read (or was never set up) —
  /// NOT "this subject has no chapters".
  final bool available;
  final List<AiChapter> chapters;
}

// ------------------------------------------------- question paper / worksheet

class AiSubQuestion {
  AiSubQuestion.fromJson(Map<String, dynamic> j)
    : text = _s(j, "text"),
      marks = _aiNum(j, "marks") ?? 0,
      options = _aiStrings(j, "options"),
      answerKey = _s(j, "answerKey");

  final String text;
  final double marks;
  final List<String> options;
  final String answerKey;
}

class AiPaperQuestion {
  AiPaperQuestion.fromJson(Map<String, dynamic> j)
    : type = _s(j, "type"),
      text = _s(j, "text"),
      marks = _aiNum(j, "marks") ?? 0,
      hardness = _s(j, "hardness"),
      options = _aiStrings(j, "options"),
      answerKey = _s(j, "answerKey"),
      markingScheme = _aiStrings(j, "markingScheme"),
      pairs = _list(
        j,
        "pairs",
      ).map((p) => (left: _s(p, "left"), right: _s(p, "right"))).toList(),
      attemptAny = _i(j, "attemptAny"),
      hasImages = _b(j, "hasImages"),
      subQuestions = _list(
        j,
        "subQuestions",
      ).map(AiSubQuestion.fromJson).toList();

  final String type;
  final String text;
  final double marks;
  final String hardness;
  final List<String> options;
  final String answerKey;
  final List<String> markingScheme;
  final List<({String left, String right})> pairs;
  final int attemptAny;

  /// The draft carries a picture the phone does not show.
  final bool hasImages;
  final List<AiSubQuestion> subQuestions;
}

class AiPaperSection {
  AiPaperSection.fromJson(Map<String, dynamic> j)
    : title = _s(j, "title"),
      instructions = _s(j, "instructions"),
      questions = _list(j, "questions").map(AiPaperQuestion.fromJson).toList();

  AiPaperSection.of(this.title, this.questions) : instructions = "";

  final String title;
  final String instructions;
  final List<AiPaperQuestion> questions;
}

String _aiMarks(double m) =>
    m == m.roundToDouble() ? m.toInt().toString() : m.toString();

const _aiLetters = "abcdefghijklmnopqrstuvwxyz";

/// A paper or worksheet as plain text, for copying into a document or a
/// WhatsApp message. [withAnswers] adds the key and marking steps (the
/// teacher's copy) — never on by default.
String aiPaperText({
  required String heading,
  required List<AiPaperSection> sections,
  bool withAnswers = false,
}) {
  final b = StringBuffer();
  if (heading.trim().isNotEmpty) b.writeln(heading.trim());
  var n = 0;
  for (final s in sections) {
    b.writeln();
    if (s.title.trim().isNotEmpty) b.writeln(s.title.trim());
    if (s.instructions.trim().isNotEmpty) b.writeln(s.instructions.trim());
    for (final q in s.questions) {
      n += 1;
      b.writeln();
      b.writeln("Q$n. ${q.text.trim()}  [${_aiMarks(q.marks)}]");
      if (q.attemptAny > 0) b.writeln("(Attempt any ${q.attemptAny})");
      for (var i = 0; i < q.options.length; i++) {
        b.writeln("   (${_aiLetters[i % 26]}) ${q.options[i]}");
      }
      for (final p in q.pairs) {
        b.writeln("   ${p.left}  —  ${p.right}");
      }
      for (var i = 0; i < q.subQuestions.length; i++) {
        final sq = q.subQuestions[i];
        b.writeln(
          "   (${_aiRoman(i + 1)}) ${sq.text}  [${_aiMarks(sq.marks)}]",
        );
        for (var k = 0; k < sq.options.length; k++) {
          b.writeln("        (${_aiLetters[k % 26]}) ${sq.options[k]}");
        }
        if (withAnswers && sq.answerKey.trim().isNotEmpty) {
          b.writeln("        Answer: ${sq.answerKey.trim()}");
        }
      }
      if (q.hasImages) b.writeln("   [picture — see the ERP]");
      if (withAnswers) {
        if (q.answerKey.trim().isNotEmpty) {
          b.writeln("   Answer: ${q.answerKey.trim()}");
        }
        for (final step in q.markingScheme) {
          if (step.trim().isNotEmpty) b.writeln("   • ${step.trim()}");
        }
      }
    }
  }
  return b.toString().trim();
}

String _aiRoman(int n) => const [
  "",
  "i",
  "ii",
  "iii",
  "iv",
  "v",
  "vi",
  "vii",
  "viii",
  "ix",
  "x",
  "xi",
  "xii",
][n.clamp(0, 12)];

class AiPaperDraft {
  AiPaperDraft.fromJson(Map<String, dynamic> j)
    : source = _s(j, "source"),
      engine = _s(j, "engine"),
      generationId = _s(j, "generationId"),
      explanation = _aiStrings(j, "explanation"),
      maxMarks = _i(j, "maxMarks"),
      sections = _list(j, "sections").map(AiPaperSection.fromJson).toList();

  /// "llm" = written by the AI; "local" = the built-in offline draft.
  final String source;
  final String engine;

  /// "" for the offline draft (nothing to report against).
  final String generationId;
  final List<String> explanation;
  final int maxMarks;
  final List<AiPaperSection> sections;

  bool get isOffline => source == "local";

  double get totalMarks => sections.fold(
    0,
    (t, s) => t + s.questions.fold<double>(0, (u, q) => u + q.marks),
  );
}

class AiWorksheet {
  AiWorksheet.fromJson(Map<String, dynamic> j)
    : engine = _s(j, "engine"),
      generationId = _s(j, "generationId"),
      questions = _list(j, "questions").map(AiPaperQuestion.fromJson).toList();

  final String engine;
  final String generationId;
  final List<AiPaperQuestion> questions;
}

// ---------------------------------------------------------------- lesson plan

class AiLessonPlanDraft {
  AiLessonPlanDraft.fromJson(Map<String, dynamic> j)
    : language = _s(j, "language"),
      engine = _s(j, "engine"),
      model = _s(j, "model"),
      generationId = _s(j, "generationId"),
      booksKind = _s(j, "booksKind"),
      agreedOutcomeUnits = _i(j, "agreedOutcomeUnits"),
      unitIds = _aiStrings(j, "unitIds"),
      title = _s(_aiDraftOf(j), "title"),
      objectives = _s(_aiDraftOf(j), "objectives"),
      teachingAids = _s(_aiDraftOf(j), "teachingAids"),
      activities = _s(_aiDraftOf(j), "activities"),
      assessment = _s(_aiDraftOf(j), "assessment"),
      homework = _s(_aiDraftOf(j), "homework");

  final String language;
  final String engine;
  final String model;
  final String generationId;

  /// "chapters" (the school's books), "outcomes" (pre-primary) or "none".
  final String booksKind;
  final int agreedOutcomeUnits;
  final List<String> unitIds;
  final String title;
  final String objectives;
  final String teachingAids;
  final String activities;
  final String assessment;
  final String homework;
}

Map<String, dynamic> _aiDraftOf(Map<String, dynamic> j) =>
    Map<String, dynamic>.from((j["draft"] as Map?) ?? const {});

// ---------------------------------------------------------------- PTM brief

class AiPtmBrief {
  AiPtmBrief.fromJson(Map<String, dynamic> j)
    : studentId = _s(j, "studentId"),
      studentName = _s(j, "studentName"),
      engine = _s(j, "engine"),
      model = _s(j, "model"),
      language = _s(j, "language"),
      requestedLanguage = _s(j, "requestedLanguage"),
      generationId = _s(j, "generationId"),
      observations = _s(_aiDraftOf(j), "observations"),
      concerns = _s(_aiDraftOf(j), "concerns"),
      suggestions = _s(_aiDraftOf(j), "suggestions"),
      warnings = _aiStrings(j, "warnings"),
      basisTerms = _aiStrings(
        Map<String, dynamic>.from((j["basis"] as Map?) ?? const {}),
        "terms",
      ),
      basisAttendance = _b(
        Map<String, dynamic>.from((j["basis"] as Map?) ?? const {}),
        "attendance",
      ),
      basisHomework = _b(
        Map<String, dynamic>.from((j["basis"] as Map?) ?? const {}),
        "homework",
      ),
      basisConduct = _b(
        Map<String, dynamic>.from((j["basis"] as Map?) ?? const {}),
        "conduct",
      ),
      basisEarlierNotes = _i(
        Map<String, dynamic>.from((j["basis"] as Map?) ?? const {}),
        "earlierNotes",
      );

  final String studentId;
  final String studentName;
  final String engine;
  final String model;
  final String language;
  final String requestedLanguage;
  final String generationId;
  final String observations;
  final String concerns;
  final String suggestions;
  final List<String> warnings;
  final List<String> basisTerms;
  final bool basisAttendance;
  final bool basisHomework;
  final bool basisConduct;
  final int basisEarlierNotes;

  /// What the brief could not see — said plainly, so a missing register is
  /// never read as "attendance is fine".
  List<String> get missing => [
    if (basisTerms.isEmpty) "exam results",
    if (!basisAttendance) "attendance",
    if (!basisHomework) "homework",
    if (!basisConduct) "conduct log",
  ];
}

// ---------------------------------------------------------------- answer sheet

class AnswerSheetSet {
  AnswerSheetSet.fromJson(Map<String, dynamic> j)
    : setCode = _s(j, "setCode"),
      label = _s(j, "label"),
      questionCount = _i(j, "questionCount"),
      keyedCount = _i(j, "keyedCount"),
      maxTotal = _aiNum(j, "maxTotal") ?? 0;

  final String setCode;
  final String label;
  final int questionCount;

  /// Questions with an answer key or marking scheme to mark against.
  final int keyedCount;
  final double maxTotal;
}

class AnswerSheetPaper {
  AnswerSheetPaper.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      paperCode = _s(j, "paperCode"),
      title = _s(j, "title"),
      examName = _s(j, "examName"),
      termMatch = _b(j, "termMatch"),
      activeSetCode = _s(j, "activeSetCode"),
      sets = _list(j, "sets").map(AnswerSheetSet.fromJson).toList();

  final String id;
  final String paperCode;
  final String title;
  final String examName;

  /// This paper was set for the exam being marked.
  final bool termMatch;
  final String activeSetCode;
  final List<AnswerSheetSet> sets;

  String get label =>
      [paperCode, title].where((s) => s.trim().isNotEmpty).join(" · ");
}

class AnswerSheetQuestion {
  AnswerSheetQuestion.fromJson(Map<String, dynamic> j)
    : questionId = _s(j, "questionId"),
      number = _i(j, "number"),
      maxMarks = _aiNum(j, "maxMarks") ?? 0,
      readAnswer = _s(j, "readAnswer"),
      suggestedMarks = _aiNum(j, "suggestedMarks"),
      confidence = _s(j, "confidence"),
      reason = _s(j, "reason"),
      needsTeacher = _b(j, "needsTeacher"),
      text = _s(j, "text"),
      type = _s(j, "type"),
      hasKey = _b(j, "hasKey");

  final String questionId;
  final int number;
  final double maxMarks;

  /// What the model read in the child's hand; "" = nothing read.
  final String readAnswer;

  /// null = no basis / unreadable: the teacher decides. Never a stand-in 0.
  final double? suggestedMarks;

  /// high | medium | low
  final String confidence;
  final String reason;
  final bool needsTeacher;
  final String text;
  final String type;
  final bool hasKey;

  /// What the review box starts with: blank whenever the teacher must decide.
  double? get shown => needsTeacher ? null : suggestedMarks;
}

class AnswerSheetReading {
  AnswerSheetReading.fromJson(Map<String, dynamic> j)
    : generationId = _s(j, "generationId"),
      paperId = _s(j, "paperId"),
      setCode = _s(j, "setCode"),
      maxTotal = _aiNum(j, "maxTotal") ?? 0,
      totalSuggested = _aiNum(j, "totalSuggested") ?? 0,
      unknownCount = _i(j, "unknownCount"),
      questions = _list(
        j,
        "questions",
      ).map(AnswerSheetQuestion.fromJson).toList();

  final String generationId;
  final String paperId;
  final String setCode;
  final double maxTotal;
  final double totalSuggested;
  final int unknownCount;
  final List<AnswerSheetQuestion> questions;
}

/// accepted when every box holds exactly what the AI suggested (a blank
/// suggestion counts as blank), else edited — the web's answerSheetOutcome.
String answerSheetOutcome(
  List<AnswerSheetQuestion> questions,
  Map<String, double?> finalMarks,
) {
  for (final q in questions) {
    if (q.shown != finalMarks[q.questionId]) return "edited";
  }
  return "accepted";
}

/// The review's sum, with what still blocks using it: [blanks] boxes left
/// empty and [over] boxes outside 0–max. Halves are kept, as on the web.
({double total, int blanks, int over}) answerSheetTotals(
  List<AnswerSheetQuestion> questions,
  Map<String, double?> marks,
) {
  var total = 0.0;
  var blanks = 0;
  var over = 0;
  for (final q in questions) {
    final m = marks[q.questionId];
    if (m == null) {
      blanks += 1;
    } else if (m < 0 || m > q.maxMarks) {
      over += 1;
    } else {
      total += m;
    }
  }
  return (total: (total * 2).round() / 2, blanks: blanks, over: over);
}

// ---------------------------------------------------------------- calls

extension TeacherAiApi on ApiClient {
  /// A POST that may take a minute or two (the model), cancellable through
  /// [call], and with a clear message instead of a spinner forever.
  Future<Map<String, dynamic>> _aiPost(
    String path,
    Map<String, dynamic> body, {
    AiCall? call,
    Duration timeout = const Duration(seconds: 150),
  }) async {
    final client = http.Client();
    call?._client = client;
    try {
      if (call?.cancelled == true) throw const AiCancelled();
      final res = await client
          .post(
            _uri(path),
            headers: await _authHeaders(),
            body: jsonEncode(body),
          )
          .timeout(timeout);
      if (call?.cancelled == true) throw const AiCancelled();
      if (res.statusCode != 200) _throwFrom(res);
      final decoded = jsonDecode(res.body) as Map<String, dynamic>;
      return Map<String, dynamic>.from((decoded["data"] as Map?) ?? const {});
    } on TimeoutException {
      throw ApiException(
        "The AI is taking too long — try again, or with fewer pages / chapters.",
        408,
        "timeout",
      );
    } on http.ClientException {
      if (call?.cancelled == true) throw const AiCancelled();
      rethrow;
    } finally {
      client.close();
    }
  }

  /// My classes with the subjects I may ask the AI tools about.
  Future<List<AiTargetClass>> fetchAiTargets() async {
    final data = await _getData("/api/v1/staff/ai/targets");
    return _list(data, "classes").map(AiTargetClass.fromJson).toList();
  }

  Future<AiUnits> fetchAiUnits({
    required String classId,
    required String subjectId,
  }) async => AiUnits.fromJson(
    await _getData(
      "/api/v1/staff/ai/units?classId=${Uri.encodeQueryComponent(classId)}"
      "&subjectId=${Uri.encodeQueryComponent(subjectId)}",
    ),
  );

  Future<AiPaperDraft> draftQuestionPaper({
    required String classId,
    required String subjectId,
    required List<String> unitIds,
    required int maxMarks,
    required String hardness,
    AiCall? call,
  }) async => AiPaperDraft.fromJson(
    await _aiPost("/api/v1/staff/ai/exam-paper", {
      "classId": classId,
      "subjectId": subjectId,
      "unitIds": unitIds,
      "maxMarks": maxMarks,
      "hardness": hardness,
    }, call: call),
  );

  Future<AiWorksheet> draftRemedialWorksheet({
    required String classId,
    required String subjectId,
    required List<String> unitIds,
    required List<String> weakAreas,
    required int count,
    required String hardness,
    AiCall? call,
  }) async => AiWorksheet.fromJson(
    await _aiPost("/api/v1/staff/ai/remedial-worksheet", {
      "classId": classId,
      "subjectId": subjectId,
      "unitIds": unitIds,
      "weakLabels": weakAreas,
      "count": count,
      "hardness": hardness,
    }, call: call),
  );

  Future<AiLessonPlanDraft> draftLessonPlanAi({
    required String classId,
    required String subjectId,
    required List<String> unitIds,
    required int periods,
    required String language,
    String teacherNote = "",
    Map<String, String> existing = const {},
    AiCall? call,
  }) async => AiLessonPlanDraft.fromJson(
    await _aiPost("/api/v1/staff/ai/lesson-plan", {
      "classId": classId,
      "subjectId": subjectId,
      "unitIds": unitIds,
      "periods": periods,
      "language": language,
      "teacherNote": teacherNote,
      "existing": existing,
    }, call: call),
  );

  Future<AiPtmBrief> draftPtmBrief({
    String bookingId = "",
    String studentId = "",
    String teacherNote = "",
    AiCall? call,
  }) async => AiPtmBrief.fromJson(
    await _aiPost("/api/v1/staff/ai/ptm-brief", {
      if (bookingId.isNotEmpty) "bookingId": bookingId,
      if (studentId.isNotEmpty) "studentId": studentId,
      "teacherNote": teacherNote,
    }, call: call),
  );

  /// The question papers this subject's answer sheets can be marked against
  /// (this exam's first). Teacher scope is checked by the server.
  Future<List<AnswerSheetPaper>> fetchAnswerSheetPapers({
    required String classId,
    required String sectionId,
    required String subjectCode,
    String termId = "",
  }) async {
    final q = [
      "classId=${Uri.encodeQueryComponent(classId)}",
      "sectionId=${Uri.encodeQueryComponent(sectionId)}",
      "subjectCode=${Uri.encodeQueryComponent(subjectCode)}",
      if (termId.isNotEmpty) "termId=${Uri.encodeQueryComponent(termId)}",
    ].join("&");
    final data = await _getData("/api/ai/answer-sheet-marks?$q");
    return _list(data, "papers").map(AnswerSheetPaper.fromJson).toList();
  }

  /// Read a child's answer sheet (JPEG pages, base64) → suggested marks per
  /// question. Saves nothing; the confirmed total goes through marks entry.
  Future<AnswerSheetReading> readAnswerSheet({
    required String paperId,
    required String setCode,
    required String studentId,
    required String classId,
    required String sectionId,
    required String subjectCode,
    required List<String> pagesBase64,
    AiCall? call,
  }) async => AnswerSheetReading.fromJson(
    await _aiPost(
      "/api/ai/answer-sheet-marks",
      {
        "paperId": paperId,
        "setCode": setCode,
        "studentId": studentId,
        "classId": classId,
        "sectionId": sectionId,
        "subjectCode": subjectCode,
        "pages": [
          for (final p in pagesBase64)
            {"imageBase64": p, "mimeType": "image/jpeg"},
        ],
      },
      call: call,
      // The route allows the pro vision model three minutes.
      timeout: const Duration(seconds: 200),
    ),
  );

  /// What the teacher did with an AI draft — a statistic, never a blocker:
  /// failures are swallowed, exactly like the web's reportAiOutcome.
  Future<void> reportAiOutcome({
    required List<String> ids,
    required String outcome,
    String targetType = "",
    String targetId = "",
  }) async {
    final clean = ids.where((x) => x.isNotEmpty).toList();
    if (clean.isEmpty) return;
    try {
      await _postData("/api/ai/generations/outcome", {
        "ids": clean,
        "outcome": outcome,
        "targetType": targetType,
        "targetId": targetId,
      });
    } catch (_) {
      /* statistic only */
    }
  }
}
