import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertStaffPayrollOverviewAccess } from "@/lib/api/v1/staffPayrollMgmtGate";
import { ensurePayrollHydratedServer, payrollServerDbReadOk } from "@/lib/payrollPersistence";
import { loadPayroll, PAYROLL_PAYMENT_MODES } from "@/lib/payroll";
import { currentAcademicYearCode } from "@/lib/masters";
import {
  buildStaffPayrollOverview,
  sessionMonths,
  sessionOfMonth,
  visibleSessionMonths,
} from "@/lib/staffPayrollOverview";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/payroll-overview?session=2026-27 — every staff member's
 * pay for one session (April–March), month by month: gross, deductions,
 * net, each payment part with its day, and what is still unpaid. Read only.
 *
 * Management only (mobile switch "Staff payslips" + payroll.view). Ordinary
 * staff see only their own slips at /api/v1/staff/payslips.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertStaffPayrollOverviewAccess(ctx);

    // ctx.masters already carries the roster; no whole-school replica needed.
    await ensurePayrollHydratedServer();
    if (!payrollServerDbReadOk()) {
      // Unknown must not read as "not run" for everyone.
      throw new ApiError("server_error", "Payroll could not be read just now — not loaded. Try again.", 503);
    }
    const payroll = loadPayroll();

    const todayYm = new Date(Date.now() + 330 * 60_000).toISOString().slice(0, 7);
    const current = currentAcademicYearCode(ctx.masters) || sessionOfMonth(todayYm);
    const asked = new URL(request.url).searchParams.get("session")?.trim() || "";
    const session = asked || current;
    if (sessionMonths(session).length === 0) {
      throw new ApiError("bad_request", "session must look like 2026-27", 400);
    }

    // Sessions to offer: the current one and every one a run falls in.
    const sessions = [
      ...new Set([current, ...payroll.runs.map((r) => sessionOfMonth(r.month)).filter(Boolean)]),
    ].sort((a, b) => b.localeCompare(a));

    const staff = buildStaffPayrollOverview({
      runs: payroll.runs,
      roster: (ctx.masters.staff ?? []).map((s) => ({
        id: s.id,
        empCode: s.empCode,
        fullName: s.fullName,
        status: s.status,
      })),
      session,
      todayYm,
    });

    const modeLabel = (m: string) => PAYROLL_PAYMENT_MODES.find((x) => x.value === m)?.label || m;
    return apiOk({
      session,
      currentSession: current,
      sessions,
      months: visibleSessionMonths(session, todayYm),
      staff: staff.map((s) => ({
        ...s,
        months: s.months.map((m) => ({
          ...m,
          parts: m.parts.map((p) => ({ ...p, paymentModeLabel: modeLabel(p.paymentMode) })),
        })),
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
