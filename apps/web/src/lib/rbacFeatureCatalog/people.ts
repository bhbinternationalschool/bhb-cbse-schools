import { CRUD, type RbacFeatureDef, type RbacWholeModuleTab } from "@/lib/rbacFeatureCatalog/types";

/**
 * People — Admissions, RTE / EWS, Students, Staff, Certificates, ID cards.
 * Director, 6 Oct 2026: roles hold functions inside a module, not only the
 * whole module.
 *
 * Wired: admissions-desk and rte-desk (POST/GET merge per slice), the shared
 * desk-slice store (staff_hr/…, staff_agreements/…, certificates/…), the
 * module-state books, and the requireStaffPermission routes listed below.
 *
 * Left at module level on purpose (no function can stand in for them):
 * - the SIS roster (sis-roster): upserts with explicit deletes and merges,
 *   per-record version guards, and its own teacher-scoped read — a slice
 *   merge on top of that would be unsafe, so editing children needs Students;
 * - the staff records (sis.staff kernel writes since 2.2d — the bank, ID &
 *   pay fields are their own function), Documents (one AI screen, no store),
 *   Alumni and Scholarships (not built yet).
 */
export const PEOPLE_FEATURES: RbacFeatureDef[] = [
  // ── Admissions ─────────────────────────────────────────────────────────
  // Desk slices are AdmissionsState keys (admissions-desk). The number
  // counters (nextEnquirySeq …) belong to no function: the route moves them
  // forward for whoever adds a record, so a walk-in desk with "add" only
  // never reuses an enquiry number.
  {
    id: "admissions.leads",
    module: "admissions",
    label: "Enquiries & leads",
    blurb:
      "Walk-in enquiries, the lead list (CRM), follow-ups and lead uploads. Add only = a walk-in enquiry desk.",
    actions: CRUD,
    slices: ["leads", "households"],
    tabs: ["dashboard", "enquiry", "leads", "import", "reports"],
    routes: ["/api/wa/contacts-check"],
  },
  {
    id: "admissions.registration",
    module: "admissions",
    label: "Registration fees",
    blurb:
      "Record and attach registration fee payments. Moving the lead to Registered also needs Enquiries & leads (change).",
    actions: ["view", "create", "edit"],
    slices: ["registrationPayments"],
    tabs: ["registration"],
    routes: ["/api/payments/registration-attach"],
  },
  {
    id: "admissions.field_survey",
    module: "admissions",
    label: "Field survey",
    blurb:
      "Survey beats, the field team and their attendance, and who calls leads. Leads found in the field also need Enquiries & leads (add).",
    actions: CRUD,
    slices: [
      "surveyBeats",
      "surveyAttendance",
      "surveyExternals",
      "surveyTeam",
      "surveySessions",
      "leadCallerStaffIds",
    ],
    tabs: ["survey"],
  },
  {
    id: "admissions.campaigns",
    module: "admissions",
    label: "WhatsApp campaigns & parent chat",
    blurb: "Admission campaigns on WhatsApp and the CRM parent chat inbox.",
    actions: ["view", "edit"],
    slices: ["module-state/wa_campaigns", "module-state/crm_parent_chat"],
    tabs: ["campaigns", "crm_chat"],
  },
  {
    id: "admissions.knowledge_base",
    module: "admissions",
    label: "Admissions knowledge base",
    blurb: "The answers the admissions bot and the office give parents.",
    actions: ["view", "edit"],
    slices: ["module-state/admissions_kb"],
    tabs: ["kb"],
  },
  {
    id: "admissions.marketing",
    module: "admissions",
    label: "Marketing, referrals & stories",
    blurb: "Marketing spend, the school's achievements, referrals and parent testimonials.",
    actions: ["view", "edit"],
    slices: [
      "module-state/marketing_spend",
      "module-state/school_achievements",
      "module-state/referrals",
    ],
    tabs: ["marketing", "referrals"],
  },
  {
    id: "admissions.village_market",
    module: "admissions",
    label: "Village market",
    blurb:
      "Villages and wards around the school, spelling review, lead scoring and the family contact export (change).",
    actions: ["view", "edit"],
    tabs: ["village_market"],
    routes: [
      "/api/admissions/villages-nearby",
      "/api/admissions/city-wards",
      "/api/admissions/village-aliases",
      "/api/admissions/village-contacts",
      "/api/admissions/lead-intelligence",
    ],
  },
  {
    // Server tables (admission_entrance_*), not a desk slice — the route
    // below is the only door, and it checks the action per request.
    id: "admissions.entrance_test",
    module: "admissions",
    label: "Entrance test",
    blurb:
      "Admission test sittings, the roll and attendance sheet, marks, results (Selected / Waitlisted / Not selected) and messaging families (change).",
    actions: CRUD,
    tabs: ["entrance"],
    // notify: dry run (preview) asks view, sending asks edit.
    routes: ["/api/admissions/entrance-test", "/api/admissions/entrance-test/notify"],
  },

  // ── RTE / EWS ──────────────────────────────────────────────────────────
  // Slices are RteState keys (rte-desk). Tab "dashboard" is the Seats tab.
  {
    id: "rte.seats",
    module: "rte",
    label: "Quota seats & settings",
    blurb: "RTE / EWS seats per class, the mandated share and the fee-waiver rule.",
    actions: CRUD,
    slices: ["seats", "settings"],
    // "rte" is the RTE / EWS tab of the Admissions screen, which embeds
    // this module's own (function-gated) workspace.
    tabs: ["dashboard", "settings", "rte"],
  },
  {
    id: "rte.applications",
    module: "rte",
    label: "Govt list & admissions",
    blurb:
      "The government's allotted list, lottery, admit / waitlist / reject and the enrolled register. Tagging the child in Students needs Students.",
    actions: CRUD,
    slices: ["applications"],
    tabs: ["kpis", "applications", "enrolled", "reports", "rte"],
  },

  // ── Students ───────────────────────────────────────────────────────────
  {
    id: "students.birthdays",
    module: "students",
    label: "Birthday cards & greetings",
    blurb:
      "The birthday card design, wording and signatures. Sending today's cards still needs Students (change).",
    actions: ["view", "edit"],
    slices: ["module-state/birthday_settings"],
    tabs: ["birthdays"],
  },

  // ── Staff ──────────────────────────────────────────────────────────────
  // Desk-slice keys of staff_hr and staff_agreements, and the duty roster
  // book. Reading staff_hr without Staff (change) shows your own rows only;
  // these functions show their slices whole (desk-slice route).
  {
    // Director, 21 Oct 2026: a staff record's bank, UPI, Aadhaar, PAN and pay
    // are changed only by the owner and the accountant. A FUNCTION, so the
    // office and admin keep payroll · edit / accounts · edit for their daily
    // work without reaching these fields: POST /api/data/sis.staff/sensitive
    // asks for this function as a function grant (functionGrantHeldOnServer),
    // never for the staff, payroll or accounts module as such
    // (lib/staffProtectedFields.staffSensitiveAuthority).
    id: "staff.sensitive_edit",
    module: "staff",
    label: "Bank, ID & pay details",
    blurb: "Change a staff member's bank account, UPI, Aadhaar, PAN and pay. Owner and accountant only.",
    actions: ["edit"],
    routes: ["/api/data/sis.staff/sensitive"],
  },
  {
    id: "staff.leave",
    module: "staff",
    label: "Leave approvals",
    blurb: "Staff leave applications, approvals, balances and encashments, and the leave report.",
    actions: CRUD,
    slices: ["staff_hr/leaveRequests", "staff_hr/leaveBalances", "staff_hr/leaveEncashments", "staff_hr/leaveAllotmentLog"],
    tabs: ["leave", "reports", "leave_rules"],
    // Deciding under the year's leave rules, and the leave-rules reports.
    routes: ["/api/staff/leave-decide", "/api/staff/leave-book"],
  },
  {
    id: "staff.leave_policy",
    module: "staff",
    label: "Leave types & rules",
    blurb: "The school's leave types, their quotas and the leave settings; each year's leave policy, approvers and carry-forward.",
    actions: CRUD,
    slices: ["staff_hr/leaveTypes", "staff_hr/leaveSettings"],
    tabs: ["leave", "leave_rules"],
    // The year's leave policy, approvers and year-end carry-forward
    // (server tables, staff_leave_policy_* — Staff → Leave rules).
    routes: ["/api/staff/leave-policy"],
  },
  {
    id: "staff.appraisals",
    module: "staff",
    label: "Appraisals",
    blurb: "Appraisal cycles and each member of staff's appraisal.",
    actions: CRUD,
    slices: ["staff_hr/appraisalCycles", "staff_hr/appraisals"],
    tabs: ["appraisal"],
  },
  {
    id: "staff.agreements",
    module: "staff",
    label: "Employment agreements",
    blurb: "Draft, send and countersign staff employment agreements.",
    actions: CRUD,
    slices: ["staff_agreements/agreements"],
    tabs: ["agreements"],
  },
  {
    // Staff tasks (director, 30 Oct 2026): tracked work assigned to staff —
    // deadline, progress, completion evidence and the assigner's review.
    // Who may assign and review: the director and the principal (both hold
    // the whole Staff module), plus anyone granted THIS function in the
    // RBAC editor — no automatic office grant. An assignee sees and updates
    // only their own tasks through the module's routes; the generic
    // collection entries carry teacherScope "deny".
    id: "staff.tasks",
    module: "staff",
    group: "Tasks",
    label: "Staff tasks",
    blurb:
      "Assign tracked work to staff (deadline, priority, evidence), watch progress, and review completion — accept or return with a note.",
    actions: ["view", "create", "edit", "approve"],
    tabs: ["tasks"],
    routes: ["/api/staff/tasks", "/api/staff/tasks/[id]", "/api/staff/tasks/evidence", "/api/staff/tasks/evidence/[...path]", "/api/data/views/staff-tasks"],
  },
  {
    id: "staff.duty_roster",
    module: "staff",
    label: "Duty roster",
    blurb: "Gate, assembly, bus and other duties by day.",
    actions: ["view", "edit"],
    slices: ["module-state/duty_roster"],
    tabs: ["duty_roster"],
  },
  {
    id: "staff.assignments",
    module: "staff",
    group: "Teaching",
    label: "Who teaches what (read only)",
    blurb:
      "The teaching allocation by teacher, class and subject. Changing it (Allocate teaching) needs Staff (change).",
    actions: ["view"],
    // Read from the masters copy and the staff directory, both of which
    // every member of staff already loads.
    tabs: ["assignments"],
  },
  {
    id: "staff.gps_presence",
    module: "staff",
    group: "Attendance & presence",
    label: "GPS presence board",
    blurb:
      "The live GPS presence board, today's incidents, and (change) the tracking settings — hours, radius, who is tracked.",
    actions: ["view", "edit"],
    tabs: ["gps"],
    routes: ["/api/staff-geo/board", "/api/staff-geo/settings"],
  },
  {
    // The Staff screen's tab. The route takes Payroll view / change as before
    // (PR #562) or THIS function held as a function grant — never the Staff
    // module grant (teachers hold Staff · view; the sheets carry PAN, rates
    // and payouts). Approving, reopening and paying stay Payroll (approve).
    id: "staff.visiting_pay",
    module: "staff",
    group: "Visiting staff",
    label: "Visiting pay work sheets",
    blurb:
      "Visiting staff's month work sheets: build, check and correct lines, and the report. Approving and paying needs Payroll (approve).",
    actions: ["view", "edit"],
    // No `routes`: listing the route would let the whole Staff module grant
    // through requireStaffPermission. The route checks this function
    // itself (requireStaffPermissionOrFeature — Payroll, or this grant).
    tabs: ["visiting_pay"],
  },

  // ── Certificates ───────────────────────────────────────────────────────
  // One register (desk-slice certificates/issues). Certificates are voided,
  // never deleted, so the function has no "remove".
  {
    id: "certificates.register",
    module: "certificates",
    label: "Issue & register",
    blurb: "Issue bonafide, character, fee-paid and transfer certificates, void one, and the register.",
    actions: ["view", "create", "edit"],
    slices: ["certificates/issues"],
    // Certificates issued over WhatsApp land between two browser saves; a
    // copy without them is stale, not a voiding.
    unionRows: true,
    tabs: ["dashboard", "desk", "reports"],
  },

  // ── ID cards ───────────────────────────────────────────────────────────
  {
    id: "id_cards.print",
    module: "id_cards",
    label: "Print ID cards",
    blurb: "Print student and staff ID cards (the class lists come from Students and Staff).",
    actions: ["view"],
    tabs: ["student", "staff"],
  },
  {
    id: "id_cards.design",
    module: "id_cards",
    label: "Card design",
    blurb: "The ID card template — layout, colours and fields.",
    actions: ["view", "edit"],
    slices: ["module-state/id_card_template"],
    tabs: ["design"],
  },
];

/** Tabs of these modules that only the whole-module grant opens, and why. */
const SIS_ROSTER =
  "reads and writes the SIS roster (sis-roster desk), which stays module-level: its GET serves only the Students grant and its POST carries deletes, merges and per-record version guards a function slice cannot safely merge";

export const PEOPLE_WHOLE_MODULE_TABS: RbacWholeModuleTab[] = [
  // ── Students — everything below sits on the SIS roster ──────────────────
  { module: "students", tab: "dashboard", reason: `Whole-module dashboard: aggregates every child; ${SIS_ROSTER}` },
  { module: "students", tab: "roster", reason: `Student overview / search: ${SIS_ROSTER}` },
  { module: "students", tab: "register", reason: `New admission / edit student: ${SIS_ROSTER}` },
  { module: "students", tab: "update", reason: `Update student (single and bulk): ${SIS_ROSTER}` },
  { module: "students", tab: "duplicates", reason: `Merging duplicate children rewrites households and ids: ${SIS_ROSTER}` },
  { module: "students", tab: "doc_verify", reason: `Verifying a child's documents writes the student record: ${SIS_ROSTER}` },
  { module: "students", tab: "siblings", reason: `Linking / separating siblings (/api/sis/separate-sibling asks Students change): ${SIS_ROSTER}` },
  { module: "students", tab: "upgrade", reason: `Class upgrade / promotion (sis-promote desk route, Students change): ${SIS_ROSTER}` },
  { module: "students", tab: "reports", reason: `Student reports read the whole roster: ${SIS_ROSTER}` },
  { module: "students", tab: "tags", reason: `Tags are stored on the student records: ${SIS_ROSTER}` },

  // ── Staff ────────────────────────────────────────────────────────────────
  {
    module: "staff",
    tab: "dashboard",
    reason: "Whole-module dashboard: aggregates every Staff desk (roster, leave, attendance, documents).",
  },
  {
    module: "staff",
    tab: "roster",
    reason:
      "Roster edits are staff record writes (POST /api/data/sis.staff — Staff change; Remove is a soft remove that asks Staff remove) with no function-scoped path; colleagues' Aadhaar, PAN, bank and salary are unredacted only for Staff change, and changing them is the separate Bank, ID & pay details function (POST /api/data/sis.staff/sensitive).",
  },
  {
    module: "staff",
    tab: "allocate",
    reason:
      "Allocating teaching writes the teachers' class / subject links on their staff records (POST /api/data/sis.staff — Staff change), which has no function-scoped path; the read-only view is staff.assignments.",
  },
  {
    module: "staff",
    tab: "doc_verify",
    reason:
      "Verifying a member of staff's documents writes that document on their staff record (POST /api/data/sis.staff — Staff change), which has no function-scoped path.",
  },
  {
    module: "staff",
    tab: "requests",
    reason:
      "Every member of staff raises their own requests and sees them here; assigning and resolving is for the people who manage staff leave (canManageStaffLeave), checked by POST /api/staff/requests — not a grantable function.",
  },
  {
    module: "staff",
    tab: "outdoor_duty",
    reason:
      "Outdoor duty sessions are in the staff attendance store (staff_attendance), owned by the Attendance desk — no Staff function can read or save it.",
  },
  {
    module: "staff",
    tab: "my_docs",
    reason:
      "A person's own agreement and documents: every member of staff reaches their own through the staff app; on the web this tab is not a grantable office function.",
  },
  {
    module: "staff",
    tab: "payslips",
    reason:
      "A person's own approved payslips (self-service); everyone's payslips are Payroll → payroll.payslips, so no Staff function belongs here.",
  },
  {
    module: "staff",
    tab: "presence",
    reason:
      "A person's own GPS presence card (/api/staff-geo/ping is any member of staff, for themselves); not a grantable office function.",
  },
];
