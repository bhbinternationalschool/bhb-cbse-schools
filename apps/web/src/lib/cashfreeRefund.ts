/**
 * The pure half of a Cashfree refund: the id, the request body, the split of
 * a refund across fee and surcharge, and reading the refund webhook.
 * No network, no env, no clock — testable.
 *
 * WHY REFUNDS NEED THEIR OWN CARE
 *
 * A refund is the only money movement in the system that the school initiates
 * and cannot take back. It is also ASYNCHRONOUS: the API answers PENDING and
 * the outcome arrives minutes or days later by webhook. So the two halves must
 * not be confused — asking for a refund is not the same event as the parent
 * getting their money, and the fee book must only reopen on the second.
 *
 * Until this existed, a refund had to be done by hand in the Cashfree
 * dashboard, and the ERP learned about it only when the settlement recon
 * report arrived — which parses refund_details already, so the READ side was
 * never the gap. The gap was that the office had to leave the ERP, and the fee
 * book sat saying paid until somebody remembered to void the receipt.
 */

/** Cashfree's own statuses, plus the one we hold before it has answered. */
export type CashfreeRefundStatus =
  | "PENDING"
  | "PENDING_APPROVAL"
  | "ONHOLD"
  | "CANCELLED"
  | "SUCCESS"
  | "FAILED";

/** Only SUCCESS means the parent has their money and the fee may reopen. */
export function refundIsSettled(status: string): boolean {
  return String(status).trim().toUpperCase() === "SUCCESS";
}

/**
 * A refund that will never complete. Distinguished from PENDING so the desk
 * can say "this did not happen, try again" rather than leaving a row that
 * looks like it is still on its way for ever.
 */
export function refundIsDead(status: string): boolean {
  const s = String(status).trim().toUpperCase();
  return s === "FAILED" || s === "CANCELLED";
}

export const CASHFREE_REFUND_ID_RE = /^[A-Za-z0-9_-]{3,40}$/;

/**
 * Our id for the refund, derived from the receipt and the amount.
 *
 * Deterministic ON PURPOSE. Cashfree rejects a duplicate refund_id, and that
 * rejection is the outermost guard against refunding a parent twice because a
 * button was double-clicked or a request was retried after a lost response.
 * A random id would make every retry a NEW refund, which is the one mistake in
 * this file that cannot be undone.
 *
 * The amount is part of the id so a deliberate second, different refund on the
 * same receipt (a further partial) is still possible.
 */
export function cashfreeRefundId(voucherId: string, amountPaise: number): string {
  const base = String(voucherId || "")
    .replace(/[^A-Za-z0-9_-]/g, "")
    .slice(0, 28);
  return `rf_${base}_${Math.max(0, Math.round(amountPaise))}`.slice(0, 40);
}

export type RefundSplit = {
  /** The part that clears fee dues — what the receipt was written for. */
  feePaise: number;
  /** The part that returns the gateway charge the parent bore. */
  surchargePaise: number;
  /** What Cashfree is asked to return: the two above. */
  totalPaise: number;
};

/**
 * Split a refund across the fee and the gateway charge the parent paid.
 *
 * A parent refunded their fee must get the charge back too — the school is not
 * entitled to keep a payment charge on money it did not keep. For a PARTIAL
 * refund the charge comes back in proportion, so refunding half the fee
 * returns half the charge.
 *
 * Rounded so the surcharge share can never exceed what was collected, and so
 * a full refund returns exactly the full charge rather than a rounded
 * approximation of it.
 */
export function splitRefund(input: {
  /** Fee to return, in paise. */
  feePaise: number;
  /** The fee the original receipt was for. */
  originalFeePaise: number;
  /** The gateway charge the parent paid on top of it. */
  originalSurchargePaise: number;
}): RefundSplit {
  const originalFee = Math.max(0, Math.round(input.originalFeePaise));
  const originalSurcharge = Math.max(0, Math.round(input.originalSurchargePaise));
  const fee = Math.min(Math.max(0, Math.round(input.feePaise)), originalFee);

  if (fee === 0 || originalFee === 0) {
    return { feePaise: 0, surchargePaise: 0, totalPaise: 0 };
  }
  // Exactly the whole charge on a whole refund — not a rounding of it.
  const surchargePaise =
    fee === originalFee
      ? originalSurcharge
      : Math.min(originalSurcharge, Math.round((originalSurcharge * fee) / originalFee));

  return { feePaise: fee, surchargePaise, totalPaise: fee + surchargePaise };
}

export type CashfreeRefundBody = {
  refund_id: string;
  refund_amount: number;
  refund_note: string;
  refund_speed: "STANDARD" | "INSTANT";
};

/**
 * The create-refund request.
 *
 * STANDARD speed, always. INSTANT costs more and a fee refund is never
 * time-critical enough to justify it silently; a school that wants it should
 * have to ask.
 */
export function buildCashfreeRefundBody(input: {
  refundId: string;
  amountPaise: number;
  note: string;
  /** What the original payment came to, fee plus charge. The hard ceiling. */
  originalPaidPaise: number;
}): { ok: true; body: CashfreeRefundBody } | { ok: false; error: string } {
  if (!CASHFREE_REFUND_ID_RE.test(input.refundId)) {
    return { ok: false, error: `Refund id "${input.refundId}" is not valid for Cashfree` };
  }
  const amountPaise = Math.round(input.amountPaise);
  if (!Number.isFinite(amountPaise) || amountPaise < 100) {
    return { ok: false, error: "A refund must be at least ₹1" };
  }
  const ceiling = Math.round(input.originalPaidPaise);
  // Cashfree refuses this too, but refusing it here means the desk sees a
  // sentence it can act on rather than a gateway error code, and no request
  // is spent.
  if (amountPaise > ceiling) {
    return {
      ok: false,
      error: `Cannot refund ₹${(amountPaise / 100).toFixed(2)} — the parent paid ₹${(ceiling / 100).toFixed(2)}`,
    };
  }
  return {
    ok: true,
    body: {
      refund_id: input.refundId,
      refund_amount: Number((amountPaise / 100).toFixed(2)),
      refund_note: (input.note || "Fee refund").slice(0, 150),
      refund_speed: "STANDARD",
    },
  };
}

export type CashfreeRefundEvent = {
  type: string;
  orderId: string;
  refundId: string;
  cfRefundId: string;
  status: string;
  amountPaise: number;
  /** Bank reference, once the money has actually moved. */
  refundArn: string;
  processedAt: string;
};

/**
 * Read a REFUND_STATUS_WEBHOOK payload, or a refund create/read response.
 *
 * Null when the payload is not about a refund, so the webhook route can fall
 * through to its other handlers rather than acting on a misread.
 */
export function readCashfreeRefundEvent(
  event: Record<string, unknown>,
): CashfreeRefundEvent | null {
  const obj = (v: unknown): Record<string, unknown> =>
    v && typeof v === "object" && !Array.isArray(v) ? (v as Record<string, unknown>) : {};
  const data = obj(event.data);
  // Three shapes, one reader: the webhook nests it under data.refund, some
  // replies put it directly under data, and the create/read API returns the
  // refund object itself. Whichever of them actually CARRIES refund_id is the
  // one read — picking a container that merely exists is how the id came off
  // the event while the status came off an empty object and every refund read
  // as "" instead of PENDING.
  const refund = [obj(data.refund), data, event].find((c) => c.refund_id != null) ?? {};
  const refundId = String(refund.refund_id ?? "");
  if (!refundId) return null;

  const amount = Number(refund.refund_amount ?? 0);
  return {
    type: String(event.type ?? ""),
    orderId: String(refund.order_id ?? ""),
    refundId,
    cfRefundId: refund.cf_refund_id != null ? String(refund.cf_refund_id) : "",
    status: String(refund.refund_status ?? "").trim().toUpperCase(),
    amountPaise: Number.isFinite(amount) ? Math.round(amount * 100) : 0,
    refundArn: String(refund.refund_arn ?? ""),
    processedAt: String(refund.processed_at ?? ""),
  };
}
