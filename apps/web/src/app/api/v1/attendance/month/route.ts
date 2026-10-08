import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertSectionScope } from "@/lib/api/v1/staffScope";
import { sectionKey } from "@/lib/staffTeachingScope";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAttendanceHydratedServer } from "@/lib/attendancePersistence";
import { loadAttendance } from "@/lib/attendance";
import { markAttendanceServer } from "@/lib/attendanceMark.server";
import { buildMonthView, planMonthSave, sessionMonths, type MonthSaveDay } from "@/lib/attendanceMonthRegister";
import { loadSis, studentsInSession } from "@/lib/sis";
import { istToday } from "@/lib/dailyBrief.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * The month register (director, 8 Oct 2026) — a class teacher's whole month
 * on one table, back-dated days included.
 *
 * GET  ?classId&sectionId&month=YYYY-MM   the month: days (working /
 *      holiday / future), each child's marks, start date, and working vs
 *      present days for the month and the session so far.
 * POST {classId, sectionId, month, days:[{date, marks:[{studentId,status}]}]}
 *      one register write per changed day, merged over what is saved.
 *
 * Reading: anyone who may see this section. Writing: its class teacher or
 * the office — a subject teacher marks the day from the normal register,
 * not a whole month of someone else's class. No "absent" alerts go to
 * parents for these writes: they are about past days.
 */

async function sectionContext(request: Request, classId: string, sectionId: string, ayParam?: string) {
  const ctx = await resolveApiAuth(request);
  if (!classId || !sectionId) throw new ApiError("bad_request", "classId and sectionId required", 400);
  await ensureSchoolMirrorHydrated();
  const scope = await assertSectionScope(ctx, classId, sectionId);
  const ay = scope.unrestricted ? ayParam || scope.academicYearCode : scope.academicYearCode;
  const students = studentsInSession(loadSis(), ay).filter(
    (s) => s.classId === classId && s.sectionId === sectionId && s.status === "active",
  );
  const canEdit = scope.unrestricted || scope.classTeacherOf.has(sectionKey(classId, sectionId));
  return { ctx, scope, ay, students, canEdit };
}

export async function GET(request: Request) {
  try {
    const url = new URL(request.url);
    const classId = url.searchParams.get("classId") || "";
    const sectionId = url.searchParams.get("sectionId") || "";
    const { ctx, ay, students, canEdit } = await sectionContext(
      request,
      classId,
      sectionId,
      url.searchParams.get("academicYearCode") || undefined,
    );
    assertPermission(ctx, "attendance", "view");
    await ensureAttendanceHydratedServer();
    const today = istToday();
    const months = sessionMonths(ctx.masters, ay, today);
    const month = url.searchParams.get("month") || months[0] || today.slice(0, 7);
    const view = buildMonthView({
      masters: ctx.masters,
      ay,
      classId,
      month,
      students,
      registers: loadAttendance().registers,
      today,
    });
    if ("error" in view) throw new ApiError("bad_request", view.error, 400);
    return apiOk({ academicYearCode: ay, today, months, canEdit, ...view });
  } catch (e) {
    return apiErr(e);
  }
}

type SaveBody = {
  classId: string;
  sectionId: string;
  month: string;
  academicYearCode?: string;
  days: MonthSaveDay[];
};

export async function POST(request: Request) {
  try {
    const body = (await request.json()) as SaveBody;
    const { ctx, ay, students, canEdit } = await sectionContext(
      request,
      body.classId,
      body.sectionId,
      body.academicYearCode,
    );
    assertPermission(ctx, "attendance", "edit");
    if (!canEdit) {
      throw new ApiError(
        "forbidden",
        "Only the class teacher (or the office) can fill the month register for this class",
        403,
      );
    }
    if (!Array.isArray(body.days) || body.days.length === 0) {
      throw new ApiError("bad_request", "Nothing to save", 400);
    }
    if (body.days.length > 31) throw new ApiError("bad_request", "One month at a time", 400);
    await ensureAttendanceHydratedServer();
    const today = istToday();
    const { plan, refused } = planMonthSave({
      masters: ctx.masters,
      ay,
      classId: body.classId,
      sectionId: body.sectionId,
      month: body.month,
      students,
      registers: loadAttendance().registers,
      days: body.days,
      today,
    });

    const saved: string[] = [];
    const failed: string[] = [];
    for (const day of plan) {
      const r = await markAttendanceServer({
        session: ctx.session,
        masters: ctx.masters,
        academicYearCode: ay,
        classId: body.classId,
        sectionId: body.sectionId,
        date: day.date,
        marks: day.marks,
        remark: "Month register",
        notifyAbsent: false,
      });
      if (r.ok) saved.push(day.date);
      else failed.push(`${day.date}: ${r.error}`);
    }

    if (saved.length) {
      const meta = requestMeta(request);
      await writeAudit({
        session: ctx.session,
        module: "attendance",
        action: "edit",
        entityType: "register",
        entityId: `${body.sectionId}:${body.month}`,
        summary: `Month register ${body.month} section ${body.sectionId}: ${saved.length} day(s) saved`,
        after: { month: body.month, days: saved },
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
    }
    return apiOk({ saved, refused, failed });
  } catch (e) {
    return apiErr(e);
  }
}
