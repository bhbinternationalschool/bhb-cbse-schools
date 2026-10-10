/**
 * The office punch code (director, 30 Sep 2026) — six digits that change
 * every 30 seconds, shown as a QR and in large type on the office tablet /
 * desktop. A punch must carry the code of NOW (or the one just before, so a
 * code read at second 29 still works), which proves the phone was in front
 * of that screen, at the gate, a moment ago. A photo of it forwarded on
 * WhatsApp is dead within a minute.
 *
 * code = HMAC-SHA256(secret, "punch|" + window) → 6 digits, window =
 * floor(ms / 30 000). Nothing is stored: any server instance can check a
 * code. Pure — the secret is passed in (see punchCode.server.ts).
 */
import { createHmac } from "crypto";

export const PUNCH_CODE_WINDOW_MS = 30_000;

export function punchWindow(nowMs: number): number {
  return Math.floor(nowMs / PUNCH_CODE_WINDOW_MS);
}

export function punchCodeForWindow(secret: string, window: number): string {
  const mac = createHmac("sha256", secret).update(`punch|${window}`).digest();
  // RFC 4226 dynamic truncation, as authenticator apps do.
  const off = mac[mac.length - 1]! & 0x0f;
  const n =
    ((mac[off]! & 0x7f) << 24) | (mac[off + 1]! << 16) | (mac[off + 2]! << 8) | mac[off + 3]!;
  return String(n % 1_000_000).padStart(6, "0");
}

/** The code on screen now, and when it changes. */
export function currentPunchCode(secret: string, nowMs: number) {
  const w = punchWindow(nowMs);
  return {
    code: punchCodeForWindow(secret, w),
    expiresAt: (w + 1) * PUNCH_CODE_WINDOW_MS,
    windowMs: PUNCH_CODE_WINDOW_MS,
  };
}

/** Digits only — "482 913", "482-913" and a pasted link all work. */
export function cleanPunchCode(raw: unknown): string {
  const s = String(raw ?? "");
  const fromLink = s.match(/[?&]c=(\d{6})\b/);
  if (fromLink) return fromLink[1]!;
  const digits = s.replace(/\D/g, "");
  return digits.length === 6 ? digits : "";
}

/** True when `raw` is this window's code or the previous one. */
export function verifyPunchCode(secret: string, raw: unknown, nowMs: number): boolean {
  const code = cleanPunchCode(raw);
  if (!code) return false;
  const w = punchWindow(nowMs);
  return code === punchCodeForWindow(secret, w) || code === punchCodeForWindow(secret, w - 1);
}
