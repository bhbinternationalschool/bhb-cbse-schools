/**
 * The 21 Oct 2026 fuel per-bus case: one CNG bus with four September fills,
 * written through the app's own server write paths by `seedFuelRangeCase` —
 * the transport desk push (the vehicle, merged into the saved desk) and
 * addOfficeFill (the Transport → Fuel "add" write). Run under tsx
 * (scripts/e2e-seed-fuel-range.ts), because the server modules import each
 * other through the "@/" alias, which Playwright's loader does not resolve.
 *
 * Idempotent: the vehicle replaces only itself, the fills upsert by id.
 * Never posted to accounts (no payment mode), so no voucher is written.
 */
import { assertLocalStack } from "./session";
import type { TransportState } from "@/lib/transport";

export const FUEL_BUS = { id: "veh_e2e_fuel_range", registrationNo: "UP65E2E0921", name: "E2E Fuel Bus" };

/** Fills a 8–20 Sep 2026 period holds: f2 and f3 (f1 before, f4 after, all September). */
export const FUEL_FILLS = [
  { id: "e2e_fuelr_1", fillDate: "2026-09-03", quantity: 6, amountPaise: 54_000, odometerKm: 5000 },
  { id: "e2e_fuelr_2", fillDate: "2026-09-09", quantity: 7, amountPaise: 63_050, odometerKm: 5180 },
  { id: "e2e_fuelr_3", fillDate: "2026-09-16", quantity: 8, amountPaise: 72_000, odometerKm: 5400 },
  { id: "e2e_fuelr_4", fillDate: "2026-09-24", quantity: 9, amountPaise: 81_000, odometerKm: 5650 },
];
export const FUEL_RANGE = { from: "2026-09-08", to: "2026-09-20" };

export async function seedFuelRangeCase(): Promise<void> {
  assertLocalStack();
  const { fetchTransportDeskFromDb, pushTransportDeskToDb } = await import("@/lib/transportNormalized.server");
  const { normalizeVehicle } = await import("@/lib/transport");
  const { addOfficeFill } = await import("@/lib/transportFuelRegister.server");

  const saved = await fetchTransportDeskFromDb();
  if (!saved.ok) throw new Error("transport desk unreadable");
  const b = saved.bundle;
  const vehicle = normalizeVehicle({
    ...FUEL_BUS,
    type: "bus",
    fuelType: "cng",
    status: "active",
    isActive: true,
    createdAt: "2026-09-01T04:00:00.000Z",
  });
  const transport = {
    ...b,
    version: 2,
    vehicles: [...b.vehicles.filter((v) => v.id !== FUEL_BUS.id), vehicle],
  } as unknown as TransportState;
  const t = await pushTransportDeskToDb(transport);
  if (!t.ok) throw new Error(`transport desk: ${t.error}`);

  for (const f of FUEL_FILLS) {
    await addOfficeFill({
      id: f.id,
      vehicleId: FUEL_BUS.id,
      fillDate: f.fillDate,
      quantity: f.quantity,
      unit: "kg",
      fuelType: "cng",
      ratePaise: null,
      amountPaise: f.amountPaise,
      odometerKm: f.odometerKm,
      receiptPath: "",
      note: "e2e fuel per-bus range case",
      dealerName: "E2E CNG pump",
      billNo: "",
      paymentMode: "",
      bankAccountId: "",
      paymentRef: "",
      staffId: "",
      name: "e2e seed",
    });
  }
}
