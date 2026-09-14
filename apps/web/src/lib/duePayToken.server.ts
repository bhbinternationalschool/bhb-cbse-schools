/**
 * Signing and checking the /pay/due token. See duePayToken.ts for why the
 * link exists.
 */

import { createHmac, timingSafeEqual } from "crypto";
import {
  DUE_PAY_PATH,
  DUE_PAY_TTL_DAYS,
  isDuePayPayload,
  type DuePayPayload,
  type DuePayScope,
} from "@/lib/duePayToken";

const DEV_FALLBACK_SECRET = "bhb-dev-only-due-pay-secret";

/** Same order as the admission link: explicit secret, else the service key; none in production = no links. */
function secret(): string | null {
  const explicit = process.env.APP_SESSION_SECRET?.trim();
  if (explicit) return `bhb-due-pay:${explicit}`;
  const derived = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (derived) return `bhb-due-pay:${derived}`;
  if (process.env.NODE_ENV !== "production") return DEV_FALLBACK_SECRET;
  return null;
}

function sign(encoded: string, key: string): string {
  // 16 bytes is plenty against forgery and keeps the link short on a phone.
  return createHmac("sha256", key).update(encoded).digest("base64url").slice(0, 22);
}

export function signDuePayToken(input: {
  householdId: string;
  studentId?: string;
  scope: DuePayScope;
  ttlDays?: number;
}): string | null {
  const key = secret();
  if (!key || !input.householdId) return null;
  const payload: DuePayPayload = {
    h: input.householdId,
    ...(input.studentId ? { s: input.studentId } : {}),
    sc: input.scope,
    exp: Math.floor(Date.now() / 1000) + (input.ttlDays ?? DUE_PAY_TTL_DAYS) * 86_400,
  };
  const encoded = Buffer.from(JSON.stringify(payload), "utf8").toString("base64url");
  return `${encoded}.${sign(encoded, key)}`;
}

export function verifyDuePayToken(raw: string | null | undefined): DuePayPayload | null {
  if (!raw) return null;
  const key = secret();
  if (!key) return null;
  const token = decodeURIComponent(raw.trim());
  const dot = token.lastIndexOf(".");
  if (dot <= 0) return null;
  const encoded = token.slice(0, dot);
  const a = Buffer.from(token.slice(dot + 1), "utf8");
  const b = Buffer.from(sign(encoded, key), "utf8");
  if (a.length !== b.length) return null;
  try {
    if (!timingSafeEqual(a, b)) return null;
  } catch {
    return null;
  }
  try {
    const parsed: unknown = JSON.parse(Buffer.from(encoded, "base64url").toString("utf8"));
    if (!isDuePayPayload(parsed)) return null;
    if (parsed.exp * 1000 < Date.now()) return null;
    return parsed;
  } catch {
    return null;
  }
}

/**
 * Just the token, for a template's "Pay now" button: Meta allows one variable
 * at the END of a button URL, so the button is
 * https://bhbinternational.school/pay/due/{{duePayToken}}.
 */
export function duePayTokenFor(input: { householdId: string; studentId?: string; scope: DuePayScope }): string {
  return signDuePayToken(input) ?? "";
}

/** The full link for a message, or "" when no secret is available (never a broken link). */
export function duePayUrl(
  origin: string,
  input: { householdId: string; studentId?: string; scope: DuePayScope },
): string {
  const token = signDuePayToken(input);
  return token ? `${origin.replace(/\/$/, "")}${DUE_PAY_PATH}${token}` : "";
}
