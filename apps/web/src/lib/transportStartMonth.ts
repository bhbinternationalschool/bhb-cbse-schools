/**
 * When transport billing is allowed to start.
 *
 * One rule with a wrinkle, not two rules.
 *
 * The floor is the month the child joined: a student admitted in July cannot be
 * billed for April, May or June, because they were not here. If that joining
 * month is itself a full school closure — a child admitted during the summer
 * break — the floor moves to the next month that runs, because there is no
 * service to start in.
 *
 * What this deliberately does NOT do is block a closed month for everybody.
 * The school bills June transport to continuing riders and to anyone whose
 * assignment already started, and that is correct: the seat is held for the
 * year, not rented by the day. An earlier version of this module blocked any
 * start in a closed month, which would have stopped a child admitted in April
 * from adding transport in June. Only the *joining* month gets bumped.
 *
 * Closure comes from the published holiday calendar, never from a hard-coded
 * June. An unconfigured calendar bumps nothing.
 */

import { classifyHolidayDay } from "@/lib/holidayPolicy";
import type { MastersState } from "@/lib/masters";

export type StartMonthVerdict =
  | { ok: true }
  | { ok: false; code: "before-admission" | "school-closed"; reason: string };

/** "2026-07" → "Jul 2026" */
export function monthLabel(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  if (!y || !m) return periodKey;
  return new Date(y, m - 1, 1).toLocaleDateString("en-IN", {
    month: "short",
    year: "numeric",
  });
}

function daysInMonth(periodKey: string): string[] {
  const [y, m] = periodKey.split("-").map(Number);
  if (!y || !m) return [];
  const last = new Date(y, m, 0).getDate();
  const out: string[] = [];
  for (let d = 1; d <= last; d += 1) {
    out.push(`${periodKey}-${String(d).padStart(2, "0")}`);
  }
  return out;
}

/**
 * True when every single day of the month is a student holiday.
 *
 * Strict on purpose. A month with even one teaching day is a month the school
 * ran, and a rider who travelled on that day should be billed. Sundays are
 * holidays every week, so an ordinary month never qualifies — only a genuine
 * full-month closure does.
 */
export function monthIsSchoolClosed(
  masters: MastersState,
  academicYearCode: string,
  periodKey: string,
): boolean {
  const days = daysInMonth(periodKey);
  if (days.length === 0) return false;
  // No published holidays at all means the calendar is unset, not that the
  // school is open every day — but blocking on an unset calendar would be
  // inventing a fact too. Treat it as "nothing known", i.e. not closed.
  const published = (masters.holidays ?? []).filter(
    (h) => h.isPublished && h.academicYearCode === academicYearCode,
  );
  if (published.length === 0) return false;

  return days.every(
    (d) =>
      classifyHolidayDay(masters, d, academicYearCode, { kind: "school" })
        .status === "holiday",
  );
}

/** Every fully-closed month in the session — for showing the clerk why. */
export function closedMonthsInSession(
  masters: MastersState,
  academicYearCode: string,
  monthKeys: string[],
): string[] {
  return monthKeys.filter((k) =>
    monthIsSchoolClosed(masters, academicYearCode, k),
  );
}

function nextMonthKey(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  if (!y || !m) return periodKey;
  const ny = m === 12 ? y + 1 : y;
  const nm = m === 12 ? 1 : m + 1;
  return `${ny}-${String(nm).padStart(2, "0")}`;
}

/**
 * The earliest month this child may start transport.
 *
 * The joining month, unless the school was shut for all of it — then the next
 * month that runs. Bumps at most a few months so a badly configured calendar
 * cannot loop forever.
 */
export function transportFloorMonth(input: {
  joinedOn?: string;
  academicYearCode: string;
  masters: MastersState | null;
}): string | null {
  const joined = (input.joinedOn || "").slice(0, 10);
  if (!joined) return null;
  let month = joined.slice(0, 7);
  if (!input.masters) return month;
  for (let hop = 0; hop < 6; hop += 1) {
    if (!monthIsSchoolClosed(input.masters, input.academicYearCode, month)) {
      return month;
    }
    month = nextMonthKey(month);
  }
  return month;
}

export function checkTransportStartMonth(input: {
  /** ISO date the assignment would start from. */
  effectiveFrom: string;
  /** Student's admission / joining date. Empty when the school never recorded one. */
  joinedOn?: string;
  academicYearCode: string;
  masters: MastersState | null;
}): StartMonthVerdict {
  const from = (input.effectiveFrom || "").slice(0, 10);
  if (!from) return { ok: true };
  const fromMonth = from.slice(0, 7);

  const joined = (input.joinedOn || "").slice(0, 10);
  if (!joined) return { ok: true };
  const joinedMonth = joined.slice(0, 7);

  const floor = transportFloorMonth(input) ?? joinedMonth;
  if (fromMonth >= floor) return { ok: true };

  // Below the floor. Which of the two reasons applies changes the wording, and
  // the clerk needs to know whether the problem is the child or the calendar.
  if (fromMonth < joinedMonth) {
    return {
      ok: false,
      code: "before-admission",
      reason: `Admitted ${monthLabel(joinedMonth)} — transport cannot start in ${monthLabel(fromMonth)}, before the child joined.`,
    };
  }
  return {
    ok: false,
    code: "school-closed",
    reason: `Admitted in ${monthLabel(joinedMonth)}, which is a full school closure — transport starts from ${monthLabel(floor)}.`,
  };
}

/**
 * The first month transport may start, given the two rules.
 * Returns null when no month in the list qualifies.
 */
export function earliestAllowedMonth(input: {
  monthKeys: string[];
  joinedOn?: string;
  academicYearCode: string;
  masters: MastersState | null;
}): string | null {
  for (const key of [...input.monthKeys].sort()) {
    const verdict = checkTransportStartMonth({
      effectiveFrom: `${key}-01`,
      joinedOn: input.joinedOn,
      academicYearCode: input.academicYearCode,
      masters: input.masters,
    });
    if (verdict.ok) return key;
  }
  return null;
}
