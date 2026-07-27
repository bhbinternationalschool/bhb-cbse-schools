/**
 * Holiday policy engine — school-wide / class-group / class scope,
 * applies-to (students / teaching / non-teaching), one-off + weekly,
 * half-day, working-day overrides.
 */

import type {
  Holiday,
  HolidayAppliesTo,
  StaffStream,
} from "@/lib/foundationMasters";
import {
  CLASS_GROUPS,
  classGroupCodeForName,
  type ClassGroupCode,
  type MastersState,
} from "@/lib/masters";
import { WEEKDAY_LABELS } from "@/lib/schoolTiming";

export type HolidayAudience =
  | { kind: "school" }
  | { kind: "staff"; stream?: StaffStream | "any" }
  | { kind: "class"; classId: string }
  | { kind: "group"; groupCode: ClassGroupCode };

export type DayClassification = {
  status: "working" | "holiday" | "half_holiday";
  holiday: Holiday | null;
  label: string;
  paidForStaff: boolean;
};

function inDateRange(iso: string, from: string, to: string): boolean {
  const d = iso.slice(0, 10);
  return d >= from.slice(0, 10) && d <= to.slice(0, 10);
}

function dow(iso: string): number {
  return new Date(`${iso.slice(0, 10)}T12:00:00`).getDay();
}

export function appliesToIncludesStudents(
  appliesTo: HolidayAppliesTo | undefined,
): boolean {
  const a = appliesTo || "everyone";
  return (
    a === "everyone" ||
    a === "students" ||
    a === "students_and_teaching" ||
    a === "students_and_non_teaching"
  );
}

export function appliesToIncludesTeaching(
  appliesTo: HolidayAppliesTo | undefined,
): boolean {
  const a = appliesTo || "everyone";
  return (
    a === "everyone" ||
    a === "staff_all" ||
    a === "staff_teaching" ||
    a === "students_and_teaching"
  );
}

export function appliesToIncludesNonTeaching(
  appliesTo: HolidayAppliesTo | undefined,
): boolean {
  const a = appliesTo || "everyone";
  return (
    a === "everyone" ||
    a === "staff_all" ||
    a === "staff_non_teaching" ||
    a === "students_and_non_teaching"
  );
}

function holidayMatchesAppliesTo(
  h: Holiday,
  audience: HolidayAudience,
): boolean {
  const a = h.appliesTo || "everyone";
  if (
    audience.kind === "class" ||
    audience.kind === "group" ||
    audience.kind === "school"
  ) {
    return appliesToIncludesStudents(a);
  }
  if (audience.kind === "staff") {
    const stream = audience.stream || "any";
    if (stream === "teaching") return appliesToIncludesTeaching(a);
    if (stream === "non_teaching") return appliesToIncludesNonTeaching(a);
    return appliesToIncludesTeaching(a) || appliesToIncludesNonTeaching(a);
  }
  return false;
}

export function holidayAppliesToAudience(
  h: Holiday,
  audience: HolidayAudience,
  masters: MastersState,
): boolean {
  if (!holidayMatchesAppliesTo(h, audience)) return false;

  const scope = h.scope || "school";

  // Staff: school-wide calendar only (class/group scope is for students)
  if (audience.kind === "staff") {
    return scope === "school";
  }

  if (scope === "school") return true;

  if (scope === "class_group") {
    const code = (h.groupCode || "") as ClassGroupCode | "";
    if (!code) return false;
    if (audience.kind === "group") return audience.groupCode === code;
    if (audience.kind === "class") {
      const cls = masters.classes.find((c) => c.id === audience.classId);
      if (!cls) return false;
      const g = cls.groupCode ?? classGroupCodeForName(cls.name);
      return g === code;
    }
    if (audience.kind === "school") return true;
  }

  if (scope === "class") {
    const ids = h.classIds ?? [];
    if (audience.kind === "class") return ids.includes(audience.classId);
    if (audience.kind === "group") {
      return (masters.classes ?? []).some(
        (c) =>
          ids.includes(c.id) &&
          (c.groupCode ?? classGroupCodeForName(c.name)) === audience.groupCode,
      );
    }
  }
  return false;
}

export function holidayCoversDate(h: Holiday, isoDate: string): boolean {
  if (!h.isPublished) return false;
  const d = isoDate.slice(0, 10);
  if ((h.exceptionDates ?? []).includes(d)) return false;

  const mode = h.mode || "one_off";
  if (mode === "weekly") {
    if (!inDateRange(d, h.startsOn, h.endsOn)) return false;
    const wd = typeof h.weekday === "number" ? h.weekday : null;
    if (wd == null) return false;
    return dow(d) === wd;
  }

  if (!inDateRange(d, h.startsOn, h.endsOn)) return false;
  return true;
}

export function classifyHolidayDay(
  masters: MastersState,
  isoDate: string,
  academicYearCode: string,
  audience: HolidayAudience,
): DayClassification {
  const d = isoDate.slice(0, 10);
  const published = (masters.holidays ?? []).filter(
    (h) => h.isPublished && h.academicYearCode === academicYearCode,
  );

  const covering = published.filter((h) => holidayCoversDate(h, d));
  const applicable = covering.filter((h) =>
    holidayAppliesToAudience(h, audience, masters),
  );

  const override = applicable.find((h) => h.workingOverride);
  if (override) {
    return {
      status: "working",
      holiday: override,
      label: `Working day — ${override.title}`,
      paidForStaff: false,
    };
  }

  const off = applicable.filter((h) => !h.workingOverride);
  if (off.length === 0) {
    return {
      status: "working",
      holiday: null,
      label: "Working day",
      paidForStaff: false,
    };
  }

  off.sort((a, b) => {
    const sa = (a.scope || "school") === "school" ? 0 : 1;
    const sb = (b.scope || "school") === "school" ? 0 : 1;
    if (sa !== sb) return sa - sb;
    const da = (a.dayType || "full") === "full" ? 0 : 1;
    const db = (b.dayType || "full") === "full" ? 0 : 1;
    return da - db;
  });
  const hit = off[0]!;
  const half = (hit.dayType || "full") === "half";
  return {
    status: half ? "half_holiday" : "holiday",
    holiday: hit,
    label: `${hit.title}${half ? " (half day)" : ""}`,
    paidForStaff: hit.paidForStaff !== false,
  };
}

/** Staff holiday for a stream (or any staff if omitted). */
export function classifyStaffHolidayDay(
  masters: MastersState,
  isoDate: string,
  academicYearCode: string,
  stream?: StaffStream | "any",
): DayClassification {
  return classifyHolidayDay(masters, isoDate, academicYearCode, {
    kind: "staff",
    stream: stream || "any",
  });
}

export function classifyClassHolidayDay(
  masters: MastersState,
  isoDate: string,
  academicYearCode: string,
  classId: string,
): DayClassification {
  return classifyHolidayDay(masters, isoDate, academicYearCode, {
    kind: "class",
    classId,
  });
}

export function previewHolidayDates(h: Holiday, max = 12): string[] {
  const out: string[] = [];
  const from = h.startsOn.slice(0, 10);
  const to = h.endsOn.slice(0, 10);
  if (!from || !to || from > to) return out;

  const mode = h.mode || "one_off";
  if (mode === "one_off") {
    const cur = new Date(`${from}T12:00:00`);
    const end = new Date(`${to}T12:00:00`);
    while (cur <= end && out.length < max) {
      const iso = cur.toISOString().slice(0, 10);
      if (!(h.exceptionDates ?? []).includes(iso) && !h.workingOverride) {
        out.push(iso);
      }
      cur.setDate(cur.getDate() + 1);
    }
    return out;
  }

  const wd = typeof h.weekday === "number" ? h.weekday : null;
  if (wd == null) return out;
  const cur = new Date(`${from}T12:00:00`);
  const end = new Date(`${to}T12:00:00`);
  while (cur.getDay() !== wd && cur <= end) {
    cur.setDate(cur.getDate() + 1);
  }
  while (cur <= end && out.length < max) {
    const iso = cur.toISOString().slice(0, 10);
    if (!(h.exceptionDates ?? []).includes(iso)) out.push(iso);
    cur.setDate(cur.getDate() + 7);
  }
  return out;
}

export function appliesToLabel(appliesTo: HolidayAppliesTo | undefined): string {
  const a = appliesTo || "everyone";
  const map: Record<HolidayAppliesTo, string> = {
    everyone: "Students + all staff",
    students: "Students only",
    staff_all: "All staff only",
    staff_teaching: "Teachers only",
    staff_non_teaching: "Non-teaching only",
    students_and_teaching: "Students + teachers",
    students_and_non_teaching: "Students + non-teaching",
  };
  return map[a] || a;
}

export function describeHolidayRule(h: Holiday): string {
  const bits: string[] = [];
  bits.push(appliesToLabel(h.appliesTo));
  const scope = h.scope || "school";
  if (scope === "school") bits.push("School-wide");
  else if (scope === "class_group") {
    const g = CLASS_GROUPS.find((x) => x.code === h.groupCode);
    bits.push(`Group: ${g?.label ?? h.groupCode ?? "—"}`);
  } else bits.push(`Class (${(h.classIds ?? []).length})`);

  if ((h.mode || "one_off") === "weekly") {
    const w =
      typeof h.weekday === "number" ? WEEKDAY_LABELS[h.weekday] : "?";
    bits.push(`Every ${w}`);
  } else {
    bits.push(
      h.endsOn !== h.startsOn
        ? `${h.startsOn} → ${h.endsOn}`
        : h.startsOn,
    );
  }
  if ((h.dayType || "full") === "half") bits.push("Half day");
  if (h.workingOverride) bits.push("Working override");
  if (
    h.paidForStaff !== false &&
    (appliesToIncludesTeaching(h.appliesTo) ||
      appliesToIncludesNonTeaching(h.appliesTo))
  ) {
    bits.push("Paid for staff");
  }
  return bits.join(" · ");
}

export type WeeklyClassHoliday = {
  weekday: number;
  title: string;
  dayType: "full" | "half";
  holidayId: string;
};

/**
 * Published weekly holiday rules that apply to a class (students).
 * Used by timetable to skip recurring off-days (e.g. every Saturday for Primary).
 */
export function listWeeklyClassHolidays(
  masters: MastersState,
  academicYearCode: string,
  classId: string,
): WeeklyClassHoliday[] {
  const audience: HolidayAudience = { kind: "class", classId };
  const out: WeeklyClassHoliday[] = [];
  for (const h of masters.holidays ?? []) {
    if (!h.isPublished) continue;
    if (h.academicYearCode !== academicYearCode) continue;
    if ((h.mode || "one_off") !== "weekly") continue;
    if (h.workingOverride) continue;
    if (typeof h.weekday !== "number" || h.weekday < 0 || h.weekday > 6) {
      continue;
    }
    if (!holidayAppliesToAudience(h, audience, masters)) continue;
    out.push({
      weekday: h.weekday,
      title: h.title || "Weekly holiday",
      dayType: (h.dayType || "full") === "half" ? "half" : "full",
      holidayId: h.id,
    });
  }
  // Prefer full over half when same weekday listed twice
  out.sort((a, b) => {
    if (a.weekday !== b.weekday) return a.weekday - b.weekday;
    return a.dayType === "full" ? -1 : 1;
  });
  const seen = new Set<number>();
  const dedup: WeeklyClassHoliday[] = [];
  for (const row of out) {
    if (seen.has(row.weekday)) continue;
    seen.add(row.weekday);
    dedup.push(row);
  }
  return dedup;
}


export { WEEKDAY_LABELS };
