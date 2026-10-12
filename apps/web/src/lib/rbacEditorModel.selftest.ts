/**
 * Masters → Roles & permissions, the tree editor and the per-person grant
 * model behind it (12 Oct 2026).
 *
 * What must hold:
 *   - precedence: personal deny > personal allow > roles, for functions AND
 *     whole modules, on the checks the screens and the server use;
 *   - expiry: a lapsed allow stops granting, a lapsed deny stops denying,
 *     and the expiry day itself still counts;
 *   - a deny or a function row never carries `module` (an older build reads
 *     every `module` row as an ALLOW — a deny there would GRANT);
 *   - the tree edits produce the fewest rows (re-ticking a denied role tick
 *     removes the deny instead of stacking an allow on it);
 *   - copy replaces the target's rows and nobody else's;
 *   - templates resolve against the catalogue and never hold impersonation;
 *   - every module and every catalogue function is in the tree exactly once.
 *
 * Run: npx tsx src/lib/rbacEditorModel.selftest.ts
 */
import assert from "node:assert/strict";

import { defaultMobileAccess } from "./mobileFeatures";
import { emptyMastersShell } from "./masters";
import {
  RBAC_MODULES,
  canSeeModuleTab,
  featureAccess,
  hasPermission,
  hasScopedPermission,
  isFeaturePersonallyDenied,
  normalizeRbacState,
  setPersonalGrant,
  visibleModuleTabs,
  type FeatureGrant,
  type PermissionGrant,
  type RbacRole,
  type RbacState,
  type SessionLike,
} from "./rbac";
import { RBAC_FEATURES, featuresForTab } from "./rbacFeatures";
import {
  MODULE_CATEGORY,
  allLeaves,
  buildPermissionTree,
  copyStaffPermissions,
  filterTree,
  livePersonalRows,
  moduleTreeActions,
  setRoleLeaves,
  setStaffLeaf,
  setStaffLeaves,
  staffLeafState,
  treeCounters,
  triState,
  type TreeLeaf,
} from "./rbacEditorModel";
import { ROLE_TEMPLATES, resolveRoleTemplate } from "./rbacRoleTemplates";
import { deniedSliceChange, moduleHasDeniedSliceWrites } from "./deskFeatureAuth";
import { rbacChangeRefusal } from "./rbacEditGuard";
import { functionWriteAllowed } from "./moneyFunctionScope";
import { MOBILE_FEATURE_FUNCTIONS, mobileFeaturePersonallyDenied } from "./api/v1/mobileAccess.server";
import { findFeature } from "./rbacFeatures";
import { isValidRbacExpiry, rbacTodayIst, defaultRbacState } from "./rbac";
import { rbacReadOutcome } from "./rbacReadOutcome";

console.log("rbacEditorModel.selftest.ts");

const masters = emptyMastersShell();
const person = (id: string, name: string, email: string) =>
  ({
    id,
    empCode: id.toUpperCase(),
    fullName: name,
    stream: "non_teaching",
    category: "permanent",
    departmentId: null,
    designationId: null,
    campusId: null,
    mobile: "",
    email,
    status: "active",
  }) as unknown as (typeof masters.staff)[number];
masters.staff = [
  person("stf_shreya", "Shreya Sharma", "shreya@example.com"),
  person("stf_nihal", "Nihal Rajak", "nihal@example.com"),
  person("stf_dir", "Director", "director@bhbinternational.school"),
];

const subjectFns = featuresForTab("masters", "subjects");
assert.ok(subjectFns.length >= 1, "catalogue should list a function on Masters → Subjects");
const F = subjectFns[0]!.id; // a masters function
const office: RbacRole = {
  id: "role_office",
  code: "office",
  name: "Office",
  isBuiltIn: true,
  isActive: true,
  makerChecker: false,
  permissions: [
    { module: "masters", actions: ["view", "create", "edit", "delete"] },
    { module: "students", actions: ["view"] },
  ],
  featureGrants: [],
  note: "",
};
const blank: RbacRole = { ...office, id: "role_blank", code: "blank", name: "Blank", permissions: [] };

const assign = (staffId: string, roleId: string) => ({
  id: `asn_${staffId}`,
  staffId,
  roleId,
  isPrimary: true,
  scope: { campusIds: [], classIds: [], departmentIds: [] },
  expiresOn: "",
  note: "",
});
const base: RbacState = {
  version: 1,
  roles: [office, blank],
  assignments: [assign("stf_shreya", "role_office"), assign("stf_nihal", "role_blank"), assign("stf_dir", "role_office")],
  audit: [],
  userGrants: [],
  mobile: defaultMobileAccess(),
};
const s = (id: string, fullName: string, email: string): SessionLike => ({
  roleCode: "",
  staffId: id,
  fullName,
  email,
  persona: "staff",
});
const shreya = s("stf_shreya", "Shreya Sharma", "shreya@example.com");
const nihal = s("stf_nihal", "Nihal Rajak", "nihal@example.com");
const director = s("stf_dir", "Director", "director@bhbinternational.school");

const yesterday = new Date(Date.now() - 86_400_000).toISOString().slice(0, 10);
const today = new Date().toISOString().slice(0, 10);

/* 1. Precedence on functions: deny > allow > role. */
assert.equal(featureAccess(shreya, masters, F, "edit", base).allowed, true, "role's module grant opens the function");
const denied = setPersonalGrant(base, {
  staffId: "stf_shreya",
  target: { level: "feature", id: F },
  effect: "deny",
  actions: ["edit"],
});
assert.equal(featureAccess(shreya, masters, F, "edit", denied).allowed, false, "personal deny beats the role");
assert.equal(featureAccess(shreya, masters, F, "view", denied).allowed, true, "deny is per action");
assert.equal(isFeaturePersonallyDenied(shreya, masters, F, "edit", denied), true);
assert.equal(featureAccess(director, masters, F, "edit", setPersonalGrant(base, {
  staffId: "stf_dir", target: { level: "feature", id: F }, effect: "deny", actions: ["edit"],
})).allowed, true, "a protected super admin is never denied");

const allowAndDeny = setPersonalGrant(denied, {
  staffId: "stf_shreya",
  target: { level: "feature", id: F },
  effect: "allow",
  actions: ["edit"],
});
assert.equal(featureAccess(shreya, masters, F, "edit", allowAndDeny).allowed, false, "deny beats a personal allow too");

assert.equal(featureAccess(nihal, masters, F, "edit", base).allowed, false, "blank role holds nothing");
const nihalAllow = setPersonalGrant(base, {
  staffId: "stf_nihal",
  target: { level: "feature", id: F },
  effect: "allow",
  actions: ["view", "edit"],
});
assert.equal(featureAccess(nihal, masters, F, "edit", nihalAllow).allowed, true, "personal function allow grants");
assert.equal(hasPermission(nihal, masters, "masters", "edit", nihalAllow), false, "…without the whole module");
assert.equal(featureAccess(shreya, masters, F, "edit", nihalAllow).allowed, true, "and nobody else is touched");

/* 2. Whole-module deny, on the checks routes use (hasPermission). */
const modDeny = setPersonalGrant(base, {
  staffId: "stf_shreya",
  target: { level: "module", id: "students" },
  effect: "deny",
  actions: ["view"],
});
assert.equal(hasPermission(shreya, masters, "students", "view", modDeny), false, "module deny beats the role");
assert.equal(hasScopedPermission(shreya, masters, "students", "view", modDeny, { classId: "c1" }), false);
assert.equal(hasPermission(nihal, masters, "students", "view", modDeny), false, "(blank role, unchanged)");
const dirModDeny = setPersonalGrant(base, {
  staffId: "stf_dir", target: { level: "module", id: "students" }, effect: "deny", actions: ["view"],
});
assert.equal(hasPermission(director, masters, "students", "view", dirModDeny), true, "super admin never module-denied");

/* 3. Old builds: a deny / function row never carries `module`. */
const row = modDeny.userGrants.find((g) => g.staffId === "stf_shreya")!;
assert.equal(row.module, undefined, "module deny must not carry `module`");
assert.equal(row.denyModule, "students");
assert.equal(denied.userGrants[0]!.module, undefined, "function row must not carry `module`");
const healed = normalizeRbacState({
  ...base,
  userGrants: [
    { id: "x", staffId: "stf_shreya", module: "students", effect: "deny", actions: ["view"], note: "", grantedBy: "", grantedAt: "", expiresOn: "" },
    // A legacy row (no effect) is a module allow, as before.
    { id: "y", staffId: "stf_nihal", module: "fees", actions: ["view"], note: "", grantedBy: "", grantedAt: "", expiresOn: "" } as never,
    // A function the catalogue no longer has is dropped, not widened.
    { id: "z", staffId: "stf_nihal", feature: "nope.gone", effect: "allow", actions: ["view"], note: "", grantedBy: "", grantedAt: "", expiresOn: "" },
  ],
});
assert.equal(healed.userGrants.length, 2);
assert.equal(healed.userGrants[0]!.module, undefined, "a deny with `module` is normalised to denyModule");
assert.equal(healed.userGrants[0]!.denyModule, "students");
assert.equal(healed.userGrants[1]!.effect, "allow");
assert.equal(hasPermission(nihal, masters, "fees", "view", healed), true, "legacy module allow still grants");

/* 4. Expiry, both ways; the day itself counts. */
const lapsedDeny = setPersonalGrant(base, {
  staffId: "stf_shreya", target: { level: "feature", id: F }, effect: "deny", actions: ["edit"], expiresOn: yesterday,
});
assert.equal(featureAccess(shreya, masters, F, "edit", lapsedDeny).allowed, true, "a lapsed deny stops denying");
const lapsedAllow = setPersonalGrant(base, {
  staffId: "stf_nihal", target: { level: "feature", id: F }, effect: "allow", actions: ["edit"], expiresOn: yesterday,
});
assert.equal(featureAccess(nihal, masters, F, "edit", lapsedAllow).allowed, false, "a lapsed allow stops granting");
const todayAllow = setPersonalGrant(base, {
  staffId: "stf_nihal", target: { level: "feature", id: F }, effect: "allow", actions: ["edit"], expiresOn: today,
});
assert.equal(featureAccess(nihal, masters, F, "edit", todayAllow).allowed, true, "the expiry day still counts");

/* 5. Tabs: every function of a tab denied closes it for a module holder. */
const allSubjectDenied = subjectFns.reduce(
  (st, f) =>
    setPersonalGrant(st, { staffId: "stf_shreya", target: { level: "feature", id: f.id }, effect: "deny", actions: ["view"] }),
  base,
);
assert.equal(canSeeModuleTab(shreya, masters, "masters", "subjects", base), true);
assert.equal(canSeeModuleTab(shreya, masters, "masters", "subjects", allSubjectDenied), false, "tab closed by denies");
assert.equal(
  canSeeModuleTab(shreya, masters, "masters", "zz-no-function-tab", allSubjectDenied),
  true,
  "a tab no function lists is decided by the module alone",
);
const tabs = visibleModuleTabs([{ id: "subjects" }, { id: "zz-no-function-tab" }], shreya, masters, "masters", allSubjectDenied);
assert.deepEqual(tabs.map((t) => t.id), ["zz-no-function-tab"]);

/* 6. Tree editing for a person: fewest rows. */
const roles = [office];
const leaf: TreeLeaf = { kind: "feature", module: "masters", featureId: F, action: "edit" };
const st0 = staffLeafState(roles, [], leaf);
assert.equal(st0.on, true);
assert.deepEqual(st0.roleSources, ["Office"]);
assert.equal(st0.viaWholeModule, true);
const off = setStaffLeaf(base, roles, "stf_shreya", leaf, false, { grantedBy: "Principal" }).state;
assert.equal(off.userGrants.length, 1, "unticking a role tick adds one deny");
assert.equal(off.userGrants[0]!.effect, "deny");
const backOn = setStaffLeaf(off, roles, "stf_shreya", leaf, true, { grantedBy: "Principal" }).state;
assert.equal(backOn.userGrants.length, 0, "re-ticking removes the deny rather than adding an allow");

const nLeaf: TreeLeaf = { kind: "feature", module: "masters", featureId: F, action: "view" };
const nOn = setStaffLeaf(base, [blank], "stf_nihal", nLeaf, true, { grantedBy: "P", note: "Covers Sat", expiresOn: today }).state;
assert.equal(nOn.userGrants.length, 1);
assert.equal(nOn.userGrants[0]!.effect, "allow");
assert.equal(nOn.userGrants[0]!.note, "Covers Sat", "reason is stamped");
assert.equal(nOn.userGrants[0]!.expiresOn, today, "expiry is stamped");
const nOff = setStaffLeaf(nOn, [blank], "stf_nihal", nLeaf, false, { grantedBy: "P" }).state;
assert.equal(nOff.userGrants.length, 0, "unticking a personal allow deletes the row (named on save)");

// Ticking a whole module settles its functions without rows of their own.
const tree = buildPermissionTree();
const mastersNode = tree.flatMap((c) => c.modules).find((m) => m.module === "masters")!;
const mastersLeaves = mastersNode.rows.flatMap((r) => r.actions.map((action) => ({
  kind: r.kind, module: r.module, featureId: r.featureId, action,
}) as TreeLeaf));
const ticked = setStaffLeaves(base, [blank], "stf_nihal", mastersLeaves, true, { grantedBy: "P" });
assert.equal(ticked.state.userGrants.length, 1, "one module allow covers every function");
assert.equal(ticked.state.userGrants[0]!.module, "masters");
const personal = livePersonalRows(ticked.state.userGrants, "stf_nihal");
assert.equal(triState(mastersLeaves, (l) => staffLeafState([blank], personal, l).on), "on");

// A function under a module-wide deny is not reopened from the function cell.
const blockedTry = setStaffLeaf(
  setPersonalGrant(base, { staffId: "stf_shreya", target: { level: "module", id: "masters" }, effect: "deny", actions: ["edit"] }),
  roles, "stf_shreya", leaf, true, { grantedBy: "P" },
);
assert.ok(blockedTry.blocked, "module deny blocks a function re-tick");

/* 7. Role tree: clearing a module clears its functions too. */
const roleDraft = { permissions: [{ module: "masters" as const, actions: ["view" as const] }], featureGrants: [{ feature: F, actions: ["edit" as const] }] };
const cleared = setRoleLeaves(roleDraft, mastersLeaves, false);
assert.deepEqual(cleared.permissions, []);
assert.deepEqual(cleared.featureGrants, []);
const full = setRoleLeaves({ permissions: [] as PermissionGrant[], featureGrants: [] as FeatureGrant[] }, mastersLeaves, true);
assert.deepEqual(full.permissions[0]!.actions.sort(), moduleTreeActions("masters").sort());
assert.equal(full.featureGrants.length, 0, "the module tick covers functions — no duplicate rows");

/* 8. Copy permissions. */
const withRows = setPersonalGrant(
  setPersonalGrant(base, { staffId: "stf_shreya", target: { level: "feature", id: F }, effect: "deny", actions: ["edit"] }),
  { staffId: "stf_nihal", target: { level: "module", id: "fees" }, effect: "allow", actions: ["view"] },
);
let n = 0;
const copied = copyStaffPermissions(withRows, {
  fromStaffId: "stf_shreya",
  toStaffId: "stf_nihal",
  sourceRoleIds: ["role_office"],
  fromLabel: "Shreya",
  toLabel: "Nihal",
  by: "Principal",
  newId: (p) => `${p}_${++n}`,
});
assert.ok(copied.ok);
if (copied.ok) {
  const nRows = copied.state.userGrants.filter((g) => g.staffId === "stf_nihal");
  assert.equal(nRows.length, 1, "target's old rows replaced by the source's");
  assert.equal(nRows[0]!.feature, F);
  assert.equal(nRows[0]!.effect, "deny");
  assert.equal(copied.state.userGrants.filter((g) => g.staffId === "stf_shreya").length, 1, "source untouched");
  const nAssign = copied.state.assignments.filter((a) => a.staffId === "stf_nihal");
  assert.deepEqual(nAssign.map((a) => a.roleId), ["role_office"]);
  assert.equal(copied.state.assignments.filter((a) => a.staffId === "stf_dir").length, 1, "others untouched");
  assert.equal(copied.state.audit[0]!.action, "copy_permissions", "copy is audited");
}
assert.equal(copyStaffPermissions(base, { fromStaffId: "a", toStaffId: "a", sourceRoleIds: [], fromLabel: "", toLabel: "", by: "", newId: () => "x" }).ok, false);

/* 9. Templates. */
for (const t of ROLE_TEMPLATES) {
  const r = resolveRoleTemplate(t);
  assert.ok(r.permissions.length > 0, `${t.name}: has module grants`);
  for (const p of r.permissions) {
    assert.ok(RBAC_MODULES.some((m) => m.id === p.module), `${t.name}: ${p.module} is a module`);
    assert.ok(!p.actions.includes("impersonate"), `${t.name}: never impersonation`);
    for (const a of p.actions) assert.ok(moduleTreeActions(p.module).includes(a), `${t.name}: ${p.module}.${a} is meaningful`);
  }
  for (const g of r.featureGrants) {
    const def = RBAC_FEATURES.find((f) => f.id === g.feature);
    assert.ok(def, `${t.name}: ${g.feature} is in the catalogue`);
    for (const a of g.actions) assert.ok(def!.actions.includes(a));
  }
}
const officeT = resolveRoleTemplate(ROLE_TEMPLATES.find((t) => t.id === "office")!);
assert.ok(
  officeT.permissions.find((p) => p.module === "notifications")?.actions.includes("edit"),
  "Office template can invite parents onto the app",
);
assert.ok(!officeT.permissions.find((p) => p.module === "fees")?.actions.includes("void"), "Office cannot void receipts");
const acct = resolveRoleTemplate(ROLE_TEMPLATES.find((t) => t.id === "accountant")!);
assert.ok(!acct.permissions.some((p) => p.module === "payroll"), "Accountant template carries no payroll");
const ct = resolveRoleTemplate(ROLE_TEMPLATES.find((t) => t.id === "class_teacher")!);
assert.ok(ct.featureGrants.some((g) => g.feature === "masters.class_subjects"), "Class teacher edits own class subjects");

/* 10. The tree: every module and function exactly once. */
const mods = tree.flatMap((c) => c.modules.map((m) => m.module));
assert.equal(new Set(mods).size, mods.length);
assert.deepEqual([...mods].sort(), RBAC_MODULES.map((m) => m.id).sort());
const fnIds = tree.flatMap((c) => c.modules.flatMap((m) => m.rows.filter((r) => r.kind === "feature").map((r) => r.featureId!)));
assert.deepEqual([...fnIds].sort(), RBAC_FEATURES.map((f) => f.id).sort());
for (const m of RBAC_MODULES) assert.ok(MODULE_CATEGORY[m.id], `${m.id} has a category`);
assert.ok(moduleTreeActions("home").length === 1, "Home is view only");
assert.ok(!moduleTreeActions("students").includes("void"), "Void only where meaningful");
assert.ok(moduleTreeActions("fees").includes("void"));
const counters = treeCounters(tree, () => false);
assert.equal(counters.modules, RBAC_MODULES.length);
assert.equal(counters.functions, RBAC_FEATURES.length);
assert.equal(counters.modulesOn, 0);
const searched = filterTree(tree, subjectFns[0]!.label);
assert.ok(searched.some((c) => c.modules.some((m) => m.module === "masters")), "search finds a function by label");
assert.ok(allLeaves(searched).length < allLeaves(tree).length);

/* 11. Server desk saves: a whole-module holder with a function deny. */
{
  const csDenied = setPersonalGrant(base, {
    staffId: "stf_shreya",
    target: { level: "feature", id: "masters.class_subjects" },
    effect: "deny",
    actions: ["create", "edit", "delete"],
  });
  const denied = (fid: string, a: "view" | "create" | "edit" | "delete" | "void" | "approve" | "export" | "unlock" | "impersonate") =>
    isFeaturePersonallyDenied(shreya, masters, fid, a, csDenied);
  assert.equal(hasPermission(shreya, masters, "masters", "edit", csDenied), true, "still holds the whole module");
  assert.equal(moduleHasDeniedSliceWrites("masters", denied), true);
  assert.equal(moduleHasDeniedSliceWrites("transport", denied), false, "other modules untouched");
  const stored = { classSubjects: [{ id: "cs1", classId: "c1", subjectId: "s1" }], classes: [{ id: "c1", name: "1" }] };
  const added = { ...stored, classSubjects: [...stored.classSubjects, { id: "cs2", classId: "c1", subjectId: "s2" }] };
  assert.match(deniedSliceChange("masters", stored, added, denied) ?? "", /turned off for you; ask the office to give your role this\.$/, "saving the denied slice is refused");
  const changed = { ...stored, classSubjects: [{ id: "cs1", classId: "c1", subjectId: "s9" }] };
  assert.ok(deniedSliceChange("masters", stored, changed, denied), "editing a denied row is refused");
  assert.ok(deniedSliceChange("masters", stored, stored, denied, { classSubjects: ["cs1"] }), "a named delete is refused");
  const other = { ...stored, classes: [{ id: "c1", name: "One" }] };
  assert.equal(deniedSliceChange("masters", stored, other, denied), null, "other slices of the module still save");
  assert.equal(deniedSliceChange("masters", stored, stored, denied), null, "an unchanged denied slice passes");
  // Only the denied action counts.
  const editOnly = setPersonalGrant(base, {
    staffId: "stf_shreya", target: { level: "feature", id: "masters.class_subjects" }, effect: "deny", actions: ["delete"],
  });
  const d2 = (fid: string, a: Parameters<typeof denied>[1]) => isFeaturePersonallyDenied(shreya, masters, fid, a, editOnly);
  assert.equal(deniedSliceChange("masters", stored, added, d2), null, "create still allowed when only delete is denied");
  assert.ok(deniedSliceChange("masters", stored, stored, d2, { classSubjects: ["cs1"] }));

  // Money routes shared by many jobs: the module grant, minus denied functions.
  const ledgerDeny = setPersonalGrant(base, {
    staffId: "stf_shreya", target: { level: "feature", id: F }, effect: "deny", actions: ["edit"],
  });
  const demo = { ...shreya, tenantSlug: "t", academicYearCode: "2026-27" } as const;
  const who = { session: demo as never, masters, rbac: ledgerDeny };
  assert.equal(functionWriteAllowed(who, "masters", "edit", { [F]: ["op_a"] }, "op_a"), false, "operation of a denied function refused");
  assert.equal(functionWriteAllowed(who, "masters", "edit", { [F]: ["op_a"] }, "op_b"), true, "other operations still pass");
}

/* 12. Phone app: a screen whose functions are all denied is refused. */
{
  for (const [feat, ids] of Object.entries(MOBILE_FEATURE_FUNCTIONS)) {
    for (const id of ids ?? []) assert.ok(findFeature(id), `${feat}: ${id} is in the catalogue`);
  }
  const officeWithAtt: RbacRole = { ...office, permissions: [...office.permissions, { module: "attendance", actions: ["view", "edit"] }] };
  const st: RbacState = { ...base, roles: [officeWithAtt, blank] };
  const ctx = { session: { ...shreya, tenantSlug: "t", academicYearCode: "2026-27" } as never, masters, rbac: st, authKind: "session" as const };
  assert.equal(mobileFeaturePersonallyDenied(ctx, "attendance_mark"), false);
  const off = setPersonalGrant(st, {
    staffId: "stf_shreya", target: { level: "feature", id: "attendance.student_register" }, effect: "deny", actions: ["edit"],
  });
  assert.equal(mobileFeaturePersonallyDenied({ ...ctx, rbac: off }, "attendance_mark"), true, "mobile gate honours the deny");
}

/* 13. Who may edit whom (server rule on the rbac save). */
{
  const principalRole: RbacRole = { ...office, id: "role_principal", code: "principal", name: "Principal" };
  const adminRole: RbacRole = { ...office, id: "role_admin", code: "admin", name: "Admin", permissions: [{ module: "settings", actions: ["view", "edit"] }] };
  const ownerRole: RbacRole = { ...office, id: "role_owner", code: "owner", name: "Owner" };
  const st: RbacState = {
    ...base,
    roles: [office, blank, principalRole, adminRole, ownerRole],
    assignments: [
      assign("stf_shreya", "role_admin"),
      { ...assign("stf_nihal", "role_blank") },
      { ...assign("stf_dir", "role_owner") },
      { ...assign("stf_pri", "role_principal"), id: "asn_pri" },
    ],
  };
  const m2 = emptyMastersShell();
  m2.staff = [...masters.staff, person("stf_pri", "Beena Singh", "beena@example.com")];
  const editorAdmin = { session: shreya, staffId: "stf_shreya" };
  const editorOwner = { session: director, staffId: "stf_dir" };
  const giveSelf = setPersonalGrant(st, { staffId: "stf_shreya", target: { level: "module", id: "payroll" }, effect: "allow", actions: ["view"] });
  assert.match(rbacChangeRefusal(editorAdmin, st, { userGrants: giveSelf.userGrants }, m2) ?? "", /own permissions/, "no self-editing");
  const denyPrincipal = setPersonalGrant(st, { staffId: "stf_pri", target: { level: "module", id: "fees" }, effect: "deny", actions: ["view"] });
  assert.match(rbacChangeRefusal(editorAdmin, st, { userGrants: denyPrincipal.userGrants }, m2) ?? "", /principal or admin role/, "principal is protected");
  const giveNihal = setPersonalGrant(st, { staffId: "stf_nihal", target: { level: "module", id: "fees" }, effect: "allow", actions: ["view"] });
  assert.equal(rbacChangeRefusal(editorAdmin, st, { userGrants: giveNihal.userGrants }, m2), null, "an ordinary person can be edited");
  assert.equal(rbacChangeRefusal(editorOwner, st, { userGrants: denyPrincipal.userGrants }, m2), null, "the owner may edit the principal");
  const editAdminRole = { roles: st.roles.map((r) => (r.code === "admin" ? { ...r, permissions: [...r.permissions, { module: "payroll" as const, actions: ["view" as const] }] } : r)) };
  assert.ok(rbacChangeRefusal(editorAdmin, st, editAdminRole, m2), "admin cannot widen the admin role");
  const editOffice = { roles: st.roles.map((r) => (r.code === "office" ? { ...r, note: "x" } : r)) };
  assert.equal(rbacChangeRefusal(editorAdmin, st, editOffice, m2), null, "admin may edit the office role");
  const dropOwnAssign = rbacChangeRefusal(editorAdmin, st, {}, m2, { assignments: ["asn_stf_shreya"] });
  assert.ok(dropOwnAssign, "a named delete of your own assignment is refused too");
  assert.equal(rbacChangeRefusal(editorAdmin, st, { userGrants: st.userGrants, roles: st.roles }, m2), null, "an unchanged save passes");
}

/* 14. Expiry: IST calendar day, and malformed dates never lift a deny. */
{
  // 2026-10-11 20:00 UTC is already 12 Oct in India.
  assert.equal(rbacTodayIst(Date.UTC(2026, 9, 11, 20, 0)), "2026-10-12");
  assert.equal(isValidRbacExpiry("2026-10-12"), true);
  assert.equal(isValidRbacExpiry(""), true);
  assert.equal(isValidRbacExpiry("12/10/2026"), false);
  assert.equal(isValidRbacExpiry("2026-02-30"), false);
  const n = normalizeRbacState({
    ...base,
    userGrants: [
      { id: "d", staffId: "stf_shreya", feature: F, effect: "deny", actions: ["edit"], note: "", grantedBy: "", grantedAt: "", expiresOn: "12-10-2026" },
      { id: "a", staffId: "stf_nihal", feature: F, effect: "allow", actions: ["edit"], note: "", grantedBy: "", grantedAt: "", expiresOn: "soon" },
    ],
  });
  assert.equal(n.userGrants.length, 1, "a malformed allow is dropped (never widened)");
  assert.equal(n.userGrants[0]!.expiresOn, "", "a malformed deny keeps denying");
  assert.equal(featureAccess(shreya, masters, F, "edit", n).allowed, false);
  assert.throws(() =>
    setPersonalGrant(base, { staffId: "stf_shreya", target: { level: "feature", id: F }, effect: "deny", actions: ["edit"], expiresOn: "tomorrow" }),
  );
}

/* 15. Saved grants unreadable: last known copy, else UNKNOWN (never "no denies"). */
{
  const withDeny = setPersonalGrant(base, { staffId: "stf_shreya", target: { level: "feature", id: F }, effect: "deny", actions: ["edit"] });
  const ok = rbacReadOutcome({ readOk: true, read: withDeny, lastKnown: null, defaults: defaultRbacState });
  assert.deepEqual([ok.known, ok.remember], [true, true]);
  const failedWithLast = rbacReadOutcome({ readOk: false, read: null, lastKnown: withDeny, defaults: defaultRbacState });
  assert.equal(failedWithLast.state, withDeny, "a failed read keeps the last copy and its denies");
  assert.equal(featureAccess(shreya, masters, F, "edit", failedWithLast.state).allowed, false);
  const cold = rbacReadOutcome({ readOk: false, read: null, lastKnown: null, defaults: defaultRbacState });
  assert.equal(cold.known, false, "no good copy ever read: unknown, not defaults-as-fact");
}

console.log("rbacEditorModel.selftest.ts: all assertions passed");
