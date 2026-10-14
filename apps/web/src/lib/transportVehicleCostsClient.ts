/**
 * Browser read of GET /api/transport/vehicle-costs. Throws on any failure —
 * a caller shows "could not be read", never an empty list.
 */
import type { VehicleCosts } from "@/lib/transportVehicleCosts";

export async function fetchVehicleCosts(): Promise<VehicleCosts> {
  const res = await fetch("/api/transport/vehicle-costs", { credentials: "same-origin", cache: "no-store" });
  type Body = Partial<VehicleCosts> & { ok?: boolean; error?: string };
  const body = (await res.json().catch(() => null)) as Body | null;
  if (!res.ok || !body?.ok || !body.loans) {
    throw new Error(body?.error || `the server answered ${res.status}`);
  }
  return {
    fills: Array.isArray(body.fills) ? body.fills : null,
    ...(body.fillsError ? { fillsError: body.fillsError } : {}),
    docs: Array.isArray(body.docs) ? body.docs : null,
    loans: body.loans,
  };
}
