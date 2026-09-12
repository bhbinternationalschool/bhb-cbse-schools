import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { fetchTransportDeskFromDb } from "@/lib/transportNormalized.server";
import { listHouseholdTransportRequests } from "@/lib/transportRequests.server";
import { loadMasters } from "@/lib/masters";
import {
  resolveRiderShift,
  strictClassGroup,
} from "@/lib/transportShifts";
import { classLabelForStudent } from "@/lib/parentPortal";
import { loadSis } from "@/lib/sis";
import { formatInr } from "@/lib/fees";

export const runtime = "nodejs";

/**
 * GET /api/v1/transport/mine — each child's bus, if they have one: route,
 * stop, vehicle, and the driver with a number to call; otherwise the
 * family's open transport request, if any, so the app can offer one.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    await ensureSchoolMirrorHydrated();
    const sis = loadSis();
    const masters = loadMasters();
    const today = new Date().toISOString().slice(0, 10);

    const [desk, requests] = await Promise.all([
      fetchTransportDeskFromDb(),
      listHouseholdTransportRequests(householdId),
    ]);
    const { bundle } = desk;
    const routeById = new Map(bundle.routes.map((r) => [r.id, r]));
    const vehicleById = new Map(bundle.vehicles.map((v) => [v.id, v]));
    const staffById = new Map(masters.staff.map((s) => [s.id, s]));

    // SIS keeps one student row per academic year; show each child once,
    // preferring the session year's row (same rule as /parent/summary).
    const sessionAy = ctx.session.academicYearCode;
    const byAdmission = new Map<string, (typeof sis.students)[number]>();
    for (const s of sis.students) {
      if (s.householdId !== householdId || s.status !== "active") continue;
      const key = s.admissionNo || s.id;
      const prev = byAdmission.get(key);
      if (!prev || s.academicYearCode === sessionAy || (prev.academicYearCode !== sessionAy && s.academicYearCode > prev.academicYearCode)) {
        byAdmission.set(key, s);
      }
    }
    const children = [...byAdmission.values()]
      .map((s) => {
        const assignment = bundle.assignments
          .filter((a) => a.studentId === s.id)
          .filter((a) => !a.effectiveTo || a.effectiveTo >= today)
          .sort((a, b) => b.effectiveFrom.localeCompare(a.effectiveFrom))[0];
        const route = assignment ? routeById.get(assignment.routeId) : undefined;
        const stop = route?.stops.find((st) => st.id === assignment?.stopId);
        const vehicle = route?.vehicleId ? vehicleById.get(route.vehicleId) : undefined;
        const driverStaff = vehicle?.driverStaffId ? staffById.get(vehicle.driverStaffId) : undefined;
        const driverName = vehicle?.driverName || driverStaff?.fullName || "";
        const driverMobile = vehicle?.driverMobile || driverStaff?.mobile || "";
        /**
         * The times this child's bus actually runs.
         *
         * Only reported when a run is resolved AND has a departure time. A run
         * with no time set returns null rather than a blank or a placeholder:
         * a parent who reads a time on this screen stands at the roadside at
         * that time, so a made-up one is worse than none at all.
         */
        const className = s.classId
          ? masters.classes.find((c) => c.id === s.classId)?.name
          : undefined;
        const groupCode = className ? strictClassGroup(className) : null;
        const runTimes =
          assignment && route
            ? (["pickup", "drop"] as const).map((direction) => {
                const res = resolveRiderShift({
                  route,
                  direction,
                  overrideShiftId:
                    direction === "pickup"
                      ? assignment.pickupShiftId
                      : assignment.dropShiftId,
                  groupCode,
                });
                return res.shift?.departTime
                  ? {
                      direction,
                      name: res.shift.name,
                      departTime: res.shift.departTime,
                      weekdays: res.shift.weekdays,
                    }
                  : null;
              })
            : [null, null];

        const latestRequest = (requests ?? [])
          .filter((r) => r.studentId === s.id)
          .sort((a, b) => b.createdAt.localeCompare(a.createdAt))[0];
        return {
          id: s.id,
          fullName: s.fullName,
          classLabel: classLabelForStudent(s, masters),
          transport: assignment && route
            ? {
                routeCode: route.code,
                routeName: route.name,
                stopName: stop?.name || "",
                serviceMode: assignment.serviceMode || "both",
                suspended: !!assignment.boardingSuspended,
                monthlyFeeLabel: formatInr(assignment.monthlyFeePaise || 0),
                vehicle: {
                  name: vehicle?.name || route.busNo || "",
                  registrationNo: vehicle?.registrationNo || route.vehicleReg || "",
                  type: vehicle?.type || "",
                },
                driver: driverName || driverMobile ? { name: driverName, mobile: driverMobile } : null,
                /** null when the run has no time set — never a placeholder. */
                pickupRun: runTimes[0],
                dropRun: runTimes[1],
              }
            : null,
          request: latestRequest
            ? {
                id: latestRequest.id,
                status: latestRequest.status,
                createdAt: latestRequest.createdAt,
                handlingNote: latestRequest.handlingNote,
              }
            : null,
        };
      });

    const household = sis.households.find((h) => h.id === householdId);
    return apiOk({
      children,
      household: household
        ? { address: household.address, locality: household.locality, landmark: household.landmark, mobile: household.mobile }
        : null,
    });
  } catch (e) {
    return apiErr(e);
  }
}
