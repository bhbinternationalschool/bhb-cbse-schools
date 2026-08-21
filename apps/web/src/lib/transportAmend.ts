/**
 * Changing a rider's stop, route or fee part-way through the session.
 *
 * The rule the office runs: the change takes effect from the **first unpaid
 * month**, and months already paid keep the fee they were paid at. A parent
 * who has settled April to August does not get a revised April bill because
 * the stop moved in September.
 *
 * That is why this is a split, not an edit. Editing the assignment in place
 * would silently re-price every month it covers, including the paid ones —
 * `computeTransportPeriodDues` derives each month's amount from the assignment
 * live, so there is no stored history to protect them. Instead the old
 * assignment is closed at the end of the last paid month and a new one opens
 * from the first unpaid month, leaving the paid period priced exactly as it
 * was collected.
 */

import { isFeeDuePaid, type FeeDueLine } from "@/lib/fees";

export type TransportAmendPlan = {
  /** First month the new route / stop / fee applies, e.g. "2026-09". */
  fromMonth: string;
  /** ISO date the new assignment starts — the 1st of `fromMonth`. */
  newEffectiveFrom: string;
  /** ISO date the existing assignment is closed — the last day before that. */
  endCurrentOn: string;
  /** Months already settled, left untouched at their original fee. */
  paidMonths: string[];
  /** Months that will be re-priced. */
  repricedMonths: string[];
};

export type TransportAmendCheck =
  | { ok: true; plan: TransportAmendPlan }
  | { ok: false; error: string };

function lastDayBefore(periodKey: string): string {
  const [y, m] = periodKey.split("-").map(Number);
  // Day 0 of month m is the last day of month m-1.
  const d = new Date(y, m - 1, 0);
  const yy = d.getFullYear();
  const mm = String(d.getMonth() + 1).padStart(2, "0");
  const dd = String(d.getDate()).padStart(2, "0");
  return `${yy}-${mm}-${dd}`;
}

/** Transport months for this student that are fully settled. */
export function paidTransportMonths(dues: FeeDueLine[]): string[] {
  return dues
    .filter((d) => d.kind === "transport" && isFeeDuePaid(d))
    .map((d) => d.dueOn.slice(0, 7))
    .filter((m, i, all) => all.indexOf(m) === i)
    .sort();
}

/**
 * The earliest transport month that still owes money.
 *
 * Returns null when nothing is billed yet — a brand-new rider, or a student
 * whose dues have not been generated. Callers must treat null as "no
 * constraint from payments", not as "everything is paid".
 */
export function firstUnpaidTransportMonth(dues: FeeDueLine[]): string | null {
  const unpaid = dues
    .filter((d) => d.kind === "transport" && !isFeeDuePaid(d))
    .map((d) => d.dueOn.slice(0, 7))
    .sort();
  return unpaid[0] ?? null;
}

/**
 * Work out when a stop / route / fee change may take effect.
 *
 * `requestedMonth` lets the clerk push the change further out (a family moving
 * house next month). It can never pull the change earlier than the first unpaid
 * month — that is the whole protection.
 */
export function planTransportAmendment(input: {
  dues: FeeDueLine[];
  /** Month the clerk asked for, e.g. "2026-10". Optional. */
  requestedMonth?: string;
  /** The assignment being amended — the change cannot predate its own start. */
  currentEffectiveFrom: string;
  /** Fallback when nothing is billed yet: the current month. */
  currentMonth: string;
}): TransportAmendCheck {
  const paid = paidTransportMonths(input.dues);
  const firstUnpaid = firstUnpaidTransportMonth(input.dues);

  // Nothing billed yet → the change is free to start now; nothing to protect.
  const floor = firstUnpaid ?? input.currentMonth;
  const requested = (input.requestedMonth || "").slice(0, 7);

  if (requested && requested < floor) {
    return {
      ok: false,
      error: firstUnpaid
        ? `${requested} is already paid or settled — the change applies from ${floor} onward.`
        : `The change cannot start before ${floor}.`,
    };
  }

  const fromMonth = requested || floor;
  const startFrom = (input.currentEffectiveFrom || "").slice(0, 7);
  if (startFrom && fromMonth <= startFrom) {
    return {
      ok: false,
      error: `This assignment starts in ${startFrom}. Edit it directly rather than splitting it — there is nothing before ${fromMonth} to preserve.`,
    };
  }

  return {
    ok: true,
    plan: {
      fromMonth,
      newEffectiveFrom: `${fromMonth}-01`,
      endCurrentOn: lastDayBefore(fromMonth),
      paidMonths: paid,
      repricedMonths: input.dues
        .filter((d) => d.kind === "transport" && d.dueOn.slice(0, 7) >= fromMonth)
        .map((d) => d.dueOn.slice(0, 7))
        .filter((m, i, all) => all.indexOf(m) === i)
        .sort(),
    },
  };
}
