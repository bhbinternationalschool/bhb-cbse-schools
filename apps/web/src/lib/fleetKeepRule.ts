/**
 * Which bus positions the school keeps.
 *
 * The director's rule (15 Sep 2026): keep everything from 6:00 AM to 3:30 PM
 * IST — the transport day — and after that only while a vehicle is moving.
 *
 * Tata Fleet Edge pushes a position about every 22 seconds around the clock,
 * parked buses included. In the week to 15 Sep, 12,472 positions arrived
 * outside the transport day and 32 of them were moving: the rest were five
 * parked buses reporting the same spot all night, and every one of them woke
 * the server.
 *
 * MOVING
 * Speed of 5 km/h or more. Below that a stationary tracker's GPS drift reads
 * as 1–3 km/h. An ignition change (engine started or switched off) is also
 * kept, so a bus started at night is on record from its first moment and a
 * night trip ends with where the bus was parked.
 *
 * Alerts (SOS, harsh braking…) and the periodic trip details are not
 * positions and are always kept; this rule covers telemetry only.
 */

export const TRANSPORT_DAY_START_MIN = 6 * 60; // 06:00 IST
export const TRANSPORT_DAY_END_MIN = 15 * 60 + 30; // 15:30 IST
export const MOVING_KMH = 5;

/** Minutes since midnight in India for an instant. */
export function istMinuteOfDay(at: Date): number {
  const ist = new Date(at.getTime() + 5.5 * 3_600_000);
  return ist.getUTCHours() * 60 + ist.getUTCMinutes();
}

export function inTransportDay(at: Date): boolean {
  const m = istMinuteOfDay(at);
  return m >= TRANSPORT_DAY_START_MIN && m < TRANSPORT_DAY_END_MIN;
}

export type KeepDecision = { keep: boolean; reason: "transport_day" | "moving" | "ignition_changed" | "parked_after_hours" };

export function shouldKeepTelemetry(input: {
  at: Date;
  speedKmh: number | null | undefined;
  ignitionOn: boolean | null | undefined;
  /** The ignition state last seen for this vehicle, if this server has seen one. */
  lastIgnitionOn?: boolean | null;
}): KeepDecision {
  if (inTransportDay(input.at)) return { keep: true, reason: "transport_day" };
  if ((input.speedKmh ?? 0) >= MOVING_KMH) return { keep: true, reason: "moving" };
  if (
    input.ignitionOn != null &&
    input.lastIgnitionOn != null &&
    input.ignitionOn !== input.lastIgnitionOn
  ) {
    return { keep: true, reason: "ignition_changed" };
  }
  return { keep: false, reason: "parked_after_hours" };
}
