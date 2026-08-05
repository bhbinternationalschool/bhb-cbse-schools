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
