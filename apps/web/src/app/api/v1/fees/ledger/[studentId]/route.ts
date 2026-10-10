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
import { mergeCurrentAndFuture, todayIso } from "@/lib/feeDueFuture";
import { loadMasters } from "@/lib/masters";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

type DueOut = {
  dueKey: string;
  kind: string;
  label: string;
  dueOn: string | null;
  balancePaise: number;
};

/**
 * GET /api/v1/fees/ledger/:studentId
 *
 * What the family is asked for now (`future: false`) plus what they may
 * pay ahead (`future: true`) — months after the running session month.
 * The "now" list comes from the open-dues cache when it has anything for
 * the student, exactly as before; the "ahead" list is always computed here,
 * because the cache is written by the counter with future months excluded.
 */
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
        futureDues: [],
        openBalancePaise: 0,
        openBalanceLabel: formatInr(0),
      });
    }

    const ay = ctx.session.academicYearCode || student.academicYearCode;
    const asOf = todayIso();
    const masters = loadMasters();
    const fees = loadFees();

    const fullRows = computeHouseholdDues(hhId, sis, masters, fees, { includeFuture: true });
    const fullOpen: DueOut[] = openFeeDues(
      fullRows.find((r) => r.student.id === studentId)?.dues ?? [],
    ).map((d) => ({
      dueKey: d.dueKey,
      kind: d.kind,
      label: d.label,
      dueOn: d.dueOn || null,
      balancePaise: d.balancePaise,
    }));

    let current: DueOut[] | null = null;
    let source: "cache" | "computed" = "computed";
    if (feesReadFromDbEnabled()) {
      const cached = await fetchStudentOpenDuesFromCache(studentId, ay);
      if (cached.length > 0) {
        source = "cache";
        current = cached.map((d) => ({
          dueKey: d.dueKey,
          kind: d.kind,
          label: d.label,
          dueOn: d.dueOn,
          balancePaise: d.balancePaise,
        }));
      }
    }
    if (!current) {
      const nowRows = computeHouseholdDues(hhId, sis, masters, fees, { includeFuture: false });
      current = openFeeDues(nowRows.find((r) => r.student.id === studentId)?.dues ?? []).map((d) => ({
        dueKey: d.dueKey,
        kind: d.kind,
        label: d.label,
        dueOn: d.dueOn || null,
        balancePaise: d.balancePaise,
      }));
    }

    const merged = mergeCurrentAndFuture(current, fullOpen, asOf).filter((d) => d.balancePaise > 0);
    const openDues = merged.filter((d) => !d.future);
    const futureDues = merged.filter((d) => d.future);
    const label = (d: DueOut) => ({ ...d, balanceLabel: formatInr(d.balancePaise) });
    const openBalancePaise = openDues.reduce((s, d) => s + d.balancePaise, 0);
    const futureBalancePaise = futureDues.reduce((s, d) => s + d.balancePaise, 0);

    return apiOk({
      studentId,
      studentName: student.fullName,
      householdId: hhId,
      academicYearCode: ay,
      source,
      openDues: openDues.map((d) => label({ ...d })),
      futureDues: futureDues.map((d) => label({ ...d })),
      openBalancePaise,
      openBalanceLabel: formatInr(openBalancePaise),
      futureBalancePaise,
      futureBalanceLabel: formatInr(futureBalancePaise),
    });
  } catch (e) {
    return apiErr(e);
  }
}
