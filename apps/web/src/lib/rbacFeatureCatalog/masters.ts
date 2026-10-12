import { CRUD, type RbacFeatureDef, type RbacWholeModuleTab } from "@/lib/rbacFeatureCatalog/types";

/** Masters — wired 6 Oct 2026 (masters-desk POST, lib/deskFeatureAuth). */
export const MASTERS_FEATURES: RbacFeatureDef[] = [
  {
    id: "masters.class_subjects",
    module: "masters",
    label: "Class subjects",
    blurb: "Which subjects each class studies — add, change or remove a subject for a class.",
    actions: CRUD,
    slices: ["classSubjects"],
    classScoped: true,
    tabs: ["subjects"],
  },
  {
    id: "masters.subjects",
    module: "masters",
    label: "Subject list",
    blurb: "The school's subject catalogue (codes, names, streams).",
    actions: CRUD,
    slices: ["subjects", "seniorStreams"],
    tabs: ["subjects"],
  },
  {
    id: "masters.classes_sections",
    module: "masters",
    label: "Classes & sections",
    blurb: "Classes, sections and campuses.",
    actions: CRUD,
    slices: ["classes", "sections", "campuses"],
    tabs: ["classes", "campuses"],
  },
  {
    id: "masters.academic_calendar",
    module: "masters",
    label: "Session, terms & holidays",
    blurb: "Academic years, terms, school timing and the holiday list.",
    actions: CRUD,
    slices: ["academicYears", "academicTerms", "schoolTiming", "holidays"],
    tabs: ["academic", "holidays"],
  },
  {
    id: "masters.fee_heads",
    module: "masters",
    label: "Fee heads & groups",
    blurb: "Fee heads, their categories and fee groups.",
    actions: CRUD,
    slices: ["feeHeads", "feeHeadCategories", "feeGroups"],
    tabs: ["fee-heads", "fee-groups"],
  },
  {
    id: "masters.fee_structure",
    module: "masters",
    label: "Fee structure & due dates",
    blurb: "Fee amounts per class, instalments, late fee and fee rules.",
    actions: CRUD,
    slices: [
      "feeStructureLines",
      "installments",
      "lateFeeRules",
      "midYearFeePolicy",
      "feeBackdatePolicy",
    ],
    tabs: ["fee-structure", "installments", "late-fee", "mid-year"],
  },
  {
    id: "masters.special_fees",
    module: "masters",
    label: "Special fees",
    blurb: "One-off and special fees and who they apply to.",
    actions: CRUD,
    slices: ["specialFees", "specialFeeAssignments"],
    tabs: ["special-fees"],
  },
  {
    id: "masters.concessions",
    module: "masters",
    label: "Concessions",
    blurb: "Concession kinds, rules and grants.",
    actions: CRUD,
    slices: ["concessionKinds", "concessions", "concessionGrants"],
    tabs: ["concessions"],
  },
  {
    id: "masters.school_profile",
    module: "masters",
    label: "School profile & numbering",
    blurb: "School details, statutory setup and number series.",
    actions: ["view", "edit"],
    slices: ["schoolProfile", "statutoryConfig", "numberSeries"],
    tabs: ["school", "brand", "series"],
  },
  {
    id: "masters.departments",
    module: "masters",
    label: "Departments & designations",
    blurb: "Staff departments and designations.",
    actions: CRUD,
    slices: ["departments", "designations"],
    tabs: ["staff"],
  },
  {
    id: "masters.custom_fields",
    module: "masters",
    label: "Custom fields",
    blurb: "Extra fields on the student and staff forms (e.g. house, bus pass no.) — add, change, retire.",
    // POST /api/custom-fields/defs asks masters · edit for create, update
    // and delete alike; it is not a masters-desk slice.
    actions: ["view", "edit"],
    tabs: ["custom-fields"],
    routes: ["/api/custom-fields/defs"],
  },
];

/** Tabs of these modules that only the whole-module grant opens, and why. */
export const MASTERS_WHOLE_MODULE_TABS: RbacWholeModuleTab[] = [
  {
    module: "masters",
    tab: "overview",
    reason:
      "The Masters landing dashboard: MastersWorkspace shows it to everyone who reaches the page (any Masters function opens the page); it changes nothing, so it is not granted on its own.",
  },
  {
    module: "masters",
    tab: "leave",
    reason:
      "Leave types and approval rules save to the Staff HR desk, attendance settings and rules to the Attendance staff desk — other modules' books a Masters function cannot lift. Attendance → Staff attendance rules covers the attendance half.",
  },
  {
    module: "masters",
    tab: "salary",
    reason:
      "Salary heads and structures save as payroll data (saveSalarySetup asserts payroll · edit, salary_setup_state); payroll writes stay module-level under the money rule.",
  },
  {
    module: "masters",
    tab: "tutor-passes",
    reason:
      "Passes are granted through /api/v1/tutor/access (fees · view / fees · approve), a v1 route function grants do not reach; a free pass is a fee waiver, which stays with the Fees grant.",
  },
  {
    module: "settings",
    tab: "roles",
    reason:
      "Roles & permissions configures RBAC itself; it stays with the Settings grant (canConfigureRbac) so nobody can hand themselves more access through a function.",
  },
];
