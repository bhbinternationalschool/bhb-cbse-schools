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

/* ─── Real cron evaluation ──────────────────────────────────────────────
 *
 * The rules store a standard 5-field cron ("30 10 * * 1-6") in SCHOOL time.
 * Until 2026-09 nothing ever read it: the tick simply added 24 hours to
 * "now", so a rule set for 10:00 fired at whatever minute the first tick
 * happened to run, and drifted from there. These helpers compute the real
 * next occurrence in the rule's timezone (Asia/Kolkata, no DST).
 */

const CRON_RANGES: [number, number][] = [
  [0, 59], // minute
  [0, 23], // hour
  [1, 31], // day of month
  [1, 12], // month
  [0, 6], // day of week (0 = Sunday)
];

function parseCronField(
  field: string,
  min: number,
  max: number,
): Set<number> | null {
  const out = new Set<number>();
  for (const part of field.split(",")) {
    const p = part.trim();
    if (!p) return null;
    const m = /^(\*|\d+(?:-\d+)?)(?:\/(\d+))?$/.exec(p);
    if (!m) return null;
    const base = m[1]!;
    const step = m[2] ? Number(m[2]) : 1;
    if (!Number.isFinite(step) || step < 1) return null;
    let lo = min;
    let hi = max;
    if (base !== "*") {
      const [a, b] = base.split("-").map(Number);
      lo = a!;
      hi = b == null ? (m[2] ? max : a!) : b;
      if (lo < min || hi > max || lo > hi) return null;
    }
    for (let v = lo; v <= hi; v += step) out.add(v);
  }
  return out.size ? out : null;
}

export type ParsedCron = {
  minutes: Set<number>;
  hours: Set<number>;
  daysOfMonth: Set<number>;
  months: Set<number>;
  daysOfWeek: Set<number>;
  /** "*" in the day-of-month / day-of-week field — matching then follows
   * the other field alone, as real cron does. */
  domStar: boolean;
  dowStar: boolean;
};

export function parseCron(expr: string): ParsedCron | null {
  const parts = expr.trim().split(/\s+/);
  if (parts.length !== 5) return null;
  const sets: Set<number>[] = [];
  for (let i = 0; i < 5; i++) {
    // Day of week accepts 7 for Sunday as well as 0.
    const max = i === 4 ? 7 : CRON_RANGES[i]![1];
    const s = parseCronField(parts[i]!, CRON_RANGES[i]![0], max);
    if (!s) return null;
    if (i === 4 && s.has(7)) {
      s.delete(7);
      s.add(0);
    }
    sets.push(s);
  }
  return {
    minutes: sets[0]!,
    hours: sets[1]!,
    daysOfMonth: sets[2]!,
    months: sets[3]!,
    daysOfWeek: sets[4]!,
    domStar: parts[2] === "*",
    dowStar: parts[4] === "*",
  };
}

export function isValidCronExpr(expr: string): boolean {
  return parseCron(expr) !== null;
}

/** Offset of a timezone from UTC, in minutes, at an instant. IST is fixed. */
export function tzOffsetMinutes(at: Date, timezone: string): number {
  if (!timezone || timezone === "Asia/Kolkata" || timezone === "Asia/Calcutta") {
    return 330;
  }
  try {
    const parts = new Intl.DateTimeFormat("en-US", {
      timeZone: timezone,
      hourCycle: "h23",
      year: "numeric",
      month: "2-digit",
      day: "2-digit",
      hour: "2-digit",
      minute: "2-digit",
      second: "2-digit",
    }).formatToParts(at);
    const get = (t: string) => Number(parts.find((p) => p.type === t)?.value);
    const asUtc = Date.UTC(
      get("year"),
      get("month") - 1,
      get("day"),
      get("hour"),
      get("minute"),
      get("second"),
    );
    return Math.round((asUtc - at.getTime()) / 60_000);
  } catch {
    return 330;
  }
}

type WallClock = {
  minute: number;
  hour: number;
  dayOfMonth: number;
  month: number;
  dayOfWeek: number;
};

function wallClockOf(at: Date, offsetMinutes: number): WallClock {
  const shifted = new Date(at.getTime() + offsetMinutes * 60_000);
  return {
    minute: shifted.getUTCMinutes(),
    hour: shifted.getUTCHours(),
    dayOfMonth: shifted.getUTCDate(),
    month: shifted.getUTCMonth() + 1,
    dayOfWeek: shifted.getUTCDay(),
  };
}

function cronMatchesClock(c: ParsedCron, w: WallClock): boolean {
  if (!c.minutes.has(w.minute)) return false;
  if (!c.hours.has(w.hour)) return false;
  if (!c.months.has(w.month)) return false;
  const domOk = c.daysOfMonth.has(w.dayOfMonth);
  const dowOk = c.daysOfWeek.has(w.dayOfWeek);
  if (c.domStar && c.dowStar) return true;
  if (c.domStar) return dowOk;
  if (c.dowStar) return domOk;
  return domOk || dowOk;
}

/** Does the cron fire at this instant (minute precision) in the timezone? */
export function cronMatches(
  expr: string,
  at: Date,
  timezone = "Asia/Kolkata",
): boolean {
  const c = parseCron(expr);
  if (!c) return false;
  return cronMatchesClock(c, wallClockOf(at, tzOffsetMinutes(at, timezone)));
}

/**
 * The next instant strictly after `from` at which the cron fires, as ISO,
 * or null when the expression is invalid or nothing matches within 400 days.
 */
export function nextCronRun(
  expr: string,
  from: Date,
  timezone = "Asia/Kolkata",
): string | null {
  const c = parseCron(expr);
  if (!c) return null;
  // Start at the next whole minute.
  let t = Math.floor(from.getTime() / 60_000) * 60_000 + 60_000;
  const limit = from.getTime() + 400 * 86_400_000;
  while (t <= limit) {
    const at = new Date(t);
    const off = tzOffsetMinutes(at, timezone);
    const w = wallClockOf(at, off);
    if (!c.months.has(w.month)) {
      // Jump to the first minute of the next month (wall clock).
      const shifted = new Date(t + off * 60_000);
      const next = Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth() + 1,
        1,
        0,
        0,
      );
      t = next - off * 60_000;
      continue;
    }
    const domOk = c.daysOfMonth.has(w.dayOfMonth);
    const dowOk = c.daysOfWeek.has(w.dayOfWeek);
    const dayOk =
      c.domStar && c.dowStar
        ? true
        : c.domStar
          ? dowOk
          : c.dowStar
            ? domOk
            : domOk || dowOk;
    if (!dayOk) {
      // Jump to midnight of the next day (wall clock).
      const shifted = new Date(t + off * 60_000);
      const next = Date.UTC(
        shifted.getUTCFullYear(),
        shifted.getUTCMonth(),
        shifted.getUTCDate() + 1,
        0,
        0,
      );
      t = next - off * 60_000;
      continue;
    }
    if (!c.hours.has(w.hour)) {
      // Jump to the start of the next WALL-CLOCK hour (IST is offset by
      // :30, so a UTC hour boundary is not an IST one).
      const shifted = t + off * 60_000;
      const nextWallHour = Math.floor(shifted / 3_600_000) * 3_600_000 + 3_600_000;
      t = nextWallHour - off * 60_000;
      continue;
    }
    if (!c.minutes.has(w.minute)) {
      t += 60_000;
      continue;
    }
    return new Date(t).toISOString();
  }
  return null;
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
