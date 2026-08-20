import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { requestMeta, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  findStaffRegister,
  normalizeAttendanceSettings,
  punchWayLabel,
} from "@/lib/staffAttendance";
import {
  applyWhatsAppStaffPunch,
  loadStaffAttendanceServer,
} from "@/lib/staffAttendance.server";
import { campusGeofenceFromSettings } from "@/lib/staffGeofence.server";

export const runtime = "nodejs";

function todayIst(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

async function resolveStaff(
  ctx: Awaited<ReturnType<typeof resolveApiAuth>>,
  fallbackStaffId?: string,
) {
  if (ctx.session.persona !== "staff") {
    throw new ApiError("forbidden", "Staff session required", 403);
  }
  // session.staffId is set by real logins; dev/demo sessions may pass a
  // staffId explicitly (same convention as /api/v1/staff/summary).
  const staffId = ctx.session.staffId || fallbackStaffId || "";
  const staff = ctx.masters.staff.find((s) => s.id === staffId);
  if (!staff) {
    throw new ApiError(
      "not_found",
      "Your login is not linked to a staff record yet — contact the office.",
      404,
    );
  }
  return staff;
}

/**
 * GET /api/v1/staff/attendance/punch — the punch card's state: campus
 * geofence (so the app can show live distance before submitting) and
 * today's own punch times.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    await ensureSchoolMirrorHydrated();

    const url = new URL(request.url);
    const staff = await resolveStaff(
      ctx,
      url.searchParams.get("staffId")?.trim(),
    );

    const state = await loadStaffAttendanceServer();
    const settings = normalizeAttendanceSettings(state.settings);
    const fence = campusGeofenceFromSettings(settings);

    const date = todayIst();
    const ay = ctx.session.academicYearCode;
    const register = findStaffRegister(state, date, ay);
    const mark = register?.marks.find((m) => m.staffId === staff.id) ?? null;

    return apiOk({
      staffId: staff.id,
      staffName: staff.fullName,
      date,
      allowSelfPunch: settings.allowSelfPunch,
      fence,
      today: mark
        ? {
            status: mark.status,
            inTime: mark.inTime || null,
            outTime: mark.outTime || null,
            punchWay: mark.punchWay || null,
            punchWayLabel: punchWayLabel(mark.punchWay),
          }
        : null,
    });
  } catch (e) {
    return apiErr(e);
  }
}

type PunchBody = {
  kind: "in" | "out";
  lat: number;
  lng: number;
  accuracyM?: number;
    mocked?: boolean;
  staffId?: string;
};

/** POST /api/v1/staff/attendance/punch — GPS self punch from the app */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    await ensureSchoolMirrorHydrated();

    const body = (await request.json()) as PunchBody;
    if (body.kind !== "in" && body.kind !== "out") {
      throw new ApiError("bad_request", "kind must be 'in' or 'out'", 400);
    }
    if (!Number.isFinite(body.lat) || !Number.isFinite(body.lng)) {
      throw new ApiError("bad_request", "lat and lng required", 400);
    }

    const staff = await resolveStaff(ctx, body.staffId);

    const result = await applyWhatsAppStaffPunch({
      staff,
      mobile10: "",
      kind: body.kind,
      geo: {
        lat: body.lat,
        lng: body.lng,
        accuracyM: body.accuracyM,
        mocked: body.mocked === true,
      },
      via: "app",
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "staff_attendance",
      action: "edit",
      entityType: "punch",
      entityId: staff.id,
      summary: `App GPS punch-${result.kind} at ${result.time} (~${Math.round(result.distanceM)} m from campus)`,
      after: { kind: result.kind, time: result.time },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({
      kind: result.kind,
      time: result.time,
      distanceM: Math.round(result.distanceM),
      status: result.mark.status,
      inTime: result.mark.inTime || null,
      outTime: result.mark.outTime || null,
    });
  } catch (e) {
    return apiErr(e);
  }
}
