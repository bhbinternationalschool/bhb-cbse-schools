/**
 * The days a repeating expense lands on.
 *
 * The office buys milk every school day and settles it weekly. Entering that
 * by hand is seven vouchers, so it went in as one lump on one date — which
 * reads as a week's milk bought on a Tuesday, and hides the day the school
 * was shut.
 *
 * A DAILY RATE times the days chosen, not a total divided by them. The office
 * knows what a day of milk costs; it does not know what six days of milk cost
 * until something has divided for it, and a division leaves a remainder to
 * argue about. Multiplying cannot drift.
 *
 * Holidays are marked, not forbidden. The school does open on the odd Sunday,
 * and the person booking the expense knows whether it did — so a holiday is
 * unticked by default and can still be ticked. Locking it would mean editing
 * the school calendar to book a day of milk.
 *
 * Pure: it is handed the holiday test rather than reaching for the calendar,
 * so the same function serves the counter and a test.
 */

export type ExpenseDay = {
  date: string;
  /** Weekday 0=Sun … 6=Sat, so a grid can lay the month out. */
  weekday: number;
  /** The holiday's name when the school calendar says this day is off. */
  holidayReason: string | null;
  /** Ticked when the plan is first built — every working day. */
  selectedByDefault: boolean;
};

export type ExpenseDayPlan =
  | { ok: true; days: ExpenseDay[]; workingCount: number; holidayCount: number }
  | { ok: false; error: string };

/**
 * A range longer than this is almost certainly a typo in a date box, and
 * would otherwise offer a voucher a day for months. A term is about three.
 */
export const MAX_SPREAD_DAYS = 92;

function isIsoDate(v: string): boolean {
  return /^\d{4}-\d{2}-\d{2}$/.test(v) && !Number.isNaN(Date.parse(`${v}T12:00:00`));
}

function addDays(iso: string, n: number): string {
  const d = new Date(`${iso}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/** 0=Sun … 6=Sat, read at midday so no timezone can shift the day. */
export function weekdayOf(iso: string): number {
  return new Date(`${iso}T12:00:00`).getDay();
}

export function enumerateExpenseDays(input: {
  from: string;
  to: string;
  /** Return the holiday's name to mark the date, or null for a working day. */
  holidayReason: (isoDate: string) => string | null;
}): ExpenseDayPlan {
  if (!isIsoDate(input.from) || !isIsoDate(input.to)) {
    return { ok: false, error: "Pick both dates" };
  }
  if (input.to < input.from) {
    return { ok: false, error: "The end date is before the start date" };
  }

  const days: ExpenseDay[] = [];
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) {
    if (days.length >= MAX_SPREAD_DAYS) {
      return {
        ok: false,
        error: `That range is longer than ${MAX_SPREAD_DAYS} days — book it in shorter periods`,
      };
    }
    const reason = input.holidayReason(d);
    days.push({
      date: d,
      weekday: weekdayOf(d),
      holidayReason: reason,
      selectedByDefault: reason === null,
    });
  }

  return {
    ok: true,
    days,
    workingCount: days.filter((d) => d.selectedByDefault).length,
    holidayCount: days.filter((d) => d.holidayReason !== null).length,
  };
}

/**
 * What the chosen days come to.
 *
 * Kept beside the enumeration so the preview and the posting cannot disagree
 * about the arithmetic.
 */
export function expenseTotalPaise(
  dailyRatePaise: number,
  selectedDates: readonly string[],
): number {
  const rate = Math.round(dailyRatePaise);
  if (!Number.isFinite(rate) || rate <= 0) return 0;
  return rate * selectedDates.length;
}
