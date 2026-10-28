import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import {
  loadRegisterDesk,
  loadTransportDesk,
  mayUseRoute,
  readMarks,
  registerAccess,
} from "@/lib/transportBoardingLog.server";
import {
  boardingMonthReport,
  isMonth,
  istDate,
  monthDates,
} from "@/lib/transportBoardingLog";

export const runtime = "nodejs";

/**
 * GET /api/v1/transport/register/month?month=YYYY-MM&routeId=
 *
 * Month-wise boarding attendance per child — the old ERP's transport
 * attendance report. Rows are every child who rode a route in the scope at
 * any point in the month, plus anyone marked; a child with no marks is listed
 * with blank days, not counted absent. Crew see only their own bus.
 *
 * `&studentId=` narrows the rows to one child (the student profile's bus
 * card); the scope is unchanged, so crew still see only their own bus.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const url = new URL(request.url);
    const today = istDate();
    const month = (url.searchParams.get("month") || today.slice(0, 7)).trim();
    if (!isMonth(month)) throw new ApiError("bad_request", "month must be YYYY-MM", 400);
    const askedRoute = (url.searchParams.get("routeId") || "").trim();
    const askedStudent = (url.searchParams.get("studentId") || "").trim();
    const dates = monthDates(month);
    const from = dates[0]!;
    const to = dates[dates.length - 1]!;

    const transport = await loadTransportDesk();
    const access = registerAccess(ctx, transport, to < today ? to : today);
    const routes = transport.routes.filter(
      (r) => mayUseRoute(access, r.id) && (!askedRoute || r.id === askedRoute),
    );
    if (askedRoute && routes.length === 0) throw new ApiError("forbidden", "This route is not on your bus.", 403);
    const routeIds = new Set(routes.map((r) => r.id));
    const routeName = new Map(routes.map((r) => [r.id, r.name]));

    const [desk, marksRes] = await Promise.all([
      loadRegisterDesk(transport),
      readMarks({ from, to, routeIds: [...routeIds] }),
    ]);
    if (!marksRes.ok) throw new ApiError("server_error", `Could not read the marks: ${marksRes.error}`, 503);

    const riders = transport.assignments
      .filter(
        (a) =>
          routeIds.has(a.routeId) &&
          (!a.effectiveFrom || a.effectiveFrom <= to) &&
          (!a.effectiveTo || a.effectiveTo >= from),
      )
      .map((a) => {
        const st = desk.students.get(a.studentId);
        return {
          studentId: a.studentId,
          fullName: st?.fullName ?? "",
          admissionNo: st?.admissionNo ?? "",
          className: st?.classId ? (desk.classNameById.get(st.classId) ?? "") : "",
          routeName: routeName.get(a.routeId) ?? "",
        };
      });

    const rows = boardingMonthReport({
      month,
      riders: askedStudent ? riders.filter((r) => r.studentId === askedStudent) : riders,
      marks: askedStudent ? marksRes.marks.filter((m) => m.studentId === askedStudent) : marksRes.marks,
    }).map((r) => {
      if (r.fullName) return r;
      const st = desk.students.get(r.studentId);
      return {
        ...r,
        fullName: st?.fullName ?? "",
        admissionNo: st?.admissionNo ?? "",
        className: st?.classId ? (desk.classNameById.get(st.classId) ?? "") : "",
      };
    });

    return apiOk({
      month,
      dates,
      fleetWide: access.fleetWide,
      routes: routes.map((r) => ({ id: r.id, name: r.name })),
      rows,
    });
  } catch (e) {
    return apiErr(e);
  }
}
