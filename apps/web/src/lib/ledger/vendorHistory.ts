/**
 * A vendor's history: what we bought, what we owe, what we paid.
 *
 * The trap this exists to avoid is summing every line that carries a vendor's
 * name. An expense voucher tags the vendor on BOTH the expense debit and, when
 * the bill is unpaid, the payable credit — so a naive total counts a paid bill
 * as if the vendor were owed money, and reports a settled account as a debt.
 * That mistake has already been made once in the controls page.
 *
 * So the two questions are answered from two different sets of lines:
 *
 *   What we owe   — the PAYABLE account only. Credit = billed, debit = paid,
 *                   balance = outstanding. Nothing else can move a debt.
 *   What we spend — the expense heads only. This is turnover with the vendor,
 *                   and it is never a debt.
 *
 * Kept separate on purpose: they are different numbers, and a single "vendor
 * balance" that blends them means nothing to the person chasing a bill.
 */

export type VendorLine = {
  date: string;
  voucherNo: string;
  voucherType: string;
  accountCode: string;
  accountName: string;
  narration: string;
  instrumentRef: string;
  debitPaise: number;
  creditPaise: number;
  /** True when this line sits on the payables account. */
  isPayable: boolean;
};

export type VendorStatementRow = VendorLine & {
  /** What was still owed after this line. Payable rows only. */
  runningDuePaise: number;
};

export type VendorStatement = {
  partyKey: string;
  name: string;
  rows: VendorStatementRow[];
  /** Total billed to us and still unsettled. */
  outstandingPaise: number;
  /** Everything ever billed by this vendor, paid or not. */
  billedPaise: number;
  /** Everything ever paid to them against those bills. */
  paidPaise: number;
  /** Turnover — what we have spent with them, from the expense side. */
  purchasedPaise: number;
  /** The oldest unsettled rupee's age in days, or 0 when nothing is owed. */
  oldestDueDays: number;
  lastActivityOn: string;
};

function daysBetween(fromIso: string, toIso: string): number {
  if (!fromIso || !toIso) return 0;
  const a = Date.parse(`${fromIso}T00:00:00Z`);
  const b = Date.parse(`${toIso}T00:00:00Z`);
  if (!Number.isFinite(a) || !Number.isFinite(b)) return 0;
  return Math.max(0, Math.round((b - a) / 86_400_000));
}

export function buildVendorStatement(input: {
  partyKey: string;
  name: string;
  lines: VendorLine[];
  /** Today, so ageing is reproducible in a test. */
  asOf: string;
}): VendorStatement {
  const sorted = [...input.lines].sort(
    (a, b) => a.date.localeCompare(b.date) || a.voucherNo.localeCompare(b.voucherNo),
  );

  let running = 0;
  const rows: VendorStatementRow[] = sorted.map((l) => {
    if (l.isPayable) running += l.creditPaise - l.debitPaise;
    return { ...l, runningDuePaise: running };
  });

  const payable = sorted.filter((l) => l.isPayable);
  const billedPaise = payable.reduce((n, l) => n + l.creditPaise, 0);
  const paidPaise = payable.reduce((n, l) => n + l.debitPaise, 0);
  const purchasedPaise = sorted
    .filter((l) => !l.isPayable)
    .reduce((n, l) => n + l.debitPaise - l.creditPaise, 0);

  // Ageing walks the bills oldest-first and lets payments consume them, so the
  // age reported is the age of money still unpaid — not of the oldest bill,
  // which may well have been settled years ago.
  let unapplied = paidPaise;
  let oldestOpen = "";
  for (const l of payable) {
    let open = l.creditPaise;
    if (open <= 0) continue;
    const take = Math.min(unapplied, open);
    unapplied -= take;
    open -= take;
    if (open > 0) {
      oldestOpen = l.date;
      break;
    }
  }

  return {
    partyKey: input.partyKey,
    name: input.name,
    rows,
    outstandingPaise: billedPaise - paidPaise,
    billedPaise,
    paidPaise,
    purchasedPaise,
    oldestDueDays: oldestOpen ? daysBetween(oldestOpen, input.asOf) : 0,
    lastActivityOn: sorted.length ? sorted[sorted.length - 1].date : "",
  };
}
