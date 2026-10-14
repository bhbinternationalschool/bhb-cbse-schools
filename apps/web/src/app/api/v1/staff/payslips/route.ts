import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensurePayrollHydratedServer } from "@/lib/payrollPersistence";
import { loadPayroll, PAYROLL_PAYMENT_MODES } from "@/lib/payroll";
import { bestPayslipRunsForStaff } from "@/lib/staffPayslips";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/payslips — the signed-in staff member's own payslips:
 * one per month, from the best approved / posted / paid run with their line.
 * Draft and pending runs are counted, not shown, so the app can say
 * "September is being prepared" instead of "no payslips".
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    const staffId = ctx.session.staffId || "";
    if (!staffId) {
      throw new ApiError("bad_request", "No staff record on this session", 400);
    }

    await ensureSchoolMirrorHydrated();
    await ensurePayrollHydratedServer();
    const payroll = loadPayroll();

    const modeLabel = (m: string) =>
      PAYROLL_PAYMENT_MODES.find((x) => x.value === m)?.label || m;

    // One payslip per month — the same pick the payslip PDF makes.
    const { best, preparing } = bestPayslipRunsForStaff(payroll.runs, staffId);
    const slips: Record<string, unknown>[] = [];
    for (const run of best.values()) {
      const line = run.lines.find((l) => l.staffId === staffId)!;
      slips.push({
        runId: run.id,
        month: run.month,
        // The same slip, printed on the letterhead (the app shows a PDF
        // button only when the server offers one).
        pdfUrl: `/api/v1/staff/payslips/${run.month}/pdf`,
        status: run.status,
        dayCount: run.dayCount,
        daysPresent: line.daysPresent,
        daysAbsent: line.daysAbsent,
        daysHalf: line.daysHalf,
        daysLeavePaid: line.daysLeavePaid,
        daysLwp: line.daysLwp,
        daysHoliday: line.daysHoliday,
        gross: line.gross,
        totalDeductions: line.totalDeductions,
        netPay: line.netPay,
        amountPayable: line.amountPayable,
        onHold: line.juneHold && !line.eligibleForJuneDraw,
        holdNote: line.holdNote,
        // The day this person was actually paid, when marked on its own
        // (14 Oct 2026); else the planned day / the run's paid day.
        paymentDate: line.paidOn || line.paymentDate,
        paymentMode: line.paymentMode,
        paymentModeLabel: modeLabel(line.paymentMode),
        paidAt: line.paidOn ? `${line.paidOn}T12:00:00+05:30` : run.paidAt,
        earnings: line.components
          .filter((c) => c.kind === "earning")
          .map((c) => ({ name: c.headName, amount: c.amount })),
        deductions: [
          ...line.components
            .filter((c) => c.kind === "deduction")
            .map((c) => ({ name: c.headName, amount: c.amount })),
          ...(line.lwpDeduction > 0
            ? [{ name: "Leave without pay", amount: line.lwpDeduction }]
            : []),
          ...(line.latePenalty > 0
            ? [{ name: "Late penalty", amount: line.latePenalty }]
            : []),
          ...(line.advanceDeduct > 0
            ? [{ name: "Advance recovery", amount: line.advanceDeduct }]
            : []),
          ...(line.specialDeduction > 0
            ? [{ name: line.specialDeductionLabel || "Special deduction", amount: line.specialDeduction }]
            : []),
        ],
        bonus: line.bonus,
      });
    }
    slips.sort((a, b) => String(b.month).localeCompare(String(a.month)));

    return apiOk({ staffId, slips, preparing });
  } catch (e) {
    return apiErr(e);
  }
}
