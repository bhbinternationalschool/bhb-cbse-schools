/**
 * Run: npx tsx src/lib/serverMastersCache.selftest.ts
 *
 * data-layer 0.5c. loadServerMasters (every /api/v1 request resolves the
 * session through it) must never turn a failed read into data:
 *  - a failed refresh keeps the previous copy and does not refresh its
 *    timestamp (the next request tries again);
 *  - with no previous copy it is a 503 — never defaultMasters(), a demo book
 *    with freshly random class ids;
 *  - concurrent misses on a cold instance do ONE read, not N;
 *  - a 503 stays a 503 through the auth wrappers (not a 401 sign-out).
 *
 * Runs the real loader against a fake PostgREST (no database).
 */
import assert from "node:assert/strict";
import { installFakePostgrest, installServerOnlyStub } from "./fakePostgrest.testkit";

installServerOnlyStub();
const pg = installFakePostgrest();

const realNow = Date.now;
let clock = realNow();
Date.now = () => clock;

const goodSlices = [
  {
    tenant_id: "t",
    slice_key: "classes",
    payload: [{ id: "cls_real_1", name: "Class 1", sortOrder: 1, isActive: true }],
    updated_at: "2026-10-13T00:00:00Z",
  },
];

void (async () => {
  const { loadServerMasters, invalidateServerMastersCache } = await import("./api/v1/auth");
  const { ApiError, authFailureStatus } = await import("./api/v1/errors");

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
  const before = pg.count("masters_desk_slices");
  const release = pg.hold("masters_desk_slices");
  const many = Array.from({ length: 5 }, () => loadServerMasters());
  await new Promise((r) => setTimeout(r, 50));
  release();
  const states = await Promise.all(many);
  assert.equal(pg.count("masters_desk_slices") - before, 1, "five concurrent misses share one read");
  for (const s of states) assert.deepEqual(s.classes.map((c) => c.id), ["cls_real_1"]);

  // ── Warm: served from the cache within 30 s.
  const n = pg.count("masters_desk_slices");
  await loadServerMasters();
  assert.equal(pg.count("masters_desk_slices"), n, "a warm cache does not re-read");

  // ── Expired + failed refresh: the previous copy, timestamp NOT refreshed.
  clock += 31_000;
  pg.tables.masters_desk_slices = { error: "connection reset" };
  const kept = await loadServerMasters();
  assert.deepEqual(kept.classes.map((c) => c.id), ["cls_real_1"], "a failed refresh keeps the real classes");
  const afterFail = pg.count("masters_desk_slices");
  await loadServerMasters();
  assert.equal(pg.count("masters_desk_slices"), afterFail + 1, "the kept copy's timestamp was not refreshed: the next call re-reads");

  // ── Recovery: the next good read replaces the copy.
  pg.tables.masters_desk_slices = [
    { ...goodSlices[0], payload: [{ id: "cls_real_1", name: "Class 1", sortOrder: 1, isActive: true }, { id: "cls_real_2", name: "Class 2", sortOrder: 2, isActive: true }] },
  ];
  const fresh = await loadServerMasters();
  assert.deepEqual(fresh.classes.map((c) => c.id), ["cls_real_1", "cls_real_2"]);

  // ── A failed staff-roster read keeps the previous copy too.
  clock += 31_000;
  pg.tables.sis_staff = { error: "timeout" };
  const keptRoster = await loadServerMasters();
  assert.deepEqual(keptRoster.classes.map((c) => c.id), ["cls_real_1", "cls_real_2"], "roster failure: previous copy kept");
  pg.tables.sis_staff = [];

  // ── After invalidation (no copy) a failure is a 503 again.
  invalidateServerMastersCache();
  pg.tables.masters_desk_slices = { error: "timeout" };
  await assert.rejects(loadServerMasters(), (e: unknown) => e instanceof ApiError && e.status === 503);

  Date.now = realNow;
  console.log("serverMastersCache selftest: ok");
  process.exit(0);
})().catch((e) => {
  console.error(e);
  process.exit(1);
});
