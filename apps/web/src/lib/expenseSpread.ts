/**
 * Spread one expense evenly across the working days in a date range.
 *
 * The office buys milk every school day and books it once a week. Entering
 * that as seven vouchers by hand is slow and gets skipped, so it ends up as
 * one lump on one date — which then reads as if a week's milk was bought on
 * a Tuesday, and the day a holiday is missed nobody notices.
 *
 * Pure on purpose. It is handed the holiday test rather than reaching for the
 * calendar itself, so the same function serves the counter, a test, and any
 * later caller that knows a different definition of "working day".
 */

export type SpreadDay = {
  date: string;
  amountPaise: number;
};

export type SpreadSkip = {
  date: string;
  /** Why it was skipped, in words the office would use. */
  reason: string;
};

export type SpreadResult =
  | {
      ok: true;
      days: SpreadDay[];
      skipped: SpreadSkip[];
      /** Always equals the requested total — see the remainder note below. */
      totalPaise: number;
      /** The even share before the remainder is handed out, for display. */
      perDayPaise: number;
    }
  | { ok: false; error: string };

/**
 * A range longer than this is almost certainly a typo in a date box, and
 * would otherwise write a voucher a day for months. A term of milk is about
 * three months, so that is the ceiling.
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

export function spreadExpenseOverWorkingDays(input: {
  totalPaise: number;
  from: string;
  to: string;
  /** Return a reason to skip the date, or null to bill it. */
  holidayReason: (isoDate: string) => string | null;
}): SpreadResult {
  const total = Math.round(input.totalPaise);
  if (!Number.isFinite(total) || total <= 0) {
    return { ok: false, error: "Enter an amount greater than zero" };
  }
  if (!isIsoDate(input.from) || !isIsoDate(input.to)) {
    return { ok: false, error: "Pick both dates" };
  }
  if (input.to < input.from) {
    return { ok: false, error: "The end date is before the start date" };
  }

  const dates: string[] = [];
  for (let d = input.from; d <= input.to; d = addDays(d, 1)) {
    dates.push(d);
    if (dates.length > MAX_SPREAD_DAYS) {
      return {
        ok: false,
        error: `That range is longer than ${MAX_SPREAD_DAYS} days — split it into shorter periods`,
      };
    }
  }

  const skipped: SpreadSkip[] = [];
  const working: string[] = [];
  for (const d of dates) {
    const reason = input.holidayReason(d);
    if (reason) skipped.push({ date: d, reason });
    else working.push(d);
  }

  if (working.length === 0) {
    return {
      ok: false,
      error: "Every day in that range is a holiday — nothing to book",
    };
  }

  // The remainder is handed out a paisa at a time to the earliest days, so
  // the parts add back to exactly what was entered. Rounding each day to the
  // nearest paisa instead would leave the vouchers short or over by a few
  // paise, and a books figure that does not tie to the bill is worse than an
  // uneven day.
  const base = Math.floor(total / working.length);
  let remainder = total - base * working.length;
  const days: SpreadDay[] = working.map((date) => {
    const extra = remainder > 0 ? 1 : 0;
    remainder -= extra;
    return { date, amountPaise: base + extra };
  });

  return {
    ok: true,
    days,
    skipped,
    totalPaise: days.reduce((n, d) => n + d.amountPaise, 0),
    perDayPaise: base,
  };
}
