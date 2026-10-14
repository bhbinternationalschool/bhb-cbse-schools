import "server-only";

/**
 * The transport audit run (nightly; route orders weekly on Mondays).
 * Rules: lib/transportAudit.ts. Writes suggestions and road alerts into
 * transport_desk_gaps — the office's "Gaps to settle" list — with an
 * `action` for one-tap buttons, carried out by /api/transport/gaps/act.
 *
 * Ids are stable, so a suggestion the office dismissed is never raised again;
 * a suggestion that no longer applies (the child was moved by hand, the bus
 * reaches the stop again) is closed automatically with a note.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import { readDeskVehicleTrail } from "@/lib/fleetTrail.server";
import { readRunOrders, type StoredRunOrder } from "@/lib/runStopOrder.server";
import { fetchTransportDeskFromDb, deskBundleToTransportState } from "@/lib/transportNormalized.server";
import { fetchSisFromDb } from "@/lib/sisNormalized.server";
import { expectedMonthlyFeePaise } from "@/lib/transport";
import { schoolLegs } from "@/lib/runStopOrder";
import { detectRoadAlerts, fuelRupeesPerKm, suggestMoves, type AuditRider, type AuditRoute } from "@/lib/transportAudit";
import { loadServerMasters } from "@/lib/api/v1/auth";
import { inferStaffIsOwner } from "@/lib/waRoleResolver";
import { sendPushToSubject } from "@/lib/webPush.server";
import { TENANT } from "@/lib/types";

const SOURCE = "transport-audit";
const rupees = (paise: number) => `₹${Math.round(paise / 100).toLocaleString("en-IN")}`;

type GapRow = {
  id: string;
  kind: "suggestion" | "road_alert";
  vehicle: string;
  route_id: string;
  stop_id: string;
  student_id: string;
  title: string;
  detail: string;
  action: Record<string, unknown> | null;
};

type Directions = { km: number; minutes: number; order: number[] } | null;

async function directions(
  stops: { lat: number; lng: number }[],
  optimize: boolean,
  key: string,
): Promise<Directions> {
  const u = new URL("https://maps.googleapis.com/maps/api/directions/json");
  const school = `${TENANT.schoolLat},${TENANT.schoolLng}`;
  u.searchParams.set("origin", school);
  u.searchParams.set("destination", school);
  u.searchParams.set("waypoints", `${optimize ? "optimize:true|" : ""}${stops.map((s) => `${s.lat},${s.lng}`).join("|")}`);
  u.searchParams.set("mode", "driving");
  u.searchParams.set("key", key);
  try {
    const res = await fetch(u, { signal: AbortSignal.timeout(20_000) });
    const body = (await res.json()) as {
      status: string;
      routes?: { waypoint_order?: number[]; legs: { distance: { value: number }; duration: { value: number } }[] }[];
    };
    const r = body.routes?.[0];
    if (body.status !== "OK" || !r) return null;
    return {
      km: r.legs.reduce((s, l) => s + l.distance.value, 0) / 1000,
      minutes: r.legs.reduce((s, l) => s + l.duration.value, 0) / 60,
      order: r.waypoint_order ?? stops.map((_, i) => i),
    };
  } catch {
    return null;
  }
}

export type TransportAuditResult = {
  ok: boolean;
  dryRun: boolean;
  error?: string;
  moves: number;
  roadAlerts: number;
  routeOrders: number;
  closed: number;
  newItems: number;
  rows: { id: string; title: string }[];
};

export async function runTransportAudit(opts: { dryRun?: boolean; withRouteOrders?: boolean; nowMs?: number } = {}): Promise<TransportAuditResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const res: TransportAuditResult = { ok: false, dryRun: Boolean(opts.dryRun), moves: 0, roadAlerts: 0, routeOrders: 0, closed: 0, newItems: 0, rows: [] };
  const fail = (error: string) => ({ ...res, ok: false, error });
  const ctx = await getServerTenantContext();
  if (!ctx) return fail("Server tenant context unavailable");
  const { sb, tenantId } = ctx;

  const [desk, sis, orders, pinsRes] = await Promise.all([
    fetchTransportDeskFromDb(),
    fetchSisFromDb(),
    readRunOrders(sb, tenantId),
    sb.from("sis_student_transport_point").select("student_id, latitude, longitude").eq("tenant_id", tenantId),
  ]);
  if (!desk.ok) return fail("Could not read the transport desk");
  if (!orders.ok) return fail(`Could not read run orders: ${orders.error}`);
  if (pinsRes.error) return fail(`Could not read home pins: ${pinsRes.error.message}`);
  const state = deskBundleToTransportState(desk.bundle);
  const trail = await readDeskVehicleTrail(sb, tenantId, state.vehicles, new Date(nowMs - 28 * 86_400_000).toISOString());
  if (!trail.ok) return fail(trail.error);
  const legs = schoolLegs(trail.points, { lat: TENANT.schoolLat, lng: TENANT.schoolLng });

  const names = new Map(((sis.ok ? sis.bundle.students : []) ?? []).map((s) => [s.id, (s as { fullName?: string }).fullName ?? ""]));
  const vehicleName = (vid: string) => state.vehicles.find((v) => v.id === vid)?.name ?? "";
  const activeRoutes = state.routes.filter((r) => r.isActive !== false);
  const auditRoutes: AuditRoute[] = activeRoutes.map((r) => ({
    id: r.id,
    name: r.name,
    vehicleName: vehicleName(r.vehicleId) || r.name,
    stops: r.stops.map((s) => ({ id: s.id, name: s.name, geoLat: s.geoLat, geoLng: s.geoLng })),
  }));
  const open = state.assignments.filter((a) => a.effectiveTo == null && !a.boardingSuspended);
  const riders: AuditRider[] = open.map((a) => {
    const route = activeRoutes.find((r) => r.id === a.routeId);
    const stop = route?.stops.find((s) => s.id === a.stopId);
    const fee =
      a.monthlyFeePaise > 0 ? a.monthlyFeePaise : route && stop ? expectedMonthlyFeePaise(route, stop, state.feePolicy) : 0;
    return {
      assignmentId: a.id,
      studentId: a.studentId,
      studentName: names.get(a.studentId) || a.studentId,
      householdId: a.householdId ?? "",
      routeId: a.routeId,
      stopId: a.stopId,
      feePaise: fee > 0 ? fee : null,
    };
  });
  const pins = new Map(
    (pinsRes.data ?? [])
      .map((p) => p as { student_id: string; latitude: number | null; longitude: number | null })
      .filter((p) => Number.isFinite(p.latitude) && Number.isFinite(p.longitude))
      .map((p) => [p.student_id, { lat: Number(p.latitude), lng: Number(p.longitude) }]),
  );
  const pickupOrders = new Map<string, StoredRunOrder>(orders.orders.filter((o) => o.direction === "pickup").map((o) => [o.routeId, o]));

  const rows: GapRow[] = [];

  // 1. Move a child.
  for (const m of suggestMoves({ routes: auditRoutes, riders, pickupOrders, pins })) {
    const fromRoute = auditRoutes.find((r) => r.id === m.fromRouteId);
    const fromStop = fromRoute?.stops.find((s) => s.id === m.fromStopId);
    const why = !m.reachedNow
      ? `${fromRoute?.vehicleName ?? "Their bus"} does not reach their stop ${fromStop?.name ?? ""} on its morning run.`
      : `Their stop ${fromStop?.name ?? ""} is ${m.metresFromHomeNow} m from where they wait for the bus (their boarding pin).`;
    rows.push({
      id: m.id,
      kind: "suggestion",
      vehicle: m.toVehicle,
      route_id: m.toRouteId,
      stop_id: m.toStopId,
      student_id: m.studentId,
      title: m.sameBus
        ? `${m.studentName}: board at ${m.toStopName}`
        : `${m.studentName}: switch to ${m.toVehicle} at ${m.toStopName}`,
      detail:
        `${why} ${m.toVehicle} stops at ${m.toStopName} every morning, ${m.metresFromHome <= 30 ? "right at" : `${m.metresFromHome} m from`} the child's boarding pin` +
        (m.siblingOnBus ? ", and a brother or sister already rides it." : ".") +
        (m.feePaise != null
          ? ` The fee stays ${rupees(m.feePaise)} a month. Tell the family and both drivers before moving.`
          : " Their fee today cannot be worked out (stop not priced, no fixed fee) — price it first; no button until then."),
      action:
        m.feePaise != null
          ? {
              type: "move_rider",
              label: m.sameBus ? `Move to ${m.toStopName}` : `Switch to ${m.toVehicle} · ${m.toStopName}`,
              assignmentId: m.assignmentId,
              fromRouteId: m.fromRouteId,
              fromStopId: m.fromStopId,
              toRouteId: m.toRouteId,
              toStopId: m.toStopId,
              keepFeePaise: m.feePaise,
            }
          : null,
    });
    res.moves += 1;
  }

  // 2. Road alerts.
  for (const route of activeRoutes) {
    const mine = legs.filter((l) => l.vehicleKey === route.vehicleId);
    if (!mine.length) continue;
    const withRiders = new Set(open.filter((a) => a.routeId === route.id).map((a) => a.stopId));
    for (const al of detectRoadAlerts({
      routeId: route.id,
      stops: route.stops.map((s) => ({ id: s.id, name: s.name, geoLat: s.geoLat, geoLng: s.geoLng })),
      stopsWithRiders: withRiders,
      shifts: route.shifts.map((s) => ({ id: s.id, direction: s.direction, departTime: s.departTime, weekdays: s.weekdays, isActive: s.isActive })),
      legs: mine,
    })) {
      const shift = route.shifts.find((s) => s.id === al.shiftId);
      const runName = `${al.direction === "pickup" ? "pick-up" : "drop"}${shift ? ` (${shift.name} ${shift.departTime})` : ""}`;
      rows.push({
        id: al.id,
        kind: "road_alert",
        vehicle: vehicleName(route.vehicleId) || route.name,
        route_id: route.id,
        stop_id: al.stopId,
        student_id: "",
        title:
          al.kind === "stop_dropped"
            ? `${vehicleName(route.vehicleId) || route.name}: ${route.stops.find((s) => s.id === al.stopId)?.name ?? "a stop"} not reached since ${al.since} (${runName})`
            : `${vehicleName(route.vehicleId) || route.name}: ${runName} running much longer since ${al.since}`,
        detail: `${al.detail} This clears itself when the bus is back on its usual road.`,
        action: null,
      });
      res.roadAlerts += 1;
    }
  }

  // 3. Shorter order for a run (weekly; costs Google Directions calls).
  const mapsKey = process.env.GOOGLE_MAPS_API_KEY?.trim() || "";
  if (opts.withRouteOrders && mapsKey) {
    for (const o of orders.orders) {
      const loop = o.direction === "drop" ? o.returnsToSchoolShare >= 0.6 : o.startsAtSchoolShare >= 0.6;
      if (!loop) continue;
      const route = activeRoutes.find((r) => r.id === o.routeId);
      if (!route) continue;
      const used = new Set(open.filter((a) => a.routeId === route.id).map((a) => a.stopId));
      const seq = o.stops
        .map((s) => route.stops.find((x) => x.id === s.stopId))
        .filter((s): s is NonNullable<typeof s> => !!s && used.has(s.id) && Number.isFinite(s.geoLat) && Number.isFinite(s.geoLng));
      if (seq.length < 3 || seq.length > 23) continue;
      const pts = seq.map((s) => ({ lat: Number(s.geoLat), lng: Number(s.geoLng) }));
      const now = await directions(pts, false, mapsKey);
      const best = await directions(pts, true, mapsKey);
      if (!now || !best) continue;
      const kmSaved = now.km - best.km;
      const minSaved = now.minutes - best.minutes;
      if (kmSaved < 1 && minSaved < 4) continue;
      const order = best.order.map((i) => seq[i]!.id);
      const vehicle = state.vehicles.find((v) => v.id === route.vehicleId);
      const fuel = fuelRupeesPerKm(vehicle?.fuelType ?? "diesel");
      const shift = route.shifts.find((s) => s.id === o.shiftId);
      const runsPerMonth = Math.round((shift?.weekdays.length || 6) * 4.3);
      const monthly = Math.max(0, kmSaved) * fuel.perKm * runsPerMonth;
      const runName = `${o.direction === "pickup" ? "pick-up" : "drop"}${shift ? ` ${shift.name} ${shift.departTime}` : ""}`;
      rows.push({
        id: `sug:order:${o.id}:${order.join(",")}`.slice(0, 500),
        kind: "suggestion",
        vehicle: vehicle?.name ?? route.name,
        route_id: route.id,
        stop_id: "",
        student_id: "",
        title: `${vehicle?.name ?? route.name} ${runName}: shorter order saves ~${kmSaved.toFixed(1)} km, ~${Math.round(minSaved)} min a run`,
        detail:
          `Google's best order for the ${seq.length} stops with children: ${order.map((id) => route.stops.find((s) => s.id === id)?.name).join(" → ")}. ` +
          `Today's order measures ${now.km.toFixed(1)} km / ${Math.round(now.minutes)} min on the same roads; this one ${best.km.toFixed(1)} km / ${Math.round(best.minutes)} min. ` +
          `About ${rupees(monthly * 100)} of fuel a month over ${runsPerMonth} runs (estimate: ${fuel.basis}). It changes who is collected or dropped first — check with the driver.`,
        action: { type: "use_run_order", label: "Use this order on the driver's list", runOrderId: o.id, order },
      });
      res.routeOrders += 1;
    }
  }

  res.rows = rows.map((r) => ({ id: r.id, title: r.title }));
  if (opts.dryRun) return { ...res, ok: true };

  // Write: new rows only (a dismissed id stays dismissed); close what no longer applies.
  const nowIso = new Date(nowMs).toISOString();
  const { data: existing, error: exErr } = await sb
    .from("transport_desk_gaps")
    .select("id, status, kind")
    .eq("tenant_id", tenantId)
    .eq("source", SOURCE);
  if (exErr) return fail(`Could not read earlier audit items: ${exErr.message}`);
  const known = new Set((existing ?? []).map((r) => (r as { id: string }).id));
  const fresh = rows.filter((r) => !known.has(r.id));
  if (fresh.length) {
    const { error } = await sb.from("transport_desk_gaps").insert(
      fresh.map((r) => ({ ...r, tenant_id: tenantId, source: SOURCE, status: "open", found_at: nowIso, updated_at: nowIso })),
    );
    if (error) return fail(`Could not save audit items: ${error.message}`);
  }
  res.newItems = fresh.length;
  // Weekly-only items are not re-derived on other nights, so only close the kinds this run checked.
  const current = new Set(rows.map((r) => r.id));
  const stale = (existing ?? [])
    .map((r) => r as { id: string; status: string; kind: string })
    .filter((r) => r.status === "open" && !current.has(r.id))
    .filter((r) => opts.withRouteOrders || !r.id.startsWith("sug:order:"));
  for (const r of stale) {
    await sb
      .from("transport_desk_gaps")
      .update({
        status: "settled",
        settled_at: nowIso,
        settled_by: "Transport audit",
        settle_note: r.kind === "road_alert" ? `Back to normal by ${nowIso.slice(0, 10)}.` : "No longer applies — the record or the route changed.",
        updated_at: nowIso,
      })
      .eq("tenant_id", tenantId)
      .eq("id", r.id);
  }
  res.closed = stale.length;

  // Tell management once per run, only when there is something new.
  if (fresh.length) {
    const masters = await loadServerMasters();
    const owners = (masters.staff ?? []).filter((s) => s.status === "active" && inferStaffIsOwner(s, masters.designations ?? []));
    const roads = fresh.filter((r) => r.kind === "road_alert").length;
    const sugg = fresh.length - roads;
    const body = [sugg ? `${sugg} new suggestion${sugg === 1 ? "" : "s"}` : "", roads ? `${roads} possible road closure${roads === 1 ? "" : "s"}` : ""].filter(Boolean).join(" · ");
    for (const s of owners) {
      await sendPushToSubject("staff", s.id, { title: "Transport audit", body, url: "/transport?tab=planner", data: { kind: "transport_audit" } }).catch(() => null);
    }
  }
  return { ...res, ok: true };
}
