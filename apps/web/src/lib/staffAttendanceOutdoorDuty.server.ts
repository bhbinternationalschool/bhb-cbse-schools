/**
 * Outdoor duty sessions — server-only desk slice.
 *
 * Sits alongside registers/marks and settings in the staff_attendance desk
 * module, reusing its dual-write/read flags, its API route and its sync
 * meta row rather than standing up a module of its own.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  normalizeStaffAttendanceState,
  type OutdoorDutySession,
} from "@/lib/staffAttendance";
import {
  outdoorDutyRowToSession,
  outdoorDutySessionToRow,
  partitionSessionsByRealStaff,
} from "@/lib/staffAttendanceOutdoorDutyMap";
import { staffAttendanceDualWriteDbEnabled } from "@/lib/staffAttendanceDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

const TABLE = "staff_attendance_desk_outdoor_duty";

async function ctx(): Promise<{ sb: SupabaseClient; tenantId: string } | null> {
  return getServerTenantContext();
}

/**
 * Drop sessions whose staffId is not a real staff record.
 *
 * The chat actor manufactures a `sess_…` key for a login with no staff row,
 * and one such session is still sitting in at least one browser's
 * localStorage from before that was fixed. Without this it would be pushed
 * to the server on the first sync after this ships — persistence would
 * resurrect exactly what we set out to stop storing.
 *
 * Enforced here rather than as a FK because these desk tables are written
 * by a push/pull sync: a stale client must have its bad rows skipped, not
 * its whole push rejected.
 */
async function keepOnlyRealStaff(
  sb: SupabaseClient,
  sessions: OutdoorDutySession[],
): Promise<{ kept: OutdoorDutySession[]; dropped: OutdoorDutySession[] }> {
  const ids = [...new Set(sessions.map((s) => s.staffId).filter(Boolean))];
  if (!ids.length) return { kept: [], dropped: [] };

  const { data, error } = await sb.from("sis_staff").select("id").in("id", ids);
  if (error) {
    // "Could not check" is not "none of them are real" — a read failure must
    // not silently discard the whole payload.
    console.error(`[${TABLE}] staff check failed, push skipped:`, error.message);
    return { kept: [], dropped: [] };
  }

  const real = new Set(
    (data ?? []).map((r) => String((r as { id: string }).id)),
  );
  const split = partitionSessionsByRealStaff(sessions, real);
  if (split.dropped.length) {
    console.warn(
      `[${TABLE}] dropped ${split.dropped.length} session(s) whose staffId is not a staff record`,
    );
  }
  return split;
}

/**
 * Upsert-only — this never deletes.
 *
 * The shared deleteStale floor refuses a wholly empty payload but still
 * prunes on a partial one ("a client holding 3 of 900 rows still prunes
 * 897"). Outdoor duty is open-ended history and a phone that dropped
 * localStorage on quota holds none of it, so a prune here is the transport
 * desk wipe waiting to happen. Closing a session is a status update;
 * deleting one is an admin action, never a sync side effect.
 */
export async function pushStaffAttendanceOutdoorDutyToDb(
  sessions: OutdoorDutySession[],
): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!staffAttendanceDualWriteDbEnabled()) return { ok: true, count: 0 };
  const c = await ctx();
  if (!c) return { ok: false, count: 0, error: "Supabase tenant not configured" };
  const { sb, tenantId } = c;

  const incoming = sessions ?? [];
  if (!incoming.length) return { ok: true, count: 0 };

  const { kept } = await keepOnlyRealStaff(sb, incoming);
  if (!kept.length) return { ok: true, count: 0 };

  const rows = kept.map((s) => outdoorDutySessionToRow(tenantId, s));
  for (let i = 0; i < rows.length; i += 200) {
    const { error } = await sb.from(TABLE).upsert(rows.slice(i, i + 200));
    if (error) return { ok: false, count: 0, error: error.message };
  }

  const now = new Date().toISOString();
  const { count } = await sb
    .from(TABLE)
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId);

  await sb.from("staff_attendance_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      outdoor_duty_count: count ?? kept.length,
      outdoor_duty_updated_at: now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true, count: kept.length };
}

export async function fetchStaffAttendanceOutdoorDutyFromDb(): Promise<{
  outdoorDuty: OutdoorDutySession[];
  /** false = tenant/query could not be resolved; NOT a confirmed empty state. */
  ok: boolean;
}> {
  const c = await ctx();
  if (!c) return { outdoorDuty: [], ok: false };

  const { data, error } = await c.sb
    .from(TABLE)
    .select("*")
    .eq("tenant_id", c.tenantId)
    .order("started_at", { ascending: false });

  if (error) {
    console.error(`[${TABLE}] fetch failed:`, error.message);
    return { outdoorDuty: [], ok: false };
  }

  // Round-trip through the shared normalizer so a hand-edited row cannot
  // put a shape into client state that the client's own loader would reject.
  const normalized = normalizeStaffAttendanceState({
    outdoorDuty: (data ?? []).map(outdoorDutyRowToSession),
  });
  return { outdoorDuty: normalized.outdoorDuty, ok: true };
}
