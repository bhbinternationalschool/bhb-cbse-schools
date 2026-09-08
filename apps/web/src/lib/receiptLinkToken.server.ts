/**
 * A short-lived, signed link to one receipt PDF — for Meta to fetch, nobody else.
 *
 * WhatsApp attaches a document by URL: Meta's servers download the file and
 * put it on top of the template. Meta cannot log in, so the ordinary receipt
 * route — which requires a parent or staff session — is unreachable to it.
 *
 * The alternatives were worse. A public bucket would leave every receipt, with
 * a family's name and what they paid, sitting behind a guessable URL forever.
 * This is signed against one voucher id and expires in minutes: long enough
 * for Meta to fetch it seconds after the send, far too short to be a link
 * worth passing around.
 *
 * Same resolution order and the same fail-closed rule as the admission link:
 * in production, no secret means no link is signed and none is accepted.
 */

import { createHmac, timingSafeEqual } from "crypto";

const DEV_FALLBACK_SECRET = "bhb-receipt-link-dev-only";

/** Meta fetches within seconds. Fifteen minutes is generous for a retry. */
export const RECEIPT_LINK_TTL_SECONDS = 15 * 60;

function isProd(): boolean {
  return !!process.env.K_SERVICE || process.env.NODE_ENV === "production";
}

function linkSecret(): string | null {
  const explicit = process.env.APP_SESSION_SECRET?.trim();
  if (explicit) return `bhb-receipt-link:${explicit}`;
  const derived = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (derived) return `bhb-receipt-link:${derived}`;
  if (!isProd()) return DEV_FALLBACK_SECRET;
  console.error(
    "[receiptLink] No APP_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY — refusing to sign or accept receipt links.",
  );
  return null;
}

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signReceiptLinkToken(
  voucherId: string,
  ttlSeconds = RECEIPT_LINK_TTL_SECONDS,
  nowMs = Date.now(),
): { exp: number; sig: string } | null {
  const secret = linkSecret();
  if (!secret || !voucherId) return null;
  const exp = Math.floor(nowMs / 1000) + Math.max(60, ttlSeconds);
  return { exp, sig: hmac(`${voucherId}|${exp}`, secret) };
}

export type ReceiptLinkVerdict =
  | { ok: true }
  | { ok: false; reason: "unconfigured" | "malformed" | "expired" | "bad_signature" };

export function verifyReceiptLinkToken(
  voucherId: string,
  exp: string | number | null,
  sig: string | null,
  nowMs = Date.now(),
): ReceiptLinkVerdict {
  const secret = linkSecret();
  if (!secret) return { ok: false, reason: "unconfigured" };
  const expNum = Number(exp);
  if (!voucherId || !sig || !Number.isFinite(expNum) || expNum <= 0) {
    return { ok: false, reason: "malformed" };
  }
  // Expiry is checked BEFORE the signature so a stale-but-valid link cannot
  // be replayed; both are checked, so neither alone is enough.
  if (Math.floor(nowMs / 1000) > expNum) return { ok: false, reason: "expired" };

  const expected = hmac(`${voucherId}|${expNum}`, secret);
  const a = Buffer.from(expected);
  const b = Buffer.from(sig);
  if (a.length !== b.length) return { ok: false, reason: "bad_signature" };
  return timingSafeEqual(a, b) ? { ok: true } : { ok: false, reason: "bad_signature" };
}

/** The absolute URL Meta will fetch. Absolute because Meta has no base. */
export function receiptPdfPublicUrl(
  voucherId: string,
  origin: string,
): string | null {
  const t = signReceiptLinkToken(voucherId);
  if (!t || !origin) return null;
  const base = origin.replace(/\/+$/, "");
  return `${base}/api/fees/receipt-pdf/${encodeURIComponent(voucherId)}?exp=${t.exp}&sig=${encodeURIComponent(t.sig)}`;
}
