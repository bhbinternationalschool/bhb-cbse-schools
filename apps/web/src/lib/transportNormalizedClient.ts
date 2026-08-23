/**
 * Client → server sync for transport desk slices.
 */

import type { TransportState } from "@/lib/transport";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";

const META_KEY = "bhb_transport_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: TransportState | null = null;

type DeskMeta = {
  updatedAt: string;
  routeCount: number;
  vehicleCount: number;
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") {
    return { updatedAt: "", routeCount: 0, vehicleCount: 0 };
  }
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return { updatedAt: "", routeCount: 0, vehicleCount: 0 };
    const p = JSON.parse(raw) as DeskMeta;
    return {
      updatedAt: String(p.updatedAt || ""),
      routeCount: Number(p.routeCount) || 0,
      vehicleCount: Number(p.vehicleCount) || 0,
    };
  } catch {
    return { updatedAt: "", routeCount: 0, vehicleCount: 0 };
  }
}

function writeMeta(patch: DeskMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify(patch));
}

export function scheduleTransportDeskSync(state: TransportState) {
  if (!isSupabaseConfigured()) return;
  if (typeof window === "undefined") return;
  pending = state;
  if (pushTimer) clearTimeout(pushTimer);
  pushTimer = setTimeout(() => {
    const batch = pending;
    pending = null;
    pushTimer = null;
    if (!batch) return;
    void pushTransportDeskApi(batch);
  }, DESK_PUSH_DEBOUNCE_MS);
}

async function pushTransportDeskApi(state: TransportState) {
  try {
    const res = await fetch("/api/school-data/transport-desk", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(state),
    });
    const body = (await res.json().catch(() => null)) as {
      ok?: boolean;
      updatedAt?: string;
      routeCount?: number;
      vehicleCount?: number;
      error?: string;
    } | null;
    if (res.ok && body?.ok) {
      writeMeta({
        updatedAt: body.updatedAt || new Date().toISOString(),
        routeCount: body.routeCount ?? state.routes.length,
        vehicleCount: body.vehicleCount ?? state.vehicles.length,
      });
    } else if (!res.ok) {
      console.warn("[transport-db] desk push failed", body?.error || res.status);
    }
  } catch (e) {
    console.warn("[transport-db] desk push error", e);
  }
}

export async function hydrateTransportDeskFromDb(
  preferDb?: boolean,
): Promise<{
  bundle: Omit<TransportState, "version">;
  changed: boolean;
  /** false = fetch failed; bundle is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const empty = {
    feePolicy: {
      academicYearCode: "",
      rateMode: "flat_route" as const,
      ratePerKmPaise: 0,
      minFeePaise: 0,
      maxFeePaise: null,
      slabs: [],
      bands: [],
      formula: { basePaise: 0, baseCoversKm: 0, perKmPaise: 0 },
      repairApprovalPaise: 0,
    },
    routes: [],
    assignments: [],
    vehicles: [],
    dealers: [],
    fuelStockLocations: [],
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
    staffRiders: [],
  };
  if (!isSupabaseConfigured()) return { bundle: empty, changed: false, ok: false };
  try {
    const res = await fetch("/api/school-data/transport-desk", {
      method: "GET",
      cache: "no-store",
    });
    if (!res.ok) return { bundle: empty, changed: false, ok: false };
    const body = (await res.json()) as Omit<TransportState, "version"> & {
      updatedAt?: string;
      routeCount?: number;
      vehicleCount?: number;
    };
    const bundle = {
      feePolicy: body.feePolicy ?? empty.feePolicy,
      routes: Array.isArray(body.routes) ? body.routes : [],
      assignments: Array.isArray(body.assignments) ? body.assignments : [],
      vehicles: Array.isArray(body.vehicles) ? body.vehicles : [],
      dealers: Array.isArray(body.dealers) ? body.dealers : [],
      fuelStockLocations: Array.isArray(body.fuelStockLocations)
        ? body.fuelStockLocations
        : [],
      fuelPurchases: Array.isArray(body.fuelPurchases) ? body.fuelPurchases : [],
      fuelRefillLogs: Array.isArray(body.fuelRefillLogs)
        ? body.fuelRefillLogs
        : [],
      payables: Array.isArray(body.payables) ? body.payables : [],
      vehicleLoans: Array.isArray(body.vehicleLoans) ? body.vehicleLoans : [],
      emiSchedule: Array.isArray(body.emiSchedule) ? body.emiSchedule : [],
      insurancePolicies: Array.isArray(body.insurancePolicies)
        ? body.insurancePolicies
        : [],
      certificateRenewals: Array.isArray(body.certificateRenewals)
        ? body.certificateRenewals
        : [],
      serviceJobCards: Array.isArray(body.serviceJobCards)
        ? body.serviceJobCards
        : [],
      repairRequests: Array.isArray(body.repairRequests)
        ? body.repairRequests
        : [],
      boardingEvents: Array.isArray(body.boardingEvents)
        ? body.boardingEvents
        : [],
      gpsPings: Array.isArray(body.gpsPings) ? body.gpsPings : [],
      staffRiders: Array.isArray(body.staffRiders) ? body.staffRiders : [],
    };
    const meta = readMeta();
    const remoteRoutes = body.routeCount ?? bundle.routes.length;
    const shouldTake =
      preferDb ||
      process.env.NEXT_PUBLIC_TRANSPORT_READ_FROM_DB === "true" ||
      meta.routeCount === 0 ||
      (body.updatedAt && body.updatedAt >= meta.updatedAt) ||
      remoteRoutes > meta.routeCount ||
      bundle.routes.length > 0 ||
      bundle.vehicles.length > 0;
    if (!shouldTake) return { bundle: empty, changed: false, ok: true };
    writeMeta({
      updatedAt: body.updatedAt || new Date().toISOString(),
      routeCount: remoteRoutes,
      vehicleCount: body.vehicleCount ?? bundle.vehicles.length,
    });
    return { bundle, changed: true, ok: true };
  } catch {
    return { bundle: empty, changed: false, ok: false };
  }
}
