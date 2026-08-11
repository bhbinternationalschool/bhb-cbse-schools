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

/**
 * GET /api/v1/parent/summary — the signed-in parent's household at a glance:
 * guardian, children (class/section/roll/photo) and each child's open fee
 * balance. The mobile app's home screen is built from this one call.
 *
 * Parent sessions are scoped to their own household. Staff with students.view
 * may pass ?householdId= to inspect a household (office support flows).
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    await ensureSchoolMirrorHydrated();

    const url = new URL(request.url);
    const requestedHousehold = url.searchParams.get("householdId")?.trim();

    let householdId: string | undefined;
    if (ctx.session.persona === "parent") {
      householdId = ctx.session.householdId;
      if (requestedHousehold && requestedHousehold !== householdId) {
        throw new ApiError("forbidden", "Not your household", 403);
      }
    } else {
      assertPermission(ctx, "students", "view");
      householdId = requestedHousehold || undefined;
    }
    if (!householdId) {
      throw new ApiError("bad_request", "householdId required", 400);
    }

    const sis = loadSis();
    const household = sis.households.find((h) => h.id === householdId);
    if (!household) throw new ApiError("not_found", "Household not found", 404);

    // SIS keeps one student row per academic year; collapse to one child
    // each, preferring the session AY's row, else the newest AY.
    const sessionAy = ctx.session.academicYearCode;
    const byAdmission = new Map<string, (typeof sis.students)[number]>();
    for (const s of sis.students) {
      if (s.householdId !== householdId || s.status !== "active") continue;
      const key = s.admissionNo || s.id;
      const prev = byAdmission.get(key);
      if (
        !prev ||
        s.academicYearCode === sessionAy ||
        (prev.academicYearCode !== sessionAy &&
          s.academicYearCode > prev.academicYearCode)
      ) {
        byAdmission.set(key, s);
      }
    }
    const children = [...byAdmission.values()];

    const masters = loadMasters();
    const classNameOf = (id: string) =>
      masters.classes.find((c) => c.id === id)?.name || "";
    const sectionNameOf = (id: string) =>
      masters.sections.find((s) => s.id === id)?.name || "";

    const ay = ctx.session.academicYearCode;
    const useDb = feesReadFromDbEnabled();

    // Fall back to computed dues only when the cache has nothing for anyone —
    // same order as the fees ledger route.
    const computedRows = useDb
      ? null
      : computeHouseholdDues(householdId, sis, masters, loadFees(), {
          includeFuture: false,
        });

    const childSummaries = await Promise.all(
      children.map(async (child) => {
        let balancePaise = 0;
        if (useDb) {
          const dues = await fetchStudentOpenDuesFromCache(
            child.id,
            ay || child.academicYearCode,
          );
          balancePaise = dues.reduce((s, d) => s + d.balancePaise, 0);
        } else {
          const row = computedRows?.find((r) => r.student.id === child.id);
          const open = openFeeDues(row?.dues ?? []).filter(
            (d) => d.balancePaise > 0,
          );
          balancePaise = open.reduce((s, d) => s + d.balancePaise, 0);
        }
        return {
          id: child.id,
          fullName: child.fullName,
          admissionNo: child.admissionNo,
          className: classNameOf(child.classId),
          sectionName: sectionNameOf(child.sectionId),
          rollNo: child.rollNo,
          photoUrl: child.photoUrl || null,
          openBalancePaise: balancePaise,
          openBalanceLabel: formatInr(balancePaise),
        };
      }),
    );

    const totalPaise = childSummaries.reduce(
      (s, c) => s + c.openBalancePaise,
      0,
    );

    return apiOk({
      householdId,
      guardianName: household.guardianName,
      guardianPhotoUrl: household.guardianPhotoUrl || null,
      academicYearCode: ay,
      children: childSummaries,
      totalOpenBalancePaise: totalPaise,
      totalOpenBalanceLabel: formatInr(totalPaise),
    });
  } catch (e) {
    return apiErr(e);
  }
}
