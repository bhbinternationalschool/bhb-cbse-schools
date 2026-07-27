/**
 * Timetable calendar helpers — school timing + holiday policy → teaching days.
 */

import type { MastersState } from "@/lib/masters";
import {
  listWeeklyClassHolidays,
  type WeeklyClassHoliday,
} from "@/lib/holidayPolicy";
import {
  normalizeSchoolTimingConfig,
  resolveSchoolTiming,
  WEEKDAY_LABELS,
} from "@/lib/schoolTiming";
import {
  defaultWorkingWeekdays,
  loadTimetable,
  saveTimetable,
  writeTimetableLocalRaw,
} from "@/lib/timetable";

export type EffectiveGridWeekdays = {
  /** Days used for weekly grid / auto-assign (timing ∩ not full weekly holiday) */
  weekdays: number[];
  /** From Masters school / group / class timing */
  timingWeekdays: number[];
  timingSource: "class" | "group" | "default";
  timingWindow: string;
  /** Full weekly holidays skipped for this class */
  skippedFull: WeeklyClassHoliday[];
  /** Half-day weekly rules (still schedulable; UI badge only) */
  halfDays: WeeklyClassHoliday[];
};

/** Working weekdays from school timing (class → group → default). */
export function schoolTimingWeekdaysForClass(
  masters: MastersState,
  classId?: string | null,
): {
  weekdays: number[];
  source: "class" | "group" | "default";
  startTime: string;
  endTime: string;
} {
  const cls = classId
    ? masters.classes.find((c) => c.id === classId)
    : undefined;
  const resolved = resolveSchoolTiming(
    normalizeSchoolTimingConfig(masters.schoolTiming),
    {
      classId: classId || undefined,
      className: cls?.name,
      groupCode: cls?.groupCode,
    },
  );
  const weekdays = [...(resolved.timing.workingWeekdays ?? [])].sort();
  return {
    weekdays: weekdays.length ? weekdays : defaultWorkingWeekdays(),
    source: resolved.source,
    startTime: resolved.timing.startTime,
    endTime: resolved.timing.endTime,
  };
}

/**
 * Effective teaching weekdays for a class grid:
 * school/class timing weekdays minus published full weekly holidays for that class.
 */
export function effectiveGridWeekdays(
  masters: MastersState,
  academicYearCode: string,
  classId: string,
): EffectiveGridWeekdays {
  const timing = schoolTimingWeekdaysForClass(masters, classId);
  const weekly = listWeeklyClassHolidays(
    masters,
    academicYearCode,
    classId,
  );
  const skippedFull = weekly.filter((w) => w.dayType === "full");
  const halfDays = weekly.filter((w) => w.dayType === "half");
  const skipSet = new Set(skippedFull.map((w) => w.weekday));
  const weekdays = timing.weekdays.filter((d) => !skipSet.has(d));
  return {
    weekdays: weekdays.length ? weekdays : timing.weekdays,
    timingWeekdays: timing.weekdays,
    timingSource: timing.source,
    timingWindow: `${timing.startTime}–${timing.endTime}`,
    skippedFull,
    halfDays,
  };
}

/** School-default timing weekdays (no class scope) for Timetable Setup. */
export function schoolDefaultTimingWeekdays(masters: MastersState): {
  weekdays: number[];
  startTime: string;
  endTime: string;
} {
  const t = schoolTimingWeekdaysForClass(masters, null);
  return {
    weekdays: t.weekdays,
    startTime: t.startTime,
    endTime: t.endTime,
  };
}

/**
 * Pull Setup working weekdays from Masters → School timing (campus default).
 * Also seeds empty timetable weekdays on first hydrate when still default Mon–Sat
 * and masters timing differs — call from UI "Pull from Masters timing".
 */
export function syncTimetableWeekdaysFromSchoolTiming(
  masters: MastersState,
): { ok: true; weekdays: number[] } | { ok: false; error: string } {
  const { weekdays } = schoolDefaultTimingWeekdays(masters);
  if (!weekdays.length) {
    return { ok: false, error: "School timing has no working weekdays" };
  }
  const state = loadTimetable();
  saveTimetable({
    ...state,
    workingWeekdays: weekdays,
    meta: { ...state.meta, status: "draft" },
  });
  return { ok: true, weekdays };
}

/** If timetable never customized, adopt Masters school timing weekdays. */
export function ensureTimetableWeekdaysFromMasters(
  masters: MastersState,
): void {
  const state = loadTimetable();
  const defaults = defaultWorkingWeekdays();
  const sameAsDefault =
    state.workingWeekdays.length === defaults.length &&
    state.workingWeekdays.every((d, i) => d === defaults[i]);
  if (!sameAsDefault) return;
  if (state.grids.some((g) => g.slots.length > 0)) return;
  const { weekdays } = schoolDefaultTimingWeekdays(masters);
  if (
    weekdays.length === defaults.length &&
    weekdays.every((d, i) => d === defaults[i])
  ) {
    return;
  }
  writeTimetableLocalRaw({
    ...state,
    workingWeekdays: weekdays,
  });
}

export function weekdayHolidayBadge(
  weekday: number,
  info: EffectiveGridWeekdays,
): { tone: "full" | "half"; label: string } | null {
  const full = info.skippedFull.find((w) => w.weekday === weekday);
  if (full) {
    return { tone: "full", label: full.title };
  }
  const half = info.halfDays.find((w) => w.weekday === weekday);
  if (half) {
    return { tone: "half", label: `${half.title} (half)` };
  }
  return null;
}

export function describeEffectiveWeekdays(info: EffectiveGridWeekdays): string {
  const days = info.weekdays.map((d) => WEEKDAY_LABELS[d]).join("");
  const skip = info.skippedFull
    .map((w) => `${WEEKDAY_LABELS[w.weekday]}:${w.title}`)
    .join(", ");
  const src =
    info.timingSource === "class"
      ? "class timing"
      : info.timingSource === "group"
        ? "group timing"
        : "school timing";
  return skip
    ? `${days || "—"} · ${src} ${info.timingWindow} · off ${skip}`
    : `${days || "—"} · ${src} ${info.timingWindow}`;
}
