/**
 * Fleet Edge re-sends events. One rule for every reader that sums them.
 *
 * `details` — TimeBound pushes one per vehicle per 30-minute window, and the
 * SAME (vehicle, window) sometimes arrives again, in bursts: on 5 Oct and
 * 13 Oct 2026 every bus had 50–56 pushes for 47–48 windows, and summing them
 * put the day's km 25–60% over the truth (UP65QT4657 on 13 Oct: 69.4 km
 * summed, 43.5 km once per window).
 *
 * (MAT558053TVG40149's 7,565 details events for 1,874 windows are mostly
 * 5,671 empty stubs — `{vehicleId, registrationNumber}` and nothing else,
 * 14 Aug–11 Sep. They carry no window and add 0 to every sum.)
 *
 * Checked against prod on 14 Oct 2026: of the windows with more than one
 * push, the payloads differ only in `timestamp` (38), `serviceDue` (11),
 * `averageSpeed` (3) and, once each, distanceTravelled (3 → 4 km),
 * harshAccelerationCount and rashTurningCount. A later push is Fleet Edge
 * revising its own window, so the rule is: each (vehicle, window start)
 * counts ONCE, and the copy kept is the LATEST received.
 *
 * The fuel register (PR #628, lib/transportFuelRegister.ts
 * fleetEdgeMonthByVehicle) applies the same "once per (vehicle, window
 * start)" key but keeps the FIRST copy. On today's data the two agree on
 * every window but the handful above; they should converge on this helper
 * once #628 is in main.
 *
 * A details event with no window start (`from`) cannot be matched to a
 * window, so it is kept as its own entry — never merged on a guess.
 *
 * `alert` — the same fault would show as several pushes of one alert. A
 * repeat is the same (vehicle, alertName, eventDateTime); the latest copy
 * is kept. None were found on 14 Oct 2026 (569 alerts, 569 distinct), so
 * this is a guard. An alert without an eventDateTime is never merged.
 */

export type FleetEdgeDedupeInput = {
  id: string;
  event_type: string;
  alert_name: string | null;
  vehicle_ref: string | null;
  registration_number: string | null;
  received_at: string;
  payload: Record<string, unknown> | null | undefined;
};

/** The vehicle a push belongs to: tracker VIN, else plate. */
function vehicleKey(ev: FleetEdgeDedupeInput): string | null {
  const k = (ev.vehicle_ref || ev.registration_number || "").trim();
  return k ? k.toUpperCase() : null;
}

function str(v: unknown): string | null {
  return typeof v === "string" && v.trim() ? v.trim() : null;
}

/**
 * The key two pushes of the same thing share, or null when the event is not
 * a repeatable kind (telemetry) or lacks what would identify it.
 */
export function fleetEdgeRepeatKey(ev: FleetEdgeDedupeInput): string | null {
  const v = vehicleKey(ev);
  if (!v) return null;
  const p = ev.payload ?? {};
  if (ev.event_type === "details") {
    const from = str(p.from);
    return from ? `details|${v}|${from}` : null;
  }
  if (ev.event_type === "alert") {
    const at = str(p.eventDateTime);
    const name = str(ev.alert_name);
    return at && name ? `alert|${v}|${name}|${at}` : null;
  }
  return null;
}

function later(a: FleetEdgeDedupeInput, b: FleetEdgeDedupeInput): boolean {
  if (a.received_at !== b.received_at) return a.received_at > b.received_at;
  return a.id > b.id;
}

/**
 * Drop repeated `details` windows and repeated alerts, keeping the latest
 * received copy of each. Every other event passes through. Order of the
 * survivors is the input order (the kept copy takes the place of the LAST
 * one received, so an ascending feed stays ascending).
 */
export function dedupeFleetEdgeEvents<T extends FleetEdgeDedupeInput>(events: readonly T[]): {
  events: T[];
  dropped: number;
} {
  const latestByKey = new Map<string, T>();
  for (const ev of events) {
    const key = fleetEdgeRepeatKey(ev);
    if (!key) continue;
    const cur = latestByKey.get(key);
    if (!cur || later(ev, cur)) latestByKey.set(key, ev);
  }
  const out: T[] = [];
  for (const ev of events) {
    const key = fleetEdgeRepeatKey(ev);
    if (key && latestByKey.get(key) !== ev) continue;
    out.push(ev);
  }
  return { events: out, dropped: events.length - out.length };
}
