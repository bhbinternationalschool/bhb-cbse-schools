import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertParentOwnsChild } from "@/lib/api/v1/household";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { readStudentById } from "@/lib/data/server/householdRead";
import { routeTimer } from "@/lib/data/server/routeTiming";
import { getServerTenantContext } from "@/lib/serverTenant";

export const runtime = "nodejs";

type MarkRow = {
  status: string | null;
  attendance_desk_registers: { attendance_date: string } | { attendance_date: string }[] | null;
};

/**
 * One child's marks in one section and year since a date, newest first —
 * read from SQL (data-layer 4.1b). The route used to hydrate the whole school
 * mirror and every register of every section into the process, then filter.
 *
 * The marks table holds one row per (register, student) (a unique key), so
 * "the child's status in that register" is that row. Null on a failed read
 * (R6: unknown is not "no attendance").
 */
async function readChildMarks(
  studentId: string,
  sectionId: string,
  academicYearCode: string,
  since: string,
): Promise<{ date: string; status: string }[] | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { data, error } = await ctx.sb
    .from("attendance_desk_marks")
    .select("status, attendance_desk_registers!inner(attendance_date)")
    .eq("tenant_id", ctx.tenantId)
    .eq("student_id", studentId)
    .eq("attendance_desk_registers.tenant_id", ctx.tenantId)
    .eq("attendance_desk_registers.section_id", sectionId)
    .eq("attendance_desk_registers.academic_year_code", academicYearCode)
    .gte("attendance_desk_registers.attendance_date", since)
    // At most one register a day for a section and year (366 days at most):
    // far below PostgREST's 1,000-row cap.
    .limit(1000);
  if (error) {
    console.warn("[v1/parent/attendance] marks read failed", error.message);
    return null;
  }
  const out: { date: string; status: string }[] = [];
  for (const row of (data ?? []) as MarkRow[]) {
    const reg = Array.isArray(row.attendance_desk_registers) ? row.attendance_desk_registers[0] : row.attendance_desk_registers;
    if (!reg) continue;
    // As the register loader normalises a mark: an empty status reads "P".
    out.push({ date: String(reg.attendance_date).slice(0, 10), status: String(row.status) || "P" });
  }
  return out;
}

/**
 * GET /api/v1/parent/attendance?studentId=&days=90 — one child's attendance
 * history: every marked register day for their section with the child's
 * status, newest first, plus present/absent/late counts for the window.
 */
export async function GET(request: Request) {
  const timer = routeTimer("v1/parent/attendance");
  let res: Response;
  try {
    const ctx = await resolveApiAuth(request);

    const url = new URL(request.url);
    const studentId = url.searchParams.get("studentId")?.trim() || "";
    const days = Math.min(
      Math.max(parseInt(url.searchParams.get("days") || "90", 10) || 90, 7),
      366,
    );
    if (!studentId) {
      throw new ApiError("bad_request", "studentId required", 400);
    }

    timer.phase("query");
    const read = await readStudentById(studentId);
    if (!read.ok) {
      console.warn("[v1/parent/attendance] student read failed", read.reason);
      throw new ApiError("server_error", "Could not read attendance just now — please try again.", 503);
    }
    const student = read.student;
    if (!student) throw new ApiError("not_found", "Student not found", 404);

    if (ctx.session.persona === "parent") {
      assertParentOwnsChild(ctx, student);
    } else {
      assertPermission(ctx, "attendance", "view");
    }

    const since = new Date(Date.now() - days * 86400_000)
      .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

    const ay = ctx.session.academicYearCode || student.academicYearCode;
    const marks = await readChildMarks(studentId, student.sectionId, ay, since);
    if (!marks) {
      throw new ApiError("server_error", "Could not read attendance just now — please try again.", 503);
    }

    timer.phase("build");
    const entries = marks
      .map((m) => ({ date: m.date, status: m.status }))
      .sort((a, b) => b.date.localeCompare(a.date));

    const count = (s: string) => entries.filter((e) => e.status === s).length;
    timer.note("entries", entries.length);

    res = apiOk({
      studentId,
      studentName: student.fullName,
      academicYearCode: ay,
      sinceDate: since,
      markedDays: entries.length,
      presentDays: count("P"),
      absentDays: count("A"),
      lateDays: count("L"),
      entries,
    });
  } catch (e) {
    res = apiErr(e);
  }
  timer.done(res.status);
  return res;
}
