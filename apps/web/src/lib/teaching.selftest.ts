/**
 * Teaching delivery regression test.
 *
 * Guards the rule the whole module exists to protect: a period nobody
 * logged is never reported as a period nobody taught.
 *
 * Run: npx tsx src/lib/teaching.selftest.ts
 */
import assert from "node:assert/strict";

import { emptyMastersShell } from "./masters";
import {
  defaultBellTemplate,
  emptyTimetableState,
  type TimetableGrid,
  type TimetableState,
} from "./timetable";
import {
  addResourceLink,
  computeDelivery,
  computeSyllabusProgress,
  dedupeLogs,
  emptyTeachingState,
  importSyllabusUnits,
  listLessonPlans,
  mergeTeachingStates,
  normalizeLessonPlan,
  normalizeResourceLink,
  normalizeSyllabusUnit,
  normalizeTeachingLog,
  normalizeTeachingLogLocation,
  removeSyllabusUnit,
  resolveExpectedPeriods,
  resourcesForUnits,
  safeResourceUrl,
  summarizeByTeacher,
  summarizeCoverage,
  upsertLessonPlan,
  upsertSyllabusUnit,
  upsertTeachingLog,
  type TeachingLog,
  type TeachingState,
} from "./teaching";

console.log("teaching.selftest.ts");

const AY = "2026-27";
/** A Wednesday — asserted below rather than assumed. */
const DATE = "2026-09-16";
const CLASS = "cls_8";
const SECTION = "sec_8a";
const SUBJECT = "sub_math";
const TEACHER = "stf_asha";
const SUBSTITUTE = "stf_ravi";

const masters = emptyMastersShell();
masters.holidays = [];

/**
 * The default policy requires a topic on every taught period. Tests that
 * are about something else (punctuality, backfilling) opt out explicitly
 * rather than carrying a topic they do not care about — the requirement
 * itself is covered by its own case below.
 */
function relaxedState(): TeachingState {
  const base = emptyTeachingState();
  return {
    ...base,
    policy: { ...base.policy, requireTopicOnDelivery: false },
  };
}

function gridFor(weekday: number): TimetableGrid {
  return {
    id: "ttg_1",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: SECTION,
    slots: [
      {
        weekday,
        periodNo: 1,
        subjectId: SUBJECT,
        teacherId: TEACHER,
        roomId: "",
      },
      {
        weekday,
        periodNo: 2,
        subjectId: SUBJECT,
        teacherId: TEACHER,
        roomId: "",
      },
    ],
    updatedAt: "",
  };
}

const weekday = new Date(`${DATE}T12:00:00`).getDay();
assert.equal(weekday, 3, "fixture date should be a Wednesday");

function baseTimetable(): TimetableState {
  const t = emptyTimetableState();
  t.bellTemplate = defaultBellTemplate();
  t.workingWeekdays = [1, 2, 3, 4, 5, 6];
  return t;
}

/* ------------------------------------------------------------------ */
/* 1. An unresolvable schedule refuses — it does not return "no classes" */
/* ------------------------------------------------------------------ */

{
  const t = baseTimetable();
  // A draft grid exists, but nothing is published.
  t.grids = [gridFor(weekday)];
  t.publishedGrids = [];

  const res = resolveExpectedPeriods({
    timetable: t,
    masters,
    academicYearCode: AY,
    date: DATE,
  });

  assert.equal(res.ok, false, "unpublished timetable must refuse");
  if (!res.ok) {
    assert.equal(res.reason, "no_published_timetable");
  }
  // The failure arm carries no `periods` at all, so no caller can read
  // this as an empty-but-valid day.
  assert.ok(
    !("periods" in res),
    "refusal must not carry a periods array",
  );
}

/* ------------------------------------------------------------------ */
/* 2. Non-working weekday and holiday refuse with their own reasons     */
/* ------------------------------------------------------------------ */

{
  const t = baseTimetable();
  t.publishedGrids = [gridFor(weekday)];
  t.workingWeekdays = [1, 2]; // Wednesday excluded

  const res = resolveExpectedPeriods({
    timetable: t,
    masters,
    academicYearCode: AY,
    date: DATE,
  });
  assert.equal(res.ok, false);
  if (!res.ok) assert.equal(res.reason, "non_working_weekday");
}

{
  const t = baseTimetable();
  t.publishedGrids = [gridFor(weekday)];

  const withHoliday = structuredClone(masters);
  withHoliday.holidays = [
    {
      id: "hol_1",
      academicYearCode: AY,
      title: "Local holiday",
      startsOn: DATE,
      endsOn: DATE,
      dayType: "full",
      scope: "school",
      isPublished: true,
      workingOverride: false,
      paidForStaff: true,
    },
  ] as unknown as typeof withHoliday.holidays;

  const res = resolveExpectedPeriods({
    timetable: t,
    masters: withHoliday,
    academicYearCode: AY,
    date: DATE,
  });
  assert.equal(res.ok, false, "a school holiday must refuse, not return 0 periods");
  if (!res.ok) assert.equal(res.reason, "holiday");
}

/* ------------------------------------------------------------------ */
/* 3. Happy path: two periods resolve for the roster teacher            */
/* ------------------------------------------------------------------ */

const timetable = baseTimetable();
timetable.publishedGrids = [gridFor(weekday)];

const expectedAll = resolveExpectedPeriods({
  timetable,
  masters,
  academicYearCode: AY,
  date: DATE,
});
assert.equal(expectedAll.ok, true);
if (!expectedAll.ok) throw new Error("unreachable");
assert.equal(expectedAll.periods.length, 2);
assert.equal(expectedAll.periods[0]!.effectiveStaffId, TEACHER);
assert.equal(expectedAll.periods[0]!.isSubstituted, false);

/* ------------------------------------------------------------------ */
/* 4. Substitution moves the period to the substitute's day             */
/* ------------------------------------------------------------------ */

{
  const t = baseTimetable();
  t.publishedGrids = [gridFor(weekday)];
  t.substitutions = [
    {
      id: "sub_1",
      academicYearCode: AY,
      date: DATE,
      weekday,
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      absentTeacherId: TEACHER,
      substituteTeacherId: SUBSTITUTE,
      source: "manual",
      note: "",
      createdAt: "",
    },
  ];

  const forRoster = resolveExpectedPeriods({
    timetable: t,
    masters,
    academicYearCode: AY,
    date: DATE,
    staffId: TEACHER,
  });
  assert.equal(forRoster.ok, true);
  if (!forRoster.ok) throw new Error("unreachable");
  assert.equal(
    forRoster.periods.length,
    1,
    "a period handed away must leave the roster teacher's day",
  );
  assert.equal(forRoster.periods[0]!.periodNo, 2);

  const forSub = resolveExpectedPeriods({
    timetable: t,
    masters,
    academicYearCode: AY,
    date: DATE,
    staffId: SUBSTITUTE,
  });
  assert.equal(forSub.ok, true);
  if (!forSub.ok) throw new Error("unreachable");
  assert.equal(
    forSub.periods.length,
    1,
    "a period handed over must enter the substitute's day",
  );
  assert.equal(forSub.periods[0]!.isSubstituted, true);
  assert.equal(forSub.periods[0]!.scheduledStaffId, TEACHER);
}

/* ------------------------------------------------------------------ */
/* 5. THE core rule: unlogged is not not_delivered                      */
/* ------------------------------------------------------------------ */

{
  // Mid-morning on the day itself: period 1 (09:00) is well past its
  // grace window, period 2 (09:40) has only just started.
  const now = new Date(`${DATE}T09:50:00+05:30`);

  const rows = computeDelivery({
    expected: expectedAll.periods,
    logs: [],
    academicYearCode: AY,
    now,
  });

  const p1 = rows.find((r) => r.expected.periodNo === 1)!;
  const p2 = rows.find((r) => r.expected.periodNo === 2)!;

  assert.equal(p1.status, "unlogged", "past grace with no log = unlogged");
  assert.equal(p2.status, "pending", "inside grace with no log = pending");

  assert.notEqual(p1.status, "not_delivered");
  assert.notEqual(p2.status, "not_delivered");

  const summary = summarizeCoverage(rows);
  assert.equal(summary.notDelivered, 0, "nothing may be counted as skipped");
  assert.equal(
    summary.deliveryPercent,
    null,
    "with nothing decided, a delivery percent must be refused, not 0 or 100",
  );
  assert.equal(summary.logPercent, 0, "one due period, none logged");
  assert.equal(summary.unlogged, 1);
  assert.equal(summary.pending, 1);
}

/* ------------------------------------------------------------------ */
/* 6. Only an explicit human assertion produces not_delivered           */
/* ------------------------------------------------------------------ */

{
  const state = emptyTeachingState();
  const saved = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: DATE,
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "not_delivered",
      note: "Sent to exam duty",
    },
    { now: new Date(`${DATE}T15:00:00+05:30`), skipBackdateCheck: true },
  );
  assert.equal(saved.ok, true);
  if (!saved.ok) throw new Error("unreachable");

  const rows = computeDelivery({
    expected: expectedAll.periods,
    logs: saved.value.state.logs,
    academicYearCode: AY,
    now: new Date(`${DATE}T15:00:00+05:30`),
  });

  const p1 = rows.find((r) => r.expected.periodNo === 1)!;
  assert.equal(p1.status, "not_delivered");

  const summary = summarizeCoverage(rows);
  assert.equal(summary.notDelivered, 1);
  assert.equal(summary.unlogged, 1, "period 2 is still merely unlogged");
  assert.equal(
    summary.deliveryPercent,
    0,
    "one decided period, not taught => 0%",
  );
  assert.equal(summary.logPercent, 50, "one of two due periods carries a log");
}

/* ------------------------------------------------------------------ */
/* 7. On-time vs late starts                                            */
/* ------------------------------------------------------------------ */

{
  const state = relaxedState();
  const onTime = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: DATE,
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
      // Bell says 09:00; two minutes late is inside tolerance.
      startedAt: `${DATE}T09:02:00+05:30`,
    },
    { now: new Date(`${DATE}T09:02:00+05:30`), skipBackdateCheck: true },
  );
  assert.equal(onTime.ok, true);
  if (!onTime.ok) throw new Error("unreachable");

  const late = upsertTeachingLog(
    onTime.value.state,
    {
      academicYearCode: AY,
      date: DATE,
      periodNo: 2,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
      // Bell says 09:40; twelve minutes late is not.
      startedAt: `${DATE}T09:52:00+05:30`,
    },
    { now: new Date(`${DATE}T09:52:00+05:30`), skipBackdateCheck: true },
  );
  assert.equal(late.ok, true);
  if (!late.ok) throw new Error("unreachable");

  const rows = computeDelivery({
    expected: expectedAll.periods,
    logs: late.value.state.logs,
    academicYearCode: AY,
    now: new Date(`${DATE}T10:30:00+05:30`),
  });

  const summary = summarizeCoverage(rows);
  assert.equal(summary.delivered, 2);
  assert.equal(summary.onTimeStarts, 1);
  assert.equal(summary.lateStarts, 1);
  assert.equal(summary.deliveryPercent, 100);
  assert.equal(summary.logPercent, 100);

  const byTeacher = summarizeByTeacher(rows);
  assert.equal(byTeacher.length, 1);
  assert.equal(byTeacher[0]!.staffId, TEACHER);
  assert.equal(byTeacher[0]!.summary.delivered, 2);
}

/* ------------------------------------------------------------------ */
/* 8. A log with no start stamp is not judged for punctuality           */
/* ------------------------------------------------------------------ */

{
  const state = relaxedState();
  const backfilled = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: DATE,
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
      // Logged after the fact from the web desk — no live start tap.
      startedAt: "",
    },
    { now: new Date(`${DATE}T17:00:00+05:30`), skipBackdateCheck: true },
  );
  assert.equal(backfilled.ok, true);
  if (!backfilled.ok) throw new Error("unreachable");

  const rows = computeDelivery({
    expected: expectedAll.periods,
    logs: backfilled.value.state.logs,
    academicYearCode: AY,
    now: new Date(`${DATE}T17:00:00+05:30`),
  });
  const p1 = rows.find((r) => r.expected.periodNo === 1)!;
  assert.equal(p1.status, "delivered");
  assert.equal(
    p1.startedOnTime,
    null,
    "no start stamp means punctuality is unknown, not late",
  );

  const summary = summarizeCoverage(rows);
  assert.equal(summary.onTimeStarts, 0);
  assert.equal(summary.lateStarts, 0, "an unstamped log must not count as late");
}

/* ------------------------------------------------------------------ */
/* 9. Backdating window is enforced                                     */
/* ------------------------------------------------------------------ */

{
  // relaxedState, and the error text is asserted, so that these two stay
  // tests of the *date* rule. Under the shipped policy a topic-less
  // "delivered" is refused before the date is ever looked at, which would
  // let both assertions pass while proving nothing.
  const state = relaxedState();
  const future = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: "2026-12-31",
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
    },
    { now: new Date(`${DATE}T10:00:00+05:30`) },
  );
  assert.equal(future.ok, false, "cannot log a period in the future");
  assert.match(
    future.ok ? "" : future.error,
    /future/,
    "refused for being in the future, not for some other reason",
  );

  const tooOld = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: "2026-08-01",
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
    },
    { now: new Date(`${DATE}T10:00:00+05:30`) },
  );
  assert.equal(tooOld.ok, false, "beyond the backdate window needs an override");
  assert.match(
    tooOld.ok ? "" : tooOld.error,
    /override/,
    "refused for age, not for a missing topic",
  );

  // The shipped window is one day: a teacher fixing yesterday's forgotten
  // period is normal, filling in last week is not.
  const yesterday = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: "2026-09-15",
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
    },
    { now: new Date(`${DATE}T10:00:00+05:30`) },
  );
  assert.equal(yesterday.ok, true, "yesterday is still inside the window");

  const lastWeek = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: "2026-09-10",
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
    },
    { now: new Date(`${DATE}T10:00:00+05:30`) },
  );
  assert.equal(
    lastWeek.ok,
    false,
    "a week of periods cannot be filled in on Saturday",
  );
}

/* ------------------------------------------------------------------ */
/* 10. Log dedupe: one row per slot, human beats import                 */
/* ------------------------------------------------------------------ */

{
  const common = {
    academicYearCode: AY,
    date: DATE,
    periodNo: 1,
    classId: CLASS,
    sectionId: SECTION,
    subjectId: SUBJECT,
    staffId: TEACHER,
    scheduledStaffId: "",
    startedAt: "",
    endedAt: "",
    unitIds: [],
    note: "",
    sourceRef: "",
    createdBy: TEACHER,
    createdAt: "2026-09-16T10:00:00Z",
  };

  const imported = normalizeTeachingLog({
    ...common,
    id: "tlg_import",
    status: "not_delivered",
    source: "nucleus_import",
    // Newer clock, but a weaker source.
    updatedAt: "2026-09-16T20:00:00Z",
  })!;
  const byTeacher = normalizeTeachingLog({
    ...common,
    id: "tlg_teacher",
    status: "delivered",
    source: "teacher_log",
    updatedAt: "2026-09-16T10:05:00Z",
  })!;

  const deduped = dedupeLogs([imported, byTeacher]);
  assert.equal(deduped.length, 1, "one slot, one log");
  assert.equal(
    deduped[0]!.source,
    "teacher_log",
    "the teacher who was in the room outranks a vendor import",
  );
  assert.equal(deduped[0]!.status, "delivered");
}

/* ------------------------------------------------------------------ */
/* 11. Concurrent teachers must not clobber each other on sync          */
/* ------------------------------------------------------------------ */

{
  function logFor(periodNo: number, staffId: string): TeachingLog {
    return normalizeTeachingLog({
      academicYearCode: AY,
      date: DATE,
      periodNo,
      classId: CLASS,
      sectionId: `sec_${staffId}`,
      subjectId: SUBJECT,
      staffId,
      status: "delivered",
      updatedAt: "2026-09-16T10:00:00Z",
    })!;
  }

  const asha: TeachingState = {
    ...emptyTeachingState(),
    logs: [logFor(1, "asha"), logFor(2, "asha")],
  };
  const ravi: TeachingState = {
    ...emptyTeachingState(),
    logs: [logFor(1, "ravi")],
  };

  const merged = mergeTeachingStates(asha, ravi);
  assert.equal(
    merged.logs.length,
    3,
    "a merge must keep both teachers' logs, not the last pusher's only",
  );
}

/* ------------------------------------------------------------------ */
/* 12. Syllabus progress + pacing                                       */
/* ------------------------------------------------------------------ */

{
  let state = emptyTeachingState();

  const ch1 = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    code: "Ch 1",
    title: "Rational Numbers",
    plannedPeriods: 2,
    targetEndDate: "2026-09-10", // already past on DATE
  });
  assert.equal(ch1.ok, true);
  if (!ch1.ok) throw new Error("unreachable");
  state = ch1.value.state;

  const ch2 = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    code: "Ch 2",
    title: "Linear Equations",
    plannedPeriods: 3,
    targetEndDate: "2026-10-20",
  });
  assert.equal(ch2.ok, true);
  if (!ch2.ok) throw new Error("unreachable");
  state = ch2.value.state;

  // One period taught on Ch 1 — plan says it needs two.
  const logged = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: DATE,
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
      unitIds: [ch1.value.unit.id],
    },
    { now: new Date(`${DATE}T10:00:00+05:30`), skipBackdateCheck: true },
  );
  assert.equal(logged.ok, true);
  if (!logged.ok) throw new Error("unreachable");
  state = logged.value.state;

  const progress = computeSyllabusProgress({
    state,
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    asOf: DATE,
  });

  assert.equal(progress.totalUnits, 2);
  assert.equal(progress.completeUnits, 0);
  assert.equal(progress.plannedPeriods, 5);
  assert.equal(progress.taughtPeriods, 1);

  const u1 = progress.units.find((u) => u.unit.code === "Ch 1")!;
  assert.equal(u1.status, "in_progress");
  assert.equal(u1.periodsTaught, 1);
  assert.equal(u1.firstTaughtOn, DATE);

  const u2 = progress.units.find((u) => u.unit.code === "Ch 2")!;
  assert.equal(u2.status, "not_started");

  assert.ok(progress.pace);
  assert.equal(progress.pace!.status, "behind", "Ch 1 is past its target end");
  assert.equal(progress.pace!.unitsBehind, 1);
}

/* ------------------------------------------------------------------ */
/* 13. A plan with no target dates reports no pace, rather than guessing */
/* ------------------------------------------------------------------ */

{
  let state = emptyTeachingState();
  const unit = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    code: "Ch 1",
    title: "Untimed chapter",
    plannedPeriods: 2,
  });
  assert.equal(unit.ok, true);
  if (!unit.ok) throw new Error("unreachable");
  state = unit.value.state;

  const progress = computeSyllabusProgress({
    state,
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    asOf: DATE,
  });
  assert.equal(
    progress.pace,
    null,
    "no target dates means pace is unknown, not on_track",
  );
}

/* ------------------------------------------------------------------ */
/* 14. An unestimated unit cannot be declared complete                  */
/* ------------------------------------------------------------------ */

{
  const unit = normalizeSyllabusUnit({
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    title: "No period estimate",
    plannedPeriods: 0,
  })!;
  const log = normalizeTeachingLog({
    academicYearCode: AY,
    date: DATE,
    periodNo: 1,
    classId: CLASS,
    sectionId: SECTION,
    subjectId: SUBJECT,
    staffId: TEACHER,
    status: "delivered",
    unitIds: [unit.id],
  })!;

  const progress = computeSyllabusProgress({
    state: { ...emptyTeachingState(), units: [unit], logs: [log] },
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    asOf: DATE,
  });
  assert.equal(progress.units[0]!.status, "unknown");
  assert.equal(
    progress.completeUnits,
    0,
    "a unit with no plan cannot be scored complete",
  );
}

/* ------------------------------------------------------------------ */
/* 15. Normalizers drop rows that cannot be placed                      */
/* ------------------------------------------------------------------ */

{
  assert.equal(
    normalizeSyllabusUnit({ title: "Orphan", classId: "", subjectId: "" }),
    null,
    "a unit with no class/subject/year would match every query",
  );
  assert.equal(
    normalizeTeachingLog({ date: "not-a-date", periodNo: 1 }),
    null,
  );
  assert.equal(
    normalizeTeachingLog({
      academicYearCode: AY,
      date: DATE,
      periodNo: 1,
      classId: CLASS,
      sectionId: "",
    }),
    null,
    "a log with no section cannot be pinned to a slot",
  );
}

/* ------------------------------------------------------------------ */
/* 16. Chapter → topic hierarchy and rollup                             */
/* ------------------------------------------------------------------ */

{
  let state = emptyTeachingState();

  const chapter = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    code: "Ch 1",
    title: "Rational Numbers",
  });
  assert.equal(chapter.ok, true);
  if (!chapter.ok) throw new Error("unreachable");
  state = chapter.value.state;
  assert.equal(chapter.value.unit.level, "chapter");
  assert.equal(chapter.value.unit.parentId, null);

  const t1 = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    parentId: chapter.value.unit.id,
    title: "Properties on the number line",
    plannedPeriods: 1,
  });
  assert.equal(t1.ok, true);
  if (!t1.ok) throw new Error("unreachable");
  state = t1.value.state;
  assert.equal(t1.value.unit.level, "topic", "a unit with a parent is a topic");

  const t2 = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    parentId: chapter.value.unit.id,
    title: "Operations and closure",
    plannedPeriods: 2,
  });
  assert.equal(t2.ok, true);
  if (!t2.ok) throw new Error("unreachable");
  state = t2.value.state;

  // Teach the first topic to completion, leave the second untouched.
  const taught = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: DATE,
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
      unitIds: [t1.value.unit.id],
    },
    { now: new Date(`${DATE}T10:00:00+05:30`), skipBackdateCheck: true },
  );
  assert.equal(taught.ok, true);
  if (!taught.ok) throw new Error("unreachable");
  state = taught.value.state;

  const progress = computeSyllabusProgress({
    state,
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    asOf: DATE,
  });

  assert.equal(progress.totalUnits, 1, "one chapter at the top level");
  assert.equal(progress.totalTopics, 2);
  assert.equal(progress.completeTopics, 1);

  const ch = progress.units[0]!;
  assert.equal(ch.topics.length, 2, "topics hang off their chapter");
  assert.equal(
    ch.periodsTaught,
    1,
    "teaching a topic advances its chapter",
  );
  assert.equal(
    ch.status,
    "in_progress",
    "a chapter is not complete while one of its topics is untaught",
  );
  assert.notEqual(ch.status, "complete");

  // The chapter itself has no estimate, but its topics do — the plan
  // total must come from the topics, not be zero and not double-count.
  assert.equal(progress.plannedPeriods, 3);
  assert.equal(progress.taughtPeriods, 1);
}

/* ------------------------------------------------------------------ */
/* 17. Finishing every topic completes the chapter                      */
/* ------------------------------------------------------------------ */

{
  let state = emptyTeachingState();
  const chapter = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    title: "One-topic chapter",
  });
  if (!chapter.ok) throw new Error("unreachable");
  state = chapter.value.state;

  const topic = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    parentId: chapter.value.unit.id,
    title: "Only topic",
    plannedPeriods: 1,
  });
  if (!topic.ok) throw new Error("unreachable");
  state = topic.value.state;

  const taught = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: DATE,
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
      unitIds: [topic.value.unit.id],
    },
    { now: new Date(`${DATE}T10:00:00+05:30`), skipBackdateCheck: true },
  );
  if (!taught.ok) throw new Error("unreachable");
  state = taught.value.state;

  const progress = computeSyllabusProgress({
    state,
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    asOf: DATE,
  });
  assert.equal(progress.units[0]!.status, "complete");
  assert.equal(progress.completeUnits, 1);
}

/* ------------------------------------------------------------------ */
/* 18. A period naming both a chapter and its topic counts once         */
/* ------------------------------------------------------------------ */

{
  let state = emptyTeachingState();
  const chapter = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    title: "Chapter",
    plannedPeriods: 2,
  });
  if (!chapter.ok) throw new Error("unreachable");
  state = chapter.value.state;

  const topic = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    parentId: chapter.value.unit.id,
    title: "Topic",
    plannedPeriods: 2,
  });
  if (!topic.ok) throw new Error("unreachable");
  state = topic.value.state;

  const taught = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: DATE,
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
      unitIds: [chapter.value.unit.id, topic.value.unit.id],
    },
    { now: new Date(`${DATE}T10:00:00+05:30`), skipBackdateCheck: true },
  );
  if (!taught.ok) throw new Error("unreachable");
  state = taught.value.state;

  const progress = computeSyllabusProgress({
    state,
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    asOf: DATE,
  });
  assert.equal(
    progress.taughtPeriods,
    1,
    "one period is one period, however many units it named",
  );
  assert.equal(progress.units[0]!.periodsTaught, 1);
  // The chapter's estimate is superseded by its topic's.
  assert.equal(progress.plannedPeriods, 2);
}

/* ------------------------------------------------------------------ */
/* 19. Two levels only; orphan topics are refused                       */
/* ------------------------------------------------------------------ */

{
  let state = emptyTeachingState();
  const chapter = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    title: "Chapter",
  });
  if (!chapter.ok) throw new Error("unreachable");
  state = chapter.value.state;

  const topic = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    parentId: chapter.value.unit.id,
    title: "Topic",
  });
  if (!topic.ok) throw new Error("unreachable");
  state = topic.value.state;

  const nested = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    parentId: topic.value.unit.id,
    title: "Sub-topic",
  });
  assert.equal(nested.ok, false, "no third level");

  const orphan = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    parentId: "syu_does_not_exist",
    title: "Orphan",
  });
  assert.equal(orphan.ok, false, "a topic needs a real parent");
}

/* ------------------------------------------------------------------ */
/* 20. Legacy flat units normalize to chapters                          */
/* ------------------------------------------------------------------ */

{
  // Exactly the shape stored before the hierarchy existed.
  const legacy = normalizeSyllabusUnit({
    id: "syu_legacy",
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    code: "Ch 1",
    title: "Written before topics existed",
    plannedPeriods: 3,
  })!;
  assert.equal(legacy.level, "chapter");
  assert.equal(legacy.parentId, null);
  assert.deepEqual(legacy.resources, []);

  // A row claiming to be a topic but with no parent must not become an
  // invisible orphan — it falls back to being a chapter.
  const orphaned = normalizeSyllabusUnit({
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    title: "Topic with no parent",
    level: "topic",
  })!;
  assert.equal(orphaned.level, "chapter");
  assert.equal(orphaned.parentId, null);
}

/* ------------------------------------------------------------------ */
/* 21. Resource URLs: only http(s) survives                             */
/* ------------------------------------------------------------------ */

{
  assert.equal(safeResourceUrl("javascript:alert(1)"), null);
  assert.equal(safeResourceUrl("JavaScript:alert(1)"), null);
  assert.equal(safeResourceUrl("data:text/html,<script>x</script>"), null);
  assert.equal(safeResourceUrl("file:///etc/passwd"), null);
  assert.equal(safeResourceUrl("vbscript:msgbox"), null);
  assert.equal(safeResourceUrl(""), null);
  assert.equal(safeResourceUrl("   "), null);

  assert.ok(safeResourceUrl("https://books.example.com/viii/math.pdf"));
  assert.ok(safeResourceUrl("http://books.example.com/x"));
  // A bare host is assumed https rather than left scheme-less.
  assert.equal(
    safeResourceUrl("books.example.com/viii"),
    "https://books.example.com/viii",
  );

  // The unsafe ones must not merely be flagged — they must not persist.
  assert.equal(
    normalizeResourceLink({ title: "bad", url: "javascript:alert(1)" }),
    null,
  );
}

/* ------------------------------------------------------------------ */
/* 22. Attaching e-book links to a chapter and a lesson plan            */
/* ------------------------------------------------------------------ */

{
  let state = emptyTeachingState();
  const chapter = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    title: "Rational Numbers",
  });
  if (!chapter.ok) throw new Error("unreachable");
  state = chapter.value.state;

  const topic = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    parentId: chapter.value.unit.id,
    title: "Number line",
  });
  if (!topic.ok) throw new Error("unreachable");
  state = topic.value.state;

  const bad = addResourceLink(
    state,
    { kind: "unit", id: chapter.value.unit.id },
    { title: "Evil", url: "javascript:alert(1)" },
  );
  assert.equal(bad.ok, false, "an unsafe link is refused, not stored");

  const good = addResourceLink(
    state,
    { kind: "unit", id: chapter.value.unit.id },
    {
      kind: "ebook",
      title: "Class VIII Maths e-book",
      url: "books.example.com/viii/maths",
      locator: "Ch 1, p. 12",
    },
    TEACHER,
  );
  assert.equal(good.ok, true);
  if (!good.ok) throw new Error("unreachable");
  state = good.value.state;
  assert.equal(good.value.resource.url, "https://books.example.com/viii/maths");

  const plan = upsertLessonPlan(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    title: "Intro to rationals",
    unitIds: [topic.value.unit.id],
    objectives: "Place rationals on a number line",
  });
  assert.equal(plan.ok, true);
  if (!plan.ok) throw new Error("unreachable");
  state = plan.value.state;

  const planRes = addResourceLink(
    state,
    { kind: "lessonPlan", id: plan.value.plan.id },
    { kind: "video", title: "Number line demo", url: "https://vid.example.com/1" },
  );
  assert.equal(planRes.ok, true);
  if (!planRes.ok) throw new Error("unreachable");
  state = planRes.value.state;

  // Teaching the topic should surface the topic's chapter e-book AND the
  // lesson plan's video.
  const forPeriod = resourcesForUnits(
    state,
    [topic.value.unit.id],
    plan.value.plan.id,
  );
  assert.equal(forPeriod.length, 2, "chapter resource inherits down to topic");
  assert.ok(forPeriod.some((r) => r.kind === "ebook"));
  assert.ok(forPeriod.some((r) => r.kind === "video"));

  // Removing the chapter takes its topics, its links, and the plan's
  // reference to them.
  const pruned = removeSyllabusUnit(state, chapter.value.unit.id);
  assert.equal(pruned.units.length, 0, "chapter and its topics both go");
  assert.deepEqual(
    pruned.lessonPlans[0]!.unitIds,
    [],
    "the plan must not keep pointing at a deleted topic",
  );
}

/* ------------------------------------------------------------------ */
/* 23. A lesson plan cannot claim units from another subject            */
/* ------------------------------------------------------------------ */

{
  let state = emptyTeachingState();
  const mine = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    title: "Maths chapter",
  });
  if (!mine.ok) throw new Error("unreachable");
  state = mine.value.state;

  const other = upsertSyllabusUnit(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: "sub_science",
    title: "Science chapter",
  });
  if (!other.ok) throw new Error("unreachable");
  state = other.value.state;

  const crossed = upsertLessonPlan(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    title: "Confused lesson",
    unitIds: [other.value.unit.id],
  });
  assert.equal(crossed.ok, false);

  const untitled = upsertLessonPlan(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    title: "   ",
  });
  assert.equal(untitled.ok, false, "a lesson plan needs a title");

  const good = upsertLessonPlan(state, {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    title: "Proper lesson",
    unitIds: [mine.value.unit.id],
  });
  assert.equal(good.ok, true);
  if (!good.ok) throw new Error("unreachable");
  assert.equal(
    listLessonPlans(good.value.state, {
      academicYearCode: AY,
      classId: CLASS,
      subjectId: SUBJECT,
    }).length,
    1,
  );
}

/* ------------------------------------------------------------------ */
/* 24. Lesson plans survive a concurrent merge                          */
/* ------------------------------------------------------------------ */

{
  const asha: TeachingState = {
    ...emptyTeachingState(),
    lessonPlans: [
      normalizeLessonPlan({
        id: "lpl_asha",
        academicYearCode: AY,
        classId: CLASS,
        subjectId: SUBJECT,
        title: "Asha's lesson",
        updatedAt: "2026-09-16T10:00:00Z",
      })!,
    ],
  };
  const ravi: TeachingState = {
    ...emptyTeachingState(),
    lessonPlans: [
      normalizeLessonPlan({
        id: "lpl_ravi",
        academicYearCode: AY,
        classId: CLASS,
        subjectId: SUBJECT,
        title: "Ravi's lesson",
        updatedAt: "2026-09-16T10:00:00Z",
      })!,
    ],
  };
  const merged = mergeTeachingStates(asha, ravi);
  assert.equal(merged.lessonPlans.length, 2, "both teachers keep their plans");
}

/* ------------------------------------------------------------------ */
/* 25. Bulk syllabus import (the OCR path)                              */
/* ------------------------------------------------------------------ */

{
  let state = emptyTeachingState();
  const batch = {
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    chapters: [
      {
        code: "1",
        title: "Rational Numbers",
        topics: [
          { code: "1.1", title: "Introduction" },
          { code: "1.2", title: "Properties" },
        ],
      },
      { code: "2", title: "Linear Equations", topics: [] },
    ],
  };

  const first = importSyllabusUnits(state, batch);
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("unreachable");
  state = first.value.state;
  assert.equal(first.value.summary.chaptersAdded, 2);
  assert.equal(first.value.summary.topicsAdded, 2);

  const progress = computeSyllabusProgress({
    state,
    academicYearCode: AY,
    classId: CLASS,
    subjectId: SUBJECT,
    asOf: DATE,
  });
  assert.equal(progress.totalUnits, 2);
  assert.equal(progress.totalTopics, 2);
  assert.equal(progress.units[0]!.topics[0]!.unit.title, "Introduction");

  // Re-importing the same page must not duplicate the plan.
  const again = importSyllabusUnits(state, batch);
  assert.equal(
    again.ok,
    false,
    "a re-scan of the same page adds nothing and says so",
  );

  // A page with one new chapter adds only that one.
  const extended = importSyllabusUnits(state, {
    ...batch,
    chapters: [
      ...batch.chapters,
      { code: "3", title: "Data Handling", topics: [] },
    ],
  });
  assert.equal(extended.ok, true);
  if (!extended.ok) throw new Error("unreachable");
  assert.equal(extended.value.summary.chaptersAdded, 1);
  assert.ok(extended.value.summary.skipped.includes("Rational Numbers"));

  // Titles differing only by case/spacing are the same chapter.
  const noisy = importSyllabusUnits(extended.value.state, {
    ...batch,
    chapters: [{ title: "  rational   numbers ", topics: [] }],
  });
  assert.equal(noisy.ok, false, "case and spacing must not create a duplicate");
}

/* ------------------------------------------------------------------ */
/* 26. Import refuses without a class/subject, and on an empty batch    */
/* ------------------------------------------------------------------ */

{
  const state = emptyTeachingState();
  assert.equal(
    importSyllabusUnits(state, {
      academicYearCode: AY,
      classId: "",
      subjectId: SUBJECT,
      chapters: [{ title: "Orphan" }],
    }).ok,
    false,
  );
  assert.equal(
    importSyllabusUnits(state, {
      academicYearCode: AY,
      classId: CLASS,
      subjectId: SUBJECT,
      chapters: [{ title: "   " }],
    }).ok,
    false,
    "blank titles are not an import",
  );
}

/* ------------------------------------------------------------------ */
/* 27. By default a taught period must name what was covered            */
/* ------------------------------------------------------------------ */

{
  const state = emptyTeachingState();
  assert.equal(
    state.policy.requireTopicOnDelivery,
    true,
    "the shipped default asks teachers what they covered",
  );

  const noTopic = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: DATE,
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
    },
    { now: new Date(`${DATE}T10:00:00+05:30`), skipBackdateCheck: true },
  );
  assert.equal(noTopic.ok, false, "delivered with no topic is refused");

  // Marking a period as NOT taught must stay possible without a topic —
  // there is nothing covered to name.
  const notTaught = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: DATE,
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "not_delivered",
    },
    { now: new Date(`${DATE}T10:00:00+05:30`), skipBackdateCheck: true },
  );
  assert.equal(
    notTaught.ok,
    true,
    "a period that did not happen has no topic to record",
  );
}

/* ------------------------------------------------------------------ */
/* 28. A substituted period must name its topic too                     */
/* ------------------------------------------------------------------ */

{
  // The API rewrites a substitute's "delivered" into "substituted" before
  // saving, so a rule that only looked at "delivered" exempted every
  // covered period — the ones whose syllabus position is hardest to
  // reconstruct afterwards.
  const state = emptyTeachingState();
  const noTopic = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: DATE,
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: SUBSTITUTE,
      scheduledStaffId: TEACHER,
      status: "substituted",
    },
    { now: new Date(`${DATE}T10:00:00+05:30`), skipBackdateCheck: true },
  );
  assert.equal(
    noTopic.ok,
    false,
    "a substitute cannot log a taught period without naming the topic",
  );
}

/* ------------------------------------------------------------------ */
/* 29. Campus-presence check: unknown never hardens into a verdict      */
/* ------------------------------------------------------------------ */

{
  assert.equal(
    normalizeTeachingLogLocation(undefined).check,
    "unknown",
    "a log with no fix is unknown, not off campus",
  );
  assert.equal(
    normalizeTeachingLogLocation({ check: "nonsense" as never }).check,
    "unknown",
  );

  // An unknown verdict must not carry a distance: "0 m from campus" is
  // the strongest confirmation of presence the report can print, and
  // nothing measured it.
  const strayDistance = normalizeTeachingLogLocation({
    check: "unknown",
    distanceM: 0,
    accuracyM: 5,
    checkedAt: "2026-09-16T10:00:00Z",
  });
  assert.equal(strayDistance.distanceM, null, "unknown carries no distance");
  assert.equal(strayDistance.checkedAt, "", "unknown carries no timestamp");

  const off = normalizeTeachingLogLocation({
    check: "off_campus",
    distanceM: 4210.6,
    accuracyM: 12,
    checkedAt: "2026-09-16T10:00:00Z",
  });
  assert.equal(off.check, "off_campus");
  assert.equal(off.distanceM, 4211, "distance is rounded to whole metres");

  // A log saved without a fresh fix must not inherit the previous one.
  const state = relaxedState();
  const first = upsertTeachingLog(
    state,
    {
      academicYearCode: AY,
      date: DATE,
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
      location: {
        check: "on_campus",
        distanceM: 20,
        accuracyM: 8,
        checkedAt: "2026-09-16T10:00:00Z",
      },
    },
    { now: new Date(`${DATE}T10:00:00+05:30`), skipBackdateCheck: true },
  );
  assert.equal(first.ok, true);
  assert.equal(first.ok && first.value.log.location.check, "on_campus");

  const edited = upsertTeachingLog(
    first.ok ? first.value.state : state,
    {
      academicYearCode: AY,
      date: DATE,
      periodNo: 1,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
      note: "corrected from the office desktop",
    },
    { now: new Date(`${DATE}T11:00:00+05:30`), skipBackdateCheck: true },
  );
  assert.equal(
    edited.ok && edited.value.log.location.check,
    "unknown",
    "an edit with no fix must not inherit the earlier on-campus evidence",
  );
}

/* ------------------------------------------------------------------ */
/* 30. Coverage counts off-campus logs against those actually checked   */
/* ------------------------------------------------------------------ */

{
  const timetable = baseTimetable();
  timetable.publishedGrids = [gridFor(weekday)];
  const expected = resolveExpectedPeriods({
    timetable,
    masters,
    academicYearCode: AY,
    date: DATE,
    staffId: TEACHER,
  });
  assert.equal(expected.ok, true);
  if (!expected.ok) throw new Error("unreachable");

  const logFor = (
    periodNo: number,
    location: TeachingLog["location"],
  ): TeachingLog =>
    normalizeTeachingLog({
      academicYearCode: AY,
      date: DATE,
      periodNo,
      classId: CLASS,
      sectionId: SECTION,
      subjectId: SUBJECT,
      staffId: TEACHER,
      status: "delivered",
      unitIds: ["u1"],
      location,
    })!;

  // One period logged from well outside the fence; the other never
  // logged at all.
  const rows = computeDelivery({
    expected: expected.periods,
    logs: [
      logFor(expected.periods[0].periodNo, {
        check: "off_campus",
        distanceM: 6200,
        accuracyM: 10,
        checkedAt: "2026-09-16T11:00:00Z",
      }),
    ],
    academicYearCode: AY,
    now: new Date(`${DATE}T23:00:00+05:30`),
  });

  const summary = summarizeCoverage(rows);
  assert.equal(summary.expectedPeriods, 2);
  assert.equal(summary.locationChecked, 1, "only logs with a fix are counted");
  assert.equal(summary.offCampus, 1);
  assert.equal(
    summary.unlogged,
    1,
    "an unlogged period is not evidence about anybody's location",
  );
}

console.log("  ✓ all teaching assertions passed");
