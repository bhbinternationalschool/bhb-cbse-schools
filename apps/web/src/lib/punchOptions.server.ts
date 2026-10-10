import "server-only";

import { getServerTenantContext } from "@/lib/serverTenant";
import { defaultPunchOptions, normalizePunchOptions, type PunchOptions } from "@/lib/punchSchedule";

/**
 * Gate punch window + printed QR, stored in
 * staff_attendance_desk_settings.punch_options (migration 20261005120000).
 *
 * Read fails soft to the defaults (QR 06:45–18:00, printed QR OFF): an
 * unreadable setting must never open punching all night or revive a print.
 */
export async function loadPunchOptions(): Promise<PunchOptions> {
  const c = await getServerTenantContext();
  if (!c) return defaultPunchOptions();
  const { data, error } = await c.sb
    .from("staff_attendance_desk_settings")
    .select("punch_options")
    .eq("tenant_id", c.tenantId)
    .maybeSingle();
  if (error || !data) return defaultPunchOptions();
  return normalizePunchOptions((data as { punch_options?: unknown }).punch_options);
}

/** Save — the caller has already checked the login is school-wide. */
export async function savePunchOptions(next: PunchOptions): Promise<{ ok: true; options: PunchOptions } | { ok: false; error: string }> {
  const c = await getServerTenantContext();
  if (!c) return { ok: false, error: "Database not configured" };
  const options = normalizePunchOptions(next);
  // Update, not upsert: the settings row exists (the desk wrote it); an
  // upsert here would create a row with every other setting at its default.
  const { data, error } = await c.sb
    .from("staff_attendance_desk_settings")
    .update({ punch_options: options, updated_at: new Date().toISOString() })
    .eq("tenant_id", c.tenantId)
    .select("tenant_id");
  if (error) return { ok: false, error: error.message };
  if (!data || data.length === 0) {
    return { ok: false, error: "Save the attendance settings once (Masters → Attendance settings) before setting the gate QR." };
  }
  return { ok: true, options };
}
