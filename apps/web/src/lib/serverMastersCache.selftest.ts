/**
 * Run: npx tsx src/lib/serverMastersCache.selftest.ts
 *
 * loadServerMasters and loadServerRbac (lib/api/v1/auth.ts) — every /api/v1
 * request resolves the session through them — run against a fake PostgREST
 * (no database), with the change signal erp_versions faked as an RPC.
 *
 * data-layer 0.5c (kept): a failed read never becomes data —
 *  - a failed refresh keeps the previous copy; the next request tries again;
 *  - with no previous copy it is a 503 — never defaultMasters(), a demo book
 *    with freshly random class ids;
 *  - concurrent misses on a cold instance do ONE read, not N;
 *  - a 503 stays a 503 through the auth wrappers (not a 401 sign-out);
 *  - a failed roster read with no copy serves masters without a roster, uncached;
 *  - no database configured (a local demo) is not a failure.
 * data-layer 1.3 (new): the copy is keyed on erp_versions, not a 30 s clock —
 *  - a Masters write (masters_desk_sync_meta.updated_at moves) = the next call
 *    rebuilds, exactly once;
 *  - a staff write (sis_staff count / max(updated_at) moves) = one rebuild;
 *  - no change = no rebuild, even 31 s and 10 minutes on;
 *  - invalidateServerMastersCache / invalidateServerRbacCache = the next read
 *    rebuilds even though nothing moved;
 *  - RBAC the same way, keyed on the rbac desk and the legacy rbac_state blob.
 */
import assert from "node:assert/strict";
import { installFakePostgrest, installServerOnlyStub } from "./fakePostgrest.testkit";

installServerOnlyStub();
const pg = installFakePostgrest();

const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;
/** Past the 2 s versions window, so the next read asks erp_versions again. */
const nextWindow = (ms = 2_100) => {
  clock += ms;
};

const quiet = { log: console.log, error: console.error, warn: console.warn };
const logs: string[] = [];
console.log = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
console.error = (...a: unknown[]) => void logs.push(a.map(String).join(" "));
console.warn = (...a: unknown[]) => void logs.push(a.map(String).join(" "));

type V = { updated_at: string | null; count: number | null };
const versions: Record<string, V> = {
  masters: { updated_at: "2026-10-13T00:00:00Z", count: 1 },
  sis_staff: { updated_at: "2026-10-13T00:00:00Z", count: 0 },
  sis_departments: { updated_at: null, count: 0 },
  sis_designations: { updated_at: null, count: 0 },
  rbac: { updated_at: "2026-10-13T00:00:00Z", count: 1 },
  rbac_state: { updated_at: null, count: 0 },
  fee: { updated_at: "2026-10-13T00:00:00Z", count: 100 },
};
let versionsDown = false;
pg.rpc.erp_versions = () => {
  if (versionsDown) throw new Error("function erp_versions(uuid) does not exist");
  return versions;
};

const goodSlices = [
  {
    tenant_id: "t",
    slice_key: "classes",
    payload: [{ id: "cls_real_1", name: "Class 1", sortOrder: 1, isActive: true }],
    updated_at: "2026-10-13T00:00:00Z",
  },
];
const officeRole = {
  id: "role_office_custom",
  code: "office_custom",
  name: "Office (custom)",
  grants: [],
};

void (async () => {
  try {
    const {
      loadServerMasters,
      invalidateServerMastersCache,
      loadServerRbac,
      loadServerRbacIfKnown,
      invalidateServerRbacCache,
    } = await import("./api/v1/auth");
    const { ApiError, authFailureStatus } = await import("./api/v1/errors");
    const reads = () => pg.count("masters_desk_slices");

    // ── Cold instance, failed read: 503, not demo masters.
    pg.tables.masters_desk_slices = { error: "canceling statement due to statement timeout" };
    await assert.rejects(
      loadServerMasters(),
      (e: unknown) => e instanceof ApiError && e.status === 503,
      "no copy + failed read = 503",
    );
    assert.equal(authFailureStatus(new ApiError("server_error", "x", 503)), 503, "the auth wrappers keep the 503");
    assert.equal(authFailureStatus(new ApiError("unauthorized", "x", 401)), 401);
    assert.equal(authFailureStatus(new Error("boom")), 401);

    // ── Cold instance, five concurrent misses: one read.
    pg.tables.masters_desk_slices = goodSlices;
    const before = reads();
    const release = pg.hold("masters_desk_slices");
    const many = Array.from({ length: 5 }, () => loadServerMasters());
    await new Promise((r) => setTimeout(r, 50));
    release();
    const states = await Promise.all(many);
    assert.equal(reads() - before, 1, "five concurrent misses share one read");
    for (const s of states) assert.deepEqual(s.classes.map((c) => c.id), ["cls_real_1"]);

    // ── No change = no rebuild: not within the window, not after 31 s, not after 10 minutes.
    const n = reads();
    await loadServerMasters();
    nextWindow(31_000);
    await loadServerMasters();
    nextWindow(10 * 60_000);
    await loadServerMasters();
    assert.equal(reads(), n, "unchanged versions: no re-read, however long (the 30 s TTL is gone)");
    const rpcBefore = pg.log.filter((l) => l === "POST rpc/erp_versions").length;
    await Promise.all([loadServerMasters(), loadServerMasters(), loadServerRbac()]);
    assert.equal(
      pg.log.filter((l) => l === "POST rpc/erp_versions").length,
      rpcBefore,
      "inside one window every cache shares the one versions read",
    );

    // ── A Masters write (masters_desk_sync_meta.updated_at moves): the next call rebuilds, exactly once.
    pg.tables.masters_desk_slices = [
      { ...goodSlices[0], payload: [...goodSlices[0].payload, { id: "cls_real_2", name: "Class 2", sortOrder: 2, isActive: true }] },
    ];
    versions.masters = { updated_at: "2026-10-13T01:00:00Z", count: 2 };
    const inWindow = await loadServerMasters();
    assert.deepEqual(inWindow.classes.map((c) => c.id), ["cls_real_1"], "inside the 2 s window the held versions still stand");
    nextWindow();
    logs.length = 0;
    const fresh = await loadServerMasters();
    assert.deepEqual(fresh.classes.map((c) => c.id), ["cls_real_1", "cls_real_2"], "the write is seen on the next call");
    assert.equal(reads(), n + 1, "one rebuild");
    assert.ok(logs.some((l) => l.includes("[reference-cache] masters rebuilt (moved: masters)")), logs.join(" | "));
    await loadServerMasters();
    nextWindow();
    await loadServerMasters();
    assert.equal(reads(), n + 1, "…and only one");

    // ── Another desk moving (fees) does not rebuild Masters.
    versions.fee = { updated_at: "2026-10-13T02:00:00Z", count: 101 };
    nextWindow();
    await loadServerMasters();
    assert.equal(reads(), n + 1, "a fee write does not rebuild Masters");

    // ── A staff write (only the count moves, as on a delete) rebuilds with the new roster.
    pg.tables.sis_staff = [
      { id: "stf_1", tenant_id: "t", full_name: "A Teacher", status: "active", updated_at: "2026-10-13T00:00:00Z" },
    ];
    versions.sis_staff = { updated_at: "2026-10-13T00:00:00Z", count: 1 };
    nextWindow();
    const withStaff = await loadServerMasters();
    assert.equal(reads(), n + 2, "a roster change rebuilds Masters");
    assert.equal((withStaff.staff ?? []).length, 1, "the rebuilt copy carries the roster");

    // ── Changed + failed refresh: the previous copy, and the next call tries again.
    versions.masters = { updated_at: "2026-10-13T03:00:00Z", count: 2 };
    pg.tables.masters_desk_slices = { error: "connection reset" };
    nextWindow();
    const kept = await loadServerMasters();
    assert.deepEqual(kept.classes.map((c) => c.id), ["cls_real_1", "cls_real_2"], "a failed refresh keeps the real classes");
    const afterFail = reads();
    await loadServerMasters();
    assert.equal(reads(), afterFail + 1, "the kept copy is not marked current: the next call re-reads");

    // ── Recovery: the next good read replaces the copy.
    pg.tables.masters_desk_slices = [{ ...goodSlices[0], payload: [{ id: "cls_real_3", name: "Class 3", sortOrder: 3, isActive: true }] }];
    const recovered = await loadServerMasters();
    assert.deepEqual(recovered.classes.map((c) => c.id), ["cls_real_3"]);

    // ── A failed staff-roster read keeps the previous copy too.
    versions.sis_staff = { updated_at: "2026-10-13T04:00:00Z", count: 1 };
    pg.tables.sis_staff = { error: "timeout" };
    nextWindow();
    const keptRoster = await loadServerMasters();
    assert.deepEqual(keptRoster.classes.map((c) => c.id), ["cls_real_3"], "roster failure: previous copy kept");
    assert.equal((keptRoster.staff ?? []).length, 1, "…with its roster");

    // ── invalidateServerMastersCache: the next read rebuilds although nothing moved; no copy + failure = 503.
    pg.tables.sis_staff = [];
    pg.tables.masters_desk_slices = goodSlices;
    await loadServerMasters();
    const beforeInv = reads();
    invalidateServerMastersCache();
    await loadServerMasters();
    assert.equal(reads(), beforeInv + 1, "an invalidation forces the next read to rebuild");
    invalidateServerMastersCache();
    pg.tables.masters_desk_slices = { error: "timeout" };
    await assert.rejects(loadServerMasters(), (e: unknown) => e instanceof ApiError && e.status === 503);

    // ── No copy + roster unreadable: masters served without a roster, and not stored.
    pg.tables.masters_desk_slices = goodSlices;
    pg.tables.sis_staff = { error: "timeout" };
    const noRoster = await loadServerMasters();
    assert.deepEqual(noRoster.classes.map((c) => c.id), ["cls_real_1"]);
    assert.equal((noRoster.staff ?? []).length, 0, "no roster, not a made-up one");
    const r0 = reads();
    await loadServerMasters();
    assert.equal(reads(), r0 + 1, "the roster-less answer was not stored: the next call re-reads");
    pg.tables.sis_staff = [];

    // ── Versions unreadable (RPC missing): rebuilt at most once per 2 s window, never an error by itself.
    versionsDown = true;
    nextWindow();
    const u0 = reads();
    await loadServerMasters();
    await loadServerMasters();
    await loadServerMasters();
    assert.equal(reads(), u0 + 1, "versions unknown: one rebuild per window, not per request");
    nextWindow();
    await loadServerMasters();
    assert.equal(reads(), u0 + 2);
    versionsDown = false;

    // ── RBAC: cold read, no change = no re-read, a move = one rebuild, invalidation, failure keeps the copy.
    pg.tables.rbac_desk_slices = [
      { tenant_id: "t", slice_key: "roles", payload: [officeRole], updated_at: "2026-10-13T00:00:00Z" },
      { tenant_id: "t", slice_key: "assignments", payload: [], updated_at: "2026-10-13T00:00:00Z" },
    ];
    pg.tables.rbac_desk_sync_meta = [{ tenant_id: "t", slice_count: 2, row_count: 1, updated_at: "2026-10-13T00:00:00Z" }];
    nextWindow();
    invalidateServerRbacCache();
    const rbacReads = () => pg.count("rbac_desk_slices");
    const rb0 = rbacReads();
    const known = await loadServerRbacIfKnown();
    assert.ok(known && known.roles.some((r) => r.code === "office_custom"), "the saved role set is known");
    nextWindow(31_000);
    await loadServerRbac();
    nextWindow();
    await loadServerRbac();
    assert.equal(rbacReads(), rb0 + 1, "no rbac change: no re-read after 31 s");
    const probeReadsBefore = pg.log.filter((l) => l === "GET rbac_desk_sync_meta").length;
    nextWindow();
    await loadServerRbac();
    assert.equal(
      pg.log.filter((l) => l === "GET rbac_desk_sync_meta").length,
      probeReadsBefore,
      "the 5 s rbac_desk_sync_meta probe is gone (the versions read replaces it)",
    );

    versions.rbac = { updated_at: "2026-10-13T05:00:00Z", count: 1 };
    nextWindow();
    await loadServerRbac();
    assert.equal(rbacReads(), rb0 + 2, "an rbac write = one rebuild");
    await loadServerRbac();
    assert.equal(rbacReads(), rb0 + 2);

    // A failed rebuild keeps the known copy (its denies included).
    versions.rbac = { updated_at: "2026-10-13T06:00:00Z", count: 1 };
    pg.tables.rbac_desk_slices = { error: "timeout" };
    nextWindow();
    const keptRbac = await loadServerRbacIfKnown();
    assert.ok(keptRbac && keptRbac.roles.some((r) => r.code === "office_custom"), "failed rbac rebuild keeps the known copy");

    // Invalidation drops it: with the read still failing, the roles are unknown (defaults, IfKnown null).
    invalidateServerRbacCache();
    assert.equal(await loadServerRbacIfKnown(), null, "no copy + failed read = unknown, never defaults-as-known");
    const defaults = await loadServerRbac();
    assert.ok(Array.isArray(defaults.roles) && defaults.roles.length > 0, "loadServerRbac still answers with the built-in defaults");

    // An empty desk falls back to the legacy blob; the blob is one of the cache's keys.
    pg.tables.rbac_desk_slices = [];
    pg.tables.rbac_state = [{ tenant_id: "t", state: { version: 1, roles: [officeRole], assignments: [] } }];
    versions.rbac_state = { updated_at: "2026-10-13T07:00:00Z", count: 1 };
    nextWindow();
    const fromBlob = await loadServerRbacIfKnown();
    assert.ok(fromBlob && fromBlob.roles.some((r) => r.code === "office_custom"), "empty desk → legacy rbac_state blob");
    pg.tables.rbac_state = [];
    versions.rbac_state = { updated_at: "2026-10-13T08:00:00Z", count: 0 };
    nextWindow();
    assert.equal(await loadServerRbacIfKnown(), null, "no saved role set anywhere = not known (#574)");

    // ── No database configured (a local demo): an empty book, not a 503.
    invalidateServerMastersCache();
    delete process.env.SUPABASE_SERVICE_ROLE_KEY;
    delete process.env.NEXT_PUBLIC_SUPABASE_URL;
    const demo = await loadServerMasters();
    assert.ok(Array.isArray(demo.classes), "no database: masters answer without throwing");
    assert.equal(await loadServerRbacIfKnown(), null, "no database: roles are not known");

    Date.now = realNow;
    Object.assign(console, quiet);
    console.log("serverMastersCache selftest: ok");
    process.exit(0);
  } catch (e) {
    Object.assign(console, quiet);
    console.error(e);
    console.error(logs.slice(-30).join("\n"));
    process.exit(1);
  }
})();
