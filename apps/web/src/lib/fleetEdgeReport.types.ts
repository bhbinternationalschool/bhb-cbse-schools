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

