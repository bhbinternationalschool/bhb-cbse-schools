/**
 * Matching Tata Fleet Edge vehicles to the vehicles on the transport desk.
 *
 * The two systems key vehicles differently. Fleet Edge identifies them by VIN
 * (`vehicle_ref`) and carries a registration alongside; the desk stores one
 * `registrationNo` per vehicle. On this fleet, two of the six desk rows were
 * filled in with the VIN rather than the number plate:
 *
 *   MAT558053TVE29204  is really  UP65RT9825
 *   MAT558053TVG40149  is a vehicle Fleet Edge reports as "NA" — not yet registered
 *
 * Matching on registration alone therefore silently dropped a third of the
 * fleet: their telemetry arrived, was stored, and never appeared against a
 * vehicle anyone could see. Match on either key, and say which vehicles could
 * not be matched at all rather than leaving them out of the count.
 *
 * "NA" is treated as no registration, not as a registration spelled "NA" —
 * otherwise two unregistered vehicles would match each other.
 */

export type FleetEdgeVehicleStatus = {
  /** Fleet Edge's own key. The VIN. */
  vin: string;
  registrationNumber: string | null;
  lastSeenAt: string | null;
  lastEventType: string | null;
  detailCount: number;
  alertCount: number;
  telemetryCount: number;
  lastTelemetryAt: string | null;
};

export type FleetEdgeLinkReport<T> = {
  /** Desk vehicle -> its Fleet Edge status, for those that matched. */
  matched: { vehicle: T; status: FleetEdgeVehicleStatus; matchedOn: "registration" | "vin" }[];
  /** On the desk, unknown to Fleet Edge — a van, or a vehicle never subscribed. */
  deskOnly: T[];
  /** Reporting to Fleet Edge, absent from the desk. Someone should add it. */
  edgeOnly: FleetEdgeVehicleStatus[];
};

/** Number plates get typed with spaces, hyphens and mixed case. */
export function normalizeVehicleKey(raw: string | null | undefined): string {
  const s = String(raw ?? "").toUpperCase().replace(/[^A-Z0-9]/g, "");
  // Fleet Edge writes the literal string "NA" when a vehicle has no plate yet.
  // Treating that as a key would match every unregistered vehicle to every
  // other one.
  if (!s || s === "NA" || s === "NIL" || s === "NONE") return "";
  return s;
}

export function linkFleetEdgeToDesk<T>(
  deskVehicles: T[],
  registrationOf: (v: T) => string,
  statuses: FleetEdgeVehicleStatus[],
): FleetEdgeLinkReport<T> {
  const byRegistration = new Map<string, FleetEdgeVehicleStatus>();
  const byVin = new Map<string, FleetEdgeVehicleStatus>();
  for (const s of statuses) {
    const reg = normalizeVehicleKey(s.registrationNumber);
    const vin = normalizeVehicleKey(s.vin);
    if (reg) byRegistration.set(reg, s);
    if (vin) byVin.set(vin, s);
  }

  const matched: FleetEdgeLinkReport<T>["matched"] = [];
  const deskOnly: T[] = [];
  const usedVins = new Set<string>();

  for (const v of deskVehicles) {
    const key = normalizeVehicleKey(registrationOf(v));
    if (!key) {
      deskOnly.push(v);
      continue;
    }
    // Registration first: it is what the office typed on purpose. The VIN
    // match is the fallback that rescues a mis-keyed row.
    const byReg = byRegistration.get(key);
    if (byReg) {
      matched.push({ vehicle: v, status: byReg, matchedOn: "registration" });
      usedVins.add(normalizeVehicleKey(byReg.vin));
      continue;
    }
    const hit = byVin.get(key);
    if (hit) {
      matched.push({ vehicle: v, status: hit, matchedOn: "vin" });
      usedVins.add(normalizeVehicleKey(hit.vin));
      continue;
    }
    deskOnly.push(v);
  }

  const edgeOnly = statuses.filter(
    (s) => !usedVins.has(normalizeVehicleKey(s.vin)),
  );

  return { matched, deskOnly, edgeOnly };
}

/**
 * Is the live telemetry feed actually alive?
 *
 * Tata run two subscriptions: a "TimeBound Push" of periodic summaries, and a
 * "Basic Push" of live telemetry — position, odometer, fuel. Only the first is
 * subscribed on this fleet, so 3 812 summaries have arrived and 4 telemetry
 * rows, none since 14 August.
 *
 * This exists so screens can say that in words. A live map with no dots looks
 * broken; a live map that says the feed was never switched on tells the office
 * what to ask Tata for.
 */
export function telemetryFreshness(
  statuses: FleetEdgeVehicleStatus[],
  nowMs: number,
  staleAfterHours = 6,
): {
  live: boolean;
  vehiclesReporting: number;
  newestAt: string | null;
  reason: string;
} {
  const withTelemetry = statuses.filter((s) => s.telemetryCount > 0);
  const newest = withTelemetry
    .map((s) => s.lastTelemetryAt)
    .filter((x): x is string => Boolean(x))
    .sort()
    .pop() ?? null;

  if (withTelemetry.length === 0) {
    return {
      live: false,
      vehiclesReporting: 0,
      newestAt: null,
      reason:
        "No live telemetry has ever arrived. Fleet Edge is pushing periodic summaries and alerts, but the Basic Push (live position, odometer, fuel) feed has not been subscribed — ask Fleet Edge support to point it at /api/transport/fleet-edge/live.",
    };
  }

  const ageMs = newest ? nowMs - Date.parse(newest) : Number.POSITIVE_INFINITY;
  if (!Number.isFinite(ageMs) || ageMs > staleAfterHours * 3600_000) {
    const days = Number.isFinite(ageMs)
      ? Math.floor(ageMs / 86_400_000)
      : null;
    return {
      live: false,
      vehiclesReporting: withTelemetry.length,
      newestAt: newest,
      reason:
        days != null && days >= 1
          ? `Live telemetry stopped ${days} day${days === 1 ? "" : "s"} ago. Positions shown would be that old, so none are shown.`
          : "Live telemetry has gone quiet in the last few hours, so no position is shown.",
    };
  }

  return {
    live: true,
    vehiclesReporting: withTelemetry.length,
    newestAt: newest,
    reason: "",
  };
}
