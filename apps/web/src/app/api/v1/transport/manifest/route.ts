import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { fetchTransportDeskFromDb } from "@/lib/transportNormalized.server";
import { fetchSisFromDb } from "@/lib/sisNormalized.server";
import type { SisStudent } from "@/lib/sis";

export const runtime = "nodejs";

/**
 * GET /api/v1/transport/manifest?routeId=&trip=AM|PM
 *
 * The list a driver or attendant works from: stops in boarding order, the
 * children due at each, and what has already been marked today.
 *
 * Staff and field only. Unlike /v1/transport/routes — which is route and stop
 * information a parent may reasonably see — this carries the names of other
 * people's children, so it is not open to the parent persona.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff" && ctx.session.persona !== "field") {
      throw new ApiError("forbidden", "Driver or attendant sign-in required", 403);
    }

    const url = new URL(request.url);
    const routeId = url.searchParams.get("routeId")?.trim() || "";
    const trip = url.searchParams.get("trip") === "PM" ? "PM" : "AM";
    const date =
      url.searchParams.get("date")?.trim() ||
      new Date().toISOString().slice(0, 10);
    const askedAy = url.searchParams.get("ay")?.trim() || "";

    const { bundle, ok } = await fetchTransportDeskFromDb();
    if (!ok) throw new ApiError("server_error", "Transport data unavailable", 503);

    const route = bundle.routes.find(
      (r) => r.id === routeId && r.isActive !== false,
    );
    if (!route) throw new ApiError("not_found", "Route not found", 404);

    const sis = await fetchSisFromDb();
    if (!sis.ok) {
      // An unconfirmed empty roster would render a manifest full of blank
      // names, which on a driver's phone reads as "these children are not
      // enrolled". Refuse instead.
      throw new ApiError("server_error", "Student roster unavailable", 503);
    }
    const studentById = new Map<string, SisStudent>(
      ((sis.bundle.students ?? []) as SisStudent[]).map((s) => [s.id, s]),
    );

    const live = bundle.assignments.filter(
      (a) => a.routeId === route.id && a.effectiveTo == null && !a.boardingSuspended,
    );

    // Which year's roster is on the bus today. Derived from the assignments
    // themselves — the latest year that actually has live riders on this route
    // — rather than defaulted to a hardcoded session. A driver's manifest that
    // silently used the wrong year would come up empty, and an empty manifest
    // reads as "nobody is riding today".
    const ay =
      askedAy ||
      live
        .map((a) => a.academicYearCode)
        .filter(Boolean)
        .sort()
        .pop() ||
      "";

    const riders = ay ? live.filter((a) => a.academicYearCode === ay) : live;

    const marks = new Map(
      (bundle.boardingEvents ?? [])
        .filter(
          (e) => e.date === date && e.trip === trip && e.routeId === route.id,
        )
        .map((e) => [e.studentId, e]),
    );

    const stops = [...route.stops]
      .sort((a, b) => a.sequence - b.sequence)
      .map((stop) => ({
        id: stop.id,
        name: stop.name,
        sequence: stop.sequence,
        distanceKm: stop.distanceKm,
        lat: stop.geoLat ?? null,
        lng: stop.geoLng ?? null,
        students: riders
          .filter((a) => a.stopId === stop.id)
          .map((a) => {
            const st = studentById.get(a.studentId);
            const mark = marks.get(a.studentId);
            return {
              studentId: a.studentId,
              // The name as the school recorded it — never transliterated.
              fullName: st?.fullName ?? "",
              admissionNo: st?.admissionNo ?? "",
              className: st?.classId ?? "",
              serviceMode: a.serviceMode ?? "both",
              status: mark?.status ?? null,
              markedAt: mark?.createdAt ?? null,
              boardedLocation: mark?.boardedLocation ?? null,
              offboardedLocation: mark?.offboardedLocation ?? null,
            };
          })
          .sort((x, y) => x.fullName.localeCompare(y.fullName)),
      }));

    return apiOk({
      date,
      trip,
      academicYearCode: ay,
      route: {
        id: route.id,
        code: route.code,
        name: route.name,
        busNo: route.busNo,
        vehicleReg: route.vehicleReg,
      },
      school: { lat: 25.4354328, lng: 82.9439863 },
      stops,
      totalStudents: riders.length,
      markedStudents: [...marks.keys()].length,
    });
  } catch (e) {
    return apiErr(e);
  }
}
