import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import {
  dayParam,
  loadRegisterDesk,
  loadTransportDesk,
  readClassAttendanceForDate,
  readMarks,
  registerAccess,
} from "@/lib/transportBoardingLog.server";
import {
  boardingExceptions,
  effectiveStatus,
  istDate,
  ridersOnRun,
  type RegisterTrip,
  type RunRider,
} from "@/lib/transportBoardingLog";

export const runtime = "nodejs";

/**
 * GET /api/v1/transport/register/exceptions?date=
 *
 * Office only. Children whose bus register and class register disagree:
 * boarded the morning bus but absent in class (the one to act on first),
 * present in class but marked not boarded, and children who came by bus but
 * were marked not boarded for the drop.
 *
 * Only definite marks are compared. A section whose class register was not
 * taken is counted (`sectionsWithoutRegister`, `unchecked`), never read as
 * "absent". When the class register cannot be read at all the answer says so
 * (`classRegister: "unavailable"`) and only the bus-only check is returned.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const today = istDate();
    const date = dayParam(new URL(request.url).searchParams.get("date"), today);

    const transport = await loadTransportDesk();
    const access = registerAccess(ctx, transport, date);
    if (!access.fleetWide) {
      throw new ApiError("forbidden", "The exception list is for the office (transport edit or export).", 403);
    }
    const [desk, marksRes, attendance] = await Promise.all([
      loadRegisterDesk(transport),
      readMarks({ from: date, to: date }),
      readClassAttendanceForDate(date),
    ]);
    if (!marksRes.ok) throw new ApiError("server_error", `Could not read the marks: ${marksRes.error}`, 503);

    const statusBy = new Map<string, ReturnType<typeof effectiveStatus>>();
    for (const m of marksRes.marks) statusBy.set(`${m.routeId}|${m.trip}|${m.studentId}`, effectiveStatus(m.status));

    const riders: (RunRider & { routeId: string })[] = [];
    for (const route of transport.routes.filter((r) => r.isActive !== false)) {
      for (const trip of ["AM", "PM"] as RegisterTrip[]) {
        for (const r of ridersOnRun({
          route,
          assignments: transport.assignments,
          students: desk.students,
          classNameById: desk.classNameById,
          classesKnown: desk.classesKnown,
          date,
          trip,
          shiftId: "",
        })) {
          riders.push({ ...r, routeId: route.id });
        }
      }
    }

    const classOk = attendance.ok;
    const result = boardingExceptions({
      riders,
      amStatus: (id, routeId) => statusBy.get(`${routeId}|AM|${id}`) ?? null,
      pmStatus: (id, routeId) => statusBy.get(`${routeId}|PM|${id}`) ?? null,
      classMark: (id) => (attendance.ok ? (attendance.markByStudent.get(id) ?? null) : null),
      sectionsWithRegister: attendance.ok ? attendance.sectionsWithRegister : new Set(),
    });

    const riderSections = new Set(riders.map((r) => r.sectionId).filter(Boolean));
    const sectionsWithoutRegister = attendance.ok
      ? [...riderSections].filter((s) => !attendance.sectionsWithRegister.has(s)).length
      : null;
    const routeName = new Map(transport.routes.map((r) => [r.id, r.name]));

    return apiOk({
      date,
      classRegister: classOk ? "ok" : "unavailable",
      sectionsWithoutRegister,
      riderSections: riderSections.size,
      unchecked: result.unchecked,
      exceptions: result.exceptions.map((e) => ({ ...e, routeName: routeName.get(e.routeId) ?? "" })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
