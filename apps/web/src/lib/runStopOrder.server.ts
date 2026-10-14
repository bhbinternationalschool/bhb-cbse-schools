import "server-only";

/**
 * Nightly: each run's stop order from the GPS, stored in transport_run_orders;
 * the route's own stop list renumbered to follow the morning pickup.
 * Rules and the "first picked, first dropped" suggestion: lib/runStopOrder.ts.
 *
 * The office's choice of drop order ("gps" = as driven, "fair" = first picked
 * first dropped) lives on the row and is never overwritten by the nightly
 * recompute — only the observed times are.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerTenantContext } from "@/lib/serverTenant";
import { casWriteSlice } from "@/lib/sliceCas.server";
import { rowRev } from "@/lib/sliceRevMerge";
import { readDeskVehicleTrail } from "@/lib/fleetTrail.server";
import { fetchTransportDeskFromDb, deskBundleToTransportState } from "@/lib/transportNormalized.server";
import { TENANT } from "@/lib/types";
import {
  buildRunOrders,
  schoolLegs,
  sequenceByPickup,
  type RunOrder,
  type RunStop,
} from "@/lib/runStopOrder";

const WINDOW_DAYS = 28;

export type StoredRunOrder = RunOrder & {
  id: string;
  chosen: "gps" | "fair";
  chosenBy: string;
  chosenAt: string | null;
  computedAt: string;
};

export const runOrderId = (routeId: string, direction: string, shiftId: string) =>
  `${routeId}:${direction}:${shiftId || "-"}`;

export async function readRunOrders(sb: SupabaseClient, tenantId: string): Promise<{ ok: true; orders: StoredRunOrder[] } | { ok: false; error: string }> {
  const { data, error } = await sb.from("transport_run_orders").select("*").eq("tenant_id", tenantId).limit(500);
  if (error) return { ok: false, error: error.message };
  return {
    ok: true,
    orders: (data ?? []).map((r) => {
      const x = r as Record<string, unknown>;
      return {
        id: String(x.id),
        routeId: String(x.route_id),
        shiftId: String(x.shift_id ?? ""),
        direction: x.direction === "drop" ? "drop" : "pickup",
        stops: (Array.isArray(x.stops) ? x.stops : []) as RunStop[],
        unseenStopIds: (Array.isArray(x.unseen_stop_ids) ? x.unseen_stop_ids : []) as string[],
        legs: Number(x.legs ?? 0),
        returnMinutes: x.return_minutes == null ? null : Number(x.return_minutes),
        returnsToSchoolShare: Number(x.returns_share ?? 0),
        chosen: x.chosen === "fair" ? "fair" : "gps",
        chosenBy: String(x.chosen_by ?? ""),
        chosenAt: x.chosen_at ? String(x.chosen_at) : null,
        computedAt: String(x.computed_at ?? ""),
      };
    }),
  };
}

export type RunOrderTickResult = {
  ok: boolean;
  dryRun: boolean;
  error?: string;
  orders: { route: string; direction: string; shiftId: string; stops: number; unseen: number; legs: number }[];
  resequencedRoutes: string[];
};

export async function runRunOrderTick(opts: { dryRun?: boolean; nowMs?: number } = {}): Promise<RunOrderTickResult> {
  const dryRun = Boolean(opts.dryRun);
  const nowMs = opts.nowMs ?? Date.now();
  const res: RunOrderTickResult = { ok: false, dryRun, orders: [], resequencedRoutes: [] };
  const fail = (error: string) => ({ ...res, ok: false, error });

  const ctx = await getServerTenantContext();
  if (!ctx) return fail("Server tenant context unavailable");
  const { sb, tenantId } = ctx;
  const desk = await fetchTransportDeskFromDb();
  if (!desk.ok) return fail("Could not read the transport desk — nothing was changed");
  const state = deskBundleToTransportState(desk.bundle);

  const trail = await readDeskVehicleTrail(sb, tenantId, state.vehicles, new Date(nowMs - WINDOW_DAYS * 86_400_000).toISOString());
  if (!trail.ok) return fail(`${trail.error} — nothing was changed`);
  const legs = schoolLegs(trail.points, { lat: TENANT.schoolLat, lng: TENANT.schoolLng });

  const all: RunOrder[] = [];
  for (const route of state.routes) {
    if (route.isActive === false || !route.vehicleId) continue;
    const mine = legs.filter((l) => l.vehicleKey === route.vehicleId);
    if (mine.length === 0) continue; // no tracker — nothing observed, nothing stored
    const orders = buildRunOrders({
      routeId: route.id,
      stops: route.stops,
      shifts: (route.shifts ?? []).map((s) => ({ id: s.id, direction: s.direction, departTime: s.departTime, weekdays: s.weekdays, isActive: s.isActive })),
      legs: mine,
    });
    for (const o of orders) {
      all.push(o);
      res.orders.push({ route: route.name, direction: o.direction, shiftId: o.shiftId, stops: o.stops.length, unseen: o.unseenStopIds.length, legs: o.legs });
    }
  }
  if (dryRun) return { ...res, ok: true };

  const now = new Date(nowMs).toISOString();
  if (all.length) {
    // `chosen` is deliberately not in the upsert: the office's choice survives.
    const { error } = await sb.from("transport_run_orders").upsert(
      all.map((o) => ({
        id: runOrderId(o.routeId, o.direction, o.shiftId),
        tenant_id: tenantId,
        route_id: o.routeId,
        shift_id: o.shiftId,
        direction: o.direction,
        stops: o.stops,
        unseen_stop_ids: o.unseenStopIds,
        legs: o.legs,
        return_minutes: o.returnMinutes,
        returns_share: Math.round(o.returnsToSchoolShare * 100) / 100,
        computed_at: now,
        updated_at: now,
      })),
      { onConflict: "id" },
    );
    if (error) return fail(`Could not save run orders: ${error.message}`);
  }

  // The route's stop list follows the morning pickup. Only routes whose order
  // actually changes are written (and get a new _rev).
  const pickupByRoute = new Map(all.filter((o) => o.direction === "pickup").map((o) => [o.routeId, o]));
  if (pickupByRoute.size) {
    const changed: string[] = [];
    const written = await casWriteSlice(sb, "transport_desk_slices", tenantId, "routes", (stored) => {
      changed.length = 0;
      const routes = Array.isArray(stored) ? (stored as Record<string, unknown>[]) : [];
      return routes.map((r) => {
        const pickup = pickupByRoute.get(String(r.id));
        const stops = (Array.isArray(r.stops) ? r.stops : []) as { id: string; sequence: number }[];
        if (!pickup || stops.length === 0) return r;
        const next = sequenceByPickup(stops, pickup);
        const same = next.every((s, i) => {
          const old = stops.find((o) => o.id === s.id);
          return old?.sequence === i + 1;
        });
        if (same) return r;
        changed.push(String(r.name ?? r.id));
        return { ...r, stops: next, _rev: rowRev(r) + 1 };
      });
    });
    if (!written.ok) return fail(`Could not renumber stops: ${written.error}`);
    res.resequencedRoutes = [...changed];
    if (changed.length) {
      await sb.from("transport_desk_sync_meta").update({ last_updated_at: now, updated_at: now }).eq("tenant_id", tenantId);
    }
  }
  return { ...res, ok: true };
}
