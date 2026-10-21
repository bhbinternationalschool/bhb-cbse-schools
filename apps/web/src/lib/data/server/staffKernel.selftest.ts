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
import { defaultRbacState, type RbacState, type SessionLike } from "@/lib/rbac";
import { emptyMastersShell, type MastersState } from "@/lib/masters";
import {
  STAFF_SENSITIVE_PROFILE_KEYS,
  protectedChanges,
  rosterSaveRefusal,
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

  // A profile WITHOUT the sensitive keys at all is not a blanking either.
  const slim = await prepareStaffOps([op({ op: "upsert", id: "stf_7", base: T0, row: { profile: { fullName: "Asha" } } })], "stf_1", read);
  assert.ok(slim.ok);
  assert.equal(((slim.ok && (slim.ops[0] as { row: Row }).row.profile) as Row).panNo, "ABCDE1234F");

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
  assert.equal(staffSensitiveAuthority(s("s_pay"), masters, st), "payroll", "the office role holds payroll · edit");
  assert.equal(staffSensitiveAuthority(s("s_acc"), masters, st), "accounts");
  assert.equal(staffSensitiveAuthority(s("s_tch"), masters, st), null);
  assert.equal(staffSensitiveAuthority(s("s_pl"), masters, st), null, "staff · edit alone is NOT an authority");
  // A personal deny of payroll and accounts edit takes it away.
  const denied: RbacState = {
    ...st,
    userGrants: [
      { id: "g1", staffId: "s_pay", denyModule: "payroll", effect: "deny", actions: ["edit"], note: "", grantedBy: "", grantedAt: "", expiresOn: "" },
      { id: "g2", staffId: "s_pay", denyModule: "accounts", effect: "deny", actions: ["edit"], note: "", grantedBy: "", grantedAt: "", expiresOn: "" },
    ],
  };
  assert.equal(staffSensitiveAuthority(s("s_pay"), masters, denied), null, "personal deny wins");
  assert.equal(staffSensitiveAuthority(s("s_own", { persona: "parent" }), masters, st), null, "only staff sessions");
  console.log("  ✓ authority: owner / payroll / accounts from the session; staff · edit alone, teacher, parent: none");
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

/* ── 7. The OLD staff-roster save (POST /api/school-data/staff-roster) ── */
{
  const stored = [{ id: "stf_7", ...storedProfile }];
  const edit = (patch: Row) => [{ id: "stf_7", ...storedProfile, ...patch }];
  const named = new Set(["stf_7"]);
  assert.equal(rosterSaveRefusal(stored, edit({ mobile: "1" }), named, null), null, "a plain edit passes");
  assert.match(String(rosterSaveRefusal(stored, edit({ bankAccountNo: "9" }), named, null)), /bankAccountNo/);
  assert.match(String(rosterSaveRefusal(stored, edit({ basicPay: "" }), named, null)), /basicPay/, "a blanking is a change");
  assert.equal(rosterSaveRefusal(stored, edit({ bankAccountNo: "9" }), named, "payroll"), null, "payroll may");
  assert.match(String(rosterSaveRefusal(stored, edit({ loginUsername: "x" }), named, "payroll")), /login/);
  assert.equal(rosterSaveRefusal(stored, edit({ loginUsername: "x" }), named, "owner"), null);
  assert.match(String(rosterSaveRefusal(stored, edit({ loginPassword: "set" }), named, "owner")), /login/);
  // Rows a save will not write are not judged: unnamed (stamped) / stored (unstamped).
  assert.equal(rosterSaveRefusal(stored, edit({ bankAccountNo: "9" }), new Set(), null), null);
  assert.equal(rosterSaveRefusal(stored, edit({ bankAccountNo: "9" }), null, null), null, "unstamped: stored rows are never replaced");
  // Remapped by employee code onto the stored row.
  assert.match(String(rosterSaveRefusal(stored, [{ ...storedProfile, id: "stf_other_id", panNo: "Z" }], new Set(["stf_other_id"]), null)), /panNo/);
  // A new row with bank details (unstamped too).
  assert.match(String(rosterSaveRefusal(stored, [{ id: "n1", empCode: "E-100", fullName: "N", bankAccountNo: "1" }], null, null)), /bankAccountNo/);
  assert.equal(rosterSaveRefusal(stored, [{ id: "n1", empCode: "E-100", fullName: "N", bankAccountNo: "", loginUsername: "e-100", loginPassword: "" }], null, null), null);
  console.log("  ✓ old staff-roster save: protected keys need the authority; only rows it writes are judged");
}

/* ── 8. withStoredProtectedKeys / protectedChanges edge cases ── */
{
  assert.deepEqual(withStoredProtectedKeys(null, { a: 1 }), { a: 1 });
  assert.deepEqual(protectedChanges({ panNo: "" }, { panNo: null }), { sensitive: [], login: [] }, "blank = null");
  assert.deepEqual(protectedChanges({ basicPay: 25000 }, { basicPay: "25000" }).sensitive, ["basicPay"], "a type change is a change (as JSON)");
  console.log("  ✓ blank = null = absent; values compared as JSON");
}

section2().then(
  () => console.log("staffKernel.selftest: all passed"),
  (e) => {
    console.error(e);
    process.exit(1);
  },
);
