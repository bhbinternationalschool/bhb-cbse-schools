/**
 * GET/POST /api/transport/run-orders
 *
 * Each route's runs — morning pickup and every drop run — with the stops in
 * the order the bus reaches them (from GPS, refreshed nightly), the usual
 * time and ride length at each, how many children ride that run from each
 * stop, and the "first picked, first dropped" suggestion for drop runs.
 *
 * POST switches one drop run between "gps" (the order driven today) and
 * "fair" (first picked, first dropped). The driver's manifest follows it.
 * Fees are not involved: order changes who is dropped when, nothing else.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { writeAudit } from "@/lib/audit.server";
import { requestMeta } from "@/lib/api/v1/auth";
import { deskBundleToTransportState, fetchTransportDeskFromDb } from "@/lib/transportNormalized.server";
import { fetchSisFromDb } from "@/lib/sisNormalized.server";
import { fetchMastersDeskFromDb } from "@/lib/mastersNormalized.server";
import type { SisStudent } from "@/lib/sis";
import { resolveRiderShift, strictClassGroup } from "@/lib/transportShifts";
import { readRunOrders } from "@/lib/runStopOrder.server";
import { suggestFairDrop } from "@/lib/runStopOrder";
import { TENANT } from "@/lib/types";

export const runtime = "nodejs";

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;
  const ctx = await getServerTenantContext();
  if (!ctx) return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });

  const [desk, stored, sis, masters] = await Promise.all([
    fetchTransportDeskFromDb(),
    readRunOrders(ctx.sb, ctx.tenantId),
    fetchSisFromDb(),
    fetchMastersDeskFromDb(),
  ]);
  if (!desk.ok) return NextResponse.json({ error: "Could not read the transport desk" }, { status: 502 });
  if (!stored.ok) return NextResponse.json({ error: `Could not read run orders: ${stored.error}` }, { status: 502 });
  const state = deskBundleToTransportState(desk.bundle);

  // Which run each child rides decides the counts. If classes or students
  // cannot be read, counts are unknown (null), not zero.
  const countsKnown = sis.ok && !masters.readFailed;
  const studentById = new Map<string, SisStudent>(((sis.ok ? sis.bundle.students : []) ?? []).map((s) => [s.id, s as SisStudent]));
  const className = new Map<string, string>(((masters.bundle?.classes ?? []) as { id: string; name: string }[]).map((c) => [c.id, c.name]));

  const routes = state.routes
    .filter((r) => r.isActive !== false)
    .map((route) => {
      const vehicle = state.vehicles.find((v) => v.id === route.vehicleId);
      const riders = state.assignments.filter((a) => a.routeId === route.id && a.effectiveTo == null && !a.boardingSuspended);
      const stopById = new Map(route.stops.map((s) => [s.id, s]));
      const countFor = (direction: "pickup" | "drop", shiftId: string): Map<string, number> | null => {
        if (!countsKnown) return null;
        const m = new Map<string, number>();
        for (const a of riders) {
          if (direction === "pickup" && a.serviceMode === "drop") continue;
          if (direction === "drop" && a.serviceMode === "pickup") continue;
          if (shiftId) {
            const st = studentById.get(a.studentId);
            const cls = st?.classId ? className.get(st.classId) : undefined;
            const res = resolveRiderShift({
              route,
              direction,
              overrideShiftId: direction === "pickup" ? a.pickupShiftId : a.dropShiftId,
              groupCode: cls ? strictClassGroup(cls) : null,
            });
            if (res.shift?.id !== shiftId) continue;
          }
          m.set(a.stopId, (m.get(a.stopId) ?? 0) + 1);
        }
        return m;
      };
      const mine = stored.orders.filter((o) => o.routeId === route.id);
      const pickup = mine.find((o) => o.direction === "pickup");
      const runs = mine
        .sort((a, b) => (a.direction === b.direction ? 0 : a.direction === "pickup" ? -1 : 1))
        .map((o) => {
          const shift = route.shifts.find((s) => s.id === o.shiftId);
          const counts = countFor(o.direction, o.shiftId);
          const stopPoints = new Map(
            route.stops
              .filter((s) => Number.isFinite(s.geoLat) && Number.isFinite(s.geoLng))
              .map((s) => [s.id, { lat: Number(s.geoLat), lng: Number(s.geoLng) }]),
          );
          const suggestion =
            o.direction === "drop" && pickup
              ? counts
                ? suggestFairDrop({ pickup, drop: o, ridersByStop: counts, stopPoints, school: { lat: TENANT.schoolLat, lng: TENANT.schoolLng } })
                : { suggested: false as const, reason: "Classes could not be read, so who rides this run is unknown." }
              : null;
          return {
            id: o.id,
            direction: o.direction,
            shiftId: o.shiftId,
            shiftName: shift?.name ?? (o.direction === "pickup" ? "Pick-up" : "Drop"),
            departTime: shift?.departTime ?? "",
            chosen: o.chosen,
            chosenBy: o.chosenBy,
            chosenAt: o.chosenAt,
            legs: o.legs,
            computedAt: o.computedAt,
            stops: o.stops.map((s) => ({
              ...s,
              name: stopById.get(s.stopId)?.name ?? "(stop removed)",
              riders: counts ? (counts.get(s.stopId) ?? 0) : null,
            })),
            unseen: o.unseenStopIds
              .filter((id) => stopById.has(id))
              .map((id) => ({ stopId: id, name: stopById.get(id)!.name, riders: counts ? (counts.get(id) ?? 0) : null })),
            suggestion,
          };
        });
      return { routeId: route.id, name: route.name, vehicle: vehicle?.name ?? "", runs };
    })
    .filter((r) => r.runs.length > 0);

  return NextResponse.json({ routes, countsKnown });
}

export async function POST(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "edit");
  if (!auth.ok) return auth.response;
  let body: { id?: unknown; chosen?: unknown };
  try {
    body = (await req.json()) as typeof body;
  } catch {
    return NextResponse.json({ error: "Invalid JSON" }, { status: 400 });
  }
  const id = typeof body.id === "string" ? body.id.trim() : "";
  const chosen = body.chosen === "fair" ? "fair" : body.chosen === "gps" ? "gps" : null;
  if (!id || !chosen) return NextResponse.json({ error: "id and chosen (gps | fair) are required" }, { status: 400 });
  const ctx = await getServerTenantContext();
  if (!ctx) return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });

  const by = auth.ctx.session.fullName || auth.ctx.session.email || "";
  const now = new Date().toISOString();
  const { data, error } = await ctx.sb
    .from("transport_run_orders")
    .update({ chosen, chosen_by: by, chosen_at: now, updated_at: now })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", id)
    .eq("direction", "drop")
    .select("id")
    .maybeSingle();
  if (error) return NextResponse.json({ error: error.message }, { status: 502 });
  if (!data) return NextResponse.json({ error: "No such drop run" }, { status: 404 });

  const meta = requestMeta(req);
  await writeAudit({
    session: auth.ctx.session,
    module: "transport",
    action: "run_order_chosen",
    entityType: "transport_run",
    entityId: id,
    summary: chosen === "fair" ? "Drop run set to first picked, first dropped" : "Drop run set back to the order driven",
    after: { chosen },
    ip: meta.ip,
    userAgent: meta.userAgent,
  });
  return NextResponse.json({ ok: true });
}
