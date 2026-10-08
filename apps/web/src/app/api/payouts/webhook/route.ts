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
import { verifyPayoutWebhook, verifyPayoutWebhookV1 } from "@/lib/payoutsSignature";

export const runtime = "nodejs";

const MAX_AGE_SECONDS = 15 * 60;

export async function POST(req: Request) {
  const secret = process.env.CASHFREE_PAYOUT_CLIENT_SECRET?.trim() || "";
  const raw = await req.text();
  const timestamp = req.headers.get("x-webhook-timestamp") || "";
  const signature = req.headers.get("x-webhook-signature") || "";
  // V2 signs in headers; V1 (what the dashboard Test sends, 8 Oct 2026)
  // signs inside the body. Either, verified, is accepted — nothing else.
  let v1Fields: Record<string, unknown> | null = null;
  if (!timestamp && !signature) {
    try {
      const parsed = raw.trimStart().startsWith("{")
        ? (JSON.parse(raw) as unknown)
        : Object.fromEntries(new URLSearchParams(raw));
      if (parsed && typeof parsed === "object" && !Array.isArray(parsed)) v1Fields = parsed as Record<string, unknown>;
    } catch {
      v1Fields = null;
    }
  }
  const v2ok = !!timestamp && !!signature && verifyPayoutWebhook(raw, timestamp, signature, secret);
  const v1ok = !v2ok && !!v1Fields && verifyPayoutWebhookV1(v1Fields, secret);
  if (!v2ok && !v1ok) {
    // Why it was refused, without a byte of the secret, signature or body.
    console.warn("[payouts webhook] refused", JSON.stringify({
      secretSet: !!secret,
      format: v1Fields ? "v1-body" : "v2-headers",
      hasTimestamp: !!timestamp,
      hasSignature: !!signature || typeof v1Fields?.signature === "string",
      contentType: req.headers.get("content-type") || "",
      bodyBytes: raw.length,
      fieldNames: v1Fields ? Object.keys(v1Fields).sort().join(",") : "",
      matchesPgSecretV1: !!v1Fields && verifyPayoutWebhookV1(v1Fields, process.env.CASHFREE_SECRET_KEY?.trim() || ""),
    }));
    return NextResponse.json({ ok: false, error: "Invalid signature" }, { status: 400 });
  }
  if (v1ok) {
    const view = readPayoutTransfer(v1Fields);
    if (view) await recordTransferView(view);
    return NextResponse.json({ ok: true });
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
