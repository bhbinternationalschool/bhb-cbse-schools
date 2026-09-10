/**
 * When a parent may be handed a live bus-tracking link, and for how long.
 *
 * A tracking link is not like a pay link. It shows where a vehicle carrying
 * children is, right now, to whoever holds the URL — so the question is not
 * only "is this parent entitled to it" but "is this the hour in which it
 * means anything". Between runs the answer is no: the bus is parked at the
 * driver's home, that address is nobody's business, and a link that still
 * worked at 10pm would be a standing invitation.
 *
 * So a link is issued only inside a run, and dies at the end of the run it
 * was issued in — not after a fixed number of hours. A link handed out when
 * a child boards at 07:42 stops working at 09:45 with the morning window,
 * and tomorrow's boarding message brings a new one.
 *
 * The same gate is applied again when the link is OPENED (parentPositionVerdict
 * in fleetLivePosition), so an unexpired link outside a run still shows
 * nothing. Two gates, because this one governs what we hand out and that one
 * governs what we reveal.
 */

import { TRIP_WINDOWS_IST, istMinutesOfDay } from "@/lib/fleetLivePosition";

/**
 * Minutes past the end of a run for which a link keeps working.
 *
 * A run overruns: traffic, a flat tyre, a stop added at the end of term. The
 * grace is what stops a parent's link dying while their child is still on the
 * bus, and it is small enough that it never reaches the next run.
 */
export const TRACK_GRACE_MINUTES = 20;

/** Nothing lives longer than this, whatever the windows say. */
export const TRACK_MAX_TTL_MS = 3 * 60 * 60_000;

export type TrackLinkWindow =
  | { ok: true; expiresAtMs: number; window: string }
  | { ok: false; reason: "off-hours" };

/**
 * Whether a link may be issued now, and when it expires.
 *
 * `nowMs` is passed in rather than read from the clock so this is testable
 * and so the server decides, not a driver's phone with a skewed clock.
 */
export function trackLinkWindow(nowMs: number): TrackLinkWindow {
  const minute = istMinutesOfDay(nowMs);
  for (const w of TRIP_WINDOWS_IST) {
    if (minute >= w.from && minute < w.to) {
      const minutesLeft = w.to - minute + TRACK_GRACE_MINUTES;
      return {
        ok: true,
        expiresAtMs: nowMs + Math.min(minutesLeft * 60_000, TRACK_MAX_TTL_MS),
        window: w.label,
      };
    }
  }
  return { ok: false, reason: "off-hours" };
}

/**
 * The path a token opens.
 *
 * The token is the LAST path segment because Meta allows a URL button one
 * variable and only at the end — the same shape as the pay-now button.
 */
export function trackLinkPath(token: string): string {
  return `/track/bus/${token}`;
}

export function trackLinkUrl(baseUrl: string, token: string): string {
  const base = (baseUrl || "").replace(/\/+$/, "");
  return `${base}${trackLinkPath(token)}`;
}

/** The three-part token a link carries: student, expiry, signature. */
export function packTrackToken(parts: {
  studentId: string;
  exp: number;
  sig: string;
}): string {
  return `${parts.studentId}.${parts.exp}.${parts.sig}`;
}

export type UnpackedTrackToken =
  | { ok: true; studentId: string; exp: number; sig: string }
  | { ok: false; reason: "malformed" };

export function unpackTrackToken(raw: string): UnpackedTrackToken {
  const token = (raw || "").trim();
  // Split from the right: a student id is opaque and may itself contain a
  // dot, but the expiry and signature never do.
  const lastDot = token.lastIndexOf(".");
  if (lastDot <= 0) return { ok: false, reason: "malformed" };
  const sig = token.slice(lastDot + 1);
  const head = token.slice(0, lastDot);
  const midDot = head.lastIndexOf(".");
  if (midDot <= 0) return { ok: false, reason: "malformed" };
  const exp = Number(head.slice(midDot + 1));
  const studentId = head.slice(0, midDot);
  if (!studentId || !sig || !Number.isFinite(exp) || exp <= 0) {
    return { ok: false, reason: "malformed" };
  }
  return { ok: true, studentId, exp, sig };
}

/**
 * What the tracking page tells the reader when there is no position to show.
 *
 * Every one of these is a specific, true sentence. The failure this guards
 * against is a page that says "loading…" forever, or worse, keeps the last
 * fix on screen — a parent driving to where the bus was twenty minutes ago.
 */
export type TrackRefusal =
  | "off-hours"
  | "expired"
  | "bad-link"
  | "no-vehicle"
  | "no-feed"
  | "too-old"
  | "off-trip";

export function trackRefusalText(reason: TrackRefusal): string {
  switch (reason) {
    case "off-hours":
    case "off-trip":
      return "The bus is not on a run right now. Live tracking works while the bus is out — mornings and again at home time.";
    case "expired":
      return "This tracking link has finished. Each link works only for the run it was sent in; the next boarding message brings a fresh one.";
    case "bad-link":
      return "This link is not valid. Please open the link from the school's WhatsApp message.";
    case "no-vehicle":
      return "No bus is assigned to your child at the moment. Please call the transport desk.";
    case "no-feed":
      return "The bus's tracker is not reporting right now, so we cannot show its position. The driver and attendant are still reachable through the school office.";
    case "too-old":
      return "The last position we have is too old to be useful, so we are not showing it. Please call the transport desk if you need to reach the bus.";
    default:
      return "Live tracking is not available right now.";
  }
}
