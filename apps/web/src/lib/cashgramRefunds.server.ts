/**
 * Fee refunds by Cashgram — the server half. The rules are in cashgram.ts;
 * this is the order things happen in, and why.
 *
 *   prepare   the desk (fees:void) fills in amount, parent, reason, effect.
 *             Checked against what is refundable NOW; the row is written as
 *             PENDING_APPROVAL, or sent at once when the school's rule says no
 *             approval is needed for it.
 *   approve   the owner. Sends it.
 *   send      payouts switched on, wallet covers this link AND every other
 *             open one, row → SENDING, then Cashfree. A lost reply is UNKNOWN,
 *             never FAILED: it may exist, and a second link would pay twice.
 *   outcome   webhook or a status check. REDEEMED, once: void the receipt
 *             (effect "void"), post Dr … / Cr Payouts Wallet, stamp applied_at.
 *
 * Nothing touches the fee book or the ledger before REDEEMED.
 */

import "server-only";

import {
  buildCashgramBody,
  cashgramCommitsWallet,
  cashgramExpiryDate,
  cashgramIsOpen,
  cashgramNeedsApproval,
  cashgramPhone,
  cashgramPhoneProblem,
  cashgramRefundLines,
  excessRefundableNow,
  newCashgramId,
  readCashgramCreate,
  readCashgramStatus,
  readCashgramStatusResponse,
  voidRefundProblem,
  type CashgramFeeEffect,
  type CashgramStatus,
  type CashgramView,
} from "@/lib/cashgram";
import {
  getPayoutSettings,
  payoutBalance,
  payoutBaseUrl,
  payoutKeysPresent,
  payoutsEnabled,
  payoutV1Token,
} from "@/lib/payouts.server";
import { recordPaymentGatewayEvent } from "@/lib/paymentsNormalized.server";
import { getServerTenantContext } from "@/lib/serverTenant";

export type CashgramRefundRow = {
  cashgramId: string;
  feeEffect: CashgramFeeEffect;
  householdId: string;
  voucherId: string;
  receiptNo: string;
  amountPaise: number;
  payeeName: string;
  payeePhone: string;
  payeeEmail: string;
  reason: string;
  linkExpiry: string;
  status: CashgramStatus;
  cashgramLink: string;
  referenceId: string;
  utr: string;
  requestedBy: string;
  approvedBy: string;
  approvedAt: string | null;
  decidedNote: string;
  appliedAt: string | null;
  ledgerVoucherId: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

function rowTo(r: Record<string, unknown>): CashgramRefundRow {
  const status = String(r.status ?? "");
  return {
    cashgramId: String(r.cashgram_id ?? ""),
    feeEffect: r.fee_effect === "void" ? "void" : "excess",
    householdId: String(r.household_id ?? ""),
    voucherId: String(r.voucher_id ?? ""),
    receiptNo: String(r.receipt_no ?? ""),
    amountPaise: Number(r.amount_paise ?? 0),
    payeeName: String(r.payee_name ?? ""),
    payeePhone: String(r.payee_phone ?? ""),
    payeeEmail: String(r.payee_email ?? ""),
    reason: String(r.reason ?? ""),
    linkExpiry: String(r.link_expiry ?? ""),
    // Our own words are stored as-is; anything else is read through the same
    // gate as Cashfree's, so a stray value can never be REDEEMED.
    status: (["PENDING_APPROVAL", "REJECTED", "SENDING", "UNKNOWN", "CREATE_FAILED"].includes(status)
      ? status
      : readCashgramStatus(status)) as CashgramStatus,
    cashgramLink: String(r.cashgram_link ?? ""),
    referenceId: String(r.reference_id ?? ""),
    utr: String(r.utr ?? ""),
    requestedBy: String(r.requested_by ?? ""),
    approvedBy: String(r.approved_by ?? ""),
    approvedAt: r.approved_at ? String(r.approved_at) : null,
    decidedNote: String(r.decided_note ?? ""),
    appliedAt: r.applied_at ? String(r.applied_at) : null,
    ledgerVoucherId: String(r.ledger_voucher_id ?? ""),
    lastError: String(r.last_error ?? ""),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

function istToday(): string {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

export async function getCashgramRefund(cashgramId: string): Promise<CashgramRefundRow | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb
    .from("cashgram_refunds")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("cashgram_id", cashgramId)
    .maybeSingle();
  return data ? rowTo(data as Record<string, unknown>) : null;
}

export async function listCashgramRefunds(filter: {
  householdId?: string;
  voucherId?: string;
  status?: CashgramStatus;
  limit?: number;
}): Promise<CashgramRefundRow[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  let q = ctx.sb.from("cashgram_refunds").select("*").eq("tenant_id", ctx.tenantId);
  if (filter.householdId) q = q.eq("household_id", filter.householdId);
  if (filter.voucherId) q = q.eq("voucher_id", filter.voucherId);
  if (filter.status) q = q.eq("status", filter.status);
  const { data } = await q.order("created_at", { ascending: false }).limit(filter.limit ?? 200);
  return (data ?? []).map((r) => rowTo(r as Record<string, unknown>));
}

/** Every link that may still draw on the wallet, school-wide. */
async function walletCommittedPaise(exceptId?: string): Promise<{ ok: true; paise: number } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { data, error } = await ctx.sb
    .from("cashgram_refunds")
    .select("cashgram_id, amount_paise, status")
    .eq("tenant_id", ctx.tenantId)
    .in("status", ["SENDING", "UNKNOWN", "ACTIVE", "REDEEMING"]);
  // Unreadable is not zero: a wallet we think is free when it is promised
  // would let a link go out that cannot be paid.
  if (error) return { ok: false, error: `Could not read open refund links: ${error.message}` };
  let n = 0;
  for (const raw of data ?? []) {
    const r = raw as Record<string, unknown>;
    if (exceptId && r.cashgram_id === exceptId) continue;
    if (cashgramCommitsWallet(String(r.status) as CashgramStatus)) n += Number(r.amount_paise ?? 0);
  }
  return { ok: true, paise: n };
}

async function update(cashgramId: string, patch: Record<string, unknown>): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  await ctx.sb
    .from("cashgram_refunds")
    .update({ ...patch, updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("cashgram_id", cashgramId);
}

/* ── what the fee book says may be refunded ──────────────────────────── */

export type HouseholdRefundable = {
  householdId: string;
  /** Paid over the bill, across the household, before any open link. */
  excessPaise: number;
  /** What a new "excess" link may still be for. */
  excessRefundablePaise: number;
  guardianName: string;
  phone: string;
  email: string;
  receipts: {
    voucherId: string;
    receiptNo: string;
    collectionDate: string;
    totalPaise: number;
    modes: string;
    /** "" when it can be refunded by link; otherwise why not. */
    problem: string;
  }[];
};

async function loadFeeWorld() {
  const { ensureSchoolMirrorHydrated } = await import("@/lib/schoolDataMirror.server");
  await ensureSchoolMirrorHydrated();
  const { loadFees, computeHouseholdDues } = await import("@/lib/fees");
  const { loadSis, householdWhatsApp } = await import("@/lib/sis");
  const { loadMasters } = await import("@/lib/masters");
  return { fees: loadFees(), sis: loadSis(), masters: loadMasters(), computeHouseholdDues, householdWhatsApp };
}

/**
 * The household's position as the fee desk's "Refund Amount" chip computes it
 * — paid minus (billed − concession), per due, positive parts summed — but
 * with every future month counted as billed. That is the conservative choice:
 * money paid ahead for a month not yet due is not excess, and refunding it
 * would leave that month unpaid.
 */
export async function householdRefundable(householdId: string): Promise<HouseholdRefundable | null> {
  const w = await loadFeeWorld();
  const household = w.sis.households.find((h) => h.id === householdId);
  if (!household) return null;

  const rows = w.computeHouseholdDues(householdId, w.sis, w.masters, w.fees, { includeFuture: true, includePaid: true });
  let excess = 0;
  for (const row of rows) {
    for (const d of row.dues) {
      const over = d.paidPaise - Math.max(0, d.billedPaise - d.concessionPaise);
      if (over > 0) excess += over;
    }
  }

  const links = await listCashgramRefunds({ householdId });
  const receipts = w.fees.vouchers
    .filter((v) => v.householdId === householdId && !v.voidedAt)
    .sort((a, b) => (b.collectionDate || "").localeCompare(a.collectionDate || ""))
    .slice(0, 40)
    .map((v) => ({
      voucherId: v.id,
      receiptNo: v.receiptNo,
      collectionDate: v.collectionDate,
      totalPaise: v.totalPaise,
      modes: [...new Set(v.tenders.map((t) => t.mode))].join(" + "),
      problem: voidRefundProblem({
        voidedAt: v.voidedAt,
        tenders: v.tenders,
        rowsForVoucher: links.filter((l) => l.voucherId === v.id),
      }),
    }));

  return {
    householdId,
    excessPaise: excess,
    excessRefundablePaise: excessRefundableNow(excess, links),
    guardianName: household.guardianName || "",
    phone: w.householdWhatsApp(household) || household.mobile || "",
    email: household.email || "",
    receipts,
  };
}

/* ── prepare / approve / reject / cancel ─────────────────────────────── */

export type CashgramResult = { ok: true; refund: CashgramRefundRow; message: string } | { ok: false; error: string };

export async function prepareCashgramRefund(input: {
  feeEffect: CashgramFeeEffect;
  householdId: string;
  voucherId?: string;
  amountPaise: number;
  payeeName: string;
  payeePhone: string;
  payeeEmail?: string;
  reason: string;
  expiryDays?: number;
  requestedBy: string;
  /** The preparer is the owner: they are the approver, so it goes out now. */
  requestedByOwner: boolean;
}): Promise<CashgramResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };

  const reason = input.reason.trim();
  if (reason.length < 3) return { ok: false, error: "Say why this is being refunded — it goes on the record" };
  const amount = Math.round(Number(input.amountPaise));
  if (!Number.isFinite(amount) || amount < 100) return { ok: false, error: "A refund must be at least ₹1" };
  const phoneProblem = cashgramPhoneProblem(input.payeePhone);
  if (phoneProblem) return { ok: false, error: phoneProblem };

  // Refuse early, before anyone approves something that cannot be sent.
  if (!payoutKeysPresent()) return { ok: false, error: "Cashfree Payouts is not configured on this server" };

  let householdId = input.householdId.trim();
  let voucherId = "";
  let receiptNo = "";
  if (input.feeEffect === "void") {
    const w = await loadFeeWorld();
    const v = w.fees.vouchers.find((x) => x.id === (input.voucherId || "").trim());
    if (!v) return { ok: false, error: "No such receipt" };
    const links = await listCashgramRefunds({ voucherId: v.id });
    const problem = voidRefundProblem({ voidedAt: v.voidedAt, tenders: v.tenders, rowsForVoucher: links });
    if (problem) return { ok: false, error: problem };
    // The whole receipt, or not at all: a void reverses all of it, so a
    // part-refund that voided the receipt would reopen dues the family paid.
    if (amount !== Math.round(v.totalPaise)) {
      return {
        ok: false,
        error: `Cancelling a receipt refunds all of it (₹${(v.totalPaise / 100).toFixed(2)}). For part of it, use "Return extra paid".`,
      };
    }
    householdId = v.householdId;
    voucherId = v.id;
    receiptNo = v.receiptNo;
  } else {
    const pos = await householdRefundable(householdId);
    if (!pos) return { ok: false, error: "No such family" };
    if (amount > pos.excessRefundablePaise) {
      return {
        ok: false,
        error:
          pos.excessRefundablePaise > 0
            ? `Only ₹${(pos.excessRefundablePaise / 100).toFixed(2)} has been paid over the bill (after open refund links)`
            : "This family has not paid more than its bill — nothing to return",
      };
    }
  }

  const settings = await getPayoutSettings();
  const needsApproval =
    !input.requestedByOwner &&
    cashgramNeedsApproval(settings.refundApproval, settings.refundApprovalAbovePaise, amount);

  const cashgramId = newCashgramId();
  const { error } = await ctx.sb.from("cashgram_refunds").insert({
    cashgram_id: cashgramId,
    tenant_id: ctx.tenantId,
    fee_effect: input.feeEffect,
    household_id: householdId,
    voucher_id: voucherId,
    receipt_no: receiptNo,
    amount_paise: amount,
    payee_name: input.payeeName.trim(),
    payee_phone: cashgramPhone(input.payeePhone),
    payee_email: (input.payeeEmail || "").trim(),
    reason,
    link_expiry: cashgramExpiryDate(istToday(), input.expiryDays ?? 7),
    status: "PENDING_APPROVAL",
    requested_by: input.requestedBy,
  });
  if (error) return { ok: false, error: `Could not record the refund: ${error.message}` };

  if (needsApproval) {
    const row = await getCashgramRefund(cashgramId);
    return row
      ? { ok: true, refund: row, message: "Prepared. It goes to the parent once the owner approves it." }
      : { ok: false, error: "Prepared but could not be read back" };
  }
  await update(cashgramId, {
    approved_by: input.requestedByOwner ? input.requestedBy : "no approval needed",
    approved_at: new Date().toISOString(),
  });
  return sendCashgramRefund(cashgramId);
}

export async function approveCashgramRefund(cashgramId: string, by: string): Promise<CashgramResult> {
  const row = await getCashgramRefund(cashgramId);
  if (!row) return { ok: false, error: "No such refund" };
  if (row.status !== "PENDING_APPROVAL") return { ok: false, error: `This refund is ${row.status.toLowerCase()}, not waiting for approval` };
  await update(cashgramId, { approved_by: by, approved_at: new Date().toISOString() });
  return sendCashgramRefund(cashgramId);
}

export async function rejectCashgramRefund(cashgramId: string, by: string, note: string): Promise<CashgramResult> {
  const row = await getCashgramRefund(cashgramId);
  if (!row) return { ok: false, error: "No such refund" };
  if (row.status !== "PENDING_APPROVAL") return { ok: false, error: `This refund is ${row.status.toLowerCase()}, not waiting for approval` };
  await update(cashgramId, { status: "REJECTED", approved_by: by, decided_note: note.trim() });
  const fresh = await getCashgramRefund(cashgramId);
  return fresh ? { ok: true, refund: fresh, message: "Not approved. Nothing was sent." } : { ok: false, error: "Could not read back" };
}

/** Cancel: before approval it is just withdrawn; an ACTIVE link is deactivated at Cashfree. */
export async function cancelCashgramRefund(cashgramId: string, by: string): Promise<CashgramResult> {
  const row = await getCashgramRefund(cashgramId);
  if (!row) return { ok: false, error: "No such refund" };
  if (row.status === "PENDING_APPROVAL") {
    await update(cashgramId, { status: "REJECTED", decided_note: `Withdrawn by ${by}` });
  } else if (row.status === "ACTIVE") {
    const res = await v1("POST", "/v1/deactivateCashgram", { cashgramId });
    if (!res.ok) return { ok: false, error: `Cashfree did not cancel the link: ${res.error}` };
    const p = (res.payload ?? {}) as Record<string, unknown>;
    if (String(p.status ?? "").toUpperCase() !== "SUCCESS") {
      // Maybe it was redeemed a moment ago. Ask, do not assume.
      await refreshCashgramRefund(cashgramId);
      return { ok: false, error: String(p.message || "Cashfree did not cancel the link — status re-checked") };
    }
    await update(cashgramId, { status: "DEACTIVATED", decided_note: `Cancelled by ${by}` });
  } else {
    return { ok: false, error: `A ${row.status.toLowerCase()} refund cannot be cancelled` };
  }
  const fresh = await getCashgramRefund(cashgramId);
  return fresh ? { ok: true, refund: fresh, message: "Cancelled. No money left the wallet." } : { ok: false, error: "Could not read back" };
}

/* ── Cashfree V1 ─────────────────────────────────────────────────────── */

async function v1(
  method: "GET" | "POST",
  path: string,
  body?: unknown,
): Promise<{ ok: true; payload: unknown } | { ok: false; error: string; httpStatus: number }> {
  const token = await payoutV1Token();
  if (!token.ok) return { ok: false, error: token.error, httpStatus: 0 };
  try {
    const res = await fetch(`${payoutBaseUrl()}${path}`, {
      method,
      headers: { Authorization: `Bearer ${token.token}`, "Content-Type": "application/json" },
      ...(body === undefined ? {} : { body: JSON.stringify(body) }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const p = (payload ?? {}) as Record<string, unknown>;
      return { ok: false, error: String(p.message || `Payouts HTTP ${res.status}`), httpStatus: res.status };
    }
    return { ok: true, payload };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach Payouts", httpStatus: 0 };
  }
}

async function sendCashgramRefund(cashgramId: string): Promise<CashgramResult> {
  const row = await getCashgramRefund(cashgramId);
  if (!row) return { ok: false, error: "No such refund" };
  if (row.status !== "PENDING_APPROVAL") return { ok: true, refund: row, message: "Already sent." };

  // Every gate is re-checked at send time — approval may come days later.
  const gate = await payoutsEnabled();
  if (!gate.ok) return keepWaiting(row, gate.why);

  if (row.linkExpiry < istToday()) return keepWaiting(row, "The expiry date has passed — withdraw this and prepare it again");

  const balance = await payoutBalance();
  if (!balance.ok) return keepWaiting(row, `Could not read the Payouts wallet (${balance.error})`);
  const committed = await walletCommittedPaise(cashgramId);
  if (!committed.ok) return keepWaiting(row, committed.error);
  const free = balance.availablePaise - committed.paise;
  if (free < row.amountPaise) {
    return keepWaiting(
      row,
      `The Payouts wallet has ₹${(balance.availablePaise / 100).toFixed(2)}, of which ₹${(committed.paise / 100).toFixed(2)} is promised to open refund links. Top it up, then approve again.`,
    );
  }

  const built = buildCashgramBody({
    cashgramId,
    amountPaise: row.amountPaise,
    name: row.payeeName,
    phone: row.payeePhone,
    email: row.payeeEmail,
    expiryDate: row.linkExpiry,
    remarks: row.receiptNo ? `Refund ${row.receiptNo}` : "School fee refund",
  });
  if (!built.ok) return keepWaiting(row, built.error);

  // SENDING before the call, claimed atomically: a lost reply leaves evidence
  // the link may exist, and two approvals racing cannot both send.
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { data: claimed, error: claimError } = await ctx.sb
    .from("cashgram_refunds")
    .update({ status: "SENDING", last_error: "", updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("cashgram_id", cashgramId)
    .eq("status", "PENDING_APPROVAL")
    .select("cashgram_id");
  if (claimError) return { ok: false, error: `Could not mark the refund as sending: ${claimError.message}` };
  if (!claimed || claimed.length === 0) {
    const now = await getCashgramRefund(cashgramId);
    return now ? { ok: true, refund: now, message: "Already being sent." } : { ok: false, error: "No such refund" };
  }
  const res = await v1("POST", "/v1/createCashgram", built.body);
  if (!res.ok) {
    // A 4XX is a refusal; anything else may have been accepted.
    const refused = res.httpStatus >= 400 && res.httpStatus < 500;
    await update(cashgramId, { status: refused ? "CREATE_FAILED" : "UNKNOWN", last_error: res.error });
    await logEvent("cashgram.create_failed", row, { error: res.error, httpStatus: res.httpStatus });
    return {
      ok: false,
      error: refused ? res.error : `${res.error}. The link may still have been created — check status before preparing another.`,
    };
  }
  const created = readCashgramCreate(res.payload);
  if (!created.ok) {
    // V1 answers HTTP 200 with status ERROR for a refusal.
    await update(cashgramId, { status: "CREATE_FAILED", last_error: created.error });
    await logEvent("cashgram.create_failed", row, { error: created.error });
    return { ok: false, error: created.error };
  }
  await update(cashgramId, {
    status: "ACTIVE",
    cashgram_link: created.link,
    reference_id: created.referenceId,
  });
  await logEvent("cashgram.created", row, { referenceId: created.referenceId });
  const fresh = await getCashgramRefund(cashgramId);
  return fresh
    ? { ok: true, refund: fresh, message: `Link sent to ${fresh.payeePhone}. The money leaves the wallet only when the parent collects it.` }
    : { ok: false, error: "Sent but could not be read back" };
}

async function keepWaiting(row: CashgramRefundRow, why: string): Promise<CashgramResult> {
  await update(row.cashgramId, { last_error: why });
  return { ok: false, error: why };
}

async function logEvent(eventType: string, row: CashgramRefundRow, extra: Record<string, unknown>) {
  await recordPaymentGatewayEvent({
    provider: "cashfree",
    eventType,
    externalOrderId: row.voucherId || row.householdId,
    externalPaymentId: row.cashgramId,
    amountPaise: row.amountPaise,
    settlementStatus: eventType.endsWith("failed") ? "failed" : "received",
    eventJson: { cashgramId: row.cashgramId, feeEffect: row.feeEffect, ...extra },
  });
}

/* ── outcomes ────────────────────────────────────────────────────────── */

/** Ask Cashfree. For UNKNOWN rows, and for the desk that stops waiting for a webhook. */
export async function refreshCashgramRefund(cashgramId: string): Promise<CashgramRefundRow | null> {
  const row = await getCashgramRefund(cashgramId);
  if (!row) return null;
  if (!cashgramIsOpen(row.status) || row.status === "PENDING_APPROVAL") {
    // Paid but not fully booked (ledger post failed): finish it.
    if (row.status === "REDEEMED" && !row.appliedAt) await applyCashgramView({ ...viewOf(row), status: "REDEEMED" });
    return getCashgramRefund(cashgramId);
  }
  const res = await v1("GET", `/v1/getCashgramStatus?cashgramId=${encodeURIComponent(cashgramId)}`);
  if (!res.ok) {
    await update(cashgramId, { last_error: res.error });
    return getCashgramRefund(cashgramId);
  }
  const view = readCashgramStatusResponse(cashgramId, res.payload);
  if (!view) {
    const p = (res.payload ?? {}) as Record<string, unknown>;
    const msg = String(p.message || "");
    // A SENDING/UNKNOWN link Cashfree has never heard of was never created.
    if ((row.status === "UNKNOWN" || row.status === "SENDING") && /not\s*found|does not exist|invalid cashgram/i.test(msg)) {
      await update(cashgramId, { status: "CREATE_FAILED", last_error: msg });
    } else {
      await update(cashgramId, { last_error: msg || "Cashfree gave no status" });
    }
    return getCashgramRefund(cashgramId);
  }
  await applyCashgramView(view);
  return getCashgramRefund(cashgramId);
}

/**
 * A verified webhook. REDEEMED is confirmed with Cashfree before the books
 * change — it voids a receipt, so it rests on Cashfree's own status read, not
 * on one message. A REVERSED event is applied as sent: it only ever puts money
 * back in the wallet, and the status read does not report reversals on a row
 * we already hold as REDEEMED.
 */
export async function onCashgramWebhook(view: CashgramView): Promise<void> {
  if (view.status === "REVERSED") {
    await applyCashgramView(view);
    return;
  }
  const row = await getCashgramRefund(view.cashgramId);
  if (!row) return;
  await refreshCashgramRefund(view.cashgramId);
}

function viewOf(row: CashgramRefundRow): CashgramView {
  return { cashgramId: row.cashgramId, status: row.status, referenceId: row.referenceId, utr: row.utr, link: row.cashgramLink };
}

/**
 * Write what Cashfree says, and on REDEEMED correct the books — once.
 * Idempotent: webhooks redeliver, and a status check may race one.
 */
export async function applyCashgramView(view: CashgramView): Promise<{ applied: boolean; reason: string }> {
  const row = await getCashgramRefund(view.cashgramId);
  if (!row) return { applied: false, reason: "Not one of ours" };

  // UNKNOWN from Cashfree never overwrites what we know.
  if (view.status !== "UNKNOWN") {
    await update(row.cashgramId, {
      status: view.status,
      ...(view.referenceId ? { reference_id: view.referenceId } : {}),
      ...(view.utr ? { utr: view.utr } : {}),
      ...(view.link ? { cashgram_link: view.link } : {}),
    });
  }

  // Once: a redelivered REVERSED must not reverse the ledger entry again.
  if (view.status === "REVERSED" && row.appliedAt && row.status !== "REVERSED") return reverseApplied(row);
  if (view.status !== "REDEEMED") return { applied: false, reason: `Refund is ${view.status}` };
  if (row.appliedAt) return { applied: false, reason: "Already applied" };

  const narration = `Fee refund by Cashgram ${row.cashgramId}${row.receiptNo ? ` — receipt ${row.receiptNo}` : ""}: ${row.reason}`.slice(0, 240);

  let tenders: { mode: string; amountPaise: number; bankAccountId?: string }[] | undefined;
  if (row.feeEffect === "void") {
    const w = await loadFeeWorld();
    const v = w.fees.vouchers.find((x) => x.id === row.voucherId);
    if (!v) {
      await update(row.cashgramId, { last_error: "Paid to the parent, but the receipt to cancel was not found — cancel it by hand" });
      await logEvent("cashgram.no_voucher", row, {});
      return { applied: false, reason: "No receipt" };
    }
    tenders = v.tenders.map((t) => ({ mode: t.mode, amountPaise: t.amountPaise, bankAccountId: t.bankAccountId }));
    if (!v.voidedAt) {
      const { voidVoucher, loadFees } = await import("@/lib/fees");
      if (!voidVoucher(v.id)) {
        await update(row.cashgramId, { last_error: "Paid to the parent, but the receipt could not be voided — void it by hand" });
        await logEvent("cashgram.void_failed", row, {});
        return { applied: false, reason: "Void failed" };
      }
      // The void exists only in this process until it is pushed.
      const { pushFeesRemoteServer } = await import("@/lib/feesPersistence.server");
      const pushed = (await pushFeesRemoteServer(loadFees())).ok;
      if (!pushed) {
        await update(row.cashgramId, { last_error: "Receipt voided here but the save to the database failed — check the receipt" });
      }
    }
  }

  const lines = cashgramRefundLines({
    feeEffect: row.feeEffect,
    amountPaise: row.amountPaise,
    householdId: row.householdId,
    tenders,
    narration,
  });
  let ledgerVoucherId = "";
  let ledgerError = "";
  if (lines.ok) {
    const { ledgerPost } = await import("@/lib/ledger/ledger.server");
    const posted = await ledgerPost({
      voucherType: "payment",
      date: istToday(),
      narration,
      sourceType: "cashgram_refund",
      sourceId: row.cashgramId,
      createdBy: row.approvedBy || row.requestedBy || "cashfree",
      lines: lines.lines,
    });
    if (posted.ok) ledgerVoucherId = posted.voucherId;
    else ledgerError = posted.error;
  } else {
    ledgerError = lines.error;
  }

  // applied_at only once BOTH are done. Each step is safe to run again — the
  // void is skipped for a voided receipt, and the ledger post is keyed on the
  // cashgram id — so a failed post is retried by the next status check or
  // webhook redelivery rather than left half-booked for good.
  await update(row.cashgramId, {
    ...(ledgerError ? {} : { applied_at: new Date().toISOString() }),
    ledger_voucher_id: ledgerVoucherId,
    last_error: ledgerError ? `Paid to the parent; ledger entry not posted yet (${ledgerError}) — Check status retries it` : "",
  });
  await logEvent(ledgerError ? "cashgram.applied_no_ledger" : "cashgram.applied", row, { ledgerVoucherId, ledgerError });
  return { applied: true, reason: ledgerError ? "Applied; ledger failed" : "Applied" };
}

/**
 * Paid, booked, then the bank sent it back. The wallet entry is reversed so the
 * ledger says the money is in the wallet again. A voided receipt is NOT
 * un-voided by machine: the family is owed the money again, which is a decision
 * for the office (send a new link, or restore the receipt) — the row says so.
 */
async function reverseApplied(row: CashgramRefundRow): Promise<{ applied: boolean; reason: string }> {
  if (row.ledgerVoucherId) {
    const { ledgerReverse } = await import("@/lib/ledger/ledger.server");
    await ledgerReverse({ voucherId: row.ledgerVoucherId, reason: `Cashgram ${row.cashgramId} reversed by the bank`, date: istToday() });
  }
  await update(row.cashgramId, {
    last_error:
      row.feeEffect === "void"
        ? "The bank returned this refund. The receipt stays voided — send a new link, or restore the receipt."
        : "The bank returned this refund. The family is owed it again — send a new link.",
  });
  await logEvent("cashgram.reversed", row, {});
  return { applied: false, reason: "Reversed" };
}
