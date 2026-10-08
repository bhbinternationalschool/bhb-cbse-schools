/**
 * POST — Cashfree Payouts status webhook (V2). Configure in Cashfree:
 * Payouts Dashboard → Developers → Webhooks → https://bhbinternational.school/api/payouts/webhook
 *
 * Every call is verified before it is read: HMAC-SHA256 of
 * x-webhook-timestamp + raw body, keyed with the Payouts client secret,
 * base64, compared in constant time; a stale timestamp is refused. A verified
 * transfer event updates payout_transfers and, on SUCCESS, records the UTR
 * against the item it paid (payouts.server recordTransferView). Idempotent —
 * Cashfree redelivers. The status check on the screens is the fallback when a
 * webhook never comes.
 */

import { NextResponse } from "next/server";
import { readPayoutTransfer } from "@/lib/payouts";
import { recordTransferView } from "@/lib/payouts.server";
import { verifyPayoutWebhook } from "@/lib/payoutsSignature";

export const runtime = "nodejs";

const MAX_AGE_SECONDS = 15 * 60;

export async function POST(req: Request) {
  const secret = process.env.CASHFREE_PAYOUT_CLIENT_SECRET?.trim() || "";
  const raw = await req.text();
  const timestamp = req.headers.get("x-webhook-timestamp") || "";
  const signature = req.headers.get("x-webhook-signature") || "";
  if (!verifyPayoutWebhook(raw, timestamp, signature, secret)) {
    // Why it was refused, without a byte of the secret, signature or body:
    // the 8 Oct 2026 dashboard test kept failing with nothing to go on.
    console.warn("[payouts webhook] refused", JSON.stringify({
      secretSet: !!secret,
      hasTimestamp: !!timestamp,
      hasSignature: !!signature,
      version: req.headers.get("x-webhook-version") || "",
      contentType: req.headers.get("content-type") || "",
      bodyBytes: raw.length,
      bodyLooksJson: raw.trimStart().startsWith("{"),
      bodyHasSignatureField: /(^|&|")signature("|=)/.test(raw),
    }));
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 400 });
  }
  // Timestamps are sent in seconds or milliseconds; either way not stale.
  const ts = Number(timestamp);
  const tsSeconds = ts > 1e12 ? ts / 1000 : ts;
  if (Number.isFinite(tsSeconds) && Math.abs(Date.now() / 1000 - tsSeconds) > MAX_AGE_SECONDS) {
    console.warn("[payouts webhook] refused: stale timestamp", timestamp);
    return NextResponse.json({ ok: false, error: "Stale webhook" }, { status: 400 });
  }
  let payload: unknown;
  try {
    payload = JSON.parse(raw);
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }
  const view = readPayoutTransfer(payload);
  // Not every event is about a transfer (LOW_BALANCE_ALERT, CREDIT_CONFIRMATION):
  // acknowledged, nothing to record.
  if (view) await recordTransferView(view);
  return NextResponse.json({ ok: true });
}
