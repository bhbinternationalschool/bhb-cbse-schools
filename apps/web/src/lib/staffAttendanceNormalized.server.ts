/**
 * Staff attendance desk — Supabase normalized tables (staff_attendance_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AttendanceStatus } from "@/lib/attendance";
import {
  defaultAttendanceSettings,
  type StaffAttendanceMark,
  type StaffAttendanceRegister,
  type StaffAttendanceState,
  type StaffPunchGeo,
  type AttendancePunchWay,
} from "@/lib/staffAttendance";
import {
  fetchStaffAttendanceSettingsFromDb,
  pushStaffAttendanceSettingsToDb,
  type StaffAttendanceDeskAncillary,
} from "@/lib/staffAttendanceDeskAncillary.server";
import {
  staffAttendanceDualWriteDbEnabled,
  staffAttendanceReadFromDbEnabled,
} from "@/lib/staffAttendanceDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type StaffAttendanceDeskSyncMeta = {
  registerCount: number;
  lastMarkedAt: string | null;
  updatedAt: string;
  settingsUpdatedAt?: string | null;
};

export { staffAttendanceDualWriteDbEnabled, staffAttendanceReadFromDbEnabled };

const META_SELECT =
  "register_count, last_marked_at, updated_at, settings_updated_at";

function mapMetaRow(
  metaRow: Record<string, unknown> | null,
): StaffAttendanceDeskSyncMeta | null {
  if (!metaRow) return null;
  return {
    registerCount: metaRow.register_count as number,
    lastMarkedAt: metaRow.last_marked_at as string | null,
    updatedAt: String(metaRow.updated_at),
    settingsUpdatedAt: metaRow.settings_updated_at as string | null,
  };
}

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  const { data } = await sb.from(table).select("id").eq("tenant_id", tenantId);
  const stale = (data ?? [])
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !keepIds.has(id));
  if (stale.length > 0) {
    await sb.from(table).delete().in("id", stale);
  }
}

function registerToRows(
  tenantId: string,
  r: StaffAttendanceRegister,
): {
  header: Record<string, unknown>;
  marks: Record<string, unknown>[];
} {
  const header = {
    id: r.id,
    tenant_id: tenantId,
    academic_year_code: r.academicYearCode,
    attendance_date: r.date,
    marked_by: r.markedBy || "",
    marked_at: r.markedAt || new Date().toISOString(),
    remark: r.remark || "",
    register_json: {},
    updated_at: new Date().toISOString(),
  };

  const marks = (r.marks || []).map((m) => ({
    id: `${r.id}:${m.staffId}`,
    register_id: r.id,
    tenant_id: tenantId,
    staff_id: m.staffId,
    status: m.status,
    note: m.note || "",
    in_time: m.inTime || "",
    out_time: m.outTime || "",
    punch_way: m.punchWay || "",
    mark_json: m.punchGeo ? { punchGeo: m.punchGeo } : {},
  }));

  return { header, marks };
}

function rowToRegister(
  header: Record<string, unknown>,
  markRows: Record<string, unknown>[],
): StaffAttendanceRegister {
  return {
    id: String(header.id),
    academicYearCode: String(header.academic_year_code),
    date: String(header.attendance_date).slice(0, 10),
    markedBy: String(header.marked_by || ""),
    markedAt: String(header.marked_at || ""),
    remark: String(header.remark || ""),
    marks: markRows.map((m): StaffAttendanceMark => {
      const mj = (m.mark_json as { punchGeo?: StaffPunchGeo }) || {};
      return {
        staffId: String(m.staff_id),
        status: String(m.status) as AttendanceStatus,
        note: String(m.note || ""),
        inTime: String(m.in_time || ""),
        outTime: String(m.out_time || ""),
        punchWay: String(m.punch_way || "") as AttendancePunchWay | "",
        punchGeo: mj.punchGeo,
      };
    }),
  };
}

export async function pushStaffAttendanceRegistersToDb(
  registers: StaffAttendanceRegister[],
): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!staffAttendanceDualWriteDbEnabled()) {
    return { ok: true, count: 0 };
  }
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, count: 0, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();
  const active = registers ?? [];

  await deleteStale(
    sb,
    tenantId,
    "staff_attendance_desk_registers",
    new Set(active.map((r) => r.id)),
  );

  if (!active.length) {
    await sb.from("staff_attendance_desk_sync_meta").upsert(
      {
        tenant_id: tenantId,
        register_count: 0,
        last_marked_at: null,
        updated_at: now,
      },
      { onConflict: "tenant_id" },
    );
    return { ok: true, count: 0 };
  }

  const headers: Record<string, unknown>[] = [];
  const marks: Record<string, unknown>[] = [];
  let lastMarkedAt: string | null = null;

  for (const r of active) {
    const { header, marks: mrows } = registerToRows(tenantId, r);
    headers.push(header);
    marks.push(...mrows);
    if (!lastMarkedAt || String(header.marked_at) > lastMarkedAt) {
      lastMarkedAt = String(header.marked_at);
    }
  }

  for (let i = 0; i < headers.length; i += 200) {
    const { error } = await sb
      .from("staff_attendance_desk_registers")
      .upsert(headers.slice(i, i + 200));
    if (error) return { ok: false, count: 0, error: error.message };
  }

  const regIds = new Set(active.map((r) => r.id));
  const { data: existingMarks } = await sb
    .from("staff_attendance_desk_marks")
    .select("id, register_id")
    .eq("tenant_id", tenantId);
  const staleMarkIds = (existingMarks ?? [])
    .filter((m) => regIds.has(String(m.register_id)))
    .map((m) => String(m.id));
  if (staleMarkIds.length) {
    await sb.from("staff_attendance_desk_marks").delete().in("id", staleMarkIds);
  }

  for (let i = 0; i < marks.length; i += 500) {
    const { error } = await sb
      .from("staff_attendance_desk_marks")
      .upsert(marks.slice(i, i + 500));
    if (error) return { ok: false, count: 0, error: error.message };
  }

  await sb.from("staff_attendance_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      register_count: active.length,
      last_marked_at: lastMarkedAt,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true, count: active.length };
}

export async function fetchStaffAttendanceRegistersFromDb(): Promise<{
  registers: StaffAttendanceRegister[];
  meta: StaffAttendanceDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  if (!ctx) return { registers: [], meta: null };
  const { sb, tenantId } = ctx;

  const { data: headers, error: hErr } = await sb
    .from("staff_attendance_desk_registers")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("attendance_date", { ascending: false });

  if (hErr || !headers?.length) {
    const { data: metaRow } = await sb
      .from("staff_attendance_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return {
      registers: [],
      meta: mapMetaRow(metaRow as Record<string, unknown> | null),
    };
  }

  const ids = headers.map((h) => h.id as string);
  const [{ data: markRows }, { data: metaRow }] = await Promise.all([
    sb
      .from("staff_attendance_desk_marks")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("register_id", ids),
    sb
      .from("staff_attendance_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const marksByRegister = new Map<string, Record<string, unknown>[]>();
  for (const row of markRows ?? []) {
    const rid = String(row.register_id);
    const list = marksByRegister.get(rid) ?? [];
    list.push(row as Record<string, unknown>);
    marksByRegister.set(rid, list);
  }

  const registers = headers.map((h) =>
    rowToRegister(
      h as Record<string, unknown>,
      marksByRegister.get(String(h.id)) ?? [],
    ),
  );

  return {
    registers,
    meta: mapMetaRow(metaRow as Record<string, unknown> | null),
  };
}

export async function pushStaffAttendanceDeskToDb(
  state: Pick<StaffAttendanceState, "registers" | "settings">,
): Promise<{ ok: boolean; error?: string; registerCount: number }> {
  const regResult = await pushStaffAttendanceRegistersToDb(state.registers ?? []);
  if (!regResult.ok) {
    return { ok: false, error: regResult.error, registerCount: 0 };
  }

  const settingsResult = await pushStaffAttendanceSettingsToDb(
    state.settings ?? defaultAttendanceSettings(),
  );
  if (!settingsResult.ok) {
    return {
      ok: false,
      error: settingsResult.error,
      registerCount: regResult.count,
    };
  }

  return { ok: true, registerCount: regResult.count };
}

export type StaffAttendanceDeskSnapshot = {
  registers: StaffAttendanceRegister[];
  ancillary: StaffAttendanceDeskAncillary;
  meta: StaffAttendanceDeskSyncMeta | null;
};

export async function fetchStaffAttendanceDeskFromDb(): Promise<StaffAttendanceDeskSnapshot> {
  const [{ registers, meta }, settings] = await Promise.all([
    fetchStaffAttendanceRegistersFromDb(),
    fetchStaffAttendanceSettingsFromDb(),
  ]);
  return { registers, ancillary: { settings }, meta };
}

export async function pushStaffAttendanceRegisterToDb(
  register: StaffAttendanceRegister,
): Promise<{ ok: boolean; error?: string }> {
  if (!staffAttendanceDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "No tenant" };
  const { sb, tenantId } = ctx;
  const { header, marks } = registerToRows(tenantId, register);

  const { error: hErr } = await sb
    .from("staff_attendance_desk_registers")
    .upsert(header);
  if (hErr) return { ok: false, error: hErr.message };

  await sb
    .from("staff_attendance_desk_marks")
    .delete()
    .eq("register_id", register.id);

  if (marks.length) {
    const { error: mErr } = await sb
      .from("staff_attendance_desk_marks")
      .upsert(marks);
    if (mErr) return { ok: false, error: mErr.message };
  }

  const now = new Date().toISOString();
  await sb.from("staff_attendance_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      last_marked_at: register.markedAt || now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}
