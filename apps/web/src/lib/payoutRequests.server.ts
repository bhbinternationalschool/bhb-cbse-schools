/**
 * Paying a store vendor bill or a payment voucher from the Cashfree Payouts
 * wallet, and booking wallet top-ups — the server half. Rules in
 * payoutRequests.ts; this is the order things happen in.
 *
 *   prepare   checked against what is owed NOW; held for the owner under the
 *             school's rule, or sent at once
 *   dispatch  PENDING_APPROVAL → SENT claimed atomically; switch on, wallet
 *             covers this AND every open link; then a transfer or a link
 *   apply     Cashfree says the money arrived (transfer SUCCESS / link
 *             REDEEMED): settle the bill or post the voucher from 1110, once
 *             (applied_at claimed before the books are touched)
 *
 * Nothing is booked before apply. A transfer or link that fails frees the
 * request; one that comes back after booking is flagged for a person.
 */

import "server-only";

import { cashgramExpiryDate, cashgramNeedsApproval, cashgramPhone, cashgramPhoneProblem, newCashgramId } from "@/lib/cashgram";
import {
  checkVoucherDraft,
  newPayoutRequestId,
  readRequestStatus,
  requestTransferId,
  topupLines,
  vendorChannel,
  voucherPaymentLines,
  type PayoutRequestChannel,
  type PayoutRequestKind,
  type PayoutRequestStatus,
  type VoucherDraft,
} from "@/lib/payoutRequests";
import { getServerTenantContext } from "@/lib/serverTenant";

export type PayoutRequestRow = {
  id: string;
  kind: PayoutRequestKind;
  channel: PayoutRequestChannel;
  amountPaise: number;
  payeeName: string;
  payeePhone: string;
  vendorId: string;
  billId: string;
  billNo: string;
  draft: VoucherDraft | null;
  reason: string;
  status: PayoutRequestStatus;
  transferId: string;
  cashgramId: string;
  utr: string;
  requestedBy: string;
  approvedBy: string;
  approvedAt: string | null;
  decidedNote: string;
  appliedAt: string | null;
  resultRef: string;
  lastError: string;
  createdAt: string;
};

function rowTo(r: Record<string, unknown>): PayoutRequestRow {
  const d = (r.draft ?? null) as VoucherDraft | null;
  return {
    id: String(r.id ?? ""),
    kind: r.kind === "voucher" ? "voucher" : "vendor_bill",
    channel: r.channel === "link" ? "link" : "transfer",
    amountPaise: Number(r.amount_paise ?? 0),
    payeeName: String(r.payee_name ?? ""),
    payeePhone: String(r.payee_phone ?? ""),
    vendorId: String(r.vendor_id ?? ""),
    billId: String(r.bill_id ?? ""),
    billNo: String(r.bill_no ?? ""),
    draft: d && Array.isArray(d.lines) ? d : null,
    reason: String(r.reason ?? ""),
    status: readRequestStatus(r.status),
    transferId: String(r.transfer_id ?? ""),
    cashgramId: String(r.cashgram_id ?? ""),
    utr: String(r.utr ?? ""),
    requestedBy: String(r.requested_by ?? ""),
    approvedBy: String(r.approved_by ?? ""),
    approvedAt: r.approved_at ? String(r.approved_at) : null,
    decidedNote: String(r.decided_note ?? ""),
    appliedAt: r.applied_at ? String(r.applied_at) : null,
    resultRef: String(r.result_ref ?? ""),
    lastError: String(r.last_error ?? ""),
    createdAt: String(r.created_at ?? ""),
  };
}

function istToday(): string {
  return new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10);
}

async function update(id: string, patch: Record<string, unknown>) {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  await ctx.sb.from("payout_requests").update({ ...patch, updated_at: new Date().toISOString() }).eq("tenant_id", ctx.tenantId).eq("id", id);
}

export async function getPayoutRequest(id: string): Promise<PayoutRequestRow | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb.from("payout_requests").select("*").eq("tenant_id", ctx.tenantId).eq("id", id).maybeSingle();
  return data ? rowTo(data as Record<string, unknown>) : null;
}

export async function listPayoutRequests(filter: { status?: PayoutRequestStatus; billIds?: string[]; kind?: PayoutRequestKind; limit?: number }): Promise<PayoutRequestRow[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  let q = ctx.sb.from("payout_requests").select("*").eq("tenant_id", ctx.tenantId);
  if (filter.status) q = q.eq("status", filter.status);
  if (filter.kind) q = q.eq("kind", filter.kind);
  if (filter.billIds) {
    if (filter.billIds.length === 0) return [];
    q = q.in("bill_id", filter.billIds.slice(0, 300));
  }
  const { data } = await q.order("created_at", { ascending: false }).limit(filter.limit ?? 200);
  return (data ?? []).map((r) => rowTo(r as Record<string, unknown>));
}

export type RequestResult = { ok: true; request: PayoutRequestRow; message: string } | { ok: false; error: string };

/* ── prepare ─────────────────────────────────────────────────────────── */

async function insertAndMaybeSend(row: Record<string, unknown>, byOwner: boolean, requestedBy: string, amount: number): Promise<RequestResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { getPayoutSettings } = await import("@/lib/payouts.server");
  const settings = await getPayoutSettings();
  const needsApproval = !byOwner && cashgramNeedsApproval(settings.paymentApproval, settings.paymentApprovalAbovePaise, amount);
  const id = newPayoutRequestId();
  const { error } = await ctx.sb.from("payout_requests").insert({
    ...row,
    id,
    tenant_id: ctx.tenantId,
    status: "PENDING_APPROVAL",
    requested_by: requestedBy,
    ...(needsApproval ? {} : { approved_by: byOwner ? requestedBy : "no approval needed", approved_at: new Date().toISOString() }),
  });
  if (error) {
    return {
      ok: false,
      error: /duplicate key|unique/i.test(error.message)
        ? "A payment for this bill is already waiting or on its way"
        : `Could not record the payment: ${error.message}`,
    };
  }
  if (needsApproval) {
    const r = await getPayoutRequest(id);
    return r ? { ok: true, request: r, message: "Prepared. It goes out once the owner approves it." } : { ok: false, error: "Could not read back" };
  }
  return dispatchPayoutRequest(id);
}

/**
 * Pay a store vendor bill from the wallet. The amount is checked against the
 * bill's balance on the server; the bank details and phone come from the
 * vendor record, never the screen.
 */
export async function prepareVendorPayment(input: {
  billId: string;
  amountPaise: number;
  channel?: PayoutRequestChannel | "";
  reason?: string;
  requestedBy: string;
  requestedByOwner: boolean;
}): Promise<RequestResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { payoutKeysPresent } = await import("@/lib/payouts.server");
  if (!payoutKeysPresent()) return { ok: false, error: "Cashfree Payouts is not configured on this server" };
  const amount = Math.round(Number(input.amountPaise) || 0);
  if (amount < 100) return { ok: false, error: "A payment must be at least ₹1" };

  const { data: bill, error: billErr } = await ctx.sb
    .from("inv_vendor_bills")
    .select("id, bill_no, vendor_id, total_paise, paid_paise, status")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", input.billId)
    .maybeSingle();
  if (billErr || !bill) return { ok: false, error: "Bill not found" };
  const b = bill as Record<string, unknown>;
  if (b.status === "cancelled") return { ok: false, error: "This bill is cancelled" };
  const balance = Number(b.total_paise ?? 0) - Number(b.paid_paise ?? 0);
  if (amount > balance) return { ok: false, error: `Only ₹${(balance / 100).toFixed(2)} is outstanding on this bill` };

  const { data: vendor } = await ctx.sb
    .from("inv_vendors")
    .select("id, name, phone, bank_account_name, bank_account_no, bank_ifsc")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", String(b.vendor_id ?? ""))
    .maybeSingle();
  if (!vendor) return { ok: false, error: "Vendor not found" };
  const v = vendor as Record<string, unknown>;
  const ch = vendorChannel(
    { bankAccountNo: String(v.bank_account_no ?? ""), bankIfsc: String(v.bank_ifsc ?? ""), phone: String(v.phone ?? "") },
    input.channel || "",
    cashgramPhoneProblem,
  );
  if (!ch.ok) return ch;

  return insertAndMaybeSend(
    {
      kind: "vendor_bill",
      channel: ch.channel,
      amount_paise: amount,
      payee_name: String(v.bank_account_name || v.name || ""),
      payee_phone: cashgramPhone(String(v.phone ?? "")),
      vendor_id: String(v.id),
      bill_id: String(b.id),
      bill_no: String(b.bill_no ?? ""),
      reason: (input.reason || `Bill ${String(b.bill_no ?? "")}`).trim(),
    },
    input.requestedByOwner,
    input.requestedBy,
    amount,
  );
}

/**
 * Pay a voucher by link: what it was for (debit heads) is fixed now; the
 * voucher itself is posted only when the payee collects.
 */
export async function prepareVoucherPayment(input: {
  draft: VoucherDraft;
  payeeName: string;
  payeePhone: string;
  requestedBy: string;
  requestedByOwner: boolean;
}): Promise<RequestResult> {
  const { payoutKeysPresent } = await import("@/lib/payouts.server");
  if (!payoutKeysPresent()) return { ok: false, error: "Cashfree Payouts is not configured on this server" };
  const phoneProblem = cashgramPhoneProblem(input.payeePhone);
  if (phoneProblem) return { ok: false, error: phoneProblem };
  if (input.payeeName.trim().length < 2) return { ok: false, error: "Give the payee's name" };

  const { ledgerListAccounts } = await import("@/lib/ledger/ledger.server");
  const accounts = await ledgerListAccounts();
  const map = new Map(
    accounts.map((a) => [
      a.code,
      {
        postable: !a.hasChildren,
        isMoney: a.isCash || a.isBank || !!a.bankAccountId || a.code === "1100" || a.code === "1050",
        name: a.name,
      },
    ]),
  );
  const draft: VoucherDraft = { narration: String(input.draft.narration || "").trim(), partyName: input.payeeName.trim(), lines: input.draft.lines };
  const checked = checkVoucherDraft(draft, map);
  if (!checked.ok) return checked;

  return insertAndMaybeSend(
    {
      kind: "voucher",
      channel: "link",
      amount_paise: checked.totalPaise,
      payee_name: input.payeeName.trim(),
      payee_phone: cashgramPhone(input.payeePhone),
      draft: { ...draft, lines: checked.lines },
      reason: draft.narration,
    },
    input.requestedByOwner,
    input.requestedBy,
    checked.totalPaise,
  );
}

/* ── approve / reject / cancel ───────────────────────────────────────── */

export async function approvePayoutRequest(id: string, by: string): Promise<RequestResult> {
  const r = await getPayoutRequest(id);
  if (!r) return { ok: false, error: "No such payment" };
  if (r.status !== "PENDING_APPROVAL") return { ok: false, error: `This payment is ${r.status.toLowerCase()}, not waiting` };
  if (!r.approvedAt) await update(id, { approved_by: by, approved_at: new Date().toISOString() });
  return dispatchPayoutRequest(id);
}

export async function rejectPayoutRequest(id: string, by: string, note: string): Promise<RequestResult> {
  const r = await getPayoutRequest(id);
  if (!r) return { ok: false, error: "No such payment" };
  if (r.status !== "PENDING_APPROVAL") return { ok: false, error: `This payment is ${r.status.toLowerCase()}, not waiting` };
  await update(id, { status: "REJECTED", decided_note: `${by}: ${note}`.trim() });
  const fresh = await getPayoutRequest(id);
  return fresh ? { ok: true, request: fresh, message: "Not approved. Nothing was sent." } : { ok: false, error: "Could not read back" };
}

/** Withdraw one not yet sent, or cancel an uncollected link. A bank transfer cannot be called back. */
export async function cancelPayoutRequest(id: string, by: string): Promise<RequestResult> {
  const r = await getPayoutRequest(id);
  if (!r) return { ok: false, error: "No such payment" };
  if (r.status === "PENDING_APPROVAL") {
    await update(id, { status: "CANCELLED", decided_note: `Withdrawn by ${by}` });
  } else if (r.status === "SENT" && r.channel === "link" && r.cashgramId) {
    const { cancelCashgramRefund } = await import("@/lib/cashgramRefunds.server");
    const c = await cancelCashgramRefund(r.cashgramId, by);
    if (!c.ok) return c;
    await update(id, { status: "CANCELLED", decided_note: `Link cancelled by ${by}` });
  } else {
    return { ok: false, error: r.channel === "transfer" && r.status === "SENT" ? "A bank transfer already sent cannot be called back" : `A ${r.status.toLowerCase()} payment cannot be cancelled` };
  }
  const fresh = await getPayoutRequest(id);
  return fresh ? { ok: true, request: fresh, message: "Cancelled. No money left the wallet." } : { ok: false, error: "Could not read back" };
}

/* ── dispatch ────────────────────────────────────────────────────────── */

async function dispatchPayoutRequest(id: string): Promise<RequestResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const r0 = await getPayoutRequest(id);
  if (!r0) return { ok: false, error: "No such payment" };

  const ps = await import("@/lib/payouts.server");
  const gate = await ps.payoutsEnabled();
  if (!gate.ok) return hold(id, gate.why);
  const balance = await ps.payoutBalance();
  if (!balance.ok) return hold(id, `Could not read the Payouts wallet (${balance.error})`);
  const cg = await import("@/lib/cashgramRefunds.server");
  const committed = await cg.walletCommittedPaise();
  if (!committed.ok) return hold(id, committed.error);
  if (balance.availablePaise - committed.paise < r0.amountPaise) {
    return hold(
      id,
      `The wallet has ₹${(balance.availablePaise / 100).toFixed(2)}, of which ₹${(committed.paise / 100).toFixed(2)} is promised to open links. Top it up, then send again.`,
    );
  }

  // Claimed: two approvals racing cannot both send.
  const { data: claimed, error: claimErr } = await ctx.sb
    .from("payout_requests")
    .update({ status: "SENT", last_error: "", updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .eq("status", "PENDING_APPROVAL")
    .select("id");
  if (claimErr) return { ok: false, error: claimErr.message };
  if (!claimed || claimed.length === 0) {
    const now = await getPayoutRequest(id);
    return now ? { ok: true, request: now, message: "Already sent." } : { ok: false, error: "No such payment" };
  }
  const r = (await getPayoutRequest(id)) ?? r0;
  const label = r.kind === "vendor_bill" ? `Bill ${r.billNo}` : r.reason.slice(0, 60);

  if (r.channel === "transfer") {
    const { data: vendor } = await ctx.sb
      .from("inv_vendors")
      .select("id, name, phone, bank_account_name, bank_account_no, bank_ifsc")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", r.vendorId)
      .maybeSingle();
    const v = (vendor ?? {}) as Record<string, unknown>;
    const accountNumber = String(v.bank_account_no ?? "").replace(/\s/g, "");
    const ifsc = String(v.bank_ifsc ?? "").trim().toUpperCase();
    const { payoutBeneficiaryId, payoutModeForInstrument } = await import("@/lib/payouts");
    const ben = await ps.ensureBeneficiary({
      beneficiaryId: payoutBeneficiaryId({ subject: `v${r.vendorId}`, accountNumber }),
      name: r.payeeName,
      accountNumber,
      ifsc,
      phone: r.payeePhone || undefined,
    });
    if (!ben.ok) return failSend(id, ben.error);
    const transferId = requestTransferId(id);
    await update(id, { transfer_id: transferId });
    const out = await ps.requestPayoutTransfer({
      transferId,
      beneficiaryId: ben.beneficiaryId,
      amountPaise: r.amountPaise,
      kind: "vnd",
      subjectId: r.vendorId,
      period: r.billId,
      remarks: label,
      requestedBy: r.approvedBy || r.requestedBy,
      mode: payoutModeForInstrument(r.amountPaise, { accountNumber }),
      target: { kind: "payout_request", id, label },
      payeeName: r.payeeName,
    });
    if (!out.ok) {
      // A 5XX may have gone out: stay SENT and let the status check settle it.
      if (out.needsStatusCheck) {
        await update(id, { last_error: `${out.error} — check status before anything else` });
        const now = await getPayoutRequest(id);
        return now ? { ok: true, request: now, message: "Sent, but Cashfree's answer was lost — check its status." } : { ok: false, error: out.error };
      }
      return failSend(id, out.error);
    }
    const now = await getPayoutRequest(id);
    return now
      ? { ok: true, request: now, message: now.status === "PAID" ? "Paid and booked from the Cashfree wallet." : "Bank transfer sent. It is booked when Cashfree confirms." }
      : { ok: false, error: "Sent but could not be read back" };
  }

  // Link: a Cashgram in the shared table, so the wallet check counts it.
  const cashgramId = newCashgramId();
  const { error: cgErr } = await ctx.sb.from("cashgram_refunds").insert({
    cashgram_id: cashgramId,
    tenant_id: ctx.tenantId,
    purpose: "payout_request",
    fee_effect: "none",
    target_kind: "payout_request",
    target_id: id,
    target_label: label,
    amount_paise: r.amountPaise,
    payee_name: r.payeeName,
    payee_phone: r.payeePhone,
    reason: r.reason,
    link_expiry: cashgramExpiryDate(istToday(), 7),
    status: "PENDING_APPROVAL",
    requested_by: r.requestedBy,
    approved_by: r.approvedBy || r.requestedBy,
    approved_at: new Date().toISOString(),
  });
  if (cgErr) return failSend(id, `Could not record the link: ${cgErr.message}`);
  await update(id, { cashgram_id: cashgramId });
  const sent = await cg.sendCashgramRefund(cashgramId);
  if (!sent.ok) {
    const link = await cg.getCashgramRefund(cashgramId);
    // UNKNOWN may exist at Cashfree: the request stays SENT until checked.
    if (link?.status === "UNKNOWN" || link?.status === "SENDING") {
      await update(id, { last_error: sent.error });
      const now = await getPayoutRequest(id);
      return now ? { ok: true, request: now, message: sent.error } : { ok: false, error: sent.error };
    }
    if (link?.status === "PENDING_APPROVAL") await cg.cancelCashgramRefund(cashgramId, "system");
    return failSend(id, sent.error);
  }
  const now = await getPayoutRequest(id);
  return now
    ? { ok: true, request: now, message: `Pay link sent to ${r.payeePhone}. It is booked when they collect it.` }
    : { ok: false, error: "Sent but could not be read back" };
}

async function hold(id: string, why: string): Promise<RequestResult> {
  await update(id, { last_error: why });
  return { ok: false, error: why };
}

async function failSend(id: string, why: string): Promise<RequestResult> {
  await update(id, { status: "FAILED", last_error: why });
  return { ok: false, error: why };
}

/* ── apply ───────────────────────────────────────────────────────────── */

/**
 * The money arrived. Book it — once. `ref` goes on the voucher (UTR when
 * Cashfree gave one); `utr` is stored only when it is a real 12-digit one.
 */
export async function applyPayoutRequest(id: string, ref: string, utr: string): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { data: claimed, error: claimErr } = await ctx.sb
    .from("payout_requests")
    .update({ applied_at: new Date().toISOString(), updated_at: new Date().toISOString() })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .is("applied_at", null)
    .select("*");
  if (claimErr) return { ok: false, error: claimErr.message };
  if (!claimed || claimed.length === 0) return { ok: true }; // already booked
  const r = rowTo(claimed[0] as Record<string, unknown>);
  const release = async (why: string) => {
    await update(id, { applied_at: null, last_error: why });
    return { ok: false as const, error: why };
  };

  if (r.kind === "vendor_bill") {
    try {
      const { recordVendorPaymentFromWallet } = await import("@/lib/inventory/procurement.server");
      const paid = await recordVendorPaymentFromWallet(
        { billId: r.billId, amountPaise: r.amountPaise, paidOn: istToday(), reference: ref.slice(0, 80), note: `Paid from the Cashfree wallet (${r.id})` },
        r.approvedBy || r.requestedBy || "cashfree",
      );
      await update(id, { status: "PAID", ...(utr ? { utr } : {}), result_ref: paid.paymentNo, last_error: "" });
      return { ok: true };
    } catch (e) {
      const msg = e instanceof Error ? e.message : "The bill could not be settled";
      // The bill was paid another way while this was in flight.
      if (/outstanding|cancelled/i.test(msg)) {
        await update(id, {
          status: "PAID",
          ...(utr ? { utr } : {}),
          last_error: `PAID TWICE: Cashfree paid ₹${(r.amountPaise / 100).toFixed(2)} but the bill no longer had it outstanding (${msg}). Recover it from the vendor, or book it as an advance.`,
        });
        return { ok: true };
      }
      return release(`Paid by Cashfree; bill not settled yet (${msg}) — Check status retries it`);
    }
  }

  if (!r.draft) return release("The voucher's details are missing");
  const { ledgerPost } = await import("@/lib/ledger/ledger.server");
  const date = istToday();
  const posted = await ledgerPost({
    voucherType: "payment",
    date,
    narration: `${r.draft.narration} — paid to ${r.payeeName} from the Cashfree wallet`.slice(0, 240),
    sourceType: "payout_request",
    sourceId: id,
    createdBy: r.approvedBy || r.requestedBy || "cashfree",
    lines: voucherPaymentLines({ draft: r.draft, totalPaise: r.amountPaise, ref, date, payeePhone: r.payeePhone }),
  });
  if (!posted.ok) return release(`Paid by Cashfree; voucher not posted yet (${posted.error}) — Check status retries it`);
  await update(id, { status: "PAID", ...(utr ? { utr } : {}), result_ref: posted.voucherNo, last_error: "" });
  return { ok: true };
}

/** The transfer or link failed before any money arrived: the request is free again. */
export async function requestChildDied(id: string, why: string): Promise<void> {
  const r = await getPayoutRequest(id);
  if (!r || r.appliedAt || r.status !== "SENT") return;
  await update(id, { status: "FAILED", last_error: why });
}

/** Booked, then the bank sent the money back. Not unwound by machine. */
export async function flagRequestReversed(id: string): Promise<void> {
  const r = await getPayoutRequest(id);
  if (!r) return;
  await update(id, {
    last_error:
      r.kind === "vendor_bill"
        ? `The bank returned this payment after it was booked (${r.resultRef}). The vendor is unpaid again — reverse that payment in the books and pay again.`
        : `The bank returned this payment after voucher ${r.resultRef} was posted. Reverse that voucher and pay again.`,
  });
}

/** Ask Cashfree what became of it, for a desk that stops waiting for a webhook. */
export async function refreshPayoutRequest(id: string): Promise<PayoutRequestRow | null> {
  const r = await getPayoutRequest(id);
  if (!r) return null;
  if (r.channel === "transfer" && r.transferId) {
    const { fetchTransferStatus } = await import("@/lib/payouts.server");
    await fetchTransferStatus(r.transferId);
  } else if (r.channel === "link" && r.cashgramId) {
    const { refreshCashgramRefund } = await import("@/lib/cashgramRefunds.server");
    await refreshCashgramRefund(r.cashgramId);
  }
  return getPayoutRequest(id);
}

/* ── wallet top-ups ──────────────────────────────────────────────────── */

export type TopupRow = {
  id: string;
  amountPaise: number;
  topupDate: string;
  bankLedgerCode: string;
  reference: string;
  note: string;
  createdBy: string;
  ledgerVoucherNo: string;
  createdAt: string;
};

export async function listTopups(limit = 30): Promise<TopupRow[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data } = await ctx.sb
    .from("payout_wallet_topups")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .order("topup_date", { ascending: false })
    .limit(limit);
  return (data ?? []).map((raw) => {
    const r = raw as Record<string, unknown>;
    return {
      id: String(r.id),
      amountPaise: Number(r.amount_paise ?? 0),
      topupDate: String(r.topup_date ?? ""),
      bankLedgerCode: String(r.bank_ledger_code ?? ""),
      reference: String(r.reference ?? ""),
      note: String(r.note ?? ""),
      createdBy: String(r.created_by ?? ""),
      ledgerVoucherNo: String(r.ledger_voucher_no ?? ""),
      createdAt: String(r.created_at ?? ""),
    };
  });
}

/** The school banks a top-up can come from: per-bank ledger accounts (1011, 1012 …). */
export async function topupBanks(): Promise<{ code: string; name: string; bankAccountId: string }[]> {
  const { ledgerListAccounts } = await import("@/lib/ledger/ledger.server");
  return (await ledgerListAccounts())
    .filter((a) => a.bankAccountId)
    .map((a) => ({ code: a.code, name: a.name, bankAccountId: a.bankAccountId }));
}

/** What the books say is in the wallet: the 1110 balance. */
export async function walletBookBalancePaise(): Promise<number | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data: acct } = await ctx.sb.from("ledger_accounts").select("id").eq("tenant_id", ctx.tenantId).eq("code", "1110").maybeSingle();
  if (!acct) return null;
  let total = 0;
  for (let from = 0; ; from += 1000) {
    const { data, error } = await ctx.sb
      .from("ledger_lines")
      .select("debit_paise, credit_paise")
      .eq("tenant_id", ctx.tenantId)
      .eq("account_id", (acct as { id: string }).id)
      .range(from, from + 999);
    if (error) return null;
    for (const l of data ?? []) total += Number((l as Record<string, unknown>).debit_paise ?? 0) - Number((l as Record<string, unknown>).credit_paise ?? 0);
    if (!data || data.length < 1000) break;
  }
  return total;
}

/**
 * Money moved from a school bank (Union Bank) into the wallet:
 * Dr 1110 Cashfree Payouts Wallet / Cr that bank. The bank statement shows it
 * as a debit; the wallet shows a credit.
 */
export async function recordTopup(input: {
  amountPaise: number;
  date: string;
  bankLedgerCode: string;
  reference: string;
  note?: string;
  by: string;
}): Promise<{ ok: true; topup: TopupRow } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.date) || input.date > istToday()) return { ok: false, error: "Enter the date the money left the bank (not in the future)" };
  const reference = input.reference.trim();
  if (reference.length < 4) return { ok: false, error: "Enter the bank's UTR / reference — it stops the same transfer being entered twice" };
  const bank = (await topupBanks()).find((b) => b.code === input.bankLedgerCode);
  if (!bank) return { ok: false, error: "Choose the school bank the money left" };

  const { data: dup } = await ctx.sb
    .from("payout_wallet_topups")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("reference", reference)
    .maybeSingle();
  if (dup) return { ok: false, error: "This reference is already recorded as a top-up" };

  const lines = topupLines({ amountPaise: input.amountPaise, bankLedgerCode: bank.code, bankAccountId: bank.bankAccountId, reference, date: input.date });
  if (!lines.ok) return lines;
  const id = `wtu_${newPayoutRequestId()}`;
  const { ledgerPost } = await import("@/lib/ledger/ledger.server");
  const posted = await ledgerPost({
    voucherType: "contra",
    date: input.date,
    narration: `Cashfree Payouts wallet top-up from ${bank.name}${input.note ? ` — ${input.note}` : ""}`.slice(0, 240),
    sourceType: "payout_topup",
    sourceId: id,
    createdBy: input.by,
    lines: lines.lines,
  });
  if (!posted.ok) return { ok: false, error: `The books refused the top-up: ${posted.error}` };
  const { error } = await ctx.sb.from("payout_wallet_topups").insert({
    id,
    tenant_id: ctx.tenantId,
    amount_paise: Math.round(input.amountPaise),
    topup_date: input.date,
    bank_ledger_code: bank.code,
    bank_account_id: bank.bankAccountId,
    reference,
    note: (input.note || "").trim(),
    created_by: input.by,
    ledger_voucher_id: posted.voucherId,
    ledger_voucher_no: posted.voucherNo,
  });
  if (error) {
    // Posted but not listed: say so rather than pretend. The voucher stands.
    return { ok: false, error: `Top-up posted as ${posted.voucherNo}, but the list could not record it: ${error.message}` };
  }
  const row = (await listTopups(5)).find((t) => t.id === id);
  return row ? { ok: true, topup: row } : { ok: false, error: "Recorded but could not be read back" };
}
