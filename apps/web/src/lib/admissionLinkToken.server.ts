/**
 * Signed token for the admission registration link the WhatsApp bot sends.
 *
 * The link has to identify which family is registering, or the form files
 * a second lead for a family that already has an enquiry — the school
 * then holds two records for one child, which is how duplicate households
 * got into this roster in the first place.
 *
 * A raw household id in the URL would let anyone enumerate other
 * families' enquiries, so the id is HMAC-signed here and verified before
 * any lead is read. The token also carries the mobile it was issued to
 * and an expiry: a link forwarded to a stranger months later opens
 * nothing.
 */

import { createHmac, timingSafeEqual } from "crypto";

const DEV_FALLBACK_SECRET = "bhb-dev-only-admission-link-secret";
const DEFAULT_TTL_DAYS = 30;

export type AdmissionLinkPayload = {
  /** Family this link registers. */
  householdId: string;
  /** The number the link was sent to — 10 digits. */
  mobile10: string;
  /** Unix seconds. */
  exp: number;
};

function isProd(): boolean {
  return process.env.NODE_ENV === "production";
}

/**
 * Same resolution order as the session cookie: an explicit secret, else
 * the service-role key that every environment already has, else a
 * dev-only constant. Null in production means no link can be signed or
 * accepted — fail closed rather than issue an unforgeable-looking token
 * that anyone can mint.
 */
function linkSecret(): string | null {
  const explicit = process.env.APP_SESSION_SECRET?.trim();
  if (explicit) return `bhb-admission-link:${explicit}`;
  const derived = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (derived) return `bhb-admission-link:${derived}`;
  if (!isProd()) return DEV_FALLBACK_SECRET;
  console.error(
    "[admissionLink] No APP_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY set — refusing to sign or accept links.",
  );
  return null;
}

function hmac(payload: string, secret: string): string {
  return createHmac("sha256", secret).update(payload).digest("base64url");
}

export function signAdmissionLinkToken(
  input: { householdId: string; mobile10: string },
  ttlDays = DEFAULT_TTL_DAYS,
): string | null {
  const secret = linkSecret();
  if (!secret) return null;
  if (!input.householdId || input.mobile10.length !== 10) return null;
  const payload: AdmissionLinkPayload = {
    householdId: input.householdId,
    mobile10: input.mobile10,
    exp: Math.floor(Date.now() / 1000) + ttlDays * 86_400,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString(
    "base64url",
  );
  return `${encoded}.${hmac(encoded, secret)}`;
}

/** The payload, or null when missing, malformed, tampered with, or expired. */
export function verifyAdmissionLinkToken(
  raw: string | null | undefined,
): AdmissionLinkPayload | null {
  if (!raw) return null;
  const secret = linkSecret();
  if (!secret) return null;

  const dot = raw.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = raw.slice(0, dot);
  const provided = raw.slice(dot + 1);
  const expected = hmac(encoded, secret);

  const a = Buffer.from(provided, "utf8");
  const b = Buffer.from(expected, "utf8");
  if (a.length !== b.length) return null;
  try {
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }

  try {
    const parsed = JSON.parse(
      Buffer.from(encoded, "base64url").toString("utf8"),
    ) as AdmissionLinkPayload;
    if (
      !parsed ||
      typeof parsed.householdId !== "string" ||
      typeof parsed.mobile10 !== "string" ||
      typeof parsed.exp !== "number"
    ) {
      return null;
    }
    if (parsed.exp * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}
