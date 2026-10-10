import { writeAudit } from "@/lib/audit.server";
import { appBuildFromHeaders } from "@/lib/appMinBuild";
import { STAFF_PLAY_TEST_URL } from "@/lib/pwaApps";
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
import { campusGeofenceFromSettings, validateStaffPunchLocation } from "@/lib/staffGeofence.server";
import { fetchStaffAttendanceSettingsFromDb } from "@/lib/staffAttendanceDeskAncillary.server";
import { cleanPunchCode } from "@/lib/punchCode";
import { istDateTime } from "@/lib/punchAttempts";
import { printedQrTokenIsValid, punchCodeIsValid } from "@/lib/punchCode.server";
import { loadPunchOptions } from "@/lib/punchOptions.server";
import { PRINTED_QR_MAX_ACCURACY_M, punchWindowMessage, punchWindowState } from "@/lib/punchSchedule";
import {
  checkPunchDevice,
  cleanJwk,
  punchMessage,
  verifyPunchSignature,
} from "@/lib/punchDevices.server";
import { staffWorkingYear } from "@/lib/api/v1/staffScope";
import { APP_UPDATE_MESSAGE, requestNeedsAppUpdate } from "@/lib/appMinBuild";

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
      punchWindow: await loadPunchOptions().then((o) => ({
        ...punchWindowState(o, Date.now()),
        windowStart: o.windowStart,
        windowEnd: o.windowEnd,
        printedQrEnabled: o.printedQrEnabled,
      })),
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
  /** The printed gate QR's token — the backup when the gate phone is off. */
  place?: string;
  device?: { jwk?: unknown; signature?: string; ts?: number; label?: string };
  staffId?: string;
  /** The phone's own position — inside the school, or no punch (3 Oct 2026). */
  lat?: number;
  lng?: number;
  accuracyM?: number;
  mocked?: boolean;
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
 *  3. the phone's location, inside the school (director, 3 Oct 2026) — a
 *     code photographed and sent home no longer punches from home.
 * A dead phone or no internet is not covered by anything else: they punch
 * once their own phone is back (or with the code on WhatsApp from their
 * registered number).
 */
export async function POST(request: Request) {
  // Who was refused, for the log line below — filled once the caller is known.
  let who = "";
  try {
    // An app build the server no longer understands is told to update,
    // rather than failing the punch for a reason the staff member can't fix.
    if (requestNeedsAppUpdate(request)) {
      throw new ApiError("upgrade_required", APP_UPDATE_MESSAGE, 426);
    }
    const ctx = await resolveApiAuth(request);
    who = ctx.session.staffId || "";
    await ensureSchoolMirrorHydrated();

    const body = (await request.json()) as PunchBody;
    if (body.kind !== "in" && body.kind !== "out") {
      throw new ApiError("bad_request", "kind must be 'in' or 'out'", 400);
    }
    const staff = await resolveStaff(ctx, body.staffId);

    // Only inside the gate window (director, 5 Oct 2026) — screen, printed
    // QR and WhatsApp alike. A photo of a code is no use out of hours.
    const options = await loadPunchOptions();
    const gate = punchWindowState(options, Date.now());
    if (!gate.open) throw new ApiError("forbidden", punchWindowMessage(options, gate), 403, { reason: "closed" });

    const place = typeof body.place === "string" ? body.place.trim() : "";
    const printed = !!place;
    const code = printed ? "" : cleanPunchCode(body.code);
    if ((!printed && !code) || !body.device) {
      throw new ApiError(
        "bad_request",
        "Punch at school: scan the QR on the office screen, or type its 6-digit code, in the ERP on your own phone.",
        400,
      );
    }
    if (printed) {
      if (!options.printedQrEnabled) {
        throw new ApiError("forbidden", "The printed gate QR is switched off. Scan the QR on the gate phone.", 403);
      }
      if (!printedQrTokenIsValid(place, options.printedQrVersion)) {
        throw new ApiError(
          "forbidden",
          "This printed QR is old and no longer works. Scan the QR on the gate phone, or the newly printed one.",
          403,
        );
      }
    } else if (!punchCodeIsValid(code)) {
      throw new ApiError(
        "bad_request",
        "That code has expired — it changes every 30 seconds. Scan the office screen again.",
        400,
      );
    }
    // The phone must be inside the school (director, 3 Oct 2026).
    const lat = Number(body.lat);
    const lng = Number(body.lng);
    if (!Number.isFinite(lat) || !Number.isFinite(lng) || (lat === 0 && lng === 0)) {
      throw new ApiError(
        "forbidden",
        "Allow location for the ERP on this phone — punches count only from inside the school.",
        403,
      );
    }
    const fence = campusGeofenceFromSettings(await fetchStaffAttendanceSettingsFromDb());
    const where = validateStaffPunchLocation(
      {
        lat,
        lng,
        accuracyM: Number.isFinite(Number(body.accuracyM)) ? Number(body.accuracyM) : undefined,
        mocked: body.mocked === true,
      },
      fence,
    );
    if (!where.ok) throw new ApiError("forbidden", where.reason || "Punches count only from inside the school.", 403);
    // A printed QR cannot rotate, so the phone's fix must be tight — a rough
    // fix 150 m away is where a photo of the print would be used from.
    if (printed) {
      const acc = Number(body.accuracyM);
      if (!Number.isFinite(acc) || acc > PRINTED_QR_MAX_ACCURACY_M) {
        throw new ApiError(
          "forbidden",
          `Your phone's location is not precise enough (needs ±${PRINTED_QR_MAX_ACCURACY_M} m). Turn on GPS / high-accuracy location, stand in the open for a moment, and try again.`,
          403,
        );
      }
    }
    // Android phones punch in the BHB Staff app only (director, 10 Oct 2026):
    // the website and the app keep separate keys, so moving between them
    // made the same phone ask for approval again every day. iPhones have no
    // staff app and keep punching on the website.
    const ua = request.headers.get("user-agent") || "";
    if (/android/i.test(ua) && appBuildFromHeaders(request.headers).flavor !== "staff") {
      throw new ApiError(
        "forbidden",
        `On an Android phone, punch in the BHB Staff app — it remembers your phone. Get it here: ${STAFF_PLAY_TEST_URL}`,
        403,
        { reason: "use_app" },
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
      punchMessage({ staffId: staff.id, kind: body.kind, code: printed ? `P:${place}` : code, ts }),
      body.device.signature,
    );
    if (!signed) {
      throw new ApiError("forbidden", "This punch was not signed by this phone. Reload the page and try again.", 403);
    }

    const device = await checkPunchDevice({
      staffId: staff.id,
      jwk,
      label: String(body.device.label || ""),
      phoneId: String((body.device as { phoneId?: unknown }).phoneId ?? ""),
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
      presence: printed ? "printed_qr" : "qr",
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
      summary: `${printed ? `Printed-QR (v${options.printedQrVersion})` : "Office-QR"} punch-${result.kind} at ${result.time} from own phone${device.firstRegistration ? " (phone registered on this punch)" : device.rekeyed ? " (same phone, app reinstalled — key replaced)" : ""}`,
      after: {
        kind: result.kind,
        time: result.time,
        firstRegistration: device.firstRegistration,
        via: printed ? "printed_qr" : "screen_qr",
        lat,
        lng,
        accuracyM: Number(body.accuracyM),
      },
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
    // A refused punch used to leave only "POST 400" in the request log, so on
    // 6 Oct 2026 nobody could tell why a staff member's 08:00 punch failed.
    // The reason is the message the phone was shown; it names no secret.
    const status = e instanceof ApiError ? e.status : 500;
    console.warn(
      `[staff punch] refused ${status} ${who || "unknown caller"}: ${(e as Error)?.message || String(e)}`,
    );
    return apiErr(e);
  }
}
