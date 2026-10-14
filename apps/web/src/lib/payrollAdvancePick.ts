/**
 * Which salary advances a payroll line recovers (director, 14 Oct 2026: tick
 * the advances on the "Advance outstanding" note, the deduction fills in, and
 * the recovery is booked against exactly those advances).
 *
 * Pure — no storage, no React — so the payroll desk, the advance register
 * and the selftest share one rule:
 *
 *  - rows: a staff member's advances with something left to recover, oldest
 *    first (date given, then the moment it was entered), numbered 1, 2, 3…;
 *  - the ticked advances live on the line's "ADVANCE" (Advance recovery)
 *    component as `advanceIds` — the component is stored whole (jsonb) in
 *    payroll_desk_run_lines.components, so no new column is needed;
 *  - the deduction may be anything from 0 to the ticked balances' total,
 *    never more;
 *  - on publish the deduction is spread over the ticked advances oldest
 *    first; what they cannot absorb is a shortfall the caller must refuse —
 *    it is never moved onto an advance nobody ticked.
 */

/** Salary head code of the advance-recovery deduction on a payroll line. */
export const ADVANCE_HEAD_CODE = "ADVANCE";

/** The fields of a staff advance this rule reads (lib/staffAdvance). */
export type AdvanceLike = {
  id: string;
  staffId: string;
  amount: number;
  givenDate: string;
  createdAt?: string;
  note?: string;
  recoveries: { amount: number; method?: string; payrollRunId?: string }[];
};

export type AdvancePickRow = {
  advanceId: string;
  /** 1 = the oldest advance still open. */
  serial: number;
  givenDate: string;
  amount: number;
  recovered: number;
  balance: number;
  note: string;
};

/**
 * A staff member's advances with a balance, oldest first. `excludeRunId`
 * leaves out salary recoveries already booked by that run — a run's own
 * recoveries are replaced whenever it is (re)published, so they are not
 * "already recovered" from its point of view.
 */
export function advancePickRows(
  advances: AdvanceLike[],
  staffId: string,
  opts: { excludeRunId?: string } = {},
): AdvancePickRow[] {
  const ex = opts.excludeRunId || "";
  return advances
    .filter((a) => a.staffId === staffId)
    .map((a) => {
      const recovered = (a.recoveries || [])
        .filter((r) => !(ex && r.method === "salary" && r.payrollRunId === ex))
        .reduce((s, r) => s + (Number(r.amount) || 0), 0);
      const amount = Number(a.amount) || 0;
      return {
        a,
        amount,
        recovered,
        balance: Math.max(0, amount - recovered),
      };
    })
    // Same "closed" tolerance as lib/staffAdvance normalizeAdvance.
    .filter((x) => x.balance > 0.5)
    .sort(
      (x, y) =>
        (x.a.givenDate || "").localeCompare(y.a.givenDate || "") ||
        (x.a.createdAt || "").localeCompare(y.a.createdAt || "") ||
        x.a.id.localeCompare(y.a.id),
    )
    .map((x, i) => ({
      advanceId: x.a.id,
      serial: i + 1,
      givenDate: x.a.givenDate || "",
      amount: x.amount,
      recovered: x.recovered,
      balance: x.balance,
      note: x.a.note || "",
    }));
}

/** Ticked ids that are still open advances of this person, oldest first, once each. */
export function cleanAdvancePicks(rows: AdvancePickRow[], picks: readonly string[]): string[] {
  const want = new Set(picks);
  return rows.filter((r) => want.has(r.advanceId)).map((r) => r.advanceId);
}

/** Total balance of the ticked advances. */
export function pickedAdvanceTotal(rows: AdvancePickRow[], picks: readonly string[]): number {
  const want = new Set(picks);
  return rows.filter((r) => want.has(r.advanceId)).reduce((s, r) => s + r.balance, 0);
}

/**
 * A typed deduction held to 0…max. `clamped` says the figure was changed, so
 * the screen can say why. Rupees are whole (applyMonthAdjustments rounds).
 */
export function clampAdvanceDeduct(typed: number, max: number): { value: number; clamped: boolean } {
  const cap = Math.max(0, Math.floor(Number(max) || 0));
  const n = Number(typed);
  if (!Number.isFinite(n) || n <= 0) return { value: 0, clamped: Number.isFinite(n) && n < 0 };
  const whole = Math.round(n);
  if (whole > cap) return { value: cap, clamped: true };
  return { value: whole, clamped: false };
}

/**
 * Spread a deduction over the ticked advances, oldest ticked first. Never
 * more than an advance's balance; never onto an advance that was not ticked.
 */
export function allocateAdvanceRecovery(
  rows: AdvancePickRow[],
  picks: readonly string[],
  amount: number,
): { allocations: { advanceId: string; amount: number }[]; shortfall: number } {
  let remaining = Math.max(0, Math.round(Number(amount) || 0));
  const want = new Set(picks);
  const allocations: { advanceId: string; amount: number }[] = [];
  for (const r of rows) {
    if (remaining <= 0) break;
    if (!want.has(r.advanceId)) continue;
    const take = Math.min(r.balance, remaining);
    if (take <= 0) continue;
    allocations.push({ advanceId: r.advanceId, amount: take });
    remaining -= take;
  }
  return { allocations, shortfall: Math.max(0, remaining) };
}

/** The advances ticked on a line (from its Advance recovery component). */
export function lineAdvancePicks(
  components: readonly { headCode: string; advanceIds?: string[] }[] | undefined,
): string[] {
  const c = (components || []).find((x) => x.headCode === ADVANCE_HEAD_CODE);
  return Array.isArray(c?.advanceIds) ? c!.advanceIds.filter((x) => typeof x === "string" && x) : [];
}
