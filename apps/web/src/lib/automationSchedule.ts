/**
 * Friendly schedule helpers for automation rules (standard 5-field cron).
 */

export type ScheduleDayPattern =
  | "every_day"
  | "weekdays_mon_fri"
  | "school_days_mon_sat"
  | "sunday"
  | "custom";

export const SCHEDULE_DAY_OPTIONS: {
  id: ScheduleDayPattern;
  label: string;
  cronDow: string;
}[] = [
  { id: "every_day", label: "Every day", cronDow: "*" },
  { id: "weekdays_mon_fri", label: "Weekdays (Mon–Fri)", cronDow: "1-5" },
  { id: "school_days_mon_sat", label: "School days (Mon–Sat)", cronDow: "1-6" },
  { id: "sunday", label: "Sundays only", cronDow: "0" },
];

export const INTERVAL_PRESETS: { minutes: number; label: string }[] = [
  { minutes: 15, label: "Every 15 minutes" },
  { minutes: 30, label: "Every 30 minutes" },
  { minutes: 60, label: "Every hour" },
  { minutes: 120, label: "Every 2 hours" },
  { minutes: 240, label: "Every 4 hours" },
  { minutes: 360, label: "Every 6 hours" },
  { minutes: 720, label: "Every 12 hours" },
  { minutes: 1440, label: "Once a day" },
];

export const AUTOMATION_EVENT_OPTIONS: {
  key: string;
  label: string;
  description: string;
  modules: string[];
}[] = [
  {
    key: "attendance.absent_marked",
    label: "Student marked absent",
    description: "After morning attendance cutoff",
    modules: ["attendance"],
  },
  {
    key: "homework.published",
    label: "Homework published",
    description: "When teacher publishes class homework",
    modules: ["homework"],
  },
  {
    key: "exams.datesheet_published",
    label: "Exam datesheet published",
    description: "When exam schedule is released",
    modules: ["exams"],
  },
  {
    key: "ptm.opened",
    label: "PTM opened for booking",
    description: "When a PTM slot window opens",
    modules: ["ptm"],
  },
  {
    key: "leave.decided",
    label: "Leave approved or rejected",
    description: "When leave request is decided",
    modules: ["leave"],
  },
  {
    key: "comms.notice_published",
    label: "School notice published",
    description: "When a notice goes live",
    modules: ["comms"],
  },
  {
    key: "campaign.due",
    label: "Campaign message due",
    description: "Scheduled campaign ready to send",
    modules: ["campaigns", "admissions"],
  },
];

export type FriendlySchedule = {
  hour: number;
  minute: number;
  dayPattern: ScheduleDayPattern;
  cronDow: string;
};

export function buildCronExpr(s: FriendlySchedule): string {
  const min = Math.min(59, Math.max(0, s.minute));
  const hr = Math.min(23, Math.max(0, s.hour));
  const dow =
    s.dayPattern === "custom"
      ? s.cronDow || "*"
      : SCHEDULE_DAY_OPTIONS.find((d) => d.id === s.dayPattern)?.cronDow || "*";
  return `${min} ${hr} * * ${dow}`;
}

export function parseCronExpr(expr: string): FriendlySchedule | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length < 5) return null;
  const [minStr, hrStr, , , dowStr] = parts;
  const minute = Number(minStr);
  const hour = Number(hrStr);
  if (!Number.isFinite(minute) || !Number.isFinite(hour)) return null;
  if (minStr?.includes("*") || hrStr?.includes("*")) return null;

  const match = SCHEDULE_DAY_OPTIONS.find((d) => d.cronDow === dowStr);
  if (match) {
    return {
      hour,
      minute,
      dayPattern: match.id,
      cronDow: match.cronDow,
    };
  }
  return {
    hour,
    minute,
    dayPattern: "custom",
    cronDow: dowStr || "*",
  };
}

export function describeCronExpr(expr: string): string {
  if (!expr.trim()) return "No schedule set";
  const parsed = parseCronExpr(expr);
  if (!parsed) return `Custom schedule (${expr})`;

  const h = parsed.hour;
  const m = parsed.minute;
  const ampm = h >= 12 ? "PM" : "AM";
  const h12 = h % 12 || 12;
  const time = `${h12}:${String(m).padStart(2, "0")} ${ampm}`;
  const dayLabel =
    parsed.dayPattern === "custom"
      ? `days ${parsed.cronDow}`
      : SCHEDULE_DAY_OPTIONS.find((d) => d.id === parsed.dayPattern)?.label ||
        parsed.cronDow;
  return `${dayLabel} at ${time} (IST)`;
}

export function describeIntervalMinutes(minutes: number): string {
  const preset = INTERVAL_PRESETS.find((p) => p.minutes === minutes);
  if (preset) return preset.label;
  if (minutes < 60) return `Every ${minutes} minutes`;
  if (minutes % 60 === 0) {
    const h = minutes / 60;
    return h === 1 ? "Every hour" : `Every ${h} hours`;
  }
  return `Every ${minutes} minutes`;
}

export function formatTime24(hour: number, minute: number): string {
  return `${String(hour).padStart(2, "0")}:${String(minute).padStart(2, "0")}`;
}

export function parseTime24(value: string): { hour: number; minute: number } | null {
  const m = /^(\d{1,2}):(\d{2})$/.exec(value.trim());
  if (!m) return null;
  const hour = Number(m[1]);
  const minute = Number(m[2]);
  if (hour < 0 || hour > 23 || minute < 0 || minute > 59) return null;
  return { hour, minute };
}

/* ------------------------------------------------------------------ *
 * When does this cron next fire?
 *
 * `cronExpr` was, until now, decoration. Nothing read it: the tick asked
 * `computeNextRun`, which returned "24 hours from whenever the rule last
 * ran". So a rule set to 8:00 AM on Mon/Wed/Fri, tested by hand at 6:54
 * PM, was next due at 6:54 PM the following day — and a rule that had
 * never run at all counted as due on the very next tick, whatever the
 * clock said. That is how a fee reminder scheduled for Monday morning
 * went out at 00:24 on a Friday.
 *
 * Cron fields here are IST wall-clock, which is what the desk shows and
 * what the office means. Minute, hour, day-of-month, month and day-of-week
 * all accept `*`, `a-b`, `a,b,c`, and `star/step` — enough for every
 * schedule the desk can build and for hand-written ones.
 * ------------------------------------------------------------------ */

const IST_OFFSET_MIN = 330;

/** Expand one cron field into the set of values it matches. */
function cronFieldValues(
  field: string,
  min: number,
  max: number,
): Set<number> | null {
  const out = new Set<number>();
  const raw = (field || "").trim();
  if (!raw) return null;
  for (const part of raw.split(",")) {
    const piece = part.trim();
    if (!piece) return null;
    const [rangePart, stepPart] = piece.split("/");
    const step = stepPart === undefined ? 1 : Number(stepPart);
    if (!Number.isInteger(step) || step < 1) return null;

    let lo: number;
    let hi: number;
    if (rangePart === "*" || rangePart === "?") {
      lo = min;
      hi = max;
    } else if (rangePart?.includes("-")) {
      const [a, b] = rangePart.split("-");
      lo = Number(a);
      hi = Number(b);
    } else {
      lo = Number(rangePart);
      hi = stepPart === undefined ? lo : max;
    }
    if (!Number.isInteger(lo) || !Number.isInteger(hi)) return null;
    if (lo < min || hi > max || lo > hi) return null;
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size ? out : null;
}

type CronFields = {
  minutes: Set<number>;
  hours: Set<number>;
  dom: Set<number>;
  months: Set<number>;
  dow: Set<number>;
  domRestricted: boolean;
  dowRestricted: boolean;
};

export function parseCronFields(expr: string): CronFields | null {
  const parts = (expr || "").trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const [minF, hrF, domF, monF, dowF] = parts as [
    string,
    string,
    string,
    string,
    string,
  ];
  const minutes = cronFieldValues(minF, 0, 59);
  const hours = cronFieldValues(hrF, 0, 23);
  const dom = cronFieldValues(domF, 1, 31);
  const months = cronFieldValues(monF, 1, 12);
  const dowRaw = cronFieldValues(dowF, 0, 7);
  if (!minutes || !hours || !dom || !months || !dowRaw) return null;
  // Cron allows 7 for Sunday.
  const dow = new Set([...dowRaw].map((d) => (d === 7 ? 0 : d)));
  const isStar = (f: string) => f === "*" || f === "?";
  return {
    minutes,
    hours,
    dom,
    months,
    dow,
    domRestricted: !isStar(domF),
    dowRestricted: !isStar(dowF),
  };
}

/**
 * The first instant strictly after `from` that matches `expr` in IST,
 * or null if the expression is unusable (or matches nothing in a year —
 * e.g. 30 February).
 *
 * Standard cron quirk, kept on purpose: when BOTH day-of-month and
 * day-of-week are restricted, a day matching EITHER one fires.
 */
export function nextCronRunIst(expr: string, from: Date): Date | null {
  const f = parseCronFields(expr);
  if (!f) return null;

  const minutesOfDay = [...f.hours]
    .sort((a, b) => a - b)
    .flatMap((h) => [...f.minutes].sort((a, b) => a - b).map((m) => h * 60 + m));
  if (!minutesOfDay.length) return null;

  // Work in IST wall clock by shifting into UTC and reading UTC parts.
  const shifted = new Date(from.getTime() + IST_OFFSET_MIN * 60_000);
  // Start of that IST day; candidates are compared as real instants, so a
  // rule due at 08:00 asked at 08:00:31 is answered with the NEXT one.
  const dayStart = Date.UTC(
    shifted.getUTCFullYear(),
    shifted.getUTCMonth(),
    shifted.getUTCDate(),
  );

  for (let dayOffset = 0; dayOffset <= 366; dayOffset++) {
    const day = new Date(dayStart + dayOffset * 86_400_000);
    const month = day.getUTCMonth() + 1;
    if (!f.months.has(month)) continue;
    const domOk = f.dom.has(day.getUTCDate());
    const dowOk = f.dow.has(day.getUTCDay());
    const dayMatches =
      f.domRestricted && f.dowRestricted
        ? domOk || dowOk
        : f.domRestricted
          ? domOk
          : f.dowRestricted
            ? dowOk
            : true;
    if (!dayMatches) continue;
    for (const mod of minutesOfDay) {
      // Back out of IST into a real instant.
      const at = day.getTime() + mod * 60_000 - IST_OFFSET_MIN * 60_000;
      if (at <= from.getTime()) continue;
      return new Date(at);
    }
  }
  return null;
}
