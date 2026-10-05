/**
 * Placing one section's week (director, 5 Oct 2026). Pure — no stores — so
 * the rules can be tested: timetableSolver.ts gathers the inputs and saves.
 *
 * Never broken (hard):
 *  - a class has one subject per period;
 *  - a teacher is never in two places at once — compared as CLOCK TIMES, so
 *    a Nursery period and a Class V period on different bells still clash
 *    when they overlap;
 *  - a double period is two back-to-back periods with no break between,
 *    same teacher;
 *  - a subject's most-per-day.
 * Rules (kept on the first pass; the repair pass may bend them, and says so):
 *  - never first / last / straight after lunch.
 * Preferences (scored): morning vs after break, spread across the week, a
 *  teacher not run back-to-back, lighter-loaded teacher first.
 */

import type { TimetableSlot } from "@/lib/timetable";
import { overlaps, type BellFacts, type TimetableSubjectRule } from "@/lib/timetableRules";

export type PlacementUnit = {
  classId: string;
  sectionId: string;
  subjectId: string;
  subjectName: string;
  teacherIds: string[];
  periodsPerWeek: number;
  rule: TimetableSubjectRule;
};

export type PlacementTarget = {
  classId: string;
  sectionId: string;
  weekdays: number[];
  facts: BellFacts;
};

/** teacherId|weekday → clock intervals already taken. */
export type BusyMap = Map<string, [number, number][]>;

export type PlacementNote = { level: "info" | "warn"; text: string };

export type PlacementUnfilled = {
  classId: string;
  sectionId: string;
  subjectId: string;
  remaining: number;
  reason: string;
};

export function markBusy(busy: BusyMap, teacherId: string, weekday: number, at: [number, number]) {
  const k = `${teacherId}|${weekday}`;
  const list = busy.get(k) ?? [];
  list.push(at);
  busy.set(k, list);
}

export function isBusy(busy: BusyMap, teacherId: string, weekday: number, at: [number, number]): boolean {
  return (busy.get(`${teacherId}|${weekday}`) ?? []).some((b) => overlaps(b, at));
}

type Strictness = { rules: boolean };

function ruleAllows(rule: TimetableSubjectRule, facts: BellFacts, periodNo: number): boolean {
  if (rule.avoidFirstPeriod && periodNo === facts.first) return false;
  if (rule.avoidLastPeriod && periodNo === facts.last) return false;
  if (rule.avoidAfterLunch && periodNo === facts.afterLunch) return false;
  return true;
}

function timeScore(rule: TimetableSubjectRule, facts: BellFacts, periodNo: number): number {
  if (rule.timeOfDay === "morning") return facts.morning.has(periodNo) ? 20 : -15;
  if (rule.timeOfDay === "after_break") return facts.afterBreak.has(periodNo) ? 20 : -15;
  return 0;
}

/**
 * Place every unit of one section. `busy` and `load` are shared across
 * sections and updated in place. `existing` slots (kept, not cleared) are
 * respected as occupied.
 */
export function placeSection(input: {
  target: PlacementTarget;
  units: PlacementUnit[];
  busy: BusyMap;
  load: Map<string, number>;
  existing?: TimetableSlot[];
}): { slots: TimetableSlot[]; unfilled: PlacementUnfilled[]; notes: PlacementNote[]; placed: number; scoreSum: number } {
  const { target, busy, load } = input;
  const facts = target.facts;
  const slots: TimetableSlot[] = [...(input.existing ?? [])];
  const used = new Set(slots.map((s) => `${s.weekday}|${s.periodNo}`));
  const unfilled: PlacementUnfilled[] = [];
  const notes: PlacementNote[] = [];
  let placed = 0;
  let scoreSum = 0;

  const dayCount = (subjectId: string, weekday: number) =>
    slots.filter((s) => s.subjectId === subjectId && s.weekday === weekday).length;
  const intervalOf = (periodNo: number) => facts.interval.get(periodNo)!;

  const freeTeacher = (teacherIds: string[], weekday: number, periodNos: number[]): string | null => {
    let best: string | null = null;
    let bestLoad = Infinity;
    for (const tid of teacherIds) {
      if (periodNos.some((p) => isBusy(busy, tid, weekday, intervalOf(p)))) continue;
      const l = load.get(tid) ?? 0;
      if (l < bestLoad) {
        bestLoad = l;
        best = tid;
      }
    }
    return best;
  };

  const put = (u: PlacementUnit, weekday: number, periodNo: number, teacherId: string) => {
    slots.push({ weekday, periodNo, subjectId: u.subjectId, teacherId, roomId: "" });
    used.add(`${weekday}|${periodNo}`);
    markBusy(busy, teacherId, weekday, intervalOf(periodNo));
    load.set(teacherId, (load.get(teacherId) ?? 0) + 1);
    placed += 1;
  };

  const score = (u: PlacementUnit, weekday: number, periodNos: number[], teacherId: string) => {
    let sc = 100;
    sc -= dayCount(u.subjectId, weekday) * 25; // spread across the week
    for (const p of periodNos) sc += timeScore(u.rule, facts, p);
    // A teacher not run three in a row.
    const [a, b] = intervalOf(periodNos[0]!);
    const near = (busy.get(`${teacherId}|${weekday}`) ?? []).filter((x) => x[1] === a || x[0] === b).length;
    sc -= near * 6;
    return sc;
  };

  // Hardest first: doubles, then the fewest teachers, then most periods.
  const order = [...input.units].sort((x, y) => {
    if ((y.rule.doublesPerWeek > 0 ? 1 : 0) !== (x.rule.doublesPerWeek > 0 ? 1 : 0)) {
      return (y.rule.doublesPerWeek > 0 ? 1 : 0) - (x.rule.doublesPerWeek > 0 ? 1 : 0);
    }
    const tx = x.teacherIds.length || 99;
    const ty = y.teacherIds.length || 99;
    if (tx !== ty) return tx - ty;
    return y.periodsPerWeek - x.periodsPerWeek;
  });

  const remaining = new Map<PlacementUnit, number>();

  const placeDoubles = (u: PlacementUnit, wanted: number, strict: Strictness): number => {
    let done = 0;
    while (done < wanted) {
      let best: { wd: number; pair: [number, number]; tid: string; sc: number } | null = null;
      for (const wd of target.weekdays) {
        if (dayCount(u.subjectId, wd) + 2 > u.rule.maxPerDay) continue;
        for (const pair of facts.pairs) {
          if (used.has(`${wd}|${pair[0]}`) || used.has(`${wd}|${pair[1]}`)) continue;
          if (strict.rules && (!ruleAllows(u.rule, facts, pair[0]) || !ruleAllows(u.rule, facts, pair[1]))) continue;
          const tid = freeTeacher(u.teacherIds, wd, pair);
          if (!tid) continue;
          const sc = score(u, wd, pair, tid);
          if (!best || sc > best.sc) best = { wd, pair, tid, sc };
        }
      }
      if (!best) break;
      put(u, best.wd, best.pair[0], best.tid);
      put(u, best.wd, best.pair[1], best.tid);
      scoreSum += best.sc * 2;
      done += 1;
    }
    return done;
  };

  const placeSingles = (u: PlacementUnit, wanted: number, strict: Strictness, maxPerDay: number): number => {
    let done = 0;
    while (done < wanted) {
      let best: { wd: number; p: number; tid: string; sc: number } | null = null;
      for (const wd of target.weekdays) {
        if (dayCount(u.subjectId, wd) >= maxPerDay) continue;
        for (const p of facts.order) {
          if (used.has(`${wd}|${p}`)) continue;
          if (strict.rules && !ruleAllows(u.rule, facts, p)) continue;
          const tid = freeTeacher(u.teacherIds, wd, [p]);
          if (!tid) continue;
          const sc = score(u, wd, [p], tid);
          if (!best || sc > best.sc) best = { wd, p, tid, sc };
        }
      }
      if (!best) break;
      put(u, best.wd, best.p, best.tid);
      scoreSum += best.sc;
      done += 1;
    }
    return done;
  };

  for (const u of order) {
    if (!u.teacherIds.length) {
      unfilled.push({
        classId: u.classId,
        sectionId: u.sectionId,
        subjectId: u.subjectId,
        remaining: u.periodsPerWeek,
        reason: "No teacher for this subject — link one in Staff → Teaching allocation, or set a class teacher",
      });
      continue;
    }
    let left = u.periodsPerWeek;
    const doubles = placeDoubles(u, u.rule.doublesPerWeek, { rules: true });
    left -= doubles * 2;
    if (doubles < u.rule.doublesPerWeek) {
      notes.push({
        level: "warn",
        text: `${u.subjectName}: placed ${doubles} of ${u.rule.doublesPerWeek} double period(s) — no free back-to-back pair with the teacher free; the rest go in as single periods.`,
      });
    }
    left -= placeSingles(u, left, { rules: true }, u.rule.maxPerDay);
    remaining.set(u, left);
  }

  // Repair: bend the "never first/last/after lunch" rules, then allow one
  // more a day — and say so. Clashes and a class's one-subject-per-period
  // are never bent.
  for (const u of order) {
    let left = remaining.get(u) ?? 0;
    if (left <= 0) continue;
    const bentRules = placeSingles(u, left, { rules: false }, u.rule.maxPerDay);
    left -= bentRules;
    const bentMax = left > 0 ? placeSingles(u, left, { rules: false }, u.rule.maxPerDay + 1) : 0;
    left -= bentMax;
    if (bentRules || bentMax) {
      notes.push({
        level: "warn",
        text: `${u.subjectName}: ${bentRules + bentMax} period(s) placed outside its rules${bentMax ? ` (${bentMax} as an extra one in a day)` : ""} — nothing else was free.`,
      });
    }
    if (left > 0) {
      unfilled.push({
        classId: u.classId,
        sectionId: u.sectionId,
        subjectId: u.subjectId,
        remaining: left,
        reason: "No free period with the teacher free (grid full, or the teacher is busy elsewhere at those times)",
      });
    }
  }

  return { slots, unfilled, notes, placed, scoreSum };
}
