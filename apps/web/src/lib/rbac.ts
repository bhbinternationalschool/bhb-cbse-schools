/**
 * Advanced RBAC — module × action × scope.
 * Demo store: localStorage `bhb_rbac_v1` (separate from MastersState).
 */

import type { MastersState } from "@/lib/masters";
import type { StaffRecord } from "@/lib/foundationMasters";
import { canAccessModuleHref } from "@/lib/moduleRegistry";
import { getSessionActor } from "@/lib/sessionActor";
import { assertSessionWritable } from "@/lib/sessionWriteGuard";
import { isProtectedSuperAdminEmail } from "@/lib/superAdmin";

export type RbacModule =
  | "home"
  | "masters"
  | "students"
  | "admissions"
  | "staff"
  | "store"
  | "purchase"
  | "transport"
  | "accounts"
  | "trust"
  | "fees"
  | "attendance"
  | "homework"
  | "timetable"
  | "teaching"
  | "ptm"
  | "events"
  | "student_leave"
  | "vault"
  | "rte"
  | "payroll"
  | "staff_advances"
  | "exams"
  | "certificates"
  | "compliance"
  | "notices"
  | "news"
  | "gallery"
  | "notifications"
  | "settings"
  | "policies"
  | "wa_templates"
  | "wa_automation"
  | "wa_chatbot"
  | "documents"
  | "id_cards"
  | "discipline"
  | "health"
  | "visitors"
  | "complaints"
  | "hostel"
  | "canteen"
  | "alumni"
  | "sports"
  | "opex_budget"
  | "scholarships"
  | "question_bank"
  | "cbse_loc"
  | "website";

export type RbacAction =
  | "view"
  | "create"
  | "edit"
  | "delete"
  | "void"
  | "approve"
  | "export"
  | "unlock"
  | "impersonate";

export type PermissionGrant = {
  module: RbacModule;
  actions: RbacAction[];
};

export type RoleScope = {
  campusIds: string[];
  classIds: string[];
  departmentIds: string[];
};

export type RbacRole = {
  id: string;
  code: string;
  name: string;
  isBuiltIn: boolean;
  isActive: boolean;
  /** Create/edit requests need another role to approve */
  makerChecker: boolean;
  permissions: PermissionGrant[];
  note: string;
};

export type UserRoleAssignment = {
  id: string;
  staffId: string;
  roleId: string;
  isPrimary: boolean;
  scope: RoleScope;
  /** ISO date (YYYY-MM-DD); empty = no expiry */
  expiresOn: string;
  note: string;
};

export type RbacAuditEntry = {
  id: string;
  at: string;
  by: string;
  action: string;
  detail: string;
};

export type RbacState = {
  version: 1;
  roles: RbacRole[];
  assignments: UserRoleAssignment[];
  audit: RbacAuditEntry[];
};

export type SessionLike = {
  roleCode: string;
  staffId?: string;
  householdId?: string;
  email?: string;
  fullName: string;
  persona?: string;
};

const STORAGE_KEY = "bhb_rbac_v1";

export const RBAC_MODULES: {
  id: RbacModule;
  label: string;
  href?: string;
  group?: string;
}[] = [
  { id: "home", label: "Home", href: "/home" },
  { id: "masters", label: "Masters", href: "/masters" },
  { id: "students", label: "Students", href: "/students" },
  { id: "admissions", label: "Admissions", href: "/admissions" },
  { id: "staff", label: "Staff", href: "/staff" },
  { id: "store", label: "Store / inventory", href: "/store" },
  { id: "purchase", label: "Purchase · PO · GRN", href: "/store?tab=purchase" },
  { id: "transport", label: "Transport", href: "/transport" },
  { id: "accounts", label: "Accounts", href: "/accounts" },
  { id: "trust", label: "Trust · Construction", href: "/trust" },
  { id: "fees", label: "Fees", href: "/fees" },
  { id: "attendance", label: "Attendance", href: "/attendance" },
  { id: "homework", label: "Homework & Diary", href: "/homework" },
  { id: "timetable", label: "Timetable", href: "/timetable" },
  { id: "teaching", label: "Teaching & syllabus", href: "/teaching" },
  { id: "ptm", label: "PTM", href: "/ptm" },
  { id: "events", label: "Events & calendar", href: "/events" },
  { id: "student_leave", label: "Student leave", href: "/attendance?tab=leave" },
  { id: "vault", label: "Document vault", href: "/vault" },
  { id: "rte", label: "RTE / EWS", href: "/admissions?tab=rte" },
  { id: "payroll", label: "Payroll (full)", href: "/payroll", group: "payroll" },
  {
    id: "staff_advances",
    label: "Staff advances only",
    href: "/payroll?tab=advances",
    group: "payroll",
  },
  { id: "exams", label: "Exams", href: "/exams" },
  { id: "certificates", label: "Certificates", href: "/certificates" },
  { id: "compliance", label: "Compliance / UDISE" },
  { id: "notices", label: "Notices / circulars", href: "/comms?tab=notices" },
  { id: "news", label: "News", href: "/comms?tab=news" },
  { id: "gallery", label: "Gallery", href: "/comms?tab=gallery" },
  { id: "website", label: "Website", href: "/website" },
  { id: "notifications", label: "Notifications", href: "/comms?tab=inbox" },
  {
    id: "wa_templates",
    label: "WA templates",
    href: "/masters?tab=wa-templates",
    group: "whatsapp",
  },
  {
    id: "wa_automation",
    label: "WA automation",
    href: "/masters?tab=automation",
    group: "whatsapp",
  },
  {
    id: "wa_chatbot",
    label: "WA chatbot builder",
    href: "/masters?tab=wa-chatbot",
    group: "whatsapp",
  },
  {
    id: "documents",
    label: "Document maker",
    href: "/documents",
    group: "optional",
  },
  {
    id: "id_cards",
    label: "ID cards",
    href: "/id-cards",
    group: "optional",
  },
  {
    id: "discipline",
    label: "Discipline / behavior",
    href: "/discipline",
  },
  {
    id: "health",
    label: "Health / infirmary",
    href: "/health",
  },
  {
    id: "visitors",
    label: "Visitor / gate management",
    href: "/visitors",
  },
  {
    id: "complaints",
    label: "Complaints / grievance",
    href: "/complaints",
  },
  { id: "hostel", label: "Hostel", href: "/hostel", group: "optional" },
  { id: "canteen", label: "Canteen / POS", href: "/canteen", group: "optional" },
  { id: "alumni", label: "Alumni", href: "/alumni", group: "optional" },
  {
    id: "sports",
    label: "Sports / houses / co-curricular",
    href: "/sports",
    group: "optional",
  },
  {
    id: "opex_budget",
    label: "Operating budget",
    href: "/budget",
    group: "optional",
  },
  {
    id: "scholarships",
    label: "Scholarship disbursement",
    href: "/scholarships",
    group: "optional",
  },
  {
    id: "question_bank",
    label: "Question bank",
    href: "/question-bank",
    group: "optional",
  },
  {
    id: "cbse_loc",
    label: "CBSE LOC / registration",
    href: "/cbse-loc",
    group: "optional",
  },
  { id: "settings", label: "Settings / RBAC", group: "admin" },
  { id: "policies", label: "Policies (leave / holiday)", group: "admin" },
];

export const RBAC_MODULE_GROUPS: { id: string; label: string }[] = [
  { id: "core", label: "Core modules" },
  { id: "payroll", label: "Payroll & advances" },
  { id: "whatsapp", label: "WhatsApp & automation" },
  { id: "optional", label: "Optional add-ons" },
  { id: "admin", label: "Administration" },
];

export const RBAC_ACTIONS: { id: RbacAction; label: string }[] = [
  { id: "view", label: "View" },
  { id: "create", label: "Create" },
  { id: "edit", label: "Edit" },
  { id: "delete", label: "Delete" },
  { id: "void", label: "Void" },
  { id: "approve", label: "Approve" },
  { id: "export", label: "Export" },
  { id: "unlock", label: "Unlock" },
  { id: "impersonate", label: "Impersonate" },
];

const ALL_ACTIONS: RbacAction[] = RBAC_ACTIONS.map((a) => a.id);

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

/** Local staff resolve — avoids circular import with staffResolve.ts */
function resolveStaffForRbac(
  session: { staffId?: string; email?: string; fullName: string },
  masters: MastersState,
): StaffRecord | null {
  const roster = masters.staff ?? [];
  if (session.staffId) {
    const byId = roster.find((s) => s.id === session.staffId);
    if (byId) return byId;
  }
  const email = (session.email || "").trim().toLowerCase();
  if (email) {
    const byEmail = roster.find((s) => {
      const e = (s.email || "").trim().toLowerCase();
      const u = (s.loginUsername || "").trim().toLowerCase();
      const c = (s.empCode || "").trim().toLowerCase();
      return e === email || u === email || c === email;
    });
    if (byEmail) return byEmail;
  }
  const name = (session.fullName || "").trim().toLowerCase();
  if (!name) return null;
  return (
    roster.find((s) => s.fullName.trim().toLowerCase() === name) ?? null
  );
}

function emptyScope(): RoleScope {
  return { campusIds: [], classIds: [], departmentIds: [] };
}

function grant(module: RbacModule, actions: RbacAction[]): PermissionGrant {
  return { module, actions: [...actions] };
}

function allExcept(...deny: RbacAction[]): RbacAction[] {
  return ALL_ACTIONS.filter((a) => !deny.includes(a));
}

/** Built-in role templates (Phase 1) — Accounts has no payroll. */
export function defaultBuiltInRoles(): RbacRole[] {
  const ops: RbacAction[] = ["view", "create", "edit", "delete", "export"];
  const feesOps: RbacAction[] = [
    "view",
    "create",
    "edit",
    "void",
    "export",
  ];
  const teachOps: RbacAction[] = ["view", "create", "edit"];

  return [
    {
      id: "role_owner",
      code: "owner",
      name: "Owner",
      isBuiltIn: true,
      isActive: true,
      makerChecker: false,
      note: "All campuses, billing, policy override, audited impersonation",
      permissions: RBAC_MODULES.map((m) => grant(m.id, ALL_ACTIONS)),
    },
    {
      id: "role_principal",
      code: "principal",
      name: "Principal",
      isBuiltIn: true,
      isActive: true,
      makerChecker: false,
      note: "Campus approvals, policy approve, supervision",
      permissions: RBAC_MODULES.map((m) =>
        grant(
          m.id,
          m.id === "settings" || m.id === "policies"
            ? allExcept("impersonate")
            : allExcept("impersonate"),
        ),
      ),
    },
    {
      id: "role_admin",
      code: "admin",
      name: "Admin",
      isBuiltIn: true,
      isActive: true,
      makerChecker: false,
      note: "Masters, admissions, records, compliance — no salary view",
      permissions: [
        grant("home", ["view"]),
        grant("masters", ops),
        grant("students", [...ops, "export"]),
        grant("admissions", [...ops, "approve", "export"]),
        grant("staff", ops),
        grant("store", ops),
        grant("purchase", ops),
        grant("transport", ["view", "edit"]),
        grant("accounts", ops),
        grant("trust", ops),
        grant("fees", feesOps),
        grant("attendance", ops),
        grant("homework", ops),
        grant("timetable", ops),
        grant("teaching", [...ops, "approve"]),
        grant("ptm", ops),
        grant("events", ops),
        grant("student_leave", ops),
        grant("vault", ops),
        grant("rte", ops),
        grant("exams", ops),
        grant("certificates", ops),
        grant("documents", ["view", "create", "export"]),
        grant("id_cards", ops),
        grant("discipline", [...ops, "approve"]),
        grant("health", ops),
        grant("visitors", ops),
        grant("complaints", [...ops, "approve"]),
        grant("hostel", ["view"]),
        grant("canteen", ["view"]),
        grant("alumni", ["view"]),
        grant("sports", ["view"]),
        grant("opex_budget", ["view"]),
        grant("scholarships", ["view"]),
        grant("question_bank", ["view"]),
        grant("cbse_loc", ["view"]),
        grant("compliance", ["view", "edit", "export"]),
        grant("notices", ops),
        grant("news", ops),
        grant("gallery", ops),
        grant("website", ops),
        grant("notifications", ["view", "edit"]),
        grant("wa_templates", ops),
        grant("wa_automation", [...ops, "approve"]),
        grant("wa_chatbot", ops),
        grant("settings", ["view", "edit"]),
        grant("policies", ["view", "edit", "approve"]),
        // no payroll
      ],
    },
    {
      id: "role_office",
      code: "office",
      name: "Office",
      isBuiltIn: true,
      isActive: true,
      makerChecker: true,
      note: "Prepare payroll & fee take — cannot approve",
      permissions: [
        grant("home", ["view"]),
        grant("masters", ["view"]),
        grant("students", ops),
        grant("admissions", ["view", "create", "edit", "export"]),
        grant("staff", ["view", "edit"]),
        grant("fees", feesOps),
        grant("attendance", ["view", "edit", "approve", "export"]),
        grant("homework", ["view", "export"]),
        grant("timetable", ["view", "create", "edit", "approve", "export"]),
        grant("teaching", ["view", "create", "edit", "export"]),
        grant("ptm", ["view", "create", "edit", "export"]),
        grant("events", ["view", "create", "edit", "delete", "export"]),
        grant("student_leave", ["view", "create", "edit", "approve", "export"]),
        grant("vault", ["view", "export"]),
        grant("rte", ["view", "create", "edit", "export"]),
        grant("store", ["view", "edit", "export"]),
        grant("purchase", ["view", "create", "edit", "approve", "export"]),
        grant("transport", ["view", "edit", "export"]),
        grant("accounts", ["view", "create", "edit", "export", "approve"]),
        grant("trust", ["view", "export"]),
        grant("payroll", ["view", "create", "edit", "export"]),
        grant("staff_advances", ["view", "create", "edit", "delete", "export"]),
        grant("certificates", ops),
        grant("documents", ["view", "create", "export"]),
        grant("id_cards", ["view", "create", "export"]),
        grant("discipline", ["view", "create", "edit", "export"]),
        grant("health", ["view", "create", "edit", "export"]),
        grant("visitors", ["view", "create", "edit", "export"]),
        grant("complaints", [...ops, "approve"]),
        grant("notices", ops),
        grant("news", ops),
        grant("gallery", ops),
        grant("website", ops),
        grant("notifications", ["view"]),
        grant("wa_templates", ["view", "create", "edit", "export"]),
        grant("wa_automation", ["view", "create", "edit", "approve", "export"]),
        grant("wa_chatbot", ["view"]),
        grant("policies", ["view"]),
        grant("settings", ["view"]),
      ],
    },
    {
      id: "role_auditor",
      code: "auditor",
      name: "Auditor (read-only)",
      isBuiltIn: true,
      isActive: true,
      makerChecker: false,
      note: "For the CA at year end — reads the books, changes nothing",
      permissions: [
        grant("home", ["view"]),
        // Everything the year-end pack draws on, and nothing that writes.
        // Reports need only `view` (see /api/ledger), so an auditor can pull
        // the trial balance, I&E, balance sheet, receipts & payments, ledger
        // statements and the reconciliation without holding any right that
        // could alter what they are auditing.
        grant("accounts", ["view", "export"]),
        grant("fees", ["view", "export"]),
        grant("payroll", ["view", "export"]),
        grant("purchase", ["view", "export"]),
        grant("store", ["view", "export"]),
        grant("transport", ["view", "export"]),
        grant("trust", ["view", "export"]),
        grant("students", ["view"]),
        grant("staff", ["view"]),
      ],
    },
    {
      id: "role_accounts",
      code: "accounts",
      name: "Accounts",
      isBuiltIn: true,
      isActive: true,
      makerChecker: true,
      note: "Fees / expenses — no salary or payroll (§6i.4)",
      permissions: [
        grant("home", ["view"]),
        grant("students", ["view"]),
        grant("admissions", ["view"]),
        grant("staff", ["view"]),
        grant("fees", feesOps),
        grant("certificates", ["view", "create", "export"]),
        grant("notices", ["view"]),
        grant("news", ["view"]),
        grant("gallery", ["view"]),
        grant("website", ["view"]),
        grant("notifications", ["view"]),
        grant("staff_advances", ["view", "create", "edit", "export"]),
        grant("store", ["view", "export"]),
        grant("purchase", ["view", "create", "edit", "approve", "export"]),
        grant("transport", ["view", "edit", "export"]),
        grant("accounts", ["view", "create", "edit", "export", "approve"]),
        grant("trust", ["view", "create", "edit", "export", "approve"]),
        // no payroll, masters edit, settings
      ],
    },
    {
      id: "role_transport",
      code: "transport",
      name: "Transport",
      isBuiltIn: true,
      isActive: true,
      makerChecker: false,
      note: "Routes & fleet — no fee policy edit",
      permissions: [
        grant("home", ["view"]),
        grant("transport", ops),
        grant("accounts", ["view"]),
        grant("trust", ["view"]),
        grant("students", ["view"]),
        grant("staff", ["view"]),
        grant("visitors", ["view"]),
        grant("notices", ["view"]),
        grant("notifications", ["view"]),
      ],
    },
    {
      id: "role_teacher",
      code: "teacher",
      name: "Teacher",
      isBuiltIn: true,
      isActive: true,
      makerChecker: false,
      note: "Own class(es) only — mark attendance & exams; verify parent-uploaded docs",
      permissions: [
        grant("home", ["view"]),
        grant("students", ["view", "approve"]),
        grant("staff", ["view"]),
        grant("attendance", teachOps),
        grant("homework", [...teachOps, "export"]),
        grant("timetable", ["view"]),
        // Teachers log their own periods and read their own coverage;
        // they cannot delete a log once written (audit trail) or edit
        // the syllabus plan the school set.
        grant("teaching", teachOps),
        grant("ptm", [...teachOps, "export"]),
        grant("events", ["view"]),
        grant("student_leave", [...teachOps, "approve", "export"]),
        grant("vault", ["view"]),
        grant("purchase", ["view", "create"]),
        grant("exams", teachOps),
        grant("certificates", ["view"]),
        grant("discipline", ["view", "create"]),
        grant("health", ["view", "create"]),
        grant("complaints", ["view", "edit"]),
        grant("notices", ["view"]),
        grant("news", ["view"]),
        grant("gallery", ["view"]),
        grant("website", ["view"]),
        grant("notifications", ["view"]),
      ],
    },
    {
      id: "role_parent",
      code: "parent",
      name: "Parent",
      isBuiltIn: true,
      isActive: true,
      makerChecker: false,
      note: "Self-service portal only",
      permissions: [
        grant("home", ["view"]),
        // "edit" is this codebase's storage-layer write gate for every
        // module's save*() helper (create/update/delete all funnel through
        // it — see assertModulePermission callers) — parents need it to
        // raise a complaint ticket via createComplaintTicket. The UI only
        // exposes ticket creation for their own resolved household; it
        // never exposes assign/resolve, matching the same UI-level (not
        // server-enforced per-record) scoping already accepted for
        // role_teacher's complaints grant.
        grant("complaints", ["view", "edit"]),
      ],
    },
    {
      id: "role_driver",
      code: "driver",
      name: "Driver",
      isBuiltIn: true,
      isActive: true,
      makerChecker: false,
      note: "Field / transport self-service",
      permissions: [
        grant("home", ["view"]),
        grant("transport", ["view"]),
      ],
    },
  ];
}

export function defaultRbacState(): RbacState {
  return {
    version: 1,
    roles: defaultBuiltInRoles(),
    assignments: [],
    audit: [],
  };
}

function normalizeGrant(g: Partial<PermissionGrant> | null | undefined): PermissionGrant | null {
  if (!g?.module) return null;
  const mod = RBAC_MODULES.find((m) => m.id === g.module);
  if (!mod) return null;
  const actions = (Array.isArray(g.actions) ? g.actions : [])
    .filter((a): a is RbacAction =>
      ALL_ACTIONS.includes(a as RbacAction),
    )
    .filter((a, i, arr) => arr.indexOf(a) === i);
  return { module: mod.id, actions };
}

function normalizeRole(r: Partial<RbacRole> | null | undefined): RbacRole | null {
  if (!r?.id || !r.code) return null;
  const permissions = (Array.isArray(r.permissions) ? r.permissions : [])
    .map(normalizeGrant)
    .filter((g): g is PermissionGrant => !!g);
  return {
    id: r.id,
    code: String(r.code).trim().toLowerCase(),
    name: String(r.name || r.code).trim() || r.code,
    isBuiltIn: !!r.isBuiltIn,
    isActive: r.isActive !== false,
    makerChecker: !!r.makerChecker,
    permissions,
    note: String(r.note || ""),
  };
}

function normalizeAssignment(
  a: Partial<UserRoleAssignment> | null | undefined,
): UserRoleAssignment | null {
  if (!a?.id || !a.staffId || !a.roleId) return null;
  const scope = a.scope || emptyScope();
  return {
    id: a.id,
    staffId: a.staffId,
    roleId: a.roleId,
    isPrimary: !!a.isPrimary,
    scope: {
      campusIds: Array.isArray(scope.campusIds) ? scope.campusIds : [],
      classIds: Array.isArray(scope.classIds) ? scope.classIds : [],
      departmentIds: Array.isArray(scope.departmentIds)
        ? scope.departmentIds
        : [],
    },
    expiresOn: String(a.expiresOn || "").slice(0, 10),
    note: String(a.note || ""),
  };
}

export function normalizeRbacState(
  raw?: Partial<RbacState> | null,
): RbacState {
  const base = defaultRbacState();
  if (!raw) return base;
  const rolesRaw = Array.isArray(raw.roles) ? raw.roles : [];
  const roles = rolesRaw
    .map(normalizeRole)
    .filter((r): r is RbacRole => !!r);
  // Ensure built-ins exist; merge newly added modules onto existing built-ins
  for (const b of base.roles) {
    const idx = roles.findIndex((r) => r.code === b.code && r.isBuiltIn);
    if (idx < 0) {
      roles.push(b);
      continue;
    }
    const existing = roles[idx]!;
    const mergedPerms = [...existing.permissions];
    for (const g of b.permissions) {
      if (!mergedPerms.some((p) => p.module === g.module)) {
        mergedPerms.push({ module: g.module, actions: [...g.actions] });
      }
    }
    roles[idx] = { ...existing, permissions: mergedPerms };
  }
  const assignments = (Array.isArray(raw.assignments) ? raw.assignments : [])
    .map(normalizeAssignment)
    .filter((a): a is UserRoleAssignment => !!a);
  const audit = Array.isArray(raw.audit)
    ? raw.audit.slice(0, 200).map((e) => ({
        id: String(e?.id || nid("aud")),
        at: String(e?.at || new Date().toISOString()),
        by: String(e?.by || "system"),
        action: String(e?.action || ""),
        detail: String(e?.detail || ""),
      }))
    : [];
  return { version: 1, roles, assignments, audit };
}

export function loadRbac(): RbacState {
  if (typeof window === "undefined") return defaultRbacState();
  try {
    const raw = window.localStorage.getItem(STORAGE_KEY);
    if (!raw) return defaultRbacState();
    return normalizeRbacState(JSON.parse(raw) as Partial<RbacState>);
  } catch {
    return defaultRbacState();
  }
}

export function saveRbac(state: RbacState): void {
  if (!assertSessionWritable("saveRbac")) return;
  const actor = getSessionActor();
  if (actor && typeof window !== "undefined") {
    // Lazy load to avoid masters ↔ rbac cycles at module init
    // eslint-disable-next-line @typescript-eslint/no-require-imports
    const { loadMasters } = require("@/lib/masters") as typeof import("@/lib/masters");
    if (!canConfigureRbac(actor, loadMasters())) {
      window.dispatchEvent(
        new CustomEvent("bhb-rbac-denied", {
          detail: { module: "settings", action: "edit", label: "saveRbac" },
        }),
      );
      return;
    }
  }
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(normalizeRbacState(state)),
  );
  void import("@/lib/rbacPersistence").then(({ scheduleRbacSync }) => {
    scheduleRbacSync(state);
  });
}

export function writeRbacLocalRaw(state: RbacState): void {
  if (typeof window === "undefined") return;
  window.localStorage.setItem(
    STORAGE_KEY,
    JSON.stringify(normalizeRbacState(state)),
  );
}

export function rbacStateIsEmpty(state: RbacState): boolean {
  return (state.assignments?.length ?? 0) === 0 && (state.audit?.length ?? 0) === 0;
}

export function newRbacId(prefix: string) {
  return nid(prefix);
}

export function appendRbacAudit(
  state: RbacState,
  by: string,
  action: string,
  detail: string,
): RbacState {
  const entry: RbacAuditEntry = {
    id: nid("aud"),
    at: new Date().toISOString(),
    by: by || "system",
    action,
    detail,
  };
  return {
    ...state,
    audit: [entry, ...state.audit].slice(0, 200),
  };
}

export function cloneRole(
  state: RbacState,
  roleId: string,
  code: string,
  name: string,
  by: string,
): { ok: true; state: RbacState; role: RbacRole } | { ok: false; reason: string } {
  const src = state.roles.find((r) => r.id === roleId);
  if (!src) return { ok: false, reason: "Role not found" };
  const c = code.trim().toLowerCase().replace(/\s+/g, "_");
  if (!c) return { ok: false, reason: "Code required" };
  if (state.roles.some((r) => r.code === c)) {
    return { ok: false, reason: "Code already exists" };
  }
  const role: RbacRole = {
    id: nid("role"),
    code: c,
    name: name.trim() || c,
    isBuiltIn: false,
    isActive: true,
    makerChecker: src.makerChecker,
    permissions: src.permissions.map((p) => ({
      module: p.module,
      actions: [...p.actions],
    })),
    note: `Cloned from ${src.name}`,
  };
  let next: RbacState = { ...state, roles: [...state.roles, role] };
  next = appendRbacAudit(next, by, "clone_role", `${src.code} → ${role.code}`);
  return { ok: true, state: next, role };
}

function cloneScope(scope: RoleScope): RoleScope {
  return {
    campusIds: [...scope.campusIds],
    classIds: [...scope.classIds],
    departmentIds: [...scope.departmentIds],
  };
}

/**
 * Copy explicit role assignments from one staff member to another.
 * Does not copy designation-based inference — source must have Assignments rows.
 */
export function copyStaffRoleAssignments(
  state: RbacState,
  fromStaffId: string,
  toStaffId: string,
  by: string,
  opts?: {
    /** When true (default), target's explicit assignments are replaced. */
    replace?: boolean;
    fromLabel?: string;
    toLabel?: string;
  },
):
  | { ok: true; state: RbacState; copied: number; skipped: number }
  | { ok: false; reason: string } {
  if (!fromStaffId || !toStaffId) {
    return { ok: false, reason: "Pick both staff members" };
  }
  if (fromStaffId === toStaffId) {
    return { ok: false, reason: "Source and target must be different staff" };
  }

  const source = state.assignments.filter(
    (a) => a.staffId === fromStaffId && assignmentActive(a),
  );
  if (!source.length) {
    return {
      ok: false,
      reason:
        "Source has no explicit role assignments (access may come from designation only). Assign roles to the source staff first, or clone a role template under Roles.",
    };
  }

  const replace = opts?.replace !== false;
  let assignments = replace
    ? state.assignments.filter((a) => a.staffId !== toStaffId)
    : [...state.assignments];

  const existingRoleIds = new Set(
    assignments
      .filter((a) => a.staffId === toStaffId && assignmentActive(a))
      .map((a) => a.roleId),
  );

  let copied = 0;
  let skipped = 0;
  const fromLabel = opts?.fromLabel?.trim() || fromStaffId;
  const stamp = `Copied from ${fromLabel}`;

  for (const src of source) {
    if (!replace && existingRoleIds.has(src.roleId)) {
      skipped += 1;
      continue;
    }
    const row: UserRoleAssignment = {
      id: newRbacId("ura"),
      staffId: toStaffId,
      roleId: src.roleId,
      isPrimary: false,
      scope: cloneScope(src.scope),
      expiresOn: src.expiresOn,
      note: src.note?.trim() ? `${src.note.trim()} · ${stamp}` : stamp,
    };
    assignments.push(row);
    copied += 1;
    existingRoleIds.add(src.roleId);
  }

  if (copied === 0) {
    return {
      ok: false,
      reason:
        skipped > 0
          ? "Target already has all roles from the source (try Replace existing)."
          : "Nothing to copy",
    };
  }

  const targetRows = assignments.filter((a) => a.staffId === toStaffId);
  const sourcePrimary = source.find((a) => a.isPrimary)?.roleId;
  let primarySet = false;
  assignments = assignments.map((a) => {
    if (a.staffId !== toStaffId) return a;
    const wantPrimary =
      !primarySet &&
      (sourcePrimary
        ? a.roleId === sourcePrimary
        : a.id === targetRows[0]?.id);
    if (wantPrimary) {
      primarySet = true;
      return { ...a, isPrimary: true };
    }
    return { ...a, isPrimary: false };
  });

  const toLabel = opts?.toLabel?.trim() || toStaffId;
  let next: RbacState = { ...state, assignments };
  next = appendRbacAudit(
    next,
    by,
    "copy_staff_access",
    `${fromLabel} → ${toLabel} (${copied} role${copied === 1 ? "" : "s"})`,
  );
  return { ok: true, state: next, copied, skipped };
}

export function setRolePermission(
  state: RbacState,
  roleId: string,
  module: RbacModule,
  action: RbacAction,
  enabled: boolean,
  by: string,
): RbacState {
  const roles = state.roles.map((r) => {
    if (r.id !== roleId) return r;
    const perms = [...r.permissions];
    let g = perms.find((p) => p.module === module);
    if (!g) {
      g = { module, actions: [] };
      perms.push(g);
    }
    const actions = new Set(g.actions);
    if (enabled) actions.add(action);
    else actions.delete(action);
    g = { module, actions: [...actions] };
    const nextPerms = perms
      .filter((p) => p.module !== module)
      .concat(g.actions.length ? [g] : []);
    return { ...r, permissions: nextPerms };
  });
  return appendRbacAudit(
    { ...state, roles },
    by,
    enabled ? "grant" : "revoke",
    `${roleId} ${module}.${action}`,
  );
}

/** Modules whose reports appear in Reports Center. */
export const REPORTS_CENTER_RBAC_MODULES: RbacModule[] = [
  "fees",
  "students",
  "admissions",
  "staff",
  "attendance",
  "homework",
  "timetable",
  "teaching",
  "ptm",
  "student_leave",
  "vault",
  "rte",
  "payroll",
  "store",
  "purchase",
  "transport",
  "accounts",
  "trust",
];

export function canAccessReportsCenter(
  session: SessionLike,
  masters: MastersState | null | undefined,
  rbac?: RbacState,
): boolean {
  return REPORTS_CENTER_RBAC_MODULES.some((m) =>
    canAccessModule(session, masters, m, rbac),
  );
}

export function moduleForHref(href: string): RbacModule | null {
  const [pathPart, query = ""] = href.split("?");
  const path = pathPart || "";
  const params = new URLSearchParams(query);
  if (path === "/home" || path === "/") return "home";
  if (path.startsWith("/reports")) return null; // handled in canAccessHref
  if (path.startsWith("/modules")) return "settings";
  if (path.startsWith("/fees/defaulters")) return "fees";
  if (path.startsWith("/fees")) return "fees";
  if (path.startsWith("/masters")) {
    const tab = params.get("tab");
    if (tab === "wa-templates") return "wa_templates";
    if (tab === "automation") return "wa_automation";
    if (tab === "wa-chatbot") return "wa_chatbot";
    if (tab === "roles") return "settings";
    return "masters";
  }
  if (path.startsWith("/students")) {
    // Students → UDISE+ tab is compliance-scoped
    if (params.get("tab") === "udise") return "compliance";
    return "students";
  }
  if (path.startsWith("/admissions")) return "admissions";
  if (path.startsWith("/staff")) return "staff";
  if (path.startsWith("/inventory")) return "store";
  if (path.startsWith("/store")) return "store";
  if (path.startsWith("/library")) return "store";
  if (path.startsWith("/purchase")) return "purchase";
  if (path.startsWith("/transport")) return "transport";
  if (path.startsWith("/accounts") || path.startsWith("/expenses")) return "accounts";
  if (path.startsWith("/trust") || path.startsWith("/construction")) return "trust";
  if (path.startsWith("/attendance")) return "attendance";
  if (path.startsWith("/homework")) return "homework";
  if (path.startsWith("/timetable")) return "timetable";
  if (path.startsWith("/teaching")) return "teaching";
  if (path.startsWith("/ptm")) return "ptm";
  if (path.startsWith("/events")) return "events";
  if (path.startsWith("/student-leave")) return "student_leave";
  if (path.startsWith("/vault")) return "vault";
  if (path.startsWith("/rte")) return "rte";
  if (path.startsWith("/payroll")) {
    const tab = params.get("tab");
    if (tab === "advances") return "staff_advances";
    if (tab === "myAdvances" || tab === "mine") return "payroll";
    return "payroll";
  }
  if (path.startsWith("/exams")) return "exams";
  if (path.startsWith("/certificates")) return "certificates";
  if (path.startsWith("/documents")) return "documents";
  if (path.startsWith("/id-cards")) return "id_cards";
  if (path.startsWith("/discipline")) return "discipline";
  if (path.startsWith("/health")) return "health";
  if (path.startsWith("/visitors")) return "visitors";
  if (path.startsWith("/complaints")) return "complaints";
  if (path.startsWith("/hostel")) return "hostel";
  if (path.startsWith("/canteen")) return "canteen";
  if (path.startsWith("/alumni")) return "alumni";
  if (path.startsWith("/sports")) return "sports";
  if (path.startsWith("/budget")) return "opex_budget";
  if (path.startsWith("/scholarships")) return "scholarships";
  if (path.startsWith("/question-bank")) return "question_bank";
  if (path.startsWith("/cbse-loc")) return "cbse_loc";
  if (path.startsWith("/website")) return "website";
  if (path.startsWith("/comms") || path.startsWith("/notices") || path.startsWith("/news") || path.startsWith("/gallery")) {
    const tab = params.get("tab");
    if (tab === "news" || path.startsWith("/news")) return "news";
    if (tab === "gallery" || path.startsWith("/gallery")) return "gallery";
    if (tab === "inbox") return "notifications";
    return "notices";
  }
  return null;
}

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function assignmentActive(a: UserRoleAssignment): boolean {
  if (!a.expiresOn) return true;
  return a.expiresOn >= todayIso();
}

/**
 * Infer built-in role code from session.roleCode / designation when no
 * assignment exists. "owner" is deliberately NOT inferable here — it used
 * to match any roleCode/designation containing "trustee" or "director",
 * so an ordinary "Director of Admissions" or "Sports Director" designation
 * (routine HR data, not a security decision) silently granted full owner
 * access. isProtectedSuperAdminEmail() is now the only inferred path to
 * owner; anyone else must get it via an explicit assignment in Masters →
 * Roles, where a human is actually deciding to grant it.
 */
export function inferRoleCodes(
  session: SessionLike,
  masters?: MastersState | null,
): string[] {
  if (isProtectedSuperAdminEmail(session.email)) {
    return ["owner"];
  }
  const rc = (session.roleCode || "").toLowerCase();
  const matched: string[] = [];

  if (/principal|hm|head.?master|vice.?principal/.test(rc)) {
    matched.push("principal");
  }
  if (/^admin$|administrator|registrar/.test(rc)) matched.push("admin");
  if (/office|front.?office/.test(rc)) matched.push("office");
  // Checked before the accounts branch, and it suppresses it. A role code like
  // "audit accountant" matches both patterns, and where a code is ambiguous
  // the read-only reading is the safe one: an auditor wrongly given write
  // rights can alter the books they are checking, while an accountant wrongly
  // read-only is merely inconvenienced and says so immediately.
  const isAuditor = /auditor|chartered.?accountant/.test(rc);
  if (isAuditor) matched.push("auditor");
  if (!isAuditor && /accounts|accountant|cashier|finance/.test(rc)) {
    matched.push("accounts");
  }
  if (/clerk/.test(rc)) matched.push("office");
  if (/transport|fleet/.test(rc)) matched.push("transport");
  if (/teacher|tgt|pgt|prt|faculty|lecturer/.test(rc)) matched.push("teacher");
  if (/driver/.test(rc)) matched.push("driver");
  if (/parent|guardian/.test(rc)) matched.push("parent");

  if (masters) {
    const self = resolveStaffForRbac(session, masters);
    if (self) {
      const des = masters.designations.find((d) => d.id === self.designationId);
      const blob = `${des?.code || ""} ${des?.name || ""}`.toLowerCase();
      if (/prin|principal|hm|head.?master|vice.?principal/.test(blob)) {
        matched.push("principal");
      }
      if (/admin|registrar/.test(blob)) matched.push("admin");
      if (/office|clerk/.test(blob)) matched.push("office");
      if (/accounts|accountant|cashier/.test(blob)) matched.push("accounts");
      if (/driver/.test(blob)) matched.push("driver");
      if (/teacher|tgt|pgt|prt|faculty/.test(blob)) matched.push("teacher");
      if (self.stream === "teaching" && matched.length === 0) {
        matched.push("teacher");
      }
    }
  }

  if (matched.length === 0) {
    // Demo blank staff login is principal
    if ((session.persona || "staff") === "staff") matched.push("principal");
    else if (session.persona === "parent") matched.push("parent");
    else if (session.persona === "field") matched.push("driver");
    else matched.push("teacher");
  }

  return [...new Set(matched)];
}

/** A role as held by the current session, plus the scope it was granted
 * under (null = held via inferred/fallback role, i.e. no per-staff
 * assignment record exists — unrestricted, same as historical behavior). */
export type ScopedRole = { role: RbacRole; scope: RoleScope | null };

function activeAssignmentsFor(
  rbac: RbacState,
  self: { id: string } | null,
): UserRoleAssignment[] {
  if (!self) return [];
  return rbac.assignments.filter(
    (a) => a.staffId === self.id && assignmentActive(a),
  );
}

/**
 * Like resolveSessionRoles, but keeps each role's assignment-level scope
 * attached instead of discarding it — the input hasScopedPermission needs
 * to enforce campus/class/department restrictions.
 */
export function resolveSessionRoleScopes(
  rbac: RbacState,
  session: SessionLike,
  masters?: MastersState | null,
): ScopedRole[] {
  const self = masters ? resolveStaffForRbac(session, masters) : null;
  const fromAssign = activeAssignmentsFor(rbac, self);

  if (fromAssign.length > 0) {
    const scoped = fromAssign
      .map((a): ScopedRole | null => {
        const role = rbac.roles.find((r) => r.id === a.roleId);
        return role && role.isActive ? { role, scope: a.scope } : null;
      })
      .filter((x): x is ScopedRole => !!x);
    if (scoped.length) return scoped;
  }

  const codes = inferRoleCodes(session, masters);
  return rbac.roles
    .filter((r) => r.isActive && codes.includes(r.code))
    .map((role) => ({ role, scope: null }));
}

export function resolveSessionRoles(
  rbac: RbacState,
  session: SessionLike,
  masters?: MastersState | null,
): RbacRole[] {
  return resolveSessionRoleScopes(rbac, session, masters).map((x) => x.role);
}

export function effectivePermissions(
  roles: RbacRole[],
): Map<RbacModule, Set<RbacAction>> {
  const map = new Map<RbacModule, Set<RbacAction>>();
  for (const role of roles) {
    for (const g of role.permissions) {
      let set = map.get(g.module);
      if (!set) {
        set = new Set();
        map.set(g.module, set);
      }
      for (const a of g.actions) set.add(a);
    }
  }
  return map;
}

export function hasPermission(
  session: SessionLike,
  masters: MastersState | null | undefined,
  module: RbacModule,
  action: RbacAction,
  rbac?: RbacState,
): boolean {
  const state = rbac ?? (typeof window !== "undefined" ? loadRbac() : defaultRbacState());
  const roles = resolveSessionRoles(state, session, masters);
  const eff = effectivePermissions(roles);
  return !!eff.get(module)?.has(action);
}

/** The record being accessed, for scope-aware checks. Omit a field (or the
 * whole object) when the caller doesn't know it / it doesn't apply. */
export type EntityScope = {
  campusId?: string | null;
  classId?: string | null;
  departmentId?: string | null;
};

function scopeAllows(scope: RoleScope | null, entity?: EntityScope): boolean {
  if (!scope || !entity) return true;
  if (
    scope.campusIds.length &&
    entity.campusId &&
    !scope.campusIds.includes(entity.campusId)
  ) {
    return false;
  }
  if (
    scope.classIds.length &&
    entity.classId &&
    !scope.classIds.includes(entity.classId)
  ) {
    return false;
  }
  if (
    scope.departmentIds.length &&
    entity.departmentId &&
    !scope.departmentIds.includes(entity.departmentId)
  ) {
    return false;
  }
  return true;
}

/**
 * Scope-aware sibling of hasPermission. Without `entity` it is identical to
 * hasPermission (an assignment's scope only narrows access to a *specific*
 * record — a caller that isn't asking about one gets the same module-level
 * answer as before). Pass `entity` to also enforce the assignment's
 * campus/class/department restriction, e.g. a teacher assigned "teacher"
 * scoped to classIds: ["cls_vi"] is denied for entity: { classId: "cls_ix" }
 * even though the "teacher" role itself grants students.view.
 */
export function hasScopedPermission(
  session: SessionLike,
  masters: MastersState | null | undefined,
  module: RbacModule,
  action: RbacAction,
  rbac?: RbacState,
  entity?: EntityScope,
): boolean {
  const state = rbac ?? (typeof window !== "undefined" ? loadRbac() : defaultRbacState());
  const scopedRoles = resolveSessionRoleScopes(state, session, masters);
  for (const { role, scope } of scopedRoles) {
    const grant = role.permissions.find((g) => g.module === module);
    if (!grant?.actions.includes(action)) continue;
    if (scopeAllows(scope, entity)) return true;
  }
  return false;
}

/**
 * Class ids the session's assignments restrict it to, for read-side
 * filtering (e.g. trimming a class picker to what a scoped teacher may
 * touch). Returns null when unrestricted (no assignment scope, or any held
 * assignment for `module` has an empty classIds — the widest grant wins).
 */
export function scopedClassIds(
  session: SessionLike,
  masters: MastersState | null | undefined,
  module: RbacModule,
  action: RbacAction,
  rbac?: RbacState,
): string[] | null {
  const state = rbac ?? (typeof window !== "undefined" ? loadRbac() : defaultRbacState());
  const scopedRoles = resolveSessionRoleScopes(state, session, masters);
  const restricting: string[][] = [];
  for (const { role, scope } of scopedRoles) {
    const grant = role.permissions.find((g) => g.module === module);
    if (!grant?.actions.includes(action)) continue;
    if (!scope || scope.classIds.length === 0) return null;
    restricting.push(scope.classIds);
  }
  if (restricting.length === 0) return null;
  return [...new Set(restricting.flat())];
}

export function canAccessModule(
  session: SessionLike,
  masters: MastersState | null | undefined,
  module: RbacModule,
  rbac?: RbacState,
): boolean {
  return hasPermission(session, masters, module, "view", rbac);
}

/** Masters sub-tab → RBAC module (fee setup tabs use `masters`). */
export function moduleForMastersTab(tab: string | null | undefined): RbacModule {
  if (tab === "wa-templates") return "wa_templates";
  if (tab === "automation") return "wa_automation";
  if (tab === "wa-chatbot") return "wa_chatbot";
  if (tab === "roles") return "settings";
  return "masters";
}

export function canAccessMastersTab(
  session: SessionLike,
  masters: MastersState | null | undefined,
  tab: string | null | undefined,
  rbac?: RbacState,
  action: RbacAction = "view",
): boolean {
  return hasPermission(
    session,
    masters,
    moduleForMastersTab(tab),
    action,
    rbac,
  );
}

export function canAccessHref(
  session: SessionLike,
  masters: MastersState | null | undefined,
  href: string,
  rbac?: RbacState,
): boolean {
  const path = href.split("?")[0] || "";
  if (path.startsWith("/reports")) {
    return (
      canAccessReportsCenter(session, masters, rbac) &&
      canAccessModuleHref(href)
    );
  }
  if (path.startsWith("/student-leave")) {
    return (
      (canAccessModule(session, masters, "student_leave", rbac) ||
        canAccessModule(session, masters, "attendance", rbac)) &&
      canAccessModuleHref(href)
    );
  }
  if (path.startsWith("/purchase")) {
    return (
      (canAccessModule(session, masters, "purchase", rbac) ||
        canAccessModule(session, masters, "store", rbac)) &&
      canAccessModuleHref(href)
    );
  }
  if (path.startsWith("/rte")) {
    return (
      (canAccessModule(session, masters, "rte", rbac) ||
        canAccessModule(session, masters, "admissions", rbac)) &&
      canAccessModuleHref(href)
    );
  }
  if (path.startsWith("/admissions")) {
    const qs = href.includes("?") ? href.split("?")[1] : "";
    const tab = new URLSearchParams(qs).get("tab");
    if (tab === "rte") {
      return (
        (canAccessModule(session, masters, "rte", rbac) ||
          canAccessModule(session, masters, "admissions", rbac)) &&
        canAccessModuleHref(href)
      );
    }
  }
  if (path.startsWith("/attendance")) {
    const qs = href.includes("?") ? href.split("?")[1] : "";
    const tab = new URLSearchParams(qs).get("tab");
    if (tab === "leave" || tab === "student-leave" || tab === "student_leave") {
      return (
        (canAccessModule(session, masters, "student_leave", rbac) ||
          canAccessModule(session, masters, "attendance", rbac)) &&
        canAccessModuleHref(href)
      );
    }
  }
  if (path.startsWith("/store")) {
    const qs = href.includes("?") ? href.split("?")[1] : "";
    const tab = new URLSearchParams(qs).get("tab");
    if (tab === "purchase" || tab === "indent" || tab === "po" || tab === "grn") {
      return (
        (canAccessModule(session, masters, "purchase", rbac) ||
          canAccessModule(session, masters, "store", rbac)) &&
        canAccessModuleHref(href)
      );
    }
  }
  if (path.startsWith("/payroll")) {
    const qs = href.includes("?") ? href.split("?")[1] : "";
    const tab = new URLSearchParams(qs).get("tab");
    if (tab === "advances") {
      return (
        (canAccessModule(session, masters, "staff_advances", rbac) ||
          canAccessModule(session, masters, "payroll", rbac)) &&
        canAccessModuleHref(href)
      );
    }
    if (tab === "myAdvances" || tab === "mine") {
      return canAccessModuleHref(href);
    }
    if (
      canAccessModule(session, masters, "payroll", rbac) ||
      canAccessModule(session, masters, "staff_advances", rbac)
    ) {
      return canAccessModuleHref(href);
    }
    return false;
  }
  const mod = moduleForHref(href);
  if (!mod) return canAccessModuleHref(href);
  if (mod === "home") return canAccessModuleHref(href);
  if (!canAccessModule(session, masters, mod, rbac)) return false;
  return canAccessModuleHref(href);
}

/** Who may edit Roles & Permissions matrix */
export function canConfigureRbac(
  session: SessionLike,
  masters?: MastersState | null,
  rbac?: RbacState,
): boolean {
  if (isProtectedSuperAdminEmail(session.email)) return true;
  if (hasPermission(session, masters ?? null, "settings", "edit", rbac)) {
    return true;
  }
  const codes = inferRoleCodes(session, masters);
  return codes.some((c) => c === "owner" || c === "principal" || c === "admin");
}

export type AccessSummaryRow = {
  capability: string;
  module: RbacModule;
  action: RbacAction;
  roleNames: string[];
};

/** Principal view: who can approve waivers / edit marks / export UDISE */
export function principalAccessSummary(rbac: RbacState): AccessSummaryRow[] {
  const checks: { capability: string; module: RbacModule; action: RbacAction }[] =
    [
      { capability: "Approve fee waivers / concessions", module: "fees", action: "approve" },
      { capability: "Manage admissions (enroll)", module: "admissions", action: "edit" },
      { capability: "Edit exam marks", module: "exams", action: "edit" },
      { capability: "Export UDISE / compliance", module: "compliance", action: "export" },
      {
        capability: "Issue staff salary advances",
        module: "staff_advances",
        action: "edit",
      },
      { capability: "Approve payroll", module: "payroll", action: "approve" },
      { capability: "Edit masters", module: "masters", action: "edit" },
      { capability: "Configure policies", module: "policies", action: "edit" },
      {
        capability: "Submit WhatsApp templates to Meta",
        module: "wa_templates",
        action: "edit",
      },
      {
        capability: "Approve WA automation sends",
        module: "wa_automation",
        action: "approve",
      },
      {
        capability: "Edit WhatsApp chatbot flows",
        module: "wa_chatbot",
        action: "edit",
      },
      { capability: "Impersonate users", module: "settings", action: "impersonate" },
    ];

  return checks.map((c) => {
    const roleNames = rbac.roles
      .filter(
        (r) =>
          r.isActive &&
          r.permissions.some(
            (p) => p.module === c.module && p.actions.includes(c.action),
          ),
      )
      .map((r) => r.name);
    return { ...c, roleNames };
  });
}

export type StaffAccessRow = {
  staffId: string;
  staffName: string;
  empCode: string;
  roles: string[];
  expiresSoon: boolean;
};

export function staffAccessOverview(
  rbac: RbacState,
  masters: MastersState,
): StaffAccessRow[] {
  const byStaff = new Map<string, UserRoleAssignment[]>();
  for (const a of rbac.assignments) {
    if (!assignmentActive(a)) continue;
    const list = byStaff.get(a.staffId) || [];
    list.push(a);
    byStaff.set(a.staffId, list);
  }
  const rows: StaffAccessRow[] = [];
  for (const [staffId, assigns] of byStaff) {
    const staff = masters.staff?.find((s) => s.id === staffId);
    const roles = assigns
      .map((a) => rbac.roles.find((r) => r.id === a.roleId)?.name)
      .filter((n): n is string => !!n);
    const expiresSoon = assigns.some((a) => {
      if (!a.expiresOn) return false;
      const in7 = new Date();
      in7.setDate(in7.getDate() + 7);
      return a.expiresOn <= in7.toISOString().slice(0, 10);
    });
    rows.push({
      staffId,
      staffName: staff?.fullName || staffId,
      empCode: staff?.empCode || "",
      roles,
      expiresSoon,
    });
  }
  return rows.sort((a, b) => a.staffName.localeCompare(b.staffName));
}

export function roleHasAction(
  role: RbacRole,
  module: RbacModule,
  action: RbacAction,
): boolean {
  return !!role.permissions
    .find((p) => p.module === module)
    ?.actions.includes(action);
}
