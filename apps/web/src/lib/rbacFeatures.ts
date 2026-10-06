/**
 * Functions inside a module, each grantable on its own.
 *
 * Director, 6 Oct 2026: "make user role assign like every module and their
 * functionality … like teachers can in master create/add/delete subjects for
 * classes". A module grant (rbac.ts) still means "everything in the module";
 * a FUNCTION grant gives one part of it — e.g. Masters → Class subjects —
 * without the rest (fee heads, concessions, …).
 *
 * Masters is enforced on the server first (lib/mastersChangeAuth.ts): a save
 * from someone without masters.edit is accepted only if every row it adds,
 * changes or removes falls inside a function they hold, and — for
 * class-scoped functions held by a teacher — inside their own classes.
 * Other modules list their functions here as they are wired.
 */
import type { RbacAction, RbacModule } from "@/lib/rbac";

export type RbacFeatureId = string;

export type RbacFeatureDef = {
  /** "<module>.<function>", stable — stored in roles. */
  id: RbacFeatureId;
  module: RbacModule;
  label: string;
  blurb: string;
  /** The actions that mean something for this function. */
  actions: RbacAction[];
  /**
   * For masters functions: the MastersState keys this function owns. A
   * masters save is checked slice by slice against these.
   */
  mastersSlices?: string[];
  /** Rows carry a classId; a teacher may touch only their own classes. */
  classScoped?: boolean;
  /** Masters tab ids this function opens. */
  mastersTabs?: string[];
};

const CRUD: RbacAction[] = ["view", "create", "edit", "delete"];

export const RBAC_FEATURES: RbacFeatureDef[] = [
  {
    id: "masters.class_subjects",
    module: "masters",
    label: "Class subjects",
    blurb: "Which subjects each class studies — add, change or remove a subject for a class.",
    actions: CRUD,
    mastersSlices: ["classSubjects"],
    classScoped: true,
    mastersTabs: ["subjects"],
  },
  {
    id: "masters.subjects",
    module: "masters",
    label: "Subject list",
    blurb: "The school's subject catalogue (codes, names, streams).",
    actions: CRUD,
    mastersSlices: ["subjects", "seniorStreams"],
    mastersTabs: ["subjects"],
  },
  {
    id: "masters.classes_sections",
    module: "masters",
    label: "Classes & sections",
    blurb: "Classes, sections and campuses.",
    actions: CRUD,
    mastersSlices: ["classes", "sections", "campuses"],
    mastersTabs: ["classes", "campuses"],
  },
  {
    id: "masters.academic_calendar",
    module: "masters",
    label: "Session, terms & holidays",
    blurb: "Academic years, terms, school timing and the holiday list.",
    actions: CRUD,
    mastersSlices: ["academicYears", "academicTerms", "schoolTiming", "holidays"],
    mastersTabs: ["academic", "holidays"],
  },
  {
    id: "masters.fee_heads",
    module: "masters",
    label: "Fee heads & groups",
    blurb: "Fee heads, their categories and fee groups.",
    actions: CRUD,
    mastersSlices: ["feeHeads", "feeHeadCategories", "feeGroups"],
    mastersTabs: ["fee-heads", "fee-groups"],
  },
  {
    id: "masters.fee_structure",
    module: "masters",
    label: "Fee structure & due dates",
    blurb: "Fee amounts per class, instalments, late fee and fee rules.",
    actions: CRUD,
    mastersSlices: [
      "feeStructureLines",
      "installments",
      "lateFeeRules",
      "midYearFeePolicy",
      "feeBackdatePolicy",
    ],
    mastersTabs: ["fee-structure", "installments", "late-fee", "mid-year"],
  },
  {
    id: "masters.special_fees",
    module: "masters",
    label: "Special fees",
    blurb: "One-off and special fees and who they apply to.",
    actions: CRUD,
    mastersSlices: ["specialFees", "specialFeeAssignments"],
    mastersTabs: ["special-fees"],
  },
  {
    id: "masters.concessions",
    module: "masters",
    label: "Concessions",
    blurb: "Concession kinds, rules and grants.",
    actions: CRUD,
    mastersSlices: ["concessionKinds", "concessions", "concessionGrants"],
    mastersTabs: ["concessions"],
  },
  {
    id: "masters.school_profile",
    module: "masters",
    label: "School profile & numbering",
    blurb: "School details, statutory setup and number series.",
    actions: ["view", "edit"],
    mastersSlices: ["schoolProfile", "statutoryConfig", "numberSeries"],
    mastersTabs: ["school", "brand", "series"],
  },
  {
    id: "masters.departments",
    module: "masters",
    label: "Departments & designations",
    blurb: "Staff departments and designations.",
    actions: CRUD,
    mastersSlices: ["departments", "designations"],
    mastersTabs: ["staff"],
  },
];

/** Masters keys that are not checked here — they sync through their own
 * routes and permission checks (staff roster, demo students). */
export const MASTERS_UNCHECKED_KEYS = new Set(["version", "staff", "students"]);

export function featuresForModule(module: RbacModule): RbacFeatureDef[] {
  return RBAC_FEATURES.filter((f) => f.module === module);
}

export function findFeature(id: string): RbacFeatureDef | null {
  return RBAC_FEATURES.find((f) => f.id === id) ?? null;
}

/** The masters function that owns a MastersState key, if any. */
export function featureForMastersSlice(key: string): RbacFeatureDef | null {
  return RBAC_FEATURES.find((f) => f.mastersSlices?.includes(key)) ?? null;
}

/** Functions behind a masters tab (a tab may serve two, e.g. Subjects). */
export function featuresForMastersTab(tab: string): RbacFeatureDef[] {
  return RBAC_FEATURES.filter((f) => f.mastersTabs?.includes(tab));
}
