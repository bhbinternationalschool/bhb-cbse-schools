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

export type StaffAttendanceDeskAncillary = Pick<StaffAttendanceState, "settings">;

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

export async function fetchStaffAttendanceSettingsFromDb(): Promise<StaffAttendanceSettings> {
  const c = await ctx();
  if (!c) return defaultAttendanceSettings();
  const { data } = await c.sb
    .from("staff_attendance_desk_settings")
    .select("*")
    .eq("tenant_id", c.tenantId)
    .maybeSingle();

  if (!data) return defaultAttendanceSettings();
  return {
    allowSelfPunch: !!data.allow_self_punch,
    autoApplyRulesOnSave: !!data.auto_apply_rules_on_save,
    syncLeaveToAttendance: !!data.sync_leave_to_attendance,
    allowWhatsAppPunch: !!data.allow_whatsapp_punch,
    geofenceRadiusM: Number(data.geofence_radius_m) || 150,
    maxLocationAccuracyM: Number(data.max_location_accuracy_m) ?? 120,
  };
}
