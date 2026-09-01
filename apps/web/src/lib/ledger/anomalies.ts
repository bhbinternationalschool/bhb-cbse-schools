/**
 * Ledger v2 — the controls layer.
 *
 * Everything before this checks that the books are *consistent*. A trial
 * balance ties whether or not the entries in it are right; a reconciliation
 * proves the bank agrees with the book, but only for the accounts a statement
 * was imported for. What none of it catches is the class of error where the
 * accounting is impeccable and the underlying fact is wrong: the same invoice
 * entered twice, a supplier paid a second time, salary disbursed before anyone
 * approved the run, a month reopened so a figure could be changed.
 *
 * These are pure rules over facts the caller supplies. Every finding names the
 * vouchers it is about, so a person can go and look — a control that says
 * "something seems off" and cannot say where is worse than no control, because
 * it trains people to dismiss it.
 *
 * Deliberately conservative. A finding that fires on ordinary activity gets
 * ignored within a fortnight, and then the real one is ignored too.
 */

export type AnomalySeverity = "critical" | "warning" | "info";

export type Anomaly = {
  code: string;
  severity: AnomalySeverity;
  title: string;
  /** What is wrong, in the words a school office would use. */
  detail: string;
  /** Where to look. Voucher numbers, not ids — a person has to find these. */
  references: string[];
  amountPaise: number;
  /** The single next action, when there is an obvious one. */
  suggestedAction?: string;
};

export type AnomalyVoucher = {
  id: string;
  voucherNo: string;
  voucherType: string;
  date: string;
  createdAt: string;
  narration: string;
  sourceType: string;
  sourceId: string;
  createdBy: string;
  reversed: boolean;
};

export type AnomalyLine = {
  voucherId: string;
  accountCode: string;
  partyKey: string;
  partyName: string;
  debitPaise: number;
  creditPaise: number;
  instrumentRef: string;
};

export type AnomalyBalance = {
  code: string;
  name: string;
  kind: string;
  isCash: boolean;
  isBank: boolean;
  closingPaise: number;
};

export type UnreconciledItem = {
  side: "book" | "statement";
  id: string;
  date: string;
  signedPaise: number;
  narration: string;
};

export type AnomalyFacts = {
  asOf: string;
  vouchers: AnomalyVoucher[];
  lines: AnomalyLine[];
  balances: AnomalyBalance[];
  unreconciled: UnreconciledItem[];
  reopenedPeriods: { period: string; status: string }[];
};

export type AnomalyThresholds = {
  /** Cash on hand above this is a physical-security problem, not an accounting one. */
  cashOnHandLimitPaise: number;
  /** Two payments to one party this close together are worth a second look. */
  duplicatePaymentWindowDays: number;
  /** A bank item nobody has explained for this long has stopped being "in transit". */
  staleReconciliationDays: number;
  /** A voucher entered this long after its own date was back-dated. */
  backdatingGraceDays: number;
};

export const DEFAULT_ANOMALY_THRESHOLDS: AnomalyThresholds = {
  cashOnHandLimitPaise: 50_000_00,
  duplicatePaymentWindowDays: 30,
  staleReconciliationDays: 45,
  backdatingGraceDays: 14,
};

/**
 * The kind of party a line belongs to.
 *
 * partyKey is built as `<kind>:<external id>`, so the kind is already there.
 * Read rather than re-fetched, because a control that needs its own query is
 * a control that quietly stops running.
 */
function partyKindOf(partyKey: string): string {
  const i = partyKey.indexOf(":");
  return i > 0 ? partyKey.slice(0, i) : "";
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a.slice(0, 10)}T00:00:00Z`);
  const db = Date.parse(`${b.slice(0, 10)}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.MAX_SAFE_INTEGER;
  return Math.round((db - da) / 86_400_000);
}

function rupees(paise: number): string {
  const sign = paise < 0 ? "-" : "";
  const abs = Math.abs(Math.round(paise));
  return `${sign}₹${(abs / 100).toLocaleString("en-IN", { minimumFractionDigits: 2, maximumFractionDigits: 2 })}`;
}

/* ─── Rules ────────────────────────────────────────────────── */

/**
 * The same money paid to the same party twice.
 *
 * Matched on party and exact amount inside a window, because that is what a
 * duplicated invoice actually looks like — the second entry is a faithful copy
 * of the first, not an approximation. Reversed vouchers are excluded: a
 * payment already backed out is the system working, not a problem.
 */
export function findDuplicatePayments(
  facts: AnomalyFacts,
  t: AnomalyThresholds,
): Anomaly[] {
  const live = new Set(facts.vouchers.filter((v) => !v.reversed).map((v) => v.id));
  const byVoucher = new Map(facts.vouchers.map((v) => [v.id, v]));

  // One row per (party, amount) that money actually left for.
  const payments: { voucher: AnomalyVoucher; partyKey: string; partyName: string; amountPaise: number }[] = [];
  for (const l of facts.lines) {
    if (!live.has(l.voucherId)) continue;
    if (!l.partyKey) continue;
    if (l.debitPaise <= 0) continue; // paying a party debits them
    const v = byVoucher.get(l.voucherId);
    if (!v || (v.voucherType !== "payment" && v.voucherType !== "payroll")) continue;
    payments.push({ voucher: v, partyKey: l.partyKey, partyName: l.partyName, amountPaise: l.debitPaise });
  }

  // A party the school still owes money to has not been paid twice — it has
  // been paid in instalments.
  //
  // Peerson Books tripped this: 1,00,000 on 4 April and again on 5 April.
  // Both were instalments on one 6,87,450 bill (50,000 → 1,00,000 →
  // 1,00,000 → 1,23,000 = the 3,73,000 the bill records as paid), and the
  // school still owed the balance. A real double payment leaves the supplier
  // holding money they were never billed for, which is a debit balance — so
  // that, not the repeated amount alone, is the thing worth waking someone
  // for. `party_overpaid` still reports the debit balance itself.
  const netByParty = new Map<string, number>();
  for (const l of facts.lines) {
    if (!live.has(l.voucherId) || !l.partyKey) continue;
    netByParty.set(
      l.partyKey,
      (netByParty.get(l.partyKey) ?? 0) + l.debitPaise - l.creditPaise,
    );
  }

  const grouped = new Map<string, typeof payments>();
  for (const p of payments) {
    if ((netByParty.get(p.partyKey) ?? 0) <= 0) continue;
    const key = `${p.partyKey}|${p.amountPaise}`;
    const list = grouped.get(key);
    if (list) list.push(p);
    else grouped.set(key, [p]);
  }

  const out: Anomaly[] = [];
  for (const group of grouped.values()) {
    if (group.length < 2) continue;
    const sorted = [...group].sort((a, b) => a.voucher.date.localeCompare(b.voucher.date));
    for (let i = 1; i < sorted.length; i += 1) {
      const gap = daysBetween(sorted[i - 1]!.voucher.date, sorted[i]!.voucher.date);
      if (gap > t.duplicatePaymentWindowDays) continue;
      out.push({
        code: "duplicate_payment",
        severity: "critical",
        title: "The same amount paid twice to one party",
        detail: `${sorted[i]!.partyName || sorted[i]!.partyKey} was paid ${rupees(sorted[i]!.amountPaise)} on ${sorted[i - 1]!.voucher.date} and again on ${sorted[i]!.voucher.date}, ${gap} day(s) apart.`,
        references: [sorted[i - 1]!.voucher.voucherNo, sorted[i]!.voucher.voucherNo],
        amountPaise: sorted[i]!.amountPaise,
        suggestedAction: "Check the supplier's invoice numbers before the next payment run; reverse one if it is a duplicate.",
      });
    }
  }
  return out;
}

/**
 * A supplier who owes *us* money.
 *
 * A payable in debit means more has been paid than was ever billed. Sometimes
 * that is a genuine advance, which is why it is a warning rather than a
 * critical — but it is never something to discover at year end.
 */
export function findOverpaidParties(facts: AnomalyFacts): Anomaly[] {
  const live = new Set(facts.vouchers.filter((v) => !v.reversed).map((v) => v.id));
  const net = new Map<string, { name: string; paise: number }>();
  for (const l of facts.lines) {
    if (!live.has(l.voucherId) || !l.partyKey) continue;
    const cur = net.get(l.partyKey) ?? { name: l.partyName, paise: 0 };
    cur.paise += l.debitPaise - l.creditPaise;
    if (l.partyName) cur.name = l.partyName;
    net.set(l.partyKey, cur);
  }

  const out: Anomaly[] = [];
  for (const [key, v] of net) {
    if (v.paise <= 0) continue;
    // Suppliers only. On a SUPPLIER a debit balance means we paid more than
    // they billed. On a STUDENT it means the exact opposite — they owe the
    // school — so this fired on every student with a store balance: 177 of
    // 177 of them, the whole store sales book, reported as overpayments.
    if (partyKindOf(key) !== "vendor") continue;
    out.push({
      code: "party_overpaid",
      severity: "warning",
      title: "Paid more than was billed",
      detail: `${v.name || key} has been paid ${rupees(v.paise)} more than has been billed to them.`,
      references: [],
      amountPaise: v.paise,
      suggestedAction: "Either the advance is genuine and should be recorded as one, or a bill is missing.",
    });
  }
  return out;
}

/**
 * A balance that cannot physically exist.
 *
 * Cash in hand cannot go below zero — the drawer cannot contain minus three
 * hundred rupees. When it does, an entry is in the wrong order, the wrong
 * sign, or missing entirely. Always critical: every figure computed from that
 * account is wrong until it is fixed.
 */
export function findImpossibleBalances(facts: AnomalyFacts): Anomaly[] {
  const out: Anomaly[] = [];
  for (const b of facts.balances) {
    if (!(b.isCash || b.isBank)) continue;
    if (b.closingPaise >= 0) continue;
    out.push({
      code: "negative_cash",
      severity: "critical",
      title: `${b.name} is negative`,
      detail: `${b.name} stands at ${rupees(b.closingPaise)}, which cannot happen in reality. An entry is missing, mis-signed, or out of order.`,
      references: [b.code],
      amountPaise: Math.abs(b.closingPaise),
      suggestedAction: "Trace the account's ledger from the last known-good balance.",
    });
  }
  return out;
}

/** Cash on hand beyond what a school office should be holding overnight. */
export function findExcessCash(facts: AnomalyFacts, t: AnomalyThresholds): Anomaly[] {
  const cash = facts.balances.filter((b) => b.isCash);
  const total = cash.reduce((n, b) => n + b.closingPaise, 0);
  if (total <= t.cashOnHandLimitPaise) return [];
  return [
    {
      code: "excess_cash_on_hand",
      severity: "warning",
      title: "More cash on hand than the limit",
      detail: `Cash in hand is ${rupees(total)}, above the ${rupees(t.cashOnHandLimitPaise)} limit. This is a safety question before it is an accounting one.`,
      references: cash.map((b) => b.code),
      amountPaise: total,
      suggestedAction: "Bank the excess.",
    },
  ];
}

/**
 * Bank items nobody has explained.
 *
 * A few days is money in transit. Six weeks is a cheque that was never
 * presented, a payment that never left, or an entry for something that did not
 * happen — and on the statement side, money the school received or paid that
 * its books have never heard of.
 */
export function findStaleReconciliation(
  facts: AnomalyFacts,
  t: AnomalyThresholds,
): Anomaly[] {
  const out: Anomaly[] = [];
  for (const item of facts.unreconciled) {
    const age = daysBetween(item.date, facts.asOf);
    if (age < t.staleReconciliationDays) continue;
    out.push({
      code: item.side === "book" ? "stale_unpresented" : "stale_unrecorded",
      severity: "warning",
      title:
        item.side === "book"
          ? "An entry the bank has never seen"
          : "Money the books have never heard of",
      detail:
        item.side === "book"
          ? `${rupees(Math.abs(item.signedPaise))} dated ${item.date} (${item.narration}) has been in the book for ${age} days without appearing on any statement.`
          : `The bank shows ${rupees(Math.abs(item.signedPaise))} on ${item.date} (${item.narration}) that has been unexplained for ${age} days.`,
      references: [item.narration || item.id],
      amountPaise: Math.abs(item.signedPaise),
      suggestedAction:
        item.side === "book"
          ? "Confirm the cheque was presented, or reverse the entry."
          : "Identify and post it — bank charges and interest are the usual answers.",
    });
  }
  return out;
}

/**
 * Salary paid without ever being posted.
 *
 * The two are separate events on purpose, and the order is not negotiable: a
 * run is approved and posted, and only then is it paid. A payment with no
 * accrual behind it means money left before anyone signed off the figures.
 */
export function findUnaccruedPayroll(facts: AnomalyFacts): Anomaly[] {
  const live = facts.vouchers.filter((v) => !v.reversed);
  const accrued = new Set(
    live.filter((v) => v.sourceType === "payroll_run").map((v) => v.sourceId),
  );
  const out: Anomaly[] = [];
  for (const v of live) {
    if (v.sourceType !== "payroll_payment") continue;
    if (accrued.has(v.sourceId)) continue;
    const amount = facts.lines
      .filter((l) => l.voucherId === v.id)
      .reduce((n, l) => n + l.debitPaise, 0);
    out.push({
      code: "payroll_paid_unaccrued",
      severity: "critical",
      title: "Salary paid for a run that was never posted",
      detail: `${v.voucherNo} pays ${rupees(amount)} for a payroll run that has no posted accrual behind it.`,
      references: [v.voucherNo],
      amountPaise: amount,
      suggestedAction: "Find the run and post it, or reverse the payment.",
    });
  }
  return out;
}

/**
 * Entries written long after the date they claim.
 *
 * Back-dating is not automatically wrong — a bill arriving late is normal. It
 * is worth surfacing because it is also exactly what altering a closed period
 * looks like, and the two are indistinguishable without someone looking.
 */
export function findBackdatedEntries(
  facts: AnomalyFacts,
  t: AnomalyThresholds,
): Anomaly[] {
  const out: Anomaly[] = [];
  const shutPeriods = new Set(
    facts.reopenedPeriods
      .filter((p) => p.status === "locked" || p.status === "closed")
      .map((p) => p.period),
  );
  for (const v of facts.vouchers) {
    if (v.reversed) continue;
    // Opening balances are dated the first day of the year and entered later
    // by their nature; flagging them would be noise every single year.
    if (v.voucherType === "opening" || v.voucherType === "closing") continue;
    const lag = daysBetween(v.date, v.createdAt.slice(0, 10));
    if (lag <= t.backdatingGraceDays) continue;
    // Only when the period it lands in is actually shut.
    //
    // The reason this rule exists is that backdating is indistinguishable
    // from altering a closed period. If the period is open, late entry is
    // just late entry — and a school keying this year's history into a
    // system it adopted mid-year backdates nearly everything: 648 of 721
    // vouchers here, average 95 days. At that volume the rule reported the
    // migration, and buried everything else.
    if (!shutPeriods.has(String(v.date).slice(0, 7))) continue;
    const amount = facts.lines
      .filter((l) => l.voucherId === v.id)
      .reduce((n, l) => n + l.debitPaise, 0);
    out.push({
      code: "backdated_entry",
      severity: "info",
      title: "Entered well after its own date",
      detail: `${v.voucherNo} is dated ${v.date} but was entered ${lag} days later.`,
      references: [v.voucherNo],
      amountPaise: amount,
      suggestedAction: "Normal for a late bill; worth confirming if the period had been closed.",
    });
  }
  return out;
}

/** A month that was locked and is open again. */
export function findReopenedPeriods(facts: AnomalyFacts): Anomaly[] {
  return facts.reopenedPeriods
    .filter((p) => p.status === "open")
    .map((p) => ({
      code: "period_reopened",
      severity: "warning" as const,
      title: `${p.period} was locked and is open again`,
      detail: `The period ${p.period} has a lock record but is currently open, so entries can be added to a month that had been signed off.`,
      references: [p.period],
      amountPaise: 0,
      suggestedAction: "Lock it again once whatever needed changing has been changed.",
    }));
}

/* ─── The suite ────────────────────────────────────────────── */

const SEVERITY_ORDER: Record<AnomalySeverity, number> = {
  critical: 0,
  warning: 1,
  info: 2,
};

export function runAnomalyChecks(
  facts: AnomalyFacts,
  thresholds: AnomalyThresholds = DEFAULT_ANOMALY_THRESHOLDS,
): Anomaly[] {
  return [
    ...findImpossibleBalances(facts),
    ...findDuplicatePayments(facts, thresholds),
    ...findUnaccruedPayroll(facts),
    ...findOverpaidParties(facts),
    ...findExcessCash(facts, thresholds),
    ...findStaleReconciliation(facts, thresholds),
    ...findReopenedPeriods(facts),
    ...findBackdatedEntries(facts, thresholds),
  ].sort(
    (a, b) =>
      SEVERITY_ORDER[a.severity] - SEVERITY_ORDER[b.severity] ||
      b.amountPaise - a.amountPaise,
  );
}

export function summariseAnomalies(list: Anomaly[]): {
  critical: number;
  warning: number;
  info: number;
  totalAmountPaise: number;
} {
  return {
    critical: list.filter((a) => a.severity === "critical").length,
    warning: list.filter((a) => a.severity === "warning").length,
    info: list.filter((a) => a.severity === "info").length,
    totalAmountPaise: list
      .filter((a) => a.severity === "critical")
      .reduce((n, a) => n + a.amountPaise, 0),
  };
}
