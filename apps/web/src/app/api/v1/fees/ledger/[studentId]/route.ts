import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import {
  computeHouseholdDues,
  formatInr,
  loadFees,
  openFeeDues,
} from "@/lib/fees";
import { feesReadFromDbEnabled } from "@/lib/feesDbConfig";
import { fetchStudentOpenDuesFromCache } from "@/lib/feesDeskAncillary.server";
import { loadMasters } from "@/lib/masters";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

/** GET /api/v1/fees/ledger/:studentId */
export async function GET(
  request: Request,
  { params }: { params: Promise<{ studentId: string }> },
) {
  try {
    const ctx = await resolveApiAuth(request);
    const { studentId } = await params;
    await ensureSchoolMirrorHydrated();

    const sis = loadSis();
    const student = sis.students.find((s) => s.id === studentId);
    if (!student) throw new ApiError("not_found", "Student not found", 404);

    if (ctx.session.persona === "parent") {
      if (ctx.session.householdId && student.householdId !== ctx.session.householdId) {
        throw new ApiError("forbidden", "Not your child", 403);
      }
    } else {
      assertPermission(ctx, "fees", "view");
    }

    const hhId = student.householdId;
    if (!hhId) {
      return apiOk({
        studentId,
        studentName: student.fullName,
        openDues: [],
        openBalancePaise: 0,
        openBalanceLabel: formatInr(0),
      });
    }

    const ay = ctx.session.academicYearCode || student.academicYearCode;

    if (feesReadFromDbEnabled()) {
      const cached = await fetchStudentOpenDuesFromCache(studentId, ay);
      if (cached.length > 0) {
        const openBalancePaise = cached.reduce((s, d) => s + d.balancePaise, 0);
        return apiOk({
          studentId,
          studentName: student.fullName,
          householdId: hhId,
          academicYearCode: ay,
          source: "cache",
          openDues: cached.map((d) => ({
            dueKey: d.dueKey,
            kind: d.kind,
            label: d.label,
            dueOn: d.dueOn,
            balancePaise: d.balancePaise,
            balanceLabel: formatInr(d.balancePaise),
          })),
          openBalancePaise,
          openBalanceLabel: formatInr(openBalancePaise),
        });
      }
    }

    const masters = loadMasters();
    const fees = loadFees();
    const rows = computeHouseholdDues(hhId, sis, masters, fees, {
      includeFuture: false,
    });
    const studentRow = rows.find((r) => r.student.id === studentId);
    const openDues = openFeeDues(studentRow?.dues ?? []).filter(
      (d) => d.balancePaise > 0,
    );
    const openBalancePaise = openDues.reduce((s, d) => s + d.balancePaise, 0);

    return apiOk({
      studentId,
      studentName: student.fullName,
      householdId: hhId,
      academicYearCode: ay,
      source: "computed",
      openDues: openDues.map((d) => ({
        dueKey: d.dueKey,
        kind: d.kind,
        label: d.label,
        dueOn: d.dueOn,
        balancePaise: d.balancePaise,
        balanceLabel: formatInr(d.balancePaise),
      })),
      openBalancePaise,
      openBalanceLabel: formatInr(openBalancePaise),
    });
  } catch (e) {
    return apiErr(e);
  }
}
