part of "api_client.dart";

// Staff-side models and calls added with the 2026-09 staff app audit —
// timetable, own leave and approvals, payslips, marks, PTM, parents' leave
// and complaints, document verification, discipline / health notes, and the
// "waiting for you" counts. One `part` so ApiClient's private helpers stay
// reachable without growing api_client.dart further.

String _s(Map<String, dynamic> j, String k) => (j[k] as String?) ?? "";
int _i(Map<String, dynamic> j, String k) => (j[k] as num?)?.toInt() ?? 0;
double _d(Map<String, dynamic> j, String k) => (j[k] as num?)?.toDouble() ?? 0;
bool _b(Map<String, dynamic> j, String k) => j[k] == true;
List<Map<String, dynamic>> _list(Map<String, dynamic> j, String k) =>
    ((j[k] as List?) ?? const [])
        .map((e) => Map<String, dynamic>.from(e as Map))
        .toList();

// ---------------------------------------------------------------- timetable

class TimetablePeriod {
  TimetablePeriod.fromJson(Map<String, dynamic> j)
    : periodNo = _i(j, "periodNo"),
      startTime = _s(j, "startTime"),
      endTime = _s(j, "endTime"),
      classId = _s(j, "classId"),
      sectionId = _s(j, "sectionId"),
      className = _s(j, "className"),
      sectionName = _s(j, "sectionName"),
      subjectName = _s(j, "subjectName");

  final int periodNo;
  final String startTime;
  final String endTime;
  final String classId;
  final String sectionId;
  final String className;
  final String sectionName;
  final String subjectName;
}

class TimetableDay {
  TimetableDay.fromJson(Map<String, dynamic> j)
    : weekday = _i(j, "weekday"),
      short = _s(j, "short"),
      label = _s(j, "label"),
      periods = _list(j, "periods").map(TimetablePeriod.fromJson).toList();

  final int weekday;
  final String short;
  final String label;
  final List<TimetablePeriod> periods;
}

class TimetableSubstitution {
  TimetableSubstitution.fromJson(Map<String, dynamic> j)
    : date = _s(j, "date"),
      periodNo = _i(j, "periodNo"),
      startTime = _s(j, "startTime"),
      className = _s(j, "className"),
      sectionName = _s(j, "sectionName"),
      subjectName = _s(j, "subjectName"),
      role = _s(j, "role"),
      otherTeacherName = _s(j, "otherTeacherName"),
      note = _s(j, "note");

  final String date;
  final int periodNo;
  final String startTime;
  final String className;
  final String sectionName;
  final String subjectName;

  /// substitute = I cover this period; absent = someone covers mine.
  final String role;
  final String otherTeacherName;
  final String note;
}

class StaffTimetable {
  StaffTimetable.fromJson(Map<String, dynamic> j)
    : published = _b(j, "published"),
      todayWeekday = _i(j, "todayWeekday"),
      periodCount = _i(j, "periodCount"),
      days = _list(j, "days").map(TimetableDay.fromJson).toList(),
      substitutions = _list(
        j,
        "substitutions",
      ).map(TimetableSubstitution.fromJson).toList();

  final bool published;
  final int todayWeekday;
  final int periodCount;
  final List<TimetableDay> days;
  final List<TimetableSubstitution> substitutions;
}

// -------------------------------------------------------------- staff leave

class LeaveBalanceInfo {
  LeaveBalanceInfo.fromJson(Map<String, dynamic> j)
    : typeCode = _s(j, "typeCode"),
      typeName = _s(j, "typeName"),
      paid = _b(j, "paid"),
      allotted = _d(j, "allotted"),
      used = _d(j, "used"),
      remaining = _d(j, "remaining"),
      unlimited = _b(j, "unlimited"),
      maxDaysPerRequest = _d(j, "maxDaysPerRequest");

  final String typeCode;
  final String typeName;
  final bool paid;
  final double allotted;
  final double used;
  final double remaining;
  final bool unlimited;
  final double maxDaysPerRequest;
}

class StaffLeaveRequest {
  StaffLeaveRequest.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      staffId = _s(j, "staffId"),
      staffName = _s(j, "staffName"),
      designation = _s(j, "designation"),
      typeCode = _s(j, "typeCode"),
      typeName = _s(j, "typeName"),
      fromDate = _s(j, "fromDate"),
      toDate = _s(j, "toDate"),
      days = _d(j, "days"),
      halfDay = _b(j, "halfDay"),
      reason = _s(j, "reason"),
      status = _s(j, "status"),
      statusLabel = _s(j, "statusLabel"),
      appliedAt = _s(j, "appliedAt"),
      decidedBy = _s(j, "decidedBy"),
      decidedAt = _s(j, "decidedAt"),
      decisionNote = _s(j, "decisionNote"),
      remaining = (j["remaining"] as num?)?.toDouble(),
      unlimited = _b(j, "unlimited");

  final String id;
  final String staffId;
  final String staffName;
  final String designation;
  final String typeCode;
  final String typeName;
  final String fromDate;
  final String toDate;
  final double days;
  final bool halfDay;
  final String reason;

  /// pending | pending_l2 | approved | rejected
  final String status;
  final String statusLabel;
  final String appliedAt;
  final String decidedBy;
  final String decidedAt;
  final String decisionNote;
  final double? remaining;
  final bool unlimited;

  bool get isPending => status == "pending" || status == "pending_l2";
}

class StaffLeaveInfo {
  StaffLeaveInfo.fromJson(Map<String, dynamic> j)
    : autoApprove = _b(j, "autoApprove"),
      balances = _list(j, "balances").map(LeaveBalanceInfo.fromJson).toList(),
      requests = _list(j, "requests").map(StaffLeaveRequest.fromJson).toList();

  final bool autoApprove;
  final List<LeaveBalanceInfo> balances;
  final List<StaffLeaveRequest> requests;
}

// ----------------------------------------------------------------- payslips

class PayslipLine {
  PayslipLine.fromJson(Map<String, dynamic> j)
    : name = _s(j, "name"),
      amount = _d(j, "amount");

  final String name;
  final double amount;
}

class Payslip {
  Payslip.fromJson(Map<String, dynamic> j)
    : runId = _s(j, "runId"),
      month = _s(j, "month"),
      status = _s(j, "status"),
      dayCount = _i(j, "dayCount"),
      daysPresent = _d(j, "daysPresent"),
      daysAbsent = _d(j, "daysAbsent"),
      daysHalf = _d(j, "daysHalf"),
      daysLeavePaid = _d(j, "daysLeavePaid"),
      daysLwp = _d(j, "daysLwp"),
      daysHoliday = _d(j, "daysHoliday"),
      gross = _d(j, "gross"),
      totalDeductions = _d(j, "totalDeductions"),
      netPay = _d(j, "netPay"),
      amountPayable = _d(j, "amountPayable"),
      onHold = _b(j, "onHold"),
      holdNote = _s(j, "holdNote"),
      paymentDate = _s(j, "paymentDate"),
      paymentModeLabel = _s(j, "paymentModeLabel"),
      paidAt = _s(j, "paidAt"),
      bonus = _d(j, "bonus"),
      earnings = _list(j, "earnings").map(PayslipLine.fromJson).toList(),
      deductions = _list(j, "deductions").map(PayslipLine.fromJson).toList();

  final String runId;

  /// YYYY-MM
  final String month;

  /// approved | posted | paid
  final String status;
  final int dayCount;
  final double daysPresent;
  final double daysAbsent;
  final double daysHalf;
  final double daysLeavePaid;
  final double daysLwp;
  final double daysHoliday;
  final double gross;
  final double totalDeductions;
  final double netPay;
  final double amountPayable;
  final bool onHold;
  final String holdNote;
  final String paymentDate;
  final String paymentModeLabel;
  final String paidAt;
  final double bonus;
  final List<PayslipLine> earnings;
  final List<PayslipLine> deductions;
}

class PayslipList {
  PayslipList.fromJson(Map<String, dynamic> j)
    : preparing = _i(j, "preparing"),
      slips = _list(j, "slips").map(Payslip.fromJson).toList();

  final int preparing;
  final List<Payslip> slips;
}

// -------------------------------------------------------------------- exams

class ExamTermInfo {
  ExamTermInfo.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      code = _s(j, "code"),
      label = _s(j, "label"),
      maxMarks = _i(j, "maxMarks"),
      startsOn = _s(j, "startsOn"),
      endsOn = _s(j, "endsOn"),
      sheetCount = _i(j, "sheetCount");

  final String id;
  final String code;
  final String label;
  final int maxMarks;
  final String startsOn;
  final String endsOn;
  final int sheetCount;
}

class ExamSubjectInfo {
  ExamSubjectInfo.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      code = _s(j, "code"),
      name = _s(j, "name"),
      maxMarks = _i(j, "maxMarks");

  final String id;
  final String code;
  final String name;
  final int maxMarks;
}

class StudentMark {
  StudentMark.fromJson(Map<String, dynamic> j)
    : subjectId = _s(j, "subjectId"),
      marksObtained = (j["marksObtained"] as num?)?.toDouble(),
      grade = _s(j, "grade");

  final String subjectId;
  double? marksObtained;
  String grade;
}

class MarkSheetStudent {
  MarkSheetStudent.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      fullName = _s(j, "fullName"),
      rollNo = _s(j, "rollNo"),
      marks = _list(j, "marks").map(StudentMark.fromJson).toList();

  final String id;
  final String fullName;
  final String rollNo;
  final List<StudentMark> marks;

  StudentMark? markFor(String subjectId) {
    for (final m in marks) {
      if (m.subjectId == subjectId) return m;
    }
    return null;
  }
}

class MarkSheetInfo {
  MarkSheetInfo.fromJson(Map<String, dynamic> j)
    : termLabel = _s(
        Map<String, dynamic>.from((j["term"] as Map?) ?? {}),
        "label",
      ),
      locked = _b(j, "locked"),
      updatedAt = _s(j, "updatedAt"),
      enteredBy = _s(j, "enteredBy"),
      passPercent = _i(j, "passPercent"),
      subjects = _list(j, "subjects").map(ExamSubjectInfo.fromJson).toList(),
      students = _list(j, "students").map(MarkSheetStudent.fromJson).toList();

  final String termLabel;
  final bool locked;
  final String updatedAt;
  final String enteredBy;
  final int passPercent;
  final List<ExamSubjectInfo> subjects;
  final List<MarkSheetStudent> students;
}

class DateSheetRow {
  DateSheetRow.fromJson(Map<String, dynamic> j)
    : termLabel = _s(j, "termLabel"),
      date = _s(j, "date"),
      startTime = _s(j, "startTime"),
      durationMinutes = _i(j, "durationMinutes"),
      className = _s(j, "className"),
      subjectName = _s(j, "subjectName"),
      note = _s(j, "note");

  final String termLabel;
  final String date;
  final String startTime;
  final int durationMinutes;
  final String className;
  final String subjectName;
  final String note;
}

// ---------------------------------------------------------------------- ptm

class PtmTeacherBooking {
  PtmTeacherBooking.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      status = _s(j, "status"),
      studentId = _s(j, "studentId"),
      studentName = _s(j, "studentName"),
      classLabel = _s(j, "classLabel"),
      parentName = _s(j, "parentName"),
      mobile = _s(j, "mobile"),
      feedback = j["feedback"] is Map
          ? Map<String, dynamic>.from(j["feedback"] as Map)
          : null;

  final String id;

  /// booked | completed | no_show
  final String status;
  final String studentId;
  final String studentName;
  final String classLabel;
  final String parentName;
  final String mobile;
  final Map<String, dynamic>? feedback;
}

class PtmTeacherSlot {
  PtmTeacherSlot.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      teacherName = _s(j, "teacherName"),
      isMine = _b(j, "isMine"),
      startAt = _s(j, "startAt"),
      endAt = _s(j, "endAt"),
      roomOrLink = _s(j, "roomOrLink"),
      capacity = _i(j, "capacity"),
      bookings = _list(j, "bookings").map(PtmTeacherBooking.fromJson).toList();

  final String id;
  final String teacherName;
  final bool isMine;
  final String startAt;
  final String endAt;
  final String roomOrLink;
  final int capacity;
  final List<PtmTeacherBooking> bookings;
}

class PtmTeacherEvent {
  PtmTeacherEvent.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      name = _s(j, "name"),
      date = _s(j, "date"),
      modeLabel = _s(j, "modeLabel"),
      note = _s(j, "note"),
      bookingCount = _i(j, "bookingCount"),
      slots = _list(j, "slots").map(PtmTeacherSlot.fromJson).toList();

  final String id;
  final String name;
  final String date;
  final String modeLabel;
  final String note;
  final int bookingCount;
  final List<PtmTeacherSlot> slots;
}

// ------------------------------------------------------- parents' leave queue

class StudentLeaveQueueItem {
  StudentLeaveQueueItem.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      studentId = _s(j, "studentId"),
      studentName = _s(j, "studentName"),
      classLabel = _s(j, "classLabel"),
      fromDate = _s(j, "fromDate"),
      toDate = _s(j, "toDate"),
      days = _i(j, "days"),
      leaveTypeLabel = _s(j, "leaveTypeLabel"),
      reason = _s(j, "reason"),
      status = _s(j, "status"),
      requestedBy = _s(j, "requestedBy"),
      createdAt = _s(j, "createdAt"),
      decidedBy = _s(j, "decidedBy"),
      decisionNote = _s(j, "decisionNote"),
      approverHint = _s(j, "approverHint"),
      canDecide = _b(j, "canDecide");

  final String id;
  final String studentId;
  final String studentName;
  final String classLabel;
  final String fromDate;
  final String toDate;
  final int days;
  final String leaveTypeLabel;
  final String reason;
  final String status;
  final String requestedBy;
  final String createdAt;
  final String decidedBy;
  final String decisionNote;
  final String approverHint;
  final bool canDecide;
}

// ----------------------------------------------------------------- complaints

class StaffComplaint {
  StaffComplaint.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      studentName = _s(j, "studentName"),
      classLabel = _s(j, "classLabel"),
      raisedByName = _s(j, "raisedByName"),
      raisedByMobile = _s(j, "raisedByMobile"),
      categoryLabel = _s(j, "categoryLabel"),
      subject = _s(j, "subject"),
      description = _s(j, "description"),
      date = _s(j, "date"),
      status = _s(j, "status"),
      statusLabel = _s(j, "statusLabel"),
      sourceLabel = _s(j, "sourceLabel"),
      assignedToName = _s(j, "assignedToName"),
      assignedToMe = _b(j, "assignedToMe"),
      resolutionNote = _s(j, "resolutionNote"),
      createdAt = _s(j, "createdAt");

  final String id;
  final String studentName;
  final String classLabel;
  final String raisedByName;
  final String raisedByMobile;
  final String categoryLabel;
  final String subject;
  final String description;
  final String date;

  /// open | assigned | in_progress | resolved | closed
  final String status;
  final String statusLabel;
  final String sourceLabel;
  final String assignedToName;
  final bool assignedToMe;
  final String resolutionNote;
  final String createdAt;

  bool get isOpen =>
      status == "open" || status == "assigned" || status == "in_progress";
}

class StaffComplaintList {
  StaffComplaintList.fromJson(Map<String, dynamic> j)
    : unrestricted = _b(j, "unrestricted"),
      tickets = _list(j, "tickets").map(StaffComplaint.fromJson).toList();

  final bool unrestricted;
  final List<StaffComplaint> tickets;
}

// ------------------------------------------------------------------ documents

class DocReviewItem {
  DocReviewItem.fromJson(Map<String, dynamic> j)
    : studentId = _s(j, "studentId"),
      studentName = _s(j, "studentName"),
      classLabel = _s(j, "classLabel"),
      key = _s(j, "key"),
      label = _s(j, "label"),
      status = _s(j, "status"),
      fileUrl = _s(j, "fileUrl"),
      mimeType = _s(j, "mimeType"),
      submittedBy = _s(j, "submittedBy"),
      submittedAt = _s(j, "submittedAt"),
      reviewedBy = _s(j, "reviewedBy"),
      reviewNote = _s(j, "reviewNote");

  final String studentId;
  final String studentName;
  final String classLabel;
  final String key;
  final String label;
  final String status;
  final String fileUrl;
  final String mimeType;
  final String submittedBy;
  final String submittedAt;
  final String reviewedBy;
  final String reviewNote;
}

// ------------------------------------------------------- discipline & health

class CatalogItem {
  CatalogItem.fromJson(Map<String, dynamic> j)
    : value = _s(j, "value"),
      label = _s(j, "label");

  final String value;
  final String label;
}

class DisciplineIncidentInfo {
  DisciplineIncidentInfo.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      studentName = _s(j, "studentName"),
      date = _s(j, "date"),
      categoryLabel = _s(j, "categoryLabel"),
      pointsDelta = _i(j, "pointsDelta"),
      description = _s(j, "description"),
      reportedBy = _s(j, "reportedBy"),
      escalationLabel = _s(j, "escalationLabel"),
      status = _s(j, "status");

  final String id;
  final String studentName;
  final String date;
  final String categoryLabel;
  final int pointsDelta;
  final String description;
  final String reportedBy;
  final String escalationLabel;
  final String status;
}

class DisciplineList {
  DisciplineList.fromJson(Map<String, dynamic> j)
    : categories = _list(j, "categories").map(CatalogItem.fromJson).toList(),
      levels = _list(j, "levels").map(CatalogItem.fromJson).toList(),
      incidents = _list(
        j,
        "incidents",
      ).map(DisciplineIncidentInfo.fromJson).toList();

  final List<CatalogItem> categories;
  final List<CatalogItem> levels;
  final List<DisciplineIncidentInfo> incidents;
}

class HealthVisitInfo {
  HealthVisitInfo.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      studentName = _s(j, "studentName"),
      date = _s(j, "date"),
      time = _s(j, "time"),
      reasonLabel = _s(j, "reasonLabel"),
      symptoms = _s(j, "symptoms"),
      actionTaken = _s(j, "actionTaken"),
      referredToHospital = _b(j, "referredToHospital"),
      reportedBy = _s(j, "reportedBy");

  final String id;
  final String studentName;
  final String date;
  final String time;
  final String reasonLabel;
  final String symptoms;
  final String actionTaken;
  final bool referredToHospital;
  final String reportedBy;
}

class HealthList {
  HealthList.fromJson(Map<String, dynamic> j)
    : reasons = _list(j, "reasons").map(CatalogItem.fromJson).toList(),
      visits = _list(j, "visits").map(HealthVisitInfo.fromJson).toList();

  final List<CatalogItem> reasons;
  final List<HealthVisitInfo> visits;
}

// --------------------------------------------------------------------- roster

class StaffRosterRow {
  StaffRosterRow.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      empCode = _s(j, "empCode"),
      fullName = _s(j, "fullName"),
      designation = _s(j, "designation"),
      mobile = _s(j, "mobile"),
      hasMobile = _b(j, "hasMobile"),
      homeKind = _s(j, "homeKind");

  final String id;
  final String empCode;
  final String fullName;
  final String designation;
  final String mobile;
  final bool hasMobile;
  final String homeKind;
}

class StaffRoster {
  StaffRoster.fromJson(Map<String, dynamic> j)
    : total = _i(j, "total"),
      missingMobile = _i(j, "missingMobile"),
      staff = _list(j, "staff").map(StaffRosterRow.fromJson).toList();

  final int total;
  final int missingMobile;
  final List<StaffRosterRow> staff;
}

// ---------------------------------------------------------------- features

/// Which screens the ERP says this person may open. Empty while loading —
/// callers should show nothing rather than guess.
class StaffFeatureSet {
  StaffFeatureSet.fromJson(Map<String, dynamic> j)
    : homeKind = _s(j, "homeKind"),
      fullName = _s(j, "fullName"),
      features = ((j["features"] as List?) ?? const [])
          .map((e) => e.toString())
          .toSet();

  const StaffFeatureSet.empty()
    : homeKind = "",
      fullName = "",
      features = const {};

  final String homeKind;
  final String fullName;
  final Set<String> features;

  bool has(String id) => features.contains(id);
}

// -------------------------------------------------------------------- fees

class CounterDue {
  CounterDue.fromJson(Map<String, dynamic> j)
    : dueKey = _s(j, "dueKey"),
      kind = _s(j, "kind"),
      label = _s(j, "label"),
      dueOn = _s(j, "dueOn"),
      balancePaise = _i(j, "balancePaise"),
      balanceLabel = _s(j, "balanceLabel");

  final String dueKey;
  final String kind;
  final String label;
  final String dueOn;
  final int balancePaise;
  final String balanceLabel;
}

class FeeStudentHit {
  FeeStudentHit.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      fullName = _s(j, "fullName"),
      admissionNo = _s(j, "admissionNo"),
      classLabel = _s(j, "classLabel"),
      guardianName = _s(j, "guardianName"),
      mobile = _s(j, "mobile"),
      openLabel = _s(j, "openLabel"),
      openPaise = _i(j, "openPaise"),
      dueCount = _i(j, "dueCount");

  final String id;
  final String fullName;
  final String admissionNo;
  final String classLabel;
  final String guardianName;
  final String mobile;
  final String openLabel;
  final int openPaise;
  final int dueCount;
}

class FeeChild {
  FeeChild.fromJson(Map<String, dynamic> j)
    : studentId = _s(j, "studentId"),
      fullName = _s(j, "fullName"),
      classLabel = _s(j, "classLabel"),
      admissionNo = _s(j, "admissionNo"),
      isPrimary = _b(j, "isPrimary"),
      openLabel = _s(j, "openLabel"),
      openPaise = _i(j, "openPaise"),
      dues = _list(j, "dues").map(CounterDue.fromJson).toList();

  final String studentId;
  final String fullName;
  final String classLabel;
  final String admissionNo;
  final bool isPrimary;
  final String openLabel;
  final int openPaise;
  final List<CounterDue> dues;
}

class TenderModeInfo {
  TenderModeInfo.fromJson(Map<String, dynamic> j)
    : value = _s(j, "value"),
      label = _s(j, "label"),
      refLabel = _s(j, "refLabel"),
      needsRef = _b(j, "needsRef"),
      needsInstrumentDate = _b(j, "needsInstrumentDate");

  final String value;
  final String label;
  final String refLabel;
  final bool needsRef;
  final bool needsInstrumentDate;
}

class FeeCounter {
  FeeCounter.fromJson(Map<String, dynamic> j)
    : householdId = _s(j, "householdId"),
      guardianName = _s(j, "guardianName"),
      mobile = _s(j, "mobile"),
      collectionDate = _s(j, "collectionDate"),
      totalLabel = _s(j, "totalLabel"),
      children = _list(j, "children").map(FeeChild.fromJson).toList(),
      tenderModes = _list(
        j,
        "tenderModes",
      ).map(TenderModeInfo.fromJson).toList();

  final String householdId;
  final String guardianName;
  final String mobile;
  final String collectionDate;
  final String totalLabel;
  final List<FeeChild> children;
  final List<TenderModeInfo> tenderModes;
}

class FeeReceipt {
  FeeReceipt.fromJson(Map<String, dynamic> j)
    : duplicate = _b(j, "duplicate"),
      voucherId = _s(j, "voucherId"),
      receiptNo = _s(j, "receiptNo"),
      collectionDate = _s(j, "collectionDate"),
      totalLabel = _s(j, "totalLabel"),
      guardianName = _s(j, "guardianName"),
      lines = _list(j, "lines")
          .map(
            (l) => (
              label: _s(l, "label"),
              studentName: _s(l, "studentName"),
              amountLabel: _s(l, "amountLabel"),
            ),
          )
          .toList();

  final bool duplicate;
  final String voucherId;
  final String receiptNo;
  final String collectionDate;
  final String totalLabel;
  final String guardianName;
  final List<({String label, String studentName, String amountLabel})> lines;
}

class CollectionRow {
  CollectionRow.fromJson(Map<String, dynamic> j)
    : voucherId = _s(j, "voucherId"),
      receiptNo = _s(j, "receiptNo"),
      guardianName = _s(j, "guardianName"),
      studentNames = _s(j, "studentNames"),
      totalLabel = _s(j, "totalLabel"),
      collectedAt = _s(j, "collectedAt"),
      cashierName = _s(j, "cashierName"),
      modes = ((j["modes"] as List?) ?? const [])
          .map((e) => e.toString())
          .toList();

  final String voucherId;
  final String receiptNo;
  final String guardianName;
  final String studentNames;
  final String totalLabel;
  final String collectedAt;
  final String cashierName;
  final List<String> modes;
}

class DayCollections {
  DayCollections.fromJson(Map<String, dynamic> j)
    : date = _s(j, "date"),
      count = _i(j, "count"),
      totalLabel = _s(j, "totalLabel"),
      byMode = _list(
        j,
        "byMode",
      ).map((m) => (mode: _s(m, "mode"), label: _s(m, "label"))).toList(),
      receipts = _list(j, "receipts").map(CollectionRow.fromJson).toList();

  final String date;
  final int count;
  final String totalLabel;
  final List<({String mode, String label})> byMode;
  final List<CollectionRow> receipts;
}

class FeeDefaulterChild {
  FeeDefaulterChild.fromJson(Map<String, dynamic> j)
    : studentId = _s(j, "studentId"),
      fullName = _s(j, "fullName"),
      classLabel = _s(j, "classLabel"),
      openLabel = _s(j, "openLabel"),
      overdueDays = _i(j, "overdueDays"),
      promisedOn = _s(j, "promisedOn"),
      promiseNote = _s(j, "promiseNote");

  final String studentId;
  final String fullName;
  final String classLabel;
  final String openLabel;
  final int overdueDays;
  final String promisedOn;
  final String promiseNote;
}

class FeeDefaulterHousehold {
  FeeDefaulterHousehold.fromJson(Map<String, dynamic> j)
    : guardianName = _s(j, "guardianName"),
      mobile = _s(j, "mobile"),
      openLabel = _s(j, "openLabel"),
      overdueDays = _i(j, "overdueDays"),
      children = _list(j, "children").map(FeeDefaulterChild.fromJson).toList();

  final String guardianName;
  final String mobile;
  final String openLabel;
  final int overdueDays;
  final List<FeeDefaulterChild> children;
}

class FeeDefaulterList {
  FeeDefaulterList.fromJson(Map<String, dynamic> j)
    : householdCount = _i(j, "householdCount"),
      totalOpenLabel = _s(j, "totalOpenLabel"),
      households = _list(
        j,
        "households",
      ).map(FeeDefaulterHousehold.fromJson).toList();

  final int householdCount;
  final String totalOpenLabel;
  final List<FeeDefaulterHousehold> households;
}

// -------------------------------------------------------------- admissions

class AdmissionLeadRow {
  AdmissionLeadRow.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      enquiryNo = _s(j, "enquiryNo"),
      childName = _s(j, "childName"),
      guardianName = _s(j, "guardianName"),
      mobile = _s(j, "mobile"),
      whatsapp = _s(j, "whatsapp"),
      stageLabel = _s(j, "stageLabel"),
      classSought = _s(j, "classSought"),
      locality = _s(j, "locality"),
      assignedTo = _s(j, "assignedTo"),
      mine = _b(j, "mine"),
      nextFollowUpAt = _s(j, "nextFollowUpAt"),
      bucket = _s(j, "bucket"),
      lastOutcome = _s(j, "lastOutcome"),
      lastChannel = _s(j, "lastChannel"),
      lastNote = _s(j, "lastNote"),
      followUpCount = _i(j, "followUpCount");

  final String id;
  final String enquiryNo;
  final String childName;
  final String guardianName;
  final String mobile;
  final String whatsapp;
  final String stageLabel;
  final String classSought;
  final String locality;
  final String assignedTo;
  final bool mine;
  final String nextFollowUpAt;

  /// overdue | today | later | none
  final String bucket;
  final String lastOutcome;
  final String lastChannel;
  final String lastNote;
  final int followUpCount;
}

class AdmissionLeadList {
  AdmissionLeadList.fromJson(Map<String, dynamic> j)
    : overdue = _i(
        Map<String, dynamic>.from((j["counts"] as Map?) ?? {}),
        "overdue",
      ),
      dueToday = _i(
        Map<String, dynamic>.from((j["counts"] as Map?) ?? {}),
        "today",
      ),
      leads = _list(j, "leads").map(AdmissionLeadRow.fromJson).toList();

  final int overdue;
  final int dueToday;
  final List<AdmissionLeadRow> leads;
}

// ------------------------------------------------------------------ survey

class SurveyBeat {
  SurveyBeat.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      code = _s(j, "code"),
      name = _s(j, "name"),
      area = _s(j, "area"),
      targetHouseholds = _i(j, "targetHouseholds"),
      captured = _i(j, "captured");

  final String id;
  final String code;
  final String name;
  final String area;
  final int targetHouseholds;
  final int captured;
}

class SurveySetup {
  SurveySetup.fromJson(Map<String, dynamic> j)
    : capturedTodayByMe = _i(j, "capturedTodayByMe"),
      beats = _list(j, "beats").map(SurveyBeat.fromJson).toList(),
      classes = _list(
        j,
        "classes",
      ).map((c) => (id: _s(c, "id"), name: _s(c, "name"))).toList();

  final int capturedTodayByMe;
  final List<SurveyBeat> beats;
  final List<({String id, String name})> classes;
}

// -------------------------------------------------------------------- gate

class GateVisitor {
  GateVisitor.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      visitorNo = _s(j, "visitorNo"),
      visitorName = _s(j, "visitorName"),
      mobile = _s(j, "mobile"),
      purpose = _s(j, "purpose"),
      purposeLabel = _s(j, "purposeLabel"),
      personToMeet = _s(j, "personToMeet"),
      linkedTo = _s(j, "linkedTo"),
      source = _s(j, "source"),
      idProofNote = _s(j, "idProofNote"),
      inTime = _s(j, "inTime"),
      outTime = _s(j, "outTime"),
      onCampus = _b(j, "onCampus"),
      createdBy = _s(j, "createdBy");

  final String id;
  final String visitorNo;
  final String visitorName;
  final String mobile;
  final String purpose;
  final String purposeLabel;
  final String personToMeet;
  final String linkedTo;
  final String source;
  final String idProofNote;
  final String inTime;
  final String outTime;
  final bool onCampus;
  final String createdBy;
}

class GatePassRow {
  GatePassRow.fromJson(Map<String, dynamic> j)
    : id = _s(j, "id"),
      studentId = _s(j, "studentId"),
      studentName = _s(j, "studentName"),
      classLabel = _s(j, "classLabel"),
      date = _s(j, "date"),
      requestedPickupTime = _s(j, "requestedPickupTime"),
      reason = _s(j, "reason"),
      status = _s(j, "status"),
      statusLabel = _s(j, "statusLabel"),
      requestedBy = _s(j, "requestedBy"),
      pickedUpByName = _s(j, "pickedUpByName"),
      actualPickupTime = _s(j, "actualPickupTime"),
      releasable = _b(j, "releasable");

  final String id;
  final String studentId;
  final String studentName;
  final String classLabel;
  final String date;
  final String requestedPickupTime;
  final String reason;
  final String status;
  final String statusLabel;
  final String requestedBy;
  final String pickedUpByName;
  final String actualPickupTime;
  final bool releasable;
}

class GateBoard {
  GateBoard.fromJson(Map<String, dynamic> j)
    : date = _s(j, "date"),
      canRelease = _b(j, "canRelease"),
      onCampus = _list(j, "onCampus").map(GateVisitor.fromJson).toList(),
      departedToday = _list(
        j,
        "departedToday",
      ).map(GateVisitor.fromJson).toList(),
      gatePasses = _list(j, "gatePasses").map(GatePassRow.fromJson).toList(),
      purposes = _list(
        j,
        "purposes",
      ).map((p) => (value: _s(p, "value"), label: _s(p, "label"))).toList();

  final String date;
  final bool canRelease;
  final List<GateVisitor> onCampus;
  final List<GateVisitor> departedToday;
  final List<GatePassRow> gatePasses;
  final List<({String value, String label})> purposes;
}

/// What the school already knows about this mobile number, so the guard
/// writes "father of Aarav, IV-A" instead of whatever was said at the gate.
class GateLookup {
  GateLookup.fromJson(Map<String, dynamic> j)
    : mobile = _s(j, "mobile"),
      suggestedName = _s(j, "suggestedName"),
      linkedTo = _s(j, "linkedTo"),
      parentOf = _list(j, "parentOf")
          .map(
            (p) => (
              studentName: _s(p, "studentName"),
              classLabel: _s(p, "classLabel"),
              admissionNo: _s(p, "admissionNo"),
            ),
          )
          .toList(),
      leads = _list(j, "leads")
          .map(
            (l) => (
              childName: _s(l, "childName"),
              classSought: _s(l, "classSought"),
              stage: _s(l, "stage"),
            ),
          )
          .toList(),
      openVisit = j["openVisit"] is Map<String, dynamic>
          ? GateVisitor.fromJson(j["openVisit"] as Map<String, dynamic>)
          : null;

  final String mobile;
  final String suggestedName;
  final String linkedTo;
  final List<({String studentName, String classLabel, String admissionNo})>
  parentOf;
  final List<({String childName, String classSought, String stage})> leads;

  /// Set when this number is already on campus — the app offers Check out
  /// rather than opening a second visit.
  final GateVisitor? openVisit;
}

// ------------------------------------------------------------------ approvals

class StaffApprovals {
  StaffApprovals.fromJson(Map<String, dynamic> j)
    : kind = _s(j, "kind"),
      unrestricted = _b(j, "unrestricted"),
      staffLeavePending = _i(j, "staffLeavePending"),
      studentLeavePending = _i(j, "studentLeavePending"),
      complaintsOpen = _i(j, "complaintsOpen"),
      documentsPending = _i(j, "documentsPending"),
      total = _i(j, "total");

  final String kind;
  final bool unrestricted;
  final int staffLeavePending;
  final int studentLeavePending;
  final int complaintsOpen;
  final int documentsPending;
  final int total;
}

// ---------------------------------------------------------------------- calls

extension StaffApi on ApiClient {
  Future<StaffTimetable> fetchStaffTimetable() async =>
      StaffTimetable.fromJson(await _getData("/api/v1/staff/timetable"));

  Future<StaffLeaveInfo> fetchMyLeave() async =>
      StaffLeaveInfo.fromJson(await _getData("/api/v1/staff/leave"));

  Future<StaffLeaveRequest> applyStaffLeave({
    required String typeCode,
    required String fromDate,
    required String toDate,
    required bool halfDay,
    required String reason,
  }) async => StaffLeaveRequest.fromJson(
    await _postData("/api/v1/staff/leave/apply", {
      "typeCode": typeCode,
      "fromDate": fromDate,
      "toDate": toDate,
      "halfDay": halfDay,
      "reason": reason,
    }),
  );

  Future<void> withdrawStaffLeave(String id) async {
    await _postData("/api/v1/staff/leave/withdraw", {"id": id});
  }

  Future<List<StaffLeaveRequest>> fetchLeaveApprovals({
    String status = "pending",
  }) async {
    final data = await _getData("/api/v1/staff/leave/approvals?status=$status");
    return _list(data, "requests").map(StaffLeaveRequest.fromJson).toList();
  }

  Future<StaffLeaveRequest> decideStaffLeave({
    required String id,
    required bool approve,
    String note = "",
  }) async => StaffLeaveRequest.fromJson(
    await _postData("/api/v1/staff/leave/decide", {
      "id": id,
      "approve": approve,
      "note": note,
    }),
  );

  Future<PayslipList> fetchPayslips() async =>
      PayslipList.fromJson(await _getData("/api/v1/staff/payslips"));

  Future<List<ExamTermInfo>> fetchExamTerms() async {
    final data = await _getData("/api/v1/staff/exams/terms");
    return _list(data, "terms").map(ExamTermInfo.fromJson).toList();
  }

  Future<MarkSheetInfo> fetchMarkSheet({
    required String termId,
    required String classId,
    required String sectionId,
  }) async => MarkSheetInfo.fromJson(
    await _getData(
      "/api/v1/staff/exams/sheet?termId=$termId&classId=$classId&sectionId=$sectionId",
    ),
  );

  /// Returns the saved marks with their computed grades.
  Future<List<StudentMark>> saveMarks({
    required String termId,
    required String classId,
    required String sectionId,
    required String subjectId,
    required List<({String studentId, double? marks})> marks,
  }) async {
    final data = await _postData("/api/v1/staff/exams/marks", {
      "termId": termId,
      "classId": classId,
      "sectionId": sectionId,
      "subjectId": subjectId,
      "marks": [
        for (final m in marks)
          {"studentId": m.studentId, "marksObtained": m.marks},
      ],
    });
    return _list(
      data,
      "marks",
    ).map((m) => StudentMark.fromJson({...m, "subjectId": subjectId})).toList();
  }

  Future<List<DateSheetRow>> fetchDateSheet({String termId = ""}) async {
    final data = await _getData(
      "/api/v1/staff/exams/datesheet${termId.isEmpty ? "" : "?termId=$termId"}",
    );
    return _list(data, "rows").map(DateSheetRow.fromJson).toList();
  }

  Future<List<PtmTeacherEvent>> fetchTeacherPtm() async {
    final data = await _getData("/api/v1/staff/ptm");
    return _list(data, "events").map(PtmTeacherEvent.fromJson).toList();
  }

  Future<void> updatePtmBooking({
    required String bookingId,
    required String status,
    Map<String, String>? feedback,
  }) async {
    await _postData("/api/v1/staff/ptm/booking", {
      "bookingId": bookingId,
      "status": status,
      "feedback": ?feedback,
    });
  }

  Future<List<StudentLeaveQueueItem>> fetchStudentLeaveQueue({
    String status = "pending",
  }) async {
    final data = await _getData("/api/v1/staff/student-leave?status=$status");
    return _list(data, "requests").map(StudentLeaveQueueItem.fromJson).toList();
  }

  Future<void> decideStudentLeave({
    required String id,
    required bool approve,
    String note = "",
  }) async {
    await _postData("/api/v1/staff/student-leave/decide", {
      "id": id,
      "approve": approve,
      "note": note,
    });
  }

  Future<StaffComplaintList> fetchStaffComplaints({
    String status = "open",
  }) async => StaffComplaintList.fromJson(
    await _getData("/api/v1/staff/complaints?status=$status"),
  );

  Future<void> updateComplaint({
    required String id,
    String status = "",
    String resolutionNote = "",
    bool takeUp = false,
  }) async {
    await _postData("/api/v1/staff/complaints/update", {
      "id": id,
      if (status.isNotEmpty) "status": status,
      if (resolutionNote.isNotEmpty) "resolutionNote": resolutionNote,
      if (takeUp) "takeUp": true,
    });
  }

  Future<List<DocReviewItem>> fetchDocumentQueue({
    String status = "pending",
  }) async {
    final data = await _getData("/api/v1/staff/documents?status=$status");
    return _list(data, "rows").map(DocReviewItem.fromJson).toList();
  }

  Future<void> reviewDocument({
    required String studentId,
    required String key,
    required String verdict,
    String note = "",
  }) async {
    await _postData("/api/v1/staff/documents/review", {
      "studentId": studentId,
      "key": key,
      "verdict": verdict,
      "note": note,
    });
  }

  Future<DisciplineList> fetchDiscipline({
    String classId = "",
    String sectionId = "",
    String studentId = "",
  }) async => DisciplineList.fromJson(
    await _getData(
      "/api/v1/staff/discipline?classId=$classId&sectionId=$sectionId&studentId=$studentId",
    ),
  );

  Future<String> recordIncident({
    required String studentId,
    required String date,
    required String category,
    required int pointsDelta,
    required String description,
    String escalationLevel = "",
    bool notifyParent = false,
  }) async {
    final data = await _postData("/api/v1/staff/discipline", {
      "studentId": studentId,
      "date": date,
      "category": category,
      "pointsDelta": pointsDelta,
      "description": description,
      if (escalationLevel.isNotEmpty) "escalationLevel": escalationLevel,
      "notifyParent": notifyParent,
    });
    return _s(data, "escalationLabel");
  }

  Future<HealthList> fetchHealthVisits({
    String classId = "",
    String sectionId = "",
    String studentId = "",
  }) async => HealthList.fromJson(
    await _getData(
      "/api/v1/staff/health?classId=$classId&sectionId=$sectionId&studentId=$studentId",
    ),
  );

  Future<bool> recordHealthVisit({
    required String studentId,
    required String reason,
    required String symptoms,
    String actionTaken = "",
    bool referredToHospital = false,
    bool notifyParent = false,
  }) async {
    final data = await _postData("/api/v1/staff/health", {
      "studentId": studentId,
      "reason": reason,
      "symptoms": symptoms,
      "actionTaken": actionTaken,
      "referredToHospital": referredToHospital,
      "notifyParent": notifyParent,
    });
    return _b(data, "parentNotified");
  }

  Future<StaffApprovals> fetchApprovals() async =>
      StaffApprovals.fromJson(await _getData("/api/v1/staff/approvals"));

  Future<StaffRoster> fetchStaffRoster() async =>
      StaffRoster.fromJson(await _getData("/api/v1/staff/roster"));

  Future<void> setStaffMobile({
    required String staffId,
    required String mobile,
  }) async {
    await _postData("/api/v1/staff/roster/mobile", {
      "staffId": staffId,
      "mobile": mobile,
    });
  }

  // ---- features, fees, leads, survey ------------------------------------

  Future<StaffFeatureSet> fetchStaffFeatures() async =>
      StaffFeatureSet.fromJson(await _getData("/api/v1/staff/features"));

  Future<List<FeeStudentHit>> searchFeeStudents(String q) async {
    final data = await _getData(
      "/api/v1/staff/fees/search?q=${Uri.encodeQueryComponent(q)}",
    );
    return _list(data, "students").map(FeeStudentHit.fromJson).toList();
  }

  Future<FeeCounter> fetchFeeCounter(String studentId) async =>
      FeeCounter.fromJson(
        await _getData("/api/v1/staff/fees/dues?studentId=$studentId"),
      );

  /// [lines] is (studentId, dueKey, paise); [tenders] is (mode, paise, ref).
  /// [clientRef] must be stable across retries — the server returns the first
  /// receipt instead of charging twice.
  Future<FeeReceipt> collectFee({
    required String studentId,
    required String clientRef,
    required List<({String studentId, String dueKey, int paise})> lines,
    required List<({String mode, int paise, String ref})> tenders,
    String note = "",
  }) async => FeeReceipt.fromJson(
    await _postData("/api/v1/staff/fees/collect", {
      "studentId": studentId,
      "clientRef": clientRef,
      "note": note,
      "lines": [
        for (final l in lines)
          {
            "studentId": l.studentId,
            "dueKey": l.dueKey,
            "amountPaise": l.paise,
          },
      ],
      "tenders": [
        for (final t in tenders)
          {"mode": t.mode, "amountPaise": t.paise, "ref": t.ref},
      ],
    }),
  );

  Future<DayCollections> fetchMyCollections({String date = ""}) async =>
      DayCollections.fromJson(
        await _getData(
          "/api/v1/staff/fees/collections${date.isEmpty ? "" : "?date=$date"}",
        ),
      );

  Future<FeeDefaulterList> fetchFeeDefaulters({
    String q = "",
    int minRupees = 0,
  }) async => FeeDefaulterList.fromJson(
    await _getData(
      "/api/v1/staff/fees/defaulters?q=${Uri.encodeQueryComponent(q)}&min=$minRupees",
    ),
  );

  Future<void> logFeeFollowup({
    required String studentId,
    required String channel,
    required String outcome,
    String note = "",
    String promisedOn = "",
  }) async {
    await _postData("/api/v1/staff/fees/followup", {
      "studentId": studentId,
      "channel": channel,
      "outcome": outcome,
      "note": note,
      "promisedOn": promisedOn,
    });
  }

  Future<AdmissionLeadList> fetchAdmissionLeads({
    String filter = "due",
    String q = "",
  }) async => AdmissionLeadList.fromJson(
    await _getData(
      "/api/v1/staff/admissions/leads?filter=$filter&q=${Uri.encodeQueryComponent(q)}",
    ),
  );

  Future<void> logLeadFollowup({
    required String leadId,
    required String channel,
    required String outcome,
    String note = "",
    String nextFollowUpAt = "",
  }) async {
    await _postData("/api/v1/staff/admissions/followup", {
      "leadId": leadId,
      "channel": channel,
      "outcome": outcome,
      "note": note,
      "nextFollowUpAt": nextFollowUpAt,
    });
  }

  Future<SurveySetup> fetchSurveySetup() async =>
      SurveySetup.fromJson(await _getData("/api/v1/staff/survey/beats"));

  /// Returns the new lead's enquiry number.
  Future<String> captureSurvey({
    required String beatId,
    required String childName,
    required String guardianName,
    required String mobile,
    required String clientRef,
    String classSoughtId = "",
    int ageYearsApprox = 0,
    String gender = "",
    String locality = "",
    String address = "",
    String previousSchool = "",
    String note = "",
  }) async {
    final data = await _postData("/api/v1/staff/survey/capture", {
      "beatId": beatId,
      "childName": childName,
      "guardianName": guardianName,
      "mobile": mobile,
      "clientRef": clientRef,
      "classSoughtId": classSoughtId,
      "ageYearsApprox": ageYearsApprox,
      "gender": gender,
      "locality": locality,
      "address": address,
      "previousSchool": previousSchool,
      "note": note,
      "parentConsent": true,
    });
    return _s(data, "enquiryNo");
  }

  // ------------------------------------------------------------------ gate

  Future<GateBoard> fetchGateBoard({String date = ""}) async =>
      GateBoard.fromJson(
        await _getData(
          "/api/v1/staff/visitors${date.isEmpty ? "" : "?date=$date"}",
        ),
      );

  Future<GateLookup> lookupGateVisitor(String mobile) async =>
      GateLookup.fromJson(
        await _getData("/api/v1/staff/visitors/lookup?mobile=$mobile"),
      );

  /// Returns (visitor, alreadyIn). `alreadyIn` means this mobile was already
  /// on campus and the OPEN visit came back — not a second check-in.
  Future<(GateVisitor, bool)> gateCheckIn({
    required String visitorName,
    required String mobile,
    required String purpose,
    String personToMeet = "",
    String idProofNote = "",
    String linkedTo = "",
  }) async {
    final data = await _postData("/api/v1/staff/visitors/checkin", {
      "visitorName": visitorName,
      "mobile": mobile,
      "purpose": purpose,
      "personToMeet": personToMeet,
      "idProofNote": idProofNote,
      "linkedTo": linkedTo,
    });
    return (
      GateVisitor.fromJson(data["visitor"] as Map<String, dynamic>),
      _b(data, "alreadyIn"),
    );
  }

  /// Returns (visitor, alreadyOut) — an already-closed visit keeps its
  /// original out-time rather than being re-stamped to now.
  Future<(GateVisitor, bool)> gateCheckOut(String id) async {
    final data = await _postData("/api/v1/staff/visitors/checkout", {"id": id});
    return (
      GateVisitor.fromJson(data["visitor"] as Map<String, dynamic>),
      _b(data, "alreadyOut"),
    );
  }

  Future<void> releaseGatePass({
    required String id,
    required String pickedUpByName,
  }) async {
    await _postData("/api/v1/staff/visitors/gate-pass", {
      "id": id,
      "pickedUpByName": pickedUpByName,
    });
  }

  /// A file behind the ERP's authenticated proxy (student documents),
  /// fetched with the session cookie — the phone's browser has none.
  Future<(Uint8List, String)> fetchFileBytes(String path) async {
    final res = await http.get(
      path.startsWith("http") ? Uri.parse(path) : _uri(path),
      headers: await _authHeaders(),
    );
    if (res.statusCode != 200) _throwFrom(res);
    return (res.bodyBytes, res.headers["content-type"] ?? "");
  }
}
