/**
 * Self-test: npx tsx src/lib/timetableRules.selftest.ts
 * Timetable rules + placement: bell facts, default rules, double periods,
 * most-per-day, avoided periods, and clashes across two bell schedules.
 */
import assert from "node:assert/strict";
import type { BellPeriod } from "./timetable";
import {
  bellFacts,
  defaultSubjectRule,
  effectiveSubjectRule,
  normalizeSubjectRule,
  subjectKind,
  type TimetableSubjectRule,
} from "./timetableRules";
import { isBusy, markBusy, placeSection, type BusyMap, type PlacementUnit } from "./timetablePlacement";
import { buildTimetableRulesPrompt, parseTimetableRulesSuggestion } from "./timetableRulesAi";

const p = (no: number, start: string, end: string, kind: BellPeriod["kind"] = "teaching", label = `P${no}`): BellPeriod => ({
  no,
  label,
  startTime: start,
  endTime: end,
  kind,
});

// Main school: P1 P2 P3 | recess | P4 P5 | lunch | P6 P7
const MAIN: BellPeriod[] = [
  p(0, "07:45", "08:00", "assembly", "Assembly"),
  p(1, "08:00", "08:40"),
  p(2, "08:40", "09:20"),
  p(3, "09:20", "10:00"),
  p(90, "10:00", "10:15", "break", "Recess"),
  p(4, "10:15", "10:55"),
  p(5, "10:55", "11:35"),
  p(91, "11:35", "12:05", "break", "Lunch"),
  p(6, "12:05", "12:45"),
  p(7, "12:45", "13:25"),
];
// Pre-primary: shorter periods, different times.
const PRE: BellPeriod[] = [
  p(1, "08:00", "08:30"),
  p(2, "08:30", "09:00"),
  p(90, "09:00", "09:20", "break", "Snack"),
  p(3, "09:20", "09:50"),
  p(4, "09:50", "10:20"),
];

// ── bell facts ──
const f = bellFacts(MAIN);
assert.deepEqual(f.order, [1, 2, 3, 4, 5, 6, 7]);
assert.deepEqual(f.pairs, [[1, 2], [2, 3], [4, 5], [6, 7]], "no pair across a break");
assert.deepEqual([...f.morning], [1, 2, 3]);
assert.equal(f.first, 1);
assert.equal(f.last, 7);
assert.equal(f.afterLunch, 6);
assert.deepEqual(f.interval.get(4), [615, 655]);
const fp = bellFacts(PRE);
assert.equal(fp.afterLunch, 3, "the only break counts as lunch");

// ── subject kinds and defaults ──
assert.equal(subjectKind({ id: "a", code: "MATH", nameEn: "Mathematics", category: "scholastic" }), "core");
assert.equal(subjectKind({ id: "b", code: "PE", nameEn: "Physical Education", category: "co_scholastic" }), "active");
assert.equal(subjectKind({ id: "c", code: "ART", nameEn: "Art Education", category: "co_scholastic" }), "art");
assert.equal(subjectKind({ id: "d", code: "COMP", nameEn: "Computer", category: "scholastic" }), "lab");
const pe = defaultSubjectRule("c1", { id: "pe", code: "PE", nameEn: "Games", category: "co_scholastic" }, 4, false);
assert.equal(pe.avoidFirstPeriod, true);
assert.equal(pe.avoidAfterLunch, true);
assert.equal(pe.doublesPerWeek, 1);
const engPre = defaultSubjectRule("c1", { id: "en", code: "ENG", nameEn: "English", category: "scholastic" }, 6, true);
assert.equal(engPre.maxPerDay, 2, "pre-primary literacy twice a day");
assert.equal(engPre.timeOfDay, "morning");
// Effective rule never asks for more doubles than the load holds; a double needs 2 a day.
const eff = effectiveSubjectRule(
  [{ ...pe, doublesPerWeek: 5, maxPerDay: 1 }],
  "c1",
  { id: "pe", code: "PE", nameEn: "Games" },
  3,
  false,
);
assert.equal(eff.doublesPerWeek, 1);
assert.equal(eff.maxPerDay, 2);
assert.equal(normalizeSubjectRule({ classId: "", subjectId: "x" }), null);
assert.equal(normalizeSubjectRule({ classId: "c", subjectId: "x", maxPerDay: 99 })!.maxPerDay, 4);

// ── placement ──
const rule = (over: Partial<TimetableSubjectRule>): TimetableSubjectRule => ({
  classId: "c5",
  subjectId: "x",
  doublesPerWeek: 0,
  timeOfDay: "any",
  maxPerDay: 1,
  avoidFirstPeriod: false,
  avoidLastPeriod: false,
  avoidAfterLunch: false,
  ...over,
});
const unit = (subjectId: string, periods: number, teacherIds: string[], r: Partial<TimetableSubjectRule> = {}): PlacementUnit => ({
  classId: "c5",
  sectionId: "s1",
  subjectId,
  subjectName: subjectId,
  teacherIds,
  periodsPerWeek: periods,
  rule: rule({ subjectId, ...r }),
});
const days = [1, 2, 3, 4, 5, 6];

{
  const busy: BusyMap = new Map();
  const r = placeSection({
    target: { classId: "c5", sectionId: "s1", weekdays: days, facts: f },
    units: [
      unit("art", 4, ["tArt"], { doublesPerWeek: 2, maxPerDay: 2, avoidFirstPeriod: true }),
      unit("math", 6, ["tMath"], { timeOfDay: "morning" }),
      unit("pe", 3, ["tPe"], { avoidFirstPeriod: true, avoidAfterLunch: true, timeOfDay: "after_break" }),
    ],
    busy,
    load: new Map(),
  });
  assert.equal(r.unfilled.length, 0);
  assert.equal(r.placed, 13);
  // Art: two doubles, each a real back-to-back pair on one day.
  const art = r.slots.filter((s) => s.subjectId === "art");
  const artDays = [...new Set(art.map((s) => s.weekday))];
  assert.equal(artDays.length, 2);
  for (const d of artDays) {
    const ps = art.filter((s) => s.weekday === d).map((s) => s.periodNo).sort();
    assert.ok(f.pairs.some(([a, b]) => a === ps[0] && b === ps[1]), `art double on day ${d} is a pair: ${ps}`);
    assert.notEqual(ps[0], 1, "art never first period");
  }
  // Maths: one a day (max 1), all in the morning.
  const math = r.slots.filter((s) => s.subjectId === "math");
  assert.equal(new Set(math.map((s) => s.weekday)).size, 6);
  assert.ok(math.every((s) => f.morning.has(s.periodNo)), "maths in the morning");
  // PE never first, never straight after lunch.
  const peSlots = r.slots.filter((s) => s.subjectId === "pe");
  assert.ok(peSlots.every((s) => s.periodNo !== 1 && s.periodNo !== 6));
  // One subject per period.
  const cells = r.slots.map((s) => `${s.weekday}|${s.periodNo}`);
  assert.equal(new Set(cells).size, cells.length);
}

// A teacher on two bell schedules: busy 08:30–09:00 with pre-primary P2 →
// main P1 (08:00–08:40) and P2 (08:40–09:20) both overlap; P3 does not.
{
  const busy: BusyMap = new Map();
  markBusy(busy, "tMusic", 1, fp.interval.get(2)!);
  assert.ok(isBusy(busy, "tMusic", 1, f.interval.get(1)!));
  assert.ok(isBusy(busy, "tMusic", 1, f.interval.get(2)!));
  assert.ok(!isBusy(busy, "tMusic", 1, f.interval.get(3)!));
  assert.ok(!isBusy(busy, "tMusic", 2, f.interval.get(1)!), "another day is free");
  const r = placeSection({
    target: { classId: "c5", sectionId: "s1", weekdays: [1], facts: f },
    units: [unit("music", 1, ["tMusic"], { timeOfDay: "morning" })],
    busy,
    load: new Map(),
  });
  assert.equal(r.slots[0]?.periodNo, 3, "only the non-overlapping morning period");
}

// No teacher → unfilled with the reason; rules bent in repair are reported.
{
  const r = placeSection({
    target: { classId: "c5", sectionId: "s1", weekdays: [1], facts: f },
    units: [
      unit("hindi", 2, []),
      unit("pe", 7, ["tPe"], { avoidFirstPeriod: true, maxPerDay: 7 }),
    ],
    busy: new Map(),
    load: new Map(),
  });
  assert.equal(r.unfilled.find((u) => u.subjectId === "hindi")?.remaining, 2);
  assert.ok(r.unfilled.find((u) => u.subjectId === "hindi")!.reason.startsWith("No teacher"));
  assert.equal(r.slots.filter((s) => s.subjectId === "pe").length, 7, "the day is filled");
  assert.ok(r.notes.some((n) => n.text.includes("outside its rules")), "first period used only by bending, and said");
}

// ── AI suggestion parser: only the class's subjects, within the week ──
{
  const facts = {
    className: "LKG",
    stage: "pre-primary",
    weeklyCapacity: 10,
    periodsPerDay: 2,
    periodMinutes: 30,
    subjects: [
      { id: "en", name: "English", kind: "scholastic" as const, currentPeriodsPerWeek: 4 },
      { id: "art", name: "Art", kind: "co-scholastic" as const, currentPeriodsPerWeek: 2 },
    ],
  };
  const prompt = buildTimetableRulesPrompt(facts);
  assert.ok(prompt.userMessage.includes("en · English · scholastic · 4"));
  assert.equal(parseTimetableRulesSuggestion("not json", facts, "lkg"), null);
  assert.equal(parseTimetableRulesSuggestion('{"subjects":[{"id":"ghost","periodsPerWeek":3}]}', facts, "lkg"), null);
  const got = parseTimetableRulesSuggestion(
    JSON.stringify({
      subjects: [
        { id: "en", periodsPerWeek: 12, doublesPerWeek: 0, timeOfDay: "morning", maxPerDay: 2, why: "literacy daily" },
        { id: "art", periodsPerWeek: 8, doublesPerWeek: 9, timeOfDay: "after_break", maxPerDay: 2, avoidFirstPeriod: true },
        { id: "ghost", periodsPerWeek: 5 },
        { id: "en", periodsPerWeek: 1 },
      ],
    }),
    facts,
    "lkg",
  )!;
  assert.equal(got.length, 2, "unknown and duplicate ids dropped");
  assert.ok(got.reduce((n, s) => n + s.periodsPerWeek, 0) <= 10, "scaled within the week");
  const art = got.find((s) => s.subjectId === "art")!;
  assert.ok(art.rule.doublesPerWeek <= Math.floor(art.periodsPerWeek / 2), "doubles fit the load");
  assert.equal(art.rule.classId, "lkg");
  assert.equal(got.find((s) => s.subjectId === "en")!.rule.timeOfDay, "morning");
}

console.log("timetableRules selftest: ok");
