import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { staffWorkingYear } from "@/lib/api/v1/staffScope";
import { loadStaffAttendanceServer } from "@/lib/staffAttendance.server";
import {
  attendanceExemptStaffIds,
  normalizeAttendanceSettings,
  punchWayLabel,
} from "@/lib/staffAttendance";
import { classifyStaffHolidayDay } from "@/lib/holidayPolicy";
import { loadStaffHr } from "@/lib/staffHr";
import { staffMonthCalendar } from "@/lib/staffMonthCalendar";

export const runtime = "nodejs";

function istToday(): string {
  return new Date().toLocaleDateString("en-CA", { timeZone: "Asia/Kolkata" });
}

/**
 * GET /api/v1/staff/my-attendance?month=YYYY-MM — my own attendance for a
 * month, day by day, counted the way payroll counts it. Always the signed-in
 * member of staff; nobody else's register is reachable here.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const staffId = ctx.session.persona === "staff" ? ctx.session.staffId || "" : "";
    if (!staffId) throw new ApiError("forbidden", "Sign in with your staff login", 403);
    await ensureSchoolMirrorHydrated();
    const staff = (ctx.masters.staff ?? []).find((s) => s.id === staffId);
    if (!staff) throw new ApiError("not_found", "Your login is not linked to a staff record", 404);

    const url = new URL(request.url);
    const today = istToday();
    const month = /^\d{4}-\d{2}$/.test(url.searchParams.get("month") || "")
      ? url.searchParams.get("month")!
      : today.slice(0, 7);

    const state = await loadStaffAttendanceServer({ fresh: true });
    const settings = normalizeAttendanceSettings(state.settings);
    const exempt = attendanceExemptStaffIds(settings, ctx.rbac).has(staffId);
    const { ensureStaffHrHydratedServer } = await import("@/lib/staffHrPersistence");
    await ensureStaffHrHydratedServer().catch(() => false);
    const hr = loadStaffHr();
    const ay = staffWorkingYear(ctx);

    const byDate = new Map<string, (typeof state.registers)[number]>();
    for (const r of state.registers) if (r.date.startsWith(month)) byDate.set(r.date, r);

    const cal = staffMonthCalendar({
      month,
      today,
      exempt,
      markOn: (d) => byDate.get(d)?.marks.find((m) => m.staffId === staffId) ?? null,
      holidayOn: (d) => classifyStaffHolidayDay(ctx.masters, d, ay, staff.stream),
      approvedLeaveOn: (d) =>
        hr.leaveRequests.some(
          (r) => r.staffId === staffId && r.status === "approved" && r.fromDate <= d && r.toDate >= d,
        ),
      wayLabel: punchWayLabel,
    });
    return apiOk({ staffId, fullName: staff.fullName, month, today, exempt, ...cal });
  } catch (e) {
    return apiErr(e);
  }
}
