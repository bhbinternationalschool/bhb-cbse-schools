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
import { cleanPunchCode } from "@/lib/punchCode";
import { istDateTime } from "@/lib/punchAttempts";
import { punchCodeIsValid } from "@/lib/punchCode.server";
import {
  checkPunchDevice,
  cleanJwk,
  punchMessage,
  verifyPunchSignature,
} from "@/lib/punchDevices.server";
import { staffWorkingYear } from "@/lib/api/v1/staffScope";

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
  // session.staffId is set by real logins. The explicit staffId is a
  // dev-only convenience: in production it let a session with no roster
  // link punch as anybody it named.
  const staffId =
    ctx.session.staffId ||
    (process.env.NODE_ENV !== "production" ? fallbackStaffId : "") ||
    "";
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

    const state = await loadStaffAttendanceServer({ fresh: true });
    const settings = normalizeAttendanceSettings(state.settings);
    const fence = campusGeofenceFromSettings(settings);

    const date = todayIst();
    // The same year the POST files under — they used to differ, so a punch
    // could be saved yet read back as "not punched".
    const ay = staffWorkingYear(ctx);
    const register = findStaffRegister(state, date, ay);
    const mark = register?.marks.find((m) => m.staffId === staff.id) ?? null;

    return apiOk({
      staffId: staff.id,
      staffName: staff.fullName,
      date,
      allowSelfPunch: settings.allowSelfPunch,
      // Punches need the office screen's code and this phone's key (30 Sep 2026).
      qrRequired: true,
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
  /** The office screen's six-digit code (or the QR link it encodes). */
  code?: string;
  device?: { jwk?: unknown; signature?: string; ts?: number; label?: string };
  staffId?: string;
};

/** How far a phone's clock may be from ours when it signs. */
const SIGN_SKEW_MS = 2 * 60_000;

/**
 * POST /api/v1/staff/attendance/punch — a staff member's own punch.
 *
 * Since 30 Sep 2026 (director: "only the staff's actual phone, not a proxy
 * phone") a punch needs BOTH:
 *  1. the office screen's code of the last minute (lib/punchCode) — the
 *     phone was at the gate; a GPS pin could be faked or dropped anywhere;
 *  2. a signature by the phone's registered key (lib/punchDevices.server) —
 *     it is THEIR phone. First punch registers the phone; another phone is
 *     refused and waits for the office; a phone registered to someone else
 *     is refused outright.
 * A dead phone or no internet is not covered by anything else: they punch
 * once their own phone is back (or with the code on WhatsApp from their
 * registered number).
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    await ensureSchoolMirrorHydrated();

    const body = (await request.json()) as PunchBody;
    if (body.kind !== "in" && body.kind !== "out") {
      throw new ApiError("bad_request", "kind must be 'in' or 'out'", 400);
    }
    const staff = await resolveStaff(ctx, body.staffId);

    const code = cleanPunchCode(body.code);
    if (!code || !body.device) {
      throw new ApiError(
        "bad_request",
        "Punch at school: scan the QR on the office screen, or type its 6-digit code, in the ERP on your own phone.",
        400,
      );
    }
    if (!punchCodeIsValid(code)) {
      throw new ApiError(
        "bad_request",
        "That code has expired — it changes every 30 seconds. Scan the office screen again.",
        400,
      );
    }
    const jwk = cleanJwk(body.device.jwk);
    const ts = Number(body.device.ts);
    if (!jwk || !body.device.signature || !Number.isFinite(ts)) {
      throw new ApiError("bad_request", "This phone's key is missing — reload the page and try again.", 400);
    }
    if (Math.abs(Date.now() - ts) > SIGN_SKEW_MS) {
      throw new ApiError(
        "bad_request",
        "Your phone's clock is wrong. Set date & time to automatic, then punch again.",
        400,
      );
    }
    const signed = await verifyPunchSignature(
      jwk,
      punchMessage({ staffId: staff.id, kind: body.kind, code, ts }),
      body.device.signature,
    );
    if (!signed) {
      throw new ApiError("forbidden", "This punch was not signed by this phone. Reload the page and try again.", 403);
    }

    const device = await checkPunchDevice({
      staffId: staff.id,
      jwk,
      label: String(body.device.label || ""),
      attempt: { kind: body.kind, at: new Date().toISOString() },
    }).catch((e: unknown) => {
      console.warn("[punch] device check threw", (e as Error)?.message);
      return { ok: false as const, reason: "unavailable" as const };
    });
    if (!device.ok) {
      if (device.reason === "other_staff") {
        const owner = ctx.masters.staff.find((s) => s.id === device.otherStaffId)?.fullName || "another staff member";
        throw new ApiError(
          "forbidden",
          `This phone is registered for ${owner}'s attendance. Each person punches from their own phone.`,
          403,
          { reason: "other_staff" },
        );
      }
      if (device.reason === "not_registered") {
        throw new ApiError(
          "forbidden",
          `This is not your registered punch phone. The office has been asked to approve it — your punch ${body.kind.toUpperCase()} at ${istDateTime(Date.now()).time} will count if they approve it today.`,
          403,
          { reason: "not_registered" },
        );
      }
      throw new ApiError("server_error", "Could not check your phone right now — try again in a minute.", 503);
    }

    const result = await applyWhatsAppStaffPunch({
      staff,
      mobile10: "",
      kind: body.kind,
      presence: "qr",
      via: "app",
      academicYearCode: staffWorkingYear(ctx),
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "staff_attendance",
      action: "edit",
      entityType: "punch",
      entityId: staff.id,
      summary: `Office-QR punch-${result.kind} at ${result.time} from own phone${device.firstRegistration ? " (phone registered on this punch)" : ""}`,
      after: { kind: result.kind, time: result.time, firstRegistration: device.firstRegistration },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({
      kind: result.kind,
      time: result.time,
      status: result.mark.status,
      inTime: result.mark.inTime || null,
      outTime: result.mark.outTime || null,
      firstRegistration: device.firstRegistration,
    });
  } catch (e) {
    return apiErr(e);
  }
}
