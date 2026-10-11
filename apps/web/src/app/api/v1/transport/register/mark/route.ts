import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import {
  assertEditableDate,
  assertRoute,
  dayParam,
  loadTransportDesk,
  registerAccess,
  writeMark,
} from "@/lib/transportBoardingLog.server";
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
 * Parents are NOT messaged from this route (the older /boarding route does);
 * that stays a separate decision.
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

    return apiOk({
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
