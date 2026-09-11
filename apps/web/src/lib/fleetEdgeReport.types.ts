/**
 * Fleet Edge report — wire types + pure helpers shared by the server engine
 * (lib/fleetEdgeReport.server.ts) and the client report
 * (components/transport/FleetEdgeReport.tsx). No I/O, no server imports:
 * this file is safe to bundle into the browser.
 */

import type { OfflinePeriod, VehicleDashboardRow } from "@/lib/fleetEdgeAnalytics";

export type FleetAlertRow = {
  id: string;
  at: string;
  receivedAt: string;
  vehicleRef: string;
  registrationNumber: string | null;
  alertName: string;
  severity: "critical" | "warning" | "info";
  location: string | null;
  lat: number | null;
  lng: number | null;
  maxSpeed: number | null;
  duration: number | null;
  fuelDifference: number | null;
  fuelTank: string | null;
};

export type FleetDailyPoint = {
  day: string; // YYYY-MM-DD (IST)
  label: string; // "18 Aug"
  distanceKm: number;
  fuelL: number;
  harshEvents: number;
  overSpeed: number;
  sos: number;
  alerts: number;
  avgSpeedSum: number;
  avgSpeedN: number;
  avgSpeed: number | null;
  windows: number;
};

export type FleetTotals = {
  vehicles: number;
  online: number;
  offline: number;
  distanceKm: number;
  fuelL: number;
  kmPerL: number | null;
  avgSpeed: number | null;
  harshAcceleration: number;
  harshBrake: number;
  rashTurning: number;
  harshEvents: number;
  overSpeed: number;
  sos: number;
  fuelDrain: number;
  refuel: number;
  geofence: number;
  alerts: number;
  faultCritical: number;
  faultWarning: number;
  serviceDue: number;
  nightDrivingHours: number;
  idlingHours: number;
  eventsInRange: number;
  eventsTotal: number;
  /** Fleet vehicles that have ever sent Basic Push telemetry — the only feed carrying odometer / live GPS / fuel level. */
  telemetryVehicles: number;
};

export type FleetNotificationRow = {
  id: string;
  createdAt: string;
  eventId: string | null;
  alertName: string;
  vehicleRef: string | null;
  registrationNumber: string | null;
  channel: string;
  recipient: string;
  status: "sent" | "failed" | "suppressed" | "skipped";
  detail: string | null;
  body: string | null;
};

export type FleetFuelType = "diesel" | "petrol" | "cng" | "petrol_cng" | "diesel_cng" | "electric";
export type FleetVehicleIdentity = {
  model: string | null;
  year: number | null;
  name: string | null;
  fuelType: FleetFuelType | null;
};
export const FUEL_TYPE_LABEL: Record<FleetFuelType, string> = {
  diesel: "Diesel",
  petrol: "Petrol",
  cng: "CNG",
  petrol_cng: "Petrol + CNG",
  diesel_cng: "Diesel + CNG",
  electric: "Electric",
};
export function usesCng(t: FleetFuelType | null | undefined): boolean {
  return t === "cng" || t === "petrol_cng" || t === "diesel_cng";
}

/**
 * What this vehicle's two tanks actually hold — primary first.
 *
 * Fleet Edge only ever says "primary" and "secondary". It never names the
 * fuel, so which is which is a property of the vehicle, and getting it wrong
 * puts a correct number under the wrong heading with nothing to flag it.
 *
 * Confirmed for this fleet on 10 September 2026:
 *
 *  - The three bi-fuel buses (TATA MAGIC EXPRESS CNG 9+D BSV and similar)
 *    run CNG as the PRIMARY tank, with a small petrol tank as secondary.
 *  - The Winger and the city bus run diesel primary, and their secondary
 *    reading is not fuel at all — it is DEF (AdBlue), the emissions
 *    consumable. Reporting it as "tank 2" invites someone to read a low
 *    number as an empty fuel tank.
 *
 * This was previously assumed the other way round: tank 2 was labelled CNG
 * and tank 1 left generic, on a guess made in August before any tank reading
 * had ever arrived. Tata's portal shows CNG as the headline live figure
 * ("CNG Pressure 72%"), which is the primary. Had the first real reading
 * landed under the old assumption, a full CNG cylinder would have been
 * displayed as petrol.
 */
export function tankLabels(t: FleetFuelType | null | undefined): {
  primary: string;
  secondary: string;
} {
  switch (t) {
    case "petrol_cng":
      return { primary: "CNG", secondary: "petrol" };
    case "diesel_cng":
      return { primary: "CNG", secondary: "diesel" };
    case "cng":
      return { primary: "CNG", secondary: "CNG" };
    case "diesel":
      // Not a second fuel tank. BS-VI diesel carries DEF/AdBlue, and that is
      // what both diesel vehicles on this fleet report as their secondary.
      return { primary: "diesel", secondary: "DEF" };
    case "petrol":
      return { primary: "petrol", secondary: "tank 2" };
    case "electric":
      return { primary: "charge", secondary: "tank 2" };
    default:
      // Fuel type not recorded. Say nothing we do not know.
      return { primary: "tank 1", secondary: "tank 2" };
  }
}

export type FleetEdgeReport = {
  ok: true;
  from: string;
  to: string;
  generatedAt: string;
  kpis: Record<"high" | "average" | "low" | "offline", number>;
  totals: FleetTotals;
  vehicles: (VehicleDashboardRow & { identity: FleetVehicleIdentity | null })[];
  daily: FleetDailyPoint[];
  alerts: FleetAlertRow[];
  offlineHistory: OfflinePeriod[];
  notifications: FleetNotificationRow[];
  notifyMobiles: string[];
};

/** Fleet Edge sends "Not Due", "Over Due", a date… and "-" for unknown. */
export function isServiceDue(v: string | null | undefined): boolean {
  const t = (v || "").trim().toLowerCase();
  return !!t && t !== "not due" && t !== "-" && t !== "na" && t !== "n/a";
}

