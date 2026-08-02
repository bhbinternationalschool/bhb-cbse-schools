/**
 * Transport desk — Supabase slice rows (transport_desk_slices).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransportState } from "@/lib/transport";
import { defaultFeePolicy } from "@/lib/transport";
import { transportDualWriteDbEnabled } from "@/lib/transportDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type TransportSliceKey = keyof Omit<TransportState, "version">;

export const TRANSPORT_SLICE_KEYS: TransportSliceKey[] = [
  "feePolicy",
  "routes",
  "assignments",
  "vehicles",
  "dealers",
  "fuelStockLocations",
  "fuelPurchases",
  "fuelRefillLogs",
  "payables",
  "vehicleLoans",
  "emiSchedule",
  "insurancePolicies",
  "certificateRenewals",
  "serviceJobCards",
  "repairRequests",
  "boardingEvents",
  "gpsPings",
];

export type TransportDeskSyncMeta = {
  sliceCount: number;
  routeCount: number;
  vehicleCount: number;
  assignmentCount: number;
  lastUpdatedAt: string | null;
  updatedAt: string;
};

export type TransportDeskBundle = Omit<TransportState, "version">;

const META_SELECT =
  "slice_count, route_count, vehicle_count, assignment_count, last_updated_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

function nowIso() {
  return new Date().toISOString();
}

function emptyBundle(): TransportDeskBundle {
  return {
    feePolicy: defaultFeePolicy(),
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
  };
}

function stateToSlices(state: TransportState): {
  key: TransportSliceKey;
  payload: unknown;
}[] {
  return TRANSPORT_SLICE_KEYS.map((key) => ({
    key,
    payload: state[key],
  }));
}

function slicesToBundle(
  sliceMap: Partial<Record<TransportSliceKey, unknown>>,
): TransportDeskBundle {
  const empty = emptyBundle();
  const bundle = { ...empty };
  for (const key of TRANSPORT_SLICE_KEYS) {
    const payload = sliceMap[key];
    if (payload === undefined || payload === null) continue;
    if (key === "feePolicy" && typeof payload === "object") {
      bundle.feePolicy = payload as TransportDeskBundle["feePolicy"];
      continue;
    }
    if (Array.isArray(payload)) {
      (bundle as Record<string, unknown>)[key] = payload;
    }
  }
  return bundle;
}

function bundleToState(bundle: TransportDeskBundle): TransportState {
  return { version: 2, ...bundle };
}

export async function pushTransportDeskToDb(
  state: TransportState,
): Promise<{ ok: boolean; error?: string }> {
  if (!transportDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();
  const slices = stateToSlices(state);

  const rows = slices
    .filter(({ key, payload }) => {
      if (key === "feePolicy") return payload != null;
      return Array.isArray(payload) && payload.length > 0;
    })
    .map(({ key, payload }) => ({
      tenant_id: tenantId,
      slice_key: key,
      payload,
      updated_at: now,
    }));

  const { data: existing } = await sb
    .from("transport_desk_slices")
    .select("slice_key")
    .eq("tenant_id", tenantId);
  const keep = new Set<string>(rows.map((r) => String(r.slice_key)));
  const stale = (existing ?? [])
    .map((r) => String((r as { slice_key: string }).slice_key))
    .filter((k) => !keep.has(k));
  if (stale.length > 0) {
    await sb
      .from("transport_desk_slices")
      .delete()
      .eq("tenant_id", tenantId)
      .in("slice_key", stale);
  }

  if (rows.length > 0) {
    const { error } = await sb.from("transport_desk_slices").upsert(rows);
    if (error) return { ok: false, error: error.message };
  } else {
    await sb.from("transport_desk_slices").delete().eq("tenant_id", tenantId);
  }

  await sb.from("transport_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      slice_count: rows.length,
      route_count: state.routes?.length ?? 0,
      vehicle_count: state.vehicles?.length ?? 0,
      assignment_count: state.assignments?.length ?? 0,
      last_updated_at: now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchTransportDeskFromDb(): Promise<{
  bundle: TransportDeskBundle;
  meta: TransportDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  const empty = emptyBundle();
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [{ data: sliceRows }, { data: metaRow }] = await Promise.all([
    sb.from("transport_desk_slices").select("*").eq("tenant_id", tenantId),
    sb
      .from("transport_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const sliceMap: Partial<Record<TransportSliceKey, unknown>> = {};
  for (const row of sliceRows ?? []) {
    const r = row as { slice_key: string; payload: unknown };
    const key = r.slice_key as TransportSliceKey;
    if (TRANSPORT_SLICE_KEYS.includes(key)) sliceMap[key] = r.payload;
  }

  const bundle = slicesToBundle(sliceMap);

  const meta: TransportDeskSyncMeta | null = metaRow
    ? {
        sliceCount: Number(metaRow.slice_count ?? 0),
        routeCount: Number(metaRow.route_count ?? bundle.routes.length),
        vehicleCount: Number(metaRow.vehicle_count ?? bundle.vehicles.length),
        assignmentCount: Number(
          metaRow.assignment_count ?? bundle.assignments.length,
        ),
        lastUpdatedAt: metaRow.last_updated_at
          ? String(metaRow.last_updated_at)
          : null,
        updatedAt: String(metaRow.updated_at || ""),
      }
    : null;

  return { bundle, meta };
}

export function deskBundleToTransportState(
  bundle: TransportDeskBundle,
): TransportState {
  return bundleToState(bundle);
}
