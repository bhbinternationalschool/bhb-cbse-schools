import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { loadAttendance } from "@/lib/attendance";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

/**
 * GET /api/v1/parent/attendance?studentId=&days=90 — one child's attendance
 * history: every marked register day for their section with the child's
 * status, newest first, plus present/absent/late counts for the window.
 */
export async function GET(request: Request) {
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

    await ensureSchoolMirrorHydrated();
    await ensureAttendanceHydratedServer();

    const sis = loadSis();
    const student = sis.students.find((s) => s.id === studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);

    if (ctx.session.persona === "parent") {
      if (
        ctx.session.householdId &&
        student.householdId !== ctx.session.householdId
      ) {
        throw new ApiError("forbidden", "Not your child", 403);
      }
    } else {
      assertPermission(ctx, "attendance", "view");
    }

    const since = new Date(Date.now() - days * 86400_000)
      .toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });

    const ay = ctx.session.academicYearCode || student.academicYearCode;
    const state = loadAttendance();
    const entries = state.registers
      .filter(
        (r) =>
          r.sectionId === student.sectionId &&
          r.academicYearCode === ay &&
          r.date >= since,
      )
      .map((r) => ({
        date: r.date,
        status: r.marks.find((m) => m.studentId === studentId)?.status ?? null,
      }))
      .filter((e) => e.status !== null)
      .sort((a, b) => b.date.localeCompare(a.date));

    const count = (s: string) => entries.filter((e) => e.status === s).length;

    return apiOk({
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
    return apiErr(e);
  }
}
