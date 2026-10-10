/**
 * Signed app-session cookie.
 *
 * The session cookie carries `persona` and `roleCode`, and the server
 * authorizes against them. `httpOnly` stops page JavaScript from reading
 * the cookie, but it does NOT stop a person editing it in browser
 * devtools — so an unsigned cookie is a self-service privilege
 * escalation (write `roleCode: "owner"`, get Director access).
 *
 * Every cookie value is therefore HMAC-SHA256 signed here and verified
 * on read. Format: `<base64url(payload)>.<base64url(hmac)>`.
 *
 * Deploy note: existing unsigned cookies fail verification, so everyone
 * is signed out once after this ships. That is intended — it also
 * invalidates any cookie that was forged before the fix.
 */

import { createHmac, timingSafeEqual } from "crypto";
import type { DemoSession } from "@/lib/auth";

/** Dev-only fallback so a local checkout works with no env configured. */
const DEV_FALLBACK_SECRET = "bhb-dev-only-session-secret-not-for-production";

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Secret resolution, in order:
 *   1. APP_SESSION_SECRET — preferred, set this explicitly.
 *   2. SUPABASE_SERVICE_ROLE_KEY — already a high-entropy server-only
 *      secret present in every environment, so signing works out of the
 *      box without a new env var. Rotating it signs everyone out.
 *   3. Dev-only constant (never in production).
 * Returns null in production when none of the above is available, which
 * makes both signing and verification fail closed.
 */
function sessionSecret(): string | null {
  const explicit = process.env.APP_SESSION_SECRET?.trim();
  if (explicit) return explicit;

  const derived = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (derived) return `bhb-session:${derived}`;

  if (!isProd()) return DEV_FALLBACK_SECRET;

  console.error(
    "[session] No APP_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY set — refusing to issue or accept sessions.",
  );
  return null;
}

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

/** Encode + sign a session for use as a cookie value. */
export function signSession(session: DemoSession): string | null {
  const secret = sessionSecret();
  if (!secret) return null;
  const payload = Buffer.from(JSON.stringify(session), "utf8").toString(
    "base64url",
  );
  return `${payload}.${hmac(payload, secret)}`;
}

/**
 * Verify a cookie value and return the session, or null when the value
 * is missing, malformed, unsigned (legacy), or tampered with.
 */
export function verifySessionCookie(raw: string | undefined): DemoSession | null {
  if (!raw) return null;
  const secret = sessionSecret();
  if (!secret) return null;

  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null; // legacy unsigned value, or malformed

  const payload = raw.slice(0, dot);
  const provided = raw.slice(dot + 1);
  const expected = hmac(payload, secret);

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  try {
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const json = Buffer.from(payload, "base64url").toString("utf8");
    const parsed = JSON.parse(json) as DemoSession;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.persona !== "string" || typeof parsed.roleCode !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
