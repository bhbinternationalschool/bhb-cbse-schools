/**
 * Acceptance check for data-layer step 2.2b (staff records through the
 * kernel; the protected staff fields; Masters element writes) on the local
 * test stack.
 *
 *   bash scripts/e2e-stack.sh check      (after write-kernel.acceptance.ts)
 *
 * Everything goes through the running app's own routes with the fixture's
 * signed sessions; the database is read back (and, for the reader checks,
 * one row is marked removed directly) over PostgREST with the service key.
 *
 *  A. Removed staff are hidden by every server-side list (marked removed in
 *     the database directly — this part means the same on the code before
 *     2.2b): GET /api/school-data/staff-roster, GET /api/data/views/staff-list,
 *     GET /api/v1/staff/roster (mobile), and the removed person's own session
 *     ends (401). Cleared → all back.
 *  B. The sensitive route: a teacher → 403; the principal (payroll · edit) →
 *     200, recorded in sis_staff_sensitive_changes (field names, authority,
 *     actor = the session); a stale base → 409; a non-protected field → 400;
 *     a login username by a non-owner → 403.
 *  C. POST /api/data/sis.staff: a bank/PAN change → 403 even for the
 *     principal, nothing written; a profile without the protected keys keeps
 *     them; a login username change → 403; a stale write → 409 whose stored
 *     row carries no bank / Aadhaar / PAN / pay / login.
 *  D. Remove through the kernel: soft (deleted_at, deleted_by = the SESSION,
 *     not the body's `by`), staff · delete needed (office → 403); hidden from
 *     GET sis.staff, listed by ?removed=1 (teacher → 403); restore with the
 *     removed row's revision brings them back everywhere.
 *  E. The OLD staff-roster save: a plain staff editor (office with payroll
 *     and accounts personally denied) changing a bank account → 403, nothing
 *     written; a mobile change → 200; with the authority back → 200.
 *     Its DELETE soft-removes the roster: every row kept with deleted_at /
 *     deleted_by, departments and designations untouched.
 *  F. A teacher's own-class class subject through POST /api/data/masters.
 *     class-subjects (function grant): her class → 200, another class → 403.
 * Everything changed is put back as seeded.
 */

import { assertLocalStack, sessionCookieHeader } from "./session";
import { buildFixture, classId, staffId } from "./fixture";
import type { DemoSession } from "@/lib/auth";
import { pushDeskSliceToDb } from "@/lib/deskSliceNormalized.server";
import { STAFF_SENSITIVE_PROFILE_KEYS } from "@/lib/staffProtectedKeys";


type Outcome = { name: string; ok: boolean; detail: string };
const outcomes: Outcome[] = [];
function record(name: string, ok: boolean, detail: string): void {
  outcomes.push({ name, ok, detail });
  console.log(`${ok ? "PASS" : "FAIL"}  ${name} — ${detail}`);
}

const obj = (v: unknown): Record<string, unknown> =>
  v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
const arr = (v: unknown): unknown[] => (Array.isArray(v) ? v : []);
const short = (v: unknown) => JSON.stringify(v ?? null).slice(0, 200);
const sleep = (ms: number) => new Promise((r) => setTimeout(r, ms));
// The app's reference caches (Masters + roster, roles) look at erp_versions at
// most once per 2 s (data-layer 1.3): wait past that window after a change made
// outside the app's own write paths.
const PAST_VERSIONS_WINDOW = 2_600;

async function req(
  url: string,
  init: { method?: string; headers?: Record<string, string>; body?: unknown } = {},
): Promise<{ status: number; body: Record<string, unknown> }> {
  const res = await fetch(url, {
    method: init.method ?? "GET",
    headers: { ...(init.body !== undefined ? { "content-type": "application/json" } : {}), ...(init.headers ?? {}) },
    body: init.body !== undefined ? JSON.stringify(init.body) : undefined,
    redirect: "manual",
  });
  const text = await res.text();
  let body: unknown = null;
  try {
    body = JSON.parse(text);
  } catch {
    body = { _text: text.slice(0, 120) };
  }
  return { status: res.status, body: Array.isArray(body) ? { _array: body } : obj(body) };
}

const SENSITIVE = ["bankName", "bankBranch", "bankAccountNo", "bankIfsc", "bankAccountName", "upiId", "aadhaarNo", "panNo", "basicPay", "visitingPay", "loginUsername", "loginPassword"];

async function main(): Promise<void> {
  assertLocalStack();
  const api = process.env.NEXT_PUBLIC_SUPABASE_URL!;
  const app = process.env.E2E_APP_URL || "";
  if (!/^http:\/\/127\.0\.0\.1:\d+$/.test(app)) throw new Error(`E2E_APP_URL is "${app}", not 127.0.0.1`);
  const service = process.env.SUPABASE_SERVICE_ROLE_KEY || "";
  const svc = { apikey: service, Authorization: `Bearer ${service}` };
  const fx = buildFixture();
  const as = (s: DemoSession) => ({ cookie: sessionCookieHeader(s) });
  const office = as(fx.sessions.office);
  const principal = as(fx.sessions.principal);
  const teacher = as(fx.sessions.teacher);
  const TARGET = staffId(25);
  const targetRec = fx.staff.staff.find((s) => s.id === TARGET)!;
  const removedSelf = as({ ...fx.sessions.teacher, staffId: TARGET, fullName: targetRec.fullName });

  const tenant = await req(`${api}/rest/v1/tenants?slug=eq.bhb-international&select=id`, { headers: svc });
  const tenantId = String(obj(arr(tenant.body._array)[0]).id || "");
  if (!tenantId) throw new Error("no tenant on the stack");
  const rest = async (path: string) => arr((await req(`${api}/rest/v1/${path}`, { headers: svc })).body._array).map(obj);
  const patch = (path: string, body: unknown) =>
    req(`${api}/rest/v1/${path}`, { method: "PATCH", headers: { ...svc, Prefer: "return=minimal" }, body });
  const post = (collection: string, who: Record<string, string>, ops: unknown[]) =>
    req(`${app}/api/data/${collection}`, { method: "POST", headers: who, body: { ops } });
  const staffRow = async (id: string = TARGET) => (await rest(`sis_staff?id=eq.${id}&tenant_id=eq.${tenantId}&select=*`))[0] ?? {};
  const prof = (r: Record<string, unknown>) => obj(r.profile);
  const inRoster = async (who: Record<string, string>) =>
    arr((await req(`${app}/api/school-data/staff-roster`, { headers: who })).body.staff).map(obj).some((s) => s.id === TARGET);
  const inStaffList = async (who: Record<string, string>) =>
    arr(obj((await req(`${app}/api/data/views/staff-list`, { headers: who })).body.data).staff).map(obj).some((s) => s.id === TARGET);
  const inMobile = async (who: Record<string, string>) => {
    const r = await req(`${app}/api/v1/staff/roster`, { headers: who });
    const rows = arr(obj(r.body.data).staff ?? r.body.staff ?? obj(r.body.data).rows ?? r.body.rows).map(obj);
    return { status: r.status, has: rows.some((s) => s.id === TARGET), n: rows.length };
  };
  // ── 0. The app's sensitive-key list IS the database's ──────────────────
  {
    const APP_SENSITIVE_KEYS: string[] = [...STAFF_SENSITIVE_PROFILE_KEYS];
    const r = await req(`${api}/rest/v1/rpc/_sis_staff_sensitive_keys`, { method: "POST", headers: svc, body: {} });
    const db = arr(r.body._array).map(String);
    record(
      "the app's sensitive keys (lib/staffProtectedKeys) = _sis_staff_sensitive_keys() in the database",
      r.status === 200 && db.length > 0 && JSON.stringify(db) === JSON.stringify(APP_SENSITIVE_KEYS),
      `HTTP ${r.status}; db ${short(db)}; app ${short(APP_SENSITIVE_KEYS)}`,
    );
  }
  const original = await staffRow();
  if (!original.id) throw new Error(`${TARGET} is not on the stack`);
  const originalProfile = prof(original);
  const otherOriginal = await staffRow(staffId(27));

  // ── A. Readers hide a removed member (marked in the database directly) ──
  {
    const before = { roster: await inRoster(office), list: await inStaffList(office), mobile: await inMobile(principal) };
    const selfBefore = (await req(`${app}/api/data/views/staff-list`, { headers: removedSelf })).status;
    await patch(`sis_staff?id=eq.${TARGET}&tenant_id=eq.${tenantId}`, {
      deleted_at: new Date().toISOString(),
      deleted_by: "acceptance",
      updated_at: new Date().toISOString(),
    });
    await sleep(PAST_VERSIONS_WINDOW);
    const roster = await inRoster(office);
    const list = await inStaffList(office);
    const mobile = await inMobile(principal);
    const self = (await req(`${app}/api/data/views/staff-list`, { headers: removedSelf })).status;
    record(
      "readers: a removed member is not in staff-roster, the staff-list view or the mobile roster, and their session ends",
      before.roster && before.list && before.mobile.has && selfBefore === 200 && !roster && !list && mobile.status === 200 && !mobile.has && self === 401,
      `before roster/list/mobile ${before.roster}/${before.list}/${before.mobile.has} self ${selfBefore}; removed → ${roster}/${list}/${mobile.has} (mobile HTTP ${mobile.status}, ${mobile.n} rows), self ${self}`,
    );
    await patch(`sis_staff?id=eq.${TARGET}&tenant_id=eq.${tenantId}`, {
      deleted_at: null,
      deleted_by: null,
      updated_at: new Date().toISOString(),
    });
    await sleep(PAST_VERSIONS_WINDOW);
    const back = { roster: await inRoster(office), list: await inStaffList(office), mobile: await inMobile(principal) };
    const selfBack = (await req(`${app}/api/data/views/staff-list`, { headers: removedSelf })).status;
    record(
      "readers: cleared → back in every list, and they can sign in again",
      back.roster && back.list && back.mobile.has && selfBack === 200,
      `${back.roster}/${back.list}/${back.mobile.has}, self ${selfBack}`,
    );
  }

  // ── Who is who for B–G ───────────────────────────────────────────────────
  // The accountant: staff 26 given the built-in Accounts role (which carries
  // the staff.sensitive_edit function) through the rbac desk's own server
  // write path; removed again at the end (assignments is a MERGE slice: a
  // row goes only when the save names it). The owner: a protected owner
  // e-mail session (no roster row). The principal and the office are NOT
  // authorities (director, 21 Oct 2026).
  const ACC = staffId(26);
  const ACC_ASSIGN = "e2e_22b_acc_assign";
  const accRole = (fx.rbac.roles as { id: string; code: string }[]).find((r) => r.code === "accounts")!;
  const pushRbac = async (withAccountant: boolean) => {
    const assignments = withAccountant
      ? [...fx.rbac.assignments, { id: ACC_ASSIGN, staffId: ACC, roleId: accRole.id, isPrimary: true, scope: { campusIds: [], classIds: [], departmentIds: [] }, expiresOn: "", note: "2.2b acceptance" }]
      : fx.rbac.assignments;
    const r = await pushDeskSliceToDb(
      "rbac",
      { ...fx.rbac, assignments } as never,
      withAccountant ? undefined : { deletes: { assignments: [ACC_ASSIGN] } },
    );
    if (!(r as { ok?: boolean }).ok) throw new Error(`rbac push failed: ${short(r)}`);
    await sleep(PAST_VERSIONS_WINDOW);
  };
  const accountant = as({ ...fx.sessions.office, staffId: ACC, fullName: fx.staff.staff.find((s) => s.id === ACC)!.fullName, roleCode: "accounts" });
  const owner = as({ ...fx.sessions.office, staffId: undefined, roleCode: "owner", fullName: "Director", email: "director@bhbinternational.school" });
  await pushRbac(true);

  // ── B. The sensitive route ──────────────────────────────────────────────
  const sens = (who: Record<string, string>, ops: unknown[]) =>
    req(`${app}/api/data/sis.staff/sensitive`, { method: "POST", headers: who, body: { ops } });
  const SEED = { bankAccountNo: "E2E-ACCT-0025", panNo: "E2EPN0025F", aadhaarNo: "999988887777", basicPay: "31000" };
  {
    const r0 = await staffRow();
    const t = await sens(teacher, [{ id: TARGET, base: r0.updated_at, fields: { bankAccountNo: "TEACHER" } }]);
    const pr = await sens(principal, [{ id: TARGET, base: r0.updated_at, fields: { bankAccountNo: "PRINCIPAL" } }]);
    const of = await sens(office, [{ id: TARGET, base: r0.updated_at, fields: { bankAccountNo: "OFFICE" } }]);
    const p = await sens(accountant, [{ id: TARGET, base: r0.updated_at, fields: SEED }]);
    const r1 = await staffRow();
    const log = await rest(`sis_staff_sensitive_changes?staff_id=eq.${TARGET}&tenant_id=eq.${tenantId}&order=changed_at.desc&limit=1&select=fields,authority,actor`);
    record(
      "sensitive route: teacher, principal and office → 403 (owner + accountant only); the accountant → 200, recorded with authority and the session as actor, field names only",
      t.status === 403 && pr.status === 403 && of.status === 403 && p.status === 200 &&
        prof(r1).bankAccountNo === SEED.bankAccountNo && prof(r1).panNo === SEED.panNo &&
        obj(log[0]).authority === "accounts" && obj(log[0]).actor === ACC &&
        JSON.stringify(obj(log[0]).fields) === JSON.stringify(["aadhaarNo", "bankAccountNo", "basicPay", "panNo"]) &&
        !JSON.stringify(log).includes(SEED.bankAccountNo) && prof(r1).addressCurrent === originalProfile.addressCurrent,
      `teacher ${t.status}, principal ${pr.status}, office ${of.status}; accountant ${p.status} ${p.status === 200 ? "" : short(p.body)}; log ${short(log)}`,
    );
    const stale = await sens(accountant, [{ id: TARGET, base: r0.updated_at, fields: { panNo: "STALE" } }]);
    const other = await sens(accountant, [{ id: TARGET, base: r1.updated_at, fields: { fullName: "X" } }]);
    const login = await sens(accountant, [{ id: TARGET, base: r1.updated_at, fields: { loginUsername: "someone.else" } }]);
    const mail = await sens(accountant, [{ id: TARGET, base: r1.updated_at, fields: { email: "someone@else.test" } }]);
    const r2 = await staffRow();
    record(
      "sensitive route: stale base → 409; a non-protected field → 400; a login or e-mail by a non-owner → 403; nothing written",
      stale.status === 409 && other.status === 400 && login.status === 403 && mail.status === 403 && r2.updated_at === r1.updated_at,
      `stale ${stale.status}, other ${other.status}, login ${login.status}, email ${mail.status} ${short(mail.body.message)}`,
    );
  }

  // ── C. POST /api/data/sis.staff: protected keys and set sign-in links never change here ──
  {
    const r1 = await staffRow();
    const asRead = { ...prof(r1) };
    delete asRead.loginPassword;
    const bank = await post("sis.staff", principal, [{ op: "upsert", id: TARGET, base: r1.updated_at, row: { profile: { ...asRead, bankAccountNo: "CHANGED" } } }]);
    const pan = await post("sis.staff", principal, [{ op: "upsert", id: TARGET, base: r1.updated_at, row: { profile: { ...asRead, panNo: "" } } }]);
    const login = await post("sis.staff", principal, [{ op: "upsert", id: TARGET, base: r1.updated_at, row: { profile: { ...asRead, loginUsername: "director@bhbinternational.school" } } }]);
    const pRow = await staffRow(fx.sessions.principal.staffId!);
    const mail = await post("sis.staff", office, [{ op: "upsert", id: String(pRow.id), base: pRow.updated_at, row: { email: "office.takes.over@else.test" } }]);
    const mob = await post("sis.staff", office, [{ op: "upsert", id: TARGET, base: r1.updated_at, row: { mobile: "9111111111" } }]);
    const rA = await staffRow();
    const pAfter = await staffRow(fx.sessions.principal.staffId!);
    record(
      "sis.staff: bank change / PAN blanking / login username → 403 even for the principal; the principal's e-mail or a set mobile changed by the office → 403; nothing written",
      bank.status === 403 && pan.status === 403 && login.status === 403 && mail.status === 403 && mob.status === 403 &&
        rA.updated_at === r1.updated_at && pAfter.updated_at === pRow.updated_at,
      `bank ${bank.status} ${short(bank.body.message)}; pan ${pan.status}; login ${login.status}; email ${mail.status} ${short(mail.body.message)}; mobile ${mob.status}`,
    );
    const slim = await post("sis.staff", office, [
      { op: "upsert", id: TARGET, base: r1.updated_at, row: { full_name: targetRec.fullName, profile: { addressCurrent: "E2E 2.2b street" } } },
    ]);
    const rB = await staffRow();
    // Every other profile key exactly as before: the sent keys are laid on the stored profile.
    const wiped = Object.keys(prof(r1)).filter(
      (k) => k !== "addressCurrent" && JSON.stringify(prof(rB)[k]) !== JSON.stringify(prof(r1)[k]),
    );
    record(
      "sis.staff: a profile with only the changed keys wipes nothing — protected keys and every other key kept; the edit lands",
      slim.status === 200 && prof(rB).addressCurrent === "E2E 2.2b street" && prof(rB).bankAccountNo === SEED.bankAccountNo &&
        prof(rB).panNo === SEED.panNo && prof(rB).basicPay === SEED.basicPay && wiped.length === 0 && Object.keys(prof(r1)).length > 20,
      `HTTP ${slim.status} ${slim.status === 200 ? "" : short(slim.body)}; keys ${Object.keys(prof(r1)).length}, changed besides the address: ${short(wiped)}`,
    );
    const stale = await post("sis.staff", office, [{ op: "upsert", id: TARGET, base: r1.updated_at, row: { full_name: "Stale" } }]);
    const c = obj(arr(stale.body.conflicts)[0]);
    const leaked = SENSITIVE.filter((k) => k in obj(obj(c.stored).profile));
    record(
      "sis.staff: a stale write → 409; its stored row carries no bank / UPI / Aadhaar / PAN / pay / login",
      stale.status === 409 && c.reason === "stale" && obj(c.stored).full_name === targetRec.fullName && leaked.length === 0 &&
        !JSON.stringify(stale.body).includes(SEED.bankAccountNo),
      `HTTP ${stale.status} reason ${String(c.reason)}; leaked ${short(leaked)}`,
    );
  }

  // ── D. Remove through the kernel: soft, by the session, restorable ──────
  {
    const r0 = await staffRow();
    const officeDel = await post("sis.staff", office, [{ op: "delete", id: TARGET, base: r0.updated_at }]);
    const del = await post("sis.staff", principal, [{ op: "delete", id: TARGET, base: r0.updated_at, by: "someone-else" }]);
    const r1 = await staffRow();
    await sleep(PAST_VERSIONS_WINDOW);
    const listed = arr((await req(`${app}/api/data/sis.staff?limit=500`, { headers: office })).body.rows).map(obj).some((s) => s.id === TARGET);
    const removed = await req(`${app}/api/data/sis.staff?removed=1&limit=500`, { headers: office });
    const removedHas = arr(removed.body.rows).map(obj).some((s) => s.id === TARGET);
    const tRemoved = await req(`${app}/api/data/sis.staff?removed=1`, { headers: teacher });
    const roster = await inRoster(office);
    record(
      "remove: office (no staff · delete) → 403; principal → soft (row kept, deleted_by = the session, not the body); hidden; ?removed=1 lists it (teacher 403)",
      officeDel.status === 403 && del.status === 200 && !!r1.deleted_at && r1.deleted_by === fx.sessions.principal.staffId &&
        !listed && removed.status === 200 && removedHas && tRemoved.status === 403 && !roster,
      `office ${officeDel.status}; principal ${del.status}; deleted_by ${short(r1.deleted_by)}; listed ${listed}; removed ${removed.status}/${removedHas}; teacher ${tRemoved.status}; roster ${roster}`,
    );
    const ids = await req(`${app}/api/data/sis.staff?ids=${TARGET}`, { headers: office });
    const rev = String(obj(arr(ids.body.rows)[0]).updated_at ?? "");
    const blind = await post("sis.staff", office, [{ op: "upsert", id: TARGET, base: null, row: { deleted_at: null } }]);
    const restore = await post("sis.staff", office, [{ op: "upsert", id: TARGET, base: rev, row: { deleted_at: null } }]);
    const r2 = await staffRow();
    await sleep(PAST_VERSIONS_WINDOW);
    record(
      "restore: blind → 409; with the removed row's revision → 200, deleted_by cleared, back in every list",
      blind.status === 409 && restore.status === 200 && r2.deleted_at === null && r2.deleted_by === null &&
        (await inRoster(office)) && (await inStaffList(office)) && (await inMobile(principal)).has,
      `blind ${blind.status}, restore ${restore.status} ${restore.status === 200 ? "" : short(restore.body)}`,
    );
  }

  // ── E. The OLD staff-roster save and DELETE ──────────────────────────────
  {
    const OTHER = staffId(27);
    const rosterNow = async () => {
      const g = await req(`${app}/api/school-data/staff-roster`, { headers: office });
      const all = arr(g.body.staff).map(obj);
      const stamps = obj(obj(g.body.stamps).staff);
      return {
        me: all.find((s) => s.id === TARGET)!,
        other: all.find((s) => s.id === OTHER)!,
        stamp: String(stamps[TARGET] ?? ""),
        otherStamp: String(stamps[OTHER] ?? ""),
      };
    };
    const save = (who: Record<string, string>, rows: Record<string, unknown>[], stamps: Record<string, string>) =>
      req(`${app}/api/school-data/staff-roster`, { method: "POST", headers: who, body: { state: { staff: rows }, stamps: { staff: stamps } } });

    // The office (staff · edit, no bank & pay function) is a plain staff editor.
    const a = await rosterNow();
    const bank = await save(office, [{ ...a.me, bankAccountNo: "OLD-ROUTE" }], { [TARGET]: a.stamp });
    const rA = await staffRow();
    record(
      "old staff-roster save: the office's bank change → 403, nothing written",
      bank.status === 403 && prof(rA).bankAccountNo === SEED.bankAccountNo,
      `bank ${bank.status} ${short(bank.body.error)}`,
    );

    // Review #1: own id with another member's employee code → refused (the write would land on the other member).
    const hijack = await save(office, [{ ...a.me, empCode: a.other.empCode }], { [TARGET]: a.stamp });
    const lower = await save(office, [{ ...a.me, id: "e2e_22b_new_id", empCode: String(a.other.empCode).toLowerCase() }], { e2e_22b_new_id: a.otherStamp });
    const rO = await staffRow(OTHER);
    record(
      "old staff-roster save: an id/employee-code mismatch → 403; a new id with another member's code (lower-case) is judged against THAT member → 403; nothing written",
      hijack.status === 403 && /belongs to another member/.test(String(hijack.body.error)) && lower.status === 403 &&
        prof(rO).bankAccountNo !== SEED.bankAccountNo,
      `mismatch ${hijack.status} ${short(hijack.body.error)}; lower-case ${lower.status} ${short(lower.body.error)}`,
    );

    // Item 4: two rows, one refused → the other saves; the refused one is named.
    const both = await save(
      office,
      [{ ...a.me, bankAccountNo: "OLD-ROUTE" }, { ...a.other, addressCurrent: "E2E other street" }],
      { [TARGET]: a.stamp, [OTHER]: a.otherStamp },
    );
    const rOther = await staffRow(OTHER);
    const rT = await staffRow();
    record(
      "old staff-roster save: one row refused, the other row saves; the refused one is named",
      both.status === 200 && JSON.stringify(obj(both.body.refused).staff) === JSON.stringify([TARGET]) &&
        prof(rOther).addressCurrent === "E2E other street" && prof(rT).bankAccountNo === SEED.bankAccountNo,
      `HTTP ${both.status} ${short(both.body)}`,
    );

    // Review #2: a row WITHOUT the bank keys keeps them (absent = keep); review #3: blank username → the form's default.
    const b = await rosterNow();
    const lean: Record<string, unknown> = { ...b.me, addressCurrent: "E2E lean street", loginUsername: String(b.me.empCode).toLowerCase() };
    for (const k of ["bankAccountNo", "upiId", "panNo", "aadhaarNo", "basicPay", "bankIfsc", "bankName"]) delete lean[k];
    const leanSave = await save(office, [lean], { [TARGET]: b.stamp });
    const rL = await staffRow();
    record(
      "old staff-roster save: a row without the bank keys keeps them; a blank login username → the form's default saves",
      leanSave.status === 200 && !obj(leanSave.body).refused && prof(rL).bankAccountNo === SEED.bankAccountNo && prof(rL).panNo === SEED.panNo &&
        prof(rL).basicPay === SEED.basicPay && prof(rL).addressCurrent === "E2E lean street" && prof(rL).loginUsername === String(b.me.empCode).toLowerCase(),
      `HTTP ${leanSave.status} ${short(leanSave.body)}; bank ${short(prof(rL).bankAccountNo)}; username ${short(prof(rL).loginUsername)} (stored before: ${short(prof(original).loginUsername)})`,
    );

    // The owner may.
    const c = await rosterNow();
    const own = await save(owner, [{ ...c.me, bankAccountNo: "OWNER-OK" }], { [TARGET]: c.stamp });
    const rC = await staffRow();
    record(
      "old staff-roster save: the owner's bank change lands",
      own.status === 200 && !obj(own.body).refused && prof(rC).bankAccountNo === "OWNER-OK",
      `owner ${own.status} ${short(own.body)}`,
    );

    // DELETE: a soft remove of the roster; meanwhile a non-owner session ends, the owner's does not.
    const countAll = async () => ({
      staff: (await rest(`sis_staff?tenant_id=eq.${tenantId}&select=id`)).length,
      removed: (await rest(`sis_staff?tenant_id=eq.${tenantId}&deleted_at=not.is.null&select=id,deleted_by`)),
      deps: (await rest(`sis_departments?tenant_id=eq.${tenantId}&select=id`)).length,
      des: (await rest(`sis_designations?tenant_id=eq.${tenantId}&select=id`)).length,
    });
    const c0 = await countAll();
    const wipe = await req(`${app}/api/school-data/staff-roster`, { method: "DELETE", headers: principal });
    const c1 = await countAll();
    await sleep(PAST_VERSIONS_WINDOW);
    const teacherWhileEmpty = (await req(`${app}/api/data/views/staff-list`, { headers: teacher })).status;
    const ownerWhileEmpty = (await req(`${app}/api/data/views/staff-list`, { headers: owner })).status;
    const ids = c1.removed.map((r) => String(r.id));
    if (ids.length) {
      await patch(`sis_staff?tenant_id=eq.${tenantId}&id=in.(${ids.join(",")})`, { deleted_at: null, deleted_by: null, updated_at: new Date().toISOString() });
    }
    const c2 = await countAll();
    await sleep(PAST_VERSIONS_WINDOW);
    record(
      "old staff-roster DELETE: soft — every staff row kept with deleted_at + deleted_by (the session); departments and designations untouched; with nobody on the roster a teacher's session ends (401), the owner's does not; restored",
      wipe.status === 200 && c1.staff === c0.staff && c0.removed.length === 0 && c1.removed.length === c0.staff &&
        c1.removed.every((r) => r.deleted_by === fx.sessions.principal.staffId) && c1.deps === c0.deps && c1.des === c0.des &&
        teacherWhileEmpty === 401 && ownerWhileEmpty === 200 && c2.removed.length === 0 && c2.staff === c0.staff,
      `HTTP ${wipe.status} ${short(wipe.body)}; staff ${c0.staff} → removed ${c1.removed.length}; deps ${c0.deps} → ${c1.deps}; des ${c0.des} → ${c1.des}; teacher ${teacherWhileEmpty}, owner ${ownerWhileEmpty}; after restore removed ${c2.removed.length}`,
    );
  }

  // ── G. A staff member's own request for a bank change ──────────────────
  {
    const ask = await req(`${app}/api/v1/staff/me/profile`, { method: "PATCH", headers: removedSelf, body: { fields: { bankAccountNo: "220022002200" } } });
    const list = await req(`${app}/api/v1/staff/profile-requests`, { headers: office });
    const pending = arr(list.body.pending).map(obj).find((r) => r.staffId === TARGET && JSON.stringify(r.fields).includes("220022002200"));
    const id = String(pending?.id ?? "");
    const byOffice = await req(`${app}/api/v1/staff/profile-requests`, { method: "POST", headers: office, body: { id, decision: "approve" } });
    const byAcc = await req(`${app}/api/v1/staff/profile-requests`, { method: "POST", headers: accountant, body: { id, decision: "approve" } });
    const r = await staffRow();
    const log = await rest(`sis_staff_sensitive_changes?staff_id=eq.${TARGET}&tenant_id=eq.${tenantId}&order=changed_at.desc&limit=1&select=fields,authority,actor`);
    record(
      "profile request: a bank change approved by the office → 403; by the accountant → written through the sensitive door and logged",
      ask.status === 200 && !!id && byOffice.status === 403 && byAcc.status === 200 && prof(r).bankAccountNo === "220022002200" &&
        obj(log[0]).authority === "accounts" && obj(log[0]).actor === ACC && JSON.stringify(obj(log[0]).fields) === JSON.stringify(["bankAccountNo"]),
      `ask ${ask.status} ${ask.status === 200 ? "" : short(ask.body)}; request ${id || "none"}; office ${byOffice.status} ${short(byOffice.body.error)}; accountant ${byAcc.status} ${short(byAcc.body)}; log ${short(log)}`,
    );
  }

  // ── H. Masters lists: the commit caps on the server too ────────────────
  {
    const subj = arr((await req(`${app}/api/data/masters.subjects?limit=1000`, { headers: principal })).body.rows).map(obj);
    const two = await post("masters.subjects", principal, [
      { op: "delete", id: String(subj[0]!.id), base: String(subj[0]!._rev ?? "") },
      { op: "delete", id: String(subj[1]!.id), base: String(subj[1]!._rev ?? "") },
    ]);
    const cam = arr((await req(`${app}/api/data/masters.campuses`, { headers: principal })).body.rows).map(obj);
    const last = await post("masters.campuses", principal, [{ op: "delete", id: String(cam[0]!.id), base: String(cam[0]!._rev ?? "") }]);
    const subjAfter = arr((await req(`${app}/api/data/masters.subjects?limit=1000`, { headers: principal })).body.rows).length;
    const camAfter = arr((await req(`${app}/api/data/masters.campuses`, { headers: principal })).body.rows).length;
    const many = await post("masters.subjects", principal, Array.from({ length: 501 }, (_, i) => ({ op: "upsert", id: `x${i}`, base: null, row: {} })));
    record(
      "masters: two removals in one request → 400; removing the only campus → 400; 501 ops → 400; nothing removed",
      two.status === 400 && last.status === 400 && many.status === 400 && subjAfter === subj.length && cam.length === 1 && camAfter === 1,
      `two ${two.status} ${short(two.body.message)}; last ${last.status} ${short(last.body.message)}; 501 ${many.status}; subjects ${subj.length} → ${subjAfter}; campuses ${cam.length} → ${camAfter}`,
    );
  }

  // Put back: the accountant assignment, the other member's address.
  await pushRbac(false);
  {
    const left = (await rest(`rbac_desk_slices?tenant_id=eq.${tenantId}&slice_key=eq.assignments&select=payload`))[0];
    const still = arr(obj(left).payload).map(obj).filter((g) => g.id === ACC_ASSIGN);
    record("put back: the accountant assignment is removed again", still.length === 0, `left ${still.length}`);
    await patch(`sis_staff?id=eq.${otherOriginal.id}&tenant_id=eq.${tenantId}`, { profile: otherOriginal.profile, updated_at: new Date().toISOString() });
    const back = await staffRow(String(otherOriginal.id));
    record("put back: the other member's record exactly as found", JSON.stringify(prof(back)) === JSON.stringify(prof(otherOriginal)), "");
  }

  // The target's whole record exactly as it was found (profile, mobile).
  {
    await patch(`sis_staff?id=eq.${TARGET}&tenant_id=eq.${tenantId}`, {
      profile: original.profile,
      mobile: original.mobile,
      email: original.email,
      updated_at: new Date().toISOString(),
    });
    const r = await staffRow();
    record(
      "put back: the target's profile and mobile exactly as found",
      JSON.stringify(prof(r)) === JSON.stringify(originalProfile) && r.mobile === original.mobile && r.email === original.email && r.deleted_at === null,
      `${Object.keys(prof(r)).length} profile keys`,
    );
  }

  // ── F. A teacher's own-class class subject (function grant) ────────────
  {
    const mine = { classId: classId(1), subjectId: "e2e_sub_eng", isActive: true, periodsPerWeek: 1, isOptional: false };
    const theirs = { ...mine, classId: classId(2) };
    const w = await post("masters.class-subjects", teacher, [{ op: "upsert", id: "e2e_22b_link_mine", base: null, row: mine }]);
    const rev = String(obj(w.body.versions).e2e_22b_link_mine ?? "");
    const x = await post("masters.class-subjects", teacher, [{ op: "upsert", id: "e2e_22b_link_theirs", base: null, row: theirs }]);
    const off = await post("masters.subjects", teacher, [{ op: "upsert", id: "e2e_22b_subject", base: null, row: { nameEn: "No" } }]);
    const del = await post("masters.class-subjects", teacher, [{ op: "delete", id: "e2e_22b_link_mine", base: rev }]);
    record(
      "function grant: a teacher adds and removes a class subject in HER class (200); another class → 403; the subject list → 403",
      w.status === 200 && x.status === 403 && off.status === 403 && del.status === 200,
      `mine ${w.status} ${w.status === 200 ? "" : short(w.body)}, theirs ${x.status} ${short(x.body.message)}, subjects ${off.status}, remove ${del.status}`,
    );
  }

  const failed = outcomes.filter((o) => !o.ok);
  console.log(`\n${outcomes.length - failed.length}/${outcomes.length} passed (data-layer 2.2b)`);
  if (failed.length) {
    console.log("failed:");
    for (const f of failed) console.log(`  - ${f.name}: ${f.detail}`);
    process.exit(1);
  }
}

main().catch((err: unknown) => {
  console.error(err instanceof Error ? err.stack || err.message : err);
  process.exit(1);
});
