/**
 * Timetable — weekly class grids, bell template, publish snapshot.
 * Demo store: localStorage `bhb_timetable_v1`.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { DEFAULT_AY } from "@/lib/masters";
import type { MastersState } from "@/lib/masters";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

export type BellPeriodKind = "teaching" | "break" | "assembly";

export type BellPeriod = {
  /** Stable id within template (teaching periods use this as periodNo in slots) */
  no: number;
  label: string;
  startTime: string;
  endTime: string;
  kind: BellPeriodKind;
};

export type TimetableSlot = {
  weekday: number;
  periodNo: number;
  subjectId: string;
  teacherId: string;
  roomId: string;
};

export type TimetableGrid = {
  id: string;
  academicYearCode: string;
  classId: string;
  sectionId: string;
  slots: TimetableSlot[];
  updatedAt: string;
};

export type TimetableSolverStats = {
  fillPercent: number;
  placed: number;
  unfilled: number;
  conflicts: number;
  score: number;
};

export type TimetablePublishMeta = {
  status: "draft" | "published";
  publishedAt: string;
  publishedBy: string;
  generatedAt: string;
  solverStats: TimetableSolverStats | null;
};

export type TimetableConflict = {
  kind: "teacher_clash" | "class_clash" | "empty_teacher" | "empty_subject";
  weekday: number;
  periodNo: number;
  classId: string;
  sectionId: string;
  teacherId: string;
  subjectId: string;
  detail: string;
};

/** Dated substitute-teacher arrangement for one period of one class. */
export type TimetableSubstitution = {
  id: string;
  academicYearCode: string;
  /** YYYY-MM-DD — arrangements are per calendar day, not weekly */
  date: string;
  weekday: number;
  periodNo: number;
  classId: string;
  sectionId: string;
  subjectId: string;
  absentTeacherId: string;
  /** Empty = period left free (no substitute found / school choice) */
  substituteTeacherId: string;
  /** "block" = generated from a TeacherTimeBlock, not a whole-day absence */
  source: "auto" | "manual" | "block";
  note: string;
  createdAt: string;
};

/**
 * A teacher marked unavailable for PART of a day (school work/duty
 * elsewhere), as opposed to a whole-day absence. Drives the substitution
 * engine the same way an absence does, scoped to just the periods that
 * fall inside [startTime, endTime). Distinct from lib/dutyRoster.ts's
 * whole-day duty roster (assembly/gate/lunch/bus-escort/event) — that
 * system is unconnected to the timetable on purpose; this one exists
 * specifically to feed it.
 */
export type TeacherTimeBlock = {
  id: string;
  academicYearCode: string;
  staffId: string;
  /** YYYY-MM-DD */
  date: string;
  /** HH:MM, zero-padded */
  startTime: string;
  endTime: string;
  reason: string;
  createdBy: string;
  createdAt: string;
};

export type TimetableState = {
  version: 1;
  workingWeekdays: number[];
  bellTemplate: BellPeriod[];
  grids: TimetableGrid[];
  publishedGrids: TimetableGrid[];
  substitutions: TimetableSubstitution[];
  teacherTimeBlocks: TeacherTimeBlock[];
  meta: TimetablePublishMeta;
};

const STORAGE_KEY = "bhb_timetable_v1";

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

function nowIso() {
  return new Date().toISOString();
}

export const WEEKDAY_SHORT = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

export function defaultBellTemplate(): BellPeriod[] {
  return [
    {
      no: 0,
      label: "Assembly",
      startTime: "08:45",
      endTime: "09:00",
      kind: "assembly",
    },
    {
      no: 1,
      label: "Period 1",
      startTime: "09:00",
      endTime: "09:40",
      kind: "teaching",
    },
    {
      no: 2,
      label: "Period 2",
      startTime: "09:40",
      endTime: "10:20",
      kind: "teaching",
    },
    {
      no: 3,
      label: "Period 3",
      startTime: "10:20",
      endTime: "11:00",
      kind: "teaching",
    },
    {
      no: 90,
      label: "Recess",
      startTime: "11:00",
      endTime: "11:20",
      kind: "break",
    },
    {
      no: 4,
      label: "Period 4",
      startTime: "11:20",
      endTime: "12:00",
      kind: "teaching",
    },
    {
      no: 5,
      label: "Period 5",
      startTime: "12:00",
      endTime: "12:40",
      kind: "teaching",
    },
    {
      no: 6,
      label: "Period 6",
      startTime: "12:40",
      endTime: "13:20",
      kind: "teaching",
    },
    {
      no: 91,
      label: "Lunch",
      startTime: "13:20",
      endTime: "14:00",
      kind: "break",
    },
    {
      no: 7,
      label: "Period 7",
      startTime: "14:00",
      endTime: "14:40",
      kind: "teaching",
    },
    {
      no: 8,
      label: "Period 8",
      startTime: "14:40",
      endTime: "15:20",
      kind: "teaching",
    },
  ];
}

export function defaultWorkingWeekdays(): number[] {
  return [1, 2, 3, 4, 5, 6];
}

export function emptyTimetableMeta(): TimetablePublishMeta {
  return {
    status: "draft",
    publishedAt: "",
    publishedBy: "",
    generatedAt: "",
    solverStats: null,
  };
}

export function emptyTimetableState(): TimetableState {
  return {
    version: 1,
    workingWeekdays: defaultWorkingWeekdays(),
    bellTemplate: defaultBellTemplate(),
    grids: [],
    publishedGrids: [],
    substitutions: [],
    teacherTimeBlocks: [],
    meta: emptyTimetableMeta(),
  };
}

export function normalizeSubstitution(
  s: Partial<TimetableSubstitution>,
): TimetableSubstitution | null {
  if (!s.date || typeof s.weekday !== "number" || typeof s.periodNo !== "number") {
    return null;
  }
  if (!s.classId || !s.sectionId || !s.absentTeacherId) return null;
  return {
    id: s.id || nid("sub"),
    academicYearCode: s.academicYearCode || DEFAULT_AY,
    date: s.date.slice(0, 10),
    weekday: s.weekday,
    periodNo: s.periodNo,
    classId: s.classId,
    sectionId: s.sectionId,
    subjectId: s.subjectId || "",
    absentTeacherId: s.absentTeacherId,
    substituteTeacherId: s.substituteTeacherId || "",
    source:
      s.source === "manual" ? "manual" : s.source === "block" ? "block" : "auto",
    note: s.note || "",
    createdAt: s.createdAt || nowIso(),
  };
}

export function normalizeTeacherTimeBlock(
  b: Partial<TeacherTimeBlock>,
): TeacherTimeBlock | null {
  if (!b.staffId || !b.date) return null;
  return {
    id: b.id || nid("ttb"),
    academicYearCode: b.academicYearCode || DEFAULT_AY,
    staffId: b.staffId,
    date: b.date.slice(0, 10),
    startTime: normalizeHhmm(b.startTime || "", "09:00"),
    endTime: normalizeHhmm(b.endTime || "", "09:40"),
    reason: (b.reason || "").trim(),
    createdBy: b.createdBy || "",
    createdAt: b.createdAt || nowIso(),
  };
}

function normalizeHhmm(v: string, fallback: string): string {
  const t = (v || "").trim();
  if (/^\d{1,2}:\d{2}$/.test(t)) {
    const [h, m] = t.split(":").map(Number);
    if (h >= 0 && h <= 23 && m >= 0 && m <= 59) {
      return `${String(h).padStart(2, "0")}:${String(m).padStart(2, "0")}`;
    }
  }
  return fallback;
}

export function normalizeBellPeriod(p: Partial<BellPeriod>, idx: number): BellPeriod {
  const kind: BellPeriodKind =
    p.kind === "break" || p.kind === "assembly" || p.kind === "teaching"
      ? p.kind
      : "teaching";
  return {
    no: typeof p.no === "number" ? p.no : idx + 1,
    label: (p.label || `Period ${idx + 1}`).trim(),
    startTime: normalizeHhmm(p.startTime || "", "09:00"),
    endTime: normalizeHhmm(p.endTime || "", "09:40"),
    kind,
  };
}

export function teachingPeriods(bell: BellPeriod[]): BellPeriod[] {
  return bell.filter((p) => p.kind === "teaching").sort((a, b) => a.no - b.no);
}

function normalizeSlot(s: Partial<TimetableSlot>): TimetableSlot | null {
  if (typeof s.weekday !== "number" || typeof s.periodNo !== "number") {
    return null;
  }
  return {
    weekday: s.weekday,
    periodNo: s.periodNo,
    subjectId: s.subjectId || "",
    teacherId: s.teacherId || "",
    roomId: s.roomId || "",
  };
}

function normalizeGrid(g: Partial<TimetableGrid>): TimetableGrid {
  return {
    id: g.id || nid("ttg"),
    academicYearCode: g.academicYearCode || DEFAULT_AY,
    classId: g.classId || "",
    sectionId: g.sectionId || "",
    slots: Array.isArray(g.slots)
      ? g.slots
          .map(normalizeSlot)
          .filter((x): x is TimetableSlot => !!x)
      : [],
    updatedAt: g.updatedAt || nowIso(),
  };
}

export function normalizeTimetableState(raw: unknown): TimetableState {
  const empty = emptyTimetableState();
  if (!raw || typeof raw !== "object") return empty;
  const p = raw as Partial<TimetableState>;
  const weekdays = Array.isArray(p.workingWeekdays)
    ? p.workingWeekdays.filter((n) => n >= 0 && n <= 6)
    : empty.workingWeekdays;
  return {
    version: 1,
    workingWeekdays: weekdays.length ? [...weekdays].sort() : empty.workingWeekdays,
    bellTemplate: Array.isArray(p.bellTemplate) && p.bellTemplate.length
      ? p.bellTemplate.map((b, i) => normalizeBellPeriod(b, i))
      : empty.bellTemplate,
    grids: Array.isArray(p.grids) ? p.grids.map(normalizeGrid) : [],
    publishedGrids: Array.isArray(p.publishedGrids)
      ? p.publishedGrids.map(normalizeGrid)
      : [],
    substitutions: Array.isArray(p.substitutions)
      ? p.substitutions
          .map(normalizeSubstitution)
          .filter((x): x is TimetableSubstitution => !!x)
      : [],
    teacherTimeBlocks: Array.isArray(p.teacherTimeBlocks)
      ? p.teacherTimeBlocks
          .map(normalizeTeacherTimeBlock)
          .filter((x): x is TeacherTimeBlock => !!x)
      : [],
    meta: {
      status: p.meta?.status === "published" ? "published" : "draft",
      publishedAt: p.meta?.publishedAt || "",
      publishedBy: p.meta?.publishedBy || "",
      generatedAt: p.meta?.generatedAt || "",
      solverStats: p.meta?.solverStats ?? null,
    },
  };
}

export function loadTimetable(): TimetableState {
  if (typeof window === "undefined") return emptyTimetableState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyTimetableState();
    return normalizeTimetableState(JSON.parse(raw));
  } catch {
    return emptyTimetableState();
  }
}

export function saveTimetable(state: TimetableState) {
  if (!assertModulePermission("timetable", "edit", "saveTimetable")) return;
  if (typeof window === "undefined") return;
  const next = normalizeTimetableState(state);
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(next));
  } catch (e) {
    console.warn("[timetable] localStorage quota exceeded — relying on server DB sync", e);
  }
  void import("@/lib/timetablePersistence").then(({ scheduleTimetableSync }) => {
    scheduleTimetableSync(next);
  });
}

export function writeTimetableLocalRaw(state: TimetableState) {
  if (typeof window === "undefined") return;
  try {
    localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify(normalizeTimetableState(state)),
    );
  } catch (e) {
    console.warn("[timetable] localStorage quota exceeded — relying on server DB sync", e);
  }
}

export function timetableStateIsEmpty(state: TimetableState): boolean {
  return (state.grids?.length ?? 0) === 0 && !state.meta?.generatedAt;
}

export function findGrid(
  academicYearCode: string,
  classId: string,
  sectionId: string,
  state?: TimetableState,
): TimetableGrid | undefined {
  const s = state ?? loadTimetable();
  return s.grids.find(
    (g) =>
      g.academicYearCode === academicYearCode &&
      g.classId === classId &&
      g.sectionId === sectionId,
  );
}

export function ensureGrid(
  academicYearCode: string,
  classId: string,
  sectionId: string,
  state?: TimetableState,
): { state: TimetableState; grid: TimetableGrid } {
  const s = state ?? loadTimetable();
  const existing = findGrid(academicYearCode, classId, sectionId, s);
  if (existing) return { state: s, grid: existing };
  const grid = normalizeGrid({
    id: nid("ttg"),
    academicYearCode,
    classId,
    sectionId,
    slots: [],
    updatedAt: nowIso(),
  });
  return {
    state: { ...s, grids: [grid, ...s.grids] },
    grid,
  };
}

export function upsertGridSlots(input: {
  academicYearCode: string;
  classId: string;
  sectionId: string;
  slots: TimetableSlot[];
}):
  | { ok: true; grid: TimetableGrid }
  | { ok: false; error: string; conflicts?: TimetableConflict[] } {
  if (!input.classId || !input.sectionId) {
    return { ok: false, error: "Select class and section" };
  }
  const state = loadTimetable();
  const { state: withGrid, grid } = ensureGrid(
    input.academicYearCode,
    input.classId,
    input.sectionId,
    state,
  );
  const nextGrid: TimetableGrid = {
    ...grid,
    slots: input.slots.map((s) => normalizeSlot(s)!).filter(Boolean),
    updatedAt: nowIso(),
  };
  const nextState: TimetableState = {
    ...withGrid,
    grids: withGrid.grids.map((g) => (g.id === grid.id ? nextGrid : g)),
    meta: { ...withGrid.meta, status: "draft" },
  };
  const allConflicts = detectTimetableConflicts(
    nextState,
    input.academicYearCode,
  );
  const teacherIds = new Set(
    nextGrid.slots.map((s) => s.teacherId).filter(Boolean),
  );
  const hard = allConflicts.filter(
    (c) =>
      c.kind === "teacher_clash" &&
      teacherIds.has(c.teacherId) &&
      // Clash involves this section or a peer at same weekday/period
      (c.classId === input.classId && c.sectionId === input.sectionId
        ? true
        : nextGrid.slots.some(
            (s) =>
              s.teacherId === c.teacherId &&
              s.weekday === c.weekday &&
              s.periodNo === c.periodNo,
          )),
  );
  const classClash = allConflicts.filter(
    (c) =>
      c.kind === "class_clash" &&
      c.classId === input.classId &&
      c.sectionId === input.sectionId,
  );
  if (hard.length || classClash.length) {
    const first = hard[0] || classClash[0]!;
    return {
      ok: false,
      error: first.detail,
      conflicts: [...hard, ...classClash],
    };
  }
  saveTimetable(nextState);
  return { ok: true, grid: nextGrid };
}

/** Remove one placed period from a class grid (used by teacher/class views). */
export function removeSlotFromGrid(input: {
  academicYearCode: string;
  classId: string;
  sectionId: string;
  weekday: number;
  periodNo: number;
}): { ok: true } | { ok: false; error: string } {
  const state = loadTimetable();
  const grid = findGrid(
    input.academicYearCode,
    input.classId,
    input.sectionId,
    state,
  );
  if (!grid) return { ok: false, error: "Grid not found" };
  const slots = grid.slots.filter(
    (s) => !(s.weekday === input.weekday && s.periodNo === input.periodNo),
  );
  if (slots.length === grid.slots.length) {
    return { ok: false, error: "No period at that cell" };
  }
  saveTimetable({
    ...state,
    grids: state.grids.map((g) =>
      g.id === grid.id ? { ...g, slots, updatedAt: nowIso() } : g,
    ),
    meta: { ...state.meta, status: "draft" },
  });
  return { ok: true };
}

/** Delete a class–section draft grid entirely. */
export function deleteGrid(
  academicYearCode: string,
  classId: string,
  sectionId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadTimetable();
  const grid = findGrid(academicYearCode, classId, sectionId, state);
  if (!grid) return { ok: false, error: "No saved grid for this section" };
  saveTimetable({
    ...state,
    grids: state.grids.filter((g) => g.id !== grid.id),
    meta: { ...state.meta, status: "draft" },
  });
  return { ok: true };
}

export function setBellTemplate(
  periods: BellPeriod[],
  workingWeekdays?: number[],
): { ok: true } | { ok: false; error: string } {
  if (!periods.length) return { ok: false, error: "Add at least one period" };
  const teaching = periods.filter((p) => p.kind === "teaching");
  if (!teaching.length) {
    return { ok: false, error: "Need at least one teaching period" };
  }
  const state = loadTimetable();
  saveTimetable({
    ...state,
    bellTemplate: periods.map((p, i) => normalizeBellPeriod(p, i)),
    workingWeekdays: workingWeekdays?.length
      ? [...workingWeekdays].sort()
      : state.workingWeekdays,
    meta: { ...state.meta, status: "draft" },
  });
  return { ok: true };
}

export function publishTimetable(
  publishedBy: string,
  academicYearCode?: string,
): {
  ok: true;
} | { ok: false; error: string } {
  const state = loadTimetable();
  const ay = academicYearCode || DEFAULT_AY;
  const sessionGrids = state.grids.filter((g) => g.academicYearCode === ay);
  if (!sessionGrids.length) {
    return { ok: false, error: `No class grids to publish for ${ay}` };
  }
  const conflicts = detectTimetableConflicts(state, ay).filter(
    (c) => c.kind === "teacher_clash" || c.kind === "class_clash",
  );
  if (conflicts.length) {
    return {
      ok: false,
      error: `${conflicts.length} clash(es) — fix before publish`,
    };
  }
  const stamp = nowIso();
  const sessionPublished = sessionGrids.map((g) =>
    normalizeGrid({
      ...g,
      id: g.id,
      slots: [...g.slots],
      updatedAt: stamp,
    }),
  );
  const publishedGrids = [
    ...state.publishedGrids.filter((g) => g.academicYearCode !== ay),
    ...sessionPublished,
  ];
  const next: TimetableState = {
    ...state,
    publishedGrids,
    meta: {
      ...state.meta,
      status: "published",
      publishedAt: stamp,
      publishedBy,
    },
  };
  if (!assertModulePermission("timetable", "edit", "publishTimetable")) {
    return { ok: false, error: "Not allowed to publish timetable" };
  }
  writeTimetableLocalRaw(next);
  void import("@/lib/timetablePersistence").then(({ scheduleTimetableSync }) => {
    scheduleTimetableSync(next);
  });
  return { ok: true };
}

export function unpublishTimetable(
  academicYearCode?: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadTimetable();
  const ay = academicYearCode || DEFAULT_AY;
  const sessionPublished = state.publishedGrids.filter(
    (g) => g.academicYearCode === ay,
  );
  if (state.meta.status !== "published" && !sessionPublished.length) {
    return { ok: false, error: `Nothing published for ${ay}` };
  }
  if (!assertModulePermission("timetable", "edit", "unpublishTimetable")) {
    return { ok: false, error: "Not allowed to unpublish timetable" };
  }
  const publishedGrids = state.publishedGrids.filter(
    (g) => g.academicYearCode !== ay,
  );
  writeTimetableLocalRaw({
    ...state,
    publishedGrids,
    meta: {
      ...state.meta,
      status: publishedGrids.length ? "published" : "draft",
      publishedAt: publishedGrids.length ? state.meta.publishedAt : "",
      publishedBy: publishedGrids.length ? state.meta.publishedBy : "",
    },
  });
  void import("@/lib/timetablePersistence").then(({ scheduleTimetableSync }) => {
    scheduleTimetableSync(loadTimetable());
  });
  return { ok: true };
}

export function detectTimetableConflicts(
  state?: TimetableState,
  academicYearCode?: string,
): TimetableConflict[] {
  const s = state ?? loadTimetable();
  const out: TimetableConflict[] = [];
  const teacherAt = new Map<string, TimetableConflict>();
  const grids = academicYearCode
    ? s.grids.filter((g) => g.academicYearCode === academicYearCode)
    : s.grids;

  for (const grid of grids) {
    const cellSeen = new Set<string>();
    for (const slot of grid.slots) {
      const cellKey = `${slot.weekday}|${slot.periodNo}`;
      if (cellSeen.has(cellKey)) {
        out.push({
          kind: "class_clash",
          weekday: slot.weekday,
          periodNo: slot.periodNo,
          classId: grid.classId,
          sectionId: grid.sectionId,
          teacherId: slot.teacherId,
          subjectId: slot.subjectId,
          detail: `Class has two subjects in the same period`,
        });
      }
      cellSeen.add(cellKey);

      if (!slot.subjectId) {
        out.push({
          kind: "empty_subject",
          weekday: slot.weekday,
          periodNo: slot.periodNo,
          classId: grid.classId,
          sectionId: grid.sectionId,
          teacherId: slot.teacherId,
          subjectId: "",
          detail: "Slot missing subject",
        });
      }
      if (slot.subjectId && !slot.teacherId) {
        out.push({
          kind: "empty_teacher",
          weekday: slot.weekday,
          periodNo: slot.periodNo,
          classId: grid.classId,
          sectionId: grid.sectionId,
          teacherId: "",
          subjectId: slot.subjectId,
          detail: "Slot missing teacher",
        });
      }
      if (!slot.teacherId) continue;
      const tKey = `${slot.teacherId}|${slot.weekday}|${slot.periodNo}`;
      const prev = teacherAt.get(tKey);
      if (prev) {
        out.push({
          kind: "teacher_clash",
          weekday: slot.weekday,
          periodNo: slot.periodNo,
          classId: grid.classId,
          sectionId: grid.sectionId,
          teacherId: slot.teacherId,
          subjectId: slot.subjectId,
          detail: `Teacher double-booked (${WEEKDAY_SHORT[slot.weekday]} P${slot.periodNo})`,
        });
      } else {
        teacherAt.set(tKey, {
          kind: "teacher_clash",
          weekday: slot.weekday,
          periodNo: slot.periodNo,
          classId: grid.classId,
          sectionId: grid.sectionId,
          teacherId: slot.teacherId,
          subjectId: slot.subjectId,
          detail: "",
        });
      }
    }
  }
  return out;
}

export function slotAt(
  grid: TimetableGrid | undefined,
  weekday: number,
  periodNo: number,
): TimetableSlot | undefined {
  return grid?.slots.find(
    (s) => s.weekday === weekday && s.periodNo === periodNo,
  );
}

export function subjectLabel(masters: MastersState, subjectId: string): string {
  const s = (masters.subjects ?? []).find((x) => x.id === subjectId);
  return s?.nameEn || s?.code || subjectId || "—";
}

export function teacherLabel(masters: MastersState, teacherId: string): string {
  const s = (masters.staff ?? []).find((x) => x.id === teacherId);
  return s?.fullName || teacherId || "—";
}

export function classSectionLabel(
  masters: MastersState,
  classId: string,
  sectionId: string,
): string {
  const c = masters.classes.find((x) => x.id === classId)?.name ?? "—";
  const sec = masters.sections.find((x) => x.id === sectionId)?.name ?? "";
  return sec ? `${c}-${sec}` : c;
}

/** Occupancy map: teacherId|weekday|periodNo → grid key */
export function teacherOccupancy(
  state: TimetableState,
  exclude?: { classId: string; sectionId: string },
  academicYearCode?: string,
): Map<string, string> {
  const map = new Map<string, string>();
  for (const g of state.grids) {
    if (academicYearCode && g.academicYearCode !== academicYearCode) continue;
    if (
      exclude &&
      g.classId === exclude.classId &&
      g.sectionId === exclude.sectionId
    ) {
      continue;
    }
    for (const s of g.slots) {
      if (!s.teacherId) continue;
      map.set(
        `${s.teacherId}|${s.weekday}|${s.periodNo}`,
        `${g.classId}|${g.sectionId}`,
      );
    }
  }
  return map;
}

export function applySolverResultToState(
  state: TimetableState,
  grids: TimetableGrid[],
  stats: TimetableSolverStats,
): TimetableState {
  const byKey = new Map(
    grids.map((g) => [`${g.academicYearCode}|${g.classId}|${g.sectionId}`, g]),
  );
  const nextGrids = [...state.grids];
  for (const g of grids) {
    const key = `${g.academicYearCode}|${g.classId}|${g.sectionId}`;
    const i = nextGrids.findIndex(
      (x) =>
        x.academicYearCode === g.academicYearCode &&
        x.classId === g.classId &&
        x.sectionId === g.sectionId,
    );
    if (i >= 0) nextGrids[i] = byKey.get(key)!;
    else nextGrids.unshift(byKey.get(key)!);
  }
  return {
    ...state,
    grids: nextGrids,
    meta: {
      ...state.meta,
      status: "draft",
      generatedAt: nowIso(),
      solverStats: stats,
    },
  };
}
