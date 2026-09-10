/**
 * Signing and checking a bus-tracking link.
 *
 * Same shape and the same fail-closed rule as the receipt and admission
 * links: in production, no secret means no link is signed and none is
 * accepted. A tracking link that could be forged would let anyone watch a
 * school bus by guessing a student id, so an unconfigured deployment must
 * refuse rather than fall back to a known dev secret.
 *
 * The token binds ONE student to ONE expiry. It carries no vehicle: the page
 * resolves the child's current bus when it is opened, so a link cannot
 * outlive a route change and start showing a vehicle the child is not on.
 */

import "server-only";

import { createHmac, timingSafeEqual } from "node:crypto";
import {
  packTrackToken,
  trackLinkWindow,
  unpackTrackToken,
} from "@/lib/waTransportTrack";

const DEV_FALLBACK_SECRET = "bhb-bus-track-dev-only";

function isProd(): boolean {
  return !!process.env.K_SERVICE || process.env.NODE_ENV === "production";
}

function linkSecret(): string | null {
  const explicit = process.env.APP_SESSION_SECRET?.trim();
  if (explicit) return `bhb-bus-track:${explicit}`;
  const derived = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (derived) return `bhb-bus-track:${derived}`;
  if (!isProd()) return DEV_FALLBACK_SECRET;
  console.error(
    "[busTrack] No APP_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY — refusing to sign or accept tracking links.",
  );
  return null;
}

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/**
 * A token for this child, valid to the end of the current run.
 *
 * Returns null when no link may be issued: outside a run, or with no secret
 * configured. Null is the caller's cue to send the message WITHOUT a tracking
 * button rather than with a dead one.
 */
export function signBusTrackToken(
  studentId: string,
  nowMs = Date.now(),
): { token: string; expiresAtMs: number } | null {
  const secret = linkSecret();
  if (!secret || !studentId) return null;
  const window = trackLinkWindow(nowMs);
  if (!window.ok) return null;
  const exp = Math.floor(window.expiresAtMs / 1000);
  return {
    token: packTrackToken({
      studentId,
      exp,
      sig: hmac(`${studentId}|${exp}`, secret),
    }),
    expiresAtMs: window.expiresAtMs,
  };
}

export type BusTrackVerdict =
  | { ok: true; studentId: string }
  | { ok: false; reason: "unconfigured" | "bad-link" | "expired" };

export function verifyBusTrackToken(
  raw: string,
  nowMs = Date.now(),
): BusTrackVerdict {
  const secret = linkSecret();
  if (!secret) return { ok: false, reason: "unconfigured" };

  const parsed = unpackTrackToken(raw);
  if (!parsed.ok) return { ok: false, reason: "bad-link" };

  // Signature before expiry: a forged token must not be able to tell the
  // holder whether the id it guessed exists by returning a different error.
  const expected = hmac(`${parsed.studentId}|${parsed.exp}`, secret);
  const a = Buffer.from(expected, "utf8");
  const b = Buffer.from(parsed.sig, "utf8");
  if (a.length !== b.length || !timingSafeEqual(a, b)) {
    return { ok: false, reason: "bad-link" };
  }
  if (parsed.exp * 1000 <= nowMs) return { ok: false, reason: "expired" };
  return { ok: true, studentId: parsed.studentId };
}
