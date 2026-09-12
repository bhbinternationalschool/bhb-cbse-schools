import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { fetchTransportDeskFromDb } from "@/lib/transportNormalized.server";
import { fetchSisFromDb } from "@/lib/sisNormalized.server";
import type { SisStudent } from "@/lib/sis";
import { fetchMastersDeskFromDb } from "@/lib/mastersNormalized.server";
import { classGroupCodeForName } from "@/lib/masters";
import {
  listRouteShifts,
  resolveRiderShift,
} from "@/lib/transportShifts";

export const runtime = "nodejs";

/**
 * GET /api/v1/transport/manifest?routeId=&trip=AM|PM&shiftId=
 *
 * The list a driver or attendant works from: stops in boarding order, the
 * children due at each, and what has already been marked today.
 *
 * WHY `shiftId` IS OPTIONAL
 * Omitting it returns every rider on the route for that direction, exactly as
 * this endpoint always did, with the run named beside each child. An older
 * driver's app therefore keeps showing a complete list rather than silently
 * losing half the bus the day somebody sets up runs on the desk.
 *
 * Passing it filters to that run — and still returns, separately, the riders
 * whose run could not be worked out. A child missing from a driver's list is
 * not an error message, it is a child left at school, so they are handed over
 * flagged rather than dropped.
 *
 * Gated on the transport module, not on the persona. Every driver signs in
 * through staff OTP and is minted `persona: "staff"`, exactly like a teacher —
 * so a persona check would have let every teacher, accountant and gardener
 * read the names of every child on every bus. `transport.view` is the line
 * that actually separates them: drivers and transport staff hold it, teachers
 * and parents hold no transport grant at all.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "transport", "view");

    const url = new URL(request.url);
    const routeId = url.searchParams.get("routeId")?.trim() || "";
    const trip = url.searchParams.get("trip") === "PM" ? "PM" : "AM";
    const askedShiftId = url.searchParams.get("shiftId")?.trim() || "";
    const direction = trip === "PM" ? "drop" : "pickup";
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

    const allRiders = ay ? live.filter((a) => a.academicYearCode === ay) : live;

    // The runs on this route for the direction being driven.
    const runs = listRouteShifts(route, direction);

    // Class groups decide which run a child is on, so the class list is
    // needed to say anything about runs at all. A FAILED masters read is not
    // "nobody has a class": it would make every rider unresolved and, with a
    // shiftId asked for, empty the driver's list. So a failed read falls back
    // to the pre-shift behaviour — the whole route, no run filtering — and
    // says so, rather than producing a confidently wrong manifest.
    const mastersRead =
      runs.length > 0
        ? await fetchMastersDeskFromDb()
        : { bundle: null, readFailed: false as boolean };
    const classesUnavailable = runs.length > 0 && mastersRead.readFailed;
    const classNameById = new Map<string, string>(
      ((mastersRead.bundle?.classes ?? []) as { id: string; name: string }[]).map(
        (c) => [c.id, c.name],
      ),
    );

    function runFor(a: (typeof allRiders)[number]) {
      if (runs.length === 0 || classesUnavailable) return null;
      const st = studentById.get(a.studentId);
      const className = st?.classId ? classNameById.get(st.classId) : undefined;
      return resolveRiderShift({
        route: route!,
        direction,
        overrideShiftId:
          direction === "pickup" ? a.pickupShiftId : a.dropShiftId,
        groupCode: className ? classGroupCodeForName(className) : null,
      });
    }

    const resolutionByStudent = new Map(
      allRiders.map((a) => [a.studentId, runFor(a)]),
    );

    // Asking for a run filters to it. Riders whose run could not be worked out
    // are NOT filtered away — they are handed over flagged, because a child
    // missing from a driver's list is a child left at school.
    const unresolvedRiders = askedShiftId
      ? allRiders.filter(
          (a) => resolutionByStudent.get(a.studentId)?.needsAttention === true,
        )
      : [];
    const riders = askedShiftId
      ? allRiders.filter((a) => {
          const res = resolutionByStudent.get(a.studentId);
          if (!res) return true; // no runs configured — the whole route rides
          return res.shift?.id === askedShiftId || res.needsAttention;
        })
      : allRiders;

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
              shift: (() => {
                const res = resolutionByStudent.get(a.studentId);
                if (!res?.shift) return null;
                return {
                  id: res.shift.id,
                  name: res.shift.name,
                  departTime: res.shift.departTime,
                };
              })(),
              // True when this child has no run on this trip. The driver's app
              // shows them anyway, marked, so nobody is quietly left behind.
              shiftUnresolved:
                resolutionByStudent.get(a.studentId)?.needsAttention === true,
              shiftNote: resolutionByStudent.get(a.studentId)?.needsAttention
                ? (resolutionByStudent.get(a.studentId)?.detail ?? "")
                : "",
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
      /** The runs this route makes in this direction. Empty = one journey. */
      shifts: runs.map((sh) => ({
        id: sh.id,
        name: sh.name,
        departTime: sh.departTime,
        weekdays: sh.weekdays,
      })),
      shiftId: askedShiftId || null,
      /**
       * True when the class list could not be read, so runs could not be
       * worked out. The manifest below is then the WHOLE route — correct but
       * unfiltered — and the app must say so rather than imply this is one run.
       */
      shiftsUnavailable: classesUnavailable,
      unresolvedStudents: unresolvedRiders.length,
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
      // Counted over the riders actually listed, not the whole route. With a
      // run asked for, the route-wide count would read as "12 of 5 marked".
      markedStudents: riders.filter((a) => marks.has(a.studentId)).length,
    });
  } catch (e) {
    return apiErr(e);
  }
}
