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
  fetchStaffAttendanceSettingsFromDbStrict,
  pushStaffAttendanceSettingsToDb,
  type StaffAttendanceDeskAncillary,
} from "@/lib/staffAttendanceDeskAncillary.server";
import {
  fetchStaffAttendanceOutdoorDutyFromDb,
  pushStaffAttendanceOutdoorDutyToDb,
} from "@/lib/staffAttendanceOutdoorDuty.server";
import {
  staffAttendanceDualWriteDbEnabled,
  staffAttendanceReadFromDbEnabled,
} from "@/lib/staffAttendanceDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";
import { deleteChildrenNotKept } from "@/lib/deskNamedDeletes.server";
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";
import { replaceChildRows } from "./replaceChildRows.server";
import { stampsOf, writeStampedRows } from "@/lib/rowStampWrite.server";

export type StaffAttendanceDeskSyncMeta = {
  registerCount: number;
  lastMarkedAt: string | null;
  updatedAt: string;
  settingsUpdatedAt?: string | null;
  outdoorDutyCount?: number;
  outdoorDutyUpdatedAt?: string | null;
};

export { staffAttendanceDualWriteDbEnabled, staffAttendanceReadFromDbEnabled };

const META_SELECT =
  "register_count, last_marked_at, updated_at, settings_updated_at, " +
  "outdoor_duty_count, outdoor_duty_updated_at";

function mapMetaRow(
  metaRow: Record<string, unknown> | null,
): StaffAttendanceDeskSyncMeta | null {
  if (!metaRow) return null;
  return {
    registerCount: metaRow.register_count as number,
    lastMarkedAt: metaRow.last_marked_at as string | null,
    updatedAt: String(metaRow.updated_at),
    settingsUpdatedAt: metaRow.settings_updated_at as string | null,
    outdoorDutyCount: (metaRow.outdoor_duty_count as number) ?? 0,
    outdoorDutyUpdatedAt: metaRow.outdoor_duty_updated_at as string | null,
  };
}

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
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
  /**
   * A browser's save: the registers it changed and the `updated_at` each
   * was changed from ("" = new). Only those are written — a register and
   * its marks only while the stored register is still at that stamp; the
   * rest come back as conflicts. Without it (blob backfill, a browser on an
   * older build) every register is written as before.
   */
  stamps?: Record<string, string>,
): Promise<{ ok: boolean; count: number; error?: string; stamps?: Record<string, string>; conflicts?: string[] }> {
  if (!staffAttendanceDualWriteDbEnabled()) {
    return { ok: true, count: 0 };
  }
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, count: 0, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();
  // One register per academic year and date (a unique key). When the stored
  // one for that day has a different id — the server made it at the first
  // punch, after this browser last read — the stored register stands and
  // this copy is skipped. The old prune settled the same collision by
  // deleting the stored register and every punch in it.
  const dates = [...new Set((registers ?? []).map((r) => r.date).filter(Boolean))];
  const storedByDay = new Map<string, string>();
  if (dates.length) {
    const { rows, error } = await fetchByIds<{
      id: string;
      academic_year_code: string;
      attendance_date: string;
    }>(dates, (chunk, from, to) =>
      sb
        .from("staff_attendance_desk_registers")
        .select("id, academic_year_code, attendance_date")
        .eq("tenant_id", tenantId)
        .in("attendance_date", chunk)
        .order("id")
        .range(from, to),
    );
    if (error) return { ok: false, count: 0, error };
    for (const r of rows) {
      storedByDay.set(`${r.academic_year_code}|${String(r.attendance_date).slice(0, 10)}`, r.id);
    }
  }
  // No stale copy over a newer register (2026-10-10): every register the
  // office tab held was upserted with its marks, so a punch made after the
  // tab loaded — the morning's QR punches — went back to "Not punched" on
  // its next save.
  const active = (registers ?? []).filter((r) => !stamps || r.id in stamps).filter((r) => {
    const stored = storedByDay.get(`${r.academicYearCode}|${r.date}`);
    if (stored && stored !== r.id) {
      console.warn(`[staff-attendance-db] kept stored register ${stored} for ${r.date}; skipped this copy (${r.id})`);
      return false;
    }
    return true;
  });

  // No prune by absence. Registers are never deleted in the UI, and the
  // server creates them: the first QR/app punch, a WhatsApp punch, survey
  // day, outdoor duty and leave approval each write today's register. An
  // office tab that read before the first punch deleted today's register —
  // every punch in it — on its next save.

  let written = active;
  let newStamps: Record<string, string> | undefined;
  const conflicts: string[] = [];
  if (stamps) {
    // The header is the register's version: written conditionally first;
    // only registers whose header landed get their marks written.
    const w = await writeStampedRows(
      sb,
      "staff_attendance_desk_registers",
      tenantId,
      active.map((r) => registerToRows(tenantId, r).header),
      stamps,
    );
    if (!w.ok) return { ok: false, count: 0, error: w.error };
    newStamps = w.stamps;
    conflicts.push(...w.conflicts);
    written = active.filter((r) => r.id in w.stamps);
    if (conflicts.length) console.warn("[staff-attendance-db] kept newer registers over a stale copy", conflicts);
  }

  const headers: Record<string, unknown>[] = [];
  const marks: Record<string, unknown>[] = [];
  for (const r of written) {
    const { header, marks: mrows } = registerToRows(tenantId, r);
    headers.push(header);
    marks.push(...mrows);
  }

  for (let i = 0; !stamps && i < headers.length; i += 200) {
    const { error } = await sb
      .from("staff_attendance_desk_registers")
      .upsert(headers.slice(i, i + 200));
    if (error) return { ok: false, count: 0, error: error.message };
  }

  // Marks are written first, then a register's marks that its new copy no
  // longer lists are removed — only for registers that arrived WITH marks.
  // This used to delete every mark of every pushed register and then insert:
  // a failed insert left the day's punches gone.
  for (let i = 0; i < marks.length; i += 500) {
    const { error } = await sb
      .from("staff_attendance_desk_marks")
      .upsert(marks.slice(i, i + 500));
    if (error) return { ok: false, count: 0, error: error.message };
  }
  const keepMarks = new Set(marks.map((m) => String((m as { id: string }).id)));
  const delMarks = await deleteChildrenNotKept(
    sb,
    tenantId,
    "staff_attendance_desk_marks",
    "register_id",
    written.filter((r) => (r.marks ?? []).length > 0).map((r) => r.id),
    keepMarks,
  );
  if (!delMarks.ok) return { ok: false, count: 0, error: delMarks.error };

  // Counts from the database, not from this copy (it may be partly written).
  // An empty save used to set the count to 0.
  await touchStaffAttendanceMeta(sb, tenantId, now).catch(() => undefined);

  return { ok: true, count: written.length, stamps: newStamps, conflicts };
}

/** Recount the desk meta from the registers, so a hydrate sees the change. */
async function touchStaffAttendanceMeta(sb: SupabaseClient, tenantId: string, now: string): Promise<void> {
  const [all, latest] = await Promise.all([
    sb.from("staff_attendance_desk_registers").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    sb
      .from("staff_attendance_desk_registers")
      .select("marked_at")
      .eq("tenant_id", tenantId)
      .order("marked_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const row: Record<string, unknown> = { tenant_id: tenantId, updated_at: now };
  // A failed count leaves the old figure alone rather than writing a zero.
  if (!all.error && typeof all.count === "number") row.register_count = all.count;
  if (!latest.error) row.last_marked_at = (latest.data as { marked_at?: string } | null)?.marked_at ?? null;
  await sb.from("staff_attendance_desk_sync_meta").upsert(row, { onConflict: "tenant_id" });
}

export async function fetchStaffAttendanceRegistersFromDb(): Promise<{
  registers: StaffAttendanceRegister[];
  meta: StaffAttendanceDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; result is NOT a confirmed empty state. */
  ok: boolean;
  /** Each register's `updated_at` — what a browser's save is stamped with. */
  stamps: Record<string, string>;
}> {
  const ctx = await resolveCtx();
  if (!ctx) return { registers: [], meta: null, ok: false, stamps: {} };
  const { sb, tenantId } = ctx;

  const headersRes = await fetchAllPages<Record<string, unknown>>((from, to) =>
    sb
      .from("staff_attendance_desk_registers")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("id", { ascending: true })
      .range(from, to),
  );
  const hErr = headersRes.error ? { message: headersRes.error } : null;
  const headers = headersRes.rows.sort((a, b) =>
    String(b.attendance_date ?? "").localeCompare(String(a.attendance_date ?? "")),
  );

  if (hErr) {
    console.warn("[staff-attendance-db] fetch registers failed", hErr.message);
    return { registers: [], meta: null, ok: false, stamps: {} };
  }

  if (!headers?.length) {
    const { data: metaRow } = await sb
      .from("staff_attendance_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    return {
      registers: [],
      meta: mapMetaRow(metaRow as Record<string, unknown> | null),
      ok: true,
      stamps: {},
    };
  }

  const ids = headers.map((h) => h.id as string);
  // Chunked by register and paged — 1,812 marks do not fit one request.
  const [markRes, { data: metaRow }] =
    await Promise.all([
      fetchByIds<Record<string, unknown>>(ids, (chunk, from, to) =>
        sb
          .from("staff_attendance_desk_marks")
          .select("*")
          .eq("tenant_id", tenantId)
          .in("register_id", chunk)
          .order("id", { ascending: true })
          .range(from, to),
      ),
      sb
        .from("staff_attendance_desk_sync_meta")
        .select(META_SELECT)
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);
  const markRows = markRes.rows;
  const mErr = markRes.error ? { message: markRes.error } : null;

  if (mErr) {
    console.warn("[staff-attendance-db] fetch marks failed", mErr.message);
    return { registers: [], meta: null, ok: false, stamps: {} };
  }

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
    ok: true,
    stamps: stampsOf(headers),
  };
}

export async function pushStaffAttendanceDeskToDb(
  state: Pick<StaffAttendanceState, "registers" | "settings"> &
    Partial<Pick<StaffAttendanceState, "outdoorDuty">>,
  /** A browser's register stamps (see pushStaffAttendanceRegistersToDb). */
  stamps?: Record<string, string>,
): Promise<{
  ok: boolean;
  error?: string;
  registerCount: number;
  outdoorDutyCount?: number;
  stamps?: Record<string, string>;
  conflicts?: string[];
}> {
  const regResult = await pushStaffAttendanceRegistersToDb(state.registers ?? [], stamps);
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

  const odResult = await pushStaffAttendanceOutdoorDutyToDb(
    state.outdoorDuty ?? [],
  );
  if (!odResult.ok) {
    return {
      ok: false,
      error: odResult.error,
      registerCount: regResult.count,
    };
  }

  return {
    ok: true,
    registerCount: regResult.count,
    outdoorDutyCount: odResult.count,
    stamps: regResult.stamps,
    conflicts: regResult.conflicts,
  };
}

export type StaffAttendanceDeskSnapshot = {
  registers: StaffAttendanceRegister[];
  stamps: Record<string, string>;
  ancillary: StaffAttendanceDeskAncillary;
  meta: StaffAttendanceDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; result is NOT a confirmed empty state. */
  ok: boolean;
};

export async function fetchStaffAttendanceDeskFromDb(): Promise<StaffAttendanceDeskSnapshot> {
  const [{ registers, meta, ok, stamps }, settingsRead, outdoor] = await Promise.all([
    fetchStaffAttendanceRegistersFromDb(),
    fetchStaffAttendanceSettingsFromDbStrict(),
    fetchStaffAttendanceOutdoorDutyFromDb(),
  ]);
  return {
    registers,
    stamps,
    ancillary: {
      settings: settingsRead ?? defaultAttendanceSettings(),
      outdoorDuty: outdoor.outdoorDuty,
    },
    meta,
    // Any slice failing to read means this snapshot is not a confirmed
    // state — merging it as truth could blank what the client holds, and
    // unread settings would replace the exempt list with an empty one.
    ok: ok && outdoor.ok && settingsRead !== null,
  };
}

export async function pushStaffAttendanceRegisterToDb(
  register: StaffAttendanceRegister,
  /**
   * The staff whose marks this write changed (a punch, a leave day, an
   * outdoor-duty mark). Only their marks are written; anyone else's row is
   * added only if the database has none. Without it, the whole register's
   * marks are replaced.
   */
  onlyStaffIds?: readonly string[],
): Promise<{ ok: boolean; error?: string }> {
  if (!staffAttendanceDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "No tenant" };
  const { sb, tenantId } = ctx;
  const { header, marks } = registerToRows(tenantId, register);

  // updated_at moves on with every write: an office tab holding the older
  // register is refused rather than putting this punch back.
  const { error: hErr } = await sb
    .from("staff_attendance_desk_registers")
    .upsert(header);
  if (hErr) return { ok: false, error: hErr.message };

  if (onlyStaffIds) {
    // One punch, one row (2026-10-10). The register was read fresh, changed
    // for one person and all its marks replaced — two staff punching at the
    // same moment on two instances each wrote the other back to "Not
    // punched". Now: rows missing in the database are added (a new day's
    // register), never over one that exists; then only the named staff's
    // rows are written.
    const mine = new Set(onlyStaffIds);
    const { error: fillErr } = await sb
      .from("staff_attendance_desk_marks")
      .upsert(marks.filter((m) => !mine.has(String(m.staff_id))), { onConflict: "id", ignoreDuplicates: true });
    if (fillErr) return { ok: false, error: fillErr.message };
    const own = marks.filter((m) => mine.has(String(m.staff_id)));
    if (own.length) {
      const { error: ownErr } = await sb.from("staff_attendance_desk_marks").upsert(own);
      if (ownErr) return { ok: false, error: ownErr.message };
    }
    await sb.from("staff_attendance_desk_sync_meta").upsert(
      { tenant_id: tenantId, last_marked_at: register.markedAt || header.updated_at, updated_at: header.updated_at },
      { onConflict: "tenant_id" },
    );
    return { ok: true };
  }

  // One transaction — see attendanceNormalized.server.ts for why.
  const marksWrite = await replaceChildRows(sb, {
    table: "staff_attendance_desk_marks",
    tenantId,
    match: { register_id: register.id },
    rows: marks,
  });
  if (!marksWrite.ok) return { ok: false, error: marksWrite.error };

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
