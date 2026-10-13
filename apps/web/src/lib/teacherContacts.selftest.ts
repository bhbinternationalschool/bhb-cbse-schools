/**
 * Run: npx tsx src/lib/teacherContacts.selftest.ts
 *
 * A child's teachers, as a parent sees them (/api/v1/teachers/contacts) and
 * as the relay checks them (relayTeacherMessage — the WhatsApp "Ref: T:…"
 * messages). Until 13 Oct 2026 teacherContactsFor() read loadTimetable(),
 * which is empty on the server, so the list only ever held class teachers
 * and a message to a subject teacher was refused with "That teacher does
 * not teach this child".
 *
 * Runs the real code against a fake PostgREST (no database):
 *  - published timetable: the subject teacher is listed, with the subject;
 *  - drafts only (production on 13 Oct: 0 published, 13 drafts): class
 *    teachers only — the same rule that gives a teacher a section's students
 *    (timetableScope.server.ts), so no parent is handed a teacher who cannot
 *    see their child;
 *  - another section's grid lends it no teachers;
 *  - relay: a subject teacher on the published timetable is reached;
 *  - relay, failed timetable read: a subject teacher → "send again" (retry,
 *    nothing stored), never "does not teach this child"; a class teacher
 *    still goes through (the masters alone decide that);
 *  - relay, drafts only: a draft-only teacher is refused;
 *  - wiring: the contacts route and the relay read the slices; the bot gives
 *    the retry message for a retry.
 *
 * Every check reports on its own.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { installFakePostgrest, installServerOnlyStub } from "./fakePostgrest.testkit";
import { buildFixture, CLASS_TEACHER, classId, sectionId, staffId, TIMETABLE_TEACHER, TIMETABLE_TEACHER_SECTIONS } from "../../e2e/fixture";
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
const published = fx.timetable.publishedGrids;
const subjectTeacher = staffId(TIMETABLE_TEACHER);

// A child in III-A — on the timetable teacher's published grid; its class
// teacher is staff k+3.
const k = TIMETABLE_TEACHER_SECTIONS[0];
const classTeacher = staffId(k + 3);
const child = fx.sis.students.find((s) => s.classId === classId(k) && s.sectionId === sectionId(k) && s.status === "active")!;
const household = fx.sis.households.find((h) => h.id === child.householdId)!;
// A child in Nursery-A: no published grid there.
const otherChild = fx.sis.students.find((s) => s.classId === classId(1) && s.sectionId === sectionId(1) && s.status === "active")!;

function setSlices(opts: { published: TimetableGrid[]; grids: TimetableGrid[] }) {
  const tt = fx.timetable;
  pg.tables.timetable_desk_slices = [
    { tenant_id: TENANT, slice_key: "config", payload: { workingWeekdays: tt.workingWeekdays, bellTemplate: tt.bellTemplate, meta: tt.meta } },
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
  console.log("teacherContacts.selftest.ts");
  assert.ok(child && household && otherChild, "fixture: children found");
  const { setMirrorSlice } = await import("./schoolDataMirror");
  // relayTeacherMessage reads the masters from the server mirror, as in production.
  setMirrorSlice("masters", masters);
  const { readTimetableStateServer } = await import("./api/v1/teachingServer.server");
  const { teacherContactsFor, relayTeacherMessage } = await import("./teacherContact.server");
  pg.tables.teacher_messages = [];
  pg.tables.chat_messages = [];

  const relay = (staff: string) =>
    relayTeacherMessage({ household, student: child, staffId: staff, body: "Please call me about the homework.", channel: "whatsapp" });

  await check("published timetable: class teacher first, then the subject teacher with the subject", async () => {
    setSlices({ published, grids: published });
    const list = teacherContactsFor(child, masters, await readTimetableStateServer());
    assert.equal(list[0]?.staffId, classTeacher);
    assert.equal(list[0]?.isClassTeacher, true);
    const st = list.find((c) => c.staffId === subjectTeacher);
    assert.ok(st, "the subject teacher is listed");
    assert.equal(st.isClassTeacher, false);
    assert.equal(st.subjects.length, 1, "one subject");
    assert.equal(st.role, st.subjects[0]);
  });

  await check("drafts only: class teachers only (a draft grants nothing)", async () => {
    setSlices({ published: [], grids: published });
    const list = teacherContactsFor(child, masters, await readTimetableStateServer());
    assert.deepEqual(list.map((c) => c.staffId), [classTeacher]);
  });

  await check("another section's grid lends this child no teachers", async () => {
    setSlices({ published, grids: published });
    const list = teacherContactsFor(otherChild, masters, await readTimetableStateServer());
    assert.deepEqual(list.map((c) => c.staffId), [staffId(CLASS_TEACHER)]);
  });

  await check("relay: a subject teacher on the published timetable is reached", async () => {
    setSlices({ published, grids: published });
    pg.log.length = 0;
    const r = await relay(subjectTeacher);
    assert.ok(r.ok, JSON.stringify(r));
    assert.equal(r.teacherName, masters.staff.find((s) => s.id === subjectTeacher)!.fullName);
    assert.ok(pg.log.includes("POST teacher_messages"), "message stored");
  });

  await check("relay, failed timetable read: subject teacher → send again, nothing stored", async () => {
    failSlices();
    pg.log.length = 0;
    const r = await relay(subjectTeacher);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && r.retry === true, JSON.stringify(r));
    assert.ok(!r.ok && !/does not teach/.test(r.error), "never 'does not teach this child'");
    assert.equal(pg.count("teacher_messages"), 0, "nothing stored");
  });

  await check("relay, failed timetable read: a class teacher still goes through", async () => {
    failSlices();
    const r = await relay(classTeacher);
    assert.ok(r.ok, JSON.stringify(r));
  });

  await check("relay, drafts only: a draft-only teacher is refused", async () => {
    setSlices({ published: [], grids: published });
    const r = await relay(subjectTeacher);
    assert.equal(r.ok, false);
    assert.ok(!r.ok && !r.retry && /does not teach/.test(r.error), JSON.stringify(r));
  });

  await check("wiring: the route and the relay read the slices; the bot answers a retry", () => {
    const strip = (f: string) =>
      readFileSync(join(__dirname, "..", f), "utf8")
        .replace(/\/\*[\s\S]*?\*\//g, "")
        .replace(/\/\/.*$/gm, "");
    for (const f of ["app/api/v1/teachers/contacts/route.ts", "lib/teacherContact.server.ts"]) {
      const src = strip(f);
      assert.ok(!/\bloadTimetable\(|ensureTimetableHydratedServer\(|\bfindGrid\(/.test(src), `${f}: no browser loader, no draft grids`);
      assert.ok(/readTimetableStateServer\(/.test(src), `${f}: reads the slices`);
    }
    assert.ok(/r\.retry/.test(strip("lib/waSisBotServer.ts")), "bot: retry message");
  });

  if (failures) {
    console.log(`${failures} check(s) failed`);
    process.exit(1);
  }
  console.log("  all ok");
})();
