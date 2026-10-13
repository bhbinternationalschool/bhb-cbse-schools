part of "api_client.dart";

// Results and date sheet for the parent app. Mirrors /api/v1/parent/results
// and /api/v1/parent/datesheet: the household comes from the session, and
// the server lists ONLY exams the school released to parents. A total, a
// percentage, a rank or a remark is present only when the school's printed
// report card shows it — null here means "the card does not show it", and
// the screen leaves it out rather than inventing one.

double? _rnum(Map<String, dynamic> j, String k) => (j[k] as num?)?.toDouble();
int? _rint(Map<String, dynamic> j, String k) => (j[k] as num?)?.toInt();
String? _rstr(Map<String, dynamic> j, String k) {
  final v = j[k];
  return v is String && v.isNotEmpty ? v : null;
}

Map<String, dynamic>? _robj(Map<String, dynamic> j, String k) {
  final v = j[k];
  return v is Map ? Map<String, dynamic>.from(v) : null;
}

/// 72 → "72", 72.5 → "72.5", null → "—".
String resultNumber(num? v) {
  if (v == null) return "—";
  if (v == v.roundToDouble()) return v.toInt().toString();
  return v.toStringAsFixed(1);
}

// ---------------------------------------------------------------- results

class ParentResultPart {
  ParentResultPart.fromJson(Map<String, dynamic> j)
    : label = _s(j, "label"),
      maxMarks = _rnum(j, "maxMarks"),
      obtained = _rnum(j, "obtained");

  final String label;
  final double? maxMarks;
  final double? obtained;
}

class ParentGradedPart {
  ParentGradedPart.fromJson(Map<String, dynamic> j)
    : label = _s(j, "label"),
      grade = _rstr(j, "grade");

  final String label;

  /// null = not entered yet (never a fail).
  final String? grade;
}

class ParentSubjectResult {
  ParentSubjectResult.fromJson(Map<String, dynamic> j)
    : name = _s(j, "name"),
      maxMarks = _rnum(j, "maxMarks"),
      obtained = _rnum(j, "obtained"),
      grade = _s(j, "grade"),
      gradeLabel = _s(j, "gradeLabel"),
      absent = _b(j, "absent"),
      remark = _s(j, "remark"),
      parts = _list(j, "parts").map(ParentResultPart.fromJson).toList(),
      gradedParts = _list(
        j,
        "gradedParts",
      ).map(ParentGradedPart.fromJson).toList();

  final String name;
  final double? maxMarks;
  final double? obtained;
  final String grade;
  final String gradeLabel;
  final bool absent;
  final String remark;
  final List<ParentResultPart> parts;
  final List<ParentGradedPart> gradedParts;

  /// "56/80", "AB", or "—/80" when a mark is missing.
  String get marksText =>
      absent ? "AB" : "${resultNumber(obtained)}/${resultNumber(maxMarks)}";
}

class ParentCoScholastic {
  ParentCoScholastic.fromJson(Map<String, dynamic> j)
    : label = _s(j, "label"),
      rating = _rstr(j, "rating"),
      ratingLabel = _s(j, "ratingLabel");

  final String label;
  final String? rating;
  final String ratingLabel;
}

class ParentReportCard {
  ParentReportCard.fromJson(Map<String, dynamic> j)
    : title = _s(j, "title"),
      termLabel = _s(j, "termLabel"),
      aggregateMode = _s(j, "aggregateMode"),
      gradesOnly = _b(j, "gradesOnly"),
      descriptors = _b(j, "descriptors"),
      subjects = _list(
        j,
        "subjects",
      ).map(ParentSubjectResult.fromJson).toList(),
      totalObtained = _rnum(_robj(j, "totals") ?? const {}, "obtained"),
      totalMax = _rnum(_robj(j, "totals") ?? const {}, "max"),
      percent = _rnum(j, "percent"),
      overallGrade = _rstr(j, "overallGrade"),
      rank = _rint(j, "rank"),
      classSize = _rint(j, "classSize"),
      classAverage = _rnum(j, "classAverage"),
      result = _rstr(j, "result"),
      presentDays = _rint(_robj(j, "attendance") ?? const {}, "presentDays"),
      workingDays = _rint(_robj(j, "attendance") ?? const {}, "workingDays"),
      attendancePercent = _rnum(_robj(j, "attendance") ?? const {}, "percent"),
      coScholastic = _list(
        j,
        "coScholastic",
      ).map(ParentCoScholastic.fromJson).toList(),
      remarkText = _s(_robj(j, "remark") ?? const {}, "text"),
      remarkTextHi = _s(_robj(j, "remark") ?? const {}, "textHi"),
      absent = _robj(j, "absent") != null,
      absentReason = _s(_robj(j, "absent") ?? const {}, "reason"),
      absentSubjects = ((j["absentSubjects"] as List?) ?? const [])
          .whereType<String>()
          .toList();

  final String title;
  final String termLabel;

  /// "none", or "hy" / "final" for a weighted aggregate of several exams.
  final String aggregateMode;

  /// The card shows grades only — no marks column, no totals.
  final bool gradesOnly;

  /// The grade column is a description ("Meets expectations").
  final bool descriptors;
  final List<ParentSubjectResult> subjects;

  /// Present only when the card prints totals.
  final double? totalObtained;
  final double? totalMax;
  final double? percent;
  final String? overallGrade;
  final int? rank;
  final int? classSize;
  final double? classAverage;
  final String? result;
  final int? presentDays;
  final int? workingDays;
  final double? attendancePercent;
  final List<ParentCoScholastic> coScholastic;
  final String remarkText;
  final String remarkTextHi;

  /// Absent from every paper of this exam.
  final bool absent;
  final String absentReason;
  final List<String> absentSubjects;

  bool get hasTotals => totalObtained != null && totalMax != null;
  bool get hasAttendance => presentDays != null && workingDays != null;
  bool get hasRemark => remarkText.isNotEmpty || remarkTextHi.isNotEmpty;

  /// The remark in the language on screen, falling back to the other one.
  String remarkFor(String languageCode) {
    if (languageCode == "hi" && remarkTextHi.isNotEmpty) return remarkTextHi;
    return remarkText.isNotEmpty ? remarkText : remarkTextHi;
  }
}

class ParentTermResult {
  ParentTermResult.fromJson(Map<String, dynamic> j)
    : termId = _s(j, "termId"),
      termCode = _s(j, "termCode"),
      termLabel = _s(j, "termLabel"),
      academicYearCode = _s(j, "academicYearCode"),
      releasedAt = _s(j, "releasedAt"),
      status = _s(j, "status"),
      message = _s(j, "message"),
      card = _robj(j, "card") == null
          ? null
          : ParentReportCard.fromJson(_robj(j, "card")!);

  final String termId;
  final String termCode;
  final String termLabel;
  final String academicYearCode;
  final String releasedAt;

  /// ready | no_marks | held | unavailable
  final String status;
  final String message;
  final ParentReportCard? card;

  bool get isReady => status == "ready" && card != null;
}

class ParentChildResults {
  ParentChildResults.fromJson(Map<String, dynamic> j)
    : studentId = _s(j, "studentId"),
      fullName = _s(j, "fullName"),
      classLabel = _s(j, "classLabel"),
      terms = _list(j, "terms").map(ParentTermResult.fromJson).toList();

  final String studentId;
  final String fullName;
  final String classLabel;

  /// Released exams, oldest first.
  final List<ParentTermResult> terms;
}

class ParentResults {
  ParentResults.fromJson(Map<String, dynamic> j)
    : releasedTermCount = _i(j, "releasedTermCount"),
      children = _list(j, "children").map(ParentChildResults.fromJson).toList();

  final int releasedTermCount;
  final List<ParentChildResults> children;

  /// This child's released exams; empty (never someone else's) when absent.
  List<ParentTermResult> termsFor(String studentId) {
    for (final c in children) {
      if (c.studentId == studentId) return c.terms;
    }
    return const [];
  }
}

// ---------------------------------------------------------------- date sheet

class ParentExamPaper {
  ParentExamPaper.fromJson(Map<String, dynamic> j)
    : date = _s(j, "date"),
      startTime = _s(j, "startTime"),
      durationMinutes = _i(j, "durationMinutes"),
      subjectName = _s(j, "subjectName"),
      note = _s(j, "note");

  final String date;
  final String startTime;
  final int durationMinutes;
  final String subjectName;
  final String note;
}

class ParentDateSheetExam {
  ParentDateSheetExam.fromJson(Map<String, dynamic> j)
    : termId = _s(j, "termId"),
      termLabel = _s(j, "termLabel"),
      papers = _list(j, "rows").map(ParentExamPaper.fromJson).toList();

  final String termId;
  final String termLabel;
  final List<ParentExamPaper> papers;
}

class ParentDateSheet {
  ParentDateSheet.fromJson(Map<String, dynamic> j)
    : publishedTermCount = _i(j, "publishedTermCount"),
      today = _s(j, "today"),
      _byChild = {
        for (final c in _list(j, "children"))
          _s(c, "studentId"): _list(
            c,
            "exams",
          ).map(ParentDateSheetExam.fromJson).toList(),
      };

  final int publishedTermCount;
  final String today;
  final Map<String, List<ParentDateSheetExam>> _byChild;

  /// Upcoming published exams for this child; empty when none.
  List<ParentDateSheetExam> examsFor(String studentId) =>
      _byChild[studentId] ?? const [];
}

extension ResultsApi on ApiClient {
  Future<ParentResults> fetchParentResults() async =>
      ParentResults.fromJson(await _getData("/api/v1/parent/results"));

  Future<ParentDateSheet> fetchParentDateSheet() async =>
      ParentDateSheet.fromJson(await _getData("/api/v1/parent/datesheet"));
}
