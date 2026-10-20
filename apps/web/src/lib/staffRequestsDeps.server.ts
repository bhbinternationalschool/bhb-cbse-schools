/**
 * The real dependencies of Staff → Requests (lib/staffRequests.server.ts):
 * the staff guard, a per-process referenceCache over the `staffRequests`
 * slice keyed on erp_versions `staff_hr` (data-layer 1.3/R5: a slice desk is
 * read whole on the server and filtered in Node), and the write kernel's
 * desk_slice_row_write through repo.writeSliceElement.
 */
import "server-only";

import { randomUUID } from "node:crypto";
import { hasMirrorSyncSecret, requireStaffApi } from "@/lib/apiRouteAuth.server";
import { referenceCache, type BuildResult } from "@/lib/data/server/referenceCache";
import { writeSliceElement } from "@/lib/data/server/repo";
import { getServerTenantContext } from "@/lib/serverTenant";
import { notify } from "@/lib/notify/notify.server";
import type { StaffRequestRow } from "@/lib/staffRequestsShared";
import { staffRequestsOfSlice, type StaffRequestsDeps } from "./staffRequests.server";

const SLICE = { table: "staff_hr_desk_slices", key: "staffRequests", base: "rev" } as const;

async function buildRequests(): Promise<BuildResult<StaffRequestRow[]>> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { data, error } = await ctx.sb
    .from(SLICE.table)
    .select("payload")
    .eq("tenant_id", ctx.tenantId)
    .eq("slice_key", SLICE.key)
    .maybeSingle();
  // A failed read is a failed build (the cache keeps its previous copy or the view answers 503).
  if (error) return { ok: false, error: error.message };
  try {
    return { ok: true, value: staffRequestsOfSlice((data as { payload?: unknown } | null)?.payload ?? null) };
  } catch (e) {
    return { ok: false, error: (e as Error).message };
  }
}

const requestsCache = referenceCache<StaffRequestRow[]>("staff_requests", ["staff_hr"], buildRequests);

export const staffRequestsDeps: StaffRequestsDeps = {
  requireStaff: (req) => requireStaffApi(req),
  mirrorSecret: (req) => hasMirrorSyncSecret(req),
  readRequests: () => requestsCache.read(),
  write: (op) => writeSliceElement(SLICE, op),
  invalidate: () => requestsCache.invalidate(),
  now: () => new Date(),
  newId: () => `req_${randomUUID()}`,
  notify: (ev) => notify(ev),
};
