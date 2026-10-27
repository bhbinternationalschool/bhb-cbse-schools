/**
 * Run: npm run test:staff-kernel
 *
 * Data-layer 2.2b — staff records through the kernel, and the protected
 * fields (bank / UPI / Aadhaar / PAN / pay; the login). Drives the pure rules
 * the routes use: lib/staffProtectedFields, lib/data/server/staffKernel
 * (POST/GET /api/data/sis.staff), lib/data/server/staffSensitive
 * (POST /api/data/sis.staff/sensitive), lib/data/answerRedaction (every
 * conflict answer), and the old staff-roster save's guard.
 */
import assert from "node:assert/strict";
import { redactStoredForAnswer } from "../answerRedaction";
import { collectionDef } from "../registry";
import {
  BUILT_IN_GRANT_ADDITIONS,
  defaultBuiltInRoles,
  defaultRbacState,
  normalizeRbacState,
  type RbacRole,
  type RbacState,
  type SessionLike,
} from "@/lib/rbac";
import { emptyMastersShell, type MastersState } from "@/lib/masters";
import {
  STAFF_SENSITIVE_PROFILE_KEYS,
  protectedChanges,
  mobileFillCheck,
  staffHoldsPowerfulAccess,
  staffSensitiveAuthority,
  withStoredProtectedKeys,
} from "@/lib/staffProtectedFields";
import { isFeatureRefusalMessage } from "@/lib/deskFeatureAuth";
import { prepareStaffOps, staffListRows } from "./staffKernel";
import { buildSensitiveOps, parseSensitiveOps } from "./staffSensitive";
import type { WriteOp } from "../types";

type Row = Record<string, unknown>;
console.log("staffKernel.selftest.ts");

const T0 = "2026-10-21T09:00:00.123456+00:00";
const storedProfile = {
  fullName: "Asha Rao",
  empCode: "E-007",
  bankAccountNo: "000111222",
  bankIfsc: "SBIN0000001",
  aadhaarNo: "123412341234",
  panNo: "ABCDE1234F",
  basicPay: "25000",
  upiId: "asha@upi",
  loginUsername: "asha.rao",
  loginPassword: "plain-secret",
  addressCurrent: "Home",
};
const storedRow: Row = {
  id: "stf_7",
  tenant_id: "t1",
  emp_code: "E-007",
  full_name: "Asha Rao",
  mobile: "9876543210",
  status: "active",
  profile: storedProfile,
  updated_at: T0,
  deleted_at: null,
  deleted_by: null,
};
const read = async (ids: string[]) => new Map(ids.filter((i) => i === "stf_7").map((i) => [i, storedRow]));
const op = (o: object) => o as unknown as WriteOp<Row>;

/* ── 1. The TS key list equals the database's _sis_staff_sensitive_keys():
 *       checked against the real function on the stack (e2e/staff-kernel.acceptance.ts). */

/* ── 2. Plain staff editing through the kernel: protected keys never change ── */
async function section2(): Promise<void> {
  // A name change with the profile as read (no password: never sent) → lands, profile completed from stored.
  const asRead = { ...storedProfile } as Row;
  delete asRead.loginPassword;
  const ok = await prepareStaffOps([op({ op: "upsert", id: "stf_7", base: T0, row: { full_name: "Asha R.", profile: { ...asRead, fullName: "Asha R." } } })], "stf_1", read);
  assert.ok(ok.ok, ok.ok ? "" : ok.message);
  const prof = (ok.ok && (ok.ops[0] as { row: Row }).row.profile) as Row;
  assert.equal(prof.loginPassword, "plain-secret", "an absent password is laid on from the stored row (not a blanking)");
  assert.equal(prof.bankAccountNo, "000111222");

  // A profile WITHOUT the sensitive keys at all is not a blanking either — and
  // no other key is wiped: the sent keys are laid on the stored profile.
  const slim = await prepareStaffOps([op({ op: "upsert", id: "stf_7", base: T0, row: { profile: { fullName: "Asha" } } })], "stf_1", read);
  assert.ok(slim.ok);
  const slimProfile = (slim.ok && (slim.ops[0] as { row: Row }).row.profile) as Row;
  assert.equal(slimProfile.panNo, "ABCDE1234F");
  assert.equal(slimProfile.addressCurrent, "Home", "a key left out is kept, not wiped");
  assert.equal(slimProfile.fullName, "Asha");
  const cleared = await prepareStaffOps([op({ op: "upsert", id: "stf_7", base: T0, row: { profile: { addressCurrent: "" } } })], "stf_1", read);
  assert.equal(((cleared.ok && (cleared.ops[0] as { row: Row }).row.profile) as Row).addressCurrent, "", "cleared by sending it blank");

  for (const [k, v] of [["bankAccountNo", "999"], ["panNo", ""], ["basicPay", "90000"], ["upiId", null], ["aadhaarNo", "1"]] as const) {
    const r = await prepareStaffOps([op({ op: "upsert", id: "stf_7", base: T0, row: { profile: { ...asRead, [k]: v } } })], "stf_1", read);
    assert.ok(!r.ok && r.status === 403, `${k} → ${String(v)} must be refused`);
    assert.match(r.ok ? "" : r.message, new RegExp(k));
    assert.ok(isFeatureRefusalMessage(r.ok ? "" : r.message), "the refusal is one the browser toasts");
  }
  for (const [k, v] of [["loginUsername", "director@bhbinternational.school"], ["loginPassword", "new"]] as const) {
    const r = await prepareStaffOps([op({ op: "upsert", id: "stf_7", base: T0, row: { profile: { ...asRead, [k]: v } } })], "stf_1", read);
    assert.ok(!r.ok && r.status === 403, `${k} must be refused through sis.staff`);
    assert.ok(isFeatureRefusalMessage(r.ok ? "" : r.message));
    // …even from a STALE copy (the login has no database check of its own).
    const stale = await prepareStaffOps([op({ op: "upsert", id: "stf_7", base: "2026-01-01T00:00:00Z", row: { profile: { ...asRead, [k]: v } } })], "stf_1", read);
    assert.ok(!stale.ok && stale.status === 403, `${k} from a stale copy is still refused`);
  }
  // A stale copy holding an OLD bank value is the database's conflict (409), not a refusal here.
  const staleBank = await prepareStaffOps([op({ op: "upsert", id: "stf_7", base: "2026-01-01T00:00:00Z", row: { profile: { ...asRead, bankAccountNo: "old" } } })], "stf_1", read);
  assert.ok(staleBank.ok, "a stale copy goes to the kernel, which answers 409 stale");

  // A NEW record: bank details refused; the form's default username allowed, any other refused.
  const neu = (profile: Row) => prepareStaffOps([op({ op: "upsert", id: "stf_new", base: null, row: { emp_code: "E-099", profile } })], "stf_1", read);
  assert.ok((await neu({ fullName: "New", empCode: "E-099", loginUsername: "e-099", loginPassword: "" })).ok, "default username on create");
  assert.ok(!(await neu({ fullName: "New", empCode: "E-099", loginUsername: "someone@else" })).ok, "other username on create");
  assert.ok(!(await neu({ fullName: "New", empCode: "E-099", bankAccountNo: "1" })).ok, "bank on create");
  assert.ok(!(await neu({ fullName: "New", empCode: "E-099", loginPassword: "x" })).ok, "password on create");

  // Sign-in links (review #6) through the kernel: a set e-mail / mobile column is the owner's.
  const links = async () => [
    { id: "stf_7", email: "asha@school.test", mobile: "9876543210" },
    { id: "stf_9", email: "other@school.test", mobile: "9000000009" },
  ];
  const readL = async (ids: string[]) =>
    new Map(ids.filter((i) => i === "stf_7").map((i) => [i, { ...storedRow, email: "asha@school.test" }]));
  const em = await prepareStaffOps([op({ op: "upsert", id: "stf_7", base: T0, row: { email: "me@attacker.test" } })], "stf_1", readL, links);
  assert.ok(!em.ok && em.status === 403 && /email/.test(em.message), "changing a set e-mail column: refused");
  const mob = await prepareStaffOps([op({ op: "upsert", id: "stf_7", base: T0, row: { mobile: "9111111111" } })], "stf_1", readL, links);
  assert.ok(!mob.ok && /mobile/.test(mob.message), "changing a set mobile column: refused");
  const same = await prepareStaffOps([op({ op: "upsert", id: "stf_7", base: T0, row: { mobile: "+91 98765-43210" } })], "stf_1", readL, links);
  assert.ok(same.ok, "the same number spelt differently is no change");
  const newWithTaken = await prepareStaffOps(
    [op({ op: "upsert", id: "stf_new", base: null, row: { email: "OTHER@school.test", profile: { fullName: "N" } } })],
    "stf_1",
    readL,
    links,
  );
  assert.ok(!newWithTaken.ok, "a new record with another member's e-mail: refused");
  const newFree = await prepareStaffOps(
    [op({ op: "upsert", id: "stf_new", base: null, row: { email: "new@school.test", mobile: "9222222222", profile: { fullName: "N" } } })],
    "stf_1",
    readL,
    links,
  );
  assert.ok(newFree.ok, "a new record with free sign-in links: fine");
  // Review #3 through the kernel: blank username → the default from the code is fine on an existing record.
  const blankLogin = async (ids: string[]) =>
    new Map(ids.map((i) => [i, { ...storedRow, profile: { ...storedProfile, loginUsername: "" } }]));
  const derived = await prepareStaffOps([op({ op: "upsert", id: "stf_7", base: T0, row: { profile: { loginUsername: "e-007" } } })], "stf_1", blankLogin);
  assert.ok(derived.ok, derived.ok ? "" : derived.message);

  // Remove: `by` is the SESSION's, whatever the body says; deleted_by is never the body's.
  const del = await prepareStaffOps([op({ op: "delete", id: "stf_7", base: T0, by: "someone-else" })], "stf_1", read);
  assert.ok(del.ok);
  assert.equal((del.ok && (del.ops[0] as unknown as { by: string }).by), "stf_1");
  const sneaky = await prepareStaffOps([op({ op: "upsert", id: "stf_7", base: T0, row: { deleted_by: "x", tenant_id: "other" } })], "stf_1", read);
  assert.ok(sneaky.ok);
  assert.deepEqual(sneaky.ok && (sneaky.ops[0] as { row: Row }).row, {});
  // No session actor: refused.
  assert.ok(!(await prepareStaffOps([op({ op: "delete", id: "stf_7", base: T0 })], " ", read)).ok);
  // An unreadable store: 503, nothing written.
  const down = await prepareStaffOps([op({ op: "upsert", id: "stf_7", base: T0, row: { profile: {} } })], "stf_1", async () => {
    throw new Error("timeout");
  });
  assert.ok(!down.ok && down.status === 503);
  console.log("  ✓ sis.staff: protected keys refused (fresh and stale), absent = kept, by = session, deleted_by stripped");
}

/* ── 3. Conflict answers never carry the protected keys (review item 1) ── */
{
  const def = collectionDef("sis.staff");
  const out = redactStoredForAnswer(def, storedRow);
  const p = out.profile as Row;
  for (const k of ["bankAccountNo", "bankIfsc", "aadhaarNo", "panNo", "basicPay", "upiId", "loginUsername", "loginPassword"]) {
    assert.ok(!(k in p), `${k} must not be in a conflict answer`);
  }
  assert.equal(p.addressCurrent, "Home", "the rest of the record is still there to diff");
  assert.equal(out.updated_at, T0);
  assert.equal((storedRow.profile as Row).panNo, "ABCDE1234F", "the stored row itself is not mutated");
  // Other collections: untouched.
  const s = { id: "x", notes: "n", profile: { panNo: "p" } };
  assert.deepEqual(redactStoredForAnswer(collectionDef("sis.students"), s), s);
  console.log("  ✓ conflict answers: sis.staff redacted, other collections as stored");
}

/* ── 4. List reads: directory for non-editors, never a password ── */
{
  const rows = [storedRow, { ...storedRow, id: "stf_8", profile: { ...storedProfile, classTeacherLinks: [{ id: "l" }] } }];
  const teacher = staffListRows(rows, { canEdit: false, selfStaffId: "stf_8" });
  const other = teacher[0]!.profile as Row;
  assert.deepEqual(Object.keys(other).filter((k) => STAFF_SENSITIVE_PROFILE_KEYS.includes(k as never)), []);
  assert.ok(!("loginPassword" in other) && !("loginUsername" in other) && !("addressCurrent" in other));
  assert.equal(teacher[0]!.full_name, "Asha Rao");
  const self = teacher[1]!.profile as Row;
  assert.equal(self.panNo, "ABCDE1234F", "own record in full");
  assert.ok(!("loginPassword" in self), "own password never sent");
  const office = staffListRows(rows, { canEdit: true, selfStaffId: "" });
  assert.equal((office[0]!.profile as Row).bankAccountNo, "000111222");
  assert.ok(office.every((r) => !("loginPassword" in (r.profile as Row))));
  console.log("  ✓ GET sis.staff: directory / own / editor, no password ever");
}

/* ── 5. Who is an authority — from the session and the server's roles ── */
{
  const rbac = defaultRbacState();
  const role = (code: string) => rbac.roles.find((r) => r.code === code)!;
  const masters: MastersState = {
    ...emptyMastersShell(),
    staff: [],
  } as MastersState;
  const assign = (state: RbacState, staffId: string, code: string): RbacState => ({
    ...state,
    assignments: [
      ...state.assignments,
      { id: `a_${staffId}`, staffId, roleId: role(code).id, isPrimary: true, scope: { campusIds: [], classIds: [], departmentIds: [] }, expiresOn: "", note: "" },
    ],
  });
  let st = assign(rbac, "s_pay", "office");
  st = assign(st, "s_acc", "accounts");
  st = assign(st, "s_tch", "teacher");
  st = assign(st, "s_own", "owner");
  // A role with staff · edit and nothing else: "plain staff editing".
  const plain = { ...role("teacher"), id: "role_plain", code: "staff_clerk", name: "Staff clerk", permissions: [{ module: "staff" as const, actions: ["view", "edit"] as never }] };
  st = { ...st, roles: [...st.roles, plain], assignments: [...st.assignments, { id: "a_pl", staffId: "s_pl", roleId: "role_plain", isPrimary: true, scope: { campusIds: [], classIds: [], departmentIds: [] }, expiresOn: "", note: "" }] };
  const s = (staffId: string, extra: Partial<SessionLike> = {}): SessionLike => ({ roleCode: "teacher", staffId, fullName: staffId, persona: "staff", ...extra });
  assert.equal(staffSensitiveAuthority(s("s_own"), masters, st), "owner");
  assert.equal(staffSensitiveAuthority(s("x", { email: "director@bhbinternational.school" }), masters, st), "owner");
  // Director, 21 Oct 2026: owner + accountant only. The Office role holds
  // payroll · edit and accounts · edit for its daily work — NOT an authority.
  assert.equal(staffSensitiveAuthority(s("s_pay"), masters, st), null, "the office role is not an authority");
  assert.equal(staffSensitiveAuthority(s("s_acc"), masters, st), "accounts", "the accountant (staff.sensitive_edit) is");
  const adm = assign(rbac, "s_adm", "admin");
  assert.equal(staffSensitiveAuthority(s("s_adm"), masters, adm), null, "the admin role is not an authority");
  const prin = assign(rbac, "s_pr", "principal");
  assert.equal(staffSensitiveAuthority(s("s_pr"), masters, prin), null, "nor the principal (whole modules, no function grant)");
  // The function given to one person (a personal allow) makes them one.
  const allowOne: RbacState = {
    ...st,
    userGrants: [{ id: "g0", staffId: "s_tch", feature: "staff.sensitive_edit", effect: "allow", actions: ["edit"], note: "", grantedBy: "", grantedAt: "", expiresOn: "" }],
  };
  assert.equal(staffSensitiveAuthority(s("s_tch"), masters, allowOne), "accounts");
  assert.equal(staffSensitiveAuthority(s("s_acc"), masters, st, { rbacKnown: false }), null, "roles unreadable: only a protected owner e-mail");
  assert.equal(staffSensitiveAuthority(s("x", { email: "director@bhbinternational.school" }), masters, st, { rbacKnown: false }), "owner");
  assert.equal(staffSensitiveAuthority(s("s_tch"), masters, st), null);
  assert.equal(staffSensitiveAuthority(s("s_pl"), masters, st), null, "staff · edit alone is NOT an authority");
  // A personal deny of the function takes it away from the accountant.
  const denied: RbacState = {
    ...st,
    userGrants: [{ id: "g1", staffId: "s_acc", feature: "staff.sensitive_edit", effect: "deny", actions: ["edit"], note: "", grantedBy: "", grantedAt: "", expiresOn: "" }],
  };
  assert.equal(staffSensitiveAuthority(s("s_acc"), masters, denied), null, "personal deny wins");
  assert.equal(staffSensitiveAuthority(s("s_own", { persona: "parent" }), masters, st), null, "only staff sessions");
  console.log("  ✓ authority: owner or the staff.sensitive_edit function (accountant); office, admin, principal, staff · edit: none");
}

/* ── 6. The sensitive route's rules ── */
{
  const stored = new Map<string, Row>([["stf_7", storedRow], ["stf_x", { ...storedRow, id: "stf_x", deleted_at: T0 }]]);
  assert.equal(typeof parseSensitiveOps({ ops: [{ id: "stf_7", base: T0, fields: { fullName: "x" } }] }), "string", "only protected keys");
  assert.equal(typeof parseSensitiveOps({ ops: [] }), "string");
  assert.equal(typeof parseSensitiveOps({ ops: [{ id: "a", base: T0, fields: { panNo: "1" } }, { id: "a", base: T0, fields: { panNo: "2" } }] }), "string");
  const ok = buildSensitiveOps(parseSensitiveOps({ ops: [{ id: "stf_7", base: T0, fields: { bankAccountNo: "555", panNo: "" } }] }) as never, stored, "payroll");
  assert.ok(ok.ok);
  const prof = (ok.ok && (ok.ops[0] as { row: Row }).row.profile) as Row;
  assert.equal(prof.bankAccountNo, "555");
  assert.equal(prof.panNo, "");
  assert.equal(prof.addressCurrent, "Home", "everything else is the stored profile");
  assert.equal(prof.loginPassword, "plain-secret");
  const owned = buildSensitiveOps([{ id: "stf_7", base: T0, fields: { email: "asha.new@school.test" } }], stored, "owner");
  assert.ok(owned.ok && (owned.ops[0] as { row: Row }).row.email === "asha.new@school.test", "the owner changes an e-mail — column and profile");
  assert.ok(!buildSensitiveOps([{ id: "stf_7", base: T0, fields: { mobile: "9111111111" } }], stored, "accounts").ok, "the accountant may not change a mobile");
  const name = buildSensitiveOps([{ id: "stf_7", base: T0, fields: { loginUsername: "new.name" } }], stored, "payroll");
  assert.ok(!name.ok && name.status === 403, "payroll may not change a login");
  assert.ok(buildSensitiveOps([{ id: "stf_7", base: T0, fields: { loginUsername: "new.name" } }], stored, "owner").ok, "the owner may");
  assert.ok(!buildSensitiveOps([{ id: "stf_7", base: T0, fields: { loginPassword: "set" } }], stored, "owner").ok, "nobody SETS a password");
  assert.ok(buildSensitiveOps([{ id: "stf_7", base: T0, fields: { loginPassword: "" } }], stored, "owner").ok, "the owner may clear one");
  const gone = buildSensitiveOps([{ id: "stf_x", base: T0, fields: { panNo: "1" } }], stored, "owner");
  assert.ok(!gone.ok && gone.status === 409, "a removed member is restored first");
  assert.ok(!buildSensitiveOps([{ id: "stf_7", base: null, fields: { panNo: "1" } }], stored, "owner").ok, "a base is required");
  assert.ok(!buildSensitiveOps([{ id: "nope", base: T0, fields: { panNo: "1" } }], stored, "owner").ok);
  console.log("  ✓ sensitive route: only protected keys, login owner-only, no password set, base required");
}

/* ── 7. The OLD staff-roster save is gone (data-layer 2.2d): POST answers 410,
 *      its guard (rosterSaveRefusal / prepareRosterRows) went with it — proved
 *      on the stack (e2e/staff-kernel.acceptance.ts, section E). ── */

/* ── 8. withStoredProtectedKeys / protectedChanges edge cases ── */
{
  assert.deepEqual(withStoredProtectedKeys(null, { a: 1 }), { a: 1 });
  assert.deepEqual(protectedChanges({ panNo: "" }, { panNo: null }), { sensitive: [], login: [] }, "blank = null");
  // Review #8 — canonical comparison.
  assert.deepEqual(protectedChanges({ basicPay: 25000 }, { basicPay: "25000" }).sensitive, [], "25000 = \"25000\"");
  assert.deepEqual(protectedChanges({ bankAccountNo: "000111" }, { bankAccountNo: 111 }).sensitive, ["bankAccountNo"], "leading zeros matter");
  assert.deepEqual(
    protectedChanges({ visitingPay: { rate: 500, mode: "hour" } }, { visitingPay: { mode: "hour", rate: "500" } }).sensitive,
    [],
    "key order and number spelling inside an object",
  );
  assert.deepEqual(protectedChanges({ visitingPay: { rate: 500 } }, { visitingPay: { rate: 600 } }).sensitive, ["visitingPay"]);
  console.log("  ✓ canonical compare: blank = null = absent, key order, number vs string; leading zeros kept");
}

/* ── 9. Director, 21 Oct: the office may record a MISSING mobile, under safeguards ── */
{
  const rbac = defaultRbacState();
  const role = (code: string) => rbac.roles.find((r) => r.code === code)!;
  const masters = {
    ...emptyMastersShell(),
    designations: [
      { id: "des_pr", code: "PRIN", name: "Principal", departmentId: null, isActive: true },
      { id: "des_t", code: "TGT", name: "TGT", departmentId: null, isActive: true },
    ],
    staff: [],
  } as unknown as MastersState;
  const withRole = (staffId: string, code: string): RbacState => ({
    ...rbac,
    assignments: [{ id: `a_${staffId}`, staffId, roleId: role(code).id, isPrimary: true, scope: { campusIds: [], classIds: [], departmentIds: [] }, expiresOn: "", note: "" }],
  });
  const plain = { id: "s_t", designationId: "des_t", email: "", fullName: "T" };
  assert.equal(staffHoldsPowerfulAccess(plain, masters, rbac), false, "a teacher-designation member with no role");
  assert.equal(staffHoldsPowerfulAccess({ ...plain, designationId: "des_pr" }, masters, rbac), true, "the principal designation");
  for (const code of ["owner", "admin", "accounts", "principal", "office"]) {
    assert.equal(staffHoldsPowerfulAccess(plain, masters, withRole("s_t", code)), true, `a member holding the ${code} role`);
  }
  assert.equal(staffHoldsPowerfulAccess(plain, masters, withRole("s_t", "teacher")), false, "the teacher role");
  assert.equal(staffHoldsPowerfulAccess({ ...plain, email: "director@bhbinternational.school" }, masters, rbac), true, "an owner e-mail");
  const allowFn: RbacState = {
    ...rbac,
    userGrants: [{ id: "g", staffId: "s_t", feature: "staff.sensitive_edit", effect: "allow", actions: ["edit"], note: "", grantedBy: "", grantedAt: "", expiresOn: "" }],
  };
  assert.equal(staffHoldsPowerfulAccess(plain, masters, allowFn), true, "the bank & pay details function, personally");

  const inUse = new Set(["9876543210"]);
  const chk = (stored: Record<string, unknown> | null, next: unknown, powerful = false) =>
    mobileFillCheck(stored, { mobile: next }, { inUse, powerful, name: "Ravi" });
  assert.equal(chk({ mobile: "" }, "9000000077").kind, "fill", "blank → a free number");
  assert.equal(chk({ mobile: "0000000000" }, "9000000077").kind, "fill", "a placeholder counts as blank");
  const taken = chk({ mobile: "" }, "+91 98765-43210");
  assert.ok(taken.kind === "refuse" && /another member of staff, a family or a login/.test(taken.message), "a number in use (spelt with +91, spaces, dashes)");
  const strong = chk({ mobile: "" }, "9000000077", true);
  assert.ok(strong.kind === "refuse" && /recorded by the owner/.test(strong.message), "a powerful member: the owner's");
  assert.equal(chk({ mobile: "9111111111" }, "9000000077").kind, "none", "changing a set number is not a fill");
  assert.equal(chk(null, "9000000077").kind, "none", "a new record is not a fill");
  assert.ok(isFeatureRefusalMessage((taken as { message: string }).message) && isFeatureRefusalMessage((strong as { message: string }).message));

  console.log("  ✓ mobile rule: blank → free number for a non-powerful member (logged); in use / powerful / change → owner");
}

/* ── 10. The Accounts role's staff.sensitive_edit: added once, a removal stands ── */
{
  const ADD = "2026-10-21.accounts.staff_sensitive_edit";
  assert.ok(BUILT_IN_GRANT_ADDITIONS.some((a) => a.id === ADD && a.roleCode === "accounts"));
  const tmpl = defaultBuiltInRoles().find((r) => r.code === "accounts")!;
  assert.ok(tmpl.featureGrants?.some((g) => g.feature === "staff.sensitive_edit") && tmpl.defaultsApplied?.includes(ADD), "a fresh Accounts role carries it, stamped");
  // Production's stored Accounts role: no function, no stamp.
  const stored = { ...tmpl, featureGrants: [] } as RbacRole;
  delete (stored as { defaultsApplied?: unknown }).defaultsApplied;
  const once = normalizeRbacState({ version: 1, roles: [stored] });
  const acc = once.roles.find((r) => r.code === "accounts")!;
  assert.deepEqual(acc.featureGrants?.find((g) => g.feature === "staff.sensitive_edit")?.actions, ["edit"], "added to the stored role");
  assert.ok(acc.defaultsApplied?.includes(ADD) && once.audit.some((e) => e.detail.includes(ADD)), "stamped and audited");
  // The office removes it afterwards → it stays removed on every later load.
  const removed = normalizeRbacState({ ...once, roles: once.roles.map((r) => (r.code === "accounts" ? { ...r, featureGrants: [] } : r)) });
  assert.equal(removed.roles.find((r) => r.code === "accounts")!.featureGrants?.length, 0, "a removal stands");
  const again = normalizeRbacState(removed);
  assert.equal(again.roles.find((r) => r.code === "accounts")!.featureGrants?.length, 0, "…and is never re-added");
  console.log("  ✓ Accounts gets staff.sensitive_edit once (stamped, audited); a removal by the office stands");
}

/* ── 9b. The same mobile rule through the kernel (sis.staff — the office's
 *        route since 2.2d: the old staff-roster save is 410). ── */
async function section9b(): Promise<void> {
  const blank = { ...storedRow, id: "s_t", mobile: "", profile: { ...storedProfile, mobile: "" } };
  const set = { ...blank, mobile: "9111111111", profile: { ...storedProfile, mobile: "9111111111" } };
  const reader = (r: Row) => async (ids: string[]) => new Map(ids.filter((i) => i === "s_t").map((i) => [i, r]));
  const rule = (powerful: boolean) => ({ inUse: async () => new Set(["9876543210"]), isPowerful: () => powerful });
  const send = (mobile: string) => [op({ op: "upsert", id: "s_t", base: T0, row: { mobile, profile: { mobile, designationId: "des_x" } } })];
  const fill = await prepareStaffOps(send("9000000077"), "stf_1", reader(blank), async () => [], rule(false));
  assert.ok(fill.ok && fill.mobileFills.includes("s_t"), "a blank mobile filled with a free number (and a designation) → lands, reported for the log");
  const inUse = await prepareStaffOps(send("9876543210"), "stf_1", reader(blank), async () => [], rule(false));
  assert.ok(!inUse.ok && inUse.status === 403, "a number in use → refused");
  const strong = await prepareStaffOps(send("9000000077"), "stf_1", reader(blank), async () => [], rule(true));
  assert.ok(!strong.ok && /recorded by the owner/.test(strong.message), "a powerful member → the owner's");
  const change = await prepareStaffOps(send("9000000077"), "stf_1", reader(set), async () => [], rule(false));
  assert.ok(!change.ok && /mobile/.test(change.message), "changing a set number → the owner's");
  console.log("  ✓ mobile rule through sis.staff: blank → free number lands; in use / powerful / change refused");
}

section2().then(() => section9b()).then(
  () => console.log("staffKernel.selftest: all passed"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
