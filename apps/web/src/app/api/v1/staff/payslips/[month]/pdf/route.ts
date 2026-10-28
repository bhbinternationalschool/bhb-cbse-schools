import { NextResponse } from "next/server";
import { apiErr, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensurePayrollHydratedServer } from "@/lib/payrollPersistence";
import { loadPayroll } from "@/lib/payroll";
import { loadMasters } from "@/lib/masters";
import { bestPayslipRunsForStaff } from "@/lib/staffPayslips";
import { payslipPdfFileName, renderPayslipPdf } from "@/lib/payslipPdf.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/payslips/:month/pdf — MY payslip for that month, as the
 * PDF the web prints (school letterhead). Always the signed-in member of
 * staff: nothing in the request names whose slip it is, and the run is the
 * same one GET /api/v1/staff/payslips lists for that month (paid → posted →
 * approved; drafts are never printed).
 */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ month: string }> },
) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    // Own records, like the payslips tile (my_payslips → home.view).
    assertPermission(ctx, "home", "view");
    const staffId = ctx.session.staffId || "";
    if (!staffId) {
      throw new ApiError("bad_request", "No staff record on this session", 400);
    }
    const { month } = await params;
    if (!/^\d{4}-(0[1-9]|1[0-2])$/.test(month || "")) {
      throw new ApiError("bad_request", "month must be YYYY-MM", 400);
    }

    await ensureSchoolMirrorHydrated();
    await ensurePayrollHydratedServer();
    const { best } = bestPayslipRunsForStaff(loadPayroll().runs, staffId);
    const run = best.get(month);
    const line = run?.lines.find((l) => l.staffId === staffId);
    if (!run || !line) {
      throw new ApiError("not_found", "No released payslip for that month yet.", 404);
    }

    const pdf = await renderPayslipPdf(run, line, loadMasters());
    return new NextResponse(new Uint8Array(pdf), {
      headers: {
        "Content-Type": "application/pdf",
        "Content-Disposition": `inline; filename="${payslipPdfFileName(month, line.empCode, line.fullName)}"`,
        // Salary: never in a shared cache.
        "Cache-Control": "private, no-store",
      },
    });
  } catch (e) {
    return apiErr(e);
  }
}
