/**
 * When transport billing is allowed to start.
 *
 * Two independent rules, deliberately kept apart because they fail for
 * different reasons and the clerk needs to know which one bit:
 *
 *  1. Never before the child joined. A student admitted in July cannot be
 *     billed for April, May or June — they were not here.
 *  2. Never in a month the school is closed. A summer vacation month carries
 *     no service, so it carries no transport fee.
 *
 * Rule 2 reads the holiday calendar rather than hard-coding June. If the
 * calendar does not say a month is closed, nothing is blocked — an unconfigured
 * calendar must not silently invent a vacation, and equally must not silently
 * bill through a real one. Whether June is closed is a fact about the school's
 * published holidays, not something this module should assume.
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
  if (joined) {
    const joinedMonth = joined.slice(0, 7);
    if (fromMonth < joinedMonth) {
      return {
        ok: false,
        code: "before-admission",
        reason: `Admitted ${monthLabel(joinedMonth)} — transport cannot start in ${monthLabel(fromMonth)}, before the child joined.`,
      };
    }
  }

  if (input.masters) {
    if (monthIsSchoolClosed(input.masters, input.academicYearCode, fromMonth)) {
      return {
        ok: false,
        code: "school-closed",
        reason: `${monthLabel(fromMonth)} is closed for the whole month in the school calendar — no transport runs, so none is billed.`,
      };
    }
  }

  return { ok: true };
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
