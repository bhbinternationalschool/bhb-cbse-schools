import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { isSchoolWideSession, staffWorkingYear } from "@/lib/api/v1/staffScope";
import { resolveStaffHomeKind } from "@/lib/staffHomeKind.server";
import { istToday } from "@/lib/dailyBrief.server";
import { attendanceExemptStaffIds } from "@/lib/staffAttendance";
import { readStaffAttendanceSettings } from "@/lib/staffAttendanceDeskAncillary.server";
import { fetchStaffAttendanceRegistersBetween } from "@/lib/staffAttendanceNormalized.server";
import { fetchDeskSliceFromDb } from "@/lib/deskSliceNormalized.server";
import { normalizeStaffHrState, type StaffHrState } from "@/lib/staffHr";
import { buildStaffMonthView, staffSessionMonths } from "@/lib/staffMonthRegister";
import { isStaffRegisterOwner } from "@/lib/staffRegisterOwner";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * GET /api/v1/attendance/staff-month?month=YYYY-MM[&academicYearCode=]
 *
 * The staff attendance month register and the month's leave (director,
 * 15 Oct 2026): every member of staff who keeps attendance × every day of
 * the month, the per-person totals, each approved leave in the month and
 * the balances at month end (lib/staffMonthRegister).
 *
 * Read for this request from the database — the month's registers and
 * marks, the attendance settings (who is exempt), the HR desk — never from
 * a server copy. Any of them unreadable = 503: the screen says it could not
 * load, it never shows a month of blanks.
 *
 * Reading: the office and leadership see everyone; anyone else with
 * Attendance (view) sees their own row. `canEdit` = the owner — the only
 * person who may change the register (lib/staffRegisterOwner).
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") throw new ApiError("forbidden", "Staff session required", 403);
    assertPermission(ctx, "attendance", "view");
    const url = new URL(request.url);
    const wide = isSchoolWideSession(ctx, resolveStaffHomeKind(ctx.session, ctx.masters, { teachesClasses: false }));
    const owner = isStaffRegisterOwner(ctx.session, ctx.rbac, ctx.masters);
    const ay = (wide || owner ? url.searchParams.get("academicYearCode") : "") || staffWorkingYear(ctx);
    const today = istToday();
    const months = staffSessionMonths(ctx.masters, ay, today);
    const month = url.searchParams.get("month") || months[0] || today.slice(0, 7);
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month)) throw new ApiError("bad_request", "month must be YYYY-MM", 400);
    const only = wide || owner ? undefined : new Set([ctx.session.staffId || "(none)"]);

    const [y, m] = month.split("-").map(Number) as [number, number];
    const monthEnd = `${month}-${String(new Date(Date.UTC(y, m, 0)).getUTCDate()).padStart(2, "0")}`;
    const [regs, settings, hrRead] = await Promise.all([
      fetchStaffAttendanceRegistersBetween(`${month}-01`, monthEnd),
      readStaffAttendanceSettings(),
      fetchDeskSliceFromDb("staff_hr"),
    ]);
    if (!regs.ok) throw new ApiError("server_error", "Could not load the staff register for this month. Try again.", 503);
    if (!settings.ok) throw new ApiError("server_error", "Could not load the staff attendance settings. Try again.", 503);
    if (!hrRead.ok) throw new ApiError("server_error", "Could not load staff leave. Try again.", 503);
    const hr: StaffHrState = normalizeStaffHrState({ version: 1, ...(hrRead.bundle as Partial<StaffHrState>) });

    const exempt = attendanceExemptStaffIds(settings.settings, {
      roles: ctx.rbac.roles.map((r) => ({ id: r.id, code: r.code })),
      assignments: ctx.rbac.assignments.map((a) => ({ staffId: a.staffId, roleId: a.roleId, isPrimary: a.isPrimary })),
    });
    const staff = (ctx.masters.staff ?? []).filter((s) => !exempt.has(s.id));

    const view = buildStaffMonthView({
      masters: ctx.masters,
      ay,
      month,
      today,
      registers: regs.registers,
      staff,
      onlyStaffIds: only,
      leaveTypes: hr.leaveTypes,
      leaveRequests: hr.leaveRequests,
      leaveBalances: hr.leaveBalances,
      leaveEncashments: hr.leaveEncashments,
      overlayLeave: settings.settings.syncLeaveToAttendance,
    });
    if ("error" in view) throw new ApiError("bad_request", view.error, 400);
    return apiOk({ ...view, months, canEdit: owner, scope: only ? "self" : "school" });
  } catch (e) {
    return apiErr(e);
  }
}
