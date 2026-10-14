import "server-only";

/**
 * The buses' GPS trail, keyed by the desk's own vehicle id.
 *
 * Fleet Edge identifies a bus by VIN and plate; the desk holds a plate for
 * some vehicles and a VIN for others, so both are tried. Tata's placeholder
 * vehicle (XXXX…) and anything not on the fleet list are dropped. A read that
 * hit the page cap is an error, never a shorter trail: a cut-off history
 * makes every stop look rarer and every run look shorter than it is.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { fetchAllPages } from "@/lib/supabase/pageAll";
import { normalizeVehicleKey } from "@/lib/fleetEdgeLink";
import type { FleetVehicle } from "@/lib/transport";

export type DeskTrailPoint = { vehicleKey: string; at: string; lat: number; lng: number; speedKmh: number | null };

export async function readDeskVehicleTrail(
  sb: SupabaseClient,
  tenantId: string,
  vehicles: FleetVehicle[],
  sinceIso: string,
): Promise<{ ok: true; points: DeskTrailPoint[] } | { ok: false; error: string }> {
  const trail = await fetchAllPages<{
    vehicle_ref: string | null;
    registration_number: string | null;
    recorded_at: string;
    lat: number;
    lng: number;
    speed_kmh: number | null;
  }>((from, to) =>
    sb
      .from("fleet_vehicle_positions")
      .select("vehicle_ref, registration_number, recorded_at, lat, lng, speed_kmh")
      .eq("tenant_id", tenantId)
      .gte("recorded_at", sinceIso)
      .order("recorded_at", { ascending: true })
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (trail.error) return { ok: false, error: `Could not read bus positions: ${trail.error}` };
  if (trail.truncated) return { ok: false, error: "Bus position history hit the read cap" };

  const byKey = new Map<string, FleetVehicle>();
  for (const v of vehicles) {
    if (v.isActive === false) continue;
    const k = normalizeVehicleKey(v.registrationNo);
    if (k) byKey.set(k, v);
  }
  const points: DeskTrailPoint[] = [];
  for (const r of trail.rows) {
    if (/XXXX/i.test(`${r.vehicle_ref ?? ""}${r.registration_number ?? ""}`)) continue;
    const v = byKey.get(normalizeVehicleKey(r.vehicle_ref)) ?? byKey.get(normalizeVehicleKey(r.registration_number));
    if (!v) continue;
    points.push({ vehicleKey: v.id, at: r.recorded_at, lat: Number(r.lat), lng: Number(r.lng), speedKmh: r.speed_kmh });
  }
  return { ok: true, points };
}

/** Is this desk vehicle one the trackers report for? */
export function vehicleHasTracker(points: DeskTrailPoint[], vehicleId: string): boolean {
  return points.some((p) => p.vehicleKey === vehicleId);
}
