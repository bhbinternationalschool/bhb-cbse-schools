/**
 * Edge-compatible verification of the signed session cookie.
 *
 * middleware.ts runs on the Edge runtime, which has no `node:crypto` — so
 * it could only ever check the cookie was *present*, not that it was
 * validly signed, and a forged `bhb_demo_session` cookie would sail past
 * the edge and only get rejected once RBAC actually ran deep inside a
 * page/API route (or not at all, for pages that render before checking).
 * This mirrors sessionCookie.server.ts's format/secret resolution exactly
 * using Web Crypto (crypto.subtle), which is available on both the Edge
 * runtime and in Node — see sessionCookieEdge.selftest.ts for the
 * cross-compatibility proof.
 */

const DEV_FALLBACK_SECRET = "bhb-dev-only-session-secret-not-for-production";

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/** Must match sessionCookie.server.ts's sessionSecret() resolution exactly. */
function sessionSecret(): string | null {
  const explicit = process.env.APP_SESSION_SECRET?.trim();
  if (explicit) return explicit;

  const derived = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (derived) return `bhb-session:${derived}`;

  if (!isProd()) return DEV_FALLBACK_SECRET;

  return null;
}

function base64UrlToBytes(b64url: string): Uint8Array | null {
  try {
    const b64 = b64url
      .replace(/-/g, "+")
      .replace(/_/g, "/")
      .padEnd(Math.ceil(b64url.length / 4) * 4, "=");
    const bin = atob(b64);
    const bytes = new Uint8Array(bin.length);
    for (let i = 0; i < bin.length; i++) bytes[i] = bin.charCodeAt(i);
    return bytes;
  } catch {
    return null;
  }
}

export type EdgeSessionShape = { persona: string; roleCode: string };

/**
 * Verify a `bhb_demo_session` cookie value at the edge. Returns the parsed
 * session (loosely typed — full validation still happens server-side)
 * when the HMAC checks out, null otherwise (missing, malformed, unsigned
 * legacy value, wrong secret, or tampered).
 */
export async function verifySessionCookieEdge(
  raw: string | undefined,
): Promise<EdgeSessionShape | null> {
  if (!raw) return null;
  const secret = sessionSecret();
  if (!secret) return null;

  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;

  const payload = raw.slice(0, dot);
  const provided = raw.slice(dot + 1);

  const sigBytes = base64UrlToBytes(provided);
  if (!sigBytes) return null;

  let key: CryptoKey;
  try {
    key = await crypto.subtle.importKey(
      "raw",
      new TextEncoder().encode(secret),
      { name: "HMAC", hash: "SHA-256" },
      false,
      ["verify"],
    );
  } catch {
    return null;
  }

  let valid = false;
  try {
    valid = await crypto.subtle.verify(
      "HMAC",
      key,
      sigBytes as BufferSource,
      new TextEncoder().encode(payload),
    );
  } catch {
    return null;
  }
  if (!valid) return null;

  const payloadBytes = base64UrlToBytes(payload);
  if (!payloadBytes) return null;

  try {
    const json = new TextDecoder().decode(payloadBytes);
    const parsed = JSON.parse(json) as EdgeSessionShape;
    if (!parsed || typeof parsed !== "object") return null;
    if (typeof parsed.persona !== "string" || typeof parsed.roleCode !== "string") {
      return null;
    }
    return parsed;
  } catch {
    return null;
  }
}
