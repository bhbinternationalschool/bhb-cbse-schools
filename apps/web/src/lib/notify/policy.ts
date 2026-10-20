/**
 * Whether one stored notification also goes to the person's phone, and with
 * which sound. Pure.
 *
 *   duplicate     the event was stored before          → no push
 *   grouped       folded into an unread burst row      → no push (the first rang)
 *   muted topic   the person muted it (not urgent)     → no push, still in the bell
 *   quiet hours   inside them (not urgent)             → no push, still in the bell
 *   otherwise     push: the topic's spoken line (the language is the
 *                 person's — lib/fcm.server.ts), or the phone's normal sound
 *                 (channel bhb_default) when the person turned voice off
 */
import type { NotifyPrefs, NotifyTopic } from "./kinds";

export const PLAIN_CHANNEL = "bhb_default";

export type DeliverOutcome = "inserted" | "grouped" | "duplicate";

export type PushDecision =
  | { push: true; voice: boolean }
  | { push: false; reason: "duplicate" | "grouped" | "muted" | "quiet" };

/** Minutes since midnight, India time (UTC+5:30, no DST). */
export function istMinutes(nowMs: number): number {
  const m = Math.floor(nowMs / 60_000) + 330;
  return ((m % 1440) + 1440) % 1440;
}

function minutesOf(hhmm: string): number {
  const [h, m] = hhmm.split(":").map(Number);
  return (h ?? 0) * 60 + (m ?? 0);
}

/** Inside the quiet window? A window that crosses midnight (21:00–07:00) is handled; start = end means none. */
export function inQuietHours(prefs: Pick<NotifyPrefs, "quietEnabled" | "quietStart" | "quietEnd">, nowMs: number): boolean {
  if (!prefs.quietEnabled) return false;
  const s = minutesOf(prefs.quietStart);
  const e = minutesOf(prefs.quietEnd);
  if (s === e) return false;
  const m = istMinutes(nowMs);
  return s < e ? m >= s && m < e : m >= s || m < e;
}

export function decidePush(input: {
  outcome: DeliverOutcome;
  topic: NotifyTopic;
  urgent: boolean;
  prefs: NotifyPrefs;
  nowMs: number;
}): PushDecision {
  if (input.outcome === "duplicate") return { push: false, reason: "duplicate" };
  if (input.outcome === "grouped") return { push: false, reason: "grouped" };
  if (!input.urgent && input.prefs.mutedTopics.includes(input.topic)) return { push: false, reason: "muted" };
  if (!input.urgent && inQuietHours(input.prefs, input.nowMs)) return { push: false, reason: "quiet" };
  return { push: true, voice: input.prefs.voice };
}
