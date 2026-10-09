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
import {
  deleteChildrenNotKept,
  deleteNamedIds,
  type NamedDeletes,
} from "@/lib/deskNamedDeletes.server";
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";
import { replaceChildRows } from "./replaceChildRows.server";

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
  deleteIds: readonly string[] = [],
): Promise<{ ok: boolean; count: number; error?: string }> {
  if (!attendanceDualWriteDbEnabled()) {
    return { ok: true, count: 0 };
  }
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, count: 0, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = new Date().toISOString();

  const gone = new Set(deleteIds);
  const named = (registers ?? []).filter((r) => !gone.has(r.id));
  // One register per section, year and date (a unique key). When the stored
  // one for that slot has a different id — a teacher marked it from the app
  // after this browser last read — the stored register stands and this copy
  // is skipped. The old prune settled the same collision by deleting the
  // stored one, the teacher's.
  const slotKey = (section: string, ay: string, date: string) => `${section}|${ay}|${date}`;
  const dates = [...new Set(named.map((r) => r.date).filter(Boolean))];
  const storedBySlot = new Map<string, string>();
  if (dates.length) {
    const { rows, error } = await fetchByIds<{
      id: string;
      section_id: string;
      academic_year_code: string;
      attendance_date: string;
    }>(dates, (chunk, from, to) =>
      sb
        .from("attendance_desk_registers")
        .select("id, section_id, academic_year_code, attendance_date")
        .eq("tenant_id", tenantId)
        .in("attendance_date", chunk)
        .order("id")
        .range(from, to),
    );
    if (error) return { ok: false, count: 0, error };
    for (const r of rows) {
      storedBySlot.set(slotKey(r.section_id, r.academic_year_code, String(r.attendance_date).slice(0, 10)), r.id);
    }
  }
  const active = named.filter((r) => {
    const stored = storedBySlot.get(slotKey(r.sectionId, r.academicYearCode, r.date));
    if (stored && stored !== r.id) {
      console.warn(
        `[attendance-db] kept stored register ${stored} for ${r.sectionId} ${r.date}; skipped this copy (${r.id})`,
      );
      return false;
    }
    return true;
  });
  // Marks go with their register (on delete cascade).
  const delRegs = await deleteNamedIds(sb, tenantId, "attendance_desk_registers", [...gone]);
  if (!delRegs.ok) return { ok: false, count: 0, error: delRegs.error };

  // Attendance is history. A push is NOT a statement that these are the only
  // registers that exist — not even for the dates it covers.
  //
  // This first deleted every register the client lacked (2026-08-11: a
  // phone with a dropped cache erased the previous day), then every register
  // it lacked ON THE DATES IT COVERED. That still erased teachers' registers
  // for today, saved through /api/v1/attendance/mark or by leave approval
  // after the office tab last read. A register leaves only when the user
  // deleted it, named — see deleteNamedIds below.
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

  // Marks are written first, then a register's marks that its new copy no
  // longer lists are removed — only for registers that arrived WITH marks.
  // This used to delete every mark of every pushed register and then insert:
  // a failed insert left registers with no marks at all.
  for (let i = 0; i < marks.length; i += 500) {
    const { error } = await sb
      .from("attendance_desk_marks")
      .upsert(marks.slice(i, i + 500));
    if (error) return { ok: false, count: 0, error: error.message };
  }
  const keepMarks = new Set(marks.map((m) => String((m as { id: string }).id)));
  const delMarks = await deleteChildrenNotKept(
    sb,
    tenantId,
    "attendance_desk_marks",
    "register_id",
    active.filter((r) => (r.marks ?? []).length > 0).map((r) => r.id),
    keepMarks,
  );
  if (!delMarks.ok) return { ok: false, count: 0, error: delMarks.error };

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

  // Paged, ordered by id for stable pages; sorted by date afterwards so the
  // callers still see newest first. 483 registers today, 1,000 by early 2027.
  const headersRes = await fetchAllPages<Record<string, unknown>>((from, to) =>
    sb
      .from("attendance_desk_registers")
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

  // Every mark of every register: chunked by register id and paged. One
  // request for all of them hydrated 1,000 of 10,315 marks (2026-09-06) —
  // whole days read as unmarked on every machine that loaded from the server.
  const [markRes, { data: metaRow, error: metaErr }] = await Promise.all([
    fetchByIds<Record<string, unknown>>(ids, (chunk, from, to) =>
      sb
        .from("attendance_desk_marks")
        .select("*")
        .eq("tenant_id", tenantId)
        .in("register_id", chunk)
        .order("id", { ascending: true })
        .range(from, to),
    ),
    sb
      .from("attendance_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);
  const markRows = markRes.rows;
  const mErr = markRes.error ? { message: markRes.error } : null;

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

/**
 * One section's register for one date, read straight from the database.
 *
 * For a server write that changes a single mark (approved student leave,
 * 2026-09-29): this instance's in-memory desk can be minutes old, and
 * pushing a register rebuilt from it would put back every other child's
 * stale mark. `ok: false` means the read failed — never "no register".
 * `ambiguous` means more than one register row matched; the caller must not
 * guess which one the school reads.
 */
export async function fetchAttendanceRegisterFromDb(
  academicYearCode: string,
  sectionId: string,
  date: string,
): Promise<
  | { ok: true; register: AttendanceRegister | null; ambiguous: boolean }
  | { ok: false; error: string }
> {
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "No tenant" };
  const { sb, tenantId } = ctx;
  const { data: headers, error: hErr } = await sb
    .from("attendance_desk_registers")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("academic_year_code", academicYearCode)
    .eq("section_id", sectionId)
    .eq("attendance_date", date)
    .limit(2);
  if (hErr) return { ok: false, error: hErr.message };
  if (!headers?.length) return { ok: true, register: null, ambiguous: false };
  if (headers.length > 1) return { ok: true, register: null, ambiguous: true };
  const header = headers[0] as Record<string, unknown>;

  // A class is far under 1,000 children; paged anyway so a register can
  // never come back with a silently truncated mark list (2026-09-06).
  const markRes = await fetchAllPages<Record<string, unknown>>((from, to) =>
    sb
      .from("attendance_desk_marks")
      .select("*")
      .eq("tenant_id", tenantId)
      .eq("register_id", String(header.id))
      .order("id", { ascending: true })
      .range(from, to),
  );
  if (markRes.error) return { ok: false, error: markRes.error };
  return {
    ok: true,
    register: rowToRegister(header, markRes.rows),
    ambiguous: false,
  };
}

/** The attendance tables a desk save deletes from — by named id only. */
export const ATTENDANCE_DELETABLE_TABLES = [
  "attendance_desk_registers",
  "attendance_desk_absent_nudges",
  "attendance_desk_exceptions",
] as const;
/** Desk slice each deletable table stores (for function-only writers). */
export const ATTENDANCE_TABLE_SLICES: Record<string, string> = {
  attendance_desk_registers: "registers",
  attendance_desk_absent_nudges: "absentNudges",
  attendance_desk_exceptions: "exceptions",
};

export async function pushAttendanceDeskToDb(
  state: Pick<AttendanceState, "registers"> & Partial<AttendanceDeskAncillary>,
  deletes: NamedDeletes = {},
): Promise<{
  ok: boolean;
  error?: string;
  registerCount: number;
}> {
  const regResult = await pushAttendanceRegistersToDb(
    state.registers ?? [],
    deletes["attendance_desk_registers"] ?? [],
  );
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
  }, deletes);
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

  // One transaction: a failed insert rolls the delete back, so a register
  // cannot end up with its whole day's attendance deleted and nothing put
  // back. Two statements is how the fee book lost every line on 2026-09-06.
  const marksWrite = await replaceChildRows(sb, {
    table: "attendance_desk_marks",
    tenantId,
    match: { register_id: register.id },
    rows: marks,
  });
  if (!marksWrite.ok) return { ok: false, error: marksWrite.error };

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
