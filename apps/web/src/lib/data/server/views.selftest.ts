/**
 * Run: npx tsx src/lib/data/server/views.selftest.ts
 *
 * data-layer 1.4 — the reference views (lib/data/server/views.ts) and the
 * shared Masters access rule (lib/mastersReadScope.server.ts):
 *  - resolveMastersReadScope: the masters-desk rule — the Masters grant =
 *    full; any other staff session = the teaching subset (never a 403);
 *    a parent, a missing session, a guard read failure = the guard's answer;
 *    the mirror secret never gets the teaching subset;
 *  - the auth matrix of every view: no session 401, a parent 403, the mirror
 *    secret 403 (the views are for signed-in staff; nothing reads the
 *    mirror), a guard 503 stays 503;
 *  - masters: office (grant) = the whole book without the staff roster; a
 *    teacher = the teaching subset (classes/sections/subjects/links, fee
 *    lists empty, no roster); no copy = 503 {ok:false} with no data; a stale
 *    copy says stale and sends no versions; a fresh one sends the versions it
 *    was built from;
 *  - staff-list: an allow list — a record carrying a login password, Aadhaar,
 *    a mobile, pay, bank details, unknown profile keys or extra keys inside a
 *    link sends none of them; Masters read but the roster not (a fallback)
 *    = 503, never an empty list;
 *  - rbac: Settings view = the whole desk; other staff = every role, their own
 *    assignments and grants, no audit; a guard 401/503 passes through;
 *  - module-registry: any staff; booleans only; no copy = 503;
 *  - the real route files, through the real guards by API key against a fake
 *    PostgREST: 200 and the data; a profile-blob password never leaves; no
 *    credentials = 401; a valid mirror secret = 403.
 */
import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { existsSync } from "node:fs";
import { resolve } from "node:path";
import { NextResponse } from "next/server";
import { installFakePostgrest, installServerOnlyStub } from "../../fakePostgrest.testkit";

installServerOnlyStub();
const pg = installFakePostgrest();
process.env.MIRROR_SYNC_SECRET = "mirror-secret-for-selftest";

const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;

const quiet = { log: console.log, error: console.error, warn: console.warn };
const logs: string[] = [];
console.log = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
console.error = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
console.warn = (...a: unknown[]) => void logs.push(a.map(String).join(" "));

const V = (u: string, c: number | null = 1) => ({ updated_at: u, count: c });

void (async () => {
  try {
    const views = await import("./views");
    const { resolveMastersReadScope } = await import("../../mastersReadScope.server");
    const { emptyMastersShell } = await import("../../masters");
    const { normalizeStaffRecord } = await import("../../foundationMasters");
    type Deps = import("./views").ViewDeps;
    type RouteAuthResult = import("../../apiRouteAuth.server").RouteAuthResult;

    // ── Fakes ──────────────────────────────────────────────────────────────
    const fail = (status: number, error: string): RouteAuthResult => ({ ok: false, response: NextResponse.json({ error }, { status }) });
    const staffCtx = (roleCode: string, staffId: string, persona: "staff" | "parent" = "staff") =>
      ({
        ok: true,
        viaMirrorSecret: false,
        ctx: {
          session: { persona, fullName: "X", roleCode, staffId, tenantSlug: "t", academicYearCode: "2026-27" },
          masters: emptyMastersShell(),
          rbac: { version: 1, roles: [], assignments: [], audit: [], userGrants: [] },
          authKind: "session",
        },
      }) as unknown as RouteAuthResult;

    const masters = {
      ...emptyMastersShell(),
      classes: [{ id: "c5", name: "V", sortOrder: 8, isActive: true }],
      sections: [{ id: "s5", classId: "c5", name: "A", isActive: true }],
      subjects: [{ id: "sub1", code: "MATH", nameEn: "Mathematics" }],
      classSubjects: [{ id: "cs1", classId: "c5", subjectId: "sub1", periodsPerWeek: 6, isActive: true, isOptional: false }],
      feeHeads: [{ id: "fh1", name: "Tuition" }],
      concessionGrants: [{ id: "g1", householdId: "hh1" }],
      departments: [{ id: "d1", code: "ACAD", name: "Academics", isActive: true }],
      designations: [{ id: "g1", code: "TGT", name: "TGT", departmentId: "d1", isActive: true }],
      staff: [
        normalizeStaffRecord({
          id: "stf_1",
          empCode: "E1",
          fullName: "Asha Rao",
          departmentId: "d1",
          designationId: "g1",
          status: "active",
          mobile: "9876543210",
          aadhaarNo: "123412341234",
          panNo: "ABCDE1234F",
          basicPay: "41000",
          bankAccountNo: "000111222333",
          loginPassword: "plain-text-password",
          classTeacherLinks: [{ id: "ct1", classId: "c5", sectionId: "s5", academicYearCode: "2026-27", isPrimary: true }],
          subjectTeachingLinks: [
            { id: "st1", classId: "c5", sectionId: "s5", subjectId: "sub1", academicYearCode: "2026-27", periodsPerWeek: 6, salaryNote: "LEAKME" } as never,
          ],
          dutyLinks: [{ id: "du1", role: "exam_incharge", label: "Exams", academicYearCode: "2026-27", notes: "home phone 98765" }],
          vehicleLinks: [],
          ...({ profileExtraSecret: "LEAKME-too" } as object),
        }),
      ],
    } as unknown as import("../../masters").MastersState;

    const builtFrom = { masters: V("m1", 1), sis_staff: V("s1", 1), sis_departments: V("d", 1), sis_designations: V("g", 1) };
    type Read<T> = import("./referenceCache").CacheRead<T>;
    let mastersRead: Read<typeof masters> = { ok: true, value: masters, stale: false, from: "cache", builtFrom };
    let rbacRead: Read<{ state: import("../../rbac").RbacState; known: boolean }> = {
      ok: true,
      value: {
        state: {
          version: 1,
          roles: [{ id: "r1", code: "teacher", name: "Teacher", grants: [] }],
          assignments: [
            { id: "a1", staffId: "stf_1", roleId: "r1" },
            { id: "a2", staffId: "stf_2", roleId: "r1" },
          ],
          userGrants: [{ id: "u2", staffId: "stf_2" }],
          audit: [{ id: "au1", at: "x" }],
        } as unknown as import("../../rbac").RbacState,
        known: true,
      },
      stale: false,
      from: "cache",
      builtFrom: { rbac: V("r", 1), rbac_state: V("rs", 0) },
    };
    let registryRead: Read<import("../../moduleRegistry").ModuleRegistryState> = {
      ok: true,
      value: views.moduleRegistryOf({ enabled: { hostel: false, canteen: true, junk: "yes" } }),
      stale: false,
      from: "rebuild",
      builtFrom: { module_registry: V("mr", 1) },
    };

    type Who = "none" | "parent" | "teacher" | "office" | "settings" | "guard503" | "inactive";
    let who: Who = "office";
    let mirror = false;
    const requireStaff = async (): Promise<RouteAuthResult> =>
      who === "none"
        ? fail(401, "Sign in or provide a valid API key")
        : who === "guard503"
          ? fail(503, "Could not read the school setup")
          : who === "parent" || who === "inactive"
            ? fail(403, who === "parent" ? "Staff session required" : "family inactive")
            : staffCtx(who === "teacher" ? "teacher" : "office", who === "teacher" ? "stf_1" : "stf_9");
    /** Grant held: office holds masters.view; "settings" holds settings.view too. */
    const requireGrant = (grantHolders: Who[]) => async (): Promise<RouteAuthResult> => {
      const base = await requireStaff();
      if (!base.ok) return base;
      return grantHolders.includes(who) ? base : fail(403, "Missing permission");
    };
    const deps: Deps = {
      mastersScope: (req) =>
        resolveMastersReadScope(req, { authorizeDesk: requireGrant(["office", "settings"]), requireStaff }),
      requireStaff,
      requireSettingsView: requireGrant(["settings"]),
      mirrorSecret: () => mirror,
      readMasters: async () => mastersRead,
      readRbac: async () => rbacRead,
      readModuleRegistry: async () => registryRead,
    };
    const req = new Request("https://example.test/api/data/views/x");
    const call = async (fn: (r: Request, d: Deps) => Promise<Response>) => {
      const res = await fn(req, deps);
      return { status: res.status, body: (await res.json()) as Record<string, unknown>, cc: res.headers.get("cache-control") };
    };
    const all = [views.mastersViewGet, views.staffListViewGet, views.rbacViewGet, views.moduleRegistryViewGet];

    // ── resolveMastersReadScope: the masters-desk rule.
    who = "office";
    const full = await resolveMastersReadScope(req, { authorizeDesk: requireGrant(["office"]), requireStaff });
    assert.ok(full.ok && full.scope === "full", "the Masters grant = full");
    who = "teacher";
    const teach = await resolveMastersReadScope(req, { authorizeDesk: requireGrant(["office"]), requireStaff });
    assert.ok(teach.ok && teach.scope === "teaching", "staff without the grant = the teaching subset, not 403");
    for (const [w, status] of [["parent", 403], ["none", 401], ["guard503", 503], ["inactive", 403]] as const) {
      who = w;
      const r = await resolveMastersReadScope(req, { authorizeDesk: requireGrant(["office"]), requireStaff });
      assert.ok(!r.ok && r.response.status === status, `${w}: the guard's ${status}`);
    }
    const viaMirror = await resolveMastersReadScope(req, {
      authorizeDesk: async () => fail(403, "Missing permission"),
      requireStaff: async () => ({ ...(staffCtx("admin", "") as object), viaMirrorSecret: true }) as RouteAuthResult,
    });
    assert.ok(!viaMirror.ok, "a mirror-secret context never falls to the teaching subset");
    const persona = await resolveMastersReadScope(req, {
      authorizeDesk: async () => fail(403, "Missing permission"),
      requireStaff: async () => staffCtx("parent", "", "parent"),
    });
    assert.ok(!persona.ok, "a non-staff persona never gets the teaching subset");

    // ── Auth matrix, every view.
    for (const fn of all) {
      who = "none";
      assert.equal((await call(fn)).status, 401, `${fn.name}: no session = 401`);
      who = "parent";
      const p = await call(fn);
      assert.equal(p.status, 403, `${fn.name}: a parent = 403`);
      assert.equal(p.body.ok, false);
      assert.ok(!("data" in p.body), "a refusal carries no data");
      who = "inactive";
      assert.equal((await call(fn)).status, 403, `${fn.name}: an inactive family = 403`);
      who = "guard503";
      assert.equal((await call(fn)).status, 503, `${fn.name}: the guard's 503 stays 503`);
      who = "office";
      mirror = true;
      assert.equal((await call(fn)).status, 403, `${fn.name}: the mirror sync secret = 403`);
      mirror = false;
      const ok = await call(fn);
      assert.equal(ok.status, 200, `${fn.name}: staff = 200`);
      assert.equal(ok.cc, "private, no-store", `${fn.name}: never cached by the browser`);
      who = "teacher";
      assert.equal((await call(fn)).status, 200, `${fn.name}: a teacher = 200, never 403`);
    }

    // ── masters.
    who = "office";
    const mo = await call(views.mastersViewGet);
    const moData = mo.body.data as { scope: string; masters: Record<string, unknown[]> };
    assert.equal(moData.scope, "full");
    assert.equal(moData.masters.feeHeads.length, 1, "office: fee heads");
    assert.equal(moData.masters.concessionGrants.length, 1);
    for (const k of ["staff", "departments", "designations"]) assert.ok(!(k in moData.masters), `no ${k} in the masters view`);
    assert.deepEqual(mo.body.versions, builtFrom, "a fresh copy sends what it was built from");
    assert.equal(mo.body.stale, false);
    who = "teacher";
    const mt = await call(views.mastersViewGet);
    const mtData = mt.body.data as { scope: string; masters: Record<string, unknown[]> };
    assert.equal(mtData.scope, "teaching", "a teacher: the teaching subset");
    assert.equal(mtData.masters.classes.length, 1);
    assert.equal(mtData.masters.sections.length, 1);
    assert.equal(mtData.masters.subjects.length, 1);
    assert.equal(mtData.masters.classSubjects.length, 1);
    assert.deepEqual(mtData.masters.feeHeads, [], "no money for a teacher");
    assert.deepEqual(mtData.masters.concessionGrants, [], "no concession grants (families) for a teacher");
    for (const k of ["staff", "departments", "designations"]) assert.ok(!(k in mtData.masters), `teacher: no ${k}`);
    mastersRead = { ok: true, value: masters, stale: true, from: "previous", builtFrom: null };
    const stale = await call(views.mastersViewGet);
    assert.equal(stale.status, 200);
    assert.equal(stale.body.stale, true, "a previous copy is marked stale");
    assert.equal(stale.body.versions, null, "…and claims no versions");
    mastersRead = { ok: false, error: "masters_desk_slices" };
    const m503 = await call(views.mastersViewGet);
    assert.equal(m503.status, 503, "no copy = 503");
    assert.ok(!("data" in m503.body), "…with no data — never an empty school");
    mastersRead = { ok: true, value: masters, stale: true, from: "fallback", builtFrom: null };
    assert.equal((await call(views.mastersViewGet)).status, 200, "masters view: a roster-less fallback is still a true Masters answer");

    // ── staff-list.
    const sl = await call(views.staffListViewGet);
    assert.equal(sl.status, 503, "staff-list: Masters read but the roster not = 503, never an empty list");
    assert.ok(!("data" in sl.body));
    mastersRead = { ok: true, value: masters, stale: false, from: "cache", builtFrom };
    const sl2 = await call(views.staffListViewGet);
    const list = sl2.body.data as { staff: Record<string, unknown>[]; departments: unknown[]; designations: unknown[] };
    assert.equal(list.staff.length, 1);
    assert.deepEqual(
      Object.keys(list.staff[0]!).sort(),
      [
        "classTeacherLinks", "departmentId", "departmentName", "designationId", "designationName", "dutyLinks",
        "empCode", "fullName", "id", "status", "stream", "subjectTeachingLinks", "vehicleLinks",
      ],
      "exactly the directory fields",
    );
    assert.equal(list.staff[0]!.departmentName, "Academics");
    assert.equal(list.staff[0]!.designationName, "TGT");
    const text = JSON.stringify(sl2.body);
    for (const leak of ["9876543210", "123412341234", "ABCDE1234F", "41000", "000111222333", "plain-text-password", "LEAKME", "home phone", "loginPassword", "mobile"]) {
      assert.ok(!text.includes(leak), `staff-list must not carry ${leak}`);
    }
    assert.equal(list.departments.length, 1);
    assert.equal(list.designations.length, 1);

    // ── rbac.
    who = "teacher";
    const rt = await call(views.rbacViewGet);
    const rtData = rt.body.data as { ownOnly: boolean; known: boolean; rbac: { roles: unknown[]; assignments: { staffId: string }[]; userGrants: unknown[]; audit: unknown[] } };
    assert.equal(rtData.ownOnly, true, "a teacher: own rows only");
    assert.equal(rtData.rbac.roles.length, 1, "…every role's definition");
    assert.deepEqual(rtData.rbac.assignments.map((a) => a.staffId), ["stf_1"], "…her own assignment only");
    assert.deepEqual(rtData.rbac.userGrants, []);
    assert.deepEqual(rtData.rbac.audit, [], "…no audit");
    who = "settings";
    const rs = await call(views.rbacViewGet);
    const rsData = rs.body.data as { ownOnly: boolean; rbac: { assignments: unknown[]; audit: unknown[] } };
    assert.equal(rsData.ownOnly, false, "Settings view: the whole desk");
    assert.equal(rsData.rbac.assignments.length, 2);
    assert.equal(rsData.rbac.audit.length, 1);
    who = "office";
    const settings503 = await views.rbacViewGet(req, { ...deps, requireSettingsView: async () => fail(503, "setup unreadable") });
    assert.equal(settings503.status, 503, "rbac: the Settings check failing (503) is not 'no Settings' — never answered own-only");
    rbacRead = { ok: false, error: "rbac desk read failed" };
    const r503 = await call(views.rbacViewGet);
    assert.equal(r503.status, 503, "rbac: no copy = 503, never the built-in defaults");

    // ── module-registry.
    const mr = await call(views.moduleRegistryViewGet);
    assert.deepEqual(mr.body.data, { version: 1, enabled: { hostel: false, canteen: true } }, "booleans only");
    registryRead = { ok: false, error: "module_registry desk read failed" };
    assert.equal((await call(views.moduleRegistryViewGet)).status, 503);

    // ── The real routes, through the real guards, by API key (fake PostgREST).
    const here = __dirname;
    for (const name of ["masters", "staff-list", "rbac", "module-registry"]) {
      assert.ok(existsSync(resolve(here, `../../../app/api/data/views/${name}/route.ts`)), `${name}: a static segment file`);
    }
    pg.rpc.erp_versions = () => ({
      masters: V("2026-10-14T00:00:00Z", 1),
      sis_staff: V("2026-10-14T00:00:00Z", 1),
      sis_departments: V("2026-10-14T00:00:00Z", 1),
      sis_designations: V("2026-10-14T00:00:00Z", 1),
      rbac: V("2026-10-14T00:00:00Z", 1),
      rbac_state: { updated_at: null, count: 0 },
      module_registry: V("2026-10-14T00:00:00Z", 1),
    });
    const raw = "bhb_selftest_views_key_00001";
    pg.tables.api_keys = [
      { id: "key_1", key_hash: createHash("sha256").update(raw).digest("hex"), scopes: [], is_active: true, expires_at: null },
    ];
    pg.tables.masters_desk_slices = [
      { tenant_id: "t", slice_key: "classes", payload: [{ id: "cls_1", name: "Class 1", sortOrder: 1, isActive: true }], updated_at: "2026-10-14T00:00:00Z" },
    ];
    pg.tables.sis_departments = [];
    pg.tables.sis_designations = [];
    pg.tables.sis_staff = [
      {
        id: "stf_1",
        tenant_id: "t",
        emp_code: "E1",
        full_name: "Asha Rao",
        status: "active",
        mobile: "9876543210",
        profile: { loginPassword: "profile-blob-password", aadhaarNo: "999988887777", basicPay: "52000" },
        updated_at: "2026-10-14T00:00:00Z",
      },
    ];
    pg.tables.rbac_desk_slices = [
      { tenant_id: "t", slice_key: "roles", payload: [{ id: "role_x", code: "office_custom", name: "Office", grants: [] }], updated_at: "2026-10-14T00:00:00Z" },
    ];
    pg.tables.module_registry_desk_slices = [
      { tenant_id: "t", slice_key: "enabled", payload: { hostel: false }, updated_at: "2026-10-14T00:00:00Z" },
    ];
    const auth = { headers: { authorization: `Bearer ${raw}` } };
    clock += 2_100;
    for (const name of ["masters", "staff-list", "rbac", "module-registry"]) {
      const route = (await import(`../../../app/api/data/views/${name}/route`)) as { GET: (r: Request) => Promise<Response>; runtime: string; dynamic: string };
      assert.equal(route.runtime, "nodejs");
      assert.equal(route.dynamic, "force-dynamic");
      const res = await route.GET(new Request(`https://example.test/api/data/views/${name}`, auth));
      const body = (await res.json()) as { ok: boolean; data: Record<string, unknown> };
      assert.equal(res.status, 200, `the real ${name} route by API key = 200 (${res.status} ${JSON.stringify(body).slice(0, 200)})`);
      assert.equal(body.ok, true);
      if (name === "masters") assert.equal((body.data as { scope: string }).scope, "full", "an API key (admin) reads Masters in full");
      if (name === "staff-list") {
        const t = JSON.stringify(body);
        assert.equal((body.data.staff as unknown[]).length, 1);
        for (const leak of ["profile-blob-password", "999988887777", "52000", "9876543210"]) {
          assert.ok(!t.includes(leak), `the real staff-list route must not carry ${leak} from sis_staff.profile / mobile`);
        }
      }
      if (name === "module-registry") assert.deepEqual(body.data, { version: 1, enabled: { hostel: false } });
      const anon = await route.GET(new Request(`https://example.test/api/data/views/${name}`));
      assert.equal(anon.status, 401, `the real ${name} route with no credentials = 401`);
      const viaMirrorReq = await route.GET(
        new Request(`https://example.test/api/data/views/${name}`, { headers: { "x-mirror-secret": "mirror-secret-for-selftest" } }),
      );
      assert.equal(viaMirrorReq.status, 403, `the real ${name} route refuses the mirror secret`);
    }
    assert.ok(!pg.log.some((l) => l.includes("school_mirror")), "nothing read the school mirror");

    Date.now = realNow;
    Object.assign(console, quiet);
    console.log("views selftest: ok");
    process.exit(0);
  } catch (e) {
    Object.assign(console, quiet);
    console.error(e);
    console.error(logs.slice(-30).join("\n"));
    process.exit(1);
  }
})();
