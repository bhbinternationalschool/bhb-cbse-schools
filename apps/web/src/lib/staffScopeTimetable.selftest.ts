/**
 * Run: npx tsx src/lib/staffScopeTimetable.selftest.ts
 *
 * data-layer 1.7. staffSectionScope() must build a teacher's sections from
 * the timetable as the DATABASE holds it — until 13 Oct 2026 it read
 * loadTimetable(), which is always empty on the server, so a teacher whose
 * only tie to a section is the timetable had none.
 *
 * Runs the real scope (lib/api/v1/staffScope.ts + timetableScope.server.ts)
 * on the e2e fixture's school against a fake PostgREST (no database):
 *  - a published grid gives its sections; the published grids win over the
 *    draft; the draft is used only when nothing is published;
 *  - a failed read with no copy is UNKNOWN (ApiError 503, and a 503 response
 *    from readStaffScopeForDesk) — not an empty scope;
 *  - a school-wide session (office role, leadership) does not depend on the
 *    timetable: a failed read leaves it school-wide;
 *  - a failed read with a copy keeps the copy;
 *  - meta unchanged → the slices are not read again; meta moved → they are;
 *  - a save caught half-way (slices older than meta) is not cached;
 *  - one request (one ApiAuthContext) computes the scope once.
 *
 * Every check reports on its own, so running it against the code before 1.7
 * shows which ones that code fails.
 */
import assert from "node:assert/strict";
import { installFakePostgrest, installServerOnlyStub } from "./fakePostgrest.testkit";
import { buildFixture, classId, sectionId, TIMETABLE_TEACHER_SECTIONS } from "../../e2e/fixture";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import type { TimetableGrid } from "@/lib/timetable";

installServerOnlyStub();
const pg = installFakePostgrest();
const TENANT = "00000000-0000-4000-8000-000000000001";

const fx = buildFixture();
const masters = {
  ...fx.masters,
  staff: fx.staff.staff,
  departments: fx.staff.departments,
  designations: fx.staff.designations,
};
const newCtx = (): ApiAuthContext => ({
  session: fx.sessions.timetableTeacher,
  masters,
  rbac: fx.rbac,
  rbacKnown: true,
  authKind: "session",
});

const published = fx.timetable.publishedGrids;
const want = new Set(TIMETABLE_TEACHER_SECTIONS.map((k) => `${classId(k)}|${sectionId(k)}`));
// A DRAFT grid that puts the same teacher in another section (IV-A): it must
// count only while nothing is published.
const DRAFT_KEY = 7;
const draftOnly: TimetableGrid = {
  ...published[0]!,
  id: "e2e_grid_draft",
  classId: classId(DRAFT_KEY),
  sectionId: sectionId(DRAFT_KEY),
};
const draftKey = `${classId(DRAFT_KEY)}|${sectionId(DRAFT_KEY)}`;

function setTimetable(opts: { meta: string; slicesAt?: string; published: TimetableGrid[]; grids: TimetableGrid[] }) {
  const at = opts.slicesAt ?? opts.meta;
  pg.tables.timetable_desk_sync_meta = [{ tenant_id: TENANT, updated_at: opts.meta }];
  pg.tables.timetable_desk_slices = [
    { tenant_id: TENANT, slice_key: "publishedGrids", payload: opts.published, updated_at: at },
    { tenant_id: TENANT, slice_key: "grids", payload: opts.grids, updated_at: at },
  ];
}

const failures: string[] = [];
async function check(name: string, fn: () => Promise<void>): Promise<void> {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`FAIL  ${name} — ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
}

void (async () => {
  const scopeMod = await import("./api/v1/staffScope");
  const { staffSectionScope } = scopeMod;
  const ttMod = await import("./api/v1/timetableScope.server").catch(() => null);
  const reset = () => ttMod?.resetScopeTimetableCacheForTests();
  const { ApiError } = await import("./api/v1/errors");
  const sectionsOf = async () => [...(await staffSectionScope(newCtx())).sections].sort();

  // ── A failed read on a cold process: unknown, not empty.
  await check("failed read, no copy → 503 (unknown), not an empty scope", async () => {
    reset();
    pg.tables.timetable_desk_sync_meta = [{ tenant_id: TENANT, updated_at: "2026-10-13T01:00:00.000Z" }];
    pg.tables.timetable_desk_slices = { error: "canceling statement due to statement timeout" };
    await assert.rejects(
      staffSectionScope(newCtx()),
      (e: unknown) => e instanceof ApiError && e.status === 503,
      "the scope must be unknown (503), not resolved",
    );
  });

  await check("failed meta read, no copy → 503", async () => {
    reset();
    pg.tables.timetable_desk_sync_meta = { error: "connection reset" };
    await assert.rejects(staffSectionScope(newCtx()), (e: unknown) => e instanceof ApiError && e.status === 503);
  });

  await check("readStaffScopeForDesk: unknown scope is a 503 response, never null", async () => {
    reset();
    pg.tables.timetable_desk_sync_meta = { error: "connection reset" };
    const read = (scopeMod as { readStaffScopeForDesk?: typeof scopeMod.readStaffScopeForDesk }).readStaffScopeForDesk;
    assert.ok(read, "readStaffScopeForDesk exists");
    const r = await read(newCtx());
    assert.equal(r.ok, false, "not ok");
    if (!r.ok) {
      assert.equal(r.response.status, 503);
      const body = (await r.response.json()) as { ok?: boolean; scopeUnknown?: boolean };
      assert.equal(body.ok, false);
      assert.equal(body.scopeUnknown, true);
    }
    // Not a staff session: null (the route's own non-staff rule), as before.
    const other = await read({ ...newCtx(), session: { ...fx.sessions.office, persona: "parent" } });
    assert.deepEqual(other, { ok: true, scope: null });
  });

  await check("school-wide session: a failed timetable read does not make it unknown", async () => {
    reset();
    pg.tables.timetable_desk_sync_meta = { error: "connection reset" };
    const office = await staffSectionScope({ ...newCtx(), session: fx.sessions.office });
    assert.equal(office.unrestricted, true, "the office role (Masters → Roles) is school-wide without the timetable");
    // …while a teacher on the same failed read is unknown, not school-wide and not empty.
    await assert.rejects(staffSectionScope(newCtx()), (e: unknown) => e instanceof ApiError && e.status === 503);
  });

  // ── The published grid gives the timetable-only teacher her sections.
  await check("published grid → her two timetable sections (and not the draft's)", async () => {
    reset();
    setTimetable({ meta: "2026-10-13T02:00:00.000Z", published, grids: [...published, draftOnly] });
    const got = await sectionsOf();
    assert.deepEqual(got, [...want].sort(), `got ${JSON.stringify(got)}`);
    assert.ok(!got.includes(draftKey), "a draft-only section is not hers while a timetable is published");
  });

  await check("nothing published → the draft grids are used", async () => {
    reset();
    setTimetable({ meta: "2026-10-13T03:00:00.000Z", published: [], grids: [draftOnly] });
    assert.deepEqual(await sectionsOf(), [draftKey]);
  });

  // ── The process copy.
  await check("meta unchanged → the slices are not read again", async () => {
    reset();
    setTimetable({ meta: "2026-10-13T04:00:00.000Z", published, grids: published });
    await sectionsOf();
    const slices = pg.count("timetable_desk_slices");
    const meta = pg.count("timetable_desk_sync_meta");
    const seen: string[][] = [];
    for (let i = 0; i < 3; i++) seen.push(await sectionsOf());
    assert.equal(pg.count("timetable_desk_slices") - slices, 0, "no slice read while meta is unchanged");
    assert.equal(pg.count("timetable_desk_sync_meta") - meta, 3, "one meta select per scope");
    for (const got of seen) assert.deepEqual(got, [...want].sort());
  });

  await check("meta moved → the slices are read again (an edit shows on the next request)", async () => {
    reset();
    setTimetable({ meta: "2026-10-13T05:00:00.000Z", published, grids: published });
    assert.deepEqual(await sectionsOf(), [...want].sort());
    const slices = pg.count("timetable_desk_slices");
    setTimetable({ meta: "2026-10-13T05:30:00.000Z", published: [published[0]!], grids: [published[0]!] });
    const got = await sectionsOf();
    assert.equal(pg.count("timetable_desk_slices") - slices, 1, "one slice read after the move");
    assert.deepEqual(got, [`${classId(TIMETABLE_TEACHER_SECTIONS[0])}|${sectionId(TIMETABLE_TEACHER_SECTIONS[0])}`]);
  });

  await check("failed read with a copy → the copy is kept (and says stale)", async () => {
    reset();
    setTimetable({ meta: "2026-10-13T06:00:00.000Z", published, grids: published });
    assert.deepEqual(await sectionsOf(), [...want].sort());
    // The meta moved, then the slice read fails.
    pg.tables.timetable_desk_sync_meta = [{ tenant_id: TENANT, updated_at: "2026-10-13T06:30:00.000Z" }];
    pg.tables.timetable_desk_slices = { error: "canceling statement due to statement timeout" };
    assert.deepEqual(await sectionsOf(), [...want].sort(), "slice read failed: previous copy");
    // The meta read itself fails.
    pg.tables.timetable_desk_sync_meta = { error: "connection reset" };
    assert.deepEqual(await sectionsOf(), [...want].sort(), "meta read failed: previous copy");
    assert.ok(ttMod, "timetableScope.server exists");
    assert.equal((await ttMod.loadScopeTimetable()).stale, true, "a kept copy is reported stale");
    // Recovery: the next good read replaces it.
    setTimetable({ meta: "2026-10-13T06:45:00.000Z", published: [], grids: [draftOnly] });
    assert.deepEqual(await sectionsOf(), [draftKey]);
  });

  await check("a save caught half-way (slices older than meta) is served but not cached", async () => {
    reset();
    setTimetable({ meta: "2026-10-13T07:00:00.000Z", slicesAt: "2026-10-13T06:59:00.000Z", published: [], grids: [draftOnly] });
    assert.deepEqual(await sectionsOf(), [draftKey]);
    // The save finishes: same meta value, new slices.
    setTimetable({ meta: "2026-10-13T07:00:00.000Z", published, grids: published });
    assert.deepEqual(await sectionsOf(), [...want].sort(), "the finished save is read, not the half-way copy");
  });

  await check("one request computes the scope once", async () => {
    reset();
    setTimetable({ meta: "2026-10-13T08:00:00.000Z", published, grids: published });
    const ctx = newCtx();
    const meta = pg.count("timetable_desk_sync_meta");
    const [a, b] = await Promise.all([staffSectionScope(ctx), staffSectionScope(ctx)]);
    const c = await staffSectionScope(ctx);
    assert.equal(pg.count("timetable_desk_sync_meta") - meta, 1, "one meta select for the request");
    assert.equal(a, b);
    assert.equal(a, c);
    await staffSectionScope(newCtx());
    assert.equal(pg.count("timetable_desk_sync_meta") - meta, 2, "a new request reads again");
  });

  await check("a failure is not kept for the rest of the request", async () => {
    reset();
    const ctx = newCtx();
    pg.tables.timetable_desk_sync_meta = { error: "connection reset" };
    await assert.rejects(staffSectionScope(ctx));
    setTimetable({ meta: "2026-10-13T09:00:00.000Z", published, grids: published });
    assert.deepEqual([...(await staffSectionScope(ctx)).sections].sort(), [...want].sort());
  });

  await check("the class teacher's links still count alongside the timetable", async () => {
    reset();
    setTimetable({ meta: "2026-10-13T10:00:00.000Z", published, grids: published });
    const s = await staffSectionScope({ ...newCtx(), session: fx.sessions.teacher });
    assert.equal(s.classTeacherOf.size, 1, "her one class-teacher section");
    assert.equal(s.sections.size, 1);
  });

  console.log(failures.length ? `\n${failures.length} check(s) FAILED` : "\nstaffScopeTimetable selftest: all checks passed");
  process.exit(failures.length ? 1 : 0);
})();
