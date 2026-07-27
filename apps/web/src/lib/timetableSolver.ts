/**
 * Timetable AI auto-assign — local constraint solver.
 * Places subjects from classSubjects + staff subjectTeachingLinks.
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
  ensureGrid,
  loadTimetable,
  saveTimetable,
  teacherOccupancy,
  teachingPeriods,
  type TimetableConflict,
  type TimetableGrid,
  type TimetableSlot,
  type TimetableSolverStats,
  type TimetableState,
} from "@/lib/timetable";

export type DemandUnit = {
  classId: string;
  sectionId: string;
  subjectId: string;
  teacherIds: string[];
  remaining: number;
  /** masters = class subject map; nep_fallback = NEP stage suggestion */
  source: "masters" | "nep_fallback";
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

function staffForSubject(
  masters: MastersState,
  classId: string,
  sectionId: string,
  academicYearCode: string,
  subjectId: string,
): StaffRecord[] {
  const primary: StaffRecord[] = [];
  const fallback: StaffRecord[] = [];
  for (const s of masters.staff ?? []) {
    if (s.status !== "active") continue;
    let classHit = false;
    let subjectHit = false;
    for (const l of s.subjectTeachingLinks ?? []) {
      if (l.subjectId !== subjectId) continue;
      if (l.academicYearCode && l.academicYearCode !== academicYearCode) {
        continue;
      }
      subjectHit = true;
      if (l.classId !== classId) continue;
      if (l.sectionId && l.sectionId !== sectionId) continue;
      classHit = true;
    }
    if (classHit) primary.push(s);
    else if (subjectHit) fallback.push(s);
  }
  return primary.length ? primary : fallback;
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
): DemandUnit[] {
  const out: DemandUnit[] = [];
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

    for (const load of loads) {
      const need = Math.max(0, Math.floor(load.periodsPerWeek || 0));
      if (!need) continue;
      const teachers = staffForSubject(
        masters,
        t.classId,
        t.sectionId,
        academicYearCode,
        load.subjectId,
      );
      out.push({
        classId: t.classId,
        sectionId: t.sectionId,
        subjectId: load.subjectId,
        teacherIds: teachers.map((x) => x.id),
        remaining: need,
        source: load.source,
      });
    }
  }
  return out;
}

type Cell = { weekday: number; periodNo: number };

function emptyCells(
  weekdays: number[],
  periodNos: number[],
  occupied: Set<string>,
): Cell[] {
  const cells: Cell[] = [];
  for (const wd of weekdays) {
    for (const pn of periodNos) {
      const key = `${wd}|${pn}`;
      if (!occupied.has(key)) cells.push({ weekday: wd, periodNo: pn });
    }
  }
  return cells;
}

function scoreCell(
  cell: Cell,
  subjectId: string,
  teacherId: string,
  gridSlots: TimetableSlot[],
  teacherBusy: Map<string, string>,
): number {
  let score = 100;
  // Prefer spreading subject across weekdays
  const sameDay = gridSlots.filter(
    (s) => s.subjectId === subjectId && s.weekday === cell.weekday,
  ).length;
  score -= sameDay * 18;

  // Prefer not stacking consecutive periods for same teacher
  const adj = gridSlots.filter(
    (s) =>
      s.teacherId === teacherId &&
      s.weekday === cell.weekday &&
      Math.abs(s.periodNo - cell.periodNo) === 1,
  ).length;
  score -= adj * 8;

  // Prefer mid-day slightly over extreme ends
  if (cell.periodNo === 1 || cell.periodNo >= 7) score -= 3;

  // Illegal if teacher busy elsewhere
  if (teacherBusy.has(`${teacherId}|${cell.weekday}|${cell.periodNo}`)) {
    return -1e9;
  }
  return score;
}

function pickTeacher(
  teacherIds: string[],
  cell: Cell,
  teacherBusy: Map<string, string>,
  loadCount: Map<string, number>,
): string | null {
  let best: string | null = null;
  let bestScore = -1e9;
  for (const tid of teacherIds) {
    if (teacherBusy.has(`${tid}|${cell.weekday}|${cell.periodNo}`)) continue;
    const load = loadCount.get(tid) || 0;
    const score = 1000 - load * 5;
    if (score > bestScore) {
      bestScore = score;
      best = tid;
    }
  }
  return best;
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
  const periods = teachingPeriods(state0.bellTemplate);
  const periodNos = periods.map((p) => p.no);
  const explanation: SolverExplanation[] = [];

  if (!periodNos.length) {
    explanation.push({
      level: "error",
      text: "No teaching periods in bell template — fix Setup first",
    });
  }
  if (!input.targets.length) {
    explanation.push({
      level: "error",
      text: "Select at least one class–section",
    });
  }

  let state = state0;
  const resultGrids: TimetableGrid[] = [];
  const teacherBusy = teacherOccupancy(state, undefined, input.academicYearCode);

  // Optionally clear target grids from occupancy
  for (const t of input.targets) {
    const g = state.grids.find(
      (x) =>
        x.academicYearCode === input.academicYearCode &&
        x.classId === t.classId &&
        x.sectionId === t.sectionId,
    );
    if (!g) continue;
    if (input.clearExisting !== false) {
      for (const s of g.slots) {
        if (s.teacherId) {
          teacherBusy.delete(`${s.teacherId}|${s.weekday}|${s.periodNo}`);
        }
      }
    }
  }

  const demand = buildDemand(
    input.masters,
    input.academicYearCode,
    input.targets,
  );
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
  const fallbackClassIds = new Set(
    demand.filter((d) => d.source === "nep_fallback").map((d) => d.classId),
  );
  if (fallbackClassIds.size) {
    const names = [...fallbackClassIds]
      .map(
        (id) => input.masters.classes.find((c) => c.id === id)?.name ?? id,
      )
      .join(", ");
    explanation.push({
      level: "info",
      text: `No class–subject map in Masters for: ${names}. Used NEP stage suggested subjects/periods instead — link subjects in Masters → Subjects to control the load.`,
    });
  }

  // Hardest first: fewest teachers, most periods
  demand.sort((a, b) => {
    const ta = a.teacherIds.length || 99;
    const tb = b.teacherIds.length || 99;
    if (ta !== tb) return ta - tb;
    return b.remaining - a.remaining;
  });

  const loadCount = new Map<string, number>();
  // Seed load from other sections
  for (const key of teacherBusy.keys()) {
    const tid = key.split("|")[0]!;
    loadCount.set(tid, (loadCount.get(tid) || 0) + 1);
  }

  const unfilled: UnfilledDemand[] = [];
  let placed = 0;
  let scoreSum = 0;

  for (const t of input.targets) {
    const cal = effectiveGridWeekdays(
      input.masters,
      input.academicYearCode,
      t.classId,
    );
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

    const ensured = ensureGrid(
      input.academicYearCode,
      t.classId,
      t.sectionId,
      state,
    );
    state = ensured.state;
    let slots: TimetableSlot[] =
      input.clearExisting === false
        ? [...ensured.grid.slots].filter((s) => weekdays.includes(s.weekday))
        : [];

    // Drop slots that landed on full weekly holidays when clearing/rebuilding
    if (input.clearExisting !== false) {
      slots = [];
    }

    const occupied = new Set(slots.map((s) => `${s.weekday}|${s.periodNo}`));
    const sectionDemand = demand.filter(
      (d) => d.classId === t.classId && d.sectionId === t.sectionId,
    );

    for (const d of sectionDemand) {
      if (!d.teacherIds.length) {
        unfilled.push({
          classId: d.classId,
          sectionId: d.sectionId,
          subjectId: d.subjectId,
          remaining: d.remaining,
          reason: "No teacher linked to this subject (Staff → Duties)",
        });
        explanation.push({
          level: "warn",
          text: `No teacher for subject on ${t.classId.slice(0, 6)}… — ${d.remaining} periods left unfilled`,
        });
        continue;
      }

      let left = d.remaining;
      while (left > 0) {
        const cells = emptyCells(weekdays, periodNos, occupied);
        let best: {
          cell: Cell;
          teacherId: string;
          score: number;
        } | null = null;

        for (const cell of cells) {
          const teacherId = pickTeacher(
            d.teacherIds,
            cell,
            teacherBusy,
            loadCount,
          );
          if (!teacherId) continue;
          const sc = scoreCell(
            cell,
            d.subjectId,
            teacherId,
            slots,
            teacherBusy,
          );
          if (sc < 0) continue;
          if (!best || sc > best.score) {
            best = { cell, teacherId, score: sc };
          }
        }

        if (!best) {
          unfilled.push({
            classId: d.classId,
            sectionId: d.sectionId,
            subjectId: d.subjectId,
            remaining: left,
            reason: "No free legal cell (teacher busy, holiday, or grid full)",
          });
          break;
        }

        const slot: TimetableSlot = {
          weekday: best.cell.weekday,
          periodNo: best.cell.periodNo,
          subjectId: d.subjectId,
          teacherId: best.teacherId,
          roomId: "",
        };
        slots.push(slot);
        occupied.add(`${slot.weekday}|${slot.periodNo}`);
        teacherBusy.set(
          `${slot.teacherId}|${slot.weekday}|${slot.periodNo}`,
          `${t.classId}|${t.sectionId}`,
        );
        loadCount.set(
          best.teacherId,
          (loadCount.get(best.teacherId) || 0) + 1,
        );
        placed += 1;
        scoreSum += best.score;
        left -= 1;
      }
    }

    const grid: TimetableGrid = {
      ...ensured.grid,
      slots,
      updatedAt: new Date().toISOString(),
    };
    resultGrids.push(grid);
    state = {
      ...state,
      grids: state.grids.map((g) => (g.id === grid.id ? grid : g)),
    };
  }

  // Local repair pass: try to place remaining unfilled with looser spread
  const still: UnfilledDemand[] = [];
  for (const u of unfilled) {
    if (u.reason.includes("No teacher")) {
      still.push(u);
      continue;
    }
    const grid = resultGrids.find(
      (g) => g.classId === u.classId && g.sectionId === u.sectionId,
    );
    if (!grid) {
      still.push(u);
      continue;
    }
    const cal = effectiveGridWeekdays(
      input.masters,
      input.academicYearCode,
      u.classId,
    );
    const weekdays = cal.weekdays.length
      ? cal.weekdays
      : state0.workingWeekdays.length
        ? state0.workingWeekdays
        : [1, 2, 3, 4, 5, 6];
    const teachers = staffForSubject(
      input.masters,
      u.classId,
      u.sectionId,
      input.academicYearCode,
      u.subjectId,
    ).map((s) => s.id);
    let left = u.remaining;
    const occupied = new Set(
      grid.slots.map((s) => `${s.weekday}|${s.periodNo}`),
    );
    while (left > 0) {
      const cells = emptyCells(weekdays, periodNos, occupied);
      let placedOne = false;
      for (const cell of cells) {
        const tid = pickTeacher(teachers, cell, teacherBusy, loadCount);
        if (!tid) continue;
        grid.slots.push({
          weekday: cell.weekday,
          periodNo: cell.periodNo,
          subjectId: u.subjectId,
          teacherId: tid,
          roomId: "",
        });
        occupied.add(`${cell.weekday}|${cell.periodNo}`);
        teacherBusy.set(
          `${tid}|${cell.weekday}|${cell.periodNo}`,
          `${u.classId}|${u.sectionId}`,
        );
        loadCount.set(tid, (loadCount.get(tid) || 0) + 1);
        placed += 1;
        left -= 1;
        placedOne = true;
        break;
      }
      if (!placedOne) break;
    }
    if (left > 0) {
      still.push({ ...u, remaining: left, reason: "Still no free cell after repair" });
    }
  }

  const demandTotal = demand.reduce((n, d) => n + d.remaining, 0);
  // demand.remaining was mutated conceptually — recompute from original build
  const demandFresh = buildDemand(
    input.masters,
    input.academicYearCode,
    input.targets,
  );
  const needed = demandFresh.reduce((n, d) => n + d.remaining, 0);
  const fillPercent =
    needed > 0 ? Math.round((placed / needed) * 100) : placed ? 100 : 0;

  const conflicts = [] as TimetableConflict[];
  // Detect within result
  const tmap = new Map<string, string>();
  for (const g of resultGrids) {
    for (const s of g.slots) {
      if (!s.teacherId) continue;
      const k = `${s.teacherId}|${s.weekday}|${s.periodNo}`;
      if (tmap.has(k) && tmap.get(k) !== `${g.classId}|${g.sectionId}`) {
        conflicts.push({
          kind: "teacher_clash",
          weekday: s.weekday,
          periodNo: s.periodNo,
          classId: g.classId,
          sectionId: g.sectionId,
          teacherId: s.teacherId,
          subjectId: s.subjectId,
          detail: "Teacher clash after assign",
        });
      }
      tmap.set(k, `${g.classId}|${g.sectionId}`);
    }
  }

  const stats: TimetableSolverStats = {
    fillPercent,
    placed,
    unfilled: still.reduce((n, u) => n + u.remaining, 0),
    conflicts: conflicts.length,
    score: placed ? Math.round(scoreSum / placed) : 0,
  };

  explanation.unshift({
    level: fillPercent >= 90 ? "info" : fillPercent >= 60 ? "warn" : "error",
    text: `Auto-assign placed ${placed}/${needed || demandTotal} periods (${fillPercent}%) · score ${stats.score}`,
  });
  if (still.length) {
    explanation.push({
      level: "warn",
      text: `${still.length} subject load(s) partially unfilled — add teachers or reduce periods/week`,
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
    unfilled: still,
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
