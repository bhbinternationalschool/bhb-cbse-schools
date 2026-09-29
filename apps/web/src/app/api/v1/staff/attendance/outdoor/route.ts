import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { staffWorkingYear } from "@/lib/api/v1/staffScope";
import {
  applyOutdoorDutyServer,
  loadStaffAttendanceServer,
} from "@/lib/staffAttendance.server";
import {
  activeOutdoorDutyForStaff,
  OUTDOOR_DUTY_PURPOSE_LABELS,
  type OutdoorDutyPurpose,
} from "@/lib/staffAttendance";

export const runtime = "nodejs";

async function me(ctx: Awaited<ReturnType<typeof resolveApiAuth>>) {
  if (ctx.session.persona !== "staff" || !ctx.session.staffId) {
    throw new ApiError("forbidden", "Sign in with your staff login", 403);
  }
  await ensureSchoolMirrorHydrated();
  const staff = (ctx.masters.staff ?? []).find((s) => s.id === ctx.session.staffId);
  if (!staff) {
    throw new ApiError("not_found", "Your login is not linked to a staff record — contact the office.", 404);
  }
  return staff;
}

/** GET /api/v1/staff/attendance/outdoor — my active outdoor duty, if any. */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const staff = await me(ctx);
    const state = await loadStaffAttendanceServer({ fresh: true });
    return apiOk({ active: activeOutdoorDutyForStaff(state, staff.id) });
  } catch (e) {
    return apiErr(e);
  }
}

type Body = {
  action?: "start" | "end";
  purpose?: string;
  destination?: string;
  note?: string;
  sessionId?: string;
  lat?: number;
  lng?: number;
  accuracyM?: number;
};

/**
 * POST /api/v1/staff/attendance/outdoor — check out for official work
 * off-campus (start) or back in (end). Self-service: always the signed-in
 * member of staff. Counts as present for the day, like the desk.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const staff = await me(ctx);
    const body = (await request.json().catch(() => ({}))) as Body;
    if (body.action !== "start" && body.action !== "end") {
      throw new ApiError("bad_request", "action must be start or end", 400);
    }
    const purpose = (
      body.purpose && body.purpose in OUTDOOR_DUTY_PURPOSE_LABELS ? body.purpose : "other"
    ) as OutdoorDutyPurpose;
    const geo =
      Number.isFinite(body.lat) && Number.isFinite(body.lng)
        ? {
            lat: body.lat!,
            lng: body.lng!,
            accuracyM: Number.isFinite(body.accuracyM) ? body.accuracyM! : undefined,
            at: new Date().toISOString(),
          }
        : null;
    const r = await applyOutdoorDutyServer({
      staff,
      action: body.action,
      purpose,
      destination: (body.destination || "").slice(0, 200),
      note: (body.note || "").slice(0, 500),
      sessionId: body.sessionId,
      geo,
      actorName: ctx.session.fullName,
      academicYearCode: staffWorkingYear(ctx),
    });
    if (!r.ok) throw new ApiError("bad_request", r.error, 400);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "staff_attendance",
      action: "edit",
      entityType: "outdoor_duty",
      entityId: r.session.id,
      summary: `Outdoor duty ${body.action === "start" ? "check-out" : "check-in"} · ${OUTDOOR_DUTY_PURPOSE_LABELS[r.session.purpose]} · ${r.session.destination}`,
      ip: meta.ip,
      userAgent: meta.userAgent,
    });
    return apiOk({ session: r.session });
  } catch (e) {
    return apiErr(e);
  }
}
