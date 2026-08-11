/**
 * Attendance registers — Supabase normalized tables (attendance_desk_*).
 * Server-only. Text ids match desk AttendanceRegister ids.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import {
  DEFAULT_ATTENDANCE_POLICY,
  type AttendanceMark,
  type AttendanceRegister,
  type AttendanceState,
  type AttendanceStatus,
} from "@/lib/attendance";
import {
  attendanceDualWriteDbEnabled,
  attendanceReadFromDbEnabled,
} from "@/lib/attendanceDbConfig";
import {
  fetchAttendanceDeskAncillaryFromDb,
  pushAttendanceDeskAncillaryToDb,
  type AttendanceDeskAncillary,
} from "@/lib/attendanceDeskAncillary.server";
import { getServerTenantContext } from "@/lib/serverTenant";

export type AttendanceDeskSyncMeta = {
  registerCount: number;
  lastMarkedAt: string | null;
  updatedAt: string;
  nudgeCount?: number;
  exceptionCount?: number;
  openExceptionCount?: number;
  ancillaryUpdatedAt?: string | null;
};

export { attendanceDualWriteDbEnabled, attendanceReadFromDbEnabled };

const META_SELECT =
  "register_count, last_marked_at, updated_at, ancillary_updated_at, nudge_count, exception_count, open_exception_count";

function mapMetaRow(
  metaRow: Record<string, unknown> | null,
): AttendanceDeskSyncMeta | null {
  if (!metaRow) return null;
  return {
    registerCount: metaRow.register_count as number,
    lastMarkedAt: metaRow.last_marked_at as string | null,
    updatedAt: String(metaRow.updated_at),
    nudgeCount: metaRow.nudge_count as number | undefined,
    exceptionCount: metaRow.exception_count as number | undefined,
    openExceptionCount: metaRow.open_exception_count as number | undefined,
    ancillaryUpdatedAt: metaRow.ancillary_updated_at as string | null,
  };
}

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

/**
 * Delete rows the client no longer holds — never on an empty payload.
 *
 * An empty keep-set means every stored row is "stale", so this deleted the
 * entire table. That is never what a sync means: a client with nothing to say
 * is a client whose cache was dropped, not an instruction to erase the
 * school's records.
 *
 * It is not hypothetical. On 2026-08-11 the attendance register for the
 * previous day was gone — pushed away by a phone whose localStorage had been
 * dropped on quota, with the emptiness check running AFTER the delete. This
 * same function is copied into 20 modules and called from 86 places, almost
 * none of them guarded, covering bank and cash ledgers, payroll runs, fee
 * cheques, library issues and 1,919 admission records.
 *
 * This floor stops the catastrophic case everywhere at once. It does NOT make
 * a partial payload safe — a client holding 3 of 900 rows still prunes 897.
 * That needs per-module scoping, the way attendance now prunes only within
 * the dates its payload covers. See docs/TODO.md.
 *
 * The read error is also surfaced now. It was discarded, which happened to
 * fail safe here (no data → nothing deleted), but "we could not read the
 * table" and "the table is empty" must not be the same value in a function
 * that deletes.
 */
async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  if (keepIds.size === 0) {
    console.warn(
      `[${table}] refusing to prune: the payload holds no ids at all. ` +
        "An empty client is not an instruction to delete every row.",
    );
    return;
  }
  const { data, error } = await sb
    .from(table)
    .select("id")
    .eq("tenant_id", tenantId);
  if (error) {
    console.error(
      `[${table}] prune skipped — could not read existing ids:`,
      error.message,
    );
    return;
  }
  const stale = (data ?? [])
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !keepIds.has(id));
  if (stale.length > 0) {
    await sb.from(table).delete().in("id", stale);
  }
}

function registerToRows(
  tenantId: string,
  r: AttendanceRegister,
): {
  header: Record<string, unknown>;
  marks: Record<string, unknown>[];
} {
  const header = {
    id: r.id,
    tenant_id: tenantId,
    academic_year_code: r.academicYearCode,
    campus_id: r.campusId || "",
    class_id: r.classId,
    section_id: r.sectionId,
    attendance_date: r.date,
    marked_by: r.markedBy || "",
    marked_at: r.markedAt || new Date().toISOString(),
    remark: r.remark || "",
    register_json: {
      campusId: r.campusId,
      classId: r.classId,
      sectionId: r.sectionId,
    },
    updated_at: new Date().toISOString(),
  };

  const marks = (r.marks || []).map((m) => ({
    id: `${r.id}:${m.studentId}`,
    register_id: r.id,
    tenant_id: tenantId,
    student_id: m.studentId,
    status: m.status,
    note: m.note || "",
  }));

  return { header, marks };
}

function rowToRegister(
  header: Record<string, unknown>,
  markRows: Record<string, unknown>[],
): AttendanceRegister {
  return {
    id: String(header.id),
    academicYearCode: String(header.academic_year_code),
    campusId: String(header.campus_id || ""),
    classId: String(header.class_id),
    sectionId: String(header.section_id),
    date: String(header.attendance_date).slice(0, 10),
    markedBy: String(header.marked_by || ""),
    markedAt: String(header.marked_at || ""),
    remark: String(header.remark || ""),
    marks: markRows.map(
      (m): AttendanceMark => ({
        studentId: String(m.student_id),
        status: String(m.status) as AttendanceStatus,
        note: String(m.note || ""),
      }),
    ),
  };
}

export async function pushAttendanceRegistersToDb(
  registers: AttendanceRegister[],
): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!attendanceDualWriteDbEnabled()) {
    return { ok: true, count: 0 };
  }
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, count: 0, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  const active = registers ?? [];

  // Attendance is history. A push is NOT a statement that these are the only
  // registers that ever existed.
  //
  // This called deleteStale unconditionally, so every push deleted every
  // register the client did not happen to be holding — and the `!active.length`
  // check below runs AFTER, so an empty payload wiped the entire attendance
  // history first and noticed second.
  //
  // On 2026-08-11 the database held exactly one register: today's. The
  // register for 2026-08-10, marked the day before, was gone. The browser
  // cache was being dropped on quota all that day, so the client pushed
  // whatever partial state it had and the server obligingly deleted the rest.
  //
  // sis_students has been protected from precisely this since the roster
  // incident — pruning there requires the caller to declare a complete
  // snapshot, and test:sis-prune enforces it. Attendance never got the same
  // guard. It has one now: prune only what belongs to the dates this payload
  // actually covers, and never on an empty payload.
  if (active.length > 0) {
    const coveredDates = new Set(active.map((r) => r.date).filter(Boolean));
    const keepIds = new Set(active.map((r) => r.id));
    const { data: existing } = await sb
      .from("attendance_desk_registers")
      .select("id, attendance_date")
      .eq("tenant_id", tenantId)
      .in("attendance_date", [...coveredDates]);

    const stale = (existing ?? [])
      .map((r) => String((r as { id: string }).id))
      .filter((id) => !keepIds.has(id));
    if (stale.length > 0) {
      await sb.from("attendance_desk_registers").delete().in("id", stale);
    }
  }

  if (!active.length) {
    await sb.from("attendance_desk_sync_meta").upsert(
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

  const chunk = 200;
  for (let i = 0; i < headers.length; i += chunk) {
    const { error } = await sb
      .from("attendance_desk_registers")
      .upsert(headers.slice(i, i + chunk));
    if (error) return { ok: false, count: 0, error: error.message };
  }

  const regIds = new Set(active.map((r) => r.id));
  const { data: existingMarks } = await sb
    .from("attendance_desk_marks")
    .select("id, register_id")
    .eq("tenant_id", tenantId);
  const staleMarkIds = (existingMarks ?? [])
    .filter((m) => regIds.has(String(m.register_id)))
    .map((m) => String(m.id));
  if (staleMarkIds.length) {
    await sb.from("attendance_desk_marks").delete().in("id", staleMarkIds);
  }

  for (let i = 0; i < marks.length; i += 500) {
    const { error } = await sb
      .from("attendance_desk_marks")
      .upsert(marks.slice(i, i + 500));
    if (error) return { ok: false, count: 0, error: error.message };
  }

  await sb.from("attendance_desk_sync_meta").upsert(
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

export async function fetchAttendanceRegistersFromDb(): Promise<{
  registers: AttendanceRegister[];
  meta: AttendanceDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; result is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  if (!ctx) return { registers: [], meta: null, ok: false };
  const { sb, tenantId } = ctx;

  const { data: headers, error: hErr } = await sb
    .from("attendance_desk_registers")
    .select("*")
    .eq("tenant_id", tenantId)
    .order("attendance_date", { ascending: false });

  if (hErr) {
    console.warn("[attendance-db] fetch failed", hErr.message);
    return { registers: [], meta: null, ok: false };
  }

  if (!headers?.length) {
    const { data: metaRow, error: metaErr } = await sb
      .from("attendance_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle();
    if (metaErr) {
      console.warn("[attendance-db] meta fetch failed", metaErr.message);
      return { registers: [], meta: null, ok: false };
    }
    return {
      registers: [],
      meta: mapMetaRow(metaRow as Record<string, unknown> | null),
      ok: true,
    };
  }

  const ids = headers.map((h) => h.id as string);

  const [
    { data: markRows, error: mErr },
    { data: metaRow, error: metaErr },
  ] = await Promise.all([
    sb
      .from("attendance_desk_marks")
      .select("*")
      .eq("tenant_id", tenantId)
      .in("register_id", ids),
    sb
      .from("attendance_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (mErr || metaErr) {
    console.warn("[attendance-db] fetch failed", mErr?.message, metaErr?.message);
    return { registers: [], meta: null, ok: false };
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
  };
}

export async function pushAttendanceDeskToDb(
  state: Pick<AttendanceState, "registers"> & Partial<AttendanceDeskAncillary>,
): Promise<{
  ok: boolean;
  error?: string;
  registerCount: number;
}> {
  const regResult = await pushAttendanceRegistersToDb(state.registers ?? []);
  if (!regResult.ok) {
    return {
      ok: false,
      error: regResult.error,
      registerCount: 0,
    };
  }

  const ancillaryResult = await pushAttendanceDeskAncillaryToDb({
    policy: state.policy ?? DEFAULT_ATTENDANCE_POLICY,
    absentNudges: state.absentNudges ?? [],
    exceptions: state.exceptions ?? [],
  });
  if (!ancillaryResult.ok) {
    return {
      ok: false,
      error: ancillaryResult.error,
      registerCount: regResult.count,
    };
  }

  return { ok: true, registerCount: regResult.count };
}

export type AttendanceDeskSnapshot = {
  registers: AttendanceRegister[];
  ancillary: AttendanceDeskAncillary;
  meta: AttendanceDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; result is NOT a confirmed empty state. */
  ok: boolean;
};

export async function fetchAttendanceDeskFromDb(): Promise<AttendanceDeskSnapshot> {
  const [{ registers, meta, ok }, ancillary] = await Promise.all([
    fetchAttendanceRegistersFromDb(),
    fetchAttendanceDeskAncillaryFromDb(),
  ]);
  return { registers, ancillary, meta, ok };
}

/** Push a single register after API mark (incremental). */
export async function pushAttendanceRegisterToDb(
  register: AttendanceRegister,
): Promise<{ ok: boolean; error?: string }> {
  if (!attendanceDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "No tenant" };
  const { sb, tenantId } = ctx;
  const { header, marks } = registerToRows(tenantId, register);

  const { error: hErr } = await sb
    .from("attendance_desk_registers")
    .upsert(header);
  if (hErr) return { ok: false, error: hErr.message };

  await sb
    .from("attendance_desk_marks")
    .delete()
    .eq("register_id", register.id);

  if (marks.length) {
    const { error: mErr } = await sb.from("attendance_desk_marks").upsert(marks);
    if (mErr) return { ok: false, error: mErr.message };
  }

  const now = new Date().toISOString();
  await sb.from("attendance_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      last_marked_at: register.markedAt || now,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}
