/**
 * Live buses — the pure half.
 *
 * Fleet Edge trackers push a position every minute or so; the school has
 * six vehicles, four of them tracked, and Rajesh's van has no tracker at all.
 * This module turns positions into what a parent or the owner needs: which
 * bus is where, how fresh that is, whether it is on a school trip, roughly
 * how far it is from a child's stop — and which situations the owner should
 * hear about (a bus moving outside school hours, a tank running low, a
 * service or a paper falling due).
 *
 * Honest by construction: freshness is stated, the ETA says "about", a bus
 * whose tracker has gone quiet is "not reporting" rather than "here", and an
 * untracked vehicle is shown as untracked instead of being invented.
 */

import { normalizeVehicleKey } from "@/lib/fleetEdgeLink";

export type LivePosition = {
  vehicleRef: string;
  registrationNumber: string | null;
  recordedAt: string;
  lat: number;
  lng: number;
  speedKmh: number | null;
  courseDeg: number | null;
  ignitionOn: boolean | null;
  fuelPercent: number | null;
  odometerKm: number | null;
};

export type PositionFreshness = "live" | "recent" | "stale";

/** Live under three minutes, recent under fifteen, stale after that. */
export function positionFreshness(recordedAtIso: string, nowMs: number): PositionFreshness {
  const age = nowMs - new Date(recordedAtIso).getTime();
  if (!Number.isFinite(age) || age < 0) return "recent";
  if (age <= 3 * 60_000) return "live";
  if (age <= 15 * 60_000) return "recent";
  return "stale";
}

export function ageSeconds(recordedAtIso: string, nowMs: number): number {
  const age = Math.round((nowMs - new Date(recordedAtIso).getTime()) / 1000);
  return Number.isFinite(age) ? Math.max(0, age) : 0;
}

export function haversineKm(a: { lat: number; lng: number }, b: { lat: number; lng: number }): number {
  const R = 6371;
  const dLat = ((b.lat - a.lat) * Math.PI) / 180;
  const dLng = ((b.lng - a.lng) * Math.PI) / 180;
  const la = (a.lat * Math.PI) / 180;
  const lb = (b.lat * Math.PI) / 180;
  const h = Math.sin(dLat / 2) ** 2 + Math.cos(la) * Math.cos(lb) * Math.sin(dLng / 2) ** 2;
  return 2 * R * Math.asin(Math.min(1, Math.sqrt(h)));
}

/**
 * "About N minutes": straight-line distance × 1.3 for the road, at the
 * fleet's observed village average of about 22 km/h. Never under one
 * minute, never claimed for a bus more than fifteen minutes silent.
 */
export function estimateEtaMinutes(distanceKm: number, speedKmh?: number | null): number {
  const avg = speedKmh && speedKmh > 12 ? Math.min(45, speedKmh) : 22;
  return Math.max(1, Math.round((distanceKm * 1.3) / avg * 60));
}

export type TripPhase = "morning" | "afternoon" | "off";

/**
 * Which trip a position belongs to, from the IST clock alone. Before eleven
 * is the pickup run, eleven to the end of the transport window is the drop
 * run, anything else (and Sunday) is off — when a parent sees no position.
 */
export function tripPhase(istHhmm: string, weekday: number, window: { start: string; end: string; workingDays: number[] }): TripPhase {
  if (!window.workingDays.includes(weekday)) return "off";
  if (istHhmm < window.start || istHhmm > window.end) return "off";
  return istHhmm < "11:00" ? "morning" : "afternoon";
}

/** "HH:MM" and weekday (0 = Sunday) in Asia/Kolkata for an instant. */
export function istClock(nowMs: number): { hhmm: string; weekday: number; dateIso: string } {
  const d = new Date(nowMs + 5.5 * 3600_000);
  const hh = String(d.getUTCHours()).padStart(2, "0");
  const mm = String(d.getUTCMinutes()).padStart(2, "0");
  return { hhmm: `${hh}:${mm}`, weekday: d.getUTCDay(), dateIso: d.toISOString().slice(0, 10) };
}

/* ── linking positions to the desk's vehicles ─────────────────── */

export type DeskVehicleLike = { id: string; registrationNo: string; name: string };

/**
 * Plate first, VIN second — two desk rows hold a VIN in registrationNo
 * because the plate was pending. A vehicle with no match is untracked.
 */
export function positionForVehicle<T extends DeskVehicleLike>(vehicle: T, positions: LivePosition[]): LivePosition | null {
  const key = normalizeVehicleKey(vehicle.registrationNo);
  if (!key) return null;
  return (
    positions.find((p) => normalizeVehicleKey(p.registrationNumber) === key) ??
    positions.find((p) => normalizeVehicleKey(p.vehicleRef) === key) ??
    null
  );
}

/* ── owner alerts ─────────────────────────────────────────────── */

export type FleetAlertSettings = {
  /** The transport day: a bus moving outside this is worth a message. */
  windowStart: string;
  windowEnd: string;
  /** 0 = Sunday … 6 = Saturday. */
  workingDays: number[];
  /** A position at or above this speed counts as moving. */
  movingSpeedKmh: number;
  lowFuelPercent: number;
  serviceDueDays: number;
  serviceDueKm: number;
  complianceDueDays: number;
  /** Minutes before the same alert for the same vehicle is sent again. */
  cooldownMinutes: Record<FleetAlertKind, number>;
};

export const DEFAULT_FLEET_ALERT_SETTINGS: FleetAlertSettings = {
  windowStart: "06:00",
  windowEnd: "17:30",
  workingDays: [1, 2, 3, 4, 5, 6],
  movingSpeedKmh: 8,
  lowFuelPercent: 20,
  serviceDueDays: 7,
  serviceDueKm: 500,
  complianceDueDays: 15,
  cooldownMinutes: { out_of_hours: 60, low_fuel: 12 * 60, fuel_drain: 60, service_due: 24 * 60, compliance_due: 24 * 60 },
};

export type FleetAlertKind = "out_of_hours" | "low_fuel" | "fuel_drain" | "service_due" | "compliance_due";

export type FleetAlert = {
  /** kind:vehicleId — the cooldown key. */
  key: string;
  kind: FleetAlertKind;
  vehicleId: string;
  vehicleLabel: string;
  title: string;
  detail: string;
  /** Where it was, for the map link; null for paper/service alerts. */
  at: { lat: number; lng: number } | null;
};

export type AlertVehicleLike = DeskVehicleLike & {
  isActive: boolean;
  status: string;
  odometerKm?: number;
  serviceSchedule?: { task: string; nextDueOn?: string | null; nextDueOdo?: number | null }[];
  compliance?: { certType: string; expiryDate?: string | null }[];
};

const ALERT_TITLES: Record<FleetAlertKind, string> = {
  out_of_hours: "Bus moving outside school hours",
  low_fuel: "Low fuel",
  fuel_drain: "Sudden fuel drop",
  service_due: "Service due",
  compliance_due: "Vehicle paper expiring",
};

function addDays(iso: string, days: number): string {
  const d = new Date(`${iso}T00:00:00Z`);
  d.setUTCDate(d.getUTCDate() + days);
  return d.toISOString().slice(0, 10);
}

/**
 * Which alerts stand right now. Deterministic and pure; the caller supplies
 * the clock, the latest positions and when each alert was last sent.
 */
export function evaluateFleetAlerts(input: {
  vehicles: AlertVehicleLike[];
  positions: LivePosition[];
  nowMs: number;
  settings?: Partial<FleetAlertSettings>;
  /** key → ISO of the last send, for cooldowns. */
  lastSent: Record<string, string>;
  /**
   * Fleet Edge's own FuelDrain alerts seen since the last tick, by the
   * tracker's vehicle ref. These trackers do not report a fuel level in
   * telemetry (the CNG buses send none), so the drain alert is the only
   * fuel signal there is; it is relayed rather than re-derived.
   */
  fuelDrains?: { vehicleRef: string; registrationNumber: string | null; at: string; detail: string; lat?: number | null; lng?: number | null }[];
}): FleetAlert[] {
  const s: FleetAlertSettings = { ...DEFAULT_FLEET_ALERT_SETTINGS, ...input.settings, cooldownMinutes: { ...DEFAULT_FLEET_ALERT_SETTINGS.cooldownMinutes, ...(input.settings?.cooldownMinutes ?? {}) } };
  const { hhmm, weekday, dateIso } = istClock(input.nowMs);
  const outsideDay = !s.workingDays.includes(weekday) || hhmm < s.windowStart || hhmm > s.windowEnd;
  const out: FleetAlert[] = [];
  const cooled = (key: string, kind: FleetAlertKind) => {
    const last = input.lastSent[key];
    if (!last) return true;
    return input.nowMs - new Date(last).getTime() >= s.cooldownMinutes[kind] * 60_000;
  };
  const push = (a: FleetAlert) => {
    if (cooled(a.key, a.kind)) out.push(a);
  };

  for (const v of input.vehicles) {
    if (!v.isActive || v.status !== "active") continue;
    const label = v.name || v.registrationNo;
    const pos = positionForVehicle(v, input.positions);

    if (pos && outsideDay && positionFreshness(pos.recordedAt, input.nowMs) !== "stale") {
      const moving = (pos.speedKmh ?? 0) >= s.movingSpeedKmh;
      if (moving) {
        push({
          key: `out_of_hours:${v.id}`,
          kind: "out_of_hours",
          vehicleId: v.id,
          vehicleLabel: label,
          title: ALERT_TITLES.out_of_hours,
          detail: `Moving at ${Math.round(pos.speedKmh ?? 0)} km/h at ${hhmm} IST, outside the transport day (${s.windowStart}–${s.windowEnd}, Mon–Sat).`,
          at: { lat: pos.lat, lng: pos.lng },
        });
      }
    }

    if (pos && pos.fuelPercent != null && pos.fuelPercent <= s.lowFuelPercent && input.nowMs - new Date(pos.recordedAt).getTime() <= 24 * 3600_000) {
      push({
        key: `low_fuel:${v.id}`,
        kind: "low_fuel",
        vehicleId: v.id,
        vehicleLabel: label,
        title: ALERT_TITLES.low_fuel,
        detail: `Tank at ${Math.round(pos.fuelPercent)}% (alert level ${s.lowFuelPercent}%).`,
        at: { lat: pos.lat, lng: pos.lng },
      });
    }

    const odo = pos?.odometerKm ?? v.odometerKm ?? null;
    const dueBy = addDays(dateIso, s.serviceDueDays);
    const dueItems = (v.serviceSchedule ?? []).filter((it) => {
      const byDate = !!it.nextDueOn && it.nextDueOn <= dueBy;
      const byKm = it.nextDueOdo != null && odo != null && it.nextDueOdo - odo <= s.serviceDueKm;
      return byDate || byKm;
    });
    if (dueItems.length) {
      push({
        key: `service_due:${v.id}`,
        kind: "service_due",
        vehicleId: v.id,
        vehicleLabel: label,
        title: ALERT_TITLES.service_due,
        detail: dueItems
          .map((it) => `${it.task}${it.nextDueOn ? ` by ${it.nextDueOn}` : ""}${it.nextDueOdo != null && odo != null ? ` (at ${it.nextDueOdo} km, now ${Math.round(odo)} km)` : ""}`)
          .join("; "),
        at: null,
      });
    }

    for (const fd of input.fuelDrains ?? []) {
      const key = normalizeVehicleKey(v.registrationNo);
      const hit = key && (normalizeVehicleKey(fd.registrationNumber) === key || normalizeVehicleKey(fd.vehicleRef) === key);
      if (!hit) continue;
      push({
        key: `fuel_drain:${v.id}`,
        kind: "fuel_drain",
        vehicleId: v.id,
        vehicleLabel: label,
        title: ALERT_TITLES.fuel_drain,
        detail: `Fleet Edge reported a fuel drain at ${fd.at.slice(11, 16)} UTC: ${fd.detail || "see the tracker portal"}.`,
        at: fd.lat != null && fd.lng != null ? { lat: fd.lat, lng: fd.lng } : null,
      });
      break;
    }

    const expBy = addDays(dateIso, s.complianceDueDays);
    const expiring = (v.compliance ?? []).filter((c) => !!c.expiryDate && c.expiryDate <= expBy);
    if (expiring.length) {
      push({
        key: `compliance_due:${v.id}`,
        kind: "compliance_due",
        vehicleId: v.id,
        vehicleLabel: label,
        title: ALERT_TITLES.compliance_due,
        detail: expiring.map((c) => `${c.certType} ${c.expiryDate! < dateIso ? "expired" : "expires"} ${c.expiryDate}`).join("; "),
        at: null,
      });
    }
  }
  return out;
}

/** The owner's WhatsApp text for one alert. */
export function renderFleetAlertText(a: FleetAlert, schoolName: string, timeLabel: string): string {
  const lines = [`🚨 *${a.title}*`, "", `🚌 Vehicle: *${a.vehicleLabel}*`, `🕒 ${timeLabel}`, "", a.detail];
  if (a.at) lines.push("", `📍 https://maps.google.com/?q=${a.at.lat.toFixed(6)},${a.at.lng.toFixed(6)}`);
  lines.push("", `Open Transport → Live in the ERP for the map. — ${schoolName}`);
  return lines.join("\n");
}
