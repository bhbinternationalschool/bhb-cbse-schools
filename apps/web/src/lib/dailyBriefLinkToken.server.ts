/**
 * A short-lived, signed link to one day's brief PDF — for Meta to fetch.
 *
 * Same shape and the same fail-closed rule as the receipt link, and for the
 * same reason: WhatsApp attaches a document by URL, Meta's servers download
 * the file, and Meta cannot log in. A template send therefore needs a URL
 * the world can fetch — so it is signed against one date and expires in
 * minutes.
 *
 * This PDF is more sensitive than a receipt. A receipt is one family's own
 * payment; this carries every overdue family's name, class, balance and
 * parent mobile. Hence the shorter window, and hence no "open it later"
 * link handed to a person: the document itself arrives on WhatsApp and
 * stays there, and anyone wanting it again asks the ERP.
 */

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";

/** Meta fetches within seconds of the send. Five minutes is generous. */
export const BRIEF_LINK_TTL_SECONDS = 5 * 60;

function isProd(): boolean {
  return !!process.env.K_SERVICE || process.env.NODE_ENV === "production";
}

function linkSecret(): string | null {
  const explicit = process.env.APP_SESSION_SECRET?.trim();
  if (explicit) return `bhb-daily-brief:${explicit}`;
  const derived = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (derived) return `bhb-daily-brief:${derived}`;
  if (!isProd()) return "bhb-daily-brief-dev-only";
  console.error(
    "[dailyBriefLink] No APP_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY — refusing to sign or accept brief links.",
  );
  return null;
}

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signBriefLinkToken(
  dateIso: string,
  ttlSeconds = BRIEF_LINK_TTL_SECONDS,
  nowMs = Date.now(),
): { exp: number; sig: string } | null {
  const secret = linkSecret();
  if (!secret || !dateIso) return null;
  const exp = Math.floor(nowMs / 1000) + Math.max(60, ttlSeconds);
  return { exp, sig: hmac(`${dateIso}|${exp}`, secret) };
}

export type BriefLinkVerdict =
  | { ok: true }
  | { ok: false; reason: "unconfigured" | "malformed" | "expired" | "bad_signature" };

export function verifyBriefLinkToken(
  dateIso: string,
  exp: unknown,
  sig: unknown,
  nowMs = Date.now(),
): BriefLinkVerdict {
  const secret = linkSecret();
  if (!secret) return { ok: false, reason: "unconfigured" };
  const expNum = Number(exp);
  const sigStr = typeof sig === "string" ? sig : "";
  if (!dateIso || !sigStr || !Number.isFinite(expNum) || expNum <= 0) {
    return { ok: false, reason: "malformed" };
  }
  const expected = hmac(`${dateIso}|${expNum}`, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(sigStr, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad_signature" };
  }
  if (expNum * 1000 <= nowMs) return { ok: false, reason: "expired" };
  return { ok: true };
}
