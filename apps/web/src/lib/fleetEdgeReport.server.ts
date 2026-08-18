/**
 * Fleet Edge report engine — one read of fleet_edge_events for the tenant,
 * turned into everything the Transport → Fleet Edge report needs:
 * per-vehicle metrics + score buckets (lib/fleetEdgeAnalytics.ts), fleet
 * totals, daily series for charts, the alert log, offline history, and the
 * outbound-notification log. Pure aggregation over what Fleet Edge actually
 * sent; nothing here is invented.
 *
 * Bounding rules (unchanged from the original dashboard route):
 *   - safety / efficiency / health counters and the daily series are bounded
 *     to the requested [from, to];
 *   - lastSeenAt, lastTelemetry, lastOfflinePosition and offline periods are
 *     CURRENT-status facts and use all history in FLEET_LOOKBACK_MS.
 *
 * SOS: Fleet Edge's live system sends "PanicSosEvent" where the spec says
 * "DriverSOSAlert" (159 real ones on 16–18 Aug 2026 were being ignored).
 * Both count as SOS everywhere here.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  buildFleetDashboard,
  computeOfflinePeriods,
  emptyVehicleMetrics,
  isVehicleOffline,
  FLEET_LOOKBACK_MS,
  NON_FLEET_VEHICLE_REFS,
  type OfflinePeriod,
  type VehicleFleetMetrics,
} from "@/lib/fleetEdgeAnalytics";
import { isSosAlert } from "@/lib/fleetEdge.server";
import {
  isServiceDue,
  type FleetAlertRow,
  type FleetDailyPoint,
  type FleetEdgeReport,
  type FleetNotificationRow,
  type FleetTotals,
  type FleetVehicleIdentity,
} from "@/lib/fleetEdgeReport.types";

export type {
  FleetAlertRow,
  FleetDailyPoint,
  FleetEdgeReport,
  FleetNotificationRow,
  FleetTotals,
  FleetVehicleIdentity,
} from "@/lib/fleetEdgeReport.types";

type RawEvent = {
  id: string;
  event_type: "alert" | "details" | "telemetry";
  alert_name: string | null;
  vehicle_ref: string | null;
  registration_number: string | null;
  event_at: string | null;
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


export function alertSeverity(alertName: string): FleetAlertRow["severity"] {
  if (isSosAlert(alertName)) return "critical";
  if (alertName === "OverSpeedEvent" || alertName === "FuelDrainAlert") return "warning";
  return "info";
}

function istDay(iso: string): { day: string; label: string } {
  const d = new Date(iso);
  const day = new Intl.DateTimeFormat("en-CA", {
    timeZone: "Asia/Kolkata",
    year: "numeric",
    month: "2-digit",
    day: "2-digit",
  }).format(d); // en-CA gives YYYY-MM-DD
  const label = new Intl.DateTimeFormat("en-IN", {
    timeZone: "Asia/Kolkata",
    day: "numeric",
    month: "short",
  }).format(d);
  return { day, label };
}

export async function buildFleetEdgeReport(
  sb: SupabaseClient,
  tenantId: string,
  opts: { from: string; to: string; vehicleRef?: string | null },
): Promise<FleetEdgeReport | { ok: false; error: string }> {
  const { from, to } = opts;
  const lookbackFrom = new Date(Date.now() - FLEET_LOOKBACK_MS).toISOString();

  // PostgREST caps every response at max-rows (1 000 on Supabase) no matter
  // what .limit() asks for. The original dashboard asked for 20 000 and got
  // the oldest 1 000 — everything after 17 Aug 12:30 UTC was silently
  // missing (SOS 57 of 159, "last seen" a day stale). Page explicitly.
  const PAGE = 1000;
  const MAX_EVENTS = 50_000;
  async function fetchAllEvents(): Promise<{ data: RawEvent[]; error: string | null }> {
    const out: RawEvent[] = [];
    for (let offset = 0; offset < MAX_EVENTS; offset += PAGE) {
      const { data, error } = await sb
        .from("fleet_edge_events")
        .select("id, event_type, alert_name, vehicle_ref, registration_number, event_at, received_at, payload")
        .eq("tenant_id", tenantId)
        .gte("received_at", lookbackFrom)
        .order("received_at", { ascending: true })
        .order("id", { ascending: true })
        .range(offset, offset + PAGE - 1);
      if (error) return { data: out, error: error.message };
      const rows = (data || []) as RawEvent[];
      out.push(...rows);
      if (rows.length < PAGE) break;
    }
    return { data: out, error: null };
  }

  const [eventsRes, identityRes, notifRes, totalRes] = await Promise.all([
    fetchAllEvents(),
    sb.from("fleet_edge_vehicle_identity").select("vin, model, year, name, fuel_type").eq("tenant_id", tenantId),
    sb
      .from("fleet_edge_notifications")
      .select("id, created_at, event_id, alert_name, vehicle_ref, registration_number, channel, recipient, status, detail, body")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(500),
    sb.from("fleet_edge_events").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
  ]);
  if (eventsRes.error) return { ok: false, error: eventsRes.error };

  const events = eventsRes.data.filter((ev) => {
    if (!opts.vehicleRef) return true;
    return ev.vehicle_ref === opts.vehicleRef || ev.registration_number === opts.vehicleRef;
  });
  const byVehicle = new Map<string, VehicleFleetMetrics>();
  const timestampsByVehicle = new Map<string, string[]>();
  const fromMs = Date.parse(from);
  const toMs = Date.parse(to);
  const dailyMap = new Map<string, FleetDailyPoint>();
  const alerts: FleetAlertRow[] = [];
  let eventsInRange = 0;

  // Fleet Edge window stamps ("2026-08-18T05:30:00") carry no zone and are
  // UTC (they arrive seconds after the window ends). Pin them so a server
  // in any TZ buckets the same day.
  function utcPinned(iso: string): string {
    return /(Z|[+-]\d\d:?\d\d)$/.test(iso) ? iso : `${iso}Z`;
  }
  function dayFor(iso: string): FleetDailyPoint {
    const { day, label } = istDay(utcPinned(iso));
    let d = dailyMap.get(day);
    if (!d) {
      d = { day, label, distanceKm: 0, fuelL: 0, harshEvents: 0, overSpeed: 0, sos: 0, alerts: 0, avgSpeedSum: 0, avgSpeedN: 0, avgSpeed: null, windows: 0 };
      dailyMap.set(day, d);
    }
    return d;
  }

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
    // Latest real registration wins. Fleet Edge reports "NA" until the
    // vehicle is registered in their portal, then the real plate; keeping
    // the FIRST value froze MAT558053TVE29204 on "NA" after it had become
    // UP65RT9825 (2026-08-18). Events arrive ascending, so overwrite.
    if (ev.registration_number && ev.registration_number !== "NA") {
      m.registrationNumber = ev.registration_number;
    } else if (ev.registration_number && !m.registrationNumber) {
      m.registrationNumber = ev.registration_number;
    }
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
          // Real telemetry sends primaryFuelLevel; the spec PDF says
          // fuelLevelPercent. Accept either.
          fuelLevelPercent:
            typeof p.primaryFuelLevel === "number"
              ? p.primaryFuelLevel
              : typeof p.fuelLevelPercent === "number"
                ? p.fuelLevelPercent
                : null,
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
      else if (isSosAlert(ev.alert_name)) m.sosCount += 1;
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


  // Second pass over in-range events for the daily series + alert log.
  for (const ev of events) {
    const evMs = Date.parse(ev.received_at);
    if (!Number.isFinite(evMs) || evMs < fromMs || evMs > toMs) continue;
    if (ev.vehicle_ref && NON_FLEET_VEHICLE_REFS.has(ev.vehicle_ref)) continue;
    eventsInRange += 1;
    const at = ev.event_at || ev.received_at;
    if (ev.event_type === "details") {
      const p = ev.payload;
      const safety = isObj(p.vehicleSafety) ? p.vehicleSafety : {};
      const perf = isObj(p.vehiclePerformance) ? p.vehiclePerformance : {};
      const eff = isObj(p.vehicleEfficiency) ? p.vehicleEfficiency : {};
      const d = dayFor(typeof p.from === "string" ? p.from : at);
      d.windows += 1;
      d.distanceKm += num(perf.distanceTravelled);
      d.fuelL += typeof eff.fuelUsed === "number" ? eff.fuelUsed : num(eff.fuelConsumed);
      d.harshEvents += num(safety.harshAccelerationCount) + num(safety.harshBrakeCount) + num(safety.rashTurningCount);
      if (typeof eff.averageSpeed === "number" && eff.averageSpeed > 0) {
        d.avgSpeedSum += eff.averageSpeed;
        d.avgSpeedN += 1;
      }
    } else if (ev.event_type === "alert" && ev.alert_name) {
      const d = dayFor(at);
      d.alerts += 1;
      if (isSosAlert(ev.alert_name)) d.sos += 1;
      if (ev.alert_name === "OverSpeedEvent") d.overSpeed += 1;
      const det = isObj(ev.payload.eventDetails) ? ev.payload.eventDetails : {};
      alerts.push({
        id: ev.id,
        at,
        receivedAt: ev.received_at,
        vehicleRef: ev.vehicle_ref || ev.registration_number || "—",
        registrationNumber: ev.registration_number,
        alertName: ev.alert_name,
        severity: alertSeverity(ev.alert_name),
        location: typeof det.location === "string" ? det.location : null,
        lat: typeof det.latitude === "number" ? det.latitude : null,
        lng: typeof det.longitude === "number" ? det.longitude : null,
        maxSpeed: typeof det.maxSpeed === "number" ? det.maxSpeed : null,
        duration: typeof det.duration === "number" ? det.duration : null,
        fuelDifference: typeof det.fuelDifference === "number" ? det.fuelDifference : null,
        fuelTank: typeof det.fuelTank === "string" ? det.fuelTank : null,
      });
    }
  }
  alerts.sort((a, b) => Date.parse(b.at) - Date.parse(a.at));

  const daily = [...dailyMap.values()]
    .map((d) => ({ ...d, avgSpeed: d.avgSpeedN > 0 ? d.avgSpeedSum / d.avgSpeedN : null }))
    .sort((a, b) => a.day.localeCompare(b.day));

  const { rows, kpis } = buildFleetDashboard(Array.from(byVehicle.values()));

  const identityByVin = new Map(
    (identityRes.data || []).map((r) => [
      r.vin as string,
      {
        model: r.model as string | null,
        year: r.year as number | null,
        name: r.name as string | null,
        fuelType: (r.fuel_type as FleetVehicleIdentity["fuelType"]) ?? null,
      },
    ]),
  );
  const vehicles = rows.map((r) => ({ ...r, identity: identityByVin.get(r.vehicleRef) || null }));

  const nowMs = Date.now();
  const offlineHistory: OfflinePeriod[] = [];
  for (const m of byVehicle.values()) {
    const timestamps = timestampsByVehicle.get(m.vehicleRef) || [];
    offlineHistory.push(...computeOfflinePeriods(m.vehicleRef, m.registrationNumber, timestamps, nowMs));
  }
  offlineHistory.sort((a, b) => Date.parse(b.from) - Date.parse(a.from));

  const totals: FleetTotals = {
    vehicles: vehicles.length,
    online: vehicles.filter((v) => !isVehicleOffline(v.lastSeenAt, nowMs)).length,
    offline: vehicles.filter((v) => isVehicleOffline(v.lastSeenAt, nowMs)).length,
    distanceKm: 0, fuelL: 0, kmPerL: null, avgSpeed: null,
    harshAcceleration: 0, harshBrake: 0, rashTurning: 0, harshEvents: 0,
    overSpeed: 0, sos: 0, fuelDrain: 0, refuel: 0, geofence: 0, alerts: alerts.length,
    faultCritical: 0, faultWarning: 0, serviceDue: 0, nightDrivingHours: 0, idlingHours: 0,
    eventsInRange, eventsTotal: totalRes.count ?? 0,
    telemetryVehicles: vehicles.filter((v) => v.lastTelemetry != null).length,
  };
  let speedSum = 0; let speedN = 0;
  for (const v of vehicles) {
    totals.distanceKm += v.distanceTravelledKm;
    totals.fuelL += v.fuelConsumed;
    totals.harshAcceleration += v.haCount;
    totals.harshBrake += v.hbCount;
    totals.rashTurning += v.rtCount;
    totals.overSpeed += v.overSpeedCount;
    totals.sos += v.sosCount;
    totals.fuelDrain += v.fuelDrainCount;
    totals.refuel += v.refuelCount;
    totals.geofence += v.geofenceEventCount;
    totals.faultCritical += v.faultCritical;
    totals.faultWarning += v.faultWarning;
    if (isServiceDue(v.serviceDue)) totals.serviceDue += 1;
    totals.nightDrivingHours += v.nightDrivingSeconds / 3600;
    totals.idlingHours += v.idlingSeconds / 3600;
    for (const s of v.averageSpeedSamples) if (s > 0) { speedSum += s; speedN += 1; }
  }
  totals.harshEvents = totals.harshAcceleration + totals.harshBrake + totals.rashTurning;
  totals.kmPerL = totals.fuelL > 0 ? totals.distanceKm / totals.fuelL : null;
  totals.avgSpeed = speedN > 0 ? speedSum / speedN : null;

  const notifications: FleetNotificationRow[] = ((notifRes.data || []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.id),
    createdAt: String(r.created_at),
    eventId: (r.event_id as string | null) ?? null,
    alertName: String(r.alert_name),
    vehicleRef: (r.vehicle_ref as string | null) ?? null,
    registrationNumber: (r.registration_number as string | null) ?? null,
    channel: String(r.channel || "whatsapp"),
    recipient: String(r.recipient),
    status: r.status as FleetNotificationRow["status"],
    detail: (r.detail as string | null) ?? null,
    body: (r.body as string | null) ?? null,
  }));

  return {
    ok: true,
    from,
    to,
    generatedAt: new Date().toISOString(),
    kpis,
    totals,
    vehicles,
    daily,
    alerts,
    offlineHistory,
    notifications,
    notifyMobiles: (process.env.FLEET_EDGE_SOS_NOTIFY_MOBILE || "")
      .split(",")
      .map((s) => s.trim())
      .filter(Boolean)
      .map((m) => m.replace(/^(\d{2})\d{4}(\d{4})$/, "$1XXXX$2")),
  };
}
