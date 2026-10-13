/**
 * Cancelled entries — a voucher and the reversal that cancels it.
 *
 * The book is append-only: a mistake is not deleted, it is answered by a
 * reversal voucher pointing back at it through `reverses_voucher_id`. Both
 * stay on the record, and every balance is right because the pair nets to
 * zero. But a statement listing both is a statement listing noise — on
 * 13 Oct 2026 Salary & Wages for 2026-27 had 451 lines, 422 of them the
 * clean-up's reversed vouchers and their reversals.
 *
 * Pure, so the statement screen, the Receipts & Payments builder and the
 * self-test share one rule:
 *
 *   - a pair is hidden only when BOTH halves are in the rows at hand — an
 *     original whose reversal falls outside the period is still money that
 *     moved inside it, and hiding it would change the closing balance;
 *   - a pair is hidden only when its lines on this account net to zero, which
 *     a reversal always does — the check is there so a malformed pair can
 *     never quietly move a balance;
 *   - the opening and closing balances never change; the running balance is
 *     recomputed over the lines still shown.
 */

export type VoucherLink = {
  id: string;
  voucherNo: string;
  /** The voucher this one reverses, or "" when it reverses nothing. */
  reversesVoucherId: string;
};

/**
 * Voucher number → pair key (the original's id) for every voucher that is
 * one half of a reversed pair whose other half is also in `links`.
 */
export function cancelledPairKeys(links: VoucherLink[]): Map<string, string> {
  const byId = new Map(links.map((l) => [l.id, l]));
  const out = new Map<string, string>();
  for (const l of links) {
    if (!l.reversesVoucherId) continue;
    const original = byId.get(l.reversesVoucherId);
    if (!original) continue;
    out.set(l.voucherNo, original.id);
    out.set(original.voucherNo, original.id);
  }
  return out;
}

export type StatementLineLike = {
  voucherNo: string;
  debitPaise: number;
  creditPaise: number;
  runningPaise: number;
  /** Pair key when this line belongs to a reversed pair; "" otherwise. */
  cancelledPair?: string;
};

/** What a line does to the balance, in the account's own direction. */
export function lineDelta(
  r: Pick<StatementLineLike, "debitPaise" | "creditPaise">,
  debitNormal: boolean,
): number {
  return debitNormal ? r.debitPaise - r.creditPaise : r.creditPaise - r.debitPaise;
}

/**
 * Do the lines carry the book from its opening to its closing? Opening and
 * closing are the book's own period balances — never read off the first line,
 * which an account with a balance and no movement in the period does not
 * have (it showed ₹0 → ₹0 for a ₹30.48 lakh suspense balance). A mismatch
 * means a page of lines is missing, and the statement must not be shown.
 */
export function statementTies(input: {
  openingPaise: number;
  closingPaise: number;
  rows: Pick<StatementLineLike, "debitPaise" | "creditPaise">[];
  debitNormal: boolean;
}): boolean {
  const moved = input.rows.reduce((n, r) => n + lineDelta(r, input.debitNormal), 0);
  return input.openingPaise + moved === input.closingPaise;
}

/**
 * The statement without its cancelled pairs, running balance recomputed from
 * the opening. `closingPaise` is the same whether pairs are shown or not —
 * the self-test holds it to that.
 */
export function hideCancelledLines<T extends StatementLineLike>(
  rows: T[],
  input: { openingPaise: number; debitNormal: boolean },
): { rows: T[]; hiddenCount: number; closingPaise: number } {
  const pairNet = new Map<string, number>();
  for (const r of rows) {
    if (!r.cancelledPair) continue;
    pairNet.set(
      r.cancelledPair,
      (pairNet.get(r.cancelledPair) ?? 0) + lineDelta(r, input.debitNormal),
    );
  }
  const hide = (r: T) => !!r.cancelledPair && pairNet.get(r.cancelledPair) === 0;

  let running = input.openingPaise;
  let hiddenCount = 0;
  const shown: T[] = [];
  for (const r of rows) {
    if (hide(r)) {
      hiddenCount += 1;
      continue;
    }
    running += lineDelta(r, input.debitNormal);
    shown.push({ ...r, runningPaise: running });
  }
  return { rows: shown, hiddenCount, closingPaise: running };
}

/**
 * Receipts & Payments works per voucher, not per line: drop every voucher
 * that is half of a reversed pair present in the movements. A payment and its
 * reversal would otherwise show as a payment AND a receipt of the same sum
 * under the same head — both totals inflated, the closing cash unchanged.
 */
export function dropCancelledVouchers<T extends { voucherId: string }>(
  movements: T[],
  links: VoucherLink[],
): { movements: T[]; droppedVouchers: number } {
  const present = new Set(movements.map((m) => m.voucherId));
  const pairs = cancelledPairKeys(links.filter((l) => present.has(l.id)));
  const droppedIds = new Set(
    links.filter((l) => pairs.has(l.voucherNo) && present.has(l.id)).map((l) => l.id),
  );
  return {
    movements: movements.filter((m) => !droppedIds.has(m.voucherId)),
    droppedVouchers: droppedIds.size,
  };
}
