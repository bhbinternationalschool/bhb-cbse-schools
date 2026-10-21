import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertStaffAdvancesOverviewAccess } from "@/lib/api/v1/staffPayrollMgmtGate";
import { fetchDeskSliceFromDb } from "@/lib/deskSliceNormalized.server";
import { advanceTotalsByStaff } from "@/lib/staffAdvanceTotals";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/advances-overview — only staff who hold an advance:
 * total taken, recovered and due, with every advance and each recovery
 * (salary month or return to school) and its date. Read only.
 *
 * The same register (staff_advances desk) and arithmetic
 * (lib/staffAdvanceTotals) as the web's Payroll → Advances screen.
 * Management only (mobile switch "Staff advances" + the advances grant).
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertStaffAdvancesOverviewAccess(ctx);

    // The register is one slice row ("advances"), so no paging is needed.
    const read = await fetchDeskSliceFromDb("staff_advances");
    if (!read.ok) {
      // Unknown is not "nobody holds an advance".
      throw new ApiError("server_error", "Advances could not be read just now — not loaded. Try again.", 503);
    }
    const raw = Array.isArray(read.bundle.advances) ? (read.bundle.advances as unknown[]) : [];
    const staff = advanceTotalsByStaff(raw).map((t) => ({
      staffId: t.staffId,
      empCode: t.empCode,
      fullName: t.fullName,
      taken: t.taken,
      recovered: t.recovered,
      due: t.due,
      advanceCount: t.advanceCount,
      openCount: t.openCount,
      advances: t.advances.map((a) => {
        const recovered = a.recoveries.reduce((n, r) => n + r.amount, 0);
        return {
          id: a.id,
          amount: a.amount,
          givenDate: a.givenDate,
          paymentMode: a.paymentMode,
          source: a.source,
          note: a.note,
          status: a.status,
          recovered,
          outstanding: Math.max(0, a.amount - recovered),
          recoveries: [...a.recoveries]
            .sort((x, y) => (x.recoveredAt || x.month).localeCompare(y.recoveredAt || y.month))
            .map((r) => ({
              method: r.method,
              month: r.month,
              amount: r.amount,
              recoveredAt: r.recoveredAt,
              returnMode: r.returnMode,
              note: r.note,
            })),
        };
      }),
    }));
    return apiOk({
      staff,
      totals: {
        taken: staff.reduce((n, s) => n + s.taken, 0),
        recovered: staff.reduce((n, s) => n + s.recovered, 0),
        due: staff.reduce((n, s) => n + s.due, 0),
      },
    });
  } catch (e) {
    return apiErr(e);
  }
}
