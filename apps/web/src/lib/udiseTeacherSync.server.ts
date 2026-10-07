import "server-only";

import type { StaffRecord } from "@/lib/foundationMasters";
import { getServerTenantContext } from "@/lib/serverTenant";
import { rowToStaff, type StaffRow } from "@/lib/staffPersistence";
import {
  normalizePortalTeacherSnapshot,
  UDISE_PORTAL_TEACHERS_KEY,
  type PortalTeacherSnapshot,
} from "@/lib/udiseTeacherSync";

/**
 * The latest UDISE+ teacher snapshot the robot fetched — one
 * module_local_state row, written only through
 * /api/v1/udise/robot/teacher-details (server truth; no browser copy).
 * null = the read failed: unknown, never "no teachers".
 */
export async function readPortalTeachersSnapshot(): Promise<{ snapshot: PortalTeacherSnapshot | null } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("module_local_state")
    .select("state")
    .eq("tenant_id", ctx.tenantId)
    .eq("module_key", UDISE_PORTAL_TEACHERS_KEY)
    .maybeSingle();
  if (error) {
    console.warn("[udise-portal-teachers] read failed", error.message);
    return null;
  }
  if (!data?.state) return { snapshot: null };
  const st = data.state as Partial<PortalTeacherSnapshot>;
  // Re-normalised on the way out too: the row is only ever as trusted as the whitelist.
  return { snapshot: normalizePortalTeacherSnapshot(st, String(st.fetchedBy || ""), String(st.fetchedAt || "")) };
}

export async function writePortalTeachersSnapshot(
  snapshot: PortalTeacherSnapshot,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  const { error } = await ctx.sb
    .from("module_local_state")
    .upsert(
      { tenant_id: ctx.tenantId, module_key: UDISE_PORTAL_TEACHERS_KEY, state: snapshot, updated_at: new Date().toISOString() },
      { onConflict: "tenant_id,module_key" },
    );
  if (error) return { ok: false, error: error.message };
  return { ok: true };
}

/**
 * ERP Staff straight from sis_staff with each row's revision (updated_at),
 * not the masters cache: Apply is conditional on the revision the office
 * reviewed. ~50 rows, well under the 1,000-row PostgREST page.
 */
export async function readStaffWithRevisions(): Promise<{ staff: StaffRecord[]; revisions: Record<string, string> } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb.from("sis_staff").select("*").eq("tenant_id", ctx.tenantId);
  if (error) {
    console.warn("[udise-teacher-sync] staff read failed", error.message);
    return null;
  }
  const rows = (data ?? []) as StaffRow[];
  const revisions: Record<string, string> = {};
  for (const r of rows) revisions[r.id] = String(r.updated_at || "");
  return { staff: rows.map(rowToStaff), revisions };
}

/** StaffRecord keys that also live in their own sis_staff column. */
const COLUMN_OF: Partial<Record<keyof StaffRecord, string>> = {
  fullName: "full_name",
  mobile: "mobile",
  email: "email",
  designationId: "designation_id",
};

type WriteResult = { ok: true; updatedAt: string } | { ok: false; conflict?: boolean; error: string };

/**
 * Only the given fields of ONE staff row — the profile copy and, where it
 * exists, the column — conditional on the revision the office reviewed (as
 * lib/sisClassTeacher.server.ts conditionalUpdate does): if anyone saved the
 * row in between, nothing is written and the office reloads.
 *
 * Known gap, shared with /api/v1/staff/roster/mobile: an office browser that
 * still holds an older roster and then saves Staff pushes its whole copy
 * (upsertStaffBundle) and can put the old value back. The review shows the
 * live row after Apply, so a revert is visible, not silent.
 */
export async function updateStaffFields(
  staffId: string,
  patch: Partial<Record<keyof StaffRecord, string>>,
  revisionAt: string,
): Promise<WriteResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Tenant unavailable" };
  if (!revisionAt) return { ok: false, error: "No revision to check against — reload the review." };
  const read = await ctx.sb
    .from("sis_staff")
    .select("profile, updated_at")
    .eq("tenant_id", ctx.tenantId)
    .eq("id", staffId)
    .maybeSingle();
  if (read.error) return { ok: false, error: read.error.message };
  if (!read.data) return { ok: false, error: "Staff member not found" };
  if (String(read.data.updated_at) !== revisionAt) {
    return { ok: false, conflict: true, error: "Someone changed this staff record since the review — reload and check again." };
  }
  const profile = { ...((read.data.profile as Record<string, unknown>) || {}) };
  const update: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(patch)) {
    profile[k] = v;
    const col = COLUMN_OF[k as keyof StaffRecord];
    if (col) update[col] = v;
  }
  const now = new Date().toISOString();
  const r = await ctx.sb
    .from("sis_staff")
    .update({ ...update, profile, updated_at: now })
    .eq("tenant_id", ctx.tenantId)
    .eq("id", staffId)
    .eq("updated_at", revisionAt)
    .select("id");
  if (r.error) return { ok: false, error: r.error.message };
  if (!r.data || r.data.length === 0) {
    return { ok: false, conflict: true, error: "Someone changed this staff record just now — reload and check again." };
  }
  return { ok: true, updatedAt: now };
}
