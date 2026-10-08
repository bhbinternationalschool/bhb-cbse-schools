/**
 * The holiday list the way a school reads it (director, 8 Oct 2026): in date
 * order, month by month across the session (April → March), with the weekly
 * offs (every Sunday, pre-primary Saturdays) apart from the dated holidays.
 * Until this, Masters → Holidays listed rules in the order they were
 * entered, so an imported calendar read Diwali before Holi. Pure.
 */

import type { Holiday } from "@/lib/foundationMasters";

const MONTHS = ["January", "February", "March", "April", "May", "June", "July", "August", "September", "October", "November", "December"];
const SHORT = ["Jan", "Feb", "Mar", "Apr", "May", "Jun", "Jul", "Aug", "Sep", "Oct", "Nov", "Dec"];
const DAYS = ["Sun", "Mon", "Tue", "Wed", "Thu", "Fri", "Sat"];

const iso = (d: string) => (d || "").slice(0, 10);
const dt = (d: string) => new Date(`${iso(d)}T12:00:00Z`);

/** Dated (one-off) holidays first by start date, then end date, then title. */
export function compareHolidaysByDate(a: Holiday, b: Holiday): number {
  return (
    iso(a.startsOn).localeCompare(iso(b.startsOn)) ||
    iso(a.endsOn || a.startsOn).localeCompare(iso(b.endsOn || b.startsOn)) ||
    (a.title || "").localeCompare(b.title || "")
  );
}

/** Weekly rules by weekday (Sunday first), then title. */
export function compareWeeklyRules(a: Holiday, b: Holiday): number {
  return ((a.weekday ?? 9) - (b.weekday ?? 9)) || (a.title || "").localeCompare(b.title || "");
}

export function isWeeklyRule(h: Holiday): boolean {
  return (h.mode || "one_off") === "weekly";
}

/** The dates a one-off holiday covers, less its exception dates. */
export function holidayDates(h: Holiday): string[] {
  const from = iso(h.startsOn);
  const to = iso(h.endsOn || h.startsOn);
  if (!from || !to || to < from) return [];
  const skip = new Set((h.exceptionDates ?? []).map(iso));
  const out: string[] = [];
  for (let d = dt(from); d <= dt(to); d.setUTCDate(d.getUTCDate() + 1)) {
    const k = d.toISOString().slice(0, 10);
    if (!skip.has(k)) out.push(k);
  }
  return out;
}

/** Ids of holidays that repeat another one exactly (same title, same dates) — entered twice. */
export function duplicateHolidayIds(list: Holiday[]): Set<string> {
  const seen = new Map<string, string>();
  const dup = new Set<string>();
  for (const h of [...list].sort(compareHolidaysByDate)) {
    if (isWeeklyRule(h)) continue;
    const key = `${(h.title || "").trim().toLowerCase()}|${iso(h.startsOn)}|${iso(h.endsOn || h.startsOn)}|${h.scope || "school"}|${h.groupCode || ""}`;
    if (seen.has(key)) dup.add(h.id);
    else seen.set(key, h.id);
  }
  return dup;
}

/** Calendar days a one-off holiday covers, less its exception dates. */
export function holidayDayCount(h: Holiday): number {
  const from = iso(h.startsOn);
  const to = iso(h.endsOn || h.startsOn);
  if (!from || !to || to < from) return 0;
  const skip = new Set((h.exceptionDates ?? []).map(iso));
  let n = 0;
  for (let d = dt(from); d <= dt(to); d.setUTCDate(d.getUTCDate() + 1)) {
    if (!skip.has(d.toISOString().slice(0, 10))) n += 1;
  }
  return n;
}

/** "Fri 2 Oct" · "Mon 19 – Tue 20 Oct" · "Sat 31 Oct – Mon 2 Nov". */
export function holidayDateLabel(h: Holiday): string {
  const a = dt(h.startsOn);
  const b = dt(h.endsOn || h.startsOn);
  const one = (d: Date, withMonth: boolean) =>
    `${DAYS[d.getUTCDay()]} ${d.getUTCDate()}${withMonth ? ` ${SHORT[d.getUTCMonth()]}` : ""}`;
  if (iso(h.endsOn || h.startsOn) === iso(h.startsOn)) return one(a, true);
  const sameMonth = a.getUTCMonth() === b.getUTCMonth() && a.getUTCFullYear() === b.getUTCFullYear();
  return `${one(a, !sameMonth)} – ${one(b, true)}`;
}

export type HolidayMonth = {
  /** YYYY-MM */
  key: string;
  label: string;
  holidays: Holiday[];
  /** Distinct days off from the holidays starting this month (a break running
   * into the next month counts here; two entries on one date count once). */
  days: number;
};

/**
 * Dated holidays grouped by the month they start in, in date order, every
 * month of the session listed (an empty month shows as empty, so a missing
 * summer break is visible). A holiday outside the session goes in the month
 * it falls in, after the session's months.
 */
export function holidaysByMonth(list: Holiday[], sessionStart: string, sessionEnd: string): HolidayMonth[] {
  const dated = list.filter((h) => !isWeeklyRule(h) && iso(h.startsOn)).sort(compareHolidaysByDate);
  const keys: string[] = [];
  const s = dt(sessionStart);
  const e = dt(sessionEnd);
  if (iso(sessionStart) && iso(sessionEnd) && s <= e) {
    for (let y = s.getUTCFullYear(), m = s.getUTCMonth(); y < e.getUTCFullYear() || (y === e.getUTCFullYear() && m <= e.getUTCMonth()); ) {
      keys.push(`${y}-${String(m + 1).padStart(2, "0")}`);
      m += 1;
      if (m > 11) {
        m = 0;
        y += 1;
      }
    }
  }
  for (const h of dated) {
    const k = iso(h.startsOn).slice(0, 7);
    if (!keys.includes(k)) keys.push(k);
  }
  return keys.map((key) => {
    const holidays = dated.filter((h) => iso(h.startsOn).slice(0, 7) === key);
    const [y, m] = key.split("-").map(Number);
    return {
      key,
      label: `${MONTHS[m - 1]} ${y}`,
      holidays,
      days: new Set(holidays.filter((h) => !h.workingOverride).flatMap(holidayDates)).size,
    };
  });
}
