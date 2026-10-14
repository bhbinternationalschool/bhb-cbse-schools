/**
 * Run: npx tsx src/lib/teachingServerRead.selftest.ts
 *
 * The /api/v1/teaching/* routes must read the teaching plan and the timetable
 * as the DATABASE holds them. Until 13 Oct 2026 they read loadTeaching() /
 * loadTimetable(), which are browser-only and always empty on the server:
 * /today served no chapters, /lesson-plan answered 404 to every edit, /log
 * refused every chapter tag, /syllabus-import de-duplicated against nothing.
 *
 * Runs the real readers (lib/api/v1/teachingServer.server.ts) against a fake
 * PostgREST (no database):
 *  - the cause: loadTeaching() / loadTimetable() are empty on the server;
 *  - the stored plan is read — units, and the plan an edit looks up by id;
 *  - no row = an empty plan; a failed read = ApiError 503, never empty;
 *  - the timetable comes from its desk slices and resolves a teacher's day;
 *    a failed slice read = 503;
 *  - a save merges into the plan as stored (another teacher's log survives),
 *    a removed plan stays removed, and a failed re-read refuses the save
 *    without writing anything;
 *  - wiring: the four routes use the readers, not the browser loaders.
 *
 * Every check reports on its own.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installFakePostgrest, installServerOnlyStub } from "./fakePostgrest.testkit";
import { AY_CURRENT, buildFixture } from "../../e2e/fixture";
import {
  emptyTeachingState,
  importSyllabusUnits,
  istDateOf,
  loadTeaching,
  resolveExpectedPeriods,
  upsertLessonPlan,
  upsertTeachingLog,
  type TeachingState,
} from "@/lib/teaching";
import { loadTimetable } from "@/lib/timetable";

installServerOnlyStub();
const pg = installFakePostgrest();
const TENANT = "00000000-0000-4000-8000-000000000001";

// Every write the code sends (the kit answers them but keeps no body).
const writes: { table: string; body: unknown }[] = [];
const kitFetch = globalThis.fetch;
globalThis.fetch = (async (input: unknown, init?: { method?: string; body?: unknown }) => {
  const method = (init?.method || "GET").toUpperCase();
  if (method !== "GET" && method !== "HEAD") {
    const url = new URL(typeof input === "string" ? input : String((input as { url?: string }).url ?? input));
    writes.push({ table: url.pathname.replace(/^\/rest\/v1\//, ""), body: init?.body ? JSON.parse(String(init.body)) : null });
  }
  return (kitFetch as (i: unknown, n?: unknown) => Promise<Response>)(input, init);
}) as typeof fetch;

const fx = buildFixture();
const CLASS = fx.masters.classes[0]!.id;
const SUBJECT = fx.masters.subjects[0]!.id;

function storedPlan(): { state: TeachingState; planId: string; unitIds: string[] } {
  const imp = importSyllabusUnits(emptyTeachingState(), {
    academicYearCode: AY_CURRENT,
    classId: CLASS,
    subjectId: SUBJECT,
    chapters: [{ code: "1", title: "Our Earth", topics: [{ title: "Land and water" }] }, { code: "2", title: "Maps" }],
  });
  assert.ok(imp.ok);
  const plan = upsertLessonPlan(imp.value.state, {
    academicYearCode: AY_CURRENT,
    classId: CLASS,
    subjectId: SUBJECT,
    sectionId: "",
    title: "Continents",
    unitIds: [imp.value.state.units[0]!.id],
    plannedDate: "2026-10-14",
    plannedPeriods: 1,
    objectives: "Name the continents",
    teachingAids: "",
    activities: "",
    assessment: "",
    homework: "",
    source: "manual",
    aiModel: "",
    createdBy: "e2e_staff",
  });
  assert.ok(plan.ok);
  return { state: plan.value.state, planId: plan.value.plan.id, unitIds: imp.value.state.units.map((u) => u.id) };
}

let failures = 0;
async function check(name: string, fn: () => Promise<void> | void) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
  }
}

void (async () => {
  console.log("teachingServerRead.selftest.ts");
  const { readTeachingStateServer, readTimetableStateServer, saveTeachingStateServer } = await import(
    "./api/v1/teachingServer.server"
  );
  const { ApiError } = await import("./api/v1/errors");
  const is503 = (e: unknown) => e instanceof ApiError && e.status === 503;
  const seed = storedPlan();

  await check("the cause: the browser loaders are empty on the server", () => {
    assert.equal(typeof window, "undefined");
    assert.equal(loadTeaching().units.length, 0);
    assert.equal(loadTimetable().publishedGrids.length, 0);
  });

  await check("stored plan is read: units and lesson plans", async () => {
    pg.tables.teaching_state = [{ tenant_id: TENANT, state: seed.state }];
    const s = await readTeachingStateServer();
    assert.equal(s.units.length, seed.state.units.length);
    assert.ok(s.units.length >= 3, "two chapters + a topic");
  });

  await check("an edit finds the stored plan by id (was 404)", async () => {
    pg.tables.teaching_state = [{ tenant_id: TENANT, state: seed.state }];
    const s = await readTeachingStateServer();
    assert.ok(s.lessonPlans.some((p) => p.id === seed.planId));
  });

  await check("re-importing the same chapters adds nothing (de-dupe sees the plan)", async () => {
    pg.tables.teaching_state = [{ tenant_id: TENANT, state: seed.state }];
    const input = { academicYearCode: AY_CURRENT, classId: CLASS, subjectId: SUBJECT, chapters: [{ code: "1", title: "Our Earth" }] };
    const r = importSyllabusUnits(await readTeachingStateServer(), input);
    // Nothing new is refused outright ("already in the plan").
    assert.ok(!r.ok || r.value.summary.chaptersAdded === 0, "the stored chapter is seen");
    const blind = importSyllabusUnits(emptyTeachingState(), input);
    assert.ok(blind.ok && blind.value.summary.chaptersAdded === 1, "against the old empty read it was added again");
  });

  await check("no row → empty plan (never set up)", async () => {
    pg.tables.teaching_state = [];
    const s = await readTeachingStateServer();
    assert.equal(s.units.length + s.lessonPlans.length + s.logs.length, 0);
  });

  await check("failed read → 503, never an empty plan", async () => {
    pg.tables.teaching_state = { error: "canceling statement due to statement timeout" };
    await assert.rejects(readTeachingStateServer(), is503);
  });

  await check("row with no plan in it → 503", async () => {
    pg.tables.teaching_state = [{ tenant_id: TENANT, state: null }];
    await assert.rejects(readTeachingStateServer(), is503);
  });

  await check("timetable from desk slices resolves a teacher's day", async () => {
    const tt = fx.timetable;
    pg.tables.timetable_desk_slices = [
      { tenant_id: TENANT, slice_key: "config", payload: { workingWeekdays: tt.workingWeekdays, bellTemplate: tt.bellTemplate, meta: tt.meta } },
      { tenant_id: TENANT, slice_key: "grids", payload: tt.grids },
      { tenant_id: TENANT, slice_key: "publishedGrids", payload: tt.publishedGrids },
      { tenant_id: TENANT, slice_key: "substitutions", payload: tt.substitutions },
    ];
    pg.tables.timetable_desk_sync_meta = [{ tenant_id: TENANT, updated_at: "2026-10-13T01:00:00.000Z" }];
    const timetable = await readTimetableStateServer();
    assert.ok(timetable.publishedGrids.length > 0, "published grids read");
    const staffId = fx.sessions.timetableTeacher.staffId!;
    // A week of days: at least one must give this teacher periods.
    const days = ["2026-10-12", "2026-10-13", "2026-10-14", "2026-10-15", "2026-10-16", "2026-10-17"];
    const counts = days.map((date) => {
      const r = resolveExpectedPeriods({ timetable, masters: fx.masters, academicYearCode: AY_CURRENT, date, staffId });
      return r.ok ? r.periods.length : 0;
    });
    assert.ok(counts.some((n) => n > 0), `periods per day: ${counts.join(",")}`);
  });

  await check("failed timetable read → 503", async () => {
    pg.tables.timetable_desk_slices = { error: "canceling statement due to statement timeout" };
    await assert.rejects(readTimetableStateServer(), is503);
  });

  await check("save merges into the stored plan (another teacher's log survives)", async () => {
    const other = upsertTeachingLog(seed.state, {
      academicYearCode: AY_CURRENT,
      // Today in IST: the log rules refuse a period older than the backdate
      // window, so a fixed date turned this check red the day it aged out.
      date: istDateOf(),
      periodNo: 1,
      classId: CLASS,
      sectionId: fx.masters.sections.find((s) => s.classId === CLASS)?.id || "",
      subjectId: SUBJECT,
      staffId: "e2e_other",
      scheduledStaffId: "",
      status: "delivered",
      startedAt: "",
      unitIds: [seed.state.units.find((u) => u.level === "topic")!.id],
      lessonPlanId: "",
      note: "",
      source: "teacher_log",
      location: { check: "unknown", distanceM: null, accuracyM: null, checkedAt: "" } as never,
      createdBy: "e2e_other",
    });
    assert.ok(other.ok, other.ok ? "" : other.error);
    pg.tables.teaching_state = [{ tenant_id: TENANT, state: other.value.state }];
    writes.length = 0;
    // This route's copy was read before the other log landed.
    const r = await saveTeachingStateServer(seed.state);
    assert.ok(r.ok);
    assert.equal(r.state.logs.length, 1, "the other teacher's log is kept");
    const sent = writes.find((w) => w.table === "teaching_state");
    assert.ok(sent, "upserted");
    const body = (Array.isArray(sent.body) ? sent.body[0] : sent.body) as { state: TeachingState };
    assert.equal(body.state.logs.length, 1);
  });

  await check("a removed plan stays removed after the merge", async () => {
    pg.tables.teaching_state = [{ tenant_id: TENANT, state: seed.state }];
    const without = { ...seed.state, lessonPlans: seed.state.lessonPlans.filter((p) => p.id !== seed.planId) };
    const r = await saveTeachingStateServer(without, { dropLessonPlanIds: [seed.planId] });
    assert.ok(r.ok);
    assert.ok(!r.state.lessonPlans.some((p) => p.id === seed.planId));
  });

  await check("failed re-read refuses the save and writes nothing", async () => {
    pg.tables.teaching_state = { error: "connection reset" };
    writes.length = 0;
    const r = await saveTeachingStateServer(seed.state);
    assert.equal(r.ok, false);
    assert.equal(writes.filter((w) => w.table === "teaching_state").length, 0);
  });

  await check("wiring: the four routes read server truth", () => {
    const dir = join(__dirname, "../app/api/v1/teaching");
    for (const name of ["today", "lesson-plan", "log", "syllabus-import"]) {
      const src = readFileSync(join(dir, name, "route.ts"), "utf8");
      assert.ok(!/\bloadTeaching\(|\bloadTimetable\(|HydratedServer\(|writeTeachingLocalRaw\(|pushTeachingRemoteServer\(/.test(src), `${name}: no browser loaders`);
      assert.ok(/readTeachingStateServer\(/.test(src), `${name}: reads the stored plan`);
    }
    for (const name of ["today", "log"]) {
      const src = readFileSync(join(dir, name, "route.ts"), "utf8");
      assert.ok(/readTimetableStateServer\(/.test(src), `${name}: reads the timetable slices`);
    }
    for (const name of ["lesson-plan", "log", "syllabus-import"]) {
      const src = readFileSync(join(dir, name, "route.ts"), "utf8");
      assert.ok(/saveTeachingStateServer\(/.test(src), `${name}: saves through the strict merge`);
    }
  });

  if (failures) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("  all ok");
})();
