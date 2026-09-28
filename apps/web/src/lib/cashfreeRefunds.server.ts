/**
 * Refunding a parent, from inside the ERP.
 *
 * Until this existed the office had to open the Cashfree dashboard, refund by
 * hand, and then remember to void the receipt — and the ERP only learned of it
 * whenever the settlement recon report next arrived. The read side was never
 * missing (cashfreeSettlements.server.ts parses refund_details already); the
 * ability to do it, and to have the fee book corrected as a consequence, was.
 *
 * TWO EVENTS, NOT ONE. Asking Cashfree for a refund and the parent getting
 * their money are different events, usually days apart, and the second can
 * fail after the first succeeded. So:
 *
 *   requestCashfreeRefund   asks, and records a row that may say PENDING
 *   applyRefundOutcome      called by the webhook; voids the receipt ONLY on
 *                           SUCCESS, and only once
 *
 * Nothing about the fee book changes in between. A due that reopened while the
 * refund was still pending would have the office chasing a family whose money
 * had not come back yet.
 *
 * THE LEDGER NEEDS NOTHING NEW, which is worth stating so nobody adds it. The
 * receipt's own reversal is what voidVoucher already does correctly for any
 * void — including crediting Payment Gateway Clearing, which is where the
 * capture was debited. The refund's effect on the money Cashfree actually
 * sends is already handled too: the recon report treats a refund as a DEBIT
 * event and buildPgSettlementVoucher has a test for a prior-cycle refund
 * reducing a settlement without unbalancing it. Posting a refund journal here
 * as well would double-count it.
 */

import "server-only";

import { cashfreeAuthHeaders, cashfreeBaseUrl, cashfreeKeysPresent } from "@/lib/cashfree.server";
import {
  buildCashfreeRefundBody,
  cashfreeRefundId,
  readCashfreeRefundEvent,
  refundIsDead,
  refundIsSettled,
  splitRefund,
  type CashfreeRefundEvent,
} from "@/lib/cashfreeRefund";
import { getCashfreeCheckout } from "@/lib/cashfreeCheckouts.server";
import { recordPaymentGatewayEvent } from "@/lib/paymentsNormalized.server";
import { getServerTenantContext } from "@/lib/serverTenant";

export type RefundRow = {
  refundId: string;
  orderId: string;
  voucherId: string;
  amountPaise: number;
  feePaise: number;
  surchargePaise: number;
  status: string;
  cfRefundId: string;
  refundArn: string;
  reason: string;
  requestedBy: string;
  appliedAt: string | null;
  lastError: string;
};

function rowToRefund(r: Record<string, unknown>): RefundRow {
  return {
    refundId: String(r.refund_id ?? ""),
    orderId: String(r.order_id ?? ""),
    voucherId: String(r.voucher_id ?? ""),
    amountPaise: Number(r.amount_paise ?? 0),
    feePaise: Number(r.fee_paise ?? 0),
    surchargePaise: Number(r.surcharge_paise ?? 0),
    status: String(r.status ?? ""),
    cfRefundId: String(r.cf_refund_id ?? ""),
    refundArn: String(r.refund_arn ?? ""),
    reason: String(r.reason ?? ""),
    requestedBy: String(r.requested_by ?? ""),
    appliedAt: r.applied_at ? String(r.applied_at) : null,
    lastError: String(r.last_error ?? ""),
  };
}

export async function listRefundsForVoucher(voucherId: string): Promise<RefundRow[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data } = await ctx.sb
    .from("cashfree_refunds")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("voucher_id", voucherId)
    .order("created_at", { ascending: false });
  return (data ?? []).map((r) => rowToRefund(r as Record<string, unknown>));
}

export async function getRefund(refundId: string): Promise<RefundRow | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb
    .from("cashfree_refunds")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("refund_id", refundId)
    .maybeSingle();
  return data ? rowToRefund(data as Record<string, unknown>) : null;
}

/**
 * How much of this receipt is still refundable.
 *
 * Counts everything not already dead, so a PENDING refund holds its amount
 * back. Without that, asking twice in the minutes before the first one
 * resolves would send the parent the money twice — and a refund is the one
 * movement here that cannot be pulled back.
 */
export async function refundableRemaining(input: {
  orderId: string;
  originalFeePaise: number;
  originalSurchargePaise: number;
}): Promise<{ feePaise: number; surchargePaise: number }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { feePaise: 0, surchargePaise: 0 };
  const { data } = await ctx.sb
    .from("cashfree_refunds")
    .select("fee_paise, surcharge_paise, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("order_id", input.orderId);

  let feeTaken = 0;
  let surchargeTaken = 0;
  for (const raw of data ?? []) {
    const r = raw as Record<string, unknown>;
    if (refundIsDead(String(r.status ?? ""))) continue;
    feeTaken += Number(r.fee_paise ?? 0);
    surchargeTaken += Number(r.surcharge_paise ?? 0);
  }
  return {
    feePaise: Math.max(0, Math.round(input.originalFeePaise) - feeTaken),
    surchargePaise: Math.max(0, Math.round(input.originalSurchargePaise) - surchargeTaken),
  };
}

export type RefundRequestResult =
  | { ok: true; refund: RefundRow; settledNow: boolean }
  | { ok: false; error: string };

/**
 * Ask Cashfree to return money to a parent.
 *
 * `feePaise` is the FEE to return; the gateway charge the parent bore comes
 * back with it, in proportion, without the caller having to work that out.
 */
export async function requestCashfreeRefund(input: {
  orderId: string;
  /** Fee to return, in paise. The surcharge share is added automatically. */
  feePaise: number;
  reason: string;
  requestedBy: string;
}): Promise<RefundRequestResult> {
  if (!cashfreeKeysPresent()) return { ok: false, error: "Cashfree keys not configured" };
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };

  const checkout = await getCashfreeCheckout(input.orderId);
  if (!checkout) return { ok: false, error: "No Cashfree payment found for this order" };
  if (checkout.status !== "paid") {
    return { ok: false, error: `This payment is ${checkout.status}, so there is nothing to refund` };
  }

  // What is left after refunds already asked for. A PENDING one still counts.
  const remaining = await refundableRemaining({
    orderId: input.orderId,
    originalFeePaise: checkout.amountPaise,
    originalSurchargePaise: checkout.surchargePaise,
  });
  if (remaining.feePaise <= 0) {
    return { ok: false, error: "This payment has already been refunded in full" };
  }
  const wanted = Math.round(input.feePaise);
  if (wanted > remaining.feePaise) {
    return {
      ok: false,
      error: `Only ₹${(remaining.feePaise / 100).toFixed(2)} of this payment is still refundable`,
    };
  }

  const split = splitRefund({
    feePaise: wanted,
    originalFeePaise: checkout.amountPaise,
    originalSurchargePaise: checkout.surchargePaise,
  });
  if (split.totalPaise <= 0) return { ok: false, error: "Nothing to refund" };

  const refundId = cashfreeRefundId(checkout.ref || input.orderId, split.totalPaise);
  const built = buildCashfreeRefundBody({
    refundId,
    amountPaise: split.totalPaise,
    note: input.reason || "Fee refund",
    originalPaidPaise: checkout.amountPaise + checkout.surchargePaise,
  });
  if (!built.ok) return built;

  // Our row FIRST, before the call.
  //
  // If the request goes out and the response is lost, the row is the only
  // evidence the school ever asked — and the deterministic refund_id means
  // asking again is refused by Cashfree rather than sending the money twice.
  // Writing the row afterwards would leave a refund in flight that nothing in
  // the system knows about, which is the worst state this feature can reach.
  const existing = await getRefund(refundId);
  if (existing && !refundIsDead(existing.status)) {
    return { ok: true, refund: existing, settledNow: refundIsSettled(existing.status) };
  }
  // Resolved now, while the desk is here, so the row names the receipt it will
  // reverse rather than working it out days later from a webhook. Left empty
  // when it cannot be resolved — applyRefundOutcome looks again at that point,
  // and an empty value there is reported rather than guessed at.
  let voucherId = "";
  if (checkout.kind === "fee_link") {
    const { ensureSchoolMirrorHydrated } = await import("@/lib/schoolDataMirror.server");
    await ensureSchoolMirrorHydrated();
    const { ensurePaymentLinkHydrated } = await import("@/lib/paymentsPersistence");
    const link = await ensurePaymentLinkHydrated(checkout.ref, { authoritative: true });
    voucherId = link?.voucherId || "";
  }

  const { error: insertError } = await ctx.sb.from("cashfree_refunds").upsert(
    {
      refund_id: refundId,
      tenant_id: ctx.tenantId,
      order_id: input.orderId,
      voucher_id: voucherId,
      amount_paise: split.totalPaise,
      fee_paise: split.feePaise,
      surcharge_paise: split.surchargePaise,
      status: "PENDING",
      reason: input.reason || "",
      requested_by: input.requestedBy || "",
      last_error: "",
      updated_at: new Date().toISOString(),
    },
    { onConflict: "refund_id" },
  );
  if (insertError) {
    // Refusing to call is the right failure. A refund we cannot record is a
    // refund nobody can reconcile.
    return { ok: false, error: `Could not record the refund: ${insertError.message}` };
  }

  let event: CashfreeRefundEvent | null = null;
  let httpError = "";
  try {
    const res = await fetch(
      `${cashfreeBaseUrl()}/orders/${encodeURIComponent(input.orderId)}/refunds`,
      {
        method: "POST",
        headers: { ...cashfreeAuthHeaders(), "x-idempotency-key": refundId },
        body: JSON.stringify(built.body),
      },
    );
    const payload = (await res.json().catch(() => ({}))) as Record<string, unknown>;
    if (!res.ok) {
      httpError = String(payload.message || `Cashfree HTTP ${res.status}`);
    } else {
      event = readCashfreeRefundEvent(payload);
    }
  } catch (e) {
    httpError = e instanceof Error ? e.message : "Cashfree request failed";
  }

  if (httpError || !event) {
    // Left as PENDING, not marked FAILED: we do not know that Cashfree did
    // NOT accept it. A lost response on an accepted refund marked FAILED here
    // would free the amount to be refunded a second time. The sweep and the
    // webhook both resolve it, and the error is on the row for the desk to see.
    await ctx.sb
      .from("cashfree_refunds")
      .update({ last_error: httpError || "Cashfree gave no refund back", updated_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenantId)
      .eq("refund_id", refundId);
    await recordPaymentGatewayEvent({
      provider: "cashfree",
      eventType: "refund.request_failed",
      externalOrderId: input.orderId,
      externalPaymentId: refundId,
      amountPaise: split.totalPaise,
      settlementStatus: "failed",
      eventJson: { error: httpError, refundId, ...split },
    });
    return { ok: false, error: httpError || "Cashfree did not confirm the refund" };
  }

  await ctx.sb
    .from("cashfree_refunds")
    .update({
      status: event.status || "PENDING",
      cf_refund_id: event.cfRefundId,
      refund_arn: event.refundArn,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("refund_id", refundId);

  await recordPaymentGatewayEvent({
    provider: "cashfree",
    eventType: "refund.requested",
    externalOrderId: input.orderId,
    externalPaymentId: refundId,
    amountPaise: split.totalPaise,
    settlementStatus: "received",
    eventJson: { refundId, status: event.status, cfRefundId: event.cfRefundId, ...split },
  });

  // Sandbox can answer SUCCESS immediately, and so can a real instant refund,
  // so the outcome is applied here rather than waiting for a webhook that has
  // nothing left to tell us.
  let settledNow = false;
  if (refundIsSettled(event.status)) {
    const applied = await applyRefundOutcome(event);
    settledNow = applied.applied;
  }

  const row = await getRefund(refundId);
  return row
    ? { ok: true, refund: row, settledNow }
    : { ok: false, error: "Refund was requested but could not be read back" };
}

export type ApplyOutcome = { applied: boolean; reason: string };

/**
 * A refund's outcome has arrived. Correct the book, once.
 *
 * Called by the webhook and by the immediate path above. Everything here is
 * idempotent: Cashfree redelivers webhooks, and this one voids a receipt.
 */
export async function applyRefundOutcome(event: CashfreeRefundEvent): Promise<ApplyOutcome> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { applied: false, reason: "No tenant context" };

  const row = await getRefund(event.refundId);
  if (!row) {
    // A refund made in the Cashfree dashboard rather than here. Recorded so it
    // is visible, but nothing is voided off it: we do not know which receipt
    // the person meant, and guessing would reverse the wrong money.
    await recordPaymentGatewayEvent({
      provider: "cashfree",
      eventType: "refund.unknown",
      externalOrderId: event.orderId,
      externalPaymentId: event.refundId,
      amountPaise: event.amountPaise,
      settlementStatus: "ignored",
      eventJson: { ...event },
    });
    return { applied: false, reason: "No matching refund row" };
  }

  await ctx.sb
    .from("cashfree_refunds")
    .update({
      status: event.status || row.status,
      cf_refund_id: event.cfRefundId || row.cfRefundId,
      refund_arn: event.refundArn || row.refundArn,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("refund_id", event.refundId);

  // THE GUARD THIS WHOLE MODULE TURNS ON. Anything short of SUCCESS means the
  // parent does not have their money, so the dues must stay closed. Reopening
  // them on PENDING would have the office chasing a family mid-refund.
  if (!refundIsSettled(event.status)) {
    return { applied: false, reason: `Refund is ${event.status || "pending"}` };
  }
  // Already applied: a redelivered webhook must not void a second time.
  if (row.appliedAt) return { applied: false, reason: "Already applied" };

  const { ensureSchoolMirrorHydrated } = await import("@/lib/schoolDataMirror.server");
  await ensureSchoolMirrorHydrated();

  const { loadPayments, getPaymentLink } = await import("@/lib/payments");
  const checkout = await getCashfreeCheckout(row.orderId);
  const voucherId =
    row.voucherId ||
    (checkout?.kind === "fee_link"
      ? getPaymentLink(checkout.ref, loadPayments())?.voucherId || ""
      : "");

  if (!voucherId) {
    await recordPaymentGatewayEvent({
      provider: "cashfree",
      eventType: "refund.no_voucher",
      externalOrderId: row.orderId,
      externalPaymentId: row.refundId,
      amountPaise: row.amountPaise,
      settlementStatus: "failed",
      eventJson: { refundId: row.refundId, kind: checkout?.kind ?? "", ref: checkout?.ref ?? "" },
    });
    return { applied: false, reason: "No receipt found to reverse" };
  }

  const { voidVoucher } = await import("@/lib/fees");
  // voidVoucher reopens the dues, releases the plan allocations and reverses
  // the receipt in the ledger — including crediting clearing, where the
  // capture was debited. Nothing else is posted here: the money Cashfree
  // actually sends back arrives as a DEBIT event in the settlement recon,
  // which is already handled, and a second journal would double-count it.
  const voided = voidVoucher(voucherId);
  if (!voided) {
    await recordPaymentGatewayEvent({
      provider: "cashfree",
      eventType: "refund.void_failed",
      externalOrderId: row.orderId,
      externalPaymentId: row.refundId,
      amountPaise: row.amountPaise,
      settlementStatus: "failed",
      eventJson: { refundId: row.refundId, voucherId },
    });
    return { applied: false, reason: "The receipt could not be voided" };
  }

  // Push the reversal to the database. THE DESK IS NOT THE DATABASE UNTIL
  // SOMEBODY PUSHES IT — the same failure that lost a receipt in September,
  // and it would lose a void just as easily.
  // The reversal only exists in this process until it is pushed. THE DESK IS
  // NOT THE DATABASE UNTIL SOMEBODY PUSHES IT — the same failure that lost a
  // receipt in September, and it loses a void just as easily. loadFees() is
  // read AFTER voidVoucher so the pushed state carries the void.
  const { loadFees } = await import("@/lib/fees");
  const { pushFeesRemoteServer } = await import("@/lib/feesPersistence.server");
  const pushed = (await pushFeesRemoteServer(loadFees())).ok;

  await ctx.sb
    .from("cashfree_refunds")
    .update({
      voucher_id: voucherId,
      applied_at: new Date().toISOString(),
      last_error: pushed ? "" : "Receipt voided but the push to the database failed",
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("refund_id", event.refundId);

  await recordPaymentGatewayEvent({
    provider: "cashfree",
    eventType: pushed ? "refund.applied" : "refund.applied_unpushed",
    externalOrderId: row.orderId,
    externalPaymentId: row.refundId,
    amountPaise: row.amountPaise,
    settlementStatus: pushed ? "settled" : "failed",
    eventJson: { refundId: row.refundId, voucherId, feePaise: row.feePaise, surchargePaise: row.surchargePaise },
  });

  return { applied: true, reason: pushed ? "Receipt reversed" : "Reversed locally; push failed" };
}

/**
 * Ask Cashfree what became of a refund we are still holding as pending.
 *
 * For the sweep, and for a desk that wants to stop waiting. A webhook that
 * never arrives is a real failure mode — this is how a stuck refund resolves
 * without anybody opening the dashboard.
 */
export async function pollRefund(refundId: string): Promise<{ ok: boolean; status: string }> {
  if (!cashfreeKeysPresent()) return { ok: false, status: "" };
  const row = await getRefund(refundId);
  if (!row) return { ok: false, status: "" };
  try {
    const res = await fetch(
      `${cashfreeBaseUrl()}/orders/${encodeURIComponent(row.orderId)}/refunds/${encodeURIComponent(refundId)}`,
      { headers: cashfreeAuthHeaders() },
    );
    if (!res.ok) return { ok: false, status: row.status };
    const event = readCashfreeRefundEvent((await res.json()) as Record<string, unknown>);
    if (!event) return { ok: false, status: row.status };
    await applyRefundOutcome(event);
    return { ok: true, status: event.status };
  } catch {
    return { ok: false, status: row.status };
  }
}
