import { currentPunchCode, verifyPunchCode } from "@/lib/punchCode";

const DEV_FALLBACK_SECRET = "bhb-staff-punch-dev-only";

function isProd(): boolean {
  return !!process.env.K_SERVICE || process.env.NODE_ENV === "production";
}

/**
 * The punch-code secret, resolved like every other signed link here
 * (receiptLinkToken.server.ts): APP_SESSION_SECRET, else the service-role
 * key, else — outside production only — a fixed dev value. Nothing new to
 * provision. No secret in production → no code at all, never a guessable one.
 */
function secret(): string | null {
  const explicit = process.env.APP_SESSION_SECRET?.trim();
  if (explicit) return `staff-punch-qr:${explicit}`;
  const derived = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (derived) return `staff-punch-qr:${derived}`;
  if (!isProd()) return DEV_FALLBACK_SECRET;
  console.error("[punchCode] No APP_SESSION_SECRET or SUPABASE_SERVICE_ROLE_KEY — punch codes are off.");
  return null;
}

export function punchCodeNow(nowMs = Date.now()) {
  const s = secret();
  return s ? currentPunchCode(s, nowMs) : null;
}

export function punchCodeIsValid(raw: unknown, nowMs = Date.now()): boolean {
  const s = secret();
  return !!s && verifyPunchCode(s, raw, nowMs);
}
