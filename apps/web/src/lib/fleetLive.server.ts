/**
 * Live buses — the data half: latest positions from fleet_vehicle_positions,
 * joined to the transport desk's vehicles and routes; the parent's view of
 * one child's bus; and the owner alert tick. Rules live in fleetLive.ts.
 */
import "server-only";
import { loadServerMasters } from "@/lib/api/v1/auth";
import {
  ageSeconds,
  estimateEtaMinutes,
  evaluateFleetAlerts,
  haversineKm,
  istClock,
  positionForVehicle,
  positionFreshness,
  renderFleetAlertText,
  tripPhase,
  DEFAULT_FLEET_ALERT_SETTINGS,
  type FleetAlert,
  type LivePosition,
  type PositionFreshness,
  type TripPhase,
} from "@/lib/fleetLive";
import { getServerTenantContext } from "@/lib/serverTenant";
import type { TransportRoute, FleetVehicle } from "@/lib/transport";
import { fetchTransportDeskFromDb } from "@/lib/transportNormalized.server";
import { TENANT } from "@/lib/types";
import { inferStaffIsOwner } from "@/lib/waRoleResolver";
import { buildWaTemplateBodyComponent, sendWaWithFailover } from "@/lib/waSend";
import { normalizeWaTemplatesState, resolveTemplateForSend, templateVariablePositions, type WaTemplatesState } from "@/lib/waTemplates";
import { fetchServerBlob } from "@/lib/serverBlob";
import { sendPushToSubject } from "@/lib/webPush.server";

type PositionRow = {
  vehicle_ref: string;
  registration_number: string | null;
  recorded_at: string;
  lat: number;
  lng: number;
  speed_kmh: number | null;
  course_deg: number | null;
  ignition_on: boolean | null;
  fuel_percent: number | null;
  odometer_km: number | null;
};

function rowToPosition(r: PositionRow): LivePosition {
  return {
    vehicleRef: r.vehicle_ref,
    registrationNumber: r.registration_number,
    recordedAt: r.recorded_at,
    lat: Number(r.lat),
    lng: Number(r.lng),
    speedKmh: r.speed_kmh == null ? null : Number(r.speed_kmh),
    courseDeg: r.course_deg == null ? null : Number(r.course_deg),
    ignitionOn: r.ignition_on,
    fuelPercent: r.fuel_percent == null ? null : Number(r.fuel_percent),
    odometerKm: r.odometer_km == null ? null : Number(r.odometer_km),
  };
}

/** Latest position per tracker. Empty when nothing has ever reported. */
export async function readLatestPositions(): Promise<LivePosition[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const { data, error } = await ctx.sb.rpc("fleet_latest_positions", { p_tenant_id: ctx.tenantId });
  if (error) {
    console.warn("[fleetLive] latest positions failed", error.message);
    return [];
  }
  return ((data ?? []) as PositionRow[]).map(rowToPosition);
}

/** A vehicle's track for the last N minutes, oldest first — for the trail on the map. */
export async function readVehicleTrack(vehicleRef: string, minutes = 60): Promise<LivePosition[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const since = new Date(Date.now() - minutes * 60_000).toISOString();
  const { data, error } = await ctx.sb
    .from("fleet_vehicle_positions")
    .select("vehicle_ref, registration_number, recorded_at, lat, lng, speed_kmh, course_deg, ignition_on, fuel_percent, odometer_km")
    .eq("tenant_id", ctx.tenantId)
    .eq("vehicle_ref", vehicleRef)
    .gte("recorded_at", since)
    .order("recorded_at", { ascending: true })
    .limit(500);
  if (error) return [];
  return ((data ?? []) as PositionRow[]).map(rowToPosition);
}

export type LiveBus = {
  vehicleId: string;
  name: string;
  registrationNo: string;
  routeId: string | null;
  routeName: string | null;
  busNo: string | null;
  tracked: boolean;
  position: (LivePosition & { ageSec: number; freshness: PositionFreshness }) | null;
};

/** Every active vehicle with its latest position, tracked or not. */
export async function buildLiveFleet(nowMs = Date.now()): Promise<{ buses: LiveBus[]; phase: TripPhase; school: { lat: number; lng: number } }> {
  const [{ bundle }, positions] = await Promise.all([fetchTransportDeskFromDb(), readLatestPositions()]);
  const routeByVehicle = new Map<string, TransportRoute>();
  for (const r of bundle.routes) if (r.vehicleId) routeByVehicle.set(r.vehicleId, r);
  const buses: LiveBus[] = bundle.vehicles
    .filter((v) => v.isActive && v.status === "active")
    .map((v) => {
      const route = routeByVehicle.get(v.id) ?? bundle.routes.find((r) => r.id === v.primaryRouteId) ?? null;
      const pos = positionForVehicle(v, positions);
      return {
        vehicleId: v.id,
        name: v.name,
        registrationNo: v.registrationNo,
        routeId: route?.id ?? null,
        routeName: route?.name ?? null,
        busNo: route?.busNo ?? null,
        tracked: !!pos,
        position: pos ? { ...pos, ageSec: ageSeconds(pos.recordedAt, nowMs), freshness: positionFreshness(pos.recordedAt, nowMs) } : null,
      };
    });
  const { hhmm, weekday } = istClock(nowMs);
  const s = DEFAULT_FLEET_ALERT_SETTINGS;
  return { buses, phase: tripPhase(hhmm, weekday, { start: s.windowStart, end: s.windowEnd, workingDays: s.workingDays }), school: { lat: TENANT.schoolLat, lng: TENANT.schoolLng } };
}

export type ParentBusView = {
  studentId: string;
  fullName: string;
  routeName: string | null;
  busNo: string | null;
  vehicleName: string | null;
  /** false = this vehicle has no tracker; the app says so rather than showing nothing. */
  tracked: boolean;
  phase: TripPhase;
  /** null outside the transport day or when the tracker is stale. */
  bus: { lat: number; lng: number; speedKmh: number | null; courseDeg: number | null; recordedAt: string; ageSec: number; freshness: PositionFreshness } | null;
  stop: { name: string; lat: number; lng: number } | null;
  school: { lat: number; lng: number };
  /** The route's stops in order, for the line on the map. */
  path: { name: string; lat: number; lng: number }[];
  /** "About N minutes" to the child's stop; null when it cannot be said honestly. */
  etaMinutes: number | null;
  distanceKm: number | null;
};

/**
 * What a family may see: their own children's buses, only during the
 * transport day, only while the tracker is reporting. The driver's evening
 * is not the school's business to broadcast.
 */
export async function buildParentBusViews(input: {
  students: { id: string; fullName: string }[];
  assignments: { studentId: string; routeId: string; stopId: string; effectiveTo: string | null }[];
  nowMs?: number;
}): Promise<ParentBusView[]> {
  const nowMs = input.nowMs ?? Date.now();
  const live = await buildLiveFleet(nowMs);
  const { bundle } = await fetchTransportDeskFromDb();
  const today = istClock(nowMs).dateIso;
  return input.students.map((s) => {
    const a = input.assignments.filter((x) => x.studentId === s.id && (!x.effectiveTo || x.effectiveTo >= today))[0];
    const route = a ? bundle.routes.find((r) => r.id === a.routeId) : undefined;
    const bus = route?.vehicleId ? live.buses.find((b) => b.vehicleId === route.vehicleId) : undefined;
    const stopRaw = route?.stops.find((st) => st.id === a?.stopId);
    const stop = stopRaw && stopRaw.geoLat != null && stopRaw.geoLng != null ? { name: stopRaw.name, lat: stopRaw.geoLat, lng: stopRaw.geoLng } : null;
    const path = (route?.stops ?? [])
      .filter((st) => st.geoLat != null && st.geoLng != null)
      .sort((x, y) => x.sequence - y.sequence)
      .map((st) => ({ name: st.name, lat: st.geoLat!, lng: st.geoLng! }));
    const showable = bus?.position && live.phase !== "off" && bus.position.freshness !== "stale";
    const pos = showable ? bus!.position! : null;
    const distanceKm = pos && stop ? haversineKm(pos, stop) : null;
    return {
      studentId: s.id,
      fullName: s.fullName,
      routeName: route?.name ?? null,
      busNo: route?.busNo ?? null,
      vehicleName: bus?.name ?? null,
      tracked: !!bus?.tracked,
      phase: live.phase,
      bus: pos ? { lat: pos.lat, lng: pos.lng, speedKmh: pos.speedKmh, courseDeg: pos.courseDeg, recordedAt: pos.recordedAt, ageSec: pos.ageSec, freshness: pos.freshness } : null,
      stop,
      school: live.school,
      path,
      etaMinutes: distanceKm != null ? estimateEtaMinutes(distanceKm, pos?.speedKmh) : null,
      distanceKm: distanceKm != null ? Math.round(distanceKm * 10) / 10 : null,
    };
  });
}

/* ── owner alerts ─────────────────────────────────────────────── */

const ALERT_KINDS = ["out_of_hours", "low_fuel", "fuel_drain", "service_due", "compliance_due"] as const;

export type FleetAlertsTickResult = {
  evaluated: number;
  alerts: { key: string; title: string; vehicle: string; recipients: { name: string; wa: string; push: number }[] }[];
  pruned: number;
  dryRun: boolean;
};

/**
 * The tick: evaluate the rules, send each standing alert to every owner on
 * the roster (text inside the 24h window, the approved template outside it),
 * log every attempt to fleet_edge_notifications — which is also where the
 * cooldown reads the last send from — and prune positions older than 30 days.
 */
export async function runFleetAlertsTick(opts: { dryRun?: boolean; nowMs?: number } = {}): Promise<FleetAlertsTickResult> {
  const nowMs = opts.nowMs ?? Date.now();
  const ctx = await getServerTenantContext();
  const [{ bundle }, positions] = await Promise.all([fetchTransportDeskFromDb(), readLatestPositions()]);
  const vehicles = bundle.vehicles as FleetVehicle[];

  // Cooldown: the last time each alert key went out.
  const lastSent: Record<string, string> = {};
  if (ctx) {
    const since = new Date(nowMs - 2 * 86_400_000).toISOString();
    const { data } = await ctx.sb
      .from("fleet_edge_notifications")
      .select("alert_name, vehicle_ref, created_at, status")
      .eq("tenant_id", ctx.tenantId)
      .in("alert_name", ALERT_KINDS as unknown as string[])
      .gte("created_at", since)
      .order("created_at", { ascending: false })
      .limit(1000);
    for (const r of (data ?? []) as { alert_name: string; vehicle_ref: string | null; created_at: string; status: string }[]) {
      if (r.status !== "sent") continue;
      const key = `${r.alert_name}:${r.vehicle_ref ?? ""}`;
      if (!lastSent[key]) lastSent[key] = r.created_at;
    }
  }

  // Fleet Edge's FuelDrain alerts from the last tick window.
  const fuelDrains: NonNullable<Parameters<typeof evaluateFleetAlerts>[0]["fuelDrains"]> = [];
  if (ctx) {
    const since = new Date(nowMs - 20 * 60_000).toISOString();
    const { data } = await ctx.sb
      .from("fleet_edge_events")
      .select("vehicle_ref, registration_number, event_at, received_at, payload")
      .eq("tenant_id", ctx.tenantId)
      .eq("event_type", "alert")
      .eq("alert_name", "FuelDrain")
      .gte("received_at", since)
      .limit(50);
    for (const r of (data ?? []) as { vehicle_ref: string | null; registration_number: string | null; event_at: string | null; received_at: string; payload: Record<string, unknown> }[]) {
      const d = (r.payload?.eventDetails as Record<string, unknown> | undefined) ?? {};
      fuelDrains.push({
        vehicleRef: r.vehicle_ref ?? "",
        registrationNumber: r.registration_number,
        at: r.event_at ?? r.received_at,
        detail: [d.fuelDifference != null ? `drop ${String(d.fuelDifference)}` : "", d.fuelTank != null ? `tank ${String(d.fuelTank)}` : "", typeof d.location === "string" ? d.location : ""].filter(Boolean).join(" · "),
        lat: typeof d.latitude === "number" ? d.latitude : null,
        lng: typeof d.longitude === "number" ? d.longitude : null,
      });
    }
  }

  const alerts = evaluateFleetAlerts({ vehicles, positions, nowMs, lastSent, fuelDrains });
  const result: FleetAlertsTickResult = { evaluated: vehicles.length, alerts: [], pruned: 0, dryRun: !!opts.dryRun };
  if (!alerts.length) {
    result.pruned = await prunePositions(nowMs);
    return result;
  }

  const masters = await loadServerMasters();
  const owners = (masters.staff ?? []).filter((s) => s.status === "active" && inferStaffIsOwner(s, masters.designations ?? []));
  const { state: rawReg } = await fetchServerBlob<WaTemplatesState>("wa_templates_state");
  const registry = normalizeWaTemplatesState(rawReg);
  const tpl = resolveTemplateForSend({ state: registry, familyKey: "fleet_owner_alert", language: "en" });
  const { hhmm, dateIso } = istClock(nowMs);
  const timeLabel = `${dateIso} ${hhmm} IST`;

  for (const a of alerts) {
    const text = renderFleetAlertText(a, TENANT.nameDisplay, timeLabel);
    const recipients: FleetAlertsTickResult["alerts"][number]["recipients"] = [];
    for (const s of owners) {
      const mobile = (s.mobile || "").trim();
      let wa = mobile ? (opts.dryRun ? "dry run" : "") : "no mobile";
      let push = 0;
      if (mobile && !opts.dryRun) {
        const r = await sendWaWithFailover({ primaryMobile: mobile, body: text, clientMessageId: `fleet_${a.key}_${dateIso}_${hhmm}_${s.id}` });
        if (r.ok) wa = "text";
        else if (tpl.ok && /24h|window/i.test(r.error || "")) {
          const values = { alertTitle: a.title, busNo: a.vehicleLabel, time: timeLabel, detail: a.detail.slice(0, 300), schoolName: TENANT.nameDisplay };
          const positions = templateVariablePositions(tpl.template, values);
          const t = await sendWaWithFailover({
            primaryMobile: mobile,
            template: {
              name: tpl.template.metaName,
              language: tpl.template.metaLanguage || tpl.template.language,
              components: [buildWaTemplateBodyComponent(Object.keys(positions).sort((x, y) => Number(x) - Number(y)), positions)],
            },
            fromPhoneNumberId: tpl.sender?.phoneNumberId,
            clientMessageId: `fleet_${a.key}_${dateIso}_${hhmm}_${s.id}_t`,
          });
          wa = t.ok ? "template" : `failed: ${t.error || "template send failed"}`;
        } else wa = `failed: ${r.error || "send failed"}${!tpl.ok ? " (no approved fleet_owner_alert template)" : ""}`;
        const p = await sendPushToSubject("staff", s.id, { title: `${a.title} · ${a.vehicleLabel}`, body: a.detail.slice(0, 160), url: "/transport?tab=live", data: { kind: "fleet_alert", alert: a.kind } }).catch(() => ({ sent: 0, expired: 0, failed: 0 }));
        push = p.sent;
        if (ctx) {
          await ctx.sb.from("fleet_edge_notifications").insert({
            tenant_id: ctx.tenantId,
            event_id: null,
            alert_name: a.kind,
            vehicle_ref: a.vehicleId,
            registration_number: vehicles.find((v) => v.id === a.vehicleId)?.registrationNo ?? null,
            channel: "whatsapp",
            recipient: mobile,
            status: wa === "text" || wa === "template" ? "sent" : "failed",
            detail: wa,
            body: text,
          });
        }
      }
      recipients.push({ name: s.fullName, wa, push });
    }
    result.alerts.push({ key: a.key, title: a.title, vehicle: a.vehicleLabel, recipients });
  }
  result.pruned = await prunePositions(nowMs);
  return result;
}

/** Thirty days of track is plenty for a school bus; older rows go. */
async function prunePositions(nowMs: number): Promise<number> {
  const ctx = await getServerTenantContext();
  if (!ctx) return 0;
  const cutoff = new Date(nowMs - 30 * 86_400_000).toISOString();
  const { data, error } = await ctx.sb.from("fleet_vehicle_positions").delete().eq("tenant_id", ctx.tenantId).lt("recorded_at", cutoff).select("id");
  if (error) return 0;
  return (data ?? []).length;
}

export type { FleetAlert };
