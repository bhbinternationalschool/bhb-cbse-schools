/**
 * What each staff member can do in the mobile app.
 *
 * The web ERP's RBAC answers "may this person touch this module?". A phone
 * needs a second, narrower answer: which *screens* they get. A class teacher
 * and the accountant both hold `fees:view`, but only one of them should see
 * a fee counter on a phone they carry around a school.
 *
 * So a feature is available only when BOTH agree:
 *   1. RBAC grants the underlying module + action (never widened here), and
 *   2. the mobile access map enables the feature for one of their roles,
 *      or grants it to them personally.
 * A personal denial always wins — that is how one phone gets switched off
 * without touching anyone's role.
 *
 * Pure: no I/O, so it is self-tested in mobileFeatures.selftest.ts.
 */

import type { RbacAction, RbacModule } from "@/lib/rbac";

export type MobileFeatureId =
  // fees
  | "fee_take"
  | "fee_defaulters"
  | "fee_collections"
  // admissions
  | "admission_leads"
  | "field_survey"
  // teaching
  | "attendance_mark"
  | "homework_post"
  | "marks_entry"
  | "timetable_view"
  | "period_log"
  | "syllabus_scan"
  | "students_view"
  // care of students
  | "student_leave_decide"
  | "complaints_handle"
  | "documents_verify"
  | "student_notes"
  | "ptm_meet"
  // leadership
  | "school_snapshot"
  | "staff_leave_approve"
  | "staff_roster"
  | "broadcast"
  | "transport_requests"
  // gate
  | "visitor_gate"
  | "gate_pass_release"
  // transport crew
  | "route_manifest"
  // self service
  | "gps_punch"
  | "my_leave"
  | "my_payslips"
  | "notices"
  | "messages";

export type MobileFeature = {
  id: MobileFeatureId;
  label: string;
  /** Shown under this heading in the RBAC admin panel. */
  group:
    | "Fees"
    | "Admissions"
    | "Teaching"
    | "Students"
    | "Leadership"
    | "Gate"
    | "Transport"
    | "Self service";
  module: RbacModule;
  action: RbacAction;
  /** One line the office reads before switching it on. */
  note: string;
};

export const MOBILE_FEATURES: MobileFeature[] = [
  {
    id: "fee_take",
    label: "Collect fees",
    group: "Fees",
    module: "fees",
    action: "create",
    note: "Take cash / UPI / cheque against a student's dues and issue a receipt from the phone.",
  },
  {
    id: "fee_defaulters",
    label: "Fee defaulters",
    group: "Fees",
    module: "fees",
    action: "view",
    note: "Outstanding list with call and WhatsApp, and a record of what was promised.",
  },
  {
    id: "fee_collections",
    label: "My collections",
    group: "Fees",
    module: "fees",
    action: "view",
    note: "What this person has collected today, with the receipts.",
  },
  {
    id: "admission_leads",
    label: "Admission leads",
    group: "Admissions",
    module: "admissions",
    action: "view",
    note: "Counsellor's follow-up list — call, WhatsApp and log the outcome.",
  },
  {
    id: "field_survey",
    label: "Field survey",
    group: "Admissions",
    module: "admissions",
    action: "create",
    note: "Door-to-door capture of a family into the admissions pipeline.",
  },
  {
    id: "attendance_mark",
    label: "Mark attendance",
    group: "Teaching",
    module: "attendance",
    action: "edit",
    note: "Section register. Still limited to the sections this person teaches.",
  },
  {
    id: "homework_post",
    label: "Post homework",
    group: "Teaching",
    module: "homework",
    action: "edit",
    note: "Publish homework to a section's parents.",
  },
  {
    id: "marks_entry",
    label: "Marks entry",
    group: "Teaching",
    module: "exams",
    action: "edit",
    note: "Enter exam marks subject by subject.",
  },
  {
    id: "timetable_view",
    label: "My timetable",
    group: "Teaching",
    module: "timetable",
    action: "view",
    note: "The week's periods and this week's arrangements.",
  },
  {
    id: "period_log",
    label: "Period log",
    group: "Teaching",
    module: "teaching",
    action: "edit",
    note: "Log what was taught in each period.",
  },
  {
    id: "syllabus_scan",
    label: "Scan syllabus",
    group: "Teaching",
    module: "teaching",
    action: "create",
    note: "Photograph a syllabus page and import it.",
  },
  {
    id: "students_view",
    label: "Student roster",
    group: "Students",
    module: "students",
    action: "view",
    note: "Names, rolls and today's attendance for a section.",
  },
  {
    id: "student_leave_decide",
    label: "Decide leave requests",
    group: "Students",
    module: "student_leave",
    action: "approve",
    note: "Approve or decline parents' leave requests.",
  },
  {
    id: "complaints_handle",
    label: "Handle complaints",
    group: "Students",
    module: "complaints",
    action: "edit",
    note: "Take up, progress and resolve parents' complaints.",
  },
  {
    id: "documents_verify",
    label: "Verify documents",
    group: "Students",
    module: "students",
    action: "approve",
    note: "Check parent-uploaded certificates and accept or reject them.",
  },
  {
    id: "student_notes",
    label: "Discipline & sick room",
    group: "Students",
    module: "discipline",
    action: "create",
    note: "Merit, discipline and first-aid notes against a child.",
  },
  {
    id: "ptm_meet",
    label: "PTM meetings",
    group: "Students",
    module: "ptm",
    action: "edit",
    note: "Mark a booking met or no-show and write the meeting note.",
  },
  {
    id: "school_snapshot",
    label: "School snapshot",
    group: "Leadership",
    module: "home",
    action: "view",
    note: "Live fees, attendance, staff and admissions figures for the whole school.",
  },
  {
    id: "staff_leave_approve",
    label: "Approve staff leave",
    group: "Leadership",
    module: "staff",
    action: "approve",
    note: "Decide colleagues' leave applications.",
  },
  {
    id: "staff_roster",
    label: "Staff contacts",
    group: "Leadership",
    module: "staff",
    action: "view",
    note: "The roster with call / WhatsApp, and adding a missing mobile.",
  },
  {
    id: "broadcast",
    label: "Broadcast",
    group: "Leadership",
    module: "notices",
    action: "create",
    note: "Send a message to families from the phone.",
  },
  {
    id: "transport_requests",
    label: "Transport requests",
    group: "Leadership",
    module: "transport",
    action: "edit",
    note: "The queue of parents asking for bus service.",
  },
  {
    id: "visitor_gate",
    label: "Visitor gate",
    group: "Gate",
    module: "visitors",
    action: "create",
    note: "Check visitors in and out at the gate. The mobile lookup says whose parent they are before they are let in.",
  },
  {
    id: "gate_pass_release",
    label: "Release on a gate pass",
    group: "Gate",
    module: "visitors",
    action: "edit",
    note: "Hand a child over for an early pickup against an approved pass, and record who collected them.",
  },
  {
    id: "route_manifest",
    label: "Route & boarding",
    group: "Transport",
    module: "transport",
    action: "view",
    note: "The bus route, stops and the day's boarding list.",
  },
  {
    id: "gps_punch",
    label: "GPS punch",
    group: "Self service",
    module: "home",
    action: "view",
    note: "Own attendance punch at campus.",
  },
  {
    id: "my_leave",
    label: "My leave",
    group: "Self service",
    module: "home",
    action: "view",
    note: "Own leave balance and applications.",
  },
  {
    id: "my_payslips",
    label: "My payslips",
    group: "Self service",
    module: "home",
    action: "view",
    note: "Own released payslips.",
  },
  {
    id: "notices",
    label: "Notices",
    group: "Self service",
    module: "notices",
    action: "view",
    note: "School notices on the phone.",
  },
  {
    id: "messages",
    label: "Messages",
    group: "Self service",
    module: "home",
    action: "view",
    note: "Chat with parents of the classes this person handles.",
  },
];

export const MOBILE_FEATURE_IDS: MobileFeatureId[] = MOBILE_FEATURES.map((f) => f.id);

const FEATURE_BY_ID = new Map(MOBILE_FEATURES.map((f) => [f.id, f]));

export function mobileFeature(id: MobileFeatureId): MobileFeature | undefined {
  return FEATURE_BY_ID.get(id);
}

export function isMobileFeatureId(v: unknown): v is MobileFeatureId {
  return typeof v === "string" && FEATURE_BY_ID.has(v as MobileFeatureId);
}

/** Per-staff grant or denial. */
export type MobileStaffRule = {
  staffId: string;
  /** Features switched on for this person beyond their roles. */
  allow: MobileFeatureId[];
  /** Features switched off for this person whatever their roles say. */
  deny: MobileFeatureId[];
  note: string;
};

export type MobileAccessState = {
  version: 1;
  /** Role code → features. Role codes, not ids, so a rebuilt built-in role keeps its map. */
  roleFeatures: Record<string, MobileFeatureId[]>;
  staffRules: MobileStaffRule[];
};

/** Everyone who can open the staff app gets these. */
const SELF_SERVICE: MobileFeatureId[] = [
  "gps_punch",
  "my_leave",
  "my_payslips",
  "notices",
];

const TEACHING: MobileFeatureId[] = [
  "attendance_mark",
  "homework_post",
  "marks_entry",
  "timetable_view",
  "period_log",
  "syllabus_scan",
  "students_view",
  "student_leave_decide",
  "complaints_handle",
  "documents_verify",
  "student_notes",
  "ptm_meet",
  "messages",
];

const FEES: MobileFeatureId[] = ["fee_take", "fee_defaulters", "fee_collections"];

/**
 * What each built-in role gets when nobody has configured anything yet.
 *
 * Deliberately conservative on the money and the leads: `fee_take` and
 * `admission_leads` are off for a plain teacher, because a phone in a
 * corridor is not a fee counter and a lead list is a counsellor's work.
 * The office switches them on per person in Masters → Roles.
 */
export function defaultMobileAccess(): MobileAccessState {
  const all = [...MOBILE_FEATURE_IDS];
  return {
    version: 1,
    roleFeatures: {
      owner: all,
      principal: all,
      admin: all,
      office: [
        ...SELF_SERVICE,
        ...FEES,
        "admission_leads",
        "students_view",
        "student_leave_decide",
        "complaints_handle",
        "documents_verify",
        "staff_roster",
        "transport_requests",
        "messages",
        // Reception IS the gate desk on a small campus.
        "visitor_gate",
        "gate_pass_release",
      ],
      accounts: [...SELF_SERVICE, ...FEES, "students_view"],
      auditor: [...SELF_SERVICE, "fee_defaulters", "fee_collections", "students_view"],
      teacher: [...SELF_SERVICE, ...TEACHING],
      transport: [...SELF_SERVICE, "route_manifest", "transport_requests", "students_view"],
      driver: [...SELF_SERVICE, "route_manifest"],
      // The gate, and nothing else. `gate_pass_release` is left off on
      // purpose: handing a child over is a separate trust from writing
      // down who came to the office, and the role holds no `visitors.edit`
      // to back it even if somebody switches the tile on.
      gate: [...SELF_SERVICE, "visitor_gate"],
      support: [...SELF_SERVICE],
      parent: [],
    },
    staffRules: [],
  };
}

export function normalizeMobileAccess(raw: unknown): MobileAccessState {
  const base = defaultMobileAccess();
  if (!raw || typeof raw !== "object") return base;
  const o = raw as Partial<MobileAccessState>;

  const roleFeatures: Record<string, MobileFeatureId[]> = {};
  const src = (o.roleFeatures ?? {}) as Record<string, unknown>;
  for (const [code, list] of Object.entries(src)) {
    const key = String(code || "").trim().toLowerCase();
    if (!key) continue;
    roleFeatures[key] = Array.isArray(list)
      ? [...new Set(list.filter(isMobileFeatureId))]
      : [];
  }
  // A role nobody has configured keeps its default, so adding a feature to
  // the catalogue does not silently switch it off for everyone.
  for (const [code, list] of Object.entries(base.roleFeatures)) {
    if (!(code in roleFeatures)) roleFeatures[code] = list;
  }

  const staffRules: MobileStaffRule[] = Array.isArray(o.staffRules)
    ? o.staffRules
        .map((r) => {
          const staffId = String((r as MobileStaffRule)?.staffId || "").trim();
          if (!staffId) return null;
          const rule = r as Partial<MobileStaffRule>;
          return {
            staffId,
            allow: [...new Set((rule.allow ?? []).filter(isMobileFeatureId))],
            deny: [...new Set((rule.deny ?? []).filter(isMobileFeatureId))],
            note: String(rule.note || ""),
          } satisfies MobileStaffRule;
        })
        .filter((r): r is MobileStaffRule => !!r)
    : [];

  return { version: 1, roleFeatures, staffRules };
}

export type MobileFeatureResolution = {
  /** Enabled, and RBAC agrees. */
  features: MobileFeatureId[];
  /** Enabled by role/grant but refused by RBAC — shown to the office as an explanation. */
  blockedByRbac: MobileFeatureId[];
};

/**
 * The features one signed-in staff member actually gets.
 *
 * `can` is the RBAC check (module, action) — passed in so this stays pure
 * and the caller decides whether that is the server's rbac state or the
 * browser's.
 */
export function resolveMobileFeatures(input: {
  roleCodes: string[];
  staffId?: string;
  access: MobileAccessState;
  can: (module: RbacModule, action: RbacAction) => boolean;
}): MobileFeatureResolution {
  const access = input.access;
  const wanted = new Set<MobileFeatureId>();

  for (const raw of input.roleCodes) {
    const code = String(raw || "").trim().toLowerCase();
    if (!code) continue;
    for (const f of access.roleFeatures[code] ?? []) wanted.add(f);
  }

  const staffId = (input.staffId || "").trim();
  const denied = new Set<MobileFeatureId>();
  if (staffId) {
    for (const rule of access.staffRules) {
      if (rule.staffId !== staffId) continue;
      for (const f of rule.allow) wanted.add(f);
      for (const f of rule.deny) denied.add(f);
    }
  }

  const features: MobileFeatureId[] = [];
  const blockedByRbac: MobileFeatureId[] = [];
  for (const id of MOBILE_FEATURE_IDS) {
    if (!wanted.has(id) || denied.has(id)) continue;
    const meta = FEATURE_BY_ID.get(id)!;
    if (input.can(meta.module, meta.action)) features.push(id);
    else blockedByRbac.push(id);
  }
  return { features, blockedByRbac };
}

/** Apply an office edit to one role's feature list. */
export function setRoleMobileFeatures(
  state: MobileAccessState,
  roleCode: string,
  features: MobileFeatureId[],
): MobileAccessState {
  const code = roleCode.trim().toLowerCase();
  if (!code) return state;
  return {
    ...state,
    roleFeatures: {
      ...state.roleFeatures,
      [code]: [...new Set(features.filter(isMobileFeatureId))],
    },
  };
}

/** Apply an office edit to one person's grants / denials. */
export function setStaffMobileRule(
  state: MobileAccessState,
  rule: MobileStaffRule,
): MobileAccessState {
  const staffId = rule.staffId.trim();
  if (!staffId) return state;
  const clean: MobileStaffRule = {
    staffId,
    allow: [...new Set(rule.allow.filter(isMobileFeatureId))],
    deny: [...new Set(rule.deny.filter(isMobileFeatureId))],
    note: rule.note || "",
  };
  const rest = state.staffRules.filter((r) => r.staffId !== staffId);
  const empty = clean.allow.length === 0 && clean.deny.length === 0 && !clean.note;
  return { ...state, staffRules: empty ? rest : [...rest, clean] };
}
