import { CRUD, type RbacFeatureDef } from "@/lib/rbacFeatureCatalog/types";

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
 * - the staff roster (staff-roster), Documents (one AI screen, no store),
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

  // ── RTE / EWS ──────────────────────────────────────────────────────────
  // Slices are RteState keys (rte-desk). Tab "dashboard" is the Seats tab.
  {
    id: "rte.seats",
    module: "rte",
    label: "Quota seats & settings",
    blurb: "RTE / EWS seats per class, the mandated share and the fee-waiver rule.",
    actions: CRUD,
    slices: ["seats", "settings"],
    tabs: ["dashboard", "settings"],
  },
  {
    id: "rte.applications",
    module: "rte",
    label: "Govt list & admissions",
    blurb:
      "The government's allotted list, lottery, admit / waitlist / reject and the enrolled register. Tagging the child in Students needs Students.",
    actions: CRUD,
    slices: ["applications"],
    tabs: ["kpis", "applications", "enrolled", "reports"],
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
    id: "staff.leave",
    module: "staff",
    label: "Leave approvals",
    blurb: "Staff leave applications, approvals, balances and encashments, and the leave report.",
    actions: CRUD,
    slices: ["staff_hr/leaveRequests", "staff_hr/leaveBalances", "staff_hr/leaveEncashments"],
    tabs: ["leave", "reports"],
  },
  {
    id: "staff.leave_policy",
    module: "staff",
    label: "Leave types & rules",
    blurb: "The school's leave types, their quotas and the leave settings.",
    actions: CRUD,
    slices: ["staff_hr/leaveTypes", "staff_hr/leaveSettings"],
    tabs: ["leave"],
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
    id: "staff.duty_roster",
    module: "staff",
    label: "Duty roster",
    blurb: "Gate, assembly, bus and other duties by day.",
    actions: ["view", "edit"],
    slices: ["module-state/duty_roster"],
    tabs: ["duty_roster"],
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
