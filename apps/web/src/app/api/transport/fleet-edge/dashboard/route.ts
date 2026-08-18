/**
 * Fleet dashboard aggregation — reads fleet_edge_events for the tenant,
 * bounds the safety/efficiency/health counters to the requested [from,to]
 * window, but computes lastSeenAt (for offline detection) from ALL
 * history regardless of that window — see lib/fleetEdgeAnalytics.ts's file
 * header for why those two are deliberately different.
 */

import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import { getServerTenantContext } from "@/lib/serverTenant";
import { SOS_ALERT_NAMES } from "@/lib/fleetEdge.server";
import {
  buildFleetDashboard,
  computeOfflinePeriods,
  emptyVehicleMetrics,
  FLEET_LOOKBACK_MS,
  NON_FLEET_VEHICLE_REFS,
  type OfflinePeriod,
  type VehicleFleetMetrics,
} from "@/lib/fleetEdgeAnalytics";

export const runtime = "nodejs";

type RawEvent = {
  event_type: "alert" | "details" | "telemetry";
  alert_name: string | null;
  vehicle_ref: string | null;
  registration_number: string | null;
  received_at: string;
  payload: Record<string, unknown>;
};

function num(v: unknown): number {
  return typeof v === "number" && Number.isFinite(v) ? v : 0;
}

function isObj(v: unknown): v is Record<string, unknown> {
  return !!v && typeof v === "object" && !Array.isArray(v);
}

function sumDurations(list: unknown): number {
  if (!Array.isArray(list)) return 0;
  return list.reduce((acc: number, item) => {
    if (isObj(item) && typeof item.duration === "number") return acc + item.duration;
    return acc;
  }, 0);
}

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "transport", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const fromParam = url.searchParams.get("from");
  const toParam = url.searchParams.get("to");
  const now = new Date();
  const defaultFrom = new Date(now.getFullYear(), now.getMonth(), 1).toISOString();
  const from = fromParam || defaultFrom;
  const to = toParam || now.toISOString();

  const ctx = await getServerTenantContext();
  if (!ctx) {
    return NextResponse.json({ error: "Server tenant context unavailable" }, { status: 503 });
  }
  const { sb, tenantId } = ctx;

  const lookbackFrom = new Date(Date.now() - FLEET_LOOKBACK_MS).toISOString();

  const { data, error } = await sb
    .from("fleet_edge_events")
    .select("event_type, alert_name, vehicle_ref, registration_number, received_at, payload")
    .eq("tenant_id", tenantId)
    .gte("received_at", lookbackFrom)
    .order("received_at", { ascending: true })
    .limit(20000);

  if (error) {
    return NextResponse.json({ error: error.message }, { status: 500 });
  }

  const events = (data || []) as RawEvent[];
  const byVehicle = new Map<string, VehicleFleetMetrics>();
  // Every receipt timestamp per vehicle, unbounded by [from,to] like
  // lastSeenAt — offline periods are a connectivity fact, not a
  // performance-window one. Used to derive offlineHistory below.
  const timestampsByVehicle = new Map<string, string[]>();
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);

  for (const ev of events) {
    const key = ev.vehicle_ref || ev.registration_number;
    if (!key) continue;
    if (ev.vehicle_ref && NON_FLEET_VEHICLE_REFS.has(ev.vehicle_ref)) continue;
    if (!byVehicle.has(key)) {
      byVehicle.set(key, emptyVehicleMetrics(ev.vehicle_ref || key, ev.registration_number));
    }
    const m = byVehicle.get(key)!;

    // lastSeenAt — unbounded by [from,to], this is the live/current status.
    if (!m.lastSeenAt || ev.received_at > m.lastSeenAt) m.lastSeenAt = ev.received_at;
    if (ev.registration_number && !m.registrationNumber) m.registrationNumber = ev.registration_number;
    if (!timestampsByVehicle.has(key)) timestampsByVehicle.set(key, []);
    timestampsByVehicle.get(key)!.push(ev.received_at);

    if (ev.event_type === "telemetry") {
      const p = ev.payload;
      const at = Date.parse(ev.received_at);
      if (!m.lastTelemetry || (m.lastTelemetry.at && Date.parse(m.lastTelemetry.at) < at) || !m.lastTelemetry.at) {
        m.lastTelemetry = {
          lat: typeof p.gpsLatitude === "number" ? p.gpsLatitude : null,
          lng: typeof p.gpsLongitude === "number" ? p.gpsLongitude : null,
          speed: typeof p.speed === "number" ? p.speed : null,
          ignitionOn: typeof p.ignitionOn === "boolean" ? p.ignitionOn : null,
          fuelLevelPercent: typeof p.fuelLevelPercent === "number" ? p.fuelLevelPercent : null,
          odometer: typeof p.odometer === "number" ? p.odometer : null,
          at: ev.received_at,
          accelX: typeof p.accelX === "number" ? p.accelX : null,
          accelY: typeof p.accelY === "number" ? p.accelY : null,
          accelZ: typeof p.accelZ === "number" ? p.accelZ : null,
          gyroX: typeof p.gyroX === "number" ? p.gyroX : null,
          gyroY: typeof p.gyroY === "number" ? p.gyroY : null,
          gyroZ: typeof p.gyroZ === "number" ? p.gyroZ : null,
          crankOn: typeof p.crankOn === "boolean" ? p.crankOn : null,
          currentGear: typeof p.currentGear === "string" ? p.currentGear : null,
          engineRunHour: typeof p.engineRunHour === "number" ? p.engineRunHour : null,
          gpsAltitude: typeof p.gpsAltitude === "number" ? p.gpsAltitude : null,
          gpsCourseInDegrees: typeof p.gpsCourseInDegrees === "number" ? p.gpsCourseInDegrees : null,
          gpsFix: typeof p.gpsFix === "boolean" ? p.gpsFix : null,
          gpsSignalQuality: typeof p.gpsSignalQuality === "string" ? p.gpsSignalQuality : null,
          imei: typeof p.imei === "string" ? p.imei : null,
          noOfFuelTanks: typeof p.noOfFuelTanks === "number" ? p.noOfFuelTanks : null,
          noOfSatForFix: typeof p.noOfSatForFix === "number" ? p.noOfSatForFix : null,
          primaryFuelTankCapacity: typeof p.primaryFuelTankCapacity === "number" ? p.primaryFuelTankCapacity : null,
          secondaryFuelLevel1: typeof p.secondaryFuelLevel1 === "number" ? p.secondaryFuelLevel1 : null,
          secondaryFuelTankCapacity1:
            typeof p.secondaryFuelTankCapacity1 === "number" ? p.secondaryFuelTankCapacity1 : null,
          vehicleStatus: typeof p.vehicleStatus === "string" ? p.vehicleStatus : null,
        };
      }
    } else if (ev.event_type === "details") {
      // Last-known parked position — a current-status fact like
      // lastTelemetry, so unbounded by [from,to] too.
      const offline = isObj(ev.payload.vehicleEfficiency) && isObj(ev.payload.vehicleEfficiency.offline)
        ? ev.payload.vehicleEfficiency.offline
        : null;
      if (offline) {
        const offlineAt = typeof offline.timestamp === "string" ? offline.timestamp : null;
        if (!m.lastOfflinePosition || (offlineAt && (!m.lastOfflinePosition.at || offlineAt > m.lastOfflinePosition.at))) {
          m.lastOfflinePosition = {
            lat: typeof offline.latitude === "number" ? offline.latitude : null,
            lng: typeof offline.longitude === "number" ? offline.longitude : null,
            location: typeof offline.location === "string" ? offline.location : null,
            at: offlineAt,
          };
        }
      }
    }

    // Everything below this line is bounded to the requested [from,to].
    const evMs = Date.parse(ev.received_at);
    if (!Number.isFinite(evMs) || evMs < fromMs || evMs > toMs) continue;

    if (ev.event_type === "alert") {
      const eventDetails = isObj(ev.payload.eventDetails) ? ev.payload.eventDetails : {};
      if (ev.alert_name === "OverSpeedEvent") m.overSpeedCount += 1;
      else if (ev.alert_name && SOS_ALERT_NAMES.has(ev.alert_name)) m.sosCount += 1;
      else if (ev.alert_name === "FuelDrainAlert") {
        m.fuelDrainCount += 1;
        m.fuelDrainedLiters += num(eventDetails.fuelDifference);
      } else if (ev.alert_name === "RefuelAlert") m.refuelCount += 1;
      else if (ev.alert_name === "GeoFenceEntered" || ev.alert_name === "GeoFenceExited") m.geofenceEventCount += 1;

      if (ev.alert_name) {
        m.alertEvents.push({
          alertName: ev.alert_name,
          eventDateTime: typeof ev.payload.eventDateTime === "string" ? ev.payload.eventDateTime : null,
          maxSpeed: typeof eventDetails.maxSpeed === "number" ? eventDetails.maxSpeed : null,
          duration: typeof eventDetails.duration === "number" ? eventDetails.duration : null,
          fuelTank: typeof eventDetails.fuelTank === "string" ? eventDetails.fuelTank : null,
          lat: typeof eventDetails.latitude === "number" ? eventDetails.latitude : null,
          lng: typeof eventDetails.longitude === "number" ? eventDetails.longitude : null,
          location: typeof eventDetails.location === "string" ? eventDetails.location : null,
        });
      }
    } else if (ev.event_type === "details") {
      const p = ev.payload;
      const safety = isObj(p.vehicleSafety) ? p.vehicleSafety : {};
      m.haCount += num(safety.harshAccelerationCount);
      m.hbCount += num(safety.harshBrakeCount);
      m.rtCount += num(safety.rashTurningCount);
      m.nightDrivingSeconds += num(safety.nightTimeDrivingDuration);
      m.coastingSeconds += sumDurations(safety.coasting);

      const perf = isObj(p.vehiclePerformance) ? p.vehiclePerformance : {};
      m.distanceTravelledKm += num(perf.distanceTravelled);
      if (typeof perf.serviceDue === "string" && perf.serviceDue.trim()) m.serviceDue = perf.serviceDue;
      const engineLoad = isObj(perf.engineLoadUtilisation) ? perf.engineLoadUtilisation : null;
      if (engineLoad) {
        m.engineLoadHeavySamples.push(num(engineLoad.heavy));
        m.engineLoadMediumSamples.push(num(engineLoad.medium));
        m.engineLoadLightSamples.push(num(engineLoad.light));
      }
      if (typeof perf.gsa === "number") m.gsaSamples.push(perf.gsa);
      if (typeof perf.averageEngineRPM === "number") m.averageEngineRpmSamples.push(perf.averageEngineRPM);
      const gearUtil = isObj(perf.gearUtilisation) ? perf.gearUtilisation : null;
      if (gearUtil) {
        m.gearUtilisationSamples.push({
          gear1: num(gearUtil.gearUtilisation1),
          gear2: num(gearUtil.gearUtilisation2),
          gear3: num(gearUtil.gearUtilisation3),
          gear4: num(gearUtil.gearUtilisation4),
          gear5: num(gearUtil.gearUtilisation5),
          gear6: num(gearUtil.gearUtilisation6),
          gear7: num(gearUtil.gearUtilisation7),
          gear8: num(gearUtil.gearUtilisation8),
          gear9: num(gearUtil.gearUtilisation9),
          gearN: num(gearUtil.gearUtilisationN),
          gearR: num(gearUtil.gearUtilisationR),
        });
      }

      const eff = isObj(p.vehicleEfficiency) ? p.vehicleEfficiency : {};
      // Real Fleet Edge traffic sends "fuelUsed", not the "fuelConsumed" the
      // spec PDF documents — confirmed against live production payloads.
      // Accept either so a future push matching the documented name still works.
      m.fuelConsumed += typeof eff.fuelUsed === "number" ? eff.fuelUsed : num(eff.fuelConsumed);
      if (typeof eff.averageSpeed === "number") m.averageSpeedSamples.push(eff.averageSpeed);
      m.idlingSeconds += sumDurations(eff.idlings);
      m.stoppageSeconds += sumDurations(eff.stoppages);
      if (Array.isArray(eff.geofence)) {
        for (const g of eff.geofence) {
          if (!isObj(g)) continue;
          m.geofenceVisits.push({
            geofenceName: typeof g.geofenceName === "string" ? g.geofenceName : "Unnamed",
            durationInSeconds: num(g.durationInSeconds),
            inDateTime: typeof g.inDateTime === "string" ? g.inDateTime : null,
            outDateTime: typeof g.outDateTime === "string" ? g.outDateTime : null,
          });
        }
      }

      const health = isObj(p.vehicleHealth) ? p.vehicleHealth : {};
      const fault = isObj(health.faultCodes) ? health.faultCodes : {};
      const critical = Array.isArray(fault.critical) ? fault.critical : [];
      const warning = Array.isArray(fault.warning) ? fault.warning : [];
      m.faultCritical += critical.length;
      m.faultWarning += warning.length;
      for (const f of critical) {
        if (!isObj(f)) continue;
        m.faultCriticalDetails.push({
          description: typeof f.description === "string" ? f.description : "Unknown fault",
          suggestedAction: typeof f.suggestedAction === "string" ? f.suggestedAction : "",
        });
      }
      for (const f of warning) {
        if (!isObj(f)) continue;
        m.faultWarningDetails.push({
          description: typeof f.description === "string" ? f.description : "Unknown fault",
          suggestedAction: typeof f.suggestedAction === "string" ? f.suggestedAction : "",
        });
      }
      m.incidents += Array.isArray(health.incidents) ? health.incidents.length : 0;
      if (isObj(health.lowFuel) && typeof health.lowFuel.eventDateTime === "string") m.lowFuelAlertCount += 1;
      if (isObj(health.defLevelLow) && typeof health.defLevelLow.eventDateTime === "string") m.lowDefAlertCount += 1;
      if (isObj(health.lowEngineOilPressure) && health.lowEngineOilPressure.value === true) {
        m.lowEngineOilPressureEvents.push({
          description: typeof health.lowEngineOilPressure.description === "string" ? health.lowEngineOilPressure.description : null,
          eventDateTime: typeof health.lowEngineOilPressure.eventDateTime === "string" ? health.lowEngineOilPressure.eventDateTime : null,
        });
      }
    }
  }

  const { rows, kpis } = buildFleetDashboard(Array.from(byVehicle.values()));

  // Model/year is never in Fleet Edge's own payloads (checked against the
  // full spec and every field name seen in real traffic) — joined here from
  // what staff record themselves, keyed by VIN, so two vehicles of the same
  // model don't get confused for each other.
  const { data: identityRows } = await sb
    .from("fleet_edge_vehicle_identity")
    .select("vin, model, year, name")
    .eq("tenant_id", tenantId);
  const identityByVin = new Map(
    (identityRows || []).map((r) => [r.vin as string, { model: r.model as string | null, year: r.year as number | null, name: r.name as string | null }]),
  );

  const vehicles = rows.map((r) => ({
    ...r,
    identity: identityByVin.get(r.vehicleRef) || null,
  }));

  const nowMs = Date.now();
  const offlineHistory: OfflinePeriod[] = [];
  for (const m of byVehicle.values()) {
    const timestamps = timestampsByVehicle.get(m.vehicleRef) || [];
    offlineHistory.push(...computeOfflinePeriods(m.vehicleRef, m.registrationNumber, timestamps, nowMs));
  }
  offlineHistory.sort((a, b) => Date.parse(b.from) - Date.parse(a.from));

  return NextResponse.json({
    ok: true,
    from,
    to,
    kpis,
    total: vehicles.length,
    vehicles,
    offlineHistory,
  });
}
