/**
 * The date range behind the dashboard's Expenses card (expenseKpi.ts):
 * today, this week (Monday to today), last week (Monday to Sunday before
 * it), this month (1st to today), or a range
 * the person picks. Dates are the school's calendar days (India), as
 * YYYY-MM-DD, matching ledger voucher dates.
 */

export type ExpensePreset = "today" | "week" | "lastweek" | "month" | "range";

/** YYYY-MM-DD of `d` in India time, whatever the browser's own zone. */
export function istDate(d: Date): string {
  const ist = new Date(d.getTime() + 330 * 60 * 1000);
  return ist.toISOString().slice(0, 10);
}

function addDays(iso: string, n: number): string {
  const t = new Date(`${iso}T00:00:00Z`);
  t.setUTCDate(t.getUTCDate() + n);
  return t.toISOString().slice(0, 10);
}

const ISO = /^\d{4}-\d{2}-\d{2}$/;

/** null when a custom range is incomplete or backwards. */
export function expenseRange(
  preset: ExpensePreset,
  now: Date,
  from = "",
  to = "",
): { from: string; to: string } | null {
  const today = istDate(now);
  if (preset === "today") return { from: today, to: today };
  if (preset === "week") {
    // Monday-start week: Sun=0 → 6 days back, Mon=1 → 0.
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    return { from: addDays(today, -((dow + 6) % 7)), to: today };
  }
  if (preset === "lastweek") {
    const dow = new Date(`${today}T00:00:00Z`).getUTCDay();
    const monday = addDays(today, -((dow + 6) % 7));
    return { from: addDays(monday, -7), to: addDays(monday, -1) };
  }
  if (preset === "month") return { from: `${today.slice(0, 8)}01`, to: today };
  if (!ISO.test(from) || !ISO.test(to) || from > to) return null;
  return { from, to };
}
