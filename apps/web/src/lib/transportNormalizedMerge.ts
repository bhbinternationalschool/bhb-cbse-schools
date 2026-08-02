import type { TransportState } from "@/lib/transport";
import { transportReadFromDbEnabled } from "@/lib/transportDbConfig";
import type { TransportDeskBundle } from "@/lib/transportNormalized.server";

export function mergeDbDeskIntoTransportState(
  state: TransportState,
  bundle: TransportDeskBundle,
  opts?: { preferDb?: boolean },
): TransportState {
  const hasRemote =
    bundle.routes.length > 0 ||
    bundle.vehicles.length > 0 ||
    bundle.assignments.length > 0;
  if (!hasRemote && !transportReadFromDbEnabled() && !opts?.preferDb) {
    return state;
  }

  const preferDb = !!opts?.preferDb || transportReadFromDbEnabled();

  function mergeArray<K extends keyof TransportDeskBundle>(
    key: K,
  ): TransportState[K] {
    const local = state[key];
    const remote = bundle[key];
    if (!Array.isArray(local) || !Array.isArray(remote)) return remote as TransportState[K];
    if (preferDb || local.length === 0 || remote.length >= local.length) {
      return remote as TransportState[K];
    }
    const byId = new Map<string, (typeof local)[number]>();
    for (const row of local) {
      const id = (row as { id: string }).id;
      byId.set(id, row);
    }
    for (const row of remote) {
      const id = (row as { id: string }).id;
      byId.set(id, row);
    }
    return [...byId.values()] as TransportState[K];
  }

  return {
    version: 2,
    feePolicy: preferDb ? bundle.feePolicy : state.feePolicy,
    routes: mergeArray("routes"),
    assignments: mergeArray("assignments"),
    vehicles: mergeArray("vehicles"),
    dealers: mergeArray("dealers"),
    fuelStockLocations: mergeArray("fuelStockLocations"),
    fuelPurchases: mergeArray("fuelPurchases"),
    fuelRefillLogs: mergeArray("fuelRefillLogs"),
    payables: mergeArray("payables"),
    vehicleLoans: mergeArray("vehicleLoans"),
    emiSchedule: mergeArray("emiSchedule"),
    insurancePolicies: mergeArray("insurancePolicies"),
    certificateRenewals: mergeArray("certificateRenewals"),
    serviceJobCards: mergeArray("serviceJobCards"),
    repairRequests: mergeArray("repairRequests"),
    boardingEvents: mergeArray("boardingEvents"),
    gpsPings: mergeArray("gpsPings"),
  };
}
