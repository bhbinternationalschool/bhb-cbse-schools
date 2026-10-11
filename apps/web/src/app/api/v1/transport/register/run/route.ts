import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import {
  assertRoute,
  dayParam,
  editableDaysBack,
  loadRegisterDesk,
  loadTransportDesk,
  readMarks,
  registerAccess,
} from "@/lib/transportBoardingLog.server";
import {
  effectiveStatus,
  istDate,
  ridersOnRun,
  runCounts,
  runsForRoute,
  TRIP_STATUSES,
} from "@/lib/transportBoardingLog";

export const runtime = "nodejs";

/**
 * GET /api/v1/transport/register/run?date=&routeId=&trip=AM|PM&shiftId=
 *
 * One run's list, in the order the bus reaches the stops (reversed for a
 * drop), with each child's mark. A child whose run could not be worked out is
 * on every run's list, flagged; a child whose stop no longer resolves is
 * listed last — never left off.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const today = istDate();
    const url = new URL(request.url);
    const date = dayParam(url.searchParams.get("date"), today);
    const routeId = (url.searchParams.get("routeId") || "").trim();
    const trip = url.searchParams.get("trip") === "PM" ? "PM" : "AM";
    const shiftId = (url.searchParams.get("shiftId") || "").trim();
    if (!routeId) throw new ApiError("bad_request", "routeId is required", 400);

    const transport = await loadTransportDesk();
    const access = registerAccess(ctx, transport, date);
    assertRoute(access, routeId);
    const route = transport.routes.find((r) => r.id === routeId);
    if (!route) throw new ApiError("not_found", "Route not found", 404);
    const desk = await loadRegisterDesk(transport);

    const runs = runsForRoute(route, trip, date);
    const run = runs.find((r) => r.shiftId === shiftId) ?? (shiftId ? null : runs[0] ?? null);
    if (!run) throw new ApiError("not_found", "That run does not operate on this route on this day", 404);

    const riders = ridersOnRun({
      route,
      assignments: transport.assignments,
      students: desk.students,
      classNameById: desk.classNameById,
      classesKnown: desk.classesKnown,
      date,
      trip,
      shiftId: run.shiftId,
    });
    const marksRes = await readMarks({ from: date, to: date, routeIds: [routeId] });
    if (!marksRes.ok) throw new ApiError("server_error", `Could not read the marks: ${marksRes.error}`, 503);
    const markBy = new Map(marksRes.marks.filter((m) => m.trip === trip).map((m) => [m.studentId, m]));

    const vehicle = route.vehicleId ? transport.vehicles.find((v) => v.id === route.vehicleId) : undefined;
    return apiOk({
      date,
      today,
      editable: (() => {
        const days = Math.round((Date.parse(`${today}T00:00:00Z`) - Date.parse(`${date}T00:00:00Z`)) / 86_400_000);
        return days >= 0 && days <= editableDaysBack(access);
      })(),
      route: { id: route.id, name: route.name, busNo: route.busNo, vehicleId: route.vehicleId || "", vehicleName: vehicle?.name || route.vehicleReg || "" },
      run,
      runs,
      statuses: TRIP_STATUSES[trip],
      classesKnown: desk.classesKnown,
      riders: riders.map((r) => {
        const m = markBy.get(r.studentId);
        return {
          ...r,
          status: effectiveStatus(m?.status),
          tappedAt: m && effectiveStatus(m.status) ? m.tappedAt : null,
          markedByName: m && effectiveStatus(m.status) ? m.markedByName : "",
        };
      }),
      counts: runCounts(riders, (id) => effectiveStatus(markBy.get(id)?.status)),
    });
  } catch (e) {
    return apiErr(e);
  }
}
