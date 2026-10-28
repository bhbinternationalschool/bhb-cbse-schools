import { CRUD, type RbacFeatureDef, type RbacWholeModuleTab } from "@/lib/rbacFeatureCatalog/types";

/**
 * Academics — attendance, exams, homework, timetable, student leave, PTM.
 * Wired 6 Oct 2026 on each module's school-data desk route (lib/
 * deskFeatureGate.server) and, for exam marks, the one-sheet save.
 *
 * Desks that refuse a teacher's whole-desk push (attendance registers,
 * staff register, exam setup, student leave, PTM) keep refusing it on the
 * function path: a teacher acts for their own classes through the
 * per-class routes (attendance mark, exam sheet, leave decide, PTM slots).
 * Class-scoped functions are checked row by row against the classes the
 * person teaches.
 *
 * Not listed here, and why:
 *   online_classes — every save is a /api/v1 route (assertPermission), which
 *                    function grants do not reach;
 *   teaching       — saved as a domain blob and through /api/v1/teaching;
 *   question_bank, cbse_loc — no screen or store yet (Coming soon). The
 *                    exam question bank is Exams → Question papers.
 *   Exams → Seating — rooms and seating plans persist only in the exams
 *                    blob (the setup push does not carry them), which a
 *                    function grant cannot write; left with the module.
 *
 * Dashboards are opened by a read-only function that owns every list the
 * dashboard counts (an office person's browser with only part of the desk
 * would show false zeros otherwise). View-only functions never pass the
 * desk's row check, so they cannot write.
 */
export const ACADEMICS_FEATURES: RbacFeatureDef[] = [
  /* ── Attendance (attendance-registers, staff-attendance-registers) ── */
  {
    id: "attendance.student_register",
    module: "attendance",
    label: "Student register",
    blurb: "Mark and correct the daily student register — own classes only.",
    actions: CRUD,
    slices: ["registers"],
    classScoped: true,
    tabs: ["students", "month"],
  },
  {
    id: "attendance.policy",
    module: "attendance",
    label: "Attendance cut-off & nudges",
    blurb: "The teachers' marking cut-off time and the absent-parent nudge settings.",
    actions: ["view", "edit"],
    slices: ["policy"],
    tabs: ["students"],
  },
  {
    id: "attendance.exceptions",
    module: "attendance",
    label: "Attendance exceptions",
    blurb: "Registers not marked, late marking and other exceptions — review and close them.",
    actions: ["view", "create", "edit"],
    slices: ["exceptions"],
    tabs: ["exceptions"],
  },
  {
    id: "attendance.staff_register",
    module: "attendance",
    label: "Staff attendance register",
    blurb: "The daily staff register and outdoor duty.",
    actions: CRUD,
    // The staff desk's keys, prefixed so they never meet the student
    // desk's "registers" (route: staff-attendance-registers).
    slices: ["staff/registers", "staff/outdoorDuty"],
    tabs: ["staff", "staff-reports"],
  },
  {
    id: "attendance.staff_rules",
    module: "attendance",
    label: "Staff attendance rules",
    blurb: "Self-punch, late and half-day rules, leave overlay and who is exempt.",
    actions: ["view", "edit"],
    slices: ["staff/settings", "module-state/staff_attendance_rules"],
    tabs: ["staff"],
  },
  {
    id: "attendance.reports",
    module: "attendance",
    group: "Reports",
    label: "Attendance dashboard & reports (read only)",
    blurb:
      "Today's attendance dashboard and the student and staff attendance reports. Export lets you download them. Changes nothing — a teacher sees only their own classes.",
    actions: ["view", "export"],
    // Read-only, and no slices (a slice has one owner — the register
    // functions). attendance-registers and staff-attendance-registers serve
    // this function every register, after cutting a teacher's copy to
    // their own sections.
    tabs: ["dashboard", "student-reports", "staff-reports"],
  },

  /* ── Exams (exams-desk, exams-desk/sheet, desk-slice exam_papers) ── */
  {
    id: "exams.setup",
    module: "exams",
    label: "Exams, subjects & policy",
    blurb: "Exam terms, exam subjects, grading and the pass / report-card policy.",
    actions: CRUD,
    slices: ["terms", "subjects", "policy"],
    tabs: ["setup"],
  },
  {
    id: "exams.date_sheet",
    module: "exams",
    label: "Date sheet & admit cards",
    blurb: "Which paper is on which day, and the admit cards printed from it.",
    actions: CRUD,
    slices: ["dateSheet"],
    tabs: ["datesheet", "admitcards"],
  },
  {
    id: "exams.invigilation",
    module: "exams",
    label: "Invigilation duty",
    blurb: "Who invigilates which room on which exam day.",
    actions: ["view", "edit"],
    slices: ["module-state/exam_invigilation"],
    tabs: ["invigilation"],
  },
  {
    id: "exams.marks",
    module: "exams",
    label: "Mark entry",
    blurb: "Enter marks, item scores and remarks, and lock a sheet — own classes only.",
    actions: ["view", "create", "edit"],
    // Sheets are saved one at a time through exams-desk/sheet, which checks
    // the section (stricter than class). Owning the slice here is what lets
    // the holder read them, and keeps a stray copy in a setup push checked.
    slices: ["sheets"],
    classScoped: true,
    tabs: ["marks", "items", "atrisk", "remarks"],
  },
  {
    id: "exams.results",
    module: "exams",
    label: "Report cards & promotion",
    blurb:
      "Report cards, results and the promotion decision for each child, and the exams dashboard. View alone is a read-only results and dashboard grant.",
    actions: ["view", "create", "edit"],
    slices: ["promotions"],
    // The dashboard counts every mark sheet and promotion — exactly what
    // this function is served (exams-desk serves it every sheet).
    tabs: ["dashboard", "reports", "results", "result_reports"],
  },
  {
    id: "exams.papers",
    module: "exams",
    label: "Question papers",
    blurb: "Question papers, the question bank and blueprints; import from files and Nucleus.",
    actions: CRUD,
    slices: [
      "exam_papers/papers",
      "exam_papers/bank",
      "exam_papers/blueprints",
      "exam_papers/importMappings",
    ],
    tabs: ["papers"],
    routes: ["/api/exams/papers/import", "/api/exams/papers/from-nucleus"],
  },

  /* ── Homework (homework-desk) ── */
  {
    id: "homework.assign",
    module: "homework",
    label: "Set homework",
    blurb: "Post homework for a class and subject — own classes only.",
    actions: CRUD,
    slices: ["posts"],
    classScoped: true,
    tabs: ["today", "compose", "classroom"],
  },
  {
    id: "homework.diary",
    module: "homework",
    label: "Class diary",
    blurb: "The class diary notes parents read — own classes only.",
    actions: CRUD,
    slices: ["diary"],
    classScoped: true,
    tabs: ["diary"],
  },
  {
    id: "homework.review",
    module: "homework",
    label: "Check submitted work",
    blurb: "See what children sent back, acknowledge it and reply.",
    actions: ["view", "edit"],
    // A submission carries no class of its own (only its post), so this is
    // not class-scoped here; a teacher's save still writes only the
    // submissions of their own posts (homeworkNormalized.server).
    slices: ["submissions"],
    tabs: ["submissions", "reports"],
  },
  {
    id: "homework.freeze",
    module: "homework",
    label: "Exam-time homework freeze",
    blurb: "Stop new homework being set during exams.",
    actions: ["view", "edit"],
    slices: ["settings"],
    tabs: ["today"],
  },
  {
    id: "homework.overview",
    module: "homework",
    group: "Reports",
    label: "Homework dashboard (read only)",
    blurb: "The homework dashboard: what was set, the diary and what came back, across the school. Changes nothing.",
    actions: ["view"],
    // No slices (each has one owner): homework-desk serves this function
    // the posts, diary and their submissions — every class, unless the
    // person also holds a class-limited homework function.
    tabs: ["dashboard"],
  },

  /* ── Timetable (timetable-desk) ── */
  {
    id: "timetable.setup",
    module: "timetable",
    label: "Bell schedule & working days",
    blurb: "Working days, the bell schedule, extra schedules and class-teacher-takes-all classes.",
    actions: ["view", "edit"],
    slices: ["workingWeekdays", "bellTemplate", "extraBellTemplates", "classTeacherAllClassIds"],
    tabs: ["setup"],
  },
  {
    id: "timetable.rules",
    module: "timetable",
    label: "Subject placement rules",
    blurb: "Doubles, time of day and daily limits per class subject.",
    actions: ["view", "edit"],
    slices: ["subjectRules"],
    tabs: ["rules"],
  },
  {
    id: "timetable.build",
    module: "timetable",
    label: "Build the timetable",
    blurb: "Place periods in the class grids, by hand or auto-assign — own classes only.",
    actions: CRUD,
    slices: ["grids"],
    classScoped: true,
    tabs: ["class", "auto", "teacher", "free_periods"],
  },
  {
    id: "timetable.publish",
    module: "timetable",
    label: "Publish the timetable",
    blurb: "Publish the draft so teachers, parents and the apps follow it.",
    actions: ["view", "edit"],
    slices: ["publishedGrids", "meta"],
    tabs: ["publish"],
  },
  {
    id: "timetable.substitutions",
    module: "timetable",
    label: "Substitutions",
    blurb: "Arrange cover when a teacher is absent.",
    actions: CRUD,
    slices: ["substitutions"],
    tabs: ["subs"],
  },
  {
    id: "timetable.reports",
    module: "timetable",
    group: "Reports",
    label: "Timetable dashboard & reports (read only)",
    blurb: "The timetable dashboard and its reports (class and teacher timetables, free periods, substitutions) — see and download. Changes nothing.",
    actions: ["view"],
    // No slices: a timetable function holder reads the whole timetable
    // (timetable-desk GET); what may change is decided per slice on POST.
    tabs: ["dashboard", "reports"],
  },

  /* ── Student leave (student-leave-desk; shown under Attendance) ── */
  {
    id: "student_leave.requests",
    module: "student_leave",
    label: "Student leave requests",
    // Approving or rejecting is an edit of the request's status here; the
    // module's own "approve" stays with the module grant.
    blurb: "Record leave requests and approve or reject them for the whole school.",
    actions: CRUD,
    slices: ["requests"],
    // "leave" is the Attendance screen's tab; the rest are the tabs inside it.
    // The desk push is the office's (unrestricted scope) — a class teacher
    // decides their own classes on the teacher view instead.
    tabs: ["leave", "dashboard", "pending", "all", "apply"],
  },
  {
    id: "student_leave.reports",
    module: "student_leave",
    group: "Reports",
    label: "Student leave dashboard & reports (read only)",
    blurb: "The leave dashboard and leave reports for the whole school — see and download. Changes nothing.",
    actions: ["view"],
    // No slice ("requests" is owned by Student leave requests):
    // student-leave-desk serves this function every request, read only.
    tabs: ["leave", "dashboard", "reports"],
  },

  /* ── PTM (ptm-desk) ── */
  {
    id: "ptm.events",
    module: "ptm",
    label: "PTM events",
    blurb: "Plan a parent-teacher meeting: date, classes and mode.",
    actions: CRUD,
    slices: ["events"],
    tabs: ["dashboard", "events"],
  },
  {
    id: "ptm.slots",
    module: "ptm",
    label: "Meeting slots",
    blurb: "Teachers' time slots, rooms and links for each meeting.",
    actions: CRUD,
    slices: ["slots"],
    tabs: ["slots"],
  },
  {
    id: "ptm.bookings",
    module: "ptm",
    label: "Parent bookings",
    blurb: "Book parents into slots and track who came.",
    actions: CRUD,
    slices: ["bookings"],
    tabs: ["bookings"],
  },
  {
    id: "ptm.feedback",
    module: "ptm",
    label: "Meeting feedback",
    blurb: "Strengths, areas to work on and follow-up from each meeting.",
    actions: ["view", "create", "edit"],
    slices: ["feedback"],
    tabs: ["feedback", "reports"],
  },
];

/** Tabs of these modules that only the whole-module grant opens, and why. */
export const ACADEMICS_WHOLE_MODULE_TABS: RbacWholeModuleTab[] = [
  {
    module: "exams",
    tab: "seating",
    reason:
      "Exam rooms and seating plans persist only in the exams blob (the exams-desk setup push does not carry them), which a function grant cannot write.",
  },
  // Teaching: every save is a /api/v1/teaching/* route (assertPermission),
  // which function grants do not reach, and every teacher already holds the
  // module (the role sets give it to all teaching staff). A function would
  // open a tab whose saves the server refuses.
  ...(["today", "plan", "lessons", "coverage", "outcomes", "nucleus"] as const).map((tab) => ({
    module: "teaching" as const,
    tab,
    reason:
      "Teaching saves only through /api/v1/teaching/* (assertPermission on the module), which function grants do not reach; every teacher holds the whole Teaching module.",
  })),
];
