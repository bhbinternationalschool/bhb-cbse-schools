/**
 * Transport desk — Supabase slice rows (transport_desk_slices).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { TransportState } from "@/lib/transport";
import { defaultFeePolicy } from "@/lib/transport";
import { transportDualWriteDbEnabled } from "@/lib/transportDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";
import { mergeWithRevs, rowRev } from "@/lib/sliceRevMerge";
import { casWriteSlice } from "@/lib/sliceCas.server";

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
  "staffRiders",
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
    staffRiders: [],
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

/**
 * Append one boarding event, touching only the boardingEvents slice.
 *
 * Deliberately NOT a whole-desk push. The driver's phone knows about one child
 * at one stop; it has no business sending back a routes or assignments slice,
 * and a read-modify-write of the entire desk from a handset on a patchy 4G
 * connection is exactly how the desk got wiped on 2026-08-21. This reads the
 * one slice it needs and writes the one slice it changed.
 *
 * Idempotent per student per trip per day: marking the same child twice
 * updates the existing record rather than stacking duplicates, because a
 * driver tapping again after a dead spot is expected, not an error.
 */
export async function appendBoardingEventToDb(event: {
  id: string;
  date: string;
  routeId: string;
  trip: "AM" | "PM";
  /** Which timed run, when the route has them. "" = none, not "the first". */
  shiftId?: string;
  studentId: string;
  status: "boarded" | "absent" | "unauthorized";
  note: string;
  createdAt: string;
  boardedLocation?: unknown;
  offboardedLocation?: unknown;
}): Promise<{ ok: boolean; error?: string }> {
  if (!transportDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;

  const sameSlot = (e: Record<string, unknown>) =>
    e.studentId === event.studentId &&
    e.date === event.date &&
    e.trip === event.trip &&
    e.routeId === event.routeId;

  // Conditional write: if a desk save (or another phone) wrote the boarding
  // log after this read, re-read and re-apply — never overwrite it.
  const written = await casWriteSlice(sb, "transport_desk_slices", tenantId, "boardingEvents", (stored) => {
    const existing = Array.isArray(stored) ? (stored as Record<string, unknown>[]) : [];
    const prior = existing.find(sameSlot);
    // A changed or new event gets a new server version, so an office tab
    // holding the older copy can't write it back (sliceRevMerge).
    return prior
      ? existing.map((e) =>
          sameSlot(e)
            ? {
                ...e,
                ...event,
                _rev: rowRev(e) + 1,
                id: (e.id as string) ?? event.id,
                // A later offboard must not erase the earlier boarding pin.
                boardedLocation: event.boardedLocation ?? e.boardedLocation ?? null,
                offboardedLocation:
                  event.offboardedLocation ?? e.offboardedLocation ?? null,
              }
            : e,
        )
      : [{ ...event, _rev: 1 }, ...existing];
  });
  if (!written.ok) return { ok: false, error: written.error };
  return { ok: true };
}

/**
 * What a desk save writes for one slice: the fee policy as sent; every list
 * merged by id into what is stored (nothing in the transport UI deletes a
 * row); GPS pings kept as the newest 500, as on the device. Pure, so a
 * conditional write can re-apply it to a fresher copy.
 */
function mergeTransportSlice(
  key: string,
  stored: unknown,
  incoming: unknown,
  base?: Record<string, number>,
): { value: unknown; revs: Record<string, number>; conflicts: string[] } {
  if (key === "feePolicy") return { value: incoming, revs: {}, conflicts: [] };
  // Per-row server versions (sliceRevMerge): a browser's changed row lands
  // only if the stored row is still at the version it changed it from.
  const merged = mergeWithRevs(stored, incoming as unknown[], { base });
  let value: unknown = merged.rows;
  if (key === "gpsPings") {
    value = (value as { recordedAt?: string }[])
      .slice()
      .sort((x, y) => String(y.recordedAt ?? "").localeCompare(String(x.recordedAt ?? "")))
      .slice(0, 500);
  }
  return { value, revs: merged.revs, conflicts: merged.conflicts };
}

export type TransportPushResult = {
  ok: boolean;
  error?: string;
  /** slice → id → the new `_rev` of each row this save wrote. */
  revs?: Record<string, Record<string, number>>;
  /** slice → ids changed from a version that is no longer current (not written). */
  conflicts?: Record<string, string[]>;
};

export async function pushTransportDeskToDb(
  state: TransportState,
  /** slice → id → the `_rev` each changed row was changed from. */
  opts: { revs?: Record<string, Record<string, number>> } = {},
): Promise<TransportPushResult> {
  if (!transportDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();
  const slices = stateToSlices(state);

  // No slice is deleted and no collection is replaced. Each slice row holds a
  // whole list, and a save used to delete every list it lacked (2026-08-21:
  // an unauthenticated page load erased routes and assignments, after which
  // four were protected) and overwrite every list it carried with its own
  // copy — so an office tab overwrote the boarding log the drivers' phones
  // append on the server. Nothing in the transport UI deletes a row
  // (routes deactivate, assignments end), so a save MERGES by id: its rows
  // win for their ids and every stored row it lacks is kept. A desk we cannot
  // read is unknown, not empty — nothing is written.
  const { data: storedRows, error: readErr } = await sb
    .from("transport_desk_slices")
    .select("slice_key, payload")
    .eq("tenant_id", tenantId);
  if (readErr) {
    return { ok: false, error: `Could not read the saved transport desk — nothing was written: ${readErr.message}` };
  }
  const stored = new Map<string, unknown>();
  for (const r of storedRows ?? []) {
    stored.set(String((r as { slice_key: string }).slice_key), (r as { payload: unknown }).payload);
  }

  // Each carried slice is merged into the stored one and written only if no
  // other write (a driver's boarding tap, another office tab) landed since it
  // was read — otherwise re-read and re-merged (casWriteSlice). A plain
  // upsert let the second of two simultaneous writers silently drop the
  // first one's change.
  const carried = slices.filter(({ key, payload }) => {
    if (key === "feePolicy") return payload != null;
    return Array.isArray(payload) && payload.length > 0;
  });
  if (carried.length === 0) return { ok: true };
  const rows: { slice_key: string; payload: unknown }[] = [];
  const revs: Record<string, Record<string, number>> = {};
  const conflicts: Record<string, string[]> = {};
  for (const { key, payload } of carried) {
    let last = { revs: {} as Record<string, number>, conflicts: [] as string[] };
    const written = await casWriteSlice(sb, "transport_desk_slices", tenantId, key, (storedNow) => {
      const r = mergeTransportSlice(key, storedNow, payload, opts.revs?.[key]);
      last = { revs: r.revs, conflicts: r.conflicts };
      return r.value;
    });
    if (!written.ok) return { ok: false, error: written.error, revs, conflicts };
    rows.push({ slice_key: key, payload: written.payload });
    if (Object.keys(last.revs).length) revs[key] = last.revs;
    if (last.conflicts.length) conflicts[key] = last.conflicts;
  }

  const count = (key: TransportSliceKey): number => {
    const row = rows.find((r) => r.slice_key === key);
    const v = row ? row.payload : stored.get(key);
    return Array.isArray(v) ? v.length : 0;
  };

  await sb.from("transport_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      slice_count: new Set([...stored.keys(), ...rows.map((r) => r.slice_key)]).size,
      route_count: count("routes"),
      vehicle_count: count("vehicles"),
      assignment_count: count("assignments"),
      last_updated_at: now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true, revs, conflicts };
}

export async function fetchTransportDeskFromDb(): Promise<{
  bundle: TransportDeskBundle;
  meta: TransportDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; bundle is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  const empty = emptyBundle();
  if (!ctx) return { bundle: empty, meta: null, ok: false };
  const { sb, tenantId } = ctx;

  const [
    { data: sliceRows, error: sliceErr },
    { data: metaRow },
  ] = await Promise.all([
    sb.from("transport_desk_slices").select("*").eq("tenant_id", tenantId),
    sb
      .from("transport_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (sliceErr) {
    console.warn("[transport-db] fetch failed", sliceErr.message);
    return { bundle: empty, meta: null, ok: false };
  }

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

  return { bundle, meta, ok: true };
}

export function deskBundleToTransportState(
  bundle: TransportDeskBundle,
): TransportState {
  return bundleToState(bundle);
}
