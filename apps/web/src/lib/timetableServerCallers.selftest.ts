/**
 * Run: npx tsx src/lib/timetableServerCallers.selftest.ts
 *
 * Every server reader of the timetable must read it as the DATABASE holds it
 * (readTimetableStateServer — the desk slices). Until 13 Oct 2026 these
 * called ensureTimetableHydratedServer() + loadTimetable(); both are
 * browser-only, so on the server the timetable was always empty:
 *  - /api/v1/staff/timetable — every teacher's week was empty;
 *  - /api/v1/staff/summary — "Today's periods" was always empty;
 *  - /api/v1/staff/online-classes — the scheduling form had no bell periods;
 *  - the daily brief's homework check — every section fell to the Duties
 *    basis, as if no timetable were published;
 *  - "who is free in period 3" — "No bell timetable is set up yet", always.
 *
 * Runs the real code against a fake PostgREST (no database):
 *  - the cause: loadTimetable() is empty on the server;
 *  - a teacher's week and today's periods come from the slices;
 *  - drafts only (production on 13 Oct: 0 published, 13 drafts): the week
 *    falls back to the draft and says `published: false`; today's periods on
 *    the home screen (no draft label) stay published-only;
 *  - a grid from another academic year is left out;
 *  - a failed read is a 503, never an empty timetable;
 *  - the daily brief: published grid → timetable basis; failed read → "not
 *    checked", never the Duties guess;
 *  - "who is free": answers from the slices; failed read → says so;
 *  - wiring: the five callers use the reader, not the browser loaders.
 *
 * Every check reports on its own.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installFakePostgrest, installServerOnlyStub } from "./fakePostgrest.testkit";
import { AY_CURRENT, buildFixture, classId, sectionId, TIMETABLE_TEACHER_SECTIONS } from "../../e2e/fixture";
import { loadTimetable, type TimetableGrid, type TimetableState } from "@/lib/timetable";
import type { BriefStudentAttendance } from "@/lib/dailyBrief";

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
const teacherId = fx.sessions.timetableTeacher.staffId!;
const published = fx.timetable.publishedGrids;
// Mondays–Fridays in the fixture; 2026-10-14 is a Wednesday.
const WED = 3;
const WED_DATE = "2026-10-14";
const AY_PREV = "2025-26";

function setSlices(opts: { published: TimetableGrid[]; grids: TimetableGrid[]; workingWeekdays?: number[] }) {
  const tt = fx.timetable;
  pg.tables.timetable_desk_slices = [
    { tenant_id: TENANT, slice_key: "config", payload: { workingWeekdays: opts.workingWeekdays ?? tt.workingWeekdays, bellTemplate: tt.bellTemplate, meta: tt.meta } },
    { tenant_id: TENANT, slice_key: "grids", payload: opts.grids },
    { tenant_id: TENANT, slice_key: "publishedGrids", payload: opts.published },
    { tenant_id: TENANT, slice_key: "substitutions", payload: [] },
  ];
  pg.tables.timetable_desk_sync_meta = [{ tenant_id: TENANT, updated_at: "2026-10-13T01:00:00.000Z" }];
}
function failSlices() {
  pg.tables.timetable_desk_slices = { error: "canceling statement due to statement timeout" };
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
  console.log("timetableServerCallers.selftest.ts");
  const { readTimetableStateServer } = await import("./api/v1/teachingServer.server");
  const { staffPeriodsIn, staffPeriodsOn, staffWeekGrids } = await import("./api/v1/staffTimetableView");
  const { readHomework } = await import("./dailyBrief.server");
  const { freeTeachers } = await import("./erpCommands.server");
  const { ApiError } = await import("./api/v1/errors");
  const is503 = (e: unknown) => e instanceof ApiError && e.status === 503;

  const week = (tt: TimetableState) => {
    const { published: p, grids } = staffWeekGrids(tt, AY_CURRENT);
    return { published: p, count: [1, 2, 3, 4, 5, 6].reduce((n, d) => n + staffPeriodsIn(tt, grids, masters, teacherId, d).length, 0) };
  };

  await check("the cause: loadTimetable() is empty on the server", () => {
    assert.equal(typeof window, "undefined");
    const tt = loadTimetable();
    assert.equal(tt.publishedGrids.length + tt.grids.length, 0);
  });

  await check("staff week: read from the slices (published)", async () => {
    setSlices({ published, grids: published });
    const w = week(await readTimetableStateServer());
    assert.equal(w.published, true);
    // One period a weekday in each of the teacher's sections.
    assert.equal(w.count, 5 * TIMETABLE_TEACHER_SECTIONS.length);
  });

  await check("today's periods: read from the slices, named and timed", async () => {
    setSlices({ published, grids: published });
    const tt = await readTimetableStateServer();
    const today = staffPeriodsOn(tt, masters, { staffId: teacherId, academicYearCode: AY_CURRENT, weekday: WED });
    assert.equal(today.published, true);
    assert.equal(today.periods.length, TIMETABLE_TEACHER_SECTIONS.length);
    for (const p of today.periods) {
      assert.ok(p.className && p.sectionName && p.subjectName, "names resolved");
      assert.match(p.startTime, /^\d{2}:\d{2}/, "timed from the bell");
    }
  });

  await check("drafts only: week falls back with published=false; home screen stays published-only", async () => {
    setSlices({ published: [], grids: published });
    const tt = await readTimetableStateServer();
    const w = week(tt);
    assert.equal(w.published, false, "the app labels it a working draft");
    assert.ok(w.count > 0, "the draft week is shown");
    const today = staffPeriodsOn(tt, masters, { staffId: teacherId, academicYearCode: AY_CURRENT, weekday: WED });
    assert.equal(today.published, false);
    assert.equal(today.periods.length, 0, "no draft period on the home screen");
  });

  await check("a grid from another academic year is left out", async () => {
    setSlices({ published: published.map((g) => ({ ...g, academicYearCode: AY_PREV })), grids: [] });
    const tt = await readTimetableStateServer();
    assert.equal(week(tt).count, 0);
    assert.equal(staffPeriodsOn(tt, masters, { staffId: teacherId, academicYearCode: AY_CURRENT, weekday: WED }).periods.length, 0);
  });

  await check("failed read → 503, never an empty timetable", async () => {
    failSlices();
    await assert.rejects(readTimetableStateServer(), is503);
    setSlices({ published, grids: published });
    pg.tables.timetable_desk_sync_meta = { error: "connection reset" };
    await assert.rejects(readTimetableStateServer(), is503);
  });

  const k = TIMETABLE_TEACHER_SECTIONS[0];
  const students: BriefStudentAttendance = {
    classes: [
      { classId: classId(k), sectionId: sectionId(k), label: "Section", present: 30, absent: 0, unmarked: 0, strength: 30, marked: true },
    ],
    present: 30,
    absent: 0,
    strength: 30,
    classesMarked: 1,
    classesUnmarked: 0,
  };

  await check("daily brief: homework expected from the published timetable", async () => {
    setSlices({ published, grids: published });
    pg.tables.homework_desk_posts = [];
    const hw = await readHomework(WED_DATE, masters, students, new Set());
    assert.equal(hw.checked, true);
    assert.equal(hw.timetableSections, 1, "the section used the timetable basis");
    assert.equal(hw.assignmentSections, 0, "not the Duties guess");
    assert.ok(hw.expected >= 1);
    assert.ok(hw.missing.some((m) => JSON.stringify(m).includes(teacherId)), "the timetable teacher is listed");
  });

  await check("daily brief: failed timetable read → not checked (no Duties guess)", async () => {
    failSlices();
    pg.log.length = 0;
    const hw = await readHomework(WED_DATE, masters, students, new Set());
    assert.equal(hw.checked, false);
    assert.equal(hw.expected, 0);
    assert.equal(hw.assignmentSections, 0);
    assert.equal(pg.count("homework_desk_posts"), 0, "posts not read");
  });

  await check("who is free: answers from the slices", async () => {
    setSlices({ published, grids: published });
    const text = await freeTeachers({ date: WED_DATE }, "1", fx.sessions.office, WED_DATE);
    assert.ok(!/No bell timetable/.test(text), text.slice(0, 120));
    assert.ok(!/couldn't read the timetable/.test(text), text.slice(0, 120));
    // The stored working days decide (the empty server default had Mon–Sat).
    setSlices({ published, grids: published, workingWeekdays: [1, 2, 4, 5] });
    const off = await freeTeachers({ date: WED_DATE }, "1", fx.sessions.office, WED_DATE);
    assert.match(off, /not a working day/, off.slice(0, 120));
  });

  await check("who is free: failed read says so", async () => {
    failSlices();
    const text = await freeTeachers({ date: WED_DATE }, "1", fx.sessions.office, WED_DATE);
    assert.match(text, /couldn't read the timetable/);
  });

  await check("wiring: the five callers read the slices, not the browser loaders", () => {
    const files = [
      "app/api/v1/staff/timetable/route.ts",
      "app/api/v1/staff/summary/route.ts",
      "app/api/v1/staff/online-classes/route.ts",
      "lib/dailyBrief.server.ts",
      "lib/erpCommands.server.ts",
    ];
    for (const f of files) {
      const src = readFileSync(join(__dirname, "..", f), "utf8")
        // Comments may name the old calls.
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
      assert.ok(!/\bloadTimetable\(|ensureTimetableHydratedServer\(/.test(src), `${f}: no browser loaders`);
      assert.ok(/readTimetableStateServer\(/.test(src), `${f}: reads the slices`);
    }
    const summary = readFileSync(join(__dirname, "../app/api/v1/staff/summary/route.ts"), "utf8");
    assert.ok(/staffPeriodsOn\(/.test(summary) && !/staffWeekGrids\(/.test(summary), "summary: published only");
  });

  if (failures) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("  all ok");
})();
