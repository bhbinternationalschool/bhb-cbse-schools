import "dart:convert";

import "package:flutter_secure_storage/flutter_secure_storage.dart";
import "package:http/http.dart" as http;
import "package:http_parser/http_parser.dart";

import "../config/app_config.dart";

/// Session cookie minted by the ERP (see web /api/auth/*).
const _cookieName = "bhb_demo_session";
const _cookieKey = "bhb_session_cookie";
const _guardianKey = "bhb_guardian_name";
const _personaKey = "bhb_persona";
const _roleKey = "bhb_role_code";

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
    final parts = fullName
        .split(" ")
        .where((p) => p.isNotEmpty)
        .take(2)
        .toList();
    return parts.map((p) => p[0].toUpperCase()).join();
  }
}

/// The school's WhatsApp chat — the number the parent bot answers on. The
/// server reads it from Meta, so the app never carries a number of its own.
class SchoolWhatsApp {
  const SchoolWhatsApp({
    required this.number,
    required this.display,
    required this.chatUrl,
  });

  /// Null when the server gave nothing usable; the card is then not shown.
  static SchoolWhatsApp? fromJson(Map<String, dynamic>? j) {
    if (j == null) return null;
    final chatUrl = (j["chatUrl"] as String?) ?? "";
    final number = (j["number"] as String?) ?? "";
    if (chatUrl.isEmpty || number.isEmpty) return null;
    return SchoolWhatsApp(
      number: number,
      display: (j["display"] as String?) ?? number,
      chatUrl: chatUrl,
    );
  }

  final String number;
  final String display;
  final String chatUrl;
}

class ParentSummary {
  const ParentSummary({
    required this.guardianName,
    required this.children,
    required this.totalOpenBalanceLabel,
    this.schoolWhatsApp,
  });

  factory ParentSummary.fromJson(Map<String, dynamic> j) => ParentSummary(
    guardianName: (j["guardianName"] as String?) ?? "Parent",
    children: ((j["children"] as List?) ?? const [])
        .map((c) => ParentChild.fromJson(c as Map<String, dynamic>))
        .toList(),
    totalOpenBalanceLabel: (j["totalOpenBalanceLabel"] as String?) ?? "₹0",
    schoolWhatsApp: SchoolWhatsApp.fromJson(
      j["schoolWhatsApp"] as Map<String, dynamic>?,
    ),
  );

  final String guardianName;
  final List<ParentChild> children;
  final String totalOpenBalanceLabel;
  final SchoolWhatsApp? schoolWhatsApp;
}

class SectionRef {
  const SectionRef({required this.id, required this.name});

  factory SectionRef.fromJson(Map<String, dynamic> j) =>
      SectionRef(id: j["id"] as String, name: (j["name"] as String?) ?? "");

  final String id;
  final String name;
}

class ClassRef {
  const ClassRef({
    required this.id,
    required this.name,
    required this.sections,
  });

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
            j["classTeacherOf"] as Map<String, dynamic>,
          ),
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
    fullName: (j["fullName"] as String).trim().replaceAll(RegExp(r"\s+"), " "),
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

class FeeDue {
  const FeeDue({
    required this.dueKey,
    required this.label,
    required this.kind,
    required this.dueOn,
    required this.balanceLabel,
    required this.balancePaise,
  });

  factory FeeDue.fromJson(Map<String, dynamic> j) => FeeDue(
    dueKey: (j["dueKey"] as String?) ?? "",
    label: (j["label"] as String?) ?? "",
    kind: (j["kind"] as String?) ?? "",
    dueOn: (j["dueOn"] as String?) ?? "",
    balanceLabel: (j["balanceLabel"] as String?) ?? "₹0",
    balancePaise: (j["balancePaise"] as num?)?.toInt() ?? 0,
  );

  /// Server handle for this due; what the parent checkout is asked to
  /// collect. Amounts are never sent — the server recomputes them.
  final String dueKey;
  final String label;
  final String kind;
  final String dueOn;
  final String balanceLabel;
  final int balancePaise;
}

/// What /api/payments/parent-checkout hands back once the pay-link exists.
///
/// `checkoutUrl` is the gateway's hosted page (Cashfree) and is what the
/// parent should be sent to. It is null when the gateway could not be
/// attached; `shareUrl` — the school's own pay page for the link — always
/// works and is the fallback, the same one the web portal uses.
class ParentCheckout {
  const ParentCheckout({
    required this.linkId,
    required this.amountPaise,
    required this.checkoutUrl,
    required this.shareUrl,
  });

  factory ParentCheckout.fromJson(Map<String, dynamic> j) => ParentCheckout(
    linkId: (j["linkId"] as String?) ?? "",
    amountPaise: (j["amountPaise"] as num?)?.toInt() ?? 0,
    checkoutUrl: j["checkoutUrl"] as String?,
    shareUrl: (j["shareUrl"] as String?) ?? "",
  );

  final String linkId;
  final int amountPaise;
  final String? checkoutUrl;
  final String shareUrl;

  /// Where to send the parent. Null only if the server returned neither,
  /// which the client treats as "could not start payment".
  Uri? get payUri {
    final raw = (checkoutUrl ?? "").isNotEmpty ? checkoutUrl! : shareUrl;
    return raw.isEmpty ? null : Uri.tryParse(raw);
  }
}

/// One title on the school's e-book shelf (FlipHTML5 bookcases).
class LibraryEbook {
  const LibraryEbook({
    required this.id,
    required this.title,
    required this.author,
    required this.subject,
    required this.classLabels,
    required this.url,
    required this.passKey,
    required this.passKeyLabel,
  });

  factory LibraryEbook.fromJson(Map<String, dynamic> j) => LibraryEbook(
    id: (j["id"] as String?) ?? "",
    title: (j["title"] as String?) ?? "",
    author: (j["author"] as String?) ?? "",
    subject: (j["subject"] as String?) ?? "",
    classLabels: ((j["classLabels"] as List?) ?? const [])
        .map((e) => e.toString())
        .toList(),
    url: (j["url"] as String?) ?? "",
    passKey: (j["passKey"] as String?) ?? "",
    passKeyLabel: (j["passKeyLabel"] as String?) ?? "",
  );

  final String id;
  final String title;
  final String author;
  final String subject;
  final List<String> classLabels;
  final String url;
  final String passKey;
  final String passKeyLabel;
}

/// GET /api/v1/library/ebooks.
///
/// `configured` false is a real, distinct state — the office has not set the
/// shelf up — and is shown as such rather than as an empty catalogue.
class EbookShelf {
  const EbookShelf({
    required this.configured,
    required this.shelfUrl,
    required this.shelfKey,
    required this.note,
    required this.books,
  });

  factory EbookShelf.fromJson(Map<String, dynamic> j) => EbookShelf(
    configured: j["configured"] == true,
    shelfUrl: (j["shelfUrl"] as String?) ?? "",
    shelfKey: (j["shelfKey"] as String?) ?? "",
    note: (j["note"] as String?) ?? "",
    books: ((j["books"] as List?) ?? const [])
        .map((b) => LibraryEbook.fromJson(b as Map<String, dynamic>))
        .toList(),
  );

  final bool configured;
  final String shelfUrl;
  final String shelfKey;
  final String note;
  final List<LibraryEbook> books;
}

/// One leave request as /api/v1/leave/list returns it.
class LeaveRequestInfo {
  const LeaveRequestInfo({
    required this.id,
    required this.studentId,
    required this.studentName,
    required this.fromDate,
    required this.toDate,
    required this.days,
    required this.leaveType,
    required this.leaveTypeLabel,
    required this.reason,
    required this.status,
    required this.createdAt,
    required this.decidedAt,
    required this.decisionNote,
  });

  factory LeaveRequestInfo.fromJson(Map<String, dynamic> j) => LeaveRequestInfo(
    id: (j["id"] as String?) ?? "",
    studentId: (j["studentId"] as String?) ?? "",
    studentName: (j["studentName"] as String?) ?? "",
    fromDate: (j["fromDate"] as String?) ?? "",
    toDate: (j["toDate"] as String?) ?? "",
    days: (j["days"] as num?)?.toInt() ?? 1,
    leaveType: (j["leaveType"] as String?) ?? "",
    leaveTypeLabel: (j["leaveTypeLabel"] as String?) ?? "",
    reason: (j["reason"] as String?) ?? "",
    status: (j["status"] as String?) ?? "pending",
    createdAt: (j["createdAt"] as String?) ?? "",
    decidedAt: (j["decidedAt"] as String?) ?? "",
    decisionNote: (j["decisionNote"] as String?) ?? "",
  );

  final String id;
  final String studentId;
  final String studentName;
  final String fromDate;
  final String toDate;
  final int days;
  final String leaveType;
  final String leaveTypeLabel;
  final String reason;

  /// pending | approved | rejected | cancelled
  final String status;
  final String createdAt;
  final String decidedAt;
  final String decisionNote;

  bool get isPending => status == "pending";
}

class LeaveTypeInfo {
  const LeaveTypeInfo({
    required this.code,
    required this.label,
    required this.note,
  });

  factory LeaveTypeInfo.fromJson(Map<String, dynamic> j) => LeaveTypeInfo(
    code: (j["code"] as String?) ?? "",
    label: (j["label"] as String?) ?? "",
    note: (j["note"] as String?) ?? "",
  );

  final String code;
  final String label;
  final String note;

  /// Half-day codes are for one date only; the server refuses a range.
  bool get isHalfDay => code == "HD_AM" || code == "HD_PM";
}

class LeaveList {
  const LeaveList({required this.requests, required this.leaveTypes});

  factory LeaveList.fromJson(Map<String, dynamic> j) => LeaveList(
    requests: ((j["requests"] as List?) ?? const [])
        .map((r) => LeaveRequestInfo.fromJson(r as Map<String, dynamic>))
        .toList(),
    leaveTypes: ((j["leaveTypes"] as List?) ?? const [])
        .map((t) => LeaveTypeInfo.fromJson(t as Map<String, dynamic>))
        .toList(),
  );

  final List<LeaveRequestInfo> requests;
  final List<LeaveTypeInfo> leaveTypes;
}

/// One complaint ticket as /api/v1/complaints/list returns it.
class ComplaintTicketInfo {
  const ComplaintTicketInfo({
    required this.id,
    required this.studentId,
    required this.studentName,
    required this.category,
    required this.categoryLabel,
    required this.subject,
    required this.description,
    required this.date,
    required this.status,
    required this.statusLabel,
    required this.resolutionNote,
    required this.createdAt,
  });

  factory ComplaintTicketInfo.fromJson(Map<String, dynamic> j) =>
      ComplaintTicketInfo(
        id: (j["id"] as String?) ?? "",
        studentId: j["studentId"] as String?,
        studentName: (j["studentName"] as String?) ?? "",
        category: (j["category"] as String?) ?? "other",
        categoryLabel: (j["categoryLabel"] as String?) ?? "",
        subject: (j["subject"] as String?) ?? "",
        description: (j["description"] as String?) ?? "",
        date: (j["date"] as String?) ?? "",
        status: (j["status"] as String?) ?? "open",
        statusLabel: (j["statusLabel"] as String?) ?? "",
        resolutionNote: (j["resolutionNote"] as String?) ?? "",
        createdAt: (j["createdAt"] as String?) ?? "",
      );

  final String id;
  final String? studentId;
  final String studentName;
  final String category;
  final String categoryLabel;
  final String subject;
  final String description;
  final String date;

  /// open | assigned | in_progress | resolved | closed
  final String status;
  final String statusLabel;
  final String resolutionNote;
  final String createdAt;

  bool get isClosed => status == "resolved" || status == "closed";
}

class ComplaintCategoryInfo {
  const ComplaintCategoryInfo({required this.value, required this.label});

  factory ComplaintCategoryInfo.fromJson(Map<String, dynamic> j) =>
      ComplaintCategoryInfo(
        value: (j["value"] as String?) ?? "",
        label: (j["label"] as String?) ?? "",
      );

  final String value;
  final String label;
}

class ComplaintList {
  const ComplaintList({required this.tickets, required this.categories});

  factory ComplaintList.fromJson(Map<String, dynamic> j) => ComplaintList(
    tickets: ((j["tickets"] as List?) ?? const [])
        .map((t) => ComplaintTicketInfo.fromJson(t as Map<String, dynamic>))
        .toList(),
    categories: ((j["categories"] as List?) ?? const [])
        .map((c) => ComplaintCategoryInfo.fromJson(c as Map<String, dynamic>))
        .toList(),
  );

  final List<ComplaintTicketInfo> tickets;
  final List<ComplaintCategoryInfo> categories;
}

// ---- profile & documents -----------------------------------------------------

/// One entry on the school's document checklist, with this child's status.
class StudentDocInfo {
  const StudentDocInfo({
    required this.key,
    required this.label,
    required this.required,
    required this.status,
    required this.statusLabel,
    required this.fileName,
    required this.uploadedAt,
    required this.reviewNote,
    required this.previewUrl,
  });

  factory StudentDocInfo.fromJson(Map<String, dynamic> j) => StudentDocInfo(
    key: (j["key"] as String?) ?? "",
    label: (j["label"] as String?) ?? "",
    required: j["required"] == true,
    status: (j["status"] as String?) ?? "missing",
    statusLabel: (j["statusLabel"] as String?) ?? "",
    fileName: (j["fileName"] as String?) ?? "",
    uploadedAt: (j["uploadedAt"] as String?) ?? "",
    reviewNote: (j["reviewNote"] as String?) ?? "",
    previewUrl: j["previewUrl"] as String?,
  );

  final String key;
  final String label;
  final bool required;

  /// missing | received | pending | verified | rejected
  final String status;
  final String statusLabel;
  final String fileName;
  final String uploadedAt;
  final String reviewNote;

  /// Server-relative proxy URL for the stored file; null when none is kept.
  final String? previewUrl;

  bool get hasFile => status != "missing" && fileName.isNotEmpty;
  bool get isVerified => status == "verified";
  bool get isPending => status == "pending" || status == "received";
  bool get isRejected => status == "rejected";
}

/// The checklist itself — what the school asks for, and what each is.
class DocChecklistItem {
  const DocChecklistItem({
    required this.key,
    required this.label,
    required this.required,
    required this.accept,
    required this.hint,
  });

  factory DocChecklistItem.fromJson(Map<String, dynamic> j) => DocChecklistItem(
    key: (j["key"] as String?) ?? "",
    label: (j["label"] as String?) ?? "",
    required: j["required"] == true,
    accept: (j["accept"] as String?) ?? "",
    hint: (j["hint"] as String?) ?? "",
  );

  final String key;
  final String label;
  final bool required;
  final String accept;
  final String hint;

  bool get allowsPdf => accept.contains("application/pdf");
}

/// A child's full record as the school holds it — read-only in the app.
class StudentProfile {
  const StudentProfile({
    required this.id,
    required this.fullName,
    required this.admissionNo,
    required this.classLabel,
    required this.fields,
    required this.photoUrl,
    required this.completeness,
    required this.docs,
  });

  factory StudentProfile.fromJson(Map<String, dynamic> j) {
    String s(String k) => (j[k] as String?) ?? "";
    // Label → value, in the order a parent expects to read them. Blank
    // values are kept so the screen can show "—" rather than hide a field
    // the office has not filled in.
    final fields = <(String, String)>[
      ("Admission no.", s("admissionNo")),
      ("Class", s("classLabel")),
      ("Roll no.", s("rollNo")),
      ("Date of birth", s("dob")),
      (
        "Gender",
        switch (s("gender")) {
          "M" => "Male",
          "F" => "Female",
          "O" => "Other",
          _ => "",
        },
      ),
      ("Blood group", s("bloodGroup")),
      ("Category", s("category")),
      ("Religion", s("religion")),
      ("Nationality", s("nationality")),
      ("Mother tongue", s("motherTongue")),
      ("Place of birth", s("placeOfBirth")),
      ("Father's name", s("fatherName")),
      ("Father's mobile", s("fatherMobile")),
      ("Mother's name", s("motherName")),
      ("Mother's mobile", s("motherMobile")),
      (
        "Emergency contact",
        [
          s("emergencyName"),
          s("emergencyMobile"),
        ].where((x) => x.isNotEmpty).join(" · "),
      ),
      ("Aadhaar", s("aadhaarMasked")),
      ("PEN", s("pen")),
      ("APAAR ID", s("apaarId")),
      ("Previous school", s("previousSchool")),
      ("Joined on", s("joinedOn")),
      ("Academic year", s("academicYearCode")),
    ];
    return StudentProfile(
      id: s("id"),
      fullName: s("fullName"),
      admissionNo: s("admissionNo"),
      classLabel: s("classLabel"),
      fields: fields,
      photoUrl: s("photoUrl"),
      completeness: (j["completeness"] as num?)?.toInt() ?? 0,
      docs: ((j["docs"] as List?) ?? const [])
          .map((d) => StudentDocInfo.fromJson(d as Map<String, dynamic>))
          .toList(),
    );
  }

  final String id;
  final String fullName;
  final String admissionNo;
  final String classLabel;
  final List<(String, String)> fields;
  final String photoUrl;
  final int completeness;
  final List<StudentDocInfo> docs;

  int get requiredMissing =>
      docs.where((d) => d.required && (!d.hasFile || d.isRejected)).length;
}

/// The family's contact record; only some fields are the parent's to edit.
class HouseholdProfile {
  const HouseholdProfile({required this.id, required this.values});

  factory HouseholdProfile.fromJson(Map<String, dynamic> j) => HouseholdProfile(
    id: (j["id"] as String?) ?? "",
    values: {
      for (final k in const [
        "code",
        "guardianName",
        "mobile",
        "whatsappMobile",
        "altMobile",
        "email",
        "address",
        "locality",
        "landmark",
        "city",
        "state",
        "pincode",
      ])
        k: (j[k] as String?) ?? "",
    },
  );

  final String id;
  final Map<String, String> values;

  String operator [](String key) => values[key] ?? "";
}

class ParentProfile {
  const ParentProfile({
    required this.household,
    required this.editableHouseholdFields,
    required this.documents,
    required this.children,
  });

  factory ParentProfile.fromJson(Map<String, dynamic> j) => ParentProfile(
    household: HouseholdProfile.fromJson(
      (j["household"] as Map<String, dynamic>?) ?? const {},
    ),
    editableHouseholdFields:
        ((j["editableHouseholdFields"] as List?) ?? const [])
            .map((e) => e.toString())
            .toList(),
    documents: ((j["documents"] as List?) ?? const [])
        .map((d) => DocChecklistItem.fromJson(d as Map<String, dynamic>))
        .toList(),
    children: ((j["children"] as List?) ?? const [])
        .map((c) => StudentProfile.fromJson(c as Map<String, dynamic>))
        .toList(),
  );

  final HouseholdProfile household;
  final List<String> editableHouseholdFields;
  final List<DocChecklistItem> documents;
  final List<StudentProfile> children;
}

/// What the server said about an uploaded document.
class DocumentSubmitResult {
  const DocumentSubmitResult({
    required this.doc,
    required this.message,
    required this.checkRan,
    required this.overall,
    required this.checks,
  });

  factory DocumentSubmitResult.fromJson(Map<String, dynamic> j) {
    final v = (j["validation"] as Map<String, dynamic>?) ?? const {};
    return DocumentSubmitResult(
      doc: StudentDocInfo.fromJson(
        (j["doc"] as Map<String, dynamic>?) ?? const {},
      ),
      message: (j["message"] as String?) ?? "Submitted for verification.",
      checkRan: v["ran"] == true,
      overall: v["overall"] as String?,
      checks: ((v["checks"] as List?) ?? const [])
          .map(
            (c) => (
              label: (c["label"] as String?) ?? "",
              status: (c["status"] as String?) ?? "",
            ),
          )
          .toList(),
    );
  }

  final StudentDocInfo doc;
  final String message;
  final bool checkRan;

  /// likely_match | review | likely_mismatch | unreadable, or null.
  final String? overall;
  final List<({String label, String status})> checks;
}

// ---- receipts, transport ----------------------------------------------------

class ReceiptInfo {
  const ReceiptInfo({
    required this.id,
    required this.receiptNo,
    required this.date,
    required this.totalLabel,
    required this.students,
    required this.particulars,
    required this.paidBy,
    required this.voided,
    required this.pdfUrl,
  });

  factory ReceiptInfo.fromJson(Map<String, dynamic> j) => ReceiptInfo(
    id: (j["id"] as String?) ?? "",
    receiptNo: (j["receiptNo"] as String?) ?? "",
    date: (j["date"] as String?) ?? "",
    totalLabel: (j["totalLabel"] as String?) ?? "",
    students: ((j["students"] as List?) ?? const [])
        .map((e) => e.toString())
        .toList(),
    particulars: ((j["particulars"] as List?) ?? const [])
        .map((e) => e.toString())
        .toList(),
    paidBy: (j["paidBy"] as String?) ?? "",
    voided: j["voided"] == true,
    pdfUrl: (j["pdfUrl"] as String?) ?? "",
  );

  final String id;
  final String receiptNo;
  final String date;
  final String totalLabel;
  final List<String> students;
  final List<String> particulars;
  final String paidBy;
  final bool voided;
  final String pdfUrl;
}

class ChildTransport {
  const ChildTransport({
    required this.routeCode,
    required this.routeName,
    required this.stopName,
    required this.serviceMode,
    required this.suspended,
    required this.monthlyFeeLabel,
    required this.vehicleName,
    required this.vehicleReg,
    required this.driverName,
    required this.driverMobile,
  });

  factory ChildTransport.fromJson(Map<String, dynamic> j) {
    // Nested maps may arrive untyped; read them leniently.
    final v = j["vehicle"] is Map
        ? Map<String, dynamic>.from(j["vehicle"] as Map)
        : const <String, dynamic>{};
    final d = j["driver"] is Map
        ? Map<String, dynamic>.from(j["driver"] as Map)
        : null;
    return ChildTransport(
      routeCode: (j["routeCode"] as String?) ?? "",
      routeName: (j["routeName"] as String?) ?? "",
      stopName: (j["stopName"] as String?) ?? "",
      serviceMode: (j["serviceMode"] as String?) ?? "both",
      suspended: j["suspended"] == true,
      monthlyFeeLabel: (j["monthlyFeeLabel"] as String?) ?? "",
      vehicleName: (v["name"] as String?) ?? "",
      vehicleReg: (v["registrationNo"] as String?) ?? "",
      driverName: (d?["name"] as String?) ?? "",
      driverMobile: (d?["mobile"] as String?) ?? "",
    );
  }

  final String routeCode;
  final String routeName;
  final String stopName;
  final String serviceMode;
  final bool suspended;
  final String monthlyFeeLabel;
  final String vehicleName;
  final String vehicleReg;
  final String driverName;
  final String driverMobile;

  bool get canCallDriver =>
      driverMobile.replaceAll(RegExp(r"\D"), "").length >= 10;
}

class TransportRequestState {
  const TransportRequestState({
    required this.id,
    required this.status,
    required this.createdAt,
    required this.handlingNote,
  });

  factory TransportRequestState.fromJson(Map<String, dynamic> j) =>
      TransportRequestState(
        id: (j["id"] as String?) ?? "",
        status: (j["status"] as String?) ?? "open",
        createdAt: (j["createdAt"] as String?) ?? "",
        handlingNote: (j["handlingNote"] as String?) ?? "",
      );

  final String id;

  /// open | contacted | assigned | declined
  final String status;
  final String createdAt;
  final String handlingNote;

  bool get isActive => status == "open" || status == "contacted";
}

class ChildTransportInfo {
  const ChildTransportInfo({
    required this.id,
    required this.fullName,
    required this.classLabel,
    required this.transport,
    required this.request,
  });

  factory ChildTransportInfo.fromJson(Map<String, dynamic> j) =>
      ChildTransportInfo(
        id: (j["id"] as String?) ?? "",
        fullName: (j["fullName"] as String?) ?? "",
        classLabel: (j["classLabel"] as String?) ?? "",
        transport: j["transport"] is Map<String, dynamic>
            ? ChildTransport.fromJson(j["transport"] as Map<String, dynamic>)
            : null,
        request: j["request"] is Map<String, dynamic>
            ? TransportRequestState.fromJson(
                j["request"] as Map<String, dynamic>,
              )
            : null,
      );

  final String id;
  final String fullName;
  final String classLabel;
  final ChildTransport? transport;
  final TransportRequestState? request;
}

class MyTransport {
  const MyTransport({
    required this.children,
    required this.address,
    required this.locality,
    required this.landmark,
  });

  factory MyTransport.fromJson(Map<String, dynamic> j) {
    final h = j["household"] is Map
        ? Map<String, dynamic>.from(j["household"] as Map)
        : const <String, dynamic>{};
    return MyTransport(
      children: ((j["children"] as List?) ?? const [])
          .map((c) => ChildTransportInfo.fromJson(c as Map<String, dynamic>))
          .toList(),
      address: (h["address"] as String?) ?? "",
      locality: (h["locality"] as String?) ?? "",
      landmark: (h["landmark"] as String?) ?? "",
    );
  }

  final List<ChildTransportInfo> children;
  final String address;
  final String locality;
  final String landmark;
}

/// A request as the office queue shows it (staff app).
class TransportRequestInfo {
  const TransportRequestInfo({
    required this.id,
    required this.studentName,
    required this.classLabel,
    required this.contactName,
    required this.contactMobile,
    required this.pickupAddress,
    required this.locality,
    required this.landmark,
    required this.preferredStop,
    required this.note,
    required this.status,
    required this.handlingNote,
    required this.handledBy,
    required this.createdAt,
  });

  factory TransportRequestInfo.fromJson(Map<String, dynamic> j) =>
      TransportRequestInfo(
        id: (j["id"] as String?) ?? "",
        studentName: (j["studentName"] as String?) ?? "",
        classLabel: (j["classLabel"] as String?) ?? "",
        contactName: (j["contactName"] as String?) ?? "",
        contactMobile: (j["contactMobile"] as String?) ?? "",
        pickupAddress: (j["pickupAddress"] as String?) ?? "",
        locality: (j["locality"] as String?) ?? "",
        landmark: (j["landmark"] as String?) ?? "",
        preferredStop: (j["preferredStop"] as String?) ?? "",
        note: (j["note"] as String?) ?? "",
        status: (j["status"] as String?) ?? "open",
        handlingNote: (j["handlingNote"] as String?) ?? "",
        handledBy: (j["handledBy"] as String?) ?? "",
        createdAt: (j["createdAt"] as String?) ?? "",
      );

  final String id;
  final String studentName;
  final String classLabel;
  final String contactName;
  final String contactMobile;
  final String pickupAddress;
  final String locality;
  final String landmark;
  final String preferredStop;
  final String note;
  final String status;
  final String handlingNote;
  final String handledBy;
  final String createdAt;

  bool get isActive => status == "open" || status == "contacted";
}

class FeeLedger {
  const FeeLedger({
    required this.studentName,
    required this.openDues,
    required this.futureDues,
    required this.openBalanceLabel,
    required this.futureBalanceLabel,
  });

  factory FeeLedger.fromJson(Map<String, dynamic> j) => FeeLedger(
    studentName: (j["studentName"] as String?) ?? "",
    openDues: ((j["openDues"] as List?) ?? const [])
        .map((d) => FeeDue.fromJson(d as Map<String, dynamic>))
        .toList(),
    futureDues: ((j["futureDues"] as List?) ?? const [])
        .map((d) => FeeDue.fromJson(d as Map<String, dynamic>))
        .toList(),
    openBalanceLabel: (j["openBalanceLabel"] as String?) ?? "₹0",
    futureBalanceLabel: (j["futureBalanceLabel"] as String?) ?? "₹0",
  );

  final String studentName;

  /// Asked for now.
  final List<FeeDue> openDues;

  /// Months ahead the family may clear early; never ticked by default.
  final List<FeeDue> futureDues;
  final String openBalanceLabel;
  final String futureBalanceLabel;

  bool get isEmpty => openDues.isEmpty && futureDues.isEmpty;
}

class AttendanceHistory {
  const AttendanceHistory({
    required this.markedDays,
    required this.presentDays,
    required this.absentDays,
    required this.lateDays,
    required this.entries,
  });

  factory AttendanceHistory.fromJson(Map<String, dynamic> j) =>
      AttendanceHistory(
        markedDays: (j["markedDays"] as num?)?.toInt() ?? 0,
        presentDays: (j["presentDays"] as num?)?.toInt() ?? 0,
        absentDays: (j["absentDays"] as num?)?.toInt() ?? 0,
        lateDays: (j["lateDays"] as num?)?.toInt() ?? 0,
        entries: ((j["entries"] as List?) ?? const [])
            .map(
              (e) => (
                date: (e["date"] as String?) ?? "",
                status: (e["status"] as String?) ?? "",
              ),
            )
            .toList(),
      );

  final int markedDays;
  final int presentDays;
  final int absentDays;
  final int lateDays;
  final List<({String date, String status})> entries;
}

class HomeworkItem {
  const HomeworkItem({
    required this.date,
    required this.title,
    required this.body,
    required this.subjectName,
    required this.teacherName,
    required this.dueAt,
    required this.isDiary,
  });

  final String date;
  final String title;
  final String body;
  final String subjectName;
  final String teacherName;
  final String? dueAt;
  final bool isDiary;
}

class SubjectRef {
  const SubjectRef({required this.id, required this.name});

  final String id;
  final String name;
}

class HomeworkFeed {
  const HomeworkFeed({required this.items, required this.subjects});

  factory HomeworkFeed.fromJson(Map<String, dynamic> j) {
    String bodyOf(Map<String, dynamic> m) {
      final en = (m["bodyEn"] as String?) ?? "";
      final hi = (m["bodyHi"] as String?) ?? "";
      return en.isNotEmpty ? en : hi;
    }

    final items = <HomeworkItem>[
      ...((j["posts"] as List?) ?? const []).map((raw) {
        final p = raw as Map<String, dynamic>;
        return HomeworkItem(
          date: (p["date"] as String?) ?? "",
          title: (p["title"] as String?) ?? "",
          body: bodyOf(p),
          subjectName: (p["subjectName"] as String?) ?? "",
          teacherName: (p["teacherName"] as String?) ?? "",
          dueAt: p["dueAt"] as String?,
          isDiary: false,
        );
      }),
      ...((j["diary"] as List?) ?? const []).map((raw) {
        final d = raw as Map<String, dynamic>;
        return HomeworkItem(
          date: (d["date"] as String?) ?? "",
          title: (d["title"] as String?) ?? "",
          body: bodyOf(d),
          subjectName: "Diary",
          teacherName: (d["teacherName"] as String?) ?? "",
          dueAt: null,
          isDiary: true,
        );
      }),
    ]..sort((a, b) => b.date.compareTo(a.date));

    final subjects = ((j["subjects"] as List?) ?? const [])
        .map(
          (s) => SubjectRef(
            id: s["id"] as String,
            name: (s["name"] as String?) ?? "",
          ),
        )
        .toList();

    return HomeworkFeed(items: items, subjects: subjects);
  }

  final List<HomeworkItem> items;

  /// Only present for staff sessions — the compose form's subject choices.
  final List<SubjectRef> subjects;
}

class CommsItem {
  const CommsItem({
    required this.title,
    required this.body,
    required this.publishedAt,
    required this.pinned,
    required this.isNews,
    required this.summary,
  });

  final String title;
  final String body;
  final String publishedAt;
  final bool pinned;
  final bool isNews;
  final String summary;
}

class PtmSlotInfo {
  const PtmSlotInfo({
    required this.id,
    required this.teacherName,
    required this.startAt,
    required this.endAt,
    required this.roomOrLink,
    required this.seatsLeft,
  });

  factory PtmSlotInfo.fromJson(Map<String, dynamic> j) => PtmSlotInfo(
    id: j["id"] as String,
    teacherName: (j["teacherName"] as String?) ?? "",
    startAt: (j["startAt"] as String?) ?? "",
    endAt: (j["endAt"] as String?) ?? "",
    roomOrLink: (j["roomOrLink"] as String?) ?? "",
    seatsLeft: (j["seatsLeft"] as num?)?.toInt() ?? 0,
  );

  final String id;
  final String teacherName;
  final String startAt;
  final String endAt;
  final String roomOrLink;
  final int seatsLeft;
}

class PtmEventInfo {
  const PtmEventInfo({
    required this.id,
    required this.name,
    required this.date,
    required this.modeLabel,
    required this.note,
    required this.myBookingId,
    required this.myBookingSlotId,
    required this.slots,
  });

  factory PtmEventInfo.fromJson(Map<String, dynamic> j) {
    final booking = j["myBooking"] as Map<String, dynamic>?;
    return PtmEventInfo(
      id: j["id"] as String,
      name: (j["name"] as String?) ?? "PTM",
      date: (j["date"] as String?) ?? "",
      modeLabel: (j["modeLabel"] as String?) ?? "",
      note: (j["note"] as String?) ?? "",
      myBookingId: booking?["id"] as String?,
      myBookingSlotId: booking?["slotId"] as String?,
      slots: ((j["slots"] as List?) ?? const [])
          .map((s) => PtmSlotInfo.fromJson(s as Map<String, dynamic>))
          .toList(),
    );
  }

  final String id;
  final String name;
  final String date;
  final String modeLabel;
  final String note;
  final String? myBookingId;
  final String? myBookingSlotId;
  final List<PtmSlotInfo> slots;
}

class PunchToday {
  const PunchToday({
    required this.status,
    required this.inTime,
    required this.outTime,
    required this.punchWayLabel,
  });

  final String status;
  final String? inTime;
  final String? outTime;
  final String punchWayLabel;
}

class PunchState {
  const PunchState({
    required this.staffName,
    required this.date,
    required this.allowSelfPunch,
    required this.fenceLat,
    required this.fenceLng,
    required this.fenceRadiusM,
    required this.maxAccuracyM,
    required this.today,
  });

  factory PunchState.fromJson(Map<String, dynamic> j) {
    final fence = (j["fence"] as Map<String, dynamic>?) ?? const {};
    final today = j["today"] as Map<String, dynamic>?;
    return PunchState(
      staffName: (j["staffName"] as String?) ?? "",
      date: (j["date"] as String?) ?? "",
      allowSelfPunch: j["allowSelfPunch"] == true,
      fenceLat: (fence["lat"] as num?)?.toDouble() ?? 0,
      fenceLng: (fence["lng"] as num?)?.toDouble() ?? 0,
      fenceRadiusM: (fence["radiusM"] as num?)?.toDouble() ?? 150,
      maxAccuracyM: (fence["maxAccuracyM"] as num?)?.toDouble() ?? 120,
      today: today == null
          ? null
          : PunchToday(
              status: (today["status"] as String?) ?? "",
              inTime: today["inTime"] as String?,
              outTime: today["outTime"] as String?,
              punchWayLabel: (today["punchWayLabel"] as String?) ?? "",
            ),
    );
  }

  final String staffName;
  final String date;
  final bool allowSelfPunch;
  final double fenceLat;
  final double fenceLng;
  final double fenceRadiusM;
  final double maxAccuracyM;
  final PunchToday? today;
}

class PunchResult {
  const PunchResult({
    required this.kind,
    required this.time,
    required this.distanceM,
  });

  final String kind;
  final String time;
  final int distanceM;
}

/// Outcome of filing one period log.
///
/// [locationCheck] is "on_campus", "off_campus" or "unknown". "unknown" is
/// the ordinary case — no GPS fix was available, or none was accurate
/// enough to place the teacher against the campus fence — and is never
/// shown to the teacher as a problem.
class TeachingLogResult {
  const TeachingLogResult({
    required this.status,
    required this.locationCheck,
    this.distanceM,
  });

  final String status;
  final String locationCheck;
  final int? distanceM;
}

class PrincipalSnapshot {
  const PrincipalSnapshot({
    required this.academicYearCode,
    required this.todayCollectionPaise,
    required this.mtdCollectionPaise,
    required this.openDuesPaise,
    required this.defaulterHouseholds,
    required this.attendanceDate,
    required this.studentPresent,
    required this.studentAbsent,
    required this.studentLeave,
    required this.studentMarkedPct,
    required this.sectionsMarked,
    required this.staffActive,
    required this.staffPresent,
    required this.staffAbsent,
    required this.admissionsPipeline,
    required this.admissionsEnrolled,
    required this.followUpsDue,
    required this.vaultExpiring30d,
    required this.lowStockSkus,
    required this.registersPending,
  });

  factory PrincipalSnapshot.fromJson(Map<String, dynamic> j) {
    final fees = (j["fees"] as Map<String, dynamic>?) ?? const {};
    final att = (j["attendance"] as Map<String, dynamic>?) ?? const {};
    final staff = (j["staff"] as Map<String, dynamic>?) ?? const {};
    final adm = (j["admissions"] as Map<String, dynamic>?) ?? const {};
    final alerts = (j["alerts"] as Map<String, dynamic>?) ?? const {};
    int n(Map<String, dynamic> m, String k) => (m[k] as num?)?.toInt() ?? 0;
    return PrincipalSnapshot(
      academicYearCode: (j["academicYearCode"] as String?) ?? "",
      todayCollectionPaise: n(fees, "todayCollectionPaise"),
      mtdCollectionPaise: n(fees, "mtdCollectionPaise"),
      openDuesPaise: n(fees, "openDuesPaise"),
      defaulterHouseholds: n(fees, "defaulterHouseholds"),
      attendanceDate: (att["date"] as String?) ?? "",
      studentPresent: n(att, "studentPresent"),
      studentAbsent: n(att, "studentAbsent"),
      studentLeave: n(att, "studentLeave"),
      studentMarkedPct: n(att, "studentMarkedPct"),
      sectionsMarked: n(att, "sectionsMarked"),
      staffActive: n(staff, "activeCount"),
      staffPresent: n(staff, "presentToday"),
      staffAbsent: n(staff, "absentToday"),
      admissionsPipeline: n(adm, "pipeline"),
      admissionsEnrolled: n(adm, "enrolled"),
      followUpsDue: n(adm, "followUpsDue"),
      vaultExpiring30d: n(alerts, "vaultExpiring30d"),
      lowStockSkus: n(alerts, "lowStockSkus"),
      registersPending: n(alerts, "attendanceRegistersPending"),
    );
  }

  final String academicYearCode;
  final int todayCollectionPaise;
  final int mtdCollectionPaise;
  final int openDuesPaise;
  final int defaulterHouseholds;
  final String attendanceDate;
  final int studentPresent;
  final int studentAbsent;
  final int studentLeave;
  final int studentMarkedPct;
  final int sectionsMarked;
  final int staffActive;
  final int staffPresent;
  final int staffAbsent;
  final int admissionsPipeline;
  final int admissionsEnrolled;
  final int followUpsDue;
  final int vaultExpiring30d;
  final int lowStockSkus;
  final int registersPending;
}

String formatInrPaise(int paise) {
  final rupees = paise ~/ 100;
  final s = rupees.abs().toString();
  // Indian digit grouping: 12,34,567
  String grouped;
  if (s.length <= 3) {
    grouped = s;
  } else {
    final last3 = s.substring(s.length - 3);
    var rest = s.substring(0, s.length - 3);
    final parts = <String>[];
    while (rest.length > 2) {
      parts.insert(0, rest.substring(rest.length - 2));
      rest = rest.substring(0, rest.length - 2);
    }
    if (rest.isNotEmpty) parts.insert(0, rest);
    grouped = "${parts.join(",")},$last3";
  }
  return "${rupees < 0 ? "-" : ""}₹$grouped";
}

class TransportStopInfo {
  const TransportStopInfo({
    required this.name,
    required this.sequence,
    required this.distanceKm,
    this.lat,
    this.lng,
  });

  final String name;
  final int sequence;
  final double distanceKm;

  /// Null when the office has never pinned this stop on the map. Nullable on
  /// purpose — an unpinned stop must read as unpinned, not as 0,0.
  final double? lat;
  final double? lng;

  bool get hasPin => lat != null && lng != null;
}

class PlanTargetSubject {
  const PlanTargetSubject({required this.id, required this.name});
  final String id;
  final String name;
}

/// A class and the subjects that can carry a syllabus plan.
class PlanTargetClass {
  const PlanTargetClass({
    required this.id,
    required this.name,
    required this.subjects,
  });

  factory PlanTargetClass.fromJson(Map<String, dynamic> j) => PlanTargetClass(
    id: (j["id"] as String?) ?? "",
    name: (j["name"] as String?) ?? "",
    subjects: ((j["subjects"] as List?) ?? const [])
        .map(
          (e) => PlanTargetSubject(
            id: ((e as Map)["id"] as String?) ?? "",
            name: (e["name"] as String?) ?? "",
          ),
        )
        .toList(),
  );

  final String id;
  final String name;
  final List<PlanTargetSubject> subjects;
}

/// A chapter detected on a photographed contents page.
class ScannedChapter {
  ScannedChapter({
    required this.code,
    required this.title,
    required this.confidence,
    required this.topics,
    this.include = true,
  });

  factory ScannedChapter.fromJson(Map<String, dynamic> j) => ScannedChapter(
    code: (j["code"] as String?) ?? "",
    title: (j["title"] as String?) ?? "",
    confidence: (j["confidence"] as String?) ?? "high",
    topics: ((j["topics"] as List?) ?? const [])
        .map(
          (e) => ScannedTopic(
            code: ((e as Map)["code"] as String?) ?? "",
            title: (e["title"] as String?) ?? "",
          ),
        )
        .toList(),
  );

  String code;
  String title;
  final String confidence;
  final List<ScannedTopic> topics;

  /// Ticked in the review list; nothing is saved unticked.
  bool include;

  Map<String, dynamic> toImportJson() => {
    "code": code,
    "title": title,
    "topics": [
      for (final t in topics.where((t) => t.include))
        {"code": t.code, "title": t.title},
    ],
  };
}

class ScannedTopic {
  ScannedTopic({required this.code, required this.title, this.include = true});

  String code;
  String title;
  bool include;
}

/// Result of reading a contents page. [verdict] is good | partial | poor.
class SyllabusScan {
  const SyllabusScan({
    required this.chapters,
    required this.ignored,
    required this.verdict,
    required this.rawText,
  });

  factory SyllabusScan.fromJson(Map<String, dynamic> j) => SyllabusScan(
    chapters: ((j["chapters"] as List?) ?? const [])
        .map((e) => ScannedChapter.fromJson(e as Map<String, dynamic>))
        .toList(),
    ignored: ((j["ignored"] as List?) ?? const [])
        .map((e) => e.toString())
        .toList(),
    verdict: ((j["quality"] as Map?)?["verdict"] as String?) ?? "poor",
    rawText: (j["rawText"] as String?) ?? "",
  );

  final List<ScannedChapter> chapters;
  final List<String> ignored;
  final String verdict;
  final String rawText;
}

class SyllabusImportSummary {
  const SyllabusImportSummary({
    required this.chaptersAdded,
    required this.topicsAdded,
    required this.skipped,
  });

  final int chaptersAdded;
  final int topicsAdded;
  final List<String> skipped;
}

/// A link to teaching content — an e-book chapter, a PDF, a video.
class TeachingResource {
  const TeachingResource({
    required this.id,
    required this.kind,
    required this.title,
    required this.url,
    required this.locator,
  });

  factory TeachingResource.fromJson(Map<String, dynamic> j) => TeachingResource(
    id: (j["id"] as String?) ?? "",
    kind: (j["kind"] as String?) ?? "link",
    title: (j["title"] as String?) ?? "",
    url: (j["url"] as String?) ?? "",
    locator: (j["locator"] as String?) ?? "",
  );

  final String id;

  /// ebook | pdf | video | link
  final String kind;
  final String title;
  final String url;
  final String locator;
}

/// One chapter or topic a period can be tagged with.
class TeachingUnit {
  const TeachingUnit({
    required this.id,
    required this.code,
    required this.title,
    this.topics = const [],
    this.resources = const [],
  });

  factory TeachingUnit.fromJson(Map<String, dynamic> j) => TeachingUnit(
    id: (j["id"] as String?) ?? "",
    code: (j["code"] as String?) ?? "",
    title: (j["title"] as String?) ?? "",
    topics: ((j["topics"] as List?) ?? const [])
        .map((e) => TeachingUnit.fromJson(e as Map<String, dynamic>))
        .toList(),
    resources: ((j["resources"] as List?) ?? const [])
        .map((e) => TeachingResource.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  final String id;
  final String code;
  final String title;

  /// Topics inside this chapter; empty when this is itself a topic.
  final List<TeachingUnit> topics;
  final List<TeachingResource> resources;

  String get label => code.isEmpty ? title : "$code · $title";
}

/// A teacher's plan for one lesson.
class TeachingLessonPlan {
  const TeachingLessonPlan({
    required this.id,
    required this.title,
    required this.plannedDate,
    required this.objectives,
    required this.teachingAids,
    required this.activities,
    required this.assessment,
    required this.homework,
    required this.unitIds,
    required this.resources,
  });

  factory TeachingLessonPlan.fromJson(Map<String, dynamic> j) =>
      TeachingLessonPlan(
        id: (j["id"] as String?) ?? "",
        title: (j["title"] as String?) ?? "",
        plannedDate: (j["plannedDate"] as String?) ?? "",
        objectives: (j["objectives"] as String?) ?? "",
        teachingAids: (j["teachingAids"] as String?) ?? "",
        activities: (j["activities"] as String?) ?? "",
        assessment: (j["assessment"] as String?) ?? "",
        homework: (j["homework"] as String?) ?? "",
        unitIds: ((j["unitIds"] as List?) ?? const [])
            .map((e) => e.toString())
            .toList(),
        resources: ((j["resources"] as List?) ?? const [])
            .map((e) => TeachingResource.fromJson(e as Map<String, dynamic>))
            .toList(),
      );

  final String id;
  final String title;
  final String plannedDate;
  final String objectives;
  final String teachingAids;
  final String activities;
  final String assessment;
  final String homework;
  final List<String> unitIds;
  final List<TeachingResource> resources;
}

/// One scheduled period, with whatever the teacher has logged so far.
class TeachingPeriod {
  const TeachingPeriod({
    required this.periodNo,
    required this.label,
    required this.startTime,
    required this.endTime,
    required this.classId,
    required this.sectionId,
    required this.subjectId,
    required this.className,
    required this.sectionName,
    required this.subjectName,
    required this.isSubstituted,
    required this.status,
    required this.unitIds,
    required this.lessonPlanId,
    required this.chapters,
    required this.lessonPlans,
    required this.resources,
  });

  factory TeachingPeriod.fromJson(Map<String, dynamic> j) => TeachingPeriod(
    periodNo: (j["periodNo"] as num?)?.toInt() ?? 0,
    label: (j["label"] as String?) ?? "",
    startTime: (j["startTime"] as String?) ?? "",
    endTime: (j["endTime"] as String?) ?? "",
    classId: (j["classId"] as String?) ?? "",
    sectionId: (j["sectionId"] as String?) ?? "",
    subjectId: (j["subjectId"] as String?) ?? "",
    className: (j["className"] as String?) ?? "",
    sectionName: (j["sectionName"] as String?) ?? "",
    subjectName: (j["subjectName"] as String?) ?? "",
    isSubstituted: (j["isSubstituted"] as bool?) ?? false,
    status: (j["status"] as String?) ?? "pending",
    unitIds: ((j["unitIds"] as List?) ?? const [])
        .map((e) => e.toString())
        .toList(),
    lessonPlanId: (j["lessonPlanId"] as String?) ?? "",
    chapters: ((j["chapters"] as List?) ?? const [])
        .map((e) => TeachingUnit.fromJson(e as Map<String, dynamic>))
        .toList(),
    lessonPlans: ((j["lessonPlans"] as List?) ?? const [])
        .map((e) => TeachingLessonPlan.fromJson(e as Map<String, dynamic>))
        .toList(),
    resources: ((j["resources"] as List?) ?? const [])
        .map((e) => TeachingResource.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  final int periodNo;
  final String label;
  final String startTime;
  final String endTime;
  final String classId;
  final String sectionId;
  final String subjectId;
  final String className;
  final String sectionName;
  final String subjectName;
  final bool isSubstituted;

  /// delivered | not_delivered | substituted | unlogged | pending
  final String status;
  final List<String> unitIds;
  final String lessonPlanId;

  /// Chapters, each carrying its topics.
  final List<TeachingUnit> chapters;
  final List<TeachingLessonPlan> lessonPlans;

  /// Content links already attached to whatever this period is tagged with.
  final List<TeachingResource> resources;

  bool get isLogged =>
      status == "delivered" ||
      status == "not_delivered" ||
      status == "substituted";

  String get classLabel => "$className-$sectionName";
}

/// A teacher's day. When [scheduleAvailable] is false the day could not be
/// resolved at all — [reason]/[detail] say why. This is deliberately NOT
/// the same as a day with zero periods, and must never be shown as
/// "no classes today".
class TeachingDay {
  const TeachingDay({
    required this.date,
    required this.scheduleAvailable,
    required this.reason,
    required this.detail,
    required this.periods,
  });

  factory TeachingDay.fromJson(Map<String, dynamic> j) => TeachingDay(
    date: (j["date"] as String?) ?? "",
    scheduleAvailable: (j["scheduleAvailable"] as bool?) ?? false,
    reason: (j["reason"] as String?) ?? "",
    detail: (j["detail"] as String?) ?? "",
    periods: ((j["periods"] as List?) ?? const [])
        .map((e) => TeachingPeriod.fromJson(e as Map<String, dynamic>))
        .toList(),
  );

  final String date;
  final bool scheduleAvailable;
  final String reason;
  final String detail;
  final List<TeachingPeriod> periods;
}

class TransportRouteInfo {
  const TransportRouteInfo({
    required this.id,
    required this.code,
    required this.name,
    required this.stops,
    required this.vehicleName,
    required this.vehicleReg,
    required this.seatCapacity,
    required this.driverName,
  });

  factory TransportRouteInfo.fromJson(Map<String, dynamic> j) {
    final v = j["vehicle"] as Map<String, dynamic>?;
    return TransportRouteInfo(
      id: (j["id"] as String?) ?? "",
      code: (j["code"] as String?) ?? "",
      name: (j["name"] as String?) ?? "",
      stops: ((j["stops"] as List?) ?? const [])
          .map(
            (s) => TransportStopInfo(
              name: (s["name"] as String?) ?? "",
              sequence: (s["sequence"] as num?)?.toInt() ?? 0,
              distanceKm: (s["distanceKm"] as num?)?.toDouble() ?? 0,
              lat: (s["lat"] as num?)?.toDouble(),
              lng: (s["lng"] as num?)?.toDouble(),
            ),
          )
          .toList(),
      vehicleName: (v?["name"] as String?) ?? "",
      vehicleReg: (v?["registrationNo"] as String?) ?? "",
      seatCapacity: (v?["seatCapacity"] as num?)?.toInt(),
      driverName: v?["driverName"] as String?,
    );
  }

  final String id;
  final String code;
  final String name;
  final List<TransportStopInfo> stops;
  final String vehicleName;
  final String vehicleReg;
  final int? seatCapacity;
  final String? driverName;
}

class ChatThreadInfo {
  const ChatThreadInfo({
    required this.studentId,
    required this.studentName,
    required this.lastMessage,
    required this.lastMessageAt,
    required this.unreadCount,
  });

  factory ChatThreadInfo.fromJson(Map<String, dynamic> j) => ChatThreadInfo(
    studentId: (j["studentId"] as String?) ?? "",
    studentName: (j["studentName"] as String?) ?? "",
    lastMessage: j["lastMessage"] as String?,
    lastMessageAt: j["lastMessageAt"] as String?,
    unreadCount: (j["unreadCount"] as num?)?.toInt() ?? 0,
  );

  final String studentId;
  final String studentName;
  final String? lastMessage;
  final String? lastMessageAt;
  final int unreadCount;
}

class ChatMessage {
  const ChatMessage({
    required this.id,
    required this.senderPersona,
    required this.senderName,
    required this.body,
    required this.createdAt,
    required this.mine,
  });

  factory ChatMessage.fromJson(Map<String, dynamic> j) => ChatMessage(
    id: (j["id"] as String?) ?? "",
    senderPersona: (j["senderPersona"] as String?) ?? "",
    senderName: (j["senderName"] as String?) ?? "",
    body: (j["body"] as String?) ?? "",
    createdAt: (j["createdAt"] as String?) ?? "",
    mine: (j["mine"] as bool?) ?? false,
  );

  final String id;
  final String senderPersona;
  final String senderName;
  final String body;
  final String createdAt;
  final bool mine;
}

class ChatThread {
  const ChatThread({
    required this.studentId,
    required this.studentName,
    required this.teacherName,
    required this.messages,
  });

  factory ChatThread.fromJson(Map<String, dynamic> j) => ChatThread(
    studentId: (j["studentId"] as String?) ?? "",
    studentName: (j["studentName"] as String?) ?? "",
    teacherName: j["teacherName"] as String?,
    messages: ((j["messages"] as List?) ?? const [])
        .map((m) => ChatMessage.fromJson(m as Map<String, dynamic>))
        .toList(),
  );

  final String studentId;
  final String studentName;
  final String? teacherName;
  final List<ChatMessage> messages;
}

/* ─── Principal drill-downs (/api/v1/principal/lists) ─────────────────── */

class DefaulterChild {
  const DefaulterChild({
    required this.studentId,
    required this.fullName,
    required this.classLabel,
    required this.openPaise,
  });
  factory DefaulterChild.fromJson(Map<String, dynamic> j) => DefaulterChild(
    studentId: j["studentId"] as String? ?? "",
    fullName: j["fullName"] as String? ?? "",
    classLabel: j["classLabel"] as String? ?? "",
    openPaise: (j["openPaise"] as num?)?.toInt() ?? 0,
  );
  final String studentId;
  final String fullName;
  final String classLabel;
  final int openPaise;
}

class DefaulterHousehold {
  const DefaulterHousehold({
    required this.householdId,
    required this.guardianName,
    required this.mobile,
    required this.openPaise,
    required this.children,
  });
  factory DefaulterHousehold.fromJson(Map<String, dynamic> j) =>
      DefaulterHousehold(
        householdId: j["householdId"] as String? ?? "",
        guardianName: j["guardianName"] as String? ?? "",
        mobile: j["mobile"] as String? ?? "",
        openPaise: (j["openPaise"] as num?)?.toInt() ?? 0,
        children: ((j["children"] as List?) ?? const [])
            .map((c) => DefaulterChild.fromJson(c as Map<String, dynamic>))
            .toList(),
      );
  final String householdId;
  final String guardianName;
  final String mobile;
  final int openPaise;
  final List<DefaulterChild> children;
}

class DefaultersList {
  const DefaultersList({
    required this.asOf,
    required this.totalOpenPaise,
    required this.households,
  });
  factory DefaultersList.fromJson(Map<String, dynamic> j) => DefaultersList(
    asOf: j["asOf"] as String? ?? "",
    totalOpenPaise: (j["totalOpenPaise"] as num?)?.toInt() ?? 0,
    households: ((j["households"] as List?) ?? const [])
        .map((h) => DefaulterHousehold.fromJson(h as Map<String, dynamic>))
        .toList(),
  );
  final String asOf;
  final int totalOpenPaise;
  final List<DefaulterHousehold> households;
}

class SectionRegisterStatus {
  const SectionRegisterStatus({
    required this.sectionId,
    required this.classId,
    required this.label,
    required this.marked,
    required this.holiday,
    required this.present,
    required this.absent,
    required this.leave,
    required this.markedBy,
  });
  factory SectionRegisterStatus.fromJson(Map<String, dynamic> j) =>
      SectionRegisterStatus(
        sectionId: j["sectionId"] as String? ?? "",
        classId: j["classId"] as String? ?? "",
        label: j["label"] as String? ?? "",
        marked: j["marked"] == true,
        holiday: j["holiday"] == true,
        present: (j["present"] as num?)?.toInt() ?? 0,
        absent: (j["absent"] as num?)?.toInt() ?? 0,
        leave: (j["leave"] as num?)?.toInt() ?? 0,
        markedBy: j["markedBy"] as String? ?? "",
      );
  final String sectionId;
  final String classId;
  final String label;
  final bool marked;
  final bool holiday;
  final int present;
  final int absent;
  final int leave;
  final String markedBy;
}

class RegistersList {
  const RegistersList({required this.date, required this.sections});
  factory RegistersList.fromJson(Map<String, dynamic> j) => RegistersList(
    date: j["date"] as String? ?? "",
    sections: ((j["sections"] as List?) ?? const [])
        .map((s) => SectionRegisterStatus.fromJson(s as Map<String, dynamic>))
        .toList(),
  );
  final String date;
  final List<SectionRegisterStatus> sections;
}

class StaffAttendanceRow {
  const StaffAttendanceRow({
    required this.staffId,
    required this.fullName,
    required this.designation,
    required this.mobile,
    required this.status,
    required this.inTime,
    required this.outTime,
    required this.punchWay,
  });
  factory StaffAttendanceRow.fromJson(Map<String, dynamic> j) =>
      StaffAttendanceRow(
        staffId: j["staffId"] as String? ?? "",
        fullName: j["fullName"] as String? ?? "",
        designation: j["designation"] as String? ?? "",
        mobile: j["mobile"] as String? ?? "",
        status: j["status"] as String? ?? "",
        inTime: j["inTime"] as String? ?? "",
        outTime: j["outTime"] as String? ?? "",
        punchWay: j["punchWay"] as String? ?? "",
      );
  final String staffId;
  final String fullName;
  final String designation;
  final String mobile;

  /// "" (not marked) | P | A | L | HD | LE
  final String status;
  final String inTime;
  final String outTime;
  final String punchWay;
}

class StaffAttendanceToday {
  const StaffAttendanceToday({
    required this.date,
    required this.marked,
    required this.staff,
  });
  factory StaffAttendanceToday.fromJson(Map<String, dynamic> j) =>
      StaffAttendanceToday(
        date: j["date"] as String? ?? "",
        marked: j["marked"] == true,
        staff: ((j["staff"] as List?) ?? const [])
            .map((s) => StaffAttendanceRow.fromJson(s as Map<String, dynamic>))
            .toList(),
      );
  final String date;
  final bool marked;
  final List<StaffAttendanceRow> staff;
}

class FollowUpLead {
  const FollowUpLead({
    required this.id,
    required this.enquiryNo,
    required this.childName,
    required this.guardianName,
    required this.mobile,
    required this.stage,
    required this.classSought,
    required this.nextFollowUpAt,
    required this.overdueDays,
  });
  factory FollowUpLead.fromJson(Map<String, dynamic> j) => FollowUpLead(
    id: j["id"] as String? ?? "",
    enquiryNo: j["enquiryNo"] as String? ?? "",
    childName: j["childName"] as String? ?? "",
    guardianName: j["guardianName"] as String? ?? "",
    mobile: j["mobile"] as String? ?? "",
    stage: j["stage"] as String? ?? "",
    classSought: j["classSought"] as String? ?? "",
    nextFollowUpAt: j["nextFollowUpAt"] as String? ?? "",
    overdueDays: (j["overdueDays"] as num?)?.toInt() ?? 0,
  );
  final String id;
  final String enquiryNo;
  final String childName;
  final String guardianName;
  final String mobile;
  final String stage;
  final String classSought;
  final String nextFollowUpAt;
  final int overdueDays;
}

class WaTemplateVar {
  const WaTemplateVar({required this.key, required this.label});
  factory WaTemplateVar.fromJson(Map<String, dynamic> j) => WaTemplateVar(
    key: j["key"] as String? ?? "",
    label: j["label"] as String? ?? (j["key"] as String? ?? ""),
  );
  final String key;
  final String label;
}

/// An approved WhatsApp template the owner broadcast can send. Templates
/// reach every recipient; free text only reaches parents inside Meta's
/// 24-hour session window.
class WaBroadcastTemplate {
  const WaBroadcastTemplate({
    required this.id,
    required this.name,
    required this.language,
    required this.metaName,
    required this.metaLanguage,
    required this.body,
    required this.variables,
  });
  factory WaBroadcastTemplate.fromJson(Map<String, dynamic> j) =>
      WaBroadcastTemplate(
        id: j["id"] as String? ?? "",
        name: j["name"] as String? ?? "",
        language: j["language"] as String? ?? "",
        metaName: j["metaName"] as String? ?? "",
        metaLanguage: j["metaLanguage"] as String? ?? "",
        body: j["body"] as String? ?? "",
        variables: ((j["variables"] as List?) ?? const [])
            .map((v) => WaTemplateVar.fromJson(v as Map<String, dynamic>))
            .toList(),
      );
  final String id;
  final String name;
  final String language;
  final String metaName;
  final String metaLanguage;
  final String body;
  final List<WaTemplateVar> variables;

  /// Body with {{tokens}} filled for on-screen preview.
  String preview(Map<String, String> values) {
    var out = body;
    for (final v in variables) {
      final val = (values[v.key] ?? "").trim();
      out = out.replaceAll("{{${v.key}}}", val.isEmpty ? "[${v.label}]" : val);
    }
    return out;
  }
}

class BroadcastResult {
  const BroadcastResult({
    required this.mode,
    required this.recipientCount,
    required this.skippedOptOut,
    required this.sent,
    required this.failed,
    required this.pushSent,
  });
  factory BroadcastResult.fromJson(Map<String, dynamic> j) => BroadcastResult(
    mode: j["mode"] as String? ?? "",
    recipientCount: (j["recipientCount"] as num?)?.toInt() ?? 0,
    skippedOptOut: (j["skippedOptOut"] as num?)?.toInt() ?? 0,
    sent: (j["sent"] as num?)?.toInt() ?? 0,
    failed: (j["failed"] as num?)?.toInt() ?? 0,
    pushSent:
        ((j["push"] as Map<String, dynamic>?)?["sent"] as num?)?.toInt() ?? 0,
  );
  final String mode;
  final int recipientCount;
  final int skippedOptOut;
  final int sent;
  final int failed;
  final int pushSent;
  bool get isDryRun => mode == "dry_run";
}

class ApiClient {
  ApiClient(this.config);

  final AppConfig config;
  final _storage = const FlutterSecureStorage();

  Uri _uri(String path) => Uri.parse("${config.apiBaseUrl}$path");

  Future<String?> sessionCookie() => _storage.read(key: _cookieKey);

  /// Public base URL (for screens/services that build their own requests).
  String get baseUrl => config.apiBaseUrl;

  /// Raw JSON POST with the session cookie — for endpoints that return the
  /// whole body (not the {data} envelope), e.g. /api/staff-geo/ping.
  Future<Map<String, dynamic>> postJson(
    String path,
    Map<String, dynamic> body,
  ) async {
    final res = await http.post(
      _uri(path),
      headers: await _authHeaders(),
      body: jsonEncode(body),
    );
    final decoded =
        jsonDecode(res.body.isEmpty ? "{}" : res.body) as Map<String, dynamic>;
    if (res.statusCode >= 500) _throwFrom(res);
    return decoded;
  }

  Future<String?> guardianName() => _storage.read(key: _guardianKey);

  Future<bool> hasSession() async =>
      (await sessionCookie())?.isNotEmpty == true;

  Future<String?> persona() => _storage.read(key: _personaKey);

  Future<String?> roleCode() => _storage.read(key: _roleKey);

  /// Drivers and attendants get the bus home instead of the teacher home.
  ///
  /// Keyed on roleCode, NOT persona. Every driver signs in through staff OTP,
  /// which mints `persona: "staff"` exactly as it does for a teacher — the
  /// "field" persona is a login label nothing in the codebase ever assigns,
  /// so routing on it sent every driver to the teacher home and left the bus
  /// screens unreachable. roleCode is already derived from their sis_staff
  /// designation at login, and is what actually tells them apart.
  Future<bool> isTransportCrew() async {
    final rc = (await roleCode())?.toLowerCase() ?? "";
    return RegExp(r"driver|conductor|attendant|transport").hasMatch(rc);
  }

  /// principal / owner / admin / director style roles get the school-wide
  /// snapshot home instead of the teacher home (mirror of the server's
  /// isPrincipalLikeRole).
  Future<bool> isPrincipalLike() async {
    final rc = (await roleCode())?.toLowerCase() ?? "";
    return RegExp(
      r"principal|owner|admin|director|hm|head.?master",
    ).hasMatch(rc);
  }

  /// Runs just before the session is cleared on sign-out (push token
  /// unregister needs the cookie to still be present). Set by the app shell.
  Future<void> Function()? beforeSignOut;

  Future<void> signOut() async {
    try {
      await beforeSignOut?.call();
    } catch (_) {
      /* best-effort */
    }
    await _storage.delete(key: _cookieKey);
    await _storage.delete(key: _guardianKey);
    await _storage.delete(key: _personaKey);
    await _storage.delete(key: _roleKey);
  }

  Future<void> _storeSession(Map<String, dynamic>? session) async {
    final name = session?["fullName"] as String?;
    if (name != null) await _storage.write(key: _guardianKey, value: name);
    final persona = session?["persona"] as String?;
    if (persona != null) await _storage.write(key: _personaKey, value: persona);
    final role = session?["roleCode"] as String?;
    if (role != null) await _storage.write(key: _roleKey, value: role);
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
    } catch (_) {
      /* keep default */
    }
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

  /// Step 1 — send the WhatsApp OTP to a registered staff mobile.
  Future<String> requestStaffOtp(String mobile) async {
    final res = await http.post(
      _uri("/api/auth/staff-otp/request"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({"mobile": mobile}),
    );
    if (res.statusCode != 200) _throwFrom(res);
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return (body["maskedMobile"] as String?) ?? "your WhatsApp";
  }

  /// Step 2 — verify the staff OTP; the ERP mints the session cookie.
  Future<void> verifyStaffOtp(String mobile, String code) async {
    final res = await http.post(
      _uri("/api/auth/staff-otp/verify"),
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
      } catch (_) {
        /* keep default */
      }
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
  Future<void> devLogin({
    String? householdId,
    String persona = "parent",
    String? staffId,
    String? roleCode,
  }) async {
    final res = await http.post(
      _uri("/api/auth/demo"),
      headers: {"Content-Type": "application/json"},
      body: jsonEncode({
        "persona": persona,
        if (householdId != null && householdId.isNotEmpty)
          "householdId": householdId,
        if (staffId != null && staffId.isNotEmpty) "staffId": staffId,
        if (roleCode != null && roleCode.isNotEmpty) "roleCode": roleCode,
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

  Future<Map<String, dynamic>> _getData(String path) async {
    final res = await http.get(_uri(path), headers: await _authHeaders());
    if (res.statusCode != 200) _throwFrom(res);
    final body = jsonDecode(res.body) as Map<String, dynamic>;
    return body["data"] as Map<String, dynamic>;
  }

  Future<Map<String, dynamic>> _postData(
    String path,
    Map<String, dynamic> body,
  ) async {
    final res = await http.post(
      _uri(path),
      headers: await _authHeaders(),
      body: jsonEncode(body),
    );
    if (res.statusCode != 200) _throwFrom(res);
    final decoded = jsonDecode(res.body) as Map<String, dynamic>;
    return (decoded["data"] as Map<String, dynamic>?) ?? const {};
  }

  /// FCM device token → signed-in subject (parent household / staff).
  Future<void> registerPushToken({
    required String token,
    required String platform,
    String appVersion = "",
  }) async {
    await _postData("/api/v1/push/register", {
      "token": token,
      "platform": platform,
      "appVersion": appVersion,
    });
  }

  Future<void> unregisterPushToken(String token) async {
    final res = await http.delete(
      _uri("/api/v1/push/register"),
      headers: await _authHeaders(),
      body: jsonEncode({"token": token}),
    );
    if (res.statusCode != 200) _throwFrom(res);
  }

  /* ─── AI tutor (parent) ─────────────────────────────────────────── */

  /// The tutor's state for one child — a pass is per child, and the
  /// tutor is pinned to that child's class by the school's record.
  Future<TutorStatus> fetchTutorStatus(
    String studentId,
  ) async => TutorStatus.fromJson(
    await _getData(
      "/api/v1/tutor/status?studentId=${Uri.encodeQueryComponent(studentId)}",
    ),
  );

  /// Starts buying a pass for one child; the returned checkout URL opens
  /// in the browser and the pass switches on by itself once the bank
  /// confirms.
  Future<TutorBuyResult> buyTutorPass({
    required String planCode,
    required String studentId,
  }) async => TutorBuyResult.fromJson(
    await _postData("/api/v1/tutor/buy", {
      "planCode": planCode,
      "studentId": studentId,
    }),
  );

  /// Asks the tutor and yields the reply as it is written: [TutorDelta]s
  /// carry text slices, one [TutorDone] closes the reply. A refusal (the
  /// allowance is spent) surfaces as a [TutorRefused] exception so the
  /// screen can offer passes; anything else is an [ApiException].
  /// A child's class and subject teachers, the school's contact hours,
  /// and per-teacher WhatsApp links that go to the SCHOOL's number with
  /// the message pre-addressed (the school relays it; teachers' own
  /// numbers are never shown). Links come only while the window is open.
  Future<TeacherContacts> fetchTeacherContacts({
    required String studentId,
    bool hindi = false,
  }) async => TeacherContacts.fromJson(
    await _getData(
      "/api/v1/teachers/contacts?studentId=${Uri.encodeQueryComponent(studentId)}${hindi ? "&lang=hi" : ""}",
    ),
  );

  /// YouTube videos for a topic at the child's class level — a search,
  /// not the tutor, so no pass is needed. Falls back to a search link
  /// when the school has no YouTube API key.
  Future<TutorVideos> fetchTutorVideos({
    required String studentId,
    required String topic,
    required String language,
  }) async => TutorVideos.fromJson(
    await _postData("/api/v1/tutor/videos", {
      "studentId": studentId,
      "topic": topic,
      "language": language,
    }),
  );

  Stream<TutorEvent> askTutorStream({
    required String message,
    required String mode,
    required List<TutorTurn> history,
    required Map<String, String> context,
    String? studentId,
    String language = "auto",
  }) async* {
    final client = http.Client();
    try {
      final req = http.Request("POST", _uri("/api/v1/tutor/ask"))
        ..headers.addAll(await _authHeaders())
        ..headers["Accept"] = "text/event-stream"
        ..body = jsonEncode({
          "message": message,
          "mode": mode,
          "history": [
            for (final t in history) {"role": t.role, "content": t.content},
          ],
          "context": context,
          "studentId": ?studentId,
          "language": language,
        });
      final res = await client.send(req);
      if (res.statusCode != 200) {
        final body = await res.stream.bytesToString();
        Map<String, dynamic> j = const {};
        try {
          j = jsonDecode(body) as Map<String, dynamic>;
        } catch (_) {
          /* not JSON */
        }
        final err = j["error"];
        final message = err is String
            ? err
            : err is Map && err["message"] is String
            ? err["message"] as String
            : "Tutor unavailable (${res.statusCode})";
        if (res.statusCode == 402) {
          throw TutorRefused(
            message,
            needsPass: j["needsPass"] == true,
            allowance: j["allowance"] is Map
                ? TutorAllowance.fromJson(
                    Map<String, dynamic>.from(j["allowance"] as Map),
                  )
                : null,
          );
        }
        throw ApiException(message, res.statusCode);
      }
      // One event per "data:" line; our server never splits an event
      // across lines, so a line splitter is the whole parser.
      await for (final line
          in res.stream
              .transform(utf8.decoder)
              .transform(const LineSplitter())) {
        if (!line.startsWith("data:")) continue;
        final payload = line.substring(5).trim();
        if (payload.isEmpty) continue;
        final j = jsonDecode(payload) as Map<String, dynamic>;
        switch (j["type"]) {
          case "delta":
            yield TutorDelta((j["text"] as String?) ?? "");
          case "done":
            yield TutorDone(
              reply: (j["reply"] as String?) ?? "",
              charge: (j["charge"] as String?) ?? "",
              allowance: j["allowance"] is Map
                  ? TutorAllowance.fromJson(
                      Map<String, dynamic>.from(j["allowance"] as Map),
                    )
                  : null,
            );
          case "error":
            throw ApiException((j["error"] as String?) ?? "Tutor failed", 503);
        }
      }
    } finally {
      client.close();
    }
  }

  /* ─── Principal / owner ─────────────────────────────────────────── */

  Future<DefaultersList> fetchDefaulters() async => DefaultersList.fromJson(
    await _getData("/api/v1/principal/lists?kind=defaulters"),
  );

  Future<RegistersList> fetchRegistersToday() async => RegistersList.fromJson(
    await _getData("/api/v1/principal/lists?kind=registers"),
  );

  Future<StaffAttendanceToday> fetchStaffAttendanceToday() async =>
      StaffAttendanceToday.fromJson(
        await _getData("/api/v1/principal/lists?kind=staff_attendance"),
      );

  Future<List<FollowUpLead>> fetchFollowUpsDue() async {
    final d = await _getData("/api/v1/principal/lists?kind=followups");
    return ((d["leads"] as List?) ?? const [])
        .map((l) => FollowUpLead.fromJson(l as Map<String, dynamic>))
        .toList();
  }

  Future<List<WaBroadcastTemplate>> fetchBroadcastTemplates() async {
    final d = await _getData("/api/v1/owner/templates");
    return ((d["templates"] as List?) ?? const [])
        .map((t) => WaBroadcastTemplate.fromJson(t as Map<String, dynamic>))
        .toList();
  }

  /// School-wide WhatsApp (+push) broadcast. Server defaults to dry-run;
  /// pass [dryRun]=false only after the user has confirmed the count.
  /// Either [body] (free text, 24h-window only) or [template] (+[variables]).
  Future<BroadcastResult> ownerBroadcast({
    required String audience, // "parents" | "staff"
    String body = "",
    WaBroadcastTemplate? template,
    Map<String, String> variables = const {},
    bool dryRun = true,
  }) async {
    final res = await http.post(
      _uri("/api/v1/owner/broadcast"),
      headers: await _authHeaders(),
      body: jsonEncode({
        "audience": audience,
        "dryRun": dryRun,
        if (template == null) "body": body,
        if (template != null)
          "template": {
            "name": template.metaName,
            "language": template.metaLanguage,
            "variableKeys": template.variables.map((v) => v.key).toList(),
            "variables": variables,
          },
      }),
    );
    if (res.statusCode != 200) _throwFrom(res);
    return BroadcastResult.fromJson(
      jsonDecode(res.body) as Map<String, dynamic>,
    );
  }

  Future<FeeLedger> fetchFeeLedger(String studentId) async =>
      FeeLedger.fromJson(await _getData("/api/v1/fees/ledger/$studentId"));

  /// Start an online payment for some of the household's open dues.
  ///
  /// Only due keys travel; the server recomputes what is owed, creates the
  /// pay-link, attaches the gateway checkout and — via its webhook — settles
  /// the receipt when the money lands. The app's part ends at opening the
  /// returned URL. Not a {data} envelope route, hence [postJson].
  Future<ParentCheckout> startParentCheckout({
    required List<String> dueKeys,
    required String studentId,
  }) async {
    final body = await postJson("/api/payments/parent-checkout", {
      "dueKeys": dueKeys,
      "studentId": studentId,
    });
    if (body["ok"] != true) {
      final err = body["error"];
      throw ApiException(
        err is String && err.isNotEmpty ? err : "Could not start payment",
        400,
      );
    }
    return ParentCheckout.fromJson(body);
  }

  // ---- profile & documents ----------------------------------------------

  Future<ParentProfile> fetchProfile() async =>
      ParentProfile.fromJson(await _getData("/api/v1/profile"));

  /// Only the fields the server lists as editable are sent; it validates
  /// formats and returns the household as now stored.
  Future<HouseholdProfile> updateHousehold(Map<String, String> fields) async {
    final data = await _postData("/api/v1/profile/household", fields);
    return HouseholdProfile.fromJson(
      (data["household"] as Map<String, dynamic>?) ?? const {},
    );
  }

  /// Upload one document for one child. The server checks the bytes, reads
  /// the text on it against the child's record, stores it, and marks it
  /// "pending" for the office. Its message is what the parent should see.
  Future<DocumentSubmitResult> uploadStudentDocument({
    required String studentId,
    required String docKey,
    required String filePath,
    required String fileName,
    required String mimeType,
  }) async {
    final req = http.MultipartRequest("POST", _uri("/api/v1/profile/document"));
    final headers = await _authHeaders();
    headers.remove("Content-Type");
    req.headers.addAll(headers);
    req.fields["studentId"] = studentId;
    req.fields["docKey"] = docKey;
    req.files.add(
      await http.MultipartFile.fromPath(
        "file",
        filePath,
        filename: fileName,
        contentType: MediaType.parse(mimeType),
      ),
    );
    final streamed = await req.send();
    final res = await http.Response.fromStream(streamed);
    if (res.statusCode != 200) _throwFrom(res);
    final decoded = jsonDecode(res.body) as Map<String, dynamic>;
    return DocumentSubmitResult.fromJson(
      (decoded["data"] as Map<String, dynamic>?) ?? const {},
    );
  }

  /// Headers for loading a stored document image straight into a widget.
  Future<Map<String, String>> imageHeaders() async {
    final h = await _authHeaders();
    h.remove("Content-Type");
    return h;
  }

  // ---- receipts ---------------------------------------------------------

  Future<List<ReceiptInfo>> fetchReceipts() async {
    final data = await _getData("/api/v1/receipts");
    return ((data["receipts"] as List?) ?? const [])
        .map((r) => ReceiptInfo.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  /// The receipt PDF's bytes, fetched with the session — the browser could
  /// not open the link on its own, it has no cookie.
  Future<List<int>> fetchReceiptPdf(String pdfUrl) async {
    final res = await http.get(_uri(pdfUrl), headers: await imageHeaders());
    if (res.statusCode != 200) _throwFrom(res);
    return res.bodyBytes;
  }

  // ---- transport --------------------------------------------------------

  Future<MyTransport> fetchMyTransport() async =>
      MyTransport.fromJson(await _getData("/api/v1/transport/mine"));

  Future<String> requestTransport({
    required String studentId,
    required String pickupAddress,
    required String locality,
    required String landmark,
    required String preferredStop,
    required String note,
  }) async {
    final data = await _postData("/api/v1/transport/request", {
      "studentId": studentId,
      "pickupAddress": pickupAddress,
      "locality": locality,
      "landmark": landmark,
      "preferredStop": preferredStop,
      "note": note,
    });
    return (data["id"] as String?) ?? "";
  }

  /// Staff: the office queue. status = active | open | contacted | assigned | declined.
  Future<List<TransportRequestInfo>> fetchTransportRequests({
    String status = "active",
  }) async {
    final data = await _getData("/api/v1/transport/requests?status=$status");
    return ((data["requests"] as List?) ?? const [])
        .map((r) => TransportRequestInfo.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  Future<void> updateTransportRequest({
    required String id,
    required String status,
    String note = "",
  }) async {
    await _postData("/api/v1/transport/requests/$id", {
      "status": status,
      "note": note,
    });
  }

  Future<EbookShelf> fetchEbookShelf() async =>
      EbookShelf.fromJson(await _getData("/api/v1/library/ebooks"));

  // ---- leave --------------------------------------------------------------

  Future<LeaveList> fetchLeaveList({String? studentId}) async =>
      LeaveList.fromJson(
        await _getData(
          studentId == null
              ? "/api/v1/leave/list"
              : "/api/v1/leave/list?studentId=$studentId",
        ),
      );

  /// Returns the new request's id. The server validates dates, the half-day
  /// rule and ownership; its message is what the parent should see.
  Future<String> requestLeave({
    required String studentId,
    required String fromDate,
    required String toDate,
    required String leaveType,
    required String reason,
  }) async {
    final data = await _postData("/api/v1/leave/request", {
      "studentId": studentId,
      "fromDate": fromDate,
      "toDate": toDate,
      "leaveType": leaveType,
      "reason": reason,
    });
    return (data["id"] as String?) ?? "";
  }

  Future<void> cancelLeave(String id) async {
    await _postData("/api/v1/leave/cancel", {"id": id});
  }

  // ---- complaints ---------------------------------------------------------

  Future<ComplaintList> fetchComplaints() async =>
      ComplaintList.fromJson(await _getData("/api/v1/complaints/list"));

  /// Returns the new ticket's id.
  Future<String> createComplaint({
    String? studentId,
    required String category,
    required String subject,
    required String description,
  }) async {
    final data = await _postData("/api/v1/complaints/create", {
      if (studentId != null && studentId.isNotEmpty) "studentId": studentId,
      "category": category,
      "subject": subject,
      "description": description,
    });
    return (data["id"] as String?) ?? "";
  }

  Future<AttendanceHistory> fetchAttendanceHistory(
    String studentId, {
    int days = 90,
  }) async => AttendanceHistory.fromJson(
    await _getData("/api/v1/parent/attendance?studentId=$studentId&days=$days"),
  );

  /// Parent form: pass studentId. Staff form: pass classId+sectionId.
  Future<HomeworkFeed> fetchHomeworkFeed({
    String? studentId,
    String? classId,
    String? sectionId,
  }) async {
    final query = studentId != null
        ? "studentId=$studentId"
        : "classId=$classId&sectionId=$sectionId";
    return HomeworkFeed.fromJson(
      await _getData("/api/v1/homework/feed?$query"),
    );
  }

  Future<void> postHomework({
    required String classId,
    required String sectionId,
    required String subjectId,
    required String title,
    required String bodyEn,
  }) async {
    await _postData("/api/v1/homework/post", {
      "classId": classId,
      "sectionId": sectionId,
      "subjectId": subjectId,
      "title": title,
      "bodyEn": bodyEn,
    });
  }

  Future<List<CommsItem>> fetchCommsFeed() async {
    final data = await _getData("/api/v1/comms/feed");
    return [
      ...((data["notices"] as List?) ?? const []).map((raw) {
        final n = raw as Map<String, dynamic>;
        return CommsItem(
          title: (n["title"] as String?) ?? "",
          body: (n["body"] as String?) ?? "",
          publishedAt: (n["publishedAt"] as String?) ?? "",
          pinned: n["pinned"] == true,
          isNews: false,
          summary: "",
        );
      }),
      ...((data["news"] as List?) ?? const []).map((raw) {
        final n = raw as Map<String, dynamic>;
        return CommsItem(
          title: (n["title"] as String?) ?? "",
          body: (n["body"] as String?) ?? "",
          publishedAt: (n["publishedAt"] as String?) ?? "",
          pinned: false,
          isNews: true,
          summary: (n["summary"] as String?) ?? "",
        );
      }),
    ];
  }

  Future<List<PtmEventInfo>> fetchPtmOverview(String studentId) async {
    final data = await _getData("/api/v1/ptm/overview?studentId=$studentId");
    return ((data["events"] as List?) ?? const [])
        .map((e) => PtmEventInfo.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  Future<void> bookPtmSlot({
    required String eventId,
    required String slotId,
    required String studentId,
  }) async {
    await _postData("/api/v1/ptm/book", {
      "eventId": eventId,
      "slotId": slotId,
      "studentId": studentId,
    });
  }

  Future<void> cancelPtmBooking(String bookingId) async {
    await _postData("/api/v1/ptm/cancel", {"bookingId": bookingId});
  }

  Future<PrincipalSnapshot> fetchPrincipalSnapshot() async =>
      PrincipalSnapshot.fromJson(await _getData("/api/v1/principal/snapshot"));

  Future<List<TransportRouteInfo>> fetchTransportRoutes() async {
    final data = await _getData("/api/v1/transport/routes");
    return ((data["routes"] as List?) ?? const [])
        .map((r) => TransportRouteInfo.fromJson(r as Map<String, dynamic>))
        .toList();
  }

  /// Driver / attendant manifest: stops in boarding order with the children
  /// due at each, and what has already been marked today.
  Future<Map<String, dynamic>> fetchTransportManifest({
    required String routeId,
    required String trip,
  }) async =>
      _getData("/api/v1/transport/manifest?routeId=$routeId&trip=$trip");

  /// Mark one child on or off the bus. Location is required by the server for
  /// anything but "absent" — a mark with no pin is not evidence of anything.
  Future<void> markBoarding({
    required String routeId,
    required String studentId,
    required String trip,
    required String kind,
    double? lat,
    double? lng,
    double? accuracyM,
    String note = "",
  }) async {
    await _postData("/api/v1/transport/boarding", {
      "routeId": routeId,
      "studentId": studentId,
      "trip": trip,
      "kind": kind,
      "lat": ?lat,
      "lng": ?lng,
      "accuracyM": ?accuracyM,
      "note": note,
    });
  }

  /// Staff (class teacher) inbox: one thread per student in their section.
  Future<List<ChatThreadInfo>> fetchChatThreads() async {
    final data = await _getData("/api/v1/chat/threads");
    return ((data["threads"] as List?) ?? const [])
        .map((t) => ChatThreadInfo.fromJson(t as Map<String, dynamic>))
        .toList();
  }

  Future<ChatThread> fetchChatThread(String studentId) async =>
      ChatThread.fromJson(
        await _getData("/api/v1/chat/thread?studentId=$studentId"),
      );

  Future<void> sendChatMessage({
    required String studentId,
    required String body,
  }) async {
    await _postData("/api/v1/chat/send", {
      "studentId": studentId,
      "body": body,
    });
  }

  Future<PunchState> fetchPunchState() async =>
      PunchState.fromJson(await _getData("/api/v1/staff/attendance/punch"));

  Future<PunchResult> punchAttendance({
    required String kind,
    required double lat,
    required double lng,
    double? accuracyM,
    bool mocked = false,
  }) async {
    final data = await _postData("/api/v1/staff/attendance/punch", {
      "kind": kind,
      "lat": lat,
      "lng": lng,
      "accuracyM": ?accuracyM,
      "mocked": mocked,
    });
    return PunchResult(
      kind: (data["kind"] as String?) ?? kind,
      time: (data["time"] as String?) ?? "",
      distanceM: (data["distanceM"] as num?)?.toInt() ?? 0,
    );
  }

  /// Create or update a lesson plan. Returns its id.
  Future<String> saveLessonPlan({
    String? id,
    required String classId,
    required String subjectId,
    required String title,
    List<String> unitIds = const [],
    String plannedDate = "",
    int plannedPeriods = 1,
    String objectives = "",
    String teachingAids = "",
    String activities = "",
    String assessment = "",
    String homework = "",
  }) async {
    final data = await _postData("/api/v1/teaching/lesson-plan", {
      "id": ?id,
      "classId": classId,
      "subjectId": subjectId,
      "title": title,
      "unitIds": unitIds,
      "plannedDate": plannedDate,
      "plannedPeriods": plannedPeriods,
      "objectives": objectives,
      "teachingAids": teachingAids,
      "activities": activities,
      "assessment": assessment,
      "homework": homework,
    });
    return (data["id"] as String?) ?? "";
  }

  /// Classes with their linked subjects — the "which plan?" picker.
  Future<List<PlanTargetClass>> fetchTeachingSubjects() async {
    final data = await _getData("/api/v1/teaching/subjects");
    return ((data["classes"] as List?) ?? const [])
        .map((e) => PlanTargetClass.fromJson(e as Map<String, dynamic>))
        .toList();
  }

  /// OCR a photographed contents page into chapter candidates.
  /// Read-only — nothing is saved until [importSyllabus] is called.
  Future<SyllabusScan> scanSyllabusPage({
    required String imageBase64,
    String mimeType = "image/jpeg",
  }) async {
    final data = await _postData("/api/v1/teaching/syllabus-scan", {
      "imageBase64": imageBase64,
      "mimeType": mimeType,
    });
    return SyllabusScan.fromJson(data);
  }

  /// Save the chapters the teacher confirmed after a scan.
  Future<SyllabusImportSummary> importSyllabus({
    required String classId,
    required String subjectId,
    required List<Map<String, dynamic>> chapters,
  }) async {
    final data = await _postData("/api/v1/teaching/syllabus-import", {
      "classId": classId,
      "subjectId": subjectId,
      "chapters": chapters,
    });
    return SyllabusImportSummary(
      chaptersAdded: (data["chaptersAdded"] as num?)?.toInt() ?? 0,
      topicsAdded: (data["topicsAdded"] as num?)?.toInt() ?? 0,
      skipped: ((data["skipped"] as List?) ?? const [])
          .map((e) => e.toString())
          .toList(),
    );
  }

  Future<TeachingDay> fetchTeachingDay({String? date}) async {
    final query = date == null ? "" : "?date=$date";
    return TeachingDay.fromJson(await _getData("/api/v1/teaching/today$query"));
  }

  /// Record one period. [lat]/[lng] are optional on purpose: the log is
  /// what matters, and a teacher whose GPS is off or slow must still be
  /// able to file one. The server records "unknown" rather than guessing.
  Future<TeachingLogResult> logTeachingPeriod({
    required String date,
    required int periodNo,
    required String classId,
    required String sectionId,
    required String status,
    List<String> unitIds = const [],
    String lessonPlanId = "",
    String note = "",
    double? lat,
    double? lng,
    double? accuracyM,
  }) async {
    final data = await _postData("/api/v1/teaching/log", {
      "date": date,
      "periodNo": periodNo,
      "classId": classId,
      "sectionId": sectionId,
      "status": status,
      "unitIds": unitIds,
      "lessonPlanId": lessonPlanId,
      "note": note,
      "lat": ?lat,
      "lng": ?lng,
      "accuracyM": ?accuracyM,
    });
    return TeachingLogResult(
      status: (data["status"] as String?) ?? status,
      locationCheck: (data["locationCheck"] as String?) ?? "unknown",
      distanceM: (data["locationDistanceM"] as num?)?.toInt(),
    );
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

/* ─── AI tutor models ──────────────────────────────────────────────── */

class TutorTurn {
  const TutorTurn(this.role, this.content);

  final String role; // user | assistant
  final String content;
}

sealed class TutorEvent {
  const TutorEvent();
}

class TutorDelta extends TutorEvent {
  const TutorDelta(this.text);

  final String text;
}

class TutorDone extends TutorEvent {
  const TutorDone({
    required this.reply,
    required this.charge,
    required this.allowance,
  });

  final String reply;
  final String charge; // free | pass
  final TutorAllowance? allowance;
}

/// The server said no — the free hints are used up, or the mode needs a
/// pass. Carries the fresh allowance so the screen can explain.
class TutorRefused implements Exception {
  TutorRefused(this.message, {required this.needsPass, this.allowance});

  final String message;
  final bool needsPass;
  final TutorAllowance? allowance;

  @override
  String toString() => message;
}

class TutorAllowance {
  const TutorAllowance({
    required this.studentName,
    required this.classLabel,
    required this.freeHintsPerDay,
    required this.freeUsedToday,
    required this.passValidLabel,
    required this.passPlanLabel,
    required this.passEndsAt,
    required this.passMessagesPerDay,
    required this.passUsedToday,
  });

  factory TutorAllowance.fromJson(Map<String, dynamic> j) {
    final pass = j["pass"] is Map
        ? Map<String, dynamic>.from(j["pass"] as Map)
        : null;
    return TutorAllowance(
      studentName: (j["studentName"] as String?) ?? "",
      classLabel: (j["classLabel"] as String?) ?? "",
      freeHintsPerDay: (j["freeHintsPerDay"] as num?)?.toInt() ?? 0,
      freeUsedToday: (j["freeUsedToday"] as num?)?.toInt() ?? 0,
      passValidLabel: (j["passValidLabel"] as String?) ?? "",
      passPlanLabel: (pass?["planLabel"] as String?) ?? "",
      passEndsAt: (pass?["endsAt"] as String?) ?? "",
      passMessagesPerDay: (j["passMessagesPerDay"] as num?)?.toInt() ?? 0,
      passUsedToday: (j["passUsedToday"] as num?)?.toInt() ?? 0,
    );
  }

  final String studentName;
  final String classLabel;
  final int freeHintsPerDay;
  final int freeUsedToday;
  final String passValidLabel;
  final String passPlanLabel;
  final String passEndsAt;
  final int passMessagesPerDay;
  final int passUsedToday;

  String get studentFirstName =>
      studentName.isEmpty ? "this child" : studentName.split(" ").first;

  bool get hasPass =>
      passEndsAt.isNotEmpty &&
      (DateTime.tryParse(passEndsAt)?.isAfter(DateTime.now()) ?? false);
  int get freeLeft => (freeHintsPerDay - freeUsedToday).clamp(0, 1 << 30);

  /// "Valid till 12 Sep" from the end date when the server label is absent
  /// (a streamed allowance carries the pass, not the label).
  String get validLabel {
    if (passValidLabel.isNotEmpty) return passValidLabel;
    final d = DateTime.tryParse(passEndsAt);
    if (d == null) return "";
    final ist = d.toUtc().add(const Duration(hours: 5, minutes: 30));
    const months = [
      "Jan",
      "Feb",
      "Mar",
      "Apr",
      "May",
      "Jun",
      "Jul",
      "Aug",
      "Sep",
      "Oct",
      "Nov",
      "Dec",
    ];
    return "Valid till ${ist.day} ${months[ist.month - 1]}";
  }
}

class TutorModeInfo {
  const TutorModeInfo({
    required this.code,
    required this.label,
    required this.blurb,
    required this.paid,
    required this.prompt,
  });

  factory TutorModeInfo.fromJson(Map<String, dynamic> j) => TutorModeInfo(
    code: (j["code"] as String?) ?? "hint",
    label: (j["label"] as String?) ?? "",
    blurb: (j["blurb"] as String?) ?? "",
    paid: j["paid"] == true,
    prompt: (j["prompt"] as String?) ?? "",
  );

  final String code;
  final String label;
  final String blurb;
  final bool paid;
  final String prompt;
}

class TutorPlanInfo {
  const TutorPlanInfo({
    required this.code,
    required this.label,
    required this.days,
    required this.priceLabel,
  });

  factory TutorPlanInfo.fromJson(Map<String, dynamic> j) => TutorPlanInfo(
    code: (j["code"] as String?) ?? "",
    label: (j["label"] as String?) ?? "",
    days: (j["days"] as num?)?.toInt() ?? 0,
    priceLabel: (j["priceLabel"] as String?) ?? "",
  );

  final String code;
  final String label;
  final int days;
  final String priceLabel;
}

class TutorOrderInfo {
  const TutorOrderInfo({
    required this.id,
    required this.days,
    required this.amountLabel,
    required this.status,
    required this.checkoutUrl,
    required this.validLabel,
  });

  factory TutorOrderInfo.fromJson(Map<String, dynamic> j) => TutorOrderInfo(
    id: (j["id"] as String?) ?? "",
    days: (j["days"] as num?)?.toInt() ?? 0,
    amountLabel: (j["amountLabel"] as String?) ?? "",
    status: (j["status"] as String?) ?? "",
    checkoutUrl: (j["checkoutUrl"] as String?) ?? "",
    validLabel: (j["validLabel"] as String?) ?? "",
  );

  final String id;
  final int days;
  final String amountLabel;
  final String status;
  final String checkoutUrl;
  final String validLabel;
}

class TutorVideo {
  const TutorVideo({
    required this.videoId,
    required this.title,
    required this.channel,
    required this.thumbnail,
    required this.url,
  });

  factory TutorVideo.fromJson(Map<String, dynamic> j) => TutorVideo(
    videoId: (j["videoId"] as String?) ?? "",
    title: (j["title"] as String?) ?? "",
    channel: (j["channel"] as String?) ?? "",
    thumbnail: (j["thumbnail"] as String?) ?? "",
    url: (j["url"] as String?) ?? "",
  );

  final String videoId;
  final String title;
  final String channel;
  final String thumbnail;
  final String url;
}

class TutorVideos {
  const TutorVideos({
    required this.query,
    required this.searchUrl,
    required this.items,
  });

  factory TutorVideos.fromJson(Map<String, dynamic> j) => TutorVideos(
    query: (j["query"] as String?) ?? "",
    searchUrl: (j["searchUrl"] as String?) ?? "",
    items: [
      for (final v in (j["items"] as List? ?? const []))
        TutorVideo.fromJson(Map<String, dynamic>.from(v as Map)),
    ],
  );

  final String query;
  final String searchUrl;
  final List<TutorVideo> items;
}

class TutorStatus {
  const TutorStatus({
    required this.configured,
    required this.defaultLanguage,
    required this.videosAvailable,
    required this.modes,
    required this.allowance,
    required this.plans,
    required this.orders,
    required this.note,
  });

  factory TutorStatus.fromJson(Map<String, dynamic> j) => TutorStatus(
    configured: j["configured"] == true,
    defaultLanguage: switch (j["defaultLanguage"]) {
      "hi" => "hi",
      "both" => "both",
      _ => "en",
    },
    videosAvailable: j["videosAvailable"] == true,
    modes: [
      for (final m in (j["modes"] as List? ?? const []))
        TutorModeInfo.fromJson(Map<String, dynamic>.from(m as Map)),
    ],
    allowance: TutorAllowance.fromJson(
      Map<String, dynamic>.from((j["allowance"] as Map?) ?? const {}),
    ),
    plans: [
      for (final p in (j["plans"] as List? ?? const []))
        TutorPlanInfo.fromJson(Map<String, dynamic>.from(p as Map)),
    ],
    orders: [
      for (final o in (j["orders"] as List? ?? const []))
        TutorOrderInfo.fromJson(Map<String, dynamic>.from(o as Map)),
    ],
    note: (j["note"] as String?) ?? "",
  );

  final bool configured;

  /// "hi", "both" or "en" — from the family's language preference on record.
  final String defaultLanguage;
  final bool videosAvailable;
  final List<TutorModeInfo> modes;
  final TutorAllowance allowance;
  final List<TutorPlanInfo> plans;
  final List<TutorOrderInfo> orders;
  final String note;
}

class TutorBuyResult {
  const TutorBuyResult({
    required this.orderId,
    required this.planLabel,
    required this.amountLabel,
    required this.checkoutUrl,
  });

  factory TutorBuyResult.fromJson(Map<String, dynamic> j) => TutorBuyResult(
    orderId: (j["orderId"] as String?) ?? "",
    planLabel: (j["planLabel"] as String?) ?? "",
    amountLabel: (j["amountLabel"] as String?) ?? "",
    checkoutUrl: (j["checkoutUrl"] as String?) ?? "",
  );

  final String orderId;
  final String planLabel;
  final String amountLabel;
  final String checkoutUrl;
}


/* ─── Teacher contacts ─────────────────────────────────────────────── */

class TeacherContact {
  const TeacherContact({
    required this.staffId,
    required this.name,
    required this.role,
    required this.isClassTeacher,
    required this.chatInApp,
    required this.waUrl,
  });

  factory TeacherContact.fromJson(Map<String, dynamic> j) => TeacherContact(
    staffId: (j["staffId"] as String?) ?? "",
    name: (j["name"] as String?) ?? "",
    role: (j["role"] as String?) ?? "",
    isClassTeacher: j["isClassTeacher"] == true,
    chatInApp: j["chatInApp"] == true,
    waUrl: (j["waUrl"] as String?) ?? "",
  );

  final String staffId;
  final String name;
  final String role;
  final bool isClassTeacher;
  final bool chatInApp;
  /// Empty outside the school's contact hours.
  final String waUrl;
}

class TeacherContacts {
  const TeacherContacts({
    required this.studentName,
    required this.classLabel,
    required this.hoursLabel,
    required this.hoursOpen,
    required this.hoursNote,
    required this.schoolWhatsAppDisplay,
    required this.teachers,
  });

  factory TeacherContacts.fromJson(Map<String, dynamic> j) {
    final st = Map<String, dynamic>.from((j["student"] as Map?) ?? const {});
    final h = Map<String, dynamic>.from((j["hours"] as Map?) ?? const {});
    final w = j["whatsapp"] is Map
        ? Map<String, dynamic>.from(j["whatsapp"] as Map)
        : const <String, dynamic>{};
    return TeacherContacts(
      studentName: (st["name"] as String?) ?? "",
      classLabel: (st["classLabel"] as String?) ?? "",
      hoursLabel: (h["label"] as String?) ?? "8 AM – 8 PM",
      hoursOpen: h["open"] == true,
      hoursNote: (h["note"] as String?) ?? "",
      schoolWhatsAppDisplay: (w["display"] as String?) ?? "",
      teachers: [
        for (final t in (j["teachers"] as List? ?? const []))
          TeacherContact.fromJson(Map<String, dynamic>.from(t as Map)),
      ],
    );
  }

  final String studentName;
  final String classLabel;
  final String hoursLabel;
  final bool hoursOpen;
  final String hoursNote;
  final String schoolWhatsAppDisplay;
  final List<TeacherContact> teachers;
}
