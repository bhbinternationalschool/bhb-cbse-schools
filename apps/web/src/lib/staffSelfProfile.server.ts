import "server-only";

import { randomUUID } from "node:crypto";
import type { StaffRecord } from "@/lib/foundationMasters";
import { getServerTenantContext } from "@/lib/serverTenant";
import { rowToStaff, resetStaffPersistenceCache } from "@/lib/staffPersistence";
import {
  addProfileRequest,
  normalizeProfileRequests,
  STAFF_PROFILE_REQUESTS_KEY,
  type StaffProfileRequestsState,
} from "@/lib/staffSelfProfile";

/** StaffRecord keys that also live in their own sis_staff column. */
const COLUMN_OF: Record<string, string> = {
  fullName: "full_name",
  mobile: "mobile",
  email: "email",
};

/** One staff row, live from sis_staff (never a cached roster). null = read failed / not found. */
export async function readOwnStaff(staffId: string): Promise<{ staff: StaffRecord; updatedAt: string } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx || !staffId) return null;
  const { data, error } = await ctx.sb.from("sis_staff").select("*").eq("tenant_id", ctx.tenantId).eq("id", staffId).maybeSingle();
  if (error || !data) return null;
  return { staff: rowToStaff(data as never), updatedAt: String((data as { updated_at?: string }).updated_at || "") };
}

/**
 * Write these fields of ONE staff row — the profile copy and, where it
 * exists, the column — conditional on the row not having moved since it
 * was read (as lib/udiseTeacherSync.server updateStaffFields). Retried on a
 * clash with a fresh read: these are the person's own few fields, merged
 * into whatever the row holds now.
 */
export async function patchStaffRow(
  staffId: string,
  patch: (profile: Record<string, unknown>) => Record<string, unknown>,
): Promise<{ ok: true; updatedAt: string; profile: Record<string, unknown> } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  for (let attempt = 0; attempt < 3; attempt++) {
    const read = await ctx.sb.from("sis_staff").select("profile, updated_at").eq("tenant_id", ctx.tenantId).eq("id", staffId).maybeSingle();
    if (read.error) return { ok: false, error: read.error.message };
    if (!read.data) return { ok: false, error: "Staff member not found" };
    const before = { ...((read.data.profile as Record<string, unknown>) || {}) };
    const changes = patch(before);
    const profile = { ...before, ...changes };
    const update: Record<string, unknown> = {};
    for (const [k, v] of Object.entries(changes)) if (COLUMN_OF[k]) update[COLUMN_OF[k]] = v;
    const now = new Date().toISOString();
    const r = await ctx.sb
      .from("sis_staff")
      .update({ ...update, profile, updated_at: now })
      .eq("tenant_id", ctx.tenantId)
      .eq("id", staffId)
      .eq("updated_at", String(read.data.updated_at))
      .select("id");
    if (r.error) return { ok: false, error: r.error.message };
    if (r.data?.length) {
      // The roster is cached per instance; the next reader must see this.
      resetStaffPersistenceCache();
      try {
        const { invalidateServerMastersCache } = await import("@/lib/api/v1/auth");
        invalidateServerMastersCache();
      } catch {
        /* best effort */
      }
      return { ok: true, updatedAt: now, profile };
    }
  }
  return { ok: false, error: "Your record was being saved by someone else at the same moment — try again." };
}

export async function readProfileRequests(): Promise<{ state: StaffProfileRequestsState; updatedAt: string } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", STAFF_PROFILE_REQUESTS_KEY)
    .maybeSingle();
  if (error) return null;
  return { state: normalizeProfileRequests(data?.state), updatedAt: data?.updated_at ? String(data.updated_at) : "" };
}

/** Read–change–write with compare-and-set; retried on a clash. */
export async function changeProfileRequests(
  change: (s: StaffProfileRequestsState) => StaffProfileRequestsState | { error: string },
): Promise<{ ok: true; state: StaffProfileRequestsState } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  for (let attempt = 0; attempt < 3; attempt++) {
    const got = await readProfileRequests();
    if (!got) return { ok: false, error: "Could not read the profile requests — try again." };
    const next = change(got.state);
    if ("error" in next) return { ok: false, error: next.error };
    const now = new Date().toISOString();
    if (got.updatedAt) {
      const r = await ctx.sb
        .from("module_local_state")
        .update({ state: next, updated_at: now })
        .eq("tenant_id", ctx.tenantId)
        .eq("module_key", STAFF_PROFILE_REQUESTS_KEY)
        .eq("updated_at", got.updatedAt)
        .select("module_key");
      if (r.error) return { ok: false, error: r.error.message };
      if (r.data?.length) return { ok: true, state: next };
    } else {
      const r = await ctx.sb.from("module_local_state").insert({ tenant_id: ctx.tenantId, module_key: STAFF_PROFILE_REQUESTS_KEY, state: next, updated_at: now });
      if (!r.error) return { ok: true, state: next };
      if (!/duplicate|unique/i.test(r.error.message)) return { ok: false, error: r.error.message };
    }
  }
  return { ok: false, error: "The requests were being saved by someone else at the same moment — try again." };
}

export function submitProfileRequest(staffId: string, staffName: string, fields: Record<string, { from: string; to: string }>) {
  const now = new Date().toISOString();
  return changeProfileRequests((s) => addProfileRequest(s, { staffId, staffName, fields, now, id: `spr_${randomUUID().slice(0, 12)}` }));
}
