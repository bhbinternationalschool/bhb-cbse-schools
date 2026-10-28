import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import {
  assertEditableDate,
  assertRoute,
  dayParam,
  loadTransportDesk,
  readMarks,
  registerAccess,
  writeMark,
} from "@/lib/transportBoardingLog.server";
import { busMarkIsNews, busMarkPush, type BusMarkStatus } from "@/lib/busMarkPush";
import { sendFcmToSubject } from "@/lib/fcm.server";
import { waTemplateLanguageFor } from "@/lib/householdPrefs";
import { fetchSisFromDb } from "@/lib/sisNormalized.server";
import type { SisState } from "@/lib/sis";
import {
  clampTappedAt,
  effectiveStatus,
  isRegisterTrip,
  isStoredStatus,
  istDate,
  liveRouteAssignments,
  statusAllowedOnTrip,
} from "@/lib/transportBoardingLog";

export const runtime = "nodejs";

/**
 * POST /api/v1/transport/register/mark
 * { date, routeId, trip: "AM"|"PM", shiftId?, studentId,
 *   status: "boarded"|"not_boarded"|"dropped"|"unmarked",
 *   tappedAt (ISO, the phone's clock), clientRef?, lat?, lng?, accuracyM? }
 *
 * One tap = one request, saved on its own, so a weak signal loses at most the
 * tap in flight and the phone can retry it. Retrying is safe: the row is keyed
 * on day + route + trip + child, and a tap older than the stored one is not
 * applied (`applied: false`, with the stored mark returned).
 *
 * Location is optional here, unlike the older /boarding route: a register
 * that refuses a tap because the phone's GPS is off is a register nobody
 * keeps. When the phone sends a pin it is stored with the mark.
 *
 * The family gets a parent-app notification for a real change on today's
 * run (director, 13 Oct 2026) — app only, never WhatsApp. The rules are in
 * lib/busMarkPush; the mark never waits on or fails because of it.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    let body: Record<string, unknown>;
    try {
      body = (await request.json()) as Record<string, unknown>;
    } catch {
      throw new ApiError("bad_request", "Invalid JSON", 400);
    }
    const today = istDate();
    const date = dayParam(body.date, today);
    const routeId = String(body.routeId ?? "").trim();
    const studentId = String(body.studentId ?? "").trim();
    const shiftId = String(body.shiftId ?? "").trim();
    if (!routeId || !studentId) throw new ApiError("bad_request", "routeId and studentId are required", 400);
    if (!isRegisterTrip(body.trip)) throw new ApiError("bad_request", "trip must be AM or PM", 400);
    const trip = body.trip;
    if (!isStoredStatus(body.status) || !statusAllowedOnTrip(body.status, trip)) {
      throw new ApiError("bad_request", `That status is not used on the ${trip === "AM" ? "morning pick-up" : "afternoon drop"}`, 400);
    }
    const status = body.status;

    const transport = await loadTransportDesk();
    const access = registerAccess(ctx, transport, date);
    assertRoute(access, routeId);
    assertEditableDate(access, date, today);

    const route = transport.routes.find((r) => r.id === routeId);
    if (!route) throw new ApiError("not_found", "Route not found", 404);
    const assignment = liveRouteAssignments(transport.assignments, routeId, date, trip).find(
      (a) => a.studentId === studentId,
    );
    if (!assignment) {
      throw new ApiError("bad_request", "This child is not a rider of this route on this trip today", 400);
    }

    const coord = (v: unknown) => (typeof v === "number" && Number.isFinite(v) ? v : null);
    let lat = coord(body.lat);
    let lng = coord(body.lng);
    // 0,0 is not a place a bus goes: it is a phone that had no fix.
    if (lat == null || lng == null || (lat === 0 && lng === 0)) {
      lat = null;
      lng = null;
    }

    // The child's status on this trip before the tap: a retry of the same
    // status is not news. Unreadable → unknown, and an unknown "before"
    // tells nobody (no guessing that this is a change).
    let previous: BusMarkStatus | null = null;
    try {
      const before = await readMarks({ from: date, to: date, routeIds: [routeId] });
      if (before.ok) {
        const mine = before.marks.find((m) => m.studentId === studentId && m.trip === trip);
        previous = (mine?.status as BusMarkStatus | undefined) ?? "unmarked";
      }
    } catch {
      previous = null;
    }

    const result = await writeMark({
      runDate: date,
      routeId,
      trip,
      shiftId,
      vehicleId: route.vehicleId || "",
      studentId,
      stopId: assignment.stopId,
      status,
      tappedAt: clampTappedAt(body.tappedAt),
      clientRef: String(body.clientRef ?? ""),
      staffId: access.staffId,
      name: access.name,
      lat,
      lng,
      accuracyM: lat == null ? null : coord(body.accuracyM),
    });

    let notified = "";
    try {
      notified = await tellFamily({
        applied: result.applied,
        status: result.mark.status as BusMarkStatus,
        previous,
        runDate: date,
        today,
        tappedAt: result.mark.tappedAt,
        trip,
        studentId,
        stopName: route.stops.find((st) => st.id === assignment.stopId)?.name ?? "",
      });
    } catch (e) {
      notified = `failed: ${(e as Error)?.message || "error"}`;
    }

    return apiOk({
      notified,
      applied: result.applied,
      studentId,
      status: effectiveStatus(result.mark.status),
      tappedAt: result.mark.tappedAt,
      markedByName: result.mark.markedByName,
    });
  } catch (e) {
    return apiErr(e);
  }
}

/** The parent-app notification for this tap, if it is news. Never throws. */
async function tellFamily(input: {
  applied: boolean;
  status: BusMarkStatus;
  previous: BusMarkStatus | null;
  runDate: string;
  today: string;
  tappedAt: string;
  trip: "AM" | "PM";
  studentId: string;
  stopName: string;
}): Promise<string> {
  if (input.previous == null) return "skipped: earlier mark unreadable";
  const nowMs = Date.now();
  if (!busMarkIsNews({ ...input, previous: input.previous, nowMs })) return "";
  // The roster from the database (as the older /boarding route reads it),
  // only for a tap that is news.
  const sisRes = await fetchSisFromDb();
  if (!sisRes.ok) return "skipped: roster unreadable";
  const sis = sisRes.bundle as unknown as SisState;
  const student = sis.students.find((st) => st.id === input.studentId);
  const household = student ? sis.households.find((h) => h.id === student.householdId) : undefined;
  if (!student || !household) return "skipped: family not found";
  const push = busMarkPush({
    applied: input.applied,
    status: input.status,
    previous: input.previous,
    runDate: input.runDate,
    today: input.today,
    tappedAt: input.tappedAt,
    nowMs,
    trip: input.trip,
    childName: student.fullName,
    stopName: input.stopName,
    lang: waTemplateLanguageFor(household) === "en" ? "en" : "hi",
  });
  if (!push) return "";
  const r = await sendFcmToSubject("parent", household.id, push);
  return r.sent > 0 ? "app" : r.failed > 0 ? "failed" : "no app";
}
