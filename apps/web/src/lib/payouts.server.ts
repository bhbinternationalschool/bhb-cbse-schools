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
  buildBeneficiaryBody,
  buildTransferBody,
  payoutIsPaid,
  payoutNeedsAttention,
  readPayoutTransfer,
  shouldRetryTransfer,
  type PayoutStatus,
  type PayoutTransferView,
} from "@/lib/payouts";
import { payoutSignatureFrom } from "@/lib/payoutsSignature";
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
 * Whether real transfers are allowed at all.
 *
 * Off unless explicitly switched on, and it is checked before every transfer
 * rather than only at the top of a run. The field names have not been confirmed
 * against a live call, so the default must be that no money can move.
 */
export function payoutsArmed(): boolean {
  return process.env.CASHFREE_PAYOUTS_ARMED?.trim() === "true" && payoutKeysPresent();
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

/** What is left in the prefunded wallet. Checked before a run, not during it. */
export async function payoutBalance(): Promise<{ ok: true; availablePaise: number } | { ok: false; error: string }> {
  if (!payoutKeysPresent()) return { ok: false, error: "Payouts is not configured" };
  // /v1.2/getBalance, not /balance. Confirmed the hard way on 28 Sep: the live
  // account answered a /balance read with 400 "paymentInstrumentId is invalid",
  // which was the useful kind of failure — a 400 only comes back AFTER the
  // credentials and the 2FA signature have been accepted, so it proved auth
  // works and named the wrong endpoint in one go.
  //
  // paymentInstrumentId selects one fund source. Omitted here on purpose: the
  // school has one wallet and this is a pre-flight check, so the account-level
  // balance is what is wanted. If Cashfree insists on the id, the error is
  // reported rather than swallowed — see the unreadable-balance branch below,
  // which refuses to call an unknown balance zero.
  const res = await call("/v1.2/getBalance", { method: "GET" });
  if (!res.ok) return { ok: false, error: res.error };
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
  accountNumber: string;
  ifsc: string;
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
}): Promise<TransferOutcome> {
  // Checked per transfer, not once per run: nothing may move real money while
  // the V2 request shapes are unconfirmed.
  if (!payoutsArmed()) {
    return {
      ok: false,
      error:
        "Payouts is not armed. Set CASHFREE_PAYOUTS_ARMED=true only after a sandbox probe has confirmed the request shapes — see payouts.server.ts.",
    };
  }
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };

  const built = buildTransferBody({
    transferId: input.transferId,
    beneficiaryId: input.beneficiaryId,
    amountPaise: input.amountPaise,
    remarks: input.remarks,
  });
  if (!built.ok) return built;

  const existing = await getPayout(input.transferId);
  // Anything already sent and not failed is left alone. This is the guard that
  // makes a double-clicked salary run harmless.
  if (existing && (payoutIsPaid(existing.status) || existing.status !== "UNKNOWN")) {
    if (!payoutNeedsAttention(existing.status)) {
      return { ok: true, transfer: existing, view: null };
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
