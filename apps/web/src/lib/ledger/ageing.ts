/**
 * Ledger v2 — how old the money is.
 *
 * Ageing is what turns a payables balance into a decision. "We owe eight lakh"
 * is a number; "two lakh of it fell due more than ninety days ago" is a
 * conversation with a supplier that should have happened already.
 *
 * Aged by due date where there is one and by voucher date where there is not,
 * and the report says which — a payable aged from its invoice date looks
 * overdue a month before it is, and acting on that number damages a supplier
 * relationship over an error.
 *
 * Payments are applied against bills oldest-first. This is not a stylistic
 * choice: the ledger records that a supplier was billed and that they were
 * paid, but not *which* bill a payment settled, and without applying one to
 * the other every bill stays outstanding for ever while the payments are
 * simply dropped. A supplier who has been paid in full then shows as still
 * owed — and the natural response to that report is to pay them again. The
 * first version of this did exactly that, and the double payment it would have
 * caused is the very thing the controls layer next door exists to catch.
 */

export type AgeingBucket = "current" | "1_30" | "31_60" | "61_90" | "over_90";

export const AGEING_BUCKET_LABELS: Record<AgeingBucket, string> = {
  current: "Not yet due",
  "1_30": "1–30 days",
  "31_60": "31–60 days",
  "61_90": "61–90 days",
  over_90: "Over 90 days",
};

export type AgeingItem = {
  partyKey: string;
  partyName: string;
  voucherNo: string;
  voucherDate: string;
  dueDate: string | null;
  outstandingPaise: number;
};

export type AgeingRow = {
  partyKey: string;
  partyName: string;
  totalPaise: number;
  buckets: Record<AgeingBucket, number>;
  oldestDays: number;
  /** True when no item carried a due date, so ageing ran from invoice dates. */
  agedFromVoucherDate: boolean;
};

export type AgeingReport = {
  asOf: string;
  rows: AgeingRow[];
  totals: Record<AgeingBucket, number>;
  totalPaise: number;
};

function daysOverdue(asOf: string, effective: string): number {
  const a = Date.parse(`${asOf}T00:00:00Z`);
  const e = Date.parse(`${effective}T00:00:00Z`);
  if (Number.isNaN(a) || Number.isNaN(e)) return 0;
  return Math.round((a - e) / 86_400_000);
}

export function bucketFor(days: number): AgeingBucket {
  if (days <= 0) return "current";
  if (days <= 30) return "1_30";
  if (days <= 60) return "31_60";
  if (days <= 90) return "61_90";
  return "over_90";
}

function emptyBuckets(): Record<AgeingBucket, number> {
  return { current: 0, "1_30": 0, "31_60": 0, "61_90": 0, over_90: 0 };
}

/**
 * Apply a party's payments against their bills, oldest first.
 *
 * Returns the bills that remain outstanding, partially or wholly. A party
 * whose payments exceed their bills comes back empty — they are not owed
 * anything, and the surplus is a separate matter the controls layer reports
 * as an overpayment rather than something to show as a negative age bucket.
 */
function applyPaymentsFifo(
  items: AgeingItem[],
  asOf: string,
): AgeingItem[] {
  const charges = items
    .filter((i) => i.outstandingPaise > 0)
    .sort((a, b) =>
      (a.dueDate ?? a.voucherDate).localeCompare(b.dueDate ?? b.voucherDate),
    );
  let credit = items
    .filter((i) => i.outstandingPaise < 0)
    .reduce((n, i) => n + Math.abs(i.outstandingPaise), 0);

  const remaining: AgeingItem[] = [];
  for (const charge of charges) {
    if (credit <= 0) {
      remaining.push(charge);
      continue;
    }
    if (credit >= charge.outstandingPaise) {
      credit -= charge.outstandingPaise;
      continue;
    }
    remaining.push({ ...charge, outstandingPaise: charge.outstandingPaise - credit });
    credit = 0;
  }
  void asOf;
  return remaining;
}

export function buildAgeing(input: {
  asOf: string;
  items: AgeingItem[];
}): AgeingReport {
  const byParty = new Map<string, AgeingRow>();

  // Group first so payments can be applied within each party.
  const partyItems = new Map<string, AgeingItem[]>();
  for (const item of input.items) {
    if (item.outstandingPaise === 0) continue;
    const list = partyItems.get(item.partyKey);
    if (list) list.push(item);
    else partyItems.set(item.partyKey, [item]);
  }

  const settled = [...partyItems.values()].flatMap((items) =>
    applyPaymentsFifo(items, input.asOf),
  );

  for (const item of settled) {
    // Due date is the honest basis; the voucher date is the fallback, and the
    // row says so rather than letting the reader assume.
    const effective = item.dueDate ?? item.voucherDate;
    const days = daysOverdue(input.asOf, effective);
    const bucket = bucketFor(days);

    const row =
      byParty.get(item.partyKey) ??
      {
        partyKey: item.partyKey,
        partyName: item.partyName,
        totalPaise: 0,
        buckets: emptyBuckets(),
        oldestDays: 0,
        agedFromVoucherDate: true,
      };
    row.totalPaise += item.outstandingPaise;
    row.buckets[bucket] += item.outstandingPaise;
    row.oldestDays = Math.max(row.oldestDays, days);
    if (item.dueDate) row.agedFromVoucherDate = false;
    if (item.partyName) row.partyName = item.partyName;
    byParty.set(item.partyKey, row);
  }

  const rows = [...byParty.values()].sort((a, b) => b.oldestDays - a.oldestDays || b.totalPaise - a.totalPaise);
  const totals = emptyBuckets();
  for (const r of rows) {
    for (const k of Object.keys(totals) as AgeingBucket[]) totals[k] += r.buckets[k];
  }

  return {
    asOf: input.asOf,
    rows,
    totals,
    totalPaise: rows.reduce((n, r) => n + r.totalPaise, 0),
  };
}
