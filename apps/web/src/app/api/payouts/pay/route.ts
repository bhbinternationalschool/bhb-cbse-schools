/**
 * POST — pay one ERP item (a salary line, a staff advance, a payment voucher)
 * through Cashfree Payouts. Director, 7 Oct 2026.
 *
 * Body: { targetKind, targetId, targetLabel, subjectId, period, amountPaise,
 * payee: { name, vpa?, accountNumber?, ifsc?, phone? }, remarks? }
 *
 * targetId "draft:…" is an item not saved yet (an advance before Issue, a
 * voucher before Post): the transfer goes out, and the screen records the UTR
 * against the real id once it is saved — as it does for Pay by UPI.
 *
 * Before anything is sent:
 *  - the owner's switch must be on (and its ₹1 test passed) — else
 *    { fallback: "off" };
 *  - the wallet must hold the amount — else { fallback: "wallet_low",
 *    availablePaise } and nothing is sent; the screen offers Pay by UPI;
 *  - a UPI transfer must be within Cashfree's ₹1,00,000 UPI cap.
 * The transfer id is derived from what is paid and the amount, never taken
 * from the client, so a double click or a retry cannot pay twice. The UTR is
 * recorded against the item by itself when Cashfree reports SUCCESS
 * (payouts.server settleTransferEffects).
 *
 * Releasing money: Payroll approve or Accounts approve.
 */

import { NextResponse } from "next/server";
import { requireAnyStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  UPI_PAYOUT_MAX_PAISE,
  payoutBeneficiaryId,
  payoutModeForInstrument,
  payoutSentence,
  payoutTransferId,
  readPayoutStatus,
} from "@/lib/payouts";
import {
  ensureBeneficiary,
  fetchTransferStatus,
  getPayout,
  payoutBalance,
  payoutsEnabled,
  requestPayoutTransfer,
} from "@/lib/payouts.server";
import { findRecordedTargetProof } from "@/lib/upiProofs.server";
import type { UpiTargetKind } from "@/lib/upiProofMatch";

export const runtime = "nodejs";

const KIND_CODE: Record<UpiTargetKind, string> = { payroll_line: "sal", staff_advance: "adv", ledger_voucher: "vch" };

export async function POST(req: Request) {
  const auth = await requireAnyStaffPermission(req, [
    { module: "payroll", action: "approve" },
    { module: "accounts", action: "approve" },
  ]);
  if (!auth.ok) return auth.response;
  let b: Record<string, unknown>;
  try {
    b = (await req.json()) as Record<string, unknown>;
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const targetKind = String(b.targetKind || "") as UpiTargetKind;
  const targetId = String(b.targetId || "").trim();
  const targetLabel = String(b.targetLabel || "").trim().slice(0, 200);
  const subjectId = String(b.subjectId || "").trim();
  const period = String(b.period || "").trim();
  const amountPaise = Math.round(Number(b.amountPaise) || 0);
  const payee = (b.payee ?? {}) as Record<string, unknown>;
  const name = String(payee.name || "").trim();
  const vpa = String(payee.vpa || "").trim().toLowerCase();
  const accountNumber = String(payee.accountNumber || "").replace(/\s/g, "");
  const ifsc = String(payee.ifsc || "").trim().toUpperCase();
  if (!(targetKind in KIND_CODE) || !targetId || !subjectId || !period) {
    return NextResponse.json({ ok: false, error: "What the payment is for is missing." }, { status: 400 });
  }
  if (!(amountPaise >= 100)) return NextResponse.json({ ok: false, error: "A transfer must be at least ₹1." }, { status: 400 });
  if (!name || (!vpa && !(accountNumber && ifsc))) {
    return NextResponse.json({ ok: false, error: "The payee needs a UPI ID, or a bank account and IFSC." }, { status: 400 });
  }

  const gate = await payoutsEnabled();
  if (!gate.ok) return NextResponse.json({ ok: false, fallback: "off", error: gate.why }, { status: 409 });

  // Already paid (by UPI screenshot, the Pay by UPI button, or an earlier
  // transfer)? Then nothing is sent.
  const paid = await findRecordedTargetProof(targetKind, targetId);
  if (paid) {
    return NextResponse.json({ ok: false, error: `Already paid — UTR ${paid.utr} is recorded on this.` }, { status: 409 });
  }

  const mode = payoutModeForInstrument(amountPaise, { vpa, accountNumber: accountNumber && ifsc ? accountNumber : "" });
  if (mode === "upi" && amountPaise > UPI_PAYOUT_MAX_PAISE) {
    return NextResponse.json(
      { ok: false, error: "UPI payouts stop at ₹1,00,000 — add the person's bank account and IFSC to pay this by bank." },
      { status: 400 },
    );
  }

  const balance = await payoutBalance();
  if (!balance.ok) {
    // Unknown is not "enough": nothing is sent on a balance nobody could read.
    return NextResponse.json({ ok: false, fallback: "wallet_unknown", error: `Could not read the Cashfree wallet (${balance.error}).` }, { status: 409 });
  }
  if (balance.availablePaise < amountPaise) {
    return NextResponse.json(
      {
        ok: false,
        fallback: "wallet_low",
        availablePaise: balance.availablePaise,
        error: `The Cashfree wallet has ₹${(balance.availablePaise / 100).toLocaleString("en-IN")} — not enough for this. Pay by UPI instead, or top up the wallet.`,
      },
      { status: 409 },
    );
  }

  const beneficiaryId = payoutBeneficiaryId({
    subject: subjectId,
    vpa: mode === "upi" ? vpa : "",
    accountNumber: mode === "upi" ? "" : accountNumber,
  });
  const ben = await ensureBeneficiary({
    beneficiaryId,
    name,
    ...(mode === "upi" ? { vpa } : { accountNumber, ifsc }),
    phone: String(payee.phone || "").trim() || undefined,
  });
  if (!ben.ok) return NextResponse.json(ben, { status: 400 });

  const transferId = payoutTransferId({
    kind: KIND_CODE[targetKind],
    subjectId,
    period,
    amountPaise,
  });
  const out = await requestPayoutTransfer({
    transferId,
    beneficiaryId: ben.beneficiaryId,
    amountPaise,
    kind: KIND_CODE[targetKind],
    subjectId,
    period,
    remarks: String(b.remarks || targetLabel).slice(0, 70),
    requestedBy: auth.viaMirrorSecret ? "system" : auth.ctx.session.fullName || "",
    mode,
    target: { kind: targetKind, id: targetId, label: targetLabel },
    payeeName: name,
  });
  if (!out.ok) {
    return NextResponse.json(
      {
        ...out,
        ...(out.needsStatusCheck ? { warning: "Do NOT pay this again yet — the transfer may already have gone out. Check its status first." } : {}),
      },
      { status: 400 },
    );
  }
  return NextResponse.json({
    ok: true,
    transferId,
    status: out.transfer.status,
    utr: out.transfer.utr,
    message: out.view ? payoutSentence(out.view) : "Already sent — not sent again.",
  });
}

/**
 * GET ?transferId= — what became of a transfer, re-asked from Cashfree while
 * it is open (the screen polls this after Pay via Cashfree). Same authority as
 * sending it.
 */
export async function GET(req: Request) {
  const auth = await requireAnyStaffPermission(req, [
    { module: "payroll", action: "approve" },
    { module: "accounts", action: "approve" },
  ]);
  if (!auth.ok) return auth.response;
  const transferId = (new URL(req.url).searchParams.get("transferId") || "").trim();
  const row = transferId ? await getPayout(transferId) : null;
  if (!row) return NextResponse.json({ ok: false, error: "No such transfer" }, { status: 404 });
  const open = ["UNKNOWN", "PENDING", "RECEIVED", "APPROVAL_PENDING"];
  if (open.includes(readPayoutStatus(row.status))) await fetchTransferStatus(transferId);
  const fresh = (await getPayout(transferId)) ?? row;
  return NextResponse.json({ ok: true, transferId, status: readPayoutStatus(fresh.status), utr: fresh.utr || "" });
}
