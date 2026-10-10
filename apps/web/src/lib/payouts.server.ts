/**
 * Paying staff and vendors through Cashfree Payouts.
 *
 * Server-only: this carries the Payouts credentials and the 2FA public key.
 *
 * THREE THINGS TO KNOW BEFORE READING ANY OF IT.
 *
 * SEPARATE PRODUCT, SEPARATE EVERYTHING. Payouts is not the payment gateway. Own
 * host (/payout), own client id and secret, and mandatory 2FA. Reusing the PG
 * keys fails in a way that reads like a credentials problem and is not, so the
 * env vars are named apart and their absence is reported as "not configured".
 *
 * A PREFUNDED WALLET, NOT THE SCHOOL'S BANK. Transfers draw down a balance the
 * school has topped up by NEFT from a whitelisted account. So a transfer can
 * fail for want of balance, which is not a bad beneficiary and must not read as
 * one. `payoutBalance` exists so a run can be checked before it starts rather
 * than discovered half-paid.
 *
 * THE V2 FIELD NAMES ARE NOT YET CONFIRMED AGAINST A LIVE CALL. The build
 * container has no Payouts credentials, and the reachable documentation gives
 * the hosts, the auth and the endpoint names but not a full request sample. The
 * bodies in payouts.ts are the documented V2 shape as best it can be determined,
 * and they are unit-tested for OUR invariants (rupees not paise, IMPS cap, id
 * determinism) — which is not the same as knowing Cashfree accepts them. So
 * nothing here is wired into the salary run, the NEFT bank file stays the
 * default, and `sandboxProbe` exists to confirm the shapes against sandbox
 * before a single real rupee moves. Do not remove that gate on the strength of
 * the tests passing.
 */

import "server-only";

import {
  type PayoutMode,
  buildBeneficiaryBody,
  buildTransferBody,
  payoutNeedsAttention,
  readPayoutTransfer,
  shouldRetryTransfer,
  type PayoutStatus,
  type PayoutTransferView,
} from "@/lib/payouts";
import { payoutSignatureFrom } from "@/lib/payoutsSignature";
import { readApprovalRule, type CashgramApprovalRule } from "@/lib/cashgram";
import { getServerTenantContext } from "@/lib/serverTenant";

export const PAYOUT_API_VERSION = "2024-01-01";

export function payoutKeysPresent(): boolean {
  return !!(
    process.env.CASHFREE_PAYOUT_CLIENT_ID?.trim() &&
    process.env.CASHFREE_PAYOUT_CLIENT_SECRET?.trim() &&
    process.env.CASHFREE_PAYOUT_PUBLIC_KEY?.trim()
  );
}

/**
 * Whether real transfers are allowed at all — the env override only.
 *
 * Kept for the old deployment flag. The live switch is the owner's
 * (payout_settings, `payoutsEnabled` below), which can only be turned on
 * after a ₹1 test transfer has come back SUCCESS. CASHFREE_PAYOUTS_DISABLED
 * =true is a hard stop over both.
 */
export function payoutsArmed(): boolean {
  return process.env.CASHFREE_PAYOUTS_ARMED?.trim() === "true" && payoutKeysPresent();
}

function payoutsHardDisabled(): boolean {
  return process.env.CASHFREE_PAYOUTS_DISABLED?.trim() === "true";
}

export type PayoutSettings = {
  enabled: boolean;
  testTransferId: string;
  testPassedAt: string;
  /** Who must approve a fee-refund link before it goes out (cashgram.ts). */
  refundApproval: CashgramApprovalRule;
  /** With refundApproval "above": links above this wait for the owner. */
  refundApprovalAbovePaise: number;
  updatedBy: string;
  updatedAt: string;
};

export async function getPayoutSettings(): Promise<PayoutSettings> {
  const off: PayoutSettings = {
    enabled: false,
    testTransferId: "",
    testPassedAt: "",
    refundApproval: "owner",
    refundApprovalAbovePaise: 0,
    updatedBy: "",
    updatedAt: "",
  };
  const ctx = await getServerTenantContext();
  if (!ctx) return off;
  const { data, error } = await ctx.sb.from("payout_settings").select("*").eq("tenant_id", ctx.tenantId).maybeSingle();
  // Unreadable reads as OFF: no money moves on a setting nobody could read.
  if (error || !data) return off;
  const r = data as Record<string, unknown>;
  return {
    enabled: r.enabled === true,
    testTransferId: String(r.test_transfer_id ?? ""),
    testPassedAt: r.test_passed_at ? String(r.test_passed_at) : "",
    refundApproval: readApprovalRule(r.refund_approval),
    refundApprovalAbovePaise: Math.max(0, Number(r.refund_approval_above_paise ?? 0) || 0),
    updatedBy: String(r.updated_by ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

async function savePayoutSettings(
  patch: Partial<{
    enabled: boolean;
    test_transfer_id: string;
    test_passed_at: string | null;
    refund_approval: CashgramApprovalRule;
    refund_approval_above_paise: number;
  }>,
  by: string,
) {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false as const, error: "No tenant context" };
  const { error } = await ctx.sb
    .from("payout_settings")
    .upsert({ tenant_id: ctx.tenantId, ...patch, updated_by: by, updated_at: new Date().toISOString() }, { onConflict: "tenant_id" });
  return error ? { ok: false as const, error: error.message } : { ok: true as const };
}

/**
 * Real transfers allowed right now: keys present, not hard-disabled, and
 * either the owner's switch is on (after a passed test) or the old env flag.
 * Checked before EVERY transfer, not once per screen.
 */
export async function payoutsEnabled(): Promise<{ ok: boolean; why: string }> {
  if (!payoutKeysPresent()) return { ok: false, why: "Cashfree Payouts is not configured on this server" };
  if (payoutsHardDisabled()) return { ok: false, why: "Payouts are switched off on the server (CASHFREE_PAYOUTS_DISABLED)" };
  if (payoutsArmed()) return { ok: true, why: "" };
  const st = await getPayoutSettings();
  if (!st.testPassedAt) return { ok: false, why: "Send the ₹1 test transfer first (Settings → Payouts)" };
  if (!st.enabled) return { ok: false, why: "Payouts are switched off (Settings → Payouts)" };
  return { ok: true, why: "" };
}

/** The school's rule for who approves a fee-refund link. Owner only (route). */
export async function setRefundApproval(
  rule: CashgramApprovalRule,
  abovePaise: number,
  by: string,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const above = Math.max(0, Math.round(Number(abovePaise) || 0));
  if (rule === "above" && above < 100) return { ok: false, error: "Give the amount above which the owner approves" };
  return savePayoutSettings({ refund_approval: rule, refund_approval_above_paise: rule === "above" ? above : 0 }, by);
}

/** The owner's switch. Turning ON needs a passed ₹1 test. */
export async function setPayoutsEnabled(enabled: boolean, by: string): Promise<{ ok: true } | { ok: false; error: string }> {
  if (enabled) {
    if (!payoutKeysPresent()) return { ok: false, error: "Cashfree Payouts is not configured on this server" };
    const st = await getPayoutSettings();
    if (!st.testPassedAt) return { ok: false, error: "Send the ₹1 test transfer to your own UPI ID first — the switch turns on only after it succeeds." };
  }
  return savePayoutSettings({ enabled }, by);
}

export function payoutBaseUrl(): string {
  const prod = (process.env.CASHFREE_PAYOUT_ENV || "").trim().toLowerCase() === "production";
  return prod ? "https://api.cashfree.com/payout" : "https://sandbox.cashfree.com/payout";
}

function payoutHeaders(): { ok: true; headers: Record<string, string> } | { ok: false; error: string } {
  const clientId = process.env.CASHFREE_PAYOUT_CLIENT_ID?.trim() ?? "";
  // Per request: the signature is valid for 5–10 minutes, so a cached one works
  // in testing and starts failing in production minutes later.
  const signed = payoutSignatureFrom({
    clientId,
    publicKeyPem: process.env.CASHFREE_PAYOUT_PUBLIC_KEY ?? "",
    unixSeconds: Math.floor(Date.now() / 1000),
  });
  if (!signed.ok) return { ok: false, error: signed.error };
  return {
    ok: true,
    headers: {
      "Content-Type": "application/json",
      "x-api-version": PAYOUT_API_VERSION,
      "x-client-id": clientId,
      "x-client-secret": process.env.CASHFREE_PAYOUT_CLIENT_SECRET?.trim() ?? "",
      // Cloud Run has no static IP, so the public-key route is the only 2FA
      // available to this service.
      "X-Cf-Signature": signed.signature,
    },
  };
}

export type PayoutRow = {
  transferId: string;
  cfTransferId: string;
  kind: string;
  subjectId: string;
  period: string;
  beneficiaryId: string;
  amountPaise: number;
  status: PayoutStatus;
  utr: string;
  statusDescription: string;
  requestedBy: string;
  lastError: string;
  createdAt: string;
  updatedAt: string;
};

function rowToPayout(r: Record<string, unknown>): PayoutRow {
  return {
    transferId: String(r.transfer_id ?? ""),
    cfTransferId: String(r.cf_transfer_id ?? ""),
    kind: String(r.kind ?? ""),
    subjectId: String(r.subject_id ?? ""),
    period: String(r.period ?? ""),
    beneficiaryId: String(r.beneficiary_id ?? ""),
    amountPaise: Number(r.amount_paise ?? 0),
    status: String(r.status ?? "UNKNOWN") as PayoutStatus,
    utr: String(r.utr ?? ""),
    statusDescription: String(r.status_description ?? ""),
    requestedBy: String(r.requested_by ?? ""),
    lastError: String(r.last_error ?? ""),
    createdAt: String(r.created_at ?? ""),
    updatedAt: String(r.updated_at ?? ""),
  };
}

export async function getPayout(transferId: string): Promise<PayoutRow | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data } = await ctx.sb
    .from("payout_transfers")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("transfer_id", transferId)
    .maybeSingle();
  return data ? rowToPayout(data as Record<string, unknown>) : null;
}

export async function payoutsForPeriod(kind: string, period: string): Promise<PayoutRow[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data } = await ctx.sb
    .from("payout_transfers")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("kind", kind)
    .eq("period", period)
    .order("created_at", { ascending: true });
  return (data ?? []).map((r) => rowToPayout(r as Record<string, unknown>));
}

async function call(
  path: string,
  init: { method: "GET" | "POST"; body?: unknown },
): Promise<{ ok: true; payload: unknown } | { ok: false; error: string; httpStatus: number }> {
  const h = payoutHeaders();
  if (!h.ok) return { ok: false, error: h.error, httpStatus: 0 };
  try {
    const res = await fetch(`${payoutBaseUrl()}${path}`, {
      method: init.method,
      headers: h.headers,
      ...(init.body === undefined ? {} : { body: JSON.stringify(init.body) }),
    });
    const payload = await res.json().catch(() => ({}));
    if (!res.ok) {
      const p = (payload ?? {}) as Record<string, unknown>;
      return {
        ok: false,
        error: String(p.message || p.code || `Payouts HTTP ${res.status}`),
        httpStatus: res.status,
      };
    }
    return { ok: true, payload };
  } catch (e) {
    return {
      ok: false,
      error: e instanceof Error ? e.message : "Could not reach Payouts",
      httpStatus: 0,
    };
  }
}

/**
 * A V1 bearer token (/v1/authorize, valid ~5 min) for the few V1-only reads
 * such as the wallet balance. Same client id, secret and 2FA signature as
 * the V2 calls; asked for fresh each time — it is one cheap call before a
 * run, and a cached token is exactly what goes stale in production.
 */
export async function payoutV1Token(): Promise<{ ok: true; token: string } | { ok: false; error: string }> {
  const h = payoutHeaders();
  if (!h.ok) return { ok: false, error: h.error };
  try {
    const r = await fetch(`${payoutBaseUrl()}/v1/authorize`, {
      method: "POST",
      headers: {
        "X-Client-Id": h.headers["x-client-id"],
        "X-Client-Secret": h.headers["x-client-secret"],
        "X-Cf-Signature": h.headers["X-Cf-Signature"],
      },
    });
    const p = ((await r.json().catch(() => ({}))) ?? {}) as Record<string, unknown>;
    const token = String(((p.data ?? {}) as Record<string, unknown>).token ?? "");
    if (String(p.status ?? "").toUpperCase() !== "SUCCESS" || !token) {
      return { ok: false, error: String(p.message || `Payouts authorize failed (HTTP ${r.status})`) };
    }
    return { ok: true, token };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Could not reach Payouts" };
  }
}

/** What is left in the prefunded wallet. Checked before a run, not during it. */
export async function payoutBalance(): Promise<{ ok: true; availablePaise: number } | { ok: false; error: string }> {
  if (!payoutKeysPresent()) return { ok: false, error: "Payouts is not configured" };
  // /v1.2/getBalance is a V1 endpoint: it takes a bearer token from
  // /v1/authorize, not the V2 client-id/secret headers. Sent V2 headers it
  // answers HTTP 200 {status:"ERROR", subCode:"403", "Token is not valid"} —
  // which read here as "no balance we could read", so every pre-flight
  // failed (found 8 Oct 2026). V2's /balance needs a paymentInstrumentId
  // (400 without one, 28 Sep). The token route is proven live: authorize →
  // "Token generated", then getBalance → balance + availableBalance.
  const token = await payoutV1Token();
  if (!token.ok) return { ok: false, error: token.error };
  let res: { ok: true; payload: unknown } | { ok: false; error: string };
  try {
    const r = await fetch(`${payoutBaseUrl()}/v1.2/getBalance`, {
      headers: { Authorization: `Bearer ${token.token}` },
    });
    res = { ok: true, payload: await r.json().catch(() => ({})) };
  } catch (e) {
    res = { ok: false, error: e instanceof Error ? e.message : "Could not reach Payouts" };
  }
  if (!res.ok) return { ok: false, error: res.error };
  const v1 = (res.payload ?? {}) as Record<string, unknown>;
  if (String(v1.status ?? "").toUpperCase() === "ERROR") {
    return { ok: false, error: String(v1.message || "Payouts refused the balance read") };
  }
  const p = (res.payload ?? {}) as Record<string, unknown>;
  const data = (p.data ?? p) as Record<string, unknown>;
  const available = Number(data.available_balance ?? data.availableBalance ?? Number.NaN);
  if (!Number.isFinite(available)) {
    // Not reported as zero. A wallet that reads empty when it is not would stop
    // a salary run; a wallet that reads full when it is empty would half-pay one.
    return { ok: false, error: "Payouts did not report a balance we could read" };
  }
  return { ok: true, availablePaise: Math.round(available * 100) };
}

export async function ensureBeneficiary(input: {
  beneficiaryId: string;
  name: string;
  accountNumber?: string;
  ifsc?: string;
  vpa?: string;
  phone?: string;
  email?: string;
}): Promise<{ ok: true; beneficiaryId: string } | { ok: false; error: string }> {
  if (!payoutKeysPresent()) return { ok: false, error: "Payouts is not configured" };
  const built = buildBeneficiaryBody(input);
  if (!built.ok) return built;

  const created = await call("/beneficiary", { method: "POST", body: built.body });
  if (created.ok) return { ok: true, beneficiaryId: built.body.beneficiary_id };

  // Already there is success. Cashfree answers 409 for a beneficiary that
  // exists, and treating that as a failure would make every payment after the
  // first one impossible.
  if (created.httpStatus === 409 || /exist/i.test(created.error)) {
    return { ok: true, beneficiaryId: built.body.beneficiary_id };
  }
  return { ok: false, error: created.error };
}

export type TransferOutcome =
  | { ok: true; transfer: PayoutRow; view: PayoutTransferView | null }
  | { ok: false; error: string; needsStatusCheck?: boolean };

/**
 * Send one transfer.
 *
 * The row is written BEFORE the call, as with refunds: if the response is lost,
 * the row is the only evidence the school ever asked, and the deterministic
 * transfer id means asking again is refused by Cashfree rather than paying twice.
 *
 * On a 5XX the transfer is left as we found it and `needsStatusCheck` is set. A
 * 5XX is NOT evidence that nothing happened, and shouldRetryTransfer says so —
 * re-sending is how one salary becomes two.
 */
export async function requestPayoutTransfer(input: {
  transferId: string;
  beneficiaryId: string;
  amountPaise: number;
  kind: string;
  subjectId: string;
  period: string;
  remarks?: string;
  requestedBy?: string;
  mode?: PayoutMode;
  /** What this pays (same keys as upi_payment_proofs), so SUCCESS records its UTR. */
  target?: { kind: string; id: string; label: string };
  payeeName?: string;
  /** The owner's ₹1 test — the one transfer allowed before the switch is on. */
  isTest?: boolean;
}): Promise<TransferOutcome> {
  // Checked per transfer, not once per screen.
  if (input.isTest) {
    if (!payoutKeysPresent() || payoutsHardDisabled()) return { ok: false, error: "Cashfree Payouts is not available on this server" };
  } else {
    const gate = await payoutsEnabled();
    if (!gate.ok) return { ok: false, error: gate.why };
  }
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };

  const built = buildTransferBody({
    transferId: input.transferId,
    beneficiaryId: input.beneficiaryId,
    amountPaise: input.amountPaise,
    remarks: input.remarks,
    mode: input.mode,
  });
  if (!built.ok) return built;

  const existing = await getPayout(input.transferId);
  if (existing) {
    // Never sent twice under one id. UNKNOWN means Cashfree may already have
    // it (a lost reply, a 5XX): ask first. Re-sending would come back as a
    // duplicate-id refusal and be wrongly marked FAILED.
    if (existing.status === "UNKNOWN") {
      const seen = await fetchTransferStatus(input.transferId);
      if (seen) {
        const row = await getPayout(input.transferId);
        return row ? { ok: true, transfer: row, view: seen } : { ok: false, error: "Transfer could not be read back" };
      }
    } else if (!payoutNeedsAttention(existing.status)) {
      // In flight or paid: left alone. A double click is harmless.
      return { ok: true, transfer: existing, view: null };
    } else {
      // FAILED / REJECTED / REVERSED: a fresh attempt needs a fresh id —
      // Cashfree refuses a used one. The caller asks again with a new id.
      return {
        ok: false,
        error: `The last attempt ${existing.status.toLowerCase()} (${existing.statusDescription || existing.lastError || "no reason given"}). Pay by UPI instead, or try again tomorrow.`,
      };
    }
  }

  const { error: insertError } = await ctx.sb.from("payout_transfers").upsert(
    {
      transfer_id: input.transferId,
      tenant_id: ctx.tenantId,
      kind: input.kind,
      subject_id: input.subjectId,
      period: input.period,
      beneficiary_id: built.body.beneficiary_details.beneficiary_id,
      amount_paise: Math.round(input.amountPaise),
      status: "UNKNOWN",
      requested_by: input.requestedBy || "",
      last_error: "",
      target_kind: input.target?.kind || "",
      target_id: input.target?.id || "",
      target_label: input.target?.label || "",
      payee_name: input.payeeName || "",
      transfer_mode: built.body.transfer_mode,
      updated_at: new Date().toISOString(),
    },
    { onConflict: "transfer_id" },
  );
  if (insertError) {
    // Refusing to call is the right failure: a transfer nobody can reconcile is
    // worse than a transfer that did not happen.
    return { ok: false, error: `Could not record the transfer: ${insertError.message}` };
  }

  const res = await call("/transfers", { method: "POST", body: built.body });
  if (!res.ok) {
    const serverSide = res.httpStatus >= 500;
    await ctx.sb
      .from("payout_transfers")
      .update({
        last_error: res.error,
        // Left UNKNOWN on a 5XX rather than marked failed: we do not know that
        // Cashfree did not accept it, and marking it failed would invite a
        // second send.
        ...(serverSide ? {} : { status: "FAILED" as PayoutStatus }),
        updated_at: new Date().toISOString(),
      })
      .eq("tenant_id", ctx.tenantId)
      .eq("transfer_id", input.transferId);

    return {
      ok: false,
      error: serverSide
        ? `${res.error}. The transfer may still have gone out — check its status before sending again.`
        : res.error,
      // shouldRetryTransfer is consulted rather than remembered, so the rule
      // lives in one place.
      needsStatusCheck: serverSide && !shouldRetryTransfer(res.httpStatus),
    };
  }

  const view = readPayoutTransfer(res.payload);
  if (view) await recordTransferView(view);
  const row = await getPayout(input.transferId);
  return row ? { ok: true, transfer: row, view } : { ok: false, error: "Transfer sent but could not be read back" };
}

/** Write what Cashfree says about a transfer. Idempotent; webhooks redeliver. */
export async function recordTransferView(view: PayoutTransferView): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  await ctx.sb
    .from("payout_transfers")
    .update({
      cf_transfer_id: view.cfTransferId,
      status: view.status,
      utr: view.utr,
      status_description: view.statusDescription,
      updated_at: new Date().toISOString(),
    })
    .eq("tenant_id", ctx.tenantId)
    .eq("transfer_id", view.transferId);
  await settleTransferEffects(view);
}

/**
 * What a final status means for the rest of the ERP:
 *  - SUCCESS with a 12-digit UTR → recorded in upi_payment_proofs against the
 *    salary line / advance / voucher it paid (source 'payout'), exactly as a
 *    UPI screenshot would be — the screens then show it paid.
 *  - REVERSED → that record is set aside: the money came back, so the item is
 *    unpaid again and must show so.
 *  - the owner's ₹1 test → SUCCESS marks the test passed (unlocks the switch).
 */
async function settleTransferEffects(view: PayoutTransferView): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const row = await getPayout(view.transferId);
  if (!row) return;
  const { data: extra } = await ctx.sb
    .from("payout_transfers")
    .select("target_kind, target_id, target_label, payee_name")
    .eq("tenant_id", ctx.tenantId)
    .eq("transfer_id", view.transferId)
    .maybeSingle();
  const t = (extra ?? {}) as { target_kind?: string; target_id?: string; target_label?: string; payee_name?: string };

  if (row.kind === "test") {
    if (view.status === "SUCCESS") {
      const st = await getPayoutSettings();
      if (!st.testPassedAt) {
        await savePayoutSettings({ test_transfer_id: view.transferId, test_passed_at: new Date().toISOString() }, row.requestedBy || "test");
      }
    }
    return;
  }
  // A "draft:" target was not saved when paid; its screen records the UTR
  // against the real id once it is.
  if (!t.target_kind || !t.target_id || t.target_id.startsWith("draft:")) return;
  if (view.status === "SUCCESS" && /^\d{12}$/.test(view.utr)) {
    // Idempotent: the unique indexes refuse a second copy, which is the
    // outcome wanted when a webhook and a status check both arrive.
    await ctx.sb.from("upi_payment_proofs").insert({
      id: `upp_${view.transferId}`.slice(0, 64),
      tenant_id: ctx.tenantId,
      status: "recorded",
      utr: view.utr,
      amount_paise: view.amountPaise || row.amountPaise,
      paid_on: new Date(Date.now() + 330 * 60 * 1000).toISOString().slice(0, 10),
      payee_name: t.payee_name || "",
      target_kind: t.target_kind,
      target_id: t.target_id,
      target_label: t.target_label || "",
      source: "payout",
      recorded_by: row.requestedBy || "cashfree",
    });
  } else if (view.status === "REVERSED") {
    await ctx.sb
      .from("upi_payment_proofs")
      .update({ status: "dismissed", updated_at: new Date().toISOString() })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", `upp_${view.transferId}`.slice(0, 64));
  }
}

/** Ask Cashfree what became of a transfer. The answer after any 5XX. */
export async function fetchTransferStatus(transferId: string): Promise<PayoutTransferView | null> {
  if (!payoutKeysPresent()) return null;
  const res = await call(`/transfers?transfer_id=${encodeURIComponent(transferId)}`, { method: "GET" });
  if (!res.ok) return null;
  const view = readPayoutTransfer(res.payload);
  if (view) await recordTransferView(view);
  return view;
}

/**
 * Confirm the request shapes against sandbox, without moving real money.
 *
 * This is the gate `payoutsArmed` protects. It creates a beneficiary and reads
 * the balance — both harmless in sandbox — and reports exactly what Cashfree
 * said, so the V2 field names can be confirmed from evidence rather than from
 * a documentation page that did not spell them out.
 */
export async function sandboxProbe(): Promise<{
  base: string;
  keysPresent: boolean;
  armed: boolean;
  balance: Awaited<ReturnType<typeof payoutBalance>>;
  beneficiary: Awaited<ReturnType<typeof ensureBeneficiary>>;
}> {
  return {
    base: payoutBaseUrl(),
    keysPresent: payoutKeysPresent(),
    armed: payoutsArmed(),
    balance: await payoutBalance(),
    beneficiary: await ensureBeneficiary({
      beneficiaryId: "probe_beneficiary",
      name: "Payout Probe",
      // Cashfree's documented sandbox test account.
      accountNumber: "00001111222233",
      ifsc: "HDFC0000001",
    }),
  };
}
