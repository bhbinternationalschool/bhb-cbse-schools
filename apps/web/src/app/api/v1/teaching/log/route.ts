import { writeAudit } from "@/lib/audit.server";
import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import {
  assertPermission,
  requestMeta,
  resolveApiAuth,
} from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureTimetableHydratedServer } from "@/lib/timetablePersistence";
import {
  ensureTeachingHydratedServer,
  pushTeachingRemoteServer,
} from "@/lib/teachingPersistence";
import { loadTimetable } from "@/lib/timetable";
import { loadStaffAttendanceServer } from "@/lib/staffAttendance.server";
import { normalizeAttendanceSettings } from "@/lib/staffAttendance";
import {
  campusGeofenceFromSettings,
  haversineDistanceM,
} from "@/lib/staffGeofence.server";
import {
  istDateOf,
  loadTeaching,
  resolveExpectedPeriods,
  unknownTeachingLogLocation,
  upsertTeachingLog,
  writeTeachingLocalRaw,
  type TeachingLogLocation,
  type TeachingLogStatus,
} from "@/lib/teaching";

export const runtime = "nodejs";

type LogBody = {
  date?: string;
  periodNo?: number;
  classId?: string;
  sectionId?: string;
  status?: string;
  unitIds?: string[];
  lessonPlanId?: string;
  note?: string;
  /** Client's own clock for when the period started; validated below */
  startedAt?: string;
  /** Optional GPS fix taken as the teacher filed the log */
  lat?: number;
  lng?: number;
  accuracyM?: number;
};

function parseStatus(v: unknown): TeachingLogStatus {
  return v === "not_delivered" || v === "substituted" ? v : "delivered";
}

/**
 * Turn an optional GPS fix into a campus-presence verdict.
 *
 * Two things this must never do. It must not reject the log — a teacher
 * whose phone cannot see a satellite still took the class, and blocking
 * them would train the whole staff room to stop logging. And it must not
 * report a low-confidence fix as `off_campus`: a reading accurate to
 * ±800 m says nothing about which side of a 150 m fence the teacher
 * stood on, so it degrades to `unknown` alongside "no fix at all".
 */
async function resolveLogLocation(
  body: LogBody,
): Promise<TeachingLogLocation> {
  const lat = Number(body.lat);
  const lng = Number(body.lng);
  if (!Number.isFinite(lat) || !Number.isFinite(lng)) {
    return unknownTeachingLogLocation();
  }

  let fence;
  try {
    const state = await loadStaffAttendanceServer();
    fence = campusGeofenceFromSettings(normalizeAttendanceSettings(state.settings));
  } catch (e) {
    // No campus coordinates configured, or the settings blob is
    // unreachable. There is no fence to judge against, so there is no
    // verdict to record.
    console.warn("[teaching-v1] campus fence unavailable", e);
    return unknownTeachingLogLocation();
  }

  const accuracy = Number(body.accuracyM);
  const accuracyM = Number.isFinite(accuracy) ? accuracy : null;
  const checkedAt = new Date().toISOString();

  if (
    fence.maxAccuracyM > 0 &&
    accuracyM !== null &&
    accuracyM > fence.maxAccuracyM
  ) {
    return { ...unknownTeachingLogLocation(), accuracyM, checkedAt };
  }

  const distanceM = haversineDistanceM(lat, lng, fence.lat, fence.lng);
  return {
    check: distanceM > fence.radiusM ? "off_campus" : "on_campus",
    distanceM: Math.round(distanceM),
    accuracyM,
    checkedAt,
  };
}

/**
 * POST /api/v1/teaching/log — a teacher records one period.
 *
 * The slot is re-resolved from the server's own copy of the published
 * timetable and must match a period actually assigned to this teacher.
 * A client cannot invent a period, log someone else's class, or claim a
 * subject that isn't on the grid.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "teaching", "edit");

    const body = (await request.json()) as LogBody;
    const staffId = ctx.session.staffId || "";
    if (!staffId) {
      throw new ApiError(
        "bad_request",
        "No staff record on this session",
        400,
      );
    }

    await ensureSchoolMirrorHydrated();
    await Promise.all([
      ensureTimetableHydratedServer(),
      ensureTeachingHydratedServer(),
    ]);

    const ay = ctx.session.academicYearCode;
    const date = body.date?.trim() || istDateOf();
    const periodNo = Number(body.periodNo);
    if (!Number.isFinite(periodNo)) {
      throw new ApiError("bad_request", "periodNo is required", 400);
    }

    const expected = resolveExpectedPeriods({
      timetable: loadTimetable(),
      masters: ctx.masters,
      academicYearCode: ay,
      date,
      staffId,
    });
    if (!expected.ok) {
      throw new ApiError(
        "bad_request",
        `Cannot log against this day: ${expected.detail}`,
        400,
      );
    }

    const slot = expected.periods.find(
      (p) =>
        p.periodNo === periodNo &&
        p.classId === (body.classId || "") &&
        p.sectionId === (body.sectionId || ""),
    );
    if (!slot) {
      throw new ApiError(
        "bad_request",
        "That period is not on your timetable for this date",
        404,
      );
    }

    const status = parseStatus(body.status);
    const state = loadTeaching();

    // Units and plans are re-checked against this class+subject too — a
    // period must not be able to mark a chapter of some other subject as
    // taught, which would quietly inflate that subject's coverage.
    const unitIds = Array.isArray(body.unitIds)
      ? body.unitIds.map(String).filter(Boolean)
      : [];
    const validUnitIds = new Set(
      state.units
        .filter(
          (u) =>
            u.academicYearCode === ay &&
            u.classId === slot.classId &&
            u.subjectId === slot.subjectId,
        )
        .map((u) => u.id),
    );
    const strayUnit = unitIds.find((id) => !validUnitIds.has(id));
    if (strayUnit) {
      throw new ApiError(
        "bad_request",
        "That chapter or topic is not in this subject's plan",
        400,
      );
    }

    const lessonPlanId = String(body.lessonPlanId || "");
    if (lessonPlanId) {
      const plan = state.lessonPlans.find((p) => p.id === lessonPlanId);
      if (
        !plan ||
        plan.academicYearCode !== ay ||
        plan.classId !== slot.classId ||
        plan.subjectId !== slot.subjectId
      ) {
        throw new ApiError(
          "bad_request",
          "That lesson plan does not belong to this class and subject",
          400,
        );
      }
    }

    // Only accept a start stamp for a period being logged on its own
    // day; anything else is a backfill and leaves punctuality unmeasured
    // rather than recording a start time the teacher did not tap.
    const startedAt =
      date === istDateOf() && status !== "not_delivered"
        ? body.startedAt || new Date().toISOString()
        : "";

    const location = await resolveLogLocation(body);

    const result = upsertTeachingLog(state, {
      academicYearCode: ay,
      date,
      periodNo,
      classId: slot.classId,
      sectionId: slot.sectionId,
      subjectId: slot.subjectId,
      staffId,
      scheduledStaffId: slot.isSubstituted ? slot.scheduledStaffId : "",
      status: slot.isSubstituted && status === "delivered" ? "substituted" : status,
      startedAt,
      unitIds,
      lessonPlanId,
      note: String(body.note || ""),
      source: "teacher_log",
      location,
      createdBy: staffId,
    });
    if (!result.ok) throw new ApiError("bad_request", result.error, 400);

    // saveTeaching() is a browser-only path (localStorage-first), so the
    // server writes its own cache and pushes the merged blob explicitly.
    writeTeachingLocalRaw(result.value.state);
    const push = await pushTeachingRemoteServer(result.value.state);
    if (!push.ok) {
      console.warn("[teaching-v1] blob push failed", push.error);
      throw new ApiError(
        "server_error",
        "Saved locally but could not reach the school server — try again",
        502,
      );
    }

    const meta = requestMeta(request);
    await writeAudit({
      session: ctx.session,
      module: "teaching",
      action: "edit",
      entityType: "period_log",
      entityId: result.value.log.id,
      summary: `Logged period ${periodNo} on ${date} as ${result.value.log.status}`,
      after: {
        date,
        periodNo,
        classId: slot.classId,
        sectionId: slot.sectionId,
        status: result.value.log.status,
        locationCheck: location.check,
        locationDistanceM: location.distanceM,
      },
      ip: meta.ip,
      userAgent: meta.userAgent,
    });

    return apiOk({
      logId: result.value.log.id,
      date,
      periodNo,
      status: result.value.log.status,
      // Echoed so the app can say "saved, but we could not confirm you
      // were on campus" rather than leaving the teacher to discover the
      // flag weeks later on someone else's report.
      locationCheck: location.check,
      locationDistanceM: location.distanceM,
    });
  } catch (e) {
    return apiErr(e);
  }
}
