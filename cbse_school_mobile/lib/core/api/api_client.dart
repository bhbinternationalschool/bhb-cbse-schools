import "dart:convert";

import "package:flutter_secure_storage/flutter_secure_storage.dart";
import "package:http/http.dart" as http;

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

class FeeDue {
  const FeeDue({
    required this.label,
    required this.kind,
    required this.dueOn,
    required this.balanceLabel,
    required this.balancePaise,
  });

  factory FeeDue.fromJson(Map<String, dynamic> j) => FeeDue(
        label: (j["label"] as String?) ?? "",
        kind: (j["kind"] as String?) ?? "",
        dueOn: (j["dueOn"] as String?) ?? "",
        balanceLabel: (j["balanceLabel"] as String?) ?? "₹0",
        balancePaise: (j["balancePaise"] as num?)?.toInt() ?? 0,
      );

  final String label;
  final String kind;
  final String dueOn;
  final String balanceLabel;
  final int balancePaise;
}

class FeeLedger {
  const FeeLedger({
    required this.studentName,
    required this.openDues,
    required this.openBalanceLabel,
  });

  factory FeeLedger.fromJson(Map<String, dynamic> j) => FeeLedger(
        studentName: (j["studentName"] as String?) ?? "",
        openDues: ((j["openDues"] as List?) ?? const [])
            .map((d) => FeeDue.fromJson(d as Map<String, dynamic>))
            .toList(),
        openBalanceLabel: (j["openBalanceLabel"] as String?) ?? "₹0",
      );

  final String studentName;
  final List<FeeDue> openDues;
  final String openBalanceLabel;
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
            .map((e) => (
                  date: (e["date"] as String?) ?? "",
                  status: (e["status"] as String?) ?? "",
                ))
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
        .map((s) => SubjectRef(
              id: s["id"] as String,
              name: (s["name"] as String?) ?? "",
            ))
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
            .map((e) => PlanTargetSubject(
                  id: ((e as Map)["id"] as String?) ?? "",
                  name: (e["name"] as String?) ?? "",
                ))
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
            .map((e) => ScannedTopic(
                  code: ((e as Map)["code"] as String?) ?? "",
                  title: (e["title"] as String?) ?? "",
                ))
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
        verdict:
            ((j["quality"] as Map?)?["verdict"] as String?) ?? "poor",
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
          .map((s) => TransportStopInfo(
                name: (s["name"] as String?) ?? "",
                sequence: (s["sequence"] as num?)?.toInt() ?? 0,
                distanceKm: (s["distanceKm"] as num?)?.toDouble() ?? 0,
                lat: (s["lat"] as num?)?.toDouble(),
                lng: (s["lng"] as num?)?.toDouble(),
              ))
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
            ((j["push"] as Map<String, dynamic>?)?["sent"] as num?)?.toInt() ??
                0,
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
  Future<Map<String, dynamic>> postJson(String path, Map<String, dynamic> body) async {
    final res = await http.post(_uri(path), headers: await _authHeaders(), body: jsonEncode(body));
    final decoded = jsonDecode(res.body.isEmpty ? "{}" : res.body) as Map<String, dynamic>;
    if (res.statusCode >= 500) _throwFrom(res);
    return decoded;
  }

  Future<String?> guardianName() => _storage.read(key: _guardianKey);

  Future<bool> hasSession() async =>
      (await sessionCookie())?.isNotEmpty == true;

  Future<String?> persona() => _storage.read(key: _personaKey);

  Future<String?> roleCode() => _storage.read(key: _roleKey);

  /// principal / owner / admin / director style roles get the school-wide
  /// snapshot home instead of the teacher home (mirror of the server's
  /// isPrincipalLikeRole).
  Future<bool> isPrincipalLike() async {
    final rc = (await roleCode())?.toLowerCase() ?? "";
    return RegExp(r"principal|owner|admin|director|hm|head.?master")
        .hasMatch(rc);
  }

  /// Runs just before the session is cleared on sign-out (push token
  /// unregister needs the cookie to still be present). Set by the app shell.
  Future<void> Function()? beforeSignOut;

  Future<void> signOut() async {
    try {
      await beforeSignOut?.call();
    } catch (_) {/* best-effort */}
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

  /* ─── Principal / owner ─────────────────────────────────────────── */

  Future<DefaultersList> fetchDefaulters() async => DefaultersList.fromJson(
      await _getData("/api/v1/principal/lists?kind=defaulters"));

  Future<RegistersList> fetchRegistersToday() async => RegistersList.fromJson(
      await _getData("/api/v1/principal/lists?kind=registers"));

  Future<StaffAttendanceToday> fetchStaffAttendanceToday() async =>
      StaffAttendanceToday.fromJson(
          await _getData("/api/v1/principal/lists?kind=staff_attendance"));

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
        jsonDecode(res.body) as Map<String, dynamic>);
  }

  Future<FeeLedger> fetchFeeLedger(String studentId) async =>
      FeeLedger.fromJson(await _getData("/api/v1/fees/ledger/$studentId"));

  Future<AttendanceHistory> fetchAttendanceHistory(
    String studentId, {
    int days = 90,
  }) async =>
      AttendanceHistory.fromJson(await _getData(
          "/api/v1/parent/attendance?studentId=$studentId&days=$days"));

  /// Parent form: pass studentId. Staff form: pass classId+sectionId.
  Future<HomeworkFeed> fetchHomeworkFeed({
    String? studentId,
    String? classId,
    String? sectionId,
  }) async {
    final query = studentId != null
        ? "studentId=$studentId"
        : "classId=$classId&sectionId=$sectionId";
    return HomeworkFeed.fromJson(await _getData("/api/v1/homework/feed?$query"));
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
    await _postData("/api/v1/chat/send", {"studentId": studentId, "body": body});
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
