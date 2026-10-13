/**
 * Starting points for a role — Masters → Roles & permissions → Role
 * permissions → "Apply a template".
 *
 * A template is NEVER applied by itself: the office picks one, sees the
 * difference against the role it is about to change (or the new role it is
 * about to create), and saves. Built-in roles are not rewritten on load.
 *
 * Function sets are resolved against the catalogue at the moment of use:
 * a selector names a module and either takes every function in it or the
 * ones whose id/label match a pattern. A catalogue that grows (Library,
 * Fees, …) feeds the templates without editing this file, and a selector
 * that matches nothing is reported in the preview rather than silently
 * widened to the whole module.
 */
import { MOBILE_FEATURE_IDS, isMobileFeatureId, type MobileFeatureId } from "@/lib/mobileFeatures";
import {
  RBAC_MODULES,
  type FeatureGrant,
  type PermissionGrant,
  type RbacAction,
  type RbacModule,
} from "@/lib/rbac";
import { featuresForModule } from "@/lib/rbacFeatures";
import { moduleTreeActions } from "@/lib/rbacEditorModel";

export type FunctionSelector = {
  module: RbacModule;
  actions: RbacAction[];
  /** Matched against the function id and label; omitted = every function. */
  match?: RegExp;
  /** Shown in the preview when nothing matches. */
  why: string;
};

export type RoleTemplate = {
  id: string;
  name: string;
  /** Suggested code for a new role made from the template. */
  code: string;
  summary: string;
  modules: Partial<Record<RbacModule, RbacAction[]>>;
  functions: FunctionSelector[];
  /** Phone-app screens for the role (lib/mobileFeatures). */
  mobile: MobileFeatureId[];
};

const V: RbacAction[] = ["view"];
const VE: RbacAction[] = ["view", "export"];
const VCE: RbacAction[] = ["view", "create", "edit"];
const VCEX: RbacAction[] = ["view", "create", "edit", "export"];
const CRUDX: RbacAction[] = ["view", "create", "edit", "delete", "export"];

const SELF: MobileFeatureId[] = ["gps_punch", "my_leave", "my_payslips", "notices"];

/** Read-only things every member of staff sees. */
const STAFF_BASICS: Partial<Record<RbacModule, RbacAction[]>> = {
  home: V,
  notices: V,
  news: V,
  gallery: V,
  notifications: V,
  events: V,
};

export const ROLE_TEMPLATES: RoleTemplate[] = [
  {
    id: "office",
    name: "Office / Receptionist",
    code: "office_reception",
    summary:
      "Front desk: enquiries and admissions, student records, the gate register, complaints, notices and the parent app, fee collection at the counter (no concessions approval, no void).",
    modules: {
      ...STAFF_BASICS,
      masters: V,
      students: VCEX,
      admissions: VCEX,
      rte: VCEX,
      visitors: VCEX,
      complaints: VCEX,
      notices: CRUDX,
      news: VCEX,
      gallery: VCEX,
      // Parents-on-app invites need notifications · edit (12 Oct audit).
      notifications: ["view", "edit"],
      events: VCEX,
      fees: ["view", "create", "export"],
      certificates: VCEX,
      student_leave: VCEX,
      attendance: VE,
      timetable: V,
      transport: V,
      staff: V,
    },
    functions: [],
    mobile: [
      ...SELF,
      "fee_take",
      "fee_defaulters",
      "fee_collections",
      "admission_leads",
      "students_view",
      "student_leave_decide",
      "complaints_handle",
      "documents_verify",
      "visitor_gate",
      "messages",
    ],
  },
  {
    id: "accountant",
    name: "Accountant",
    code: "accountant",
    summary:
      "Fees (collect, void, export), the books (vouchers, bank, vendor bills), store and purchase, staff advances, construction accounts. No payroll and no balances-and-session-totals unless added.",
    modules: {
      ...STAFF_BASICS,
      students: V,
      staff: V,
      admissions: V,
      fees: ["view", "create", "edit", "void", "export"],
      accounts: ["view", "create", "edit", "export"],
      store: VE,
      purchase: VCEX,
      staff_advances: VCEX,
      trust: VCEX,
      transport: VE,
      certificates: ["view", "create", "export"],
    },
    functions: [],
    mobile: [...SELF, "fee_take", "fee_defaulters", "fee_collections", "students_view"],
  },
  {
    id: "computer_operator",
    name: "Computer Operator",
    code: "computer_operator",
    summary:
      "Data work: student and staff records, admissions entry, UDISE+ and compliance, mark entry, certificates, ID cards, notices, website and the parent app. No money.",
    modules: {
      ...STAFF_BASICS,
      masters: V,
      students: VCEX,
      staff: V,
      admissions: VCEX,
      attendance: ["view", "edit", "export"],
      compliance: ["view", "edit", "export"],
      certificates: VCEX,
      id_cards: VCEX,
      documents: ["view", "create", "export"],
      notices: VCEX,
      news: VCEX,
      gallery: VCEX,
      website: VCE,
      notifications: ["view", "edit"],
      timetable: VE,
      exams: V,
    },
    functions: [
      { module: "exams", actions: VCE, match: /marks|mark entry/i, why: "Mark entry" },
    ],
    mobile: [...SELF, "students_view", "documents_verify", "messages"],
  },
  {
    id: "principal",
    name: "Principal",
    code: "principal_custom",
    summary:
      "Every module with every action except impersonation — the same reach as the built-in Principal role.",
    modules: Object.fromEntries(
      RBAC_MODULES.map((m) => [m.id, moduleTreeActions(m.id).filter((a) => a !== "impersonate")]),
    ) as Partial<Record<RbacModule, RbacAction[]>>,
    functions: [],
    mobile: [...MOBILE_FEATURE_IDS],
  },
  {
    id: "class_teacher",
    name: "Class Teacher",
    code: "class_teacher",
    summary:
      "Own class: attendance, homework and diary, marks, student leave approval, PTM, discipline and health notes, verify parent documents, the subjects of their classes.",
    modules: {
      ...STAFF_BASICS,
      students: ["view", "approve"],
      staff: V,
      attendance: VCE,
      homework: [...VCE, "export"],
      timetable: V,
      online_classes: VCE,
      teaching: VCE,
      ptm: [...VCE, "export"],
      student_leave: [...VCE, "approve", "export"],
      exams: VCE,
      certificates: V,
      discipline: ["view", "create"],
      health: ["view", "create"],
      complaints: ["view", "edit"],
      vault: V,
    },
    functions: [
      { module: "masters", actions: ["view", "create", "edit", "delete"], match: /class_subjects/, why: "Class subjects" },
      { module: "masters", actions: ["view"], match: /^masters\.subjects$/, why: "Subject list" },
    ],
    mobile: [
      ...SELF,
      "attendance_mark",
      "homework_post",
      "marks_entry",
      "timetable_view",
      "online_class_host",
      "period_log",
      "syllabus_scan",
      "students_view",
      "student_leave_decide",
      "complaints_handle",
      "documents_verify",
      "student_notes",
      "ptm_meet",
      "class_broadcast",
      "messages",
    ],
  },
  {
    id: "subject_teacher",
    name: "Subject Teacher",
    code: "subject_teacher",
    summary:
      "Teaching only: homework, mark entry, period log and syllabus, online classes, PTM meetings. No attendance register or leave approval (that is the class teacher's).",
    modules: {
      ...STAFF_BASICS,
      students: V,
      staff: V,
      attendance: V,
      homework: [...VCE, "export"],
      timetable: V,
      online_classes: VCE,
      teaching: VCE,
      ptm: VCE,
      exams: VCE,
      discipline: ["view", "create"],
      health: V,
    },
    functions: [
      { module: "masters", actions: ["view"], match: /^masters\.subjects$/, why: "Subject list" },
    ],
    mobile: [
      ...SELF,
      "homework_post",
      "marks_entry",
      "timetable_view",
      "online_class_host",
      "period_log",
      "syllabus_scan",
      "students_view",
      "student_notes",
      "ptm_meet",
      "class_broadcast",
      "messages",
    ],
  },
  {
    id: "transport",
    name: "Transport In-charge",
    code: "transport_incharge",
    summary:
      "Routes, stops, riders, vehicles, fuel, service, boarding register and live tracking; reads students and staff. No fees.",
    modules: {
      ...STAFF_BASICS,
      transport: CRUDX,
      students: V,
      staff: V,
      visitors: V,
      attendance: V,
    },
    functions: [],
    mobile: [...SELF, "route_manifest", "transport_requests", "students_view", "messages"],
  },
  {
    id: "librarian",
    name: "Librarian",
    code: "librarian",
    summary:
      "The library's functions (catalogue, issue and return, circulation, e-books, fines) wherever the catalogue lists them; reads students and staff. Not the school store or purchase.",
    modules: {
      ...STAFF_BASICS,
      students: V,
      staff: V,
    },
    functions: [
      {
        module: "store",
        actions: ["view", "create", "edit", "delete", "export"],
        match: /librar|book|circulat|e-?book|fine|issue.*return/i,
        why: "Library functions — the Library screen opens on the whole Store module until the catalogue lists them",
      },
    ],
    mobile: [...SELF, "students_view"],
  },
];

export type ResolvedTemplate = {
  permissions: PermissionGrant[];
  featureGrants: FeatureGrant[];
  mobile: MobileFeatureId[];
  /** Selectors that found no function in today's catalogue. */
  unmatched: string[];
};

/** A template turned into grants against the catalogue as it is now. */
export function resolveRoleTemplate(t: RoleTemplate): ResolvedTemplate {
  const permissions: PermissionGrant[] = [];
  for (const [module, actions] of Object.entries(t.modules) as [RbacModule, RbacAction[]][]) {
    const valid = moduleTreeActions(module);
    const keep = (actions ?? []).filter((a) => valid.includes(a));
    if (keep.length) permissions.push({ module, actions: [...new Set(keep)] });
  }
  const byFeature = new Map<string, Set<RbacAction>>();
  const unmatched: string[] = [];
  for (const sel of t.functions) {
    const fns = featuresForModule(sel.module).filter(
      (f) => !sel.match || sel.match.test(f.id) || sel.match.test(f.label),
    );
    if (fns.length === 0) {
      unmatched.push(sel.why);
      continue;
    }
    for (const f of fns) {
      const set = byFeature.get(f.id) ?? new Set<RbacAction>();
      for (const a of sel.actions) if (f.actions.includes(a)) set.add(a);
      if (set.size) byFeature.set(f.id, set);
    }
  }
  const featureGrants = [...byFeature.entries()].map(([feature, set]) => ({
    feature,
    actions: [...set],
  }));
  return {
    permissions,
    featureGrants,
    mobile: [...new Set(t.mobile.filter(isMobileFeatureId))],
    unmatched,
  };
}
