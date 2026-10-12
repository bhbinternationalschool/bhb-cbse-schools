/**
 * Masters → Roles & permissions: the permission TREE the office edits.
 *
 * Director, 12 Oct 2026: "like the old ERP" — pick a staff member (or a
 * role) and see Category → Module → function → action checkboxes, with the
 * ticks that come from the person's roles told apart from the ones given to
 * them alone, and the ones taken away from them alone.
 *
 * Everything here is pure (no storage, no React) so the rules are
 * self-tested in rbacEditorModel.selftest.ts. The tree is built from
 * RBAC_MODULES and the function catalogue (lib/rbacFeatureCatalog) at call
 * time — a function added to the catalogue appears here with no edit.
 */
import {
  RBAC_MODULES,
  personalGrantTarget,
  setPersonalGrant,
  type FeatureGrant,
  type PermissionGrant,
  type RbacAction,
  type RbacModule,
  type RbacRole,
  type RbacState,
  type UserPermissionGrant,
} from "@/lib/rbac";
import { featuresForModule, findFeature } from "@/lib/rbacFeatures";

/* ─── Categories (the old ERP's five headings) ─────────────────────────── */

export type RbacCategoryId =
  | "setup"
  | "financial"
  | "communication"
  | "administration"
  | "academic";

export const RBAC_CATEGORIES: { id: RbacCategoryId; label: string }[] = [
  { id: "setup", label: "Setup your school" },
  { id: "financial", label: "Financial" },
  { id: "communication", label: "Communication" },
  { id: "administration", label: "Administration" },
  { id: "academic", label: "Academic" },
];

/**
 * Every module's heading. A Record over the RbacModule union, so a module
 * added to rbac.ts fails the typecheck until somebody places it here.
 * Admissions sits under Financial because that is where the old ERP put it
 * and where the office looks for it.
 */
export const MODULE_CATEGORY: Record<RbacModule, RbacCategoryId> = {
  home: "setup",
  masters: "setup",
  settings: "setup",
  policies: "setup",
  website: "setup",
  documents: "setup",
  id_cards: "setup",

  fees: "financial",
  accounts: "financial",
  accounts_position: "financial",
  payroll: "financial",
  staff_advances: "financial",
  store: "financial",
  purchase: "financial",
  trust: "financial",
  opex_budget: "financial",
  scholarships: "financial",
  canteen: "financial",
  admissions: "financial",
  rte: "financial",

  notices: "communication",
  news: "communication",
  gallery: "communication",
  notifications: "communication",
  wa_templates: "communication",
  wa_automation: "communication",
  wa_chatbot: "communication",
  events: "communication",

  students: "administration",
  staff: "administration",
  attendance: "administration",
  student_leave: "administration",
  transport: "administration",
  visitors: "administration",
  complaints: "administration",
  discipline: "administration",
  health: "administration",
  hostel: "administration",
  alumni: "administration",
  vault: "administration",
  compliance: "administration",

  exams: "academic",
  homework: "academic",
  timetable: "academic",
  online_classes: "academic",
  teaching: "academic",
  ptm: "academic",
  question_bank: "academic",
  cbse_loc: "academic",
  certificates: "academic",
  sports: "academic",
};

/* ─── Actions ──────────────────────────────────────────────────────────── */

/** Column order, and the office's words for each action. */
export const TREE_ACTIONS: { id: RbacAction; label: string }[] = [
  { id: "view", label: "View" },
  { id: "create", label: "Add" },
  { id: "edit", label: "Edit" },
  { id: "delete", label: "Delete" },
  { id: "approve", label: "Approve" },
  { id: "export", label: "Export" },
  { id: "void", label: "Void" },
  { id: "unlock", label: "Unlock" },
  { id: "impersonate", label: "Impersonate" },
];

const ACTION_ORDER = TREE_ACTIONS.map((a) => a.id);

export function actionLabel(a: RbacAction): string {
  return TREE_ACTIONS.find((x) => x.id === a)?.label ?? a;
}

function sortActions(list: RbacAction[]): RbacAction[] {
  return [...new Set(list)].sort((a, b) => ACTION_ORDER.indexOf(a) - ACTION_ORDER.indexOf(b));
}

const BASE_ACTIONS: RbacAction[] = ["view", "create", "edit", "delete", "approve", "export"];

/** Void (cancel a receipt / voucher) and Unlock (reopen a closed day, frozen
 * marks) mean something only in these modules; Impersonate only in Settings. */
const EXTRA_ACTIONS: Partial<Record<RbacModule, RbacAction[]>> = {
  fees: ["void", "unlock"],
  accounts: ["void", "unlock"],
  store: ["void"],
  purchase: ["void"],
  payroll: ["void", "unlock"],
  trust: ["void"],
  exams: ["unlock"],
  attendance: ["unlock"],
  settings: ["impersonate"],
};

/** The whole-module row's actions. */
export function moduleTreeActions(module: RbacModule): RbacAction[] {
  if (module === "home") return ["view"];
  return sortActions([...BASE_ACTIONS, ...(EXTRA_ACTIONS[module] ?? [])]);
}

/* ─── The tree ─────────────────────────────────────────────────────────── */

export type TreeFunction = {
  /** "__module:<module>" for the whole-module row, else the function id. */
  key: string;
  kind: "module" | "feature";
  module: RbacModule;
  featureId?: string;
  label: string;
  blurb: string;
  group?: string;
  classScoped?: boolean;
  actions: RbacAction[];
};

export type TreeModule = {
  module: RbacModule;
  label: string;
  /** First row is always the whole module; then its functions. */
  rows: TreeFunction[];
};

export type TreeCategory = {
  id: RbacCategoryId;
  label: string;
  modules: TreeModule[];
};

export type TreeLeaf = {
  kind: "module" | "feature";
  module: RbacModule;
  featureId?: string;
  action: RbacAction;
};

export function wholeModuleKey(module: RbacModule): string {
  return `__module:${module}`;
}

export function leafKey(leaf: TreeLeaf): string {
  return leaf.kind === "module"
    ? `m:${leaf.module}:${leaf.action}`
    : `f:${leaf.featureId}:${leaf.action}`;
}

export function buildPermissionTree(): TreeCategory[] {
  return RBAC_CATEGORIES.map((cat) => ({
    id: cat.id,
    label: cat.label,
    modules: RBAC_MODULES.filter((m) => MODULE_CATEGORY[m.id] === cat.id).map((m) => {
      const fns = featuresForModule(m.id);
      // Grouped functions keep catalogue order inside their group; groups
      // appear in the order their first function does.
      const groupOrder: string[] = [];
      for (const f of fns) {
        const g = f.group || "";
        if (!groupOrder.includes(g)) groupOrder.push(g);
      }
      const ordered = groupOrder.flatMap((g) => fns.filter((f) => (f.group || "") === g));
      return {
        module: m.id,
        label: m.label,
        rows: [
          {
            key: wholeModuleKey(m.id),
            kind: "module" as const,
            module: m.id,
            label: fns.length ? "Whole module (every screen, incl. ones no function lists)" : "Whole module",
            blurb: `Everything in ${m.label}.`,
            actions: moduleTreeActions(m.id),
          },
          ...ordered.map((f) => ({
            key: f.id,
            kind: "feature" as const,
            module: m.id,
            featureId: f.id,
            label: f.label,
            blurb: f.blurb,
            group: f.group,
            classScoped: f.classScoped,
            actions: sortActions(f.actions),
          })),
        ],
      };
    }),
  })).filter((c) => c.modules.length > 0);
}

export function rowLeaves(row: TreeFunction): TreeLeaf[] {
  return row.actions.map((action) => ({
    kind: row.kind,
    module: row.module,
    featureId: row.featureId,
    action,
  }));
}

export function moduleLeaves(m: TreeModule): TreeLeaf[] {
  return m.rows.flatMap(rowLeaves);
}

export function allLeaves(tree: TreeCategory[]): TreeLeaf[] {
  return tree.flatMap((c) => c.modules.flatMap(moduleLeaves));
}

/** Search: a module matches by its own label (all rows), else row by row. */
export function filterTree(tree: TreeCategory[], query: string): TreeCategory[] {
  const q = query.trim().toLowerCase();
  if (!q) return tree;
  return tree
    .map((c) => ({
      ...c,
      modules: c.modules
        .map((m) => {
          if (m.label.toLowerCase().includes(q) || c.label.toLowerCase().includes(q)) return m;
          const rows = m.rows.filter(
            (r, i) =>
              i > 0 &&
              (r.label.toLowerCase().includes(q) ||
                r.blurb.toLowerCase().includes(q) ||
                (r.group || "").toLowerCase().includes(q) ||
                (r.featureId || "").toLowerCase().includes(q)),
          );
          return rows.length ? { ...m, rows: [m.rows[0]!, ...rows] } : null;
        })
        .filter((m): m is TreeModule => !!m),
    }))
    .filter((c) => c.modules.length > 0);
}

/* ─── Evaluating a ROLE ────────────────────────────────────────────────── */

export type RoleLeafState = { on: boolean; viaWholeModule: boolean };

function roleModuleHas(role: Pick<RbacRole, "permissions">, module: RbacModule, action: RbacAction) {
  return !!role.permissions.find((p) => p.module === module)?.actions.includes(action);
}

function roleFeatureHas(role: Pick<RbacRole, "featureGrants">, featureId: string, action: RbacAction) {
  return !!role.featureGrants?.find((g) => g.feature === featureId)?.actions.includes(action);
}

export function roleLeafState(
  role: Pick<RbacRole, "permissions" | "featureGrants">,
  leaf: TreeLeaf,
): RoleLeafState {
  const viaModule = roleModuleHas(role, leaf.module, leaf.action);
  if (leaf.kind === "module") return { on: viaModule, viaWholeModule: false };
  return {
    on: viaModule || roleFeatureHas(role, leaf.featureId!, leaf.action),
    viaWholeModule: viaModule,
  };
}

type RoleGrants = { permissions: PermissionGrant[]; featureGrants: FeatureGrant[] };

/** Turn one leaf on/off on a role's grants (a draft — nothing is saved). */
export function setRoleLeaf<T extends RoleGrants>(role: T, leaf: TreeLeaf, on: boolean): T {
  if (leaf.kind === "module") {
    const cur = role.permissions.find((p) => p.module === leaf.module)?.actions ?? [];
    const next = on ? sortActions([...cur, leaf.action]) : cur.filter((a) => a !== leaf.action);
    const permissions = role.permissions
      .filter((p) => p.module !== leaf.module)
      .concat(next.length ? [{ module: leaf.module, actions: next }] : []);
    return { ...role, permissions };
  }
  const def = findFeature(leaf.featureId!);
  if (!def || !def.actions.includes(leaf.action)) return role;
  const cur = role.featureGrants.find((g) => g.feature === def.id)?.actions ?? [];
  const next = on ? sortActions([...cur, leaf.action]) : cur.filter((a) => a !== leaf.action);
  const featureGrants = role.featureGrants
    .filter((g) => g.feature !== def.id)
    .concat(next.length ? [{ feature: def.id, actions: next }] : []);
  return { ...role, featureGrants };
}

/**
 * Tick or clear a set of leaves on a role (a module, a category, Check
 * all). Clearing a whole module clears its functions' own grants too when
 * they are in the set, so "untick Fees" leaves nothing of Fees behind.
 */
export function setRoleLeaves<T extends RoleGrants>(role: T, leaves: TreeLeaf[], on: boolean): T {
  // Module rows first, so a function's state is judged after its module's.
  const ordered = [...leaves].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "module" ? -1 : 1));
  let next = role;
  for (const leaf of ordered) {
    const st = roleLeafState(next, leaf);
    // Held through the module tick: that tick decides it, not this cell.
    if (leaf.kind === "feature" && st.viaWholeModule) continue;
    if (st.on !== on) next = setRoleLeaf(next, leaf, on);
  }
  return next;
}

/* ─── Evaluating a STAFF MEMBER ────────────────────────────────────────── */

export type StaffLeafState = {
  on: boolean;
  /** Role names that grant this leaf (the module tick or the function). */
  roleSources: string[];
  /** A role grants it through the whole-module tick. */
  viaWholeModule: boolean;
  /** Given to this person alone (function row, or a personal module allow). */
  personalAllow: boolean;
  /** Taken away from this person alone (function deny or module deny). */
  personalDeny: boolean;
  /** The deny is module-wide — clearing it here would reopen the module. */
  denyIsModuleWide: boolean;
};

/** Live (not expired) personal rows of one staff member. */
export function livePersonalRows(
  rows: UserPermissionGrant[],
  staffId: string,
  today: string = new Date().toISOString().slice(0, 10),
): UserPermissionGrant[] {
  return rows.filter((g) => g.staffId === staffId && (!g.expiresOn || g.expiresOn >= today));
}

export function staffLeafState(
  roles: RbacRole[],
  personal: UserPermissionGrant[],
  leaf: TreeLeaf,
): StaffLeafState {
  const roleSources: string[] = [];
  let viaWholeModule = false;
  for (const r of roles) {
    const st = roleLeafState(r, leaf);
    if (st.on) roleSources.push(r.name);
    if (st.viaWholeModule) viaWholeModule = true;
  }
  const has = (g: UserPermissionGrant) => g.actions.includes(leaf.action);
  const moduleDeny = personal.some((g) => g.effect === "deny" && g.denyModule === leaf.module && has(g));
  const moduleAllow = personal.some((g) => g.effect === "allow" && g.module === leaf.module && has(g));
  let personalAllow = moduleAllow;
  let personalDeny = moduleDeny;
  if (leaf.kind === "feature") {
    personalAllow ||= personal.some((g) => g.effect === "allow" && g.feature === leaf.featureId && has(g));
    personalDeny ||= personal.some((g) => g.effect === "deny" && g.feature === leaf.featureId && has(g));
  }
  return {
    on: !personalDeny && (roleSources.length > 0 || personalAllow),
    roleSources,
    viaWholeModule,
    personalAllow,
    personalDeny,
    denyIsModuleWide: moduleDeny,
  };
}

/** The personal row a leaf maps onto exactly. */
function leafTarget(leaf: TreeLeaf) {
  return leaf.kind === "feature"
    ? ({ level: "feature", id: leaf.featureId! } as const)
    : ({ level: "module", id: leaf.module } as const);
}

function rowActionsFor(
  state: RbacState,
  staffId: string,
  leaf: TreeLeaf,
  effect: "allow" | "deny",
): RbacAction[] {
  const t = leafTarget(leaf);
  const row = (state.userGrants ?? []).find((g) => {
    if (g.staffId !== staffId || g.effect !== effect) return false;
    const gt = personalGrantTarget(g);
    return gt.level === t.level && gt.id === t.id;
  });
  return row?.actions ?? [];
}

export type PersonalStamp = { grantedBy: string; note?: string; expiresOn?: string };

/**
 * Make one leaf ON or OFF for one person, with the fewest personal rows:
 *   ON  — drop a deny on exactly this leaf; if still off, add an allow.
 *   OFF — drop an allow on exactly this leaf; if still on (a role gives
 *         it), add a deny.
 * A function blocked by a MODULE-wide deny is not reopened from here
 * (that would quietly reopen the module) — `blocked` says so.
 */
export function setStaffLeaf(
  state: RbacState,
  roles: RbacRole[],
  staffId: string,
  leaf: TreeLeaf,
  on: boolean,
  stamp: PersonalStamp,
  today?: string,
): { state: RbacState; blocked?: string } {
  const evalNow = (s: RbacState) =>
    staffLeafState(roles, livePersonalRows(s.userGrants ?? [], staffId, today), leaf);
  const before = evalNow(state);
  if (before.on === on) return { state };
  const target = leafTarget(leaf);
  const put = (s: RbacState, effect: "allow" | "deny", actions: RbacAction[]) =>
    setPersonalGrant(s, {
      staffId,
      target,
      effect,
      actions,
      grantedBy: stamp.grantedBy,
      ...(stamp.note !== undefined ? { note: stamp.note } : {}),
      ...(stamp.expiresOn !== undefined ? { expiresOn: stamp.expiresOn } : {}),
    });
  let next = state;
  if (on) {
    if (before.denyIsModuleWide && leaf.kind === "feature") {
      return {
        state,
        blocked: "Denied for the whole module — clear the module's own tick first.",
      };
    }
    const deny = rowActionsFor(next, staffId, leaf, "deny");
    if (deny.includes(leaf.action)) {
      next = put(next, "deny", deny.filter((a) => a !== leaf.action));
    }
    if (!evalNow(next).on) {
      next = put(next, "allow", [...rowActionsFor(next, staffId, leaf, "allow"), leaf.action]);
    }
  } else {
    const allow = rowActionsFor(next, staffId, leaf, "allow");
    if (allow.includes(leaf.action)) {
      next = put(next, "allow", allow.filter((a) => a !== leaf.action));
    }
    if (evalNow(next).on) {
      next = put(next, "deny", [...rowActionsFor(next, staffId, leaf, "deny"), leaf.action]);
    }
  }
  return { state: next };
}

/** Tick or clear many leaves (a module, a category, Check all). */
export function setStaffLeaves(
  state: RbacState,
  roles: RbacRole[],
  staffId: string,
  leaves: TreeLeaf[],
  on: boolean,
  stamp: PersonalStamp,
  today?: string,
): { state: RbacState; blocked: number } {
  // Module rows first: a module allow/deny settles its functions too, so
  // they need no rows of their own.
  const ordered = [...leaves].sort((a, b) => (a.kind === b.kind ? 0 : a.kind === "module" ? -1 : 1));
  let next = state;
  let blocked = 0;
  for (const leaf of ordered) {
    const r = setStaffLeaf(next, roles, staffId, leaf, on, stamp, today);
    next = r.state;
    if (r.blocked) blocked += 1;
  }
  return { state: next, blocked };
}

/* ─── Counters, tri-state, diffs ───────────────────────────────────────── */

export type TriState = "on" | "off" | "mixed";

export function triState(leaves: TreeLeaf[], isOn: (l: TreeLeaf) => boolean): TriState {
  if (leaves.length === 0) return "off";
  let n = 0;
  for (const l of leaves) if (isOn(l)) n += 1;
  return n === 0 ? "off" : n === leaves.length ? "on" : "mixed";
}

/**
 * "Modules enabled N/M · functions enabled N/M". A module counts as
 * enabled when any of its leaves is on; a function (including the
 * whole-module row) when any of its actions is.
 */
export function treeCounters(tree: TreeCategory[], isOn: (l: TreeLeaf) => boolean) {
  let modules = 0;
  let modulesOn = 0;
  let functions = 0;
  let functionsOn = 0;
  for (const c of tree) {
    for (const m of c.modules) {
      modules += 1;
      let any = false;
      for (const r of m.rows) {
        if (r.kind === "feature") functions += 1;
        const rowOn = rowLeaves(r).some(isOn);
        if (rowOn) any = true;
        if (rowOn && r.kind === "feature") functionsOn += 1;
      }
      if (any) modulesOn += 1;
    }
  }
  return { modules, modulesOn, functions, functionsOn };
}

export function leafLabel(tree: TreeCategory[], leaf: TreeLeaf): string {
  for (const c of tree) {
    for (const m of c.modules) {
      if (m.module !== leaf.module) continue;
      const row = m.rows.find((r) =>
        leaf.kind === "module" ? r.kind === "module" : r.featureId === leaf.featureId,
      );
      const fn = leaf.kind === "module" ? "whole module" : row?.label || leaf.featureId;
      return `${m.label} → ${fn}: ${actionLabel(leaf.action)}`;
    }
  }
  return leafKey(leaf);
}

/** What a change does, leaf by leaf: what the person/role gains and loses. */
export function effectiveDiff(
  tree: TreeCategory[],
  before: (l: TreeLeaf) => boolean,
  after: (l: TreeLeaf) => boolean,
): { gained: TreeLeaf[]; lost: TreeLeaf[] } {
  const gained: TreeLeaf[] = [];
  const lost: TreeLeaf[] = [];
  for (const l of allLeaves(tree)) {
    const b = before(l);
    const a = after(l);
    if (a && !b) gained.push(l);
    if (b && !a) lost.push(l);
  }
  return { gained, lost };
}

/** Personal rows of one staff member that differ between two states. */
export function personalRowChanges(
  before: RbacState,
  after: RbacState,
  staffId: string,
): { added: UserPermissionGrant[]; changed: UserPermissionGrant[]; removed: UserPermissionGrant[] } {
  const b = (before.userGrants ?? []).filter((g) => g.staffId === staffId);
  const a = (after.userGrants ?? []).filter((g) => g.staffId === staffId);
  const byId = new Map(b.map((g) => [g.id, g]));
  const added: UserPermissionGrant[] = [];
  const changed: UserPermissionGrant[] = [];
  for (const g of a) {
    const prev = byId.get(g.id);
    if (!prev) added.push(g);
    else if (JSON.stringify(prev) !== JSON.stringify(g)) changed.push(g);
  }
  const keep = new Set(a.map((g) => g.id));
  const removed = b.filter((g) => !keep.has(g.id));
  return { added, changed, removed };
}

/** One personal row in words, for the audit trail and the preview. */
export function describePersonalRow(g: UserPermissionGrant): string {
  const t = personalGrantTarget(g);
  const what =
    t.level === "feature"
      ? findFeature(t.id)?.label
        ? `${RBAC_MODULES.find((m) => m.id === findFeature(t.id)!.module)?.label ?? ""} → ${findFeature(t.id)!.label}`
        : t.id
      : `${RBAC_MODULES.find((m) => m.id === t.id)?.label ?? t.id} (whole module)`;
  const verb = g.effect === "deny" ? "DENY" : "allow";
  return `${verb} ${what}: ${g.actions.map(actionLabel).join(", ")}${g.expiresOn ? ` until ${g.expiresOn}` : ""}`;
}

/* ─── Copy permissions from another staff member ───────────────────────── */

export type CopyPermissionsResult =
  | {
      ok: true;
      state: RbacState;
      /** Role ids the target holds afterwards. */
      roleIds: string[];
      rowsCopied: number;
      rowsReplaced: number;
      mobileRuleCopied: boolean;
    }
  | { ok: false; reason: string };

/**
 * Make the target's permissions the source's: the same roles (as explicit
 * assignments), the same personal allows and denies, the same phone-app
 * overrides. What the target held before is replaced — the preview shows
 * exactly what that removes before anything is saved.
 *
 * `sourceRoleIds` are the roles the source holds right now. When the source
 * has no explicit assignment they come from the designation; the caller
 * passes those and the target gets them as explicit assignments (so copying
 * is never "nothing happened" for a person configured by designation).
 */
export function copyStaffPermissions(
  state: RbacState,
  input: {
    fromStaffId: string;
    toStaffId: string;
    sourceRoleIds: string[];
    fromLabel: string;
    toLabel: string;
    by: string;
    today?: string;
    newId: (prefix: string) => string;
  },
): CopyPermissionsResult {
  const { fromStaffId, toStaffId } = input;
  if (!fromStaffId || !toStaffId) return { ok: false, reason: "Pick both staff members" };
  if (fromStaffId === toStaffId) return { ok: false, reason: "Pick two different staff members" };
  const roleIds = [...new Set(input.sourceRoleIds)].filter((id) =>
    state.roles.some((r) => r.id === id && r.isActive),
  );
  const today = input.today ?? new Date().toISOString().slice(0, 10);
  const stamp = `Copied from ${input.fromLabel}`;

  const sourceAssign = state.assignments.filter(
    (a) => a.staffId === fromStaffId && (!a.expiresOn || a.expiresOn >= today),
  );
  const primaryRole = sourceAssign.find((a) => a.isPrimary)?.roleId ?? roleIds[0];
  const assignments = [
    ...state.assignments.filter((a) => a.staffId !== toStaffId),
    ...roleIds.map((roleId) => {
      const src = sourceAssign.find((a) => a.roleId === roleId);
      return {
        id: input.newId("ura"),
        staffId: toStaffId,
        roleId,
        isPrimary: roleId === primaryRole,
        scope: src
          ? {
              campusIds: [...src.scope.campusIds],
              classIds: [...src.scope.classIds],
              departmentIds: [...src.scope.departmentIds],
            }
          : { campusIds: [], classIds: [], departmentIds: [] },
        expiresOn: src?.expiresOn ?? "",
        note: src?.note?.trim() ? `${src.note.trim()} · ${stamp}` : stamp,
      };
    }),
  ];

  const all = state.userGrants ?? [];
  const sourceRows = livePersonalRows(all, fromStaffId, today);
  const replaced = all.filter((g) => g.staffId === toStaffId).length;
  const userGrants = [
    ...all.filter((g) => g.staffId !== toStaffId),
    ...sourceRows.map((g) => ({
      ...g,
      id: input.newId("ug"),
      staffId: toStaffId,
      actions: [...g.actions],
      note: g.note ? `${g.note} · ${stamp}` : stamp,
      grantedBy: input.by,
      grantedAt: new Date().toISOString(),
    })),
  ];

  const srcRule = state.mobile.staffRules.find((r) => r.staffId === fromStaffId);
  const staffRules = [
    ...state.mobile.staffRules.filter((r) => r.staffId !== toStaffId),
    ...(srcRule
      ? [{ staffId: toStaffId, allow: [...srcRule.allow], deny: [...srcRule.deny], note: stamp }]
      : []),
  ];

  const roleNames = roleIds.map((id) => state.roles.find((r) => r.id === id)?.name || id);
  const entry = {
    id: input.newId("aud"),
    at: new Date().toISOString(),
    by: input.by || "system",
    action: "copy_permissions",
    detail: `${input.fromLabel} → ${input.toLabel}: roles ${roleNames.join(", ") || "none"}; ${sourceRows.length} personal row(s) copied, ${replaced} replaced${srcRule ? "; phone-app overrides copied" : ""}`,
  };
  return {
    ok: true,
    state: {
      ...state,
      assignments,
      userGrants,
      mobile: { ...state.mobile, staffRules },
      audit: [entry, ...state.audit].slice(0, 200),
    },
    roleIds,
    rowsCopied: sourceRows.length,
    rowsReplaced: replaced,
    mobileRuleCopied: !!srcRule,
  };
}
