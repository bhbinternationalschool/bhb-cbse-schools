/**
 * Staff attendance desk settings — server-only ancillary slice.
 */

import {
  defaultAttendanceSettings,
  type StaffAttendanceSettings,
  type StaffAttendanceState,
} from "@/lib/staffAttendance";
import { staffAttendanceDualWriteDbEnabled } from "@/lib/staffAttendanceDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

/** The desk slices that ride alongside registers/marks: settings, and the
 * outdoor duty sessions those registers' marks are derived from. */
export type StaffAttendanceDeskAncillary = Pick<
  StaffAttendanceState,
  "settings" | "outdoorDuty"
>;

async function ctx() {
  return getServerTenantContext();
}

export async function pushStaffAttendanceSettingsToDb(
  settings: StaffAttendanceSettings,
): Promise<{ ok: boolean; error?: string }> {
  if (!staffAttendanceDualWriteDbEnabled()) return { ok: true };
  const c = await ctx();
  if (!c) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = c;
  const now = new Date().toISOString();
  const s = settings ?? defaultAttendanceSettings();

  const { error } = await sb.from("staff_attendance_desk_settings").upsert(
    {
      tenant_id: tenantId,
      allow_self_punch: !!s.allowSelfPunch,
      auto_apply_rules_on_save: !!s.autoApplyRulesOnSave,
      sync_leave_to_attendance: !!s.syncLeaveToAttendance,
      allow_whatsapp_punch: !!s.allowWhatsAppPunch,
      geofence_radius_m: Math.max(10, Number(s.geofenceRadiusM) || 150),
      max_location_accuracy_m: Math.max(
        0,
        Number(s.maxLocationAccuracyM) ?? 120,
      ),
      exempt_staff_ids: Array.isArray(s.exemptStaffIds) ? s.exemptStaffIds : [],
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );
  if (error) return { ok: false, error: error.message };

  await sb.from("staff_attendance_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      settings_updated_at: now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

/**
 * The settings as stored: `ok` false when they could not be read (no tenant,
 * a query error or timeout), `found` false when the school never saved any.
 *
 * Callers that act on the settings must not guess. On 6 Oct 2026 a failed
 * read here came back as defaultAttendanceSettings() — an EMPTY exempt list —
 * and the first punch of the day built the register from it: all 16
 * punch-exempt staff (director and admins included) were filed "A". A
 * function holder's save to school-data/staff-attendance-registers merges
 * onto these too, and must write nothing when they were not read.
 */
export async function readStaffAttendanceSettings(): Promise<{
  ok: boolean;
  found: boolean;
  settings: StaffAttendanceSettings;
}> {
  const c = await ctx();
  if (!c) return { ok: false, found: false, settings: defaultAttendanceSettings() };
  const { data, error } = await c.sb
    .from("staff_attendance_desk_settings")
    .select("*")
    .eq("tenant_id", c.tenantId)
    .maybeSingle();
  if (error) {
    console.error("[staff attendance] settings read failed", error.message);
    return { ok: false, found: false, settings: defaultAttendanceSettings() };
  }
  if (!data) return { ok: true, found: false, settings: defaultAttendanceSettings() };
  const settings: StaffAttendanceSettings = {
    allowSelfPunch: !!data.allow_self_punch,
    autoApplyRulesOnSave: !!data.auto_apply_rules_on_save,
    syncLeaveToAttendance: !!data.sync_leave_to_attendance,
    allowWhatsAppPunch: !!data.allow_whatsapp_punch,
    geofenceRadiusM: Number(data.geofence_radius_m) || 150,
    maxLocationAccuracyM: Number(data.max_location_accuracy_m) ?? 120,
    exemptStaffIds: Array.isArray(data.exempt_staff_ids)
      ? (data.exempt_staff_ids as string[])
      : [],
  };
  return { ok: true, found: true, settings };
}

/** The settings row, or null when it could not be read or does not exist —
 *  for anything that decides who is on a register. */
export async function fetchStaffAttendanceSettingsFromDbStrict(): Promise<StaffAttendanceSettings | null> {
  const r = await readStaffAttendanceSettings();
  return r.ok && r.found ? r.settings : null;
}

/** Settings for display and geofence checks: the row, or the defaults when it
 *  cannot be read. Never use this to decide who is on a register. */
export async function fetchStaffAttendanceSettingsFromDb(): Promise<StaffAttendanceSettings> {
  return (await readStaffAttendanceSettings()).settings;
}
