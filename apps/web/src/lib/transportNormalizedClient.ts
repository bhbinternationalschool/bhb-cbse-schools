/**
 * Client → server sync for transport desk slices.
 */

import type { TransportState } from "@/lib/transport";
import { isSupabaseConfigured } from "@/lib/supabase/client";
import { DESK_PUSH_DEBOUNCE_MS } from "@/lib/workspaceSyncPolicy";
import {
  recordDeskSyncFailure,
  recordDeskSyncSuccess,
} from "@/lib/deskSyncStatus";
import { recordTransportDeskAnswer } from "@/lib/transportHydrationState";

const META_KEY = "bhb_transport_desk_db_meta_v1";
let pushTimer: ReturnType<typeof setTimeout> | null = null;
let pending: TransportState | null = null;

export type DeskMeta = {
  updatedAt: string;
  routeCount: number;
  vehicleCount: number;
  /** What the server last said it held. 0 on metas written before 14 Sep 2026. */
  assignmentCount: number;
};

const EMPTY_META: DeskMeta = {
  updatedAt: "",
  routeCount: 0,
  vehicleCount: 0,
  assignmentCount: 0,
};

function readMeta(): DeskMeta {
  if (typeof window === "undefined") return EMPTY_META;
  try {
    const raw = localStorage.getItem(META_KEY);
    if (!raw) return EMPTY_META;
    const p = JSON.parse(raw) as Partial<DeskMeta>;
    return {
      updatedAt: String(p.updatedAt || ""),
      routeCount: Number(p.routeCount) || 0,
      vehicleCount: Number(p.vehicleCount) || 0,
      assignmentCount: Number(p.assignmentCount) || 0,
    };
  } catch {
    return EMPTY_META;
  }
}

function writeMeta(patch: DeskMeta) {
  if (typeof window === "undefined") return;
  localStorage.setItem(META_KEY, JSON.stringify(patch));
}

/**
 * Is this a desk worth sending, or the shape of a client that never loaded?
 *
 * Nothing in the UI empties routes, vehicles and assignments all at once —
 * deactivating a route sets isActive=false and ending an assignment sets
 * effectiveTo, both of which keep the row. So an all-empty desk is never a
 * decision; it is a client that failed to hydrate, and on 12 Sep 2026 it was
 * a client whose cache had been dropped for quota.
 *
 * The server already refuses these (pushTransportDeskToDb's PROTECTED guard),
 * which is the 502 the director saw eight times. Catching it here as well is
 * not belt and braces: an empty push that reaches the server is one
 * misconfiguration away from being accepted, and it costs a round trip and an
 * error in the console every few seconds in the meantime.
 */
/**
 * Why this desk must not be sent, or null when it may be.
 *
 * Two shapes are refused. All-empty (above). And — added 14 Sep 2026 — a
 * desk with NO routes or NO assignments when the server's last answer
 * (`meta`) said it holds some. That is the shape a phone produced after its
 * cache was dropped for quota: `seedTransportIfEmpty` gave it five vehicles,
 * so it was not all-empty, and the server refused it twelve times. A desk
 * that has lost its routes while the database has them is a client that lost
 * its cache, not an office that deleted every route; deactivating a route
 * sets isActive=false and keeps the row.
 *
 * Exported for the self-test; pure on purpose.
 */
export function whyDeskIsUnsendable(
  state: TransportState,
  meta: Pick<DeskMeta, "routeCount" | "assignmentCount">,
): string | null {
  const routes = state.routes?.length ?? 0;
  const vehicles = state.vehicles?.length ?? 0;
  const assignments = state.assignments?.length ?? 0;
  if (routes === 0 && vehicles === 0 && assignments === 0) {
    return "no routes, vehicles or assignments";
  }
  if (routes === 0 && meta.routeCount > 0) {
    return `no routes, while the server holds ${meta.routeCount}`;
  }
  if (assignments === 0 && meta.assignmentCount > 0) {
    return `no assignments, while the server holds ${meta.assignmentCount}`;
  }
  return null;
}

let emptyPushWarned = false;

export function scheduleTransportDeskSync(state: TransportState) {
  if (!isSupabaseConfigured()) return;
  if (typeof window === "undefined") return;
  const refusal = whyDeskIsUnsendable(state, readMeta());
  if (refusal) {
    if (!emptyPushWarned) {
      emptyPushWarned = true;
      console.warn(
        `[transport-db] not pushing this desk — ${refusal}. This client has ` +
          "not hydrated, or its cache was dropped; the database is left as it " +
          "is. Reload, and if it persists this browser's storage is full.",
      );
    }
    return;
  }
  emptyPushWarned = false;
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
        assignmentCount: state.assignments?.length ?? 0,
      });
    } else if (!res.ok) {
      console.warn("[transport-db] desk push failed", body?.error || res.status);
    }
    // Record whether this actually landed. A not-ok response is not
    // thrown, so without this it slips past every branch in silence.
    if (res.ok && body?.ok) recordDeskSyncSuccess("transport");
    else recordDeskSyncFailure("transport", { status: res.status, error: body?.error });
  } catch (e) {
    recordDeskSyncFailure("transport", { status: 0, error: e instanceof Error ? e.message : String(e) });
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
      assignmentCount?: number;
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
    const remoteAssignments = body.assignmentCount ?? bundle.assignments.length;
    // The server has answered. Recorded before the take/skip decision, so a
    // skipped take still tells seedTransportIfEmpty the truth.
    recordTransportDeskAnswer({
      routes: remoteRoutes,
      vehicles: body.vehicleCount ?? bundle.vehicles.length,
      assignments: remoteAssignments,
    });
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
      assignmentCount: remoteAssignments,
    });
    return { bundle, changed: true, ok: true };
  } catch {
    return { bundle: empty, changed: false, ok: false };
  }
}
