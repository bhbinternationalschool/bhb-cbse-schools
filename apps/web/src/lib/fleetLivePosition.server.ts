/**
 * The latest known position of each vehicle (server-only).
 *
 * One bounded read, not the full report build. `buildFleetEdgeReport` pages
 * through up to 50 000 events to produce a dashboard; a "where is the bus"
 * answer needs the newest row per vehicle and nothing else, and will be asked
 * for repeatedly.
 */
import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  parseTelemetryPosition,
  type LivePosition,
  type TelemetryPayload,
} from "@/lib/fleetLivePosition";

/**
 * How far back to look. A vehicle silent longer than this has no position
 * worth reporting — every consumer would classify it "cold" anyway, and
 * saying "no recent fix" is more honest than handing over a two-hour-old one.
 */
export const LIVE_LOOKBACK_MS = 2 * 60 * 60 * 1000;

/**
 * PostgREST caps a response at 1 000 rows. Ordered newest-first that is ample
 * for six vehicles pushing every ~30s — the newest row for each is inside the
 * first few. A vehicle that has been silent while others flooded the window
 * could fall off the end, and would be reported as having no fix, which is
 * the same answer the freshness bands would give it.
 */
const MAX_ROWS = 1000;

export type VehicleLivePosition = {
  /** Fleet Edge's key — the VIN/chassis. */
  vehicleRef: string;
  /** As last reported; "NA" until the vehicle is registered in their portal. */
  registrationNumber: string | null;
  position: LivePosition;
};

export async function readLiveVehiclePositions(): Promise<
  { ok: true; positions: VehicleLivePosition[] } | { ok: false; error: string }
> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };
  const { sb, tenantId } = ctx;

  const since = new Date(Date.now() - LIVE_LOOKBACK_MS).toISOString();
  const { data, error } = await sb
    .from("fleet_edge_events")
    .select("vehicle_ref, registration_number, received_at, payload")
    .eq("tenant_id", tenantId)
    .eq("event_type", "telemetry")
    .gte("received_at", since)
    .order("received_at", { ascending: false })
    .limit(MAX_ROWS);

  if (error) return { ok: false, error: error.message };

  const rows = (data || []) as {
    vehicle_ref: string | null;
    registration_number: string | null;
    received_at: string;
    payload: TelemetryPayload | null;
  }[];

  // Newest first, so the first usable row per vehicle wins. A vehicle whose
  // newest ping has no GPS fix keeps looking down its own history rather than
  // being reported as absent — a lost fix is usually momentary.
  const out = new Map<string, VehicleLivePosition>();
  for (const r of rows) {
    const ref = (r.vehicle_ref || "").trim();
    if (!ref || out.has(ref)) continue;
    const position = parseTelemetryPosition(r.payload, r.received_at);
    if (!position) continue;
    out.set(ref, {
      vehicleRef: ref,
      // "NA" is Fleet Edge's placeholder, not a plate. Treat it as unknown so
      // callers do not print it at a parent.
      registrationNumber:
        r.registration_number && r.registration_number !== "NA"
          ? r.registration_number
          : null,
      position,
    });
  }

  return { ok: true, positions: [...out.values()] };
}
