import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { hasPermission } from "@/lib/rbac";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { staffWorkingYear } from "@/lib/api/v1/staffScope";
import { applyStaffDayMarkServer } from "@/lib/staffAttendance.server";
import { surveyEndMark, surveyStartMark } from "@/lib/surveyAttendanceBridge";

export const runtime = "nodejs";

type Body = {
  action?: "start" | "end";
  staffId?: string;
  beatName?: string;
  date?: string;
  startedAt?: string;
  endedAt?: string;
  workedMs?: number;
};

function istDate(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? ""
    : d.toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * POST /api/v1/staff/attendance/survey — a field-survey Start or End counts
 * as outdoor duty on the member's staff attendance for that day.
 *
 * The member themself, or whoever runs the survey team (admissions edit),
 * may record it.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    const body = (await request.json().catch(() => ({}))) as Body;
    const staffId = (body.staffId || "").trim();
    if (body.action !== "start" && body.action !== "end") {
      throw new ApiError("bad_request", "action must be start or end", 400);
    }
    if (!staffId || !body.startedAt) {
      throw new ApiError("bad_request", "staffId and startedAt required", 400);
    }
    const self = ctx.session.staffId === staffId;
    if (
      !self &&
      !hasPermission(ctx.session, ctx.masters, "admissions", "edit", ctx.rbac)
    ) {
      throw new ApiError("forbidden", "You can only record your own survey attendance", 403);
    }
    await ensureSchoolMirrorHydrated();
    const staff = (ctx.masters.staff ?? []).find((s) => s.id === staffId);
    if (!staff) throw new ApiError("not_found", "Not on the staff roster", 404);

    const date =
      (body.date && /^\d{4}-\d{2}-\d{2}$/.test(body.date) ? body.date : "") ||
      istDate(body.startedAt);
    if (!date) throw new ApiError("bad_request", "startedAt is not a date", 400);

    const beat = (body.beatName || "").slice(0, 120);
    const result = await applyStaffDayMarkServer({
      staffId,
      date,
      academicYearCode: staffWorkingYear(ctx),
      markedBy: "Field survey",
      build: (existing) => {
        if (body.action === "start") return surveyStartMark(existing, beat, body.startedAt!);
        // eslint-disable-next-line @typescript-eslint/no-unused-vars
        const { usedSurveyOutTime, ...mark } = surveyEndMark(
          existing,
          {
            startedAt: body.startedAt!,
            endedAt: body.endedAt || new Date().toISOString(),
            workedMs: Math.max(0, Number(body.workedMs) || 0),
          },
          beat,
        );
        return mark;
      },
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "staff_attendance",
      action: "edit",
      entityType: "survey_attendance",
      entityId: staffId,
      summary: `Field survey ${body.action} → attendance ${date} (${staff.fullName})`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ staffId, date, action: body.action });
  } catch (e) {
    return apiErr(e);
  }
}
