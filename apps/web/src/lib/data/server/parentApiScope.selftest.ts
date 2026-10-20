/**
 * Run: npx tsx src/lib/data/server/parentApiScope.selftest.ts
 *
 * data-layer 4.1 — the two pieces the parent app's routes share:
 *
 * routeTiming (lib/data/server/routeTiming.ts)
 *  - time is charged to the phase that was running; one JSON line per
 *    request (`event: "route-timing"`), whatever the status; `done` twice
 *    logs once; a throwing logger never fails the request; a note cannot
 *    overwrite the line's own fields.
 *
 * householdRead (lib/data/server/householdRead.ts), against a fake PostgREST
 * that IGNORES every filter (it answers the whole table), so these checks
 * see the reader's own guard, not the query's:
 *  - a family's read never returns another family's row, even when the
 *    database hands one back; rows stay in id order as sent;
 *  - a failed read is `{ok:false}`, never an empty family;
 *  - readHousehold / readStudentById return only the row asked for, null
 *    when absent, `{ok:false}` on failure.
 *
 * Every check reports on its own (PASS/FAIL), and the run fails if any did.
 */
import assert from "node:assert/strict";
import { installFakePostgrest, installServerOnlyStub } from "@/lib/fakePostgrest.testkit";

installServerOnlyStub();
const pg = installFakePostgrest();
const TENANT = "00000000-0000-4000-8000-000000000001";

const failures: string[] = [];
async function check(name: string, fn: () => Promise<void> | void): Promise<void> {
  try {
    await fn();
    console.log(`PASS  ${name}`);
  } catch (e) {
    failures.push(name);
    console.log(`FAIL  ${name} — ${e instanceof Error ? e.message.split("\n")[0] : String(e)}`);
  }
}

const studentRow = (id: string, householdId: string, over: Record<string, unknown> = {}) => ({
  id,
  tenant_id: TENANT,
  household_id: householdId,
  admission_no: `ADM-${id}`,
  full_name: `Child ${id}`,
  status: "active",
  academic_year_code: "2026-27",
  class_id: "c1",
  section_id: "s1",
  updated_at: "2026-10-01T00:00:00.000Z",
  ...over,
});

void (async () => {
  const { routeTimer } = await import("./routeTiming");
  const { readHouseholdStudents, readHousehold, readStudentById } = await import("./householdRead");

  // ── routeTiming ────────────────────────────────────────────────────────
  await check("phases are charged to the phase that was running; one line, every field", () => {
    let t = 1000;
    const lines: string[] = [];
    const timer = routeTimer("v1/test", { now: () => t, log: (l) => lines.push(l) });
    t += 12; // auth
    timer.phase("query");
    t += 30;
    timer.phase("build");
    t += 5;
    timer.note("children", 2);
    const line = timer.done(200);
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!) as Record<string, unknown>;
    assert.deepEqual(parsed, { ...line });
    assert.equal(parsed.event, "route-timing");
    assert.equal(parsed.route, "v1/test");
    assert.equal(parsed.status, 200);
    assert.equal(parsed.authMs, 12);
    assert.equal(parsed.queryMs, 30);
    assert.equal(parsed.buildMs, 5);
    assert.equal(parsed.totalMs, 47);
    assert.equal(parsed.children, 2);
  });

  await check("an error answer is logged too, with its status; done twice logs once", () => {
    let t = 0;
    const lines: string[] = [];
    const timer = routeTimer("v1/test", { now: () => t, log: (l) => lines.push(l) });
    t += 3;
    timer.phase("query");
    t += 4;
    timer.done(503);
    timer.done(200);
    timer.phase("build");
    assert.equal(lines.length, 1);
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.status, 503);
    assert.equal(parsed.queryMs, 4);
    assert.equal(parsed.buildMs, 0);
  });

  await check("a throwing logger never fails the request", () => {
    const timer = routeTimer("v1/test", {
      log: () => {
        throw new Error("stdout closed");
      },
    });
    assert.doesNotThrow(() => timer.done(200));
  });

  await check("a note cannot overwrite the line's own fields", () => {
    const lines: string[] = [];
    const timer = routeTimer("v1/test", { now: () => 0, log: (l) => lines.push(l) });
    timer.note("event", "x");
    timer.note("route", "x");
    timer.note("status", 1);
    timer.note("queryMs", 99);
    timer.done(200);
    const parsed = JSON.parse(lines[0]!);
    assert.equal(parsed.event, "route-timing");
    assert.equal(parsed.route, "v1/test");
    assert.equal(parsed.status, 200);
    assert.equal(parsed.queryMs, 0);
  });

  // ── householdRead ──────────────────────────────────────────────────────
  await check("a family's read never returns another family's row, even if the database sends one", async () => {
    pg.tables.sis_students = [
      studentRow("a1", "hh_a"),
      studentRow("b1", "hh_b"),
      studentRow("a2", "hh_a", { academic_year_code: "2025-26" }),
      studentRow("x1", ""),
    ];
    const r = await readHouseholdStudents("hh_a");
    assert.equal(r.ok, true);
    if (!r.ok) return;
    assert.deepEqual(r.students.map((s) => s.id), ["a1", "a2"]);
    assert.ok(r.students.every((s) => s.householdId === "hh_a"));
    assert.equal(r.students[1]!.academicYearCode, "2025-26", "mapped by the roster's own mapper");
  });

  await check("a failed family read is {ok:false}, never an empty family", async () => {
    pg.tables.sis_students = { error: "permission denied for table sis_students" };
    const r = await readHouseholdStudents("hh_a");
    assert.equal(r.ok, false);
  });

  await check("no household id → no children, no request", async () => {
    const before = pg.count("sis_students");
    const r = await readHouseholdStudents("");
    assert.deepEqual(r, { ok: true, students: [] });
    assert.equal(pg.count("sis_students"), before);
  });

  await check("readHousehold returns only the household asked for; null when absent; ok:false on failure", async () => {
    pg.tables.sis_households = [
      { id: "hh_b", tenant_id: TENANT, code: "B", guardian_name: "Guardian B", updated_at: "2026-10-01T00:00:00.000Z" },
    ];
    const absent = await readHousehold("hh_a");
    assert.deepEqual(absent, { ok: true, household: null }, "another family's row is not this family");
    pg.tables.sis_households = [
      { id: "hh_a", tenant_id: TENANT, code: "A", guardian_name: "Guardian A", updated_at: "2026-10-01T00:00:00.000Z" },
    ];
    const found = await readHousehold("hh_a");
    assert.equal(found.ok && found.household?.id, "hh_a");
    pg.tables.sis_households = { error: "timeout" };
    assert.equal((await readHousehold("hh_a")).ok, false);
  });

  await check("readStudentById returns only the row asked for; null when absent; ok:false on failure", async () => {
    pg.tables.sis_students = [studentRow("b1", "hh_b")];
    assert.deepEqual(await readStudentById("a1"), { ok: true, student: null });
    pg.tables.sis_students = [studentRow("a1", "hh_a")];
    const r = await readStudentById("a1");
    assert.equal(r.ok && r.student?.householdId, "hh_a");
    pg.tables.sis_students = { error: "timeout" };
    assert.equal((await readStudentById("a1")).ok, false);
  });

  if (failures.length) {
    console.log(`\n${failures.length} check(s) failed`);
    process.exit(1);
  }
  console.log("\nparent-api-scope: all checks passed");
})();
