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
  const staffRow = async (id = TARGET) => (await rest(`sis_staff?id=eq.${id}&tenant_id=eq.${tenantId}&select=*`))[0] ?? {};
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

  // ── A. Readers hide a removed member (marked in the database directly) ──
  {
    const before = { roster: await inRoster(office), list: await inStaffList(office), mobile: await inMobile(principal) };
    const selfBefore = (await req(`${app}/api/data/views/staff-list`, { headers: removedSelf })).status;
    await patch(`sis_staff?id=eq.${TARGET}&tenant_id=eq.${tenantId}`, {
      deleted_at: new Date().toISOString(),
      deleted_by: "acceptance",
      updated_at: new Date().toISOString(),
    });
    await sleep(300);
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
    await sleep(300);
    const back = { roster: await inRoster(office), list: await inStaffList(office), mobile: await inMobile(principal) };
    const selfBack = (await req(`${app}/api/data/views/staff-list`, { headers: removedSelf })).status;
    record(
      "readers: cleared → back in every list, and they can sign in again",
      back.roster && back.list && back.mobile.has && selfBack === 200,
      `${back.roster}/${back.list}/${back.mobile.has}, self ${selfBack}`,
    );
  }

  // ── B. The sensitive route ──────────────────────────────────────────────
  const sens = (who: Record<string, string>, ops: unknown[]) =>
    req(`${app}/api/data/sis.staff/sensitive`, { method: "POST", headers: who, body: { ops } });
  const SEED = { bankAccountNo: "E2E-ACCT-0025", panNo: "E2EPN0025F", aadhaarNo: "999988887777", basicPay: "31000" };
  {
    const r0 = await staffRow();
    const t = await sens(teacher, [{ id: TARGET, base: r0.updated_at, fields: { bankAccountNo: "TEACHER" } }]);
    const p = await sens(principal, [{ id: TARGET, base: r0.updated_at, fields: SEED }]);
    const r1 = await staffRow();
    const log = await rest(`sis_staff_sensitive_changes?staff_id=eq.${TARGET}&tenant_id=eq.${tenantId}&order=changed_at.desc&limit=1&select=fields,authority,actor`);
    record(
      "sensitive route: teacher → 403; principal (payroll · edit) → 200, written; recorded with authority and the session as actor, field names only",
      t.status === 403 && p.status === 200 && prof(r1).bankAccountNo === SEED.bankAccountNo && prof(r1).panNo === SEED.panNo &&
        obj(log[0]).authority === "payroll" && obj(log[0]).actor === fx.sessions.principal.staffId &&
        JSON.stringify(obj(log[0]).fields) === JSON.stringify(["aadhaarNo", "bankAccountNo", "basicPay", "panNo"]) &&
        !JSON.stringify(log).includes(SEED.bankAccountNo) && prof(r1).addressCurrent === originalProfile.addressCurrent,
      `teacher ${t.status} ${short(t.body.message)}; principal ${p.status} ${p.status === 200 ? "" : short(p.body)}; log ${short(log)}`,
    );
    const stale = await sens(principal, [{ id: TARGET, base: r0.updated_at, fields: { panNo: "STALE" } }]);
    const other = await sens(principal, [{ id: TARGET, base: r1.updated_at, fields: { fullName: "X" } }]);
    const login = await sens(principal, [{ id: TARGET, base: r1.updated_at, fields: { loginUsername: "someone.else" } }]);
    const r2 = await staffRow();
    record(
      "sensitive route: stale base → 409; a non-protected field → 400; a login username by a non-owner → 403; nothing written",
      stale.status === 409 && other.status === 400 && login.status === 403 && r2.updated_at === r1.updated_at && prof(r2).panNo === SEED.panNo,
      `stale ${stale.status}, other ${other.status}, login ${login.status} ${short(login.body.message)}`,
    );
  }

  // ── C. POST /api/data/sis.staff: protected keys never change here ─────────
  {
    const r1 = await staffRow();
    const asRead = { ...prof(r1) };
    delete asRead.loginPassword;
    const bank = await post("sis.staff", principal, [{ op: "upsert", id: TARGET, base: r1.updated_at, row: { profile: { ...asRead, bankAccountNo: "CHANGED" } } }]);
    const pan = await post("sis.staff", principal, [{ op: "upsert", id: TARGET, base: r1.updated_at, row: { profile: { ...asRead, panNo: "" } } }]);
    const login = await post("sis.staff", principal, [{ op: "upsert", id: TARGET, base: r1.updated_at, row: { profile: { ...asRead, loginUsername: "director@bhbinternational.school" } } }]);
    const rA = await staffRow();
    record(
      "sis.staff: bank change / PAN blanking / login username → 403 even for the principal; nothing written",
      bank.status === 403 && pan.status === 403 && login.status === 403 && rA.updated_at === r1.updated_at,
      `bank ${bank.status} ${short(bank.body.message)}; pan ${pan.status}; login ${login.status}`,
    );
    const slim = await post("sis.staff", office, [
      { op: "upsert", id: TARGET, base: r1.updated_at, row: { mobile: "9000000099", profile: { fullName: targetRec.fullName, mobile: "9000000099" } } },
    ]);
    const rB = await staffRow();
    record(
      "sis.staff: a profile without the protected keys is not a blanking — they are kept; the edit lands",
      slim.status === 200 && rB.mobile === "9000000099" && prof(rB).bankAccountNo === SEED.bankAccountNo && prof(rB).panNo === SEED.panNo &&
        prof(rB).basicPay === SEED.basicPay,
      `HTTP ${slim.status} ${slim.status === 200 ? "" : short(slim.body)}; bank ${short(prof(rB).bankAccountNo)}`,
    );
    const stale = await post("sis.staff", office, [{ op: "upsert", id: TARGET, base: r1.updated_at, row: { mobile: "9000000001" } }]);
    const c = obj(arr(stale.body.conflicts)[0]);
    const leaked = SENSITIVE.filter((k) => k in obj(obj(c.stored).profile));
    record(
      "sis.staff: a stale write → 409; its stored row carries no bank / UPI / Aadhaar / PAN / pay / login",
      stale.status === 409 && c.reason === "stale" && obj(c.stored).full_name === targetRec.fullName && leaked.length === 0 &&
        !JSON.stringify(stale.body).includes(SEED.bankAccountNo),
      `HTTP ${stale.status} reason ${String(c.reason)}; leaked ${short(leaked)}`,
    );
    // Put the mobile back.
    await post("sis.staff", office, [{ op: "upsert", id: TARGET, base: rB.updated_at, row: { mobile: original.mobile, profile: { mobile: original.mobile } } }]);
  }

  // ── D. Remove through the kernel: soft, by the session, restorable ──────
  {
    const r0 = await staffRow();
    const officeDel = await post("sis.staff", office, [{ op: "delete", id: TARGET, base: r0.updated_at }]);
    const del = await post("sis.staff", principal, [{ op: "delete", id: TARGET, base: r0.updated_at, by: "someone-else" }]);
    const r1 = await staffRow();
    await sleep(300);
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
    await sleep(300);
    record(
      "restore: blind → 409; with the removed row's revision → 200, deleted_by cleared, back in every list",
      blind.status === 409 && restore.status === 200 && r2.deleted_at === null && r2.deleted_by === null &&
        (await inRoster(office)) && (await inStaffList(office)) && (await inMobile(principal)).has,
      `blind ${blind.status}, restore ${restore.status} ${restore.status === 200 ? "" : short(restore.body)}`,
    );
  }

  // ── E. The OLD staff-roster save and DELETE ──────────────────────────────
  {
    const deny = (module: string) => ({
      id: `e2e_deny_${module}`, staffId: fx.sessions.office.staffId, denyModule: module, effect: "deny", actions: ["edit"],
      note: "2.2b acceptance", grantedBy: "acceptance", grantedAt: new Date().toISOString(), expiresOn: "",
    });
    const pushRbac = async (userGrants: unknown[]) => {
      const r = await pushDeskSliceToDb("rbac", { ...fx.rbac, userGrants } as never);
      if (!(r as { ok?: boolean }).ok) throw new Error(`rbac push failed: ${short(r)}`);
      await sleep(400);
    };
    const rosterNow = async () => {
      const g = await req(`${app}/api/school-data/staff-roster`, { headers: office });
      const me = arr(g.body.staff).map(obj).find((s) => s.id === TARGET)!;
      const stamp = String(obj(obj(g.body.stamps).staff)[TARGET] ?? "");
      return { me, stamp };
    };
    const save = (rec: Record<string, unknown>, stamp: string) =>
      req(`${app}/api/school-data/staff-roster`, {
        method: "POST",
        headers: office,
        body: { state: { staff: [rec] }, stamps: { staff: { [TARGET]: stamp } } },
      });
    try {
      await pushRbac([deny("payroll"), deny("accounts")]);
      const a = await rosterNow();
      const bank = await save({ ...a.me, bankAccountNo: "OLD-ROUTE" }, a.stamp);
      const rA = await staffRow();
      const mob = await save({ ...a.me, mobile: "9000000098" }, a.stamp);
      const rB = await staffRow();
      record(
        "old staff-roster save: a plain staff editor's bank change → 403, nothing written; a mobile change → 200 (bank kept)",
        bank.status === 403 && prof(rA).bankAccountNo === SEED.bankAccountNo,
        `bank ${bank.status} ${short(bank.body.error)}; mobile ${mob.status}; stored bank ${short(prof(rB).bankAccountNo)}`,
      );
      record(
        "old staff-roster save: the plain edit lands",
        mob.status === 200 && rB.mobile === "9000000098" && prof(rB).bankAccountNo === SEED.bankAccountNo,
        `mobile ${mob.status} ${short(mob.body)}`,
      );
    } finally {
      await pushRbac([]);
    }
    const b = await rosterNow();
    const back = await save({ ...b.me, mobile: String(original.mobile ?? ""), bankAccountNo: SEED.bankAccountNo }, b.stamp);
    const withAuth = await (async () => {
      const c = await rosterNow();
      return save({ ...c.me, bankAccountNo: "PAYROLL-OK" }, c.stamp);
    })();
    const rC = await staffRow();
    record(
      "old staff-roster save: with the payroll authority (office role) the bank change lands",
      back.status === 200 && withAuth.status === 200 && prof(rC).bankAccountNo === "PAYROLL-OK",
      `put back ${back.status}, with authority ${withAuth.status} ${short(withAuth.body)}`,
    );

    // DELETE: a soft remove of the roster.
    const countAll = async () => ({
      staff: (await rest(`sis_staff?tenant_id=eq.${tenantId}&select=id`)).length,
      removed: (await rest(`sis_staff?tenant_id=eq.${tenantId}&deleted_at=not.is.null&select=id,deleted_by`)),
      deps: (await rest(`sis_departments?tenant_id=eq.${tenantId}&select=id`)).length,
      des: (await rest(`sis_designations?tenant_id=eq.${tenantId}&select=id`)).length,
    });
    const c0 = await countAll();
    const wipe = await req(`${app}/api/school-data/staff-roster`, { method: "DELETE", headers: principal });
    const c1 = await countAll();
    // Put every row back exactly as it was before (only these rows were removed now).
    const ids = c1.removed.map((r) => String(r.id));
    if (ids.length) {
      await patch(`sis_staff?tenant_id=eq.${tenantId}&id=in.(${ids.join(",")})`, { deleted_at: null, deleted_by: null, updated_at: new Date().toISOString() });
    }
    const c2 = await countAll();
    record(
      "old staff-roster DELETE: soft — every staff row kept with deleted_at + deleted_by (the session); departments and designations untouched; restored",
      wipe.status === 200 && c1.staff === c0.staff && c0.removed.length === 0 && c1.removed.length === c0.staff &&
        c1.removed.every((r) => r.deleted_by === fx.sessions.principal.staffId) && c1.deps === c0.deps && c1.des === c0.des &&
        c2.removed.length === 0 && c2.staff === c0.staff,
      `HTTP ${wipe.status} ${short(wipe.body)}; staff ${c0.staff} → ${c1.staff} (removed ${c1.removed.length}); deps ${c0.deps} → ${c1.deps}; des ${c0.des} → ${c1.des}; after restore removed ${c2.removed.length}`,
    );
  }

  // Put the target's protected fields back as seeded (the owner-less way: payroll).
  {
    const r = await staffRow();
    const fields: Record<string, unknown> = {};
    for (const k of ["bankAccountNo", "panNo", "aadhaarNo", "basicPay"]) fields[k] = originalProfile[k] ?? "";
    const w = await sens(principal, [{ id: TARGET, base: r.updated_at, fields }]);
    const r2 = await staffRow();
    await post("sis.staff", office, [{ op: "upsert", id: TARGET, base: r2.updated_at, row: { mobile: original.mobile, profile: { mobile: original.mobile } } }]);
    record("put back: the target's bank / PAN / Aadhaar / pay as seeded", w.status === 200, `HTTP ${w.status}`);
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
