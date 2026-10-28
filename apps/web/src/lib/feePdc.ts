/**
 * Post-dated cheques (PDC) — the pure rules.
 *
 * A PDC is a cheque the family hands over today, dated for a later day,
 * against dues it is meant to pay. Holding it is NOT payment: no receipt is
 * made and no due changes until the cheque's date arrives and the cashier
 * deposits it. Deposit then makes an ordinary cheque receipt through the
 * counter engine, and from there the cheque lives in Fees → Cheques like any
 * other (deposited → cleared / bounced).
 *
 * Statuses, one way only:
 *   held ──deposit (on/after cheque date)──▶ deposited
 *   held ──▶ bounced | returned | cancelled
 * `bounced` here is a cheque the bank refused before it ever became a
 * receipt (e.g. presented and dishonoured on a stop-payment the family
 * announced). A deposited PDC that bounces is bounced in Cheques, which voids
 * its receipt — that path already exists and is not duplicated.
 */

import { planBulkAllocation, type BulkDue } from "@/lib/feeBulkAllocation";

export type PdcStatus = "held" | "deposited" | "bounced" | "returned" | "cancelled";

export const PDC_STATUSES: { value: PdcStatus; label: string }[] = [
  { value: "held", label: "Held (not yet due)" },
  { value: "deposited", label: "Deposited — receipt made" },
  { value: "bounced", label: "Bounced" },
  { value: "returned", label: "Returned to family" },
  { value: "cancelled", label: "Cancelled" },
];

export function pdcStatusLabel(s: PdcStatus): string {
  return PDC_STATUSES.find((x) => x.value === s)?.label ?? s;
}

/** One due the cheque is meant for, with the share of the cheque for it. */
export type PdcIntendedLine = {
  studentId: string;
  studentName: string;
  dueKey: string;
  label: string;
  kind: string;
  amountPaise: number;
};

export type PdcRecord = {
  id: string;
  householdId: string;
  guardianName: string;
  chequeNo: string;
  bankName: string;
  /** YYYY-MM-DD — the date written on the cheque. */
  chequeDate: string;
  amountPaise: number;
  /** YYYY-MM-DD — when the school took it. */
  receivedOn: string;
  intended: PdcIntendedLine[];
  status: PdcStatus;
  statusReason: string;
  voucherId: string;
  receiptNo: string;
  note: string;
  createdBy: string;
  createdAt: string;
  updatedAt: string;
};

export type PdcInput = {
  householdId: string;
  chequeNo: string;
  bankName: string;
  chequeDate: string;
  amountPaise: number;
  receivedOn: string;
  intended: PdcIntendedLine[];
};

const DATE_RE = /^\d{4}-\d{2}-\d{2}$/;

function rupees(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/** Days from `a` to `b` (both YYYY-MM-DD), calendar days. */
export function daysBetween(a: string, b: string): number {
  const ms = Date.parse(`${b}T00:00:00Z`) - Date.parse(`${a}T00:00:00Z`);
  return Math.round(ms / 86_400_000);
}

/**
 * What is wrong with a new PDC, or null. `openDueKeys` is the server's own
 * set of the family's open dues ("studentId|dueKey" → balance): a cheque
 * meant for a due that is not open, or for more than it, is refused here
 * rather than discovered on the deposit day.
 */
export function pdcInputProblem(
  input: PdcInput,
  today: string,
  openBalances: Map<string, number>,
): string | null {
  if (!input.householdId) return "Choose the family the cheque is from";
  if (!input.chequeNo.trim()) return "Enter the cheque number";
  if (!input.bankName.trim()) return "Enter the bank the cheque is drawn on";
  if (!DATE_RE.test(input.chequeDate)) return "Enter the date written on the cheque";
  if (!DATE_RE.test(input.receivedOn)) return "Enter the date the cheque was received";
  if (input.receivedOn > today) return "The received date cannot be in the future";
  if (input.chequeDate <= today) {
    return "This cheque is not post-dated — collect it on the Collect tab as a normal cheque";
  }
  if (daysBetween(today, input.chequeDate) > 366) {
    return "A cheque dated more than a year ahead cannot be accepted";
  }
  const amount = Math.round(input.amountPaise);
  if (!(amount > 0)) return "Enter the cheque amount";
  if (input.intended.length === 0) return "Tick the dues this cheque is meant for";
  const seen = new Set<string>();
  let sum = 0;
  for (const l of input.intended) {
    const key = `${l.studentId}|${l.dueKey}`;
    if (seen.has(key)) return `${l.label} is ticked twice`;
    seen.add(key);
    const share = Math.round(l.amountPaise);
    if (!(share > 0)) return `${l.label}: enter the share of the cheque for it`;
    const open = openBalances.get(key);
    if (open === undefined) return `${l.label} (${l.studentName}) is not an open due of this family`;
    if (share > open) return `${l.label}: ${rupees(share)} is more than the ${rupees(open)} owed`;
    sum += share;
  }
  if (sum !== amount) {
    return `The dues ticked come to ${rupees(sum)} but the cheque is for ${rupees(amount)} — they must match`;
  }
  return null;
}

export function canDepositPdc(p: Pick<PdcRecord, "status" | "chequeDate">, today: string): string | null {
  if (p.status !== "held") return `This cheque is already ${pdcStatusLabel(p.status).toLowerCase()}`;
  if (p.chequeDate > today) {
    return `Dated ${p.chequeDate} — a post-dated cheque cannot be deposited before its date`;
  }
  return null;
}

/**
 * How long a deposit holds the cheque. A deposit re-reads the whole fee book,
 * pushes it and rebuilds open dues — minutes on a cold instance — and while it
 * runs nobody may return, cancel or deposit the same cheque. Matches the
 * interval in fee_pdc_claim_deposit.
 */
export const PDC_DEPOSIT_LEASE_MS = 10 * 60 * 1000;

export type PdcCloseGuard = {
  /** Receipt no. of a LIVE receipt carrying 'pdc:<id>', or null if none. */
  liveReceiptNo: string | null;
  /** When a deposit claimed the cheque (ISO), or null. */
  depositClaimedAt: string | null;
  nowMs: number;
};

export function depositClaimHeld(claimedAt: string | null, nowMs: number): boolean {
  if (!claimedAt) return false;
  const t = Date.parse(claimedAt);
  return Number.isFinite(t) && nowMs - t < PDC_DEPOSIT_LEASE_MS;
}

export function canClosePdc(
  p: Pick<PdcRecord, "status">,
  to: "bounced" | "returned" | "cancelled",
  reason: string,
  guard?: PdcCloseGuard,
): string | null {
  if (guard?.liveReceiptNo) {
    // The money is already on a receipt: returning the cheque now would leave
    // a receipt for a cheque the school no longer holds.
    return `Receipt ${guard.liveReceiptNo} was already made for this cheque — press Deposit to finish linking it; if it then bounces, bounce it in Fees → Cheques`;
  }
  if (guard && depositClaimHeld(guard.depositClaimedAt, guard.nowMs)) {
    return "This cheque is being deposited right now — wait a few minutes and reload";
  }
  if (p.status !== "held") {
    return p.status === "deposited"
      ? "This cheque is already a receipt — bounce it from Fees → Cheques, which voids the receipt"
      : `This cheque is already ${pdcStatusLabel(p.status).toLowerCase()}`;
  }
  if (!reason.trim()) {
    return to === "bounced" ? "Enter the bounce reason" : "Say why (e.g. family paid in cash instead)";
  }
  return null;
}

export type PdcUrgency = "overdue" | "due_today" | "this_week" | "later" | "closed";

/**
 * How urgent a cheque is for the cashier. `overdue` = its date has passed and
 * it is still in the drawer (a cheque is valid for three months; the list
 * should shout well before that).
 */
export function pdcUrgency(p: Pick<PdcRecord, "status" | "chequeDate">, today: string): PdcUrgency {
  if (p.status !== "held") return "closed";
  const d = daysBetween(today, p.chequeDate);
  if (d < 0) return "overdue";
  if (d === 0) return "due_today";
  if (d <= 6) return "this_week";
  return "later";
}

/** Held cheques, earliest cheque date first; closed ones after, newest first. */
export function sortPdcsByChequeDate<T extends Pick<PdcRecord, "status" | "chequeDate" | "createdAt">>(rows: T[]): T[] {
  return [...rows].sort((a, b) => {
    const ah = a.status === "held" ? 0 : 1;
    const bh = b.status === "held" ? 0 : 1;
    if (ah !== bh) return ah - bh;
    if (ah === 0) return a.chequeDate.localeCompare(b.chequeDate) || a.createdAt.localeCompare(b.createdAt);
    return b.chequeDate.localeCompare(a.chequeDate) || b.createdAt.localeCompare(a.createdAt);
  });
}

export type PdcDepositLine = {
  studentId: string;
  dueKey: string;
  label: string;
  kind: string;
  amountPaise: number;
};

/**
 * The receipt lines for depositing a PDC, from the dues as they stand TODAY.
 *
 * The family may have paid part of an intended due at the counter since the
 * cheque came in. Each intended due takes what it still owes, up to its
 * share; whatever is left of the cheque goes to that child's other open dues,
 * oldest first (then any child's). If the family now owes less than the
 * cheque, the deposit is refused: depositing would take money for nothing,
 * and the cheque should be returned instead.
 *
 * `live` maps studentId → that child's open dues now.
 */
export function planPdcDeposit(
  pdc: Pick<PdcRecord, "amountPaise" | "intended">,
  live: Map<string, BulkDue[]>,
):
  | { ok: true; lines: PdcDepositLine[]; movedPaise: number }
  | { ok: false; error: string } {
  const remaining = new Map<string, number>();
  for (const [sid, dues] of live) {
    for (const d of dues) remaining.set(`${sid}|${d.dueKey}`, Math.max(0, Math.round(d.balancePaise)));
  }
  const lines: PdcDepositLine[] = [];
  let left = Math.round(pdc.amountPaise);
  for (const l of pdc.intended) {
    const key = `${l.studentId}|${l.dueKey}`;
    const open = remaining.get(key) ?? 0;
    const take = Math.min(open, Math.round(l.amountPaise), left);
    if (take <= 0) continue;
    const liveDue = (live.get(l.studentId) ?? []).find((d) => d.dueKey === l.dueKey);
    lines.push({
      studentId: l.studentId,
      dueKey: l.dueKey,
      label: liveDue?.label || l.label,
      kind: liveDue?.kind || l.kind,
      amountPaise: take,
    });
    remaining.set(key, open - take);
    left -= take;
  }
  const placedOnIntended = Math.round(pdc.amountPaise) - left;

  if (left > 0) {
    // Spill: the intended children first (in the order they appear), then the
    // rest of the family. Uses the same oldest-first rule as bulk payments.
    const order = [...new Set([...pdc.intended.map((l) => l.studentId), ...live.keys()])];
    for (const sid of order) {
      if (left <= 0) break;
      const dues = (live.get(sid) ?? [])
        .map((d) => ({ ...d, balancePaise: remaining.get(`${sid}|${d.dueKey}`) ?? 0 }))
        .filter((d) => d.balancePaise > 0);
      const open = dues.reduce((n, d) => n + d.balancePaise, 0);
      if (open <= 0) continue;
      const take = Math.min(open, left);
      const plan = planBulkAllocation(
        [{ studentId: sid, studentName: sid, householdId: "x", dues }],
        { kind: "per_child", amounts: { [sid]: take } },
      );
      if (!plan.ok) continue;
      for (const r of plan.receipts) {
        for (const pl of r.lines) {
          const existing = lines.find((x) => x.studentId === sid && x.dueKey === pl.dueKey);
          if (existing) existing.amountPaise += pl.amountPaise;
          else lines.push({ studentId: sid, dueKey: pl.dueKey, label: pl.label, kind: pl.kind, amountPaise: pl.amountPaise });
          remaining.set(`${sid}|${pl.dueKey}`, (remaining.get(`${sid}|${pl.dueKey}`) ?? 0) - pl.amountPaise);
        }
      }
      left -= take;
    }
  }
  if (left > 0) {
    return {
      ok: false,
      error: `The family now owes ${rupees(Math.round(pdc.amountPaise) - left)} up to today, less than this ${rupees(Math.round(pdc.amountPaise))} cheque — return the cheque or wait until more is due`,
    };
  }
  return { ok: true, lines, movedPaise: Math.round(pdc.amountPaise) - placedOnIntended };
}

/** Idempotency key on the receipt a PDC deposit makes. */
export function pdcReceiptTransactionId(pdcId: string): string {
  return `pdc:${pdcId}`;
}
