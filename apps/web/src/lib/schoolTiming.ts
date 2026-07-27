/**
 * School / class-group / class timing — shared by student & staff attendance.
 * Lives on Masters foundation slice (School setup).
 */

import type { ClassGroupCode } from "@/lib/masters";
import { CLASS_GROUPS, classGroupCodeForName } from "@/lib/masters";

export type SchoolWeekTiming = {
  /** HH:mm */
  startTime: string;
  endTime: string;
  /** 0=Sun … 6=Sat */
  workingWeekdays: number[];
  sundayExceptional: boolean;
  sundayStartTime: string;
  sundayEndTime: string;
};

export type SchoolTimingGroupOverride = {
  id: string;
  groupCode: ClassGroupCode;
  timing: SchoolWeekTiming;
};

export type SchoolTimingClassOverride = {
  id: string;
  classId: string;
  timing: SchoolWeekTiming;
};

export type SchoolTimingConfig = {
  /** Campus-wide default (staff + any class without override) */
  default: SchoolWeekTiming;
  groupOverrides: SchoolTimingGroupOverride[];
  classOverrides: SchoolTimingClassOverride[];
};

export const WEEKDAY_LABELS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function defaultSchoolWeekTiming(): SchoolWeekTiming {
  return {
    startTime: "09:00",
    endTime: "15:30",
    workingWeekdays: [1, 2, 3, 4, 5, 6],
    sundayExceptional: false,
    sundayStartTime: "09:00",
    sundayEndTime: "13:00",
  };
}

export function defaultSchoolTimingConfig(): SchoolTimingConfig {
  return {
    default: defaultSchoolWeekTiming(),
    groupOverrides: [],
    classOverrides: [],
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

export function normalizeSchoolWeekTiming(
  t?: Partial<SchoolWeekTiming> | null,
): SchoolWeekTiming {
  const d = defaultSchoolWeekTiming();
  const weekdays = Array.isArray(t?.workingWeekdays)
    ? t!.workingWeekdays.filter((n) => n >= 0 && n <= 6)
    : d.workingWeekdays;
  return {
    startTime: normalizeHhmm(t?.startTime || "", d.startTime),
    endTime: normalizeHhmm(t?.endTime || "", d.endTime),
    workingWeekdays: weekdays.length > 0 ? [...weekdays].sort() : d.workingWeekdays,
    sundayExceptional: !!t?.sundayExceptional,
    sundayStartTime: normalizeHhmm(t?.sundayStartTime || "", d.sundayStartTime),
    sundayEndTime: normalizeHhmm(t?.sundayEndTime || "", d.sundayEndTime),
  };
}

export function normalizeSchoolTimingConfig(
  c?: Partial<SchoolTimingConfig> | null,
): SchoolTimingConfig {
  const groupOverrides = Array.isArray(c?.groupOverrides)
    ? c!.groupOverrides
        .filter((g) => g && CLASS_GROUPS.some((x) => x.code === g.groupCode))
        .map((g) => ({
          id: g.id || nid("stg"),
          groupCode: g.groupCode as ClassGroupCode,
          timing: normalizeSchoolWeekTiming(g.timing),
        }))
    : [];
  const classOverrides = Array.isArray(c?.classOverrides)
    ? c!.classOverrides
        .filter((r) => r?.classId)
        .map((r) => ({
          id: r.id || nid("stc"),
          classId: r.classId,
          timing: normalizeSchoolWeekTiming(r.timing),
        }))
    : [];
  return {
    default: normalizeSchoolWeekTiming(c?.default),
    groupOverrides,
    classOverrides,
  };
}

export type ResolveTimingScope = {
  classId?: string | null;
  className?: string | null;
  groupCode?: ClassGroupCode | null;
};

/**
 * Resolve effective timing:
 * class override → class-group override → school default.
 */
export function resolveSchoolTiming(
  config: SchoolTimingConfig,
  scope?: ResolveTimingScope | null,
): { timing: SchoolWeekTiming; source: "class" | "group" | "default" } {
  const cfg = normalizeSchoolTimingConfig(config);
  if (scope?.classId) {
    const hit = cfg.classOverrides.find((c) => c.classId === scope.classId);
    if (hit) return { timing: hit.timing, source: "class" };
  }
  const group =
    scope?.groupCode ||
    (scope?.className ? classGroupCodeForName(scope.className) : null);
  if (group) {
    const hit = cfg.groupOverrides.find((g) => g.groupCode === group);
    if (hit) return { timing: hit.timing, source: "group" };
  }
  return { timing: cfg.default, source: "default" };
}

export function describeTiming(t: SchoolWeekTiming): string {
  const days = t.workingWeekdays.map((d) => WEEKDAY_LABELS[d]).join("");
  const sun = t.sundayExceptional
    ? ` · Sun ${t.sundayStartTime}–${t.sundayEndTime}`
    : "";
  return `${t.startTime}–${t.endTime} · ${days || "—"}${sun}`;
}

export function hoursBetween(start: string, end: string): number {
  const [sh, sm] = start.split(":").map(Number);
  const [eh, em] = end.split(":").map(Number);
  const a = sh * 60 + sm;
  const b = eh * 60 + em;
  if (b <= a) return 0;
  return Math.round(((b - a) / 60) * 100) / 100;
}

export function expectedWindowForTiming(
  timing: SchoolWeekTiming,
  dateIso: string,
  sundayExceptionalOverride?: boolean,
): { start: string; end: string; isWorking: boolean; reason: string } {
  const d = new Date(`${dateIso}T12:00:00`);
  const dow = d.getDay();
  const sundayOn =
    sundayExceptionalOverride !== undefined
      ? sundayExceptionalOverride
      : timing.sundayExceptional;

  if (dow === 0) {
    if (!sundayOn) {
      return {
        start: timing.sundayStartTime,
        end: timing.sundayEndTime,
        isWorking: false,
        reason: "Sunday not exceptional",
      };
    }
    return {
      start: timing.sundayStartTime,
      end: timing.sundayEndTime,
      isWorking: true,
      reason: "Sunday exceptional",
    };
  }

  if (!timing.workingWeekdays.includes(dow)) {
    return {
      start: timing.startTime,
      end: timing.endTime,
      isWorking: false,
      reason: "Non-working weekday",
    };
  }

  return {
    start: timing.startTime,
    end: timing.endTime,
    isWorking: true,
    reason: "School timing",
  };
}
