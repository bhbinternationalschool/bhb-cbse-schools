/**
 * A short-lived signed link to one class-gallery item served from Drive
 * (after its 30 days in the bucket) — for the phone's video player, which
 * cannot send the app's login. The app asks with its login (?link=1), the
 * viewer is checked there, and the link it gets lasts ten minutes.
 *
 * Same secret order and fail-closed rule as receiptLinkToken: in production,
 * no secret means no link is signed and none is accepted.
 */

import { createHmac, timingSafeEqual } from "crypto";

export const CLASS_MEDIA_LINK_TTL_SECONDS = 10 * 60;

function secret(): string | null {
  const explicit = process.env.APP_SESSION_SECRET?.trim();
  if (explicit) return `bhb-class-media:${explicit}`;
  const derived = process.env.SUPABASE_SERVICE_ROLE_KEY?.trim();
  if (derived) return `bhb-class-media:${derived}`;
  if (!process.env.K_SERVICE && process.env.NODE_ENV !== "production") return "bhb-class-media-dev-only";
  return null;
}

const mac = (payload: string, key: string) => createHmac("sha256", key).update(payload).digest("base64url");

export function signClassMediaLink(photoId: string, nowMs = Date.now()): { exp: number; sig: string } | null {
  const key = secret();
  if (!key || !photoId) return null;
  const exp = Math.floor(nowMs / 1000) + CLASS_MEDIA_LINK_TTL_SECONDS;
  return { exp, sig: mac(`${photoId}|${exp}`, key) };
}

export function verifyClassMediaLink(photoId: string, exp: string | null, sig: string | null, nowMs = Date.now()): boolean {
  const key = secret();
  const e = Number(exp);
  if (!key || !photoId || !sig || !Number.isFinite(e) || e * 1000 < nowMs) return false;
  const want = Buffer.from(mac(`${photoId}|${e}`, key));
  const got = Buffer.from(sig);
  return want.length === got.length && timingSafeEqual(want, got);
}
