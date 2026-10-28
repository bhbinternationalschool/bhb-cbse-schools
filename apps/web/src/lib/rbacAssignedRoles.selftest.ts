/**
 * Explicit Masters → Roles assignments decide a staff member's role — in
 * the session cookie and in every client check — and "not loaded yet" is
 * never read as "no access".
 *
 * 12 Oct 2026: the office could not see Comms → App pop-ups / Parents on
 * app although the office role holds notices · edit. Shreya (designation
 * "Computer Operator", assigned office) got roleCode "support" from the
 * designation; assignments were found only through the staff roster, which
 * arrives late in a memory-only browser, and 15 screens passed masters =
 * null so assignments were never consulted at all.
 *
 * Run: npx tsx src/lib/rbacAssignedRoles.selftest.ts
 */
import assert from "node:assert/strict";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";

import { accessDataStatus, accessVerdict } from "./accessDataStatus";
import { emptyMastersShell, type MastersState } from "./masters";
import {
  canAccessHref,
  canAccessMastersTab,
  defaultRbacState,
  hasPermission,
  resolveSessionRoles,
  type RbacState,
  type SessionLike,
  type UserRoleAssignment,
} from "./rbac";
import { assignedRoleCodesFor, staffRoleCodeFor } from "./staffSessionRole";

console.log("rbacAssignedRoles.selftest.ts");

function roster(): MastersState {
  const m = emptyMastersShell();
  const des = (id: string, name: string) =>
    ({ id, code: id.toUpperCase(), name, departmentId: null, isActive: true }) as (typeof m.designations)[number];
  m.designations = [
    des("des_op", "Computer Operator"),
    des("des_acc", "Accountant"),
    des("des_tgt", "TGT"),
  ];
  const stf = (id: string, fullName: string, designationId: string, stream: string) =>
    ({
      id,
      empCode: id,
      fullName,
      stream,
      category: "permanent",
      departmentId: null,
      designationId,
      campusId: null,
      mobile: "9000000000",
      email: `${id}@example.com`,
      status: "active",
    }) as unknown as (typeof m.staff)[number];
  m.staff = [
    stf("stf_shreya", "Shreya Like", "des_op", "non_teaching"),
    stf("stf_nihal", "Nihal Like", "des_acc", "non_teaching"),
    stf("stf_teacher", "Teacher Like", "des_tgt", "teaching"),
  ];
  return m;
}

function assign(staffId: string, roleId: string, expiresOn = ""): UserRoleAssignment {
  return {
    id: `asg_${staffId}_${roleId}`,
    staffId,
    roleId,
    isPrimary: false,
    scope: { campusIds: [], classIds: [], departmentIds: [] },
    expiresOn,
    note: "",
  };
}

const rbac: RbacState = {
  ...defaultRbacState(),
  assignments: [
    assign("stf_shreya", "role_office"),
    assign("stf_nihal", "role_office"),
    assign("stf_nihal", "role_accounts"),
    assign("stf_teacher", "role_principal", "2020-01-01"), // expired — ignored
  ],
};
const masters = roster();
const person = (staffId: string, fullName: string) => ({ staffId, fullName, email: `${staffId}@example.com` });
const session = (staffId: string, fullName: string, roleCode: string): SessionLike => ({
  ...person(staffId, fullName),
  roleCode,
  persona: "staff",
});
const codes = (s: SessionLike, m: MastersState | null) =>
  resolveSessionRoles(rbac, s, m).map((r) => r.code).sort();

// --- Shreya-like: designation matches nothing, assigned office.
assert.equal(staffRoleCodeFor(person("stf_shreya", "Shreya Like"), masters), "support", "designation alone → support (unchanged)");
assert.equal(staffRoleCodeFor(person("stf_shreya", "Shreya Like"), masters, "teacher", rbac), "office", "assignment wins for the cookie");
assert.equal(staffRoleCodeFor(person("stf_shreya", "Shreya Like"), masters, "teacher", null), "support", "unreadable rbac = roster only, not 'no role'");
for (const m of [masters, null, emptyMastersShell()]) {
  for (const rc of ["office", "support"]) {
    const s = session("stf_shreya", "Shreya Like", rc);
    const label = `Shreya roleCode=${rc} masters=${m === null ? "null" : m.staff.length ? "roster" : "no roster"}`;
    assert.deepEqual(codes(s, m), ["office"], `${label}: assigned office`);
    assert.ok(hasPermission(s, m, "notices", "edit", rbac), `${label}: notices.edit`);
    assert.ok(canAccessHref(s, m, "/comms?tab=popups", rbac), `${label}: App pop-ups`);
    assert.ok(canAccessHref(s, m, "/comms?tab=onapp", rbac), `${label}: Parents on app`);
  }
}

// --- Nihal-like: Accountant, assigned office + accounts → union; label = higher.
assert.deepEqual(assignedRoleCodesFor("stf_nihal", rbac), ["accounts", "office"]);
assert.equal(staffRoleCodeFor(person("stf_nihal", "Nihal Like"), masters, "teacher", rbac), "accounts");
for (const m of [masters, null]) {
  const s = session("stf_nihal", "Nihal Like", "accounts");
  assert.deepEqual(codes(s, m), ["accounts", "office"], "both assigned roles count");
  assert.ok(hasPermission(s, m, "notices", "edit", rbac), "office half: notices.edit");
  assert.ok(hasPermission(s, m, "accounts", "view", rbac), "accounts half: accounts.view");
  assert.ok(canAccessHref(s, m, "/comms?tab=popups", rbac), "Nihal sees App pop-ups");
}

// --- Unassigned teacher (their only assignment expired): inferred, unchanged.
assert.deepEqual(assignedRoleCodesFor("stf_teacher", rbac), [], "expired assignment ignored");
assert.equal(staffRoleCodeFor(person("stf_teacher", "Teacher Like"), masters, "teacher", rbac), "teacher");
assert.deepEqual(codes(session("stf_teacher", "Teacher Like", "teacher"), masters), ["teacher"]);
assert.deepEqual(codes(session("stf_teacher", "Teacher Like", "teacher"), null), ["teacher"]);

// --- A server-minted "support" read back without the roster stays support
// (it fell through to the blank-login fallback — principal — before).
assert.deepEqual(codes(session("stf_nobody", "Sweeper Like", "support"), null), ["support"]);

// --- Roster / roles not loaded yet → loading (or failed), never denied.
const base = { remote: true, mounted: true, rbacLoaded: true, rosterLoaded: true, attemptSettled: false };
assert.equal(accessDataStatus(base), "ready");
assert.equal(accessDataStatus({ ...base, rosterLoaded: false }), "loading", "roster not yet loaded");
assert.equal(accessDataStatus({ ...base, rbacLoaded: false }), "loading", "roles not yet loaded");
assert.equal(accessDataStatus({ ...base, rosterLoaded: false, attemptSettled: true }), "failed");
assert.equal(accessDataStatus({ ...base, mounted: false }), "loading", "server render never decides");
assert.equal(accessDataStatus({ ...base, remote: false, rbacLoaded: false, rosterLoaded: false }), "ready");
for (const st of ["loading", "failed"] as const) {
  assert.equal(accessVerdict(st, () => false), st, `${st} is never "denied"`);
}
assert.equal(accessVerdict("ready", () => false), "denied");
assert.equal(accessVerdict("ready", () => true), "allowed");

// --- Static: no permission helper is ever called with literal null/undefined masters.
const HELPERS =
  "hasPermission|visibleModuleTabs|canSeeModuleTab|canWriteModuleTab|hasFeaturePermission|featureAccess|" +
  "hasAnyFeatureInModule|canAccessHref|canAccessModule|hasScopedPermission|resolveSessionRoles|" +
  "resolveSessionRoleScopes|canApproveConcession|canGrantConcession|canBackdateReceipt|canConfigureRbac|" +
  "canAccessMastersTab|canAccessReportsCenter|scopedClassIds|userGrantsFor";
const nullCall = new RegExp(`\\b(${HELPERS})\\(\\s*[\\w.]+\\s*,\\s*(null|undefined)\\s*[,)]`, "g");
const srcRoot = join(__dirname, "..");
const offenders: string[] = [];
function walk(dir: string) {
  for (const name of readdirSync(dir)) {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) {
      walk(p);
      continue;
    }
    if (!/\.tsx?$/.test(name) || /\.selftest\.ts$/.test(name)) continue;
    const text = readFileSync(p, "utf8");
    for (const m of text.matchAll(nullCall)) offenders.push(`${p.slice(srcRoot.length + 1)}: ${m[0]}`);
  }
}
walk(srcRoot);
assert.deepEqual(offenders, [], "permission helpers called with null masters");

// --- The page gate, menu and Comms decide from useAccessData, recomputed on change.
const read = (rel: string) => readFileSync(join(srcRoot, rel), "utf8");
for (const rel of [
  "components/shell/ErpModuleGate.tsx",
  "components/shell/ErpSidebar.tsx",
  "components/pwa/StaffBottomNav.tsx",
  "components/comms/CommsWorkspace.tsx",
]) {
  assert.ok(read(rel).includes("useAccessData()"), `${rel} waits for roles + roster`);
}
assert.ok(!/setTimeout\(r, 4000\)/.test(read("components/shell/ErpModuleGate.tsx")), "the gate no longer decides after a 4 s guess");
assert.ok(!/setShownTabs\(/.test(read("components/comms/CommsWorkspace.tsx")), "Comms tabs are derived, not set once on mount");
const hook = read("components/shell/useAccessData.ts");
for (const ev of ["bhb-desk-first-hydrated", "bhb-masters-updated", "bhb-desk-hydrated", "bhb-rbac-updated"]) {
  assert.ok(hook.includes(`"${ev}"`), `useAccessData recomputes on ${ev}`);
}

// A SCOPED assignment never becomes the session label: "office for one class"
// must not read as school-wide office in label-only checks (review of #574).
{
  const scoped: RbacState = {
    ...rbac,
    assignments: [
      ...rbac.assignments,
      { ...assign("stf_teacher", "role_office"), scope: { campusIds: [], classIds: ["cls_v"], departmentIds: [] } },
    ],
  };
  assert.notEqual(
    staffRoleCodeFor(person("stf_teacher", "Teacher Person"), masters, "teacher", scoped),
    "office",
    "a class-scoped office assignment does not make the session label office",
  );
  assert.ok(assignedRoleCodesFor("stf_teacher", scoped).includes("office"), "the scoped grant itself still exists");
  assert.deepEqual(assignedRoleCodesFor("stf_teacher", scoped, { unscopedOnly: true }), []);
}


// --- A principal opening Masters with an EMPTY roster ("staff 0"): the roster
// answered with nobody, so the page copy holds no staff. Access must still be
// decided from the session's own role (not denied, not guessed from the
// roster), so the fee-head form opens and its save can be tested
// (e2e/specs/staff-editor-writes.spec.ts, "staff 0").
{
  const principal = session("stf_principal", "Principal Like", "principal");
  const none = emptyMastersShell();
  assert.equal(none.staff.length, 0, "fixture: no roster");
  assert.deepEqual(codes(principal, none), ["principal"], "principal from the session alone");
  assert.ok(hasPermission(principal, none, "masters", "edit", defaultRbacState()), "principal: masters.edit with no roster");
  assert.ok(canAccessMastersTab(principal, none, "fee-heads", defaultRbacState(), "edit"), "fee-heads tab opens for edit with no roster");
  assert.ok(canAccessHref(principal, none, "/masters?tab=fee-heads", defaultRbacState()), "/masters?tab=fee-heads passes the page gate with no roster");
  // And with the roster NOT loaded the gate never answers yes or no: it waits
  // (loading) or says it could not check (failed). The fee-head form is behind
  // that verdict, so a roster that never answers shows no form at all.
  for (const st of ["loading", "failed"] as const) {
    assert.equal(accessVerdict(st, () => true), st, `${st}: not "allowed" until the roster is known`);
  }
  assert.equal(
    accessDataStatus({ remote: true, mounted: true, rbacLoaded: true, rosterLoaded: false, attemptSettled: false }),
    "loading",
    "a roster request that never answers keeps the gate on loading",
  );
}

console.log("rbacAssignedRoles.selftest.ts: ok");
