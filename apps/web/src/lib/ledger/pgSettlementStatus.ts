/**
 * What state a gateway settlement is really in, and what it adds to the board.
 *
 * Pure — no server imports — so the settlement mapper, the recon reader and
 * the Gateway settlements panel all decide the same way, and a self-test can
 * hold them to it.
 *
 * Why this exists (15 Oct 2026). Cashfree's first attempt to pay the ₹2,600
 * captured on 9 Oct failed at the bank (settlement 404691537, 13 Oct). It
 * retried under a NEW settlement id (405119119, UTR AXISCN1498598504, 14 Oct)
 * covering the same payment window. The SETTLEMENT_FAILED webhook stored the
 * first one as FAILED, but the nightly /settlements pull then overwrote it:
 * the list row carries no `status`, only settlement_details.reason "FAILED",
 * remarks "Settlement Failed" and payment_details.status "FAILED" — and the
 * mapper read "no UTR" as "still in flight", so it became PENDING. The board
 * then summed both attempts: Gross collected ₹7,700 instead of ₹5,100. The
 * book was right throughout (only SUCCESS posts); the screen was not.
 *
 * Rules held here:
 *   1. Any failure signal from the gateway makes the settlement FAILED. A
 *      missing UTR alone never does — that is "not yet", not "failed".
 *   2. A FAILED settlement adds nothing to gross, fee or net. Its money is the
 *      retry's money; counting both is the double count above.
 *   3. A FAILED settlement that somehow has a voucher is a break, shown as
 *      one — never quietly dropped from the totals and forgotten.
 */

export const PAID_SETTLEMENT_STATUSES = new Set(["SUCCESS", "PAID", "COMPLETED"]);

type Obj = Record<string, unknown>;

function obj(v: unknown): Obj {
  return v && typeof v === "object" && !Array.isArray(v) ? (v as Obj) : {};
}

function up(v: unknown): string {
  return v === null || v === undefined ? "" : String(v).trim().toUpperCase();
}

/** "FAILED", "Settlement Failed", "FAILURE" — the gateway's ways of saying it. */
function saysFailed(v: unknown): boolean {
  return /\bFAIL(ED|URE)?\b/.test(up(v));
}

/**
 * Does the gateway's own record of this settlement say it failed?
 *
 * Reads both shapes we store: the list row (fields nested under
 * settlement_details / payment_details) and the webhook's flat
 * `data.settlement` object. The webhook's `reason` is free text ("Due to some
 * technical issues at the bank…"), so the reason alone is matched only on the
 * word fail; the explicit status and remarks carry the verdict there.
 */
export function rawSaysSettlementFailed(raw: unknown): boolean {
  const r = obj(raw);
  const sd = { ...r, ...obj(r.settlement_details) };
  const pd = obj(r.payment_details);
  return (
    up(sd.status) === "FAILED" ||
    saysFailed(sd.reason) ||
    saysFailed(sd.remarks) ||
    up(pd.status) === "FAILED"
  );
}

/**
 * The status to store for a settlement.
 *
 *   failure signal (raw, explicit status, or a SETTLEMENT_FAILED event) → FAILED
 *   explicit status                                                    → that
 *   UTR and a settlement date                                          → SUCCESS
 *   anything else                                                      → PENDING
 */
export function deriveSettlementStatus(input: {
  explicit?: string;
  utr?: string;
  hasSettledDate?: boolean;
  raw?: unknown;
  eventType?: string;
}): string {
  const explicit = up(input.explicit);
  if (
    explicit === "FAILED" ||
    up(input.eventType) === "SETTLEMENT_FAILED" ||
    rawSaysSettlementFailed(input.raw)
  ) {
    return "FAILED";
  }
  if (explicit) return explicit;
  return input.utr && input.hasSettledDate ? "SUCCESS" : "PENDING";
}

/**
 * When a stored status should survive a re-derived one.
 *
 * A FAILED that the gateway told us about (the webhook carries an explicit
 * status) must not be undone by a later pull whose row merely lacks the
 * signals — that is "unknown", and unknown must not overwrite a fact. Any
 * real verdict from the gateway still wins.
 */
export function mergeStoredStatus(stored: string, derived: string): string {
  return up(stored) === "FAILED" && derived === "PENDING" ? "FAILED" : derived;
}

/** The payment window a settlement covers, from either stored shape. */
export function settlementPaymentWindow(raw: unknown): { from: string; till: string } {
  const r = obj(raw);
  const sd = { ...r, ...obj(r.settlement_details) };
  const s = (v: unknown) => (v === null || v === undefined ? "" : String(v));
  return { from: s(sd.payment_from), till: s(sd.payment_till) };
}

/* ─── The board ─────────────────────────────────────────────── */

export type BoardSettlement = {
  cfSettlementId: string;
  utr: string;
  status: string;
  paymentAmountPaise: number;
  feePaise: number;
  amountSettledPaise: number;
  voucherNo: string;
  reconState: string;
  paymentFrom: string;
  paymentTill: string;
};

/** The id and UTR of the successful settlement that paid a failed one out. */
export type RetriedAs = { cfSettlementId: string; utr: string };

function ms(v: string): number | null {
  if (!v) return null;
  const t = new Date(v).getTime();
  return Number.isNaN(t) ? null : t;
}

/**
 * The paid settlement whose window covers a failed one's, if any.
 *
 * Covering, not overlapping: a retry re-sends the same captures, so its
 * window contains the failed one's. Overlap alone could be the next ordinary
 * cycle and would name the wrong credit. No window on the failed row means we
 * cannot tell — and say "Cashfree will retry" rather than guess a match.
 */
export function findRetry(
  failed: Pick<BoardSettlement, "cfSettlementId" | "paymentFrom" | "paymentTill">,
  candidates: Pick<BoardSettlement, "cfSettlementId" | "utr" | "status" | "paymentFrom" | "paymentTill">[],
): RetriedAs | null {
  const f0 = ms(failed.paymentFrom);
  const f1 = ms(failed.paymentTill);
  if (f0 === null || f1 === null) return null;
  for (const c of candidates) {
    if (c.cfSettlementId === failed.cfSettlementId) continue;
    if (!PAID_SETTLEMENT_STATUSES.has(up(c.status))) continue;
    const c0 = ms(c.paymentFrom);
    const c1 = ms(c.paymentTill);
    if (c0 === null || c1 === null) continue;
    if (c0 <= f0 && c1 >= f1) return { cfSettlementId: c.cfSettlementId, utr: c.utr };
  }
  return null;
}

/**
 * The recon state for a failed settlement.
 *   failed_posted — it has a voucher: a break, the book holds money that never came
 *   failed        — correctly out of the book
 */
export function failedReconState(voucherNo: string): "failed" | "failed_posted" {
  return voucherNo ? "failed_posted" : "failed";
}

export function isFailedState(reconState: string): boolean {
  return reconState === "failed" || reconState === "failed_posted";
}

/** The label a failed row carries in the State column. */
export function failedLabel(retriedAs: RetriedAs | null | undefined): string {
  if (!retriedAs) return "Failed — Cashfree will retry";
  return `Failed — retried as ${retriedAs.cfSettlementId}${retriedAs.utr ? ` / ${retriedAs.utr}` : ""}`;
}

/**
 * Gross, fee and net over the settlements that count.
 *
 * FAILED rows are left out — all of them, including one with a voucher. That
 * one is a break and is flagged in its own row; adding it to "Reached the
 * bank" would put a credit on the screen that the bank statement will never
 * show.
 */
export function summariseSettlements(
  rows: Pick<BoardSettlement, "status" | "reconState" | "paymentAmountPaise" | "feePaise" | "amountSettledPaise">[],
): { gross: number; fee: number; net: number; counted: number; failed: number } {
  let gross = 0;
  let fee = 0;
  let net = 0;
  let counted = 0;
  let failed = 0;
  for (const r of rows) {
    if (up(r.status) === "FAILED" || isFailedState(r.reconState)) {
      failed += 1;
      continue;
    }
    gross += r.paymentAmountPaise;
    fee += r.feePaise;
    net += r.amountSettledPaise;
    counted += 1;
  }
  return { gross, fee, net, counted, failed };
}
