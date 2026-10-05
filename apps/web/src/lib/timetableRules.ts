/**
 * Timetable rules (director, 5 Oct 2026): how each subject of a class is
 * placed — double periods, time of day, how many a day, periods to avoid —
 * and the bell facts the solver needs to honour them (which teaching periods
 * are back-to-back, which are before the first break, which follows lunch).
 *
 * Pure. Defaults come from the subject's own Masters category
 * (scholastic / co-scholastic) and name, and from the class's stage: in
 * Nursery–UKG literacy and numeracy may come twice a day, play and art run
 * as double periods.
 */

import type { BellPeriod } from "@/lib/timetable";

export type TimeOfDay = "morning" | "after_break" | "any";

export type TimetableSubjectRule = {
  classId: string;
  subjectId: string;
  /** Double (back-to-back) periods wanted per week; each uses 2 of the weekly periods. */
  doublesPerWeek: number;
  timeOfDay: TimeOfDay;
  /** Most periods of this subject in one day (a double counts 2). */
  maxPerDay: number;
  avoidFirstPeriod: boolean;
  avoidLastPeriod: boolean;
  avoidAfterLunch: boolean;
};

export type SubjectLike = {
  id: string;
  code: string;
  nameEn: string;
  category?: string;
  coScholasticArea?: string;
};

/** Words that mark a subject's kind when Masters doesn't say. */
const ACTIVE_RX = /\b(p\.?\s?e\.?|physical|sport|games?|yoga|dance|drill|play)\b/i;
const ART_RX = /\b(art|craft|drawing|painting|music|vocal|instrument|theatre|drama)\b/i;
const LAB_RX = /\b(computer|ict|lab|practical|robotics|coding)\b/i;
const CORE_RX = /\b(math|maths|mathematics|english|hindi|sanskrit|science|evs|environment|social|numeracy|literacy|language|reading|writing)\b/i;

export function subjectKind(s: SubjectLike): "core" | "active" | "art" | "lab" | "other" {
  const text = `${s.nameEn} ${s.code} ${s.coScholasticArea || ""}`;
  if (ACTIVE_RX.test(text)) return "active";
  if (ART_RX.test(text)) return "art";
  if (LAB_RX.test(text)) return "lab";
  if (s.category === "co_scholastic") return "other";
  if (CORE_RX.test(text) || s.category === "scholastic") return "core";
  return "other";
}

/**
 * The default rule for one subject of one class, before anyone edits it.
 * preprimary = Nursery / LKG / UKG.
 */
export function defaultSubjectRule(
  classId: string,
  subject: SubjectLike,
  periodsPerWeek: number,
  preprimary: boolean,
): TimetableSubjectRule {
  const kind = subjectKind(subject);
  const base: TimetableSubjectRule = {
    classId,
    subjectId: subject.id,
    doublesPerWeek: 0,
    timeOfDay: "any",
    maxPerDay: 1,
    avoidFirstPeriod: false,
    avoidLastPeriod: false,
    avoidAfterLunch: false,
  };
  switch (kind) {
    case "core":
      return {
        ...base,
        timeOfDay: "morning",
        // Little children get literacy / numeracy twice a day in short bursts.
        maxPerDay: preprimary || periodsPerWeek > 6 ? 2 : 1,
      };
    case "active":
      return {
        ...base,
        timeOfDay: "after_break",
        avoidFirstPeriod: true,
        avoidAfterLunch: true,
        doublesPerWeek: preprimary ? 0 : periodsPerWeek >= 4 ? 1 : 0,
        maxPerDay: preprimary ? 1 : 2,
      };
    case "art":
      return {
        ...base,
        timeOfDay: "after_break",
        avoidFirstPeriod: true,
        doublesPerWeek: periodsPerWeek >= 2 ? 1 : 0,
        maxPerDay: 2,
      };
    case "lab":
      return {
        ...base,
        timeOfDay: "any",
        doublesPerWeek: periodsPerWeek >= 3 && !preprimary ? 1 : 0,
        maxPerDay: 2,
      };
    default:
      return { ...base, timeOfDay: "after_break" };
  }
}

export function normalizeSubjectRule(raw: Partial<TimetableSubjectRule>): TimetableSubjectRule | null {
  if (!raw || !raw.classId || !raw.subjectId) return null;
  const tod = raw.timeOfDay === "morning" || raw.timeOfDay === "after_break" ? raw.timeOfDay : "any";
  const clamp = (n: unknown, lo: number, hi: number, d: number) => {
    const v = Math.floor(Number(n));
    return Number.isFinite(v) ? Math.max(lo, Math.min(hi, v)) : d;
  };
  return {
    classId: String(raw.classId),
    subjectId: String(raw.subjectId),
    doublesPerWeek: clamp(raw.doublesPerWeek, 0, 5, 0),
    timeOfDay: tod,
    maxPerDay: clamp(raw.maxPerDay, 1, 4, 1),
    avoidFirstPeriod: raw.avoidFirstPeriod === true,
    avoidLastPeriod: raw.avoidLastPeriod === true,
    avoidAfterLunch: raw.avoidAfterLunch === true,
  };
}

/** The rule the solver uses: the saved one, else the default. */
export function effectiveSubjectRule(
  saved: TimetableSubjectRule[],
  classId: string,
  subject: SubjectLike,
  periodsPerWeek: number,
  preprimary: boolean,
): TimetableSubjectRule {
  const hit = saved.find((r) => r.classId === classId && r.subjectId === subject.id);
  const rule = hit ?? defaultSubjectRule(classId, subject, periodsPerWeek, preprimary);
  // A double needs two periods; never ask for more doubles than the load holds.
  const doublesPerWeek = Math.min(rule.doublesPerWeek, Math.floor(periodsPerWeek / 2));
  // A day must be able to hold a double.
  const maxPerDay = doublesPerWeek > 0 ? Math.max(2, rule.maxPerDay) : rule.maxPerDay;
  return { ...rule, doublesPerWeek, maxPerDay };
}

// ── bell facts ──

export function toMinutes(hhmm: string): number {
  const [h, m] = hhmm.split(":").map((x) => Number(x));
  return (Number.isFinite(h) ? h : 0) * 60 + (Number.isFinite(m) ? m : 0);
}

export type BellFacts = {
  /** Teaching period numbers in clock order. */
  order: number[];
  /** periodNo → [startMin, endMin] */
  interval: Map<number, [number, number]>;
  /** Pairs [a, b] of teaching periods back-to-back with no break between. */
  pairs: [number, number][];
  /** Teaching periods before the first break. */
  morning: Set<number>;
  /** Teaching periods after the first break. */
  afterBreak: Set<number>;
  first: number | null;
  last: number | null;
  /** The teaching period straight after lunch (the longest break, or one labelled lunch). */
  afterLunch: number | null;
};

export function bellFacts(bell: BellPeriod[]): BellFacts {
  const all = [...bell].sort((a, b) => toMinutes(a.startTime) - toMinutes(b.startTime));
  const order: number[] = [];
  const interval = new Map<number, [number, number]>();
  const pairs: [number, number][] = [];
  const morning = new Set<number>();
  const afterBreak = new Set<number>();
  let seenBreak = false;
  let prevTeaching: number | null = null;
  const breaks = all.filter((p) => p.kind === "break");
  const lunch =
    breaks.find((b) => /lunch/i.test(b.label)) ??
    [...breaks].sort(
      (a, b) =>
        toMinutes(b.endTime) - toMinutes(b.startTime) - (toMinutes(a.endTime) - toMinutes(a.startTime)),
    )[0];
  let afterLunch: number | null = null;
  let passedLunch = false;
  for (const p of all) {
    if (p.kind === "break") {
      if (order.length) seenBreak = true;
      prevTeaching = null;
      if (lunch && p === lunch) passedLunch = true;
      continue;
    }
    if (p.kind !== "teaching") {
      prevTeaching = null;
      continue;
    }
    order.push(p.no);
    interval.set(p.no, [toMinutes(p.startTime), toMinutes(p.endTime)]);
    (seenBreak ? afterBreak : morning).add(p.no);
    if (prevTeaching !== null) pairs.push([prevTeaching, p.no]);
    prevTeaching = p.no;
    if (passedLunch && afterLunch === null) afterLunch = p.no;
  }
  return {
    order,
    interval,
    pairs,
    morning,
    afterBreak,
    first: order[0] ?? null,
    last: order[order.length - 1] ?? null,
    afterLunch,
  };
}

export function overlaps(a: [number, number], b: [number, number]): boolean {
  return a[0] < b[1] && b[0] < a[1];
}
