/**
 * Timetable auto-assign — a constraint solver (not an LLM): the same inputs
 * always give the same week, and it can never double-book a teacher.
 *
 * Inputs: Masters class subjects (periods/week), teacher links, each class's
 * bell schedule (pre-primary may keep its own timing), and the placement
 * rules per class subject (lib/timetableRules — double periods, time of
 * day, most per day, periods to avoid). The placing itself is
 * lib/timetablePlacement (pure, tested).
 *
 * Who teaches (director, 5 Oct 2026): a teacher linked to the subject for
 * this class wins (a specialist — PE, music); else, in a class whose class
 * teacher takes every subject (Nursery–UKG by default), the class teacher;
 * else any teacher linked to the subject elsewhere.
 */

import { classGroupCodeForName, type MastersState } from "@/lib/masters";
import type { StaffRecord } from "@/lib/foundationMasters";
import {
  NEP_STAGE_PACKS,
  periodsForSuggestion,
  type NepStage,
} from "@/lib/nepSubjectSuggestions";
import { WEEKDAY_LABELS } from "@/lib/schoolTiming";
import { effectiveGridWeekdays } from "@/lib/timetableCalendar";
import { listExamDateSheet, loadExams } from "@/lib/exams";
import {
  applySolverResultToState,
  bellForClass,
  classTeacherTakesAll,
  ensureGrid,
  loadTimetable,
  saveTimetable,
  type TimetableConflict,
  type TimetableGrid,
  type TimetableSlot,
  type TimetableSolverStats,
  type TimetableState,
} from "@/lib/timetable";
import { bellFacts, effectiveSubjectRule, type TimetableSubjectRule } from "@/lib/timetableRules";
import { markBusy, placeSection, type BusyMap, type PlacementUnit } from "@/lib/timetablePlacement";

export type DemandUnit = {
  classId: string;
  sectionId: string;
  subjectId: string;
  teacherIds: string[];
  remaining: number;
  /** masters = class subject map; nep_fallback = NEP stage suggestion */
  source: "masters" | "nep_fallback";
  rule: TimetableSubjectRule;
  subjectName: string;
  /** Who teaches it: a linked subject teacher, the class teacher, or a teacher of it elsewhere. */
  teacherSource: "subject_link" | "class_teacher" | "elsewhere" | "none";
};

export type UnfilledDemand = {
  classId: string;
  sectionId: string;
  subjectId: string;
  remaining: number;
  reason: string;
};

export type SolverExplanation = {
  level: "info" | "warn" | "error";
  text: string;
};

export type AutoAssignResult = {
  ok: true;
  state: TimetableState;
  grids: TimetableGrid[];
  unfilled: UnfilledDemand[];
  conflicts: TimetableConflict[];
  score: number;
  stats: TimetableSolverStats;
  explanation: SolverExplanation[];
};

function linksForAy<T extends { academicYearCode?: string }>(links: T[] | undefined, ay: string): T[] {
  return (links ?? []).filter((l) => !l.academicYearCode || l.academicYearCode === ay);
}

/** The section's class teacher(s), primary first. */
export function classTeachersOf(
  masters: MastersState,
  classId: string,
  sectionId: string,
  academicYearCode: string,
): StaffRecord[] {
  const hits: { s: StaffRecord; primary: boolean }[] = [];
  for (const s of masters.staff ?? []) {
    if (s.status !== "active") continue;
    for (const l of linksForAy(s.classTeacherLinks, academicYearCode)) {
      if (l.classId !== classId) continue;
      if (l.sectionId && l.sectionId !== sectionId) continue;
      hits.push({ s, primary: l.isPrimary });
      break;
    }
  }
  return hits.sort((a, b) => Number(b.primary) - Number(a.primary)).map((h) => h.s);
}

/** Who can teach this subject in this section, and why them. */
export function teachersForSubject(
  masters: MastersState,
  state: Pick<TimetableState, "classTeacherAllClassIds">,
  classId: string,
  sectionId: string,
  academicYearCode: string,
  subjectId: string,
): { teachers: StaffRecord[]; source: DemandUnit["teacherSource"] } {
  const linked: StaffRecord[] = [];
  const elsewhere: StaffRecord[] = [];
  for (const s of masters.staff ?? []) {
    if (s.status !== "active") continue;
    let classHit = false;
    let subjectHit = false;
    for (const l of linksForAy(s.subjectTeachingLinks, academicYearCode)) {
      if (l.subjectId !== subjectId) continue;
      subjectHit = true;
      if (l.classId !== classId) continue;
      if (l.sectionId && l.sectionId !== sectionId) continue;
      classHit = true;
    }
    if (classHit) linked.push(s);
    else if (subjectHit) elsewhere.push(s);
  }
  if (linked.length) return { teachers: linked, source: "subject_link" };
  const cls = masters.classes.find((c) => c.id === classId);
  const group = cls?.groupCode ?? classGroupCodeForName(cls?.name ?? "");
  if (classTeacherTakesAll(state, classId, group)) {
    const ct = classTeachersOf(masters, classId, sectionId, academicYearCode);
    // A class whose class teacher takes everything never borrows a
    // stranger linked to the subject in another class.
    return ct.length ? { teachers: ct.slice(0, 1), source: "class_teacher" } : { teachers: [], source: "none" };
  }
  return elsewhere.length ? { teachers: elsewhere, source: "elsewhere" } : { teachers: [], source: "none" };
}

export function isPrePrimaryClass(masters: MastersState, classId: string): boolean {
  const cls = masters.classes.find((c) => c.id === classId);
  return (cls?.groupCode ?? classGroupCodeForName(cls?.name ?? "")) === "PRE_PRIMARY";
}

function nepStageForClass(
  masters: MastersState,
  classId: string,
): NepStage {
  const cls = masters.classes.find((c) => c.id === classId);
  const group = cls?.groupCode ?? classGroupCodeForName(cls?.name ?? "");
  switch (group) {
    case "PRE_PRIMARY":
      return "foundational";
    case "PRIMARY":
      return "preparatory";
    case "MIDDLE":
      return "middle";
    case "SECONDARY":
      return "secondary_9_10";
    case "SENIOR":
      return "secondary_11_12";
    default:
      return "middle";
  }
}

/**
 * NEP fallback load for classes with no Masters class–subject map yet:
 * match the stage pack's top-level subjects to existing masters subjects
 * by code and use suggested periods/week.
 */
export function nepFallbackLoad(
  masters: MastersState,
  classId: string,
): { subjectId: string; periodsPerWeek: number }[] {
  const stage = nepStageForClass(masters, classId);
  const pack = NEP_STAGE_PACKS.find((p) => p.id === stage);
  if (!pack) return [];
  const byCode = new Map(
    (masters.subjects ?? [])
      .filter((s) => s.isActive && !s.parentId)
      .map((s) => [s.code.toUpperCase(), s] as const),
  );
  const out: { subjectId: string; periodsPerWeek: number }[] = [];
  const seen = new Set<string>();
  for (const item of pack.subjects.filter((s) => !s.underCode)) {
    const sub = byCode.get(item.code.toUpperCase());
    if (!sub || seen.has(sub.id)) continue;
    const need = Math.max(0, Math.floor(periodsForSuggestion(stage, item)));
    if (!need) continue;
    seen.add(sub.id);
    out.push({ subjectId: sub.id, periodsPerWeek: need });
  }
  return out;
}

/** True when the class has at least one active subject link with periods. */
export function classHasSubjectLoad(
  masters: MastersState,
  classId: string,
): boolean {
  return (masters.classSubjects ?? []).some(
    (l) => l.classId === classId && l.isActive !== false && l.periodsPerWeek > 0,
  );
}

export function buildDemand(
  masters: MastersState,
  academicYearCode: string,
  targets: { classId: string; sectionId: string }[],
  state: Pick<TimetableState, "classTeacherAllClassIds" | "subjectRules"> = loadTimetable(),
): DemandUnit[] {
  const out: DemandUnit[] = [];
  const subjectById = new Map((masters.subjects ?? []).map((s) => [s.id, s]));
  for (const t of targets) {
    const links = (masters.classSubjects ?? []).filter(
      (l) => l.classId === t.classId && l.isActive !== false,
    );
    let loads: {
      subjectId: string;
      periodsPerWeek: number;
      source: "masters" | "nep_fallback";
    }[] = links
      .map((l) => ({
        subjectId: l.subjectId,
        periodsPerWeek: l.periodsPerWeek,
        source: "masters" as const,
      }))
      .filter((l) => Math.floor(l.periodsPerWeek || 0) > 0);

    if (!loads.length) {
      loads = nepFallbackLoad(masters, t.classId).map((l) => ({
        ...l,
        source: "nep_fallback" as const,
      }));
    }
    const preprimary = isPrePrimaryClass(masters, t.classId);

    for (const load of loads) {
      const need = Math.max(0, Math.floor(load.periodsPerWeek || 0));
      if (!need) continue;
      const who = teachersForSubject(masters, state, t.classId, t.sectionId, academicYearCode, load.subjectId);
      const sub = subjectById.get(load.subjectId);
      const subjectLike = {
        id: load.subjectId,
        code: sub?.code ?? "",
        nameEn: sub?.nameEn ?? "",
        category: sub?.category,
        coScholasticArea: (sub as { coScholasticArea?: string } | undefined)?.coScholasticArea,
      };
      out.push({
        classId: t.classId,
        sectionId: t.sectionId,
        subjectId: load.subjectId,
        teacherIds: who.teachers.map((x) => x.id),
        remaining: need,
        source: load.source,
        rule: effectiveSubjectRule(state.subjectRules ?? [], t.classId, subjectLike, need, preprimary),
        subjectName: sub?.nameEn || sub?.code || load.subjectId,
        teacherSource: who.source,
      });
    }
  }
  return out;
}

export function runAutoAssign(input: {
  masters: MastersState;
  academicYearCode: string;
  targets: { classId: string; sectionId: string }[];
  /** Clear existing slots for targets before fill (default true) */
  clearExisting?: boolean;
  persist?: boolean;
}): AutoAssignResult {
  const state0 = loadTimetable();
  const explanation: SolverExplanation[] = [];
  const className = (id: string) => input.masters.classes.find((c) => c.id === id)?.name ?? id;
  const sectionLabel = (classId: string, sectionId: string) => {
    const sec = input.masters.sections.find((s) => s.id === sectionId)?.name ?? "";
    return sec ? `${className(classId)}-${sec}` : className(classId);
  };

  if (!input.targets.length) {
    explanation.push({ level: "error", text: "Select at least one class–section" });
  }

  let state = state0;
  const resultGrids: TimetableGrid[] = [];
  const targetKeys = new Set(input.targets.map((t) => `${t.classId}|${t.sectionId}`));

  // Every other grid's teachers, as clock times on their own class's bell.
  const busy: BusyMap = new Map();
  const load = new Map<string, number>();
  for (const g of state.grids) {
    if (g.academicYearCode !== input.academicYearCode) continue;
    if (input.clearExisting !== false && targetKeys.has(`${g.classId}|${g.sectionId}`)) continue;
    const facts = bellFacts(bellForClass(state, g.classId));
    for (const s of g.slots) {
      if (!s.teacherId) continue;
      const at = facts.interval.get(s.periodNo);
      if (!at) continue;
      markBusy(busy, s.teacherId, s.weekday, at);
      load.set(s.teacherId, (load.get(s.teacherId) ?? 0) + 1);
    }
  }

  const demand = buildDemand(input.masters, input.academicYearCode, input.targets, state0);
  const targetClassIds = new Set(input.targets.map((target) => target.classId));
  const datedExamSittings = listExamDateSheet(
    input.academicYearCode,
    undefined,
    loadExams(),
  ).filter((entry) => targetClassIds.has(entry.classId));
  if (datedExamSittings.length) {
    explanation.push({
      level: "info",
      text: `${datedExamSittings.length} dated exam sitting(s) retained as date-specific blocks. Auto-assign only updates the reusable weekly teaching grid; overlapping regular lessons are masked on each exam date.`,
    });
  }
  if (!demand.length) {
    explanation.push({
      level: "warn",
      text: "No subject periods/week on class subject links — set Masters → Subjects first",
    });
  }
  const fallbackClassIds = new Set(demand.filter((d) => d.source === "nep_fallback").map((d) => d.classId));
  if (fallbackClassIds.size) {
    explanation.push({
      level: "info",
      text: `No class–subject map in Masters for: ${[...fallbackClassIds].map(className).join(", ")}. Used NEP stage suggested subjects/periods instead — link subjects in Masters → Subjects to control the load.`,
    });
  }
  const viaClassTeacher = new Set(
    demand.filter((d) => d.teacherSource === "class_teacher").map((d) => `${d.classId}|${d.sectionId}`),
  );
  if (viaClassTeacher.size) {
    explanation.push({
      level: "info",
      text: `Class teacher takes the subjects with no specialist in: ${[...viaClassTeacher]
        .map((k) => sectionLabel(k.split("|")[0]!, k.split("|")[1]!))
        .join(", ")}.`,
    });
  }

  const unfilled: UnfilledDemand[] = [];
  let placed = 0;
  let scoreSum = 0;

  for (const t of input.targets) {
    const cal = effectiveGridWeekdays(input.masters, input.academicYearCode, t.classId);
    const weekdays = cal.weekdays.length
      ? cal.weekdays
      : state0.workingWeekdays.length
        ? state0.workingWeekdays
        : [1, 2, 3, 4, 5, 6];
    if (cal.skippedFull.length) {
      explanation.push({
        level: "info",
        text: `Skipped weekly holiday(s) for class: ${cal.skippedFull
          .map((w) => `${WEEKDAY_LABELS[w.weekday]} (${w.title})`)
          .join(", ")}`,
      });
    }
    const facts = bellFacts(bellForClass(state0, t.classId));
    if (!facts.order.length) {
      explanation.push({
        level: "error",
        text: `${sectionLabel(t.classId, t.sectionId)}: its bell schedule has no teaching periods — fix Setup first.`,
      });
      continue;
    }

    const ensured = ensureGrid(input.academicYearCode, t.classId, t.sectionId, state);
    state = ensured.state;
    const existing: TimetableSlot[] =
      input.clearExisting === false ? ensured.grid.slots.filter((s) => weekdays.includes(s.weekday)) : [];

    const units: PlacementUnit[] = demand
      .filter((d) => d.classId === t.classId && d.sectionId === t.sectionId)
      .map((d) => ({
        classId: d.classId,
        sectionId: d.sectionId,
        subjectId: d.subjectId,
        subjectName: d.subjectName,
        teacherIds: d.teacherIds,
        periodsPerWeek: d.remaining,
        rule: d.rule,
      }));

    const capacity = weekdays.length * facts.order.length - existing.length;
    const wanted = units.reduce((n, u) => n + u.periodsPerWeek, 0);
    if (wanted > capacity) {
      explanation.push({
        level: "warn",
        text: `${sectionLabel(t.classId, t.sectionId)} needs ${wanted} periods a week but its timing has ${capacity} — reduce periods/week in Masters → Subjects.`,
      });
    }

    const r = placeSection({ target: { ...t, weekdays, facts }, units, busy, load, existing });
    placed += r.placed;
    scoreSum += r.scoreSum;
    unfilled.push(...r.unfilled);
    for (const n of r.notes) {
      explanation.push({ level: n.level, text: `${sectionLabel(t.classId, t.sectionId)} · ${n.text}` });
    }

    const grid: TimetableGrid = { ...ensured.grid, slots: r.slots, updatedAt: new Date().toISOString() };
    resultGrids.push(grid);
    state = { ...state, grids: state.grids.map((g) => (g.id === grid.id ? grid : g)) };
  }

  const needed = demand.reduce((n, d) => n + d.remaining, 0);
  const fillPercent = needed > 0 ? Math.round((placed / needed) * 100) : placed ? 100 : 0;
  const conflicts: TimetableConflict[] = [];
  const stats: TimetableSolverStats = {
    fillPercent,
    placed,
    unfilled: unfilled.reduce((n, u) => n + u.remaining, 0),
    conflicts: conflicts.length,
    score: placed ? Math.round(scoreSum / placed) : 0,
  };

  explanation.unshift({
    level: fillPercent >= 90 ? "info" : fillPercent >= 60 ? "warn" : "error",
    text: `Auto-assign placed ${placed}/${needed} periods (${fillPercent}%) · score ${stats.score}`,
  });
  const noTeacher = unfilled.filter((u) => u.reason.startsWith("No teacher"));
  if (noTeacher.length) {
    explanation.push({
      level: "warn",
      text: `${noTeacher.reduce((n, u) => n + u.remaining, 0)} period(s) have no teacher — link teachers in Staff → Teaching allocation, or set the class teacher for classes where the class teacher takes all subjects.`,
    });
  }

  const nextState = applySolverResultToState(state, resultGrids, stats);
  if (input.persist !== false) {
    saveTimetable(nextState);
  }

  return {
    ok: true,
    state: nextState,
    grids: resultGrids,
    unfilled,
    conflicts,
    score: stats.score,
    stats,
    explanation,
  };
}

export type AssignableSection = {
  classId: string;
  sectionId: string;
  label: string;
  /** masters = class subject map exists; nep_fallback = NEP stage suggestions will be used */
  loadSource: "masters" | "nep_fallback" | "none";
};

export function listAssignableSections(
  masters: MastersState,
  academicYearCode: string,
): AssignableSection[] {
  const out: AssignableSection[] = [];
  const classes = masters.classes
    .filter((c) => c.isActive)
    .slice()
    .sort((a, b) => a.sortOrder - b.sortOrder);
  for (const cls of classes) {
    const secs = masters.sections.filter(
      (s) => s.classId === cls.id && s.isActive,
    );
    const hasLoad = classHasSubjectLoad(masters, cls.id);
    const fallback = hasLoad ? [] : nepFallbackLoad(masters, cls.id);
    const loadSource: AssignableSection["loadSource"] = hasLoad
      ? "masters"
      : fallback.length
        ? "nep_fallback"
        : "none";
    for (const sec of secs) {
      out.push({
        classId: cls.id,
        sectionId: sec.id,
        label: `${cls.name}-${sec.name}`,
        loadSource,
      });
    }
  }
  void academicYearCode;
  return out;
}
