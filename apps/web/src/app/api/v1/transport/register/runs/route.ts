import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import {
  dayParam,
  editableDaysBack,
  loadRegisterDesk,
  loadTransportDesk,
  mayUseRoute,
  readMarks,
  registerAccess,
} from "@/lib/transportBoardingLog.server";
import {
  effectiveStatus,
  istDate,
  registerDayMarks,
  ridersOnRun,
  runCounts,
  runsForRoute,
  type RegisterTrip,
} from "@/lib/transportBoardingLog";
import { ApiError } from "@/lib/api/v1/errors";

export const runtime = "nodejs";

/**
 * GET /api/v1/transport/register/runs?date=YYYY-MM-DD
 *
 * The day's runs — every route's morning pick-up and afternoon drop(s) — with
 * how many riders are boarded / dropped / not boarded / not yet marked.
 * Office and leadership see the whole fleet; a driver or attendant sees only
 * their own bus (Staff → Duties or Fleet), and an empty list with
 * `unlinked: true` when nobody has linked them to one.
 *
 * `&marks=1` also returns the day's marks themselves (undone taps left out),
 * for screens outside the register that show a child's mark — the fleet
 * roster and the boarding day sheet. Same scope as the runs.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const today = istDate();
    const url = new URL(request.url);
    const date = dayParam(url.searchParams.get("date"), today);
    const withMarks = url.searchParams.get("marks") === "1";

    const transport = await loadTransportDesk();
    const access = registerAccess(ctx, transport, date);
    const desk = await loadRegisterDesk(transport);

    const routes = transport.routes.filter((r) => r.isActive !== false && mayUseRoute(access, r.id));
    const marksRes = await readMarks({ from: date, to: date, routeIds: routes.map((r) => r.id) });
    if (!marksRes.ok) throw new ApiError("server_error", `Could not read today's marks: ${marksRes.error}`, 503);
    const statusBy = new Map<string, ReturnType<typeof effectiveStatus>>();
    for (const m of marksRes.marks) statusBy.set(`${m.routeId}|${m.trip}|${m.studentId}`, effectiveStatus(m.status));

    const vehicleById = new Map(transport.vehicles.map((v) => [v.id, v]));
    const runs = routes.flatMap((route) =>
      (["AM", "PM"] as RegisterTrip[]).flatMap((trip) =>
        runsForRoute(route, trip, date).map((run) => {
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
          const vehicle = route.vehicleId ? vehicleById.get(route.vehicleId) : undefined;
          return {
            ...run,
            routeName: route.name,
            busNo: route.busNo,
            vehicleId: route.vehicleId || "",
            vehicleName: vehicle?.name || route.vehicleReg || "",
            counts: runCounts(riders, (id) => statusBy.get(`${route.id}|${trip}|${id}`) ?? null),
            unresolved: riders.filter((r) => r.shiftUnresolved).length,
          };
        }),
      ),
    );

    return apiOk({
      date,
      today,
      fleetWide: access.fleetWide,
      unlinked: !access.fleetWide && routes.length === 0,
      editableDaysBack: editableDaysBack(access),
      classesKnown: desk.classesKnown,
      runs,
      ...(withMarks ? { marks: registerDayMarks(marksRes.marks) } : {}),
    });
  } catch (e) {
    return apiErr(e);
  }
}
