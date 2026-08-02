#!/usr/bin/env npx tsx
/**
 * Seed transport_desk_* — demo bus + route (matches seedTransportIfEmpty).
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-transport-desk.ts
 */

import { DEFAULT_AY } from "../src/lib/masters";
import {
  defaultFeePolicy,
  type FleetDealer,
  type FleetVehicle,
  type FuelStockLocation,
  type TransportRoute,
  type TransportState,
  type TransportStop,
} from "../src/lib/transport";
import {
  fetchTransportDeskFromDb,
  pushTransportDeskToDb,
} from "../src/lib/transportNormalized.server";

async function main() {
  const vehId = "veh_seed_bus3";
  const routeId = "tr_seed_r12";
  const now = new Date().toISOString();

  const stops: TransportStop[] = [
    { id: "st_seed_1", name: "Lanka Gate", sequence: 1, distanceKm: 2 },
    { id: "st_seed_2", name: "BHU Gate", sequence: 2, distanceKm: 4 },
    { id: "st_seed_3", name: "Sigra", sequence: 3, distanceKm: 6 },
    { id: "st_seed_4", name: "Cantonment", sequence: 4, distanceKm: 8 },
  ];

  const vehicle: FleetVehicle = {
    id: vehId,
    registrationNo: "UP32 BT 4512",
    name: "Bus 3",
    type: "bus",
    fuelType: "diesel",
    fuelUnit: "liter",
    tankCapacity: 120,
    odometerKm: 45200,
    avgMileage: 6.5,
    primaryRouteId: routeId,
    photoUrl: "",
    seatCapacity: 40,
    driverName: "",
    driverMobile: "",
    status: "active",
    compliance: [],
    serviceSchedule: [],
    isActive: true,
    createdAt: now,
  };

  const route: TransportRoute = {
    id: routeId,
    code: "R-12",
    name: "Lanka – Cantonment",
    busNo: "Bus 3",
    vehicleReg: vehicle.registrationNo,
    vehicleId: vehId,
    monthlyFeePaise: 120000,
    isActive: true,
    stops,
  };

  const dealer: FleetDealer = {
    id: "dlr_seed_iocl",
    name: "IOCL Sigra Pump",
    type: "fuel_dealer",
    phone: "",
    gstin: "",
    paymentTermsDays: 15,
    isActive: true,
  };

  const fuelStockLocations: FuelStockLocation[] = [
    {
      id: "fsl_seed_depot",
      name: "Campus diesel depot",
      fuelType: "diesel",
      qtyOnHand: 200,
      minAlert: 40,
      maxCapacity: 500,
    },
  ];

  const state: TransportState = {
    version: 2,
    feePolicy: defaultFeePolicy(DEFAULT_AY),
    routes: [route],
    assignments: [],
    vehicles: [vehicle],
    dealers: [dealer],
    fuelStockLocations,
    fuelPurchases: [],
    fuelRefillLogs: [],
    payables: [],
    vehicleLoans: [],
    emiSchedule: [],
    insurancePolicies: [],
    certificateRenewals: [],
    serviceJobCards: [],
    repairRequests: [],
    boardingEvents: [],
    gpsPings: [],
  };

  console.log(
    `Seeding transport desk — ${state.routes.length} route(s), ${state.vehicles.length} vehicle(s)`,
  );

  const before = await fetchTransportDeskFromDb();
  console.log(
    `DB before: ${before.bundle.routes.length} routes, ${before.meta?.sliceCount ?? 0} slices`,
  );

  const result = await pushTransportDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchTransportDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.bundle.routes.length} routes, ${after.meta?.sliceCount ?? 0} slices`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
