import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { readHousehold, readHouseholdStudents } from "@/lib/data/server/householdRead";
import { routeTimer } from "@/lib/data/server/routeTiming";
import { formatInr, openFeeDues } from "@/lib/fees";
import { feesReadFromDbEnabled } from "@/lib/feesDbConfig";
import { fetchStudentOpenDuesFromCache } from "@/lib/feesDeskAncillary.server";
import { schoolWhatsAppContact } from "@/lib/schoolWhatsApp.server";
import type { SisStudent } from "@/lib/sis";
import { stampParentAppPresence } from "@/lib/parentAppPresence.server";

export const runtime = "nodejs";

/**
 * The household's fee balances computed from the whole fee desk — the
 * path a child with no rows in the open-dues cache still needs (a fully paid
 * child, or one admitted since the cache was rebuilt). It is the ONLY part
 * of this route that still reads a whole-school copy: the calculation
 * (`computeStudentDues`) reads the fee book, transport, fee adjustments,
 * concession aliases and Masters through module-level stores, so it cannot
 * be handed one family's rows without the fees conversion (data-layer 5.1).
 * Unchanged from before 4.1c, and loaded only when it is needed.
 */
async function computeHouseholdBalancesFromDesk(householdId: string): Promise<(studentId: string) => number> {
  const [{ ensureSchoolMirrorHydrated }, fees, { loadMasters }, { loadSis }] = await Promise.all([
    import("@/lib/schoolDataMirror.server"),
    import("@/lib/fees"),
    import("@/lib/masters"),
    import("@/lib/sis"),
  ]);
  await ensureSchoolMirrorHydrated();
  const rows = fees.computeHouseholdDues(householdId, loadSis(), loadMasters(), fees.loadFees(), {
    includeFuture: false,
  });
  return (studentId: string) => {
    const row = rows.find((r) => r.student.id === studentId);
    return openFeeDues(row?.dues ?? [])
      .filter((d) => d.balancePaise > 0)
      .reduce((s, d) => s + d.balancePaise, 0);
  };
}

/**
 * GET /api/v1/parent/summary — the signed-in parent's household at a glance:
 * guardian, children (class/section/roll/photo) and each child's open fee
 * balance. The mobile app's home screen is built from this one call.
 *
 * Parent sessions are scoped to their own household. Staff with students.view
 * may pass ?householdId= to inspect a household (office support flows).
 *
 * Also carries the school's WhatsApp contact (the number the parent bot
 * answers on) so the app can open that chat without baking a number in.
 *
 * data-layer 4.1c: the household and its children are read from SQL scoped
 * to the household, class and section names from the server's Masters
 * reference copy (the one the session was checked against) — not from the
 * whole-school mirror. A failed read is a 503 (R6), never "household not
 * found" or a family with no children.
 */
export async function GET(request: Request) {
  const timer = routeTimer("v1/parent/summary");
  let res: Response;
  try {
    const ctx = await resolveApiAuth(request);

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

    timer.phase("query");
    const [householdRead, studentsRead] = await Promise.all([
      readHousehold(householdId),
      readHouseholdStudents(householdId),
    ]);
    if (!householdRead.ok || !studentsRead.ok) {
      console.warn(
        "[v1/parent/summary] household read failed",
        !householdRead.ok ? householdRead.reason : "",
        !studentsRead.ok ? studentsRead.reason : "",
      );
      throw new ApiError("server_error", "Could not read this family's record just now — please try again.", 503);
    }
    const household = householdRead.household;
    if (!household) throw new ApiError("not_found", "Household not found", 404);
    // "Opened the app" for Comms → Parents on app — a parent's own household,
    // once resolved; at most hourly, never more than 1.5 s.
    if (ctx.session.persona === "parent") await stampParentAppPresence(household.id, request);

    // SIS keeps one student row per academic year; collapse to one child
    // each, preferring the session AY's row, else the newest AY. (Rows come
    // in id order, as the whole-roster read gave them.)
    const sessionAy = ctx.session.academicYearCode;
    const byAdmission = new Map<string, SisStudent>();
    for (const s of studentsRead.students) {
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

    const masters = ctx.masters;
    const classNameOf = (id: string) =>
      masters.classes.find((c) => c.id === id)?.name || "";
    const sectionNameOf = (id: string) =>
      masters.sections.find((s) => s.id === id)?.name || "";

    const ay = ctx.session.academicYearCode;
    const useDb = feesReadFromDbEnabled();

    // The DB path reads fee_desk_open_dues, which is a CACHE: it is rebuilt
    // only when somebody in the office pushes from the Fees desk. A child
    // admitted since the last push has no rows there, and "no rows" is
    // indistinguishable from "owes nothing" — so the parent was shown an
    // authoritative ₹0 for fees that had in fact been billed.
    //
    // Zero rows therefore means "unknown", not "zero", and we compute for
    // real. A child who genuinely owes nothing computes to zero anyway, so
    // the only cost is one household computation for a fully-paid family.
    const cachedByChild = new Map<string, number | null>();
    if (useDb) {
      await Promise.all(
        children.map(async (child) => {
          const dues = await fetchStudentOpenDuesFromCache(
            child.id,
            ay || child.academicYearCode,
          );
          cachedByChild.set(
            child.id,
            dues.length === 0
              ? null
              : dues.reduce((s, d) => s + d.balancePaise, 0),
          );
        }),
      );
    }
    const needsCompute =
      !useDb || [...cachedByChild.values()].some((v) => v === null);
    timer.note("children", children.length);
    timer.note("computed", needsCompute);

    const computedFor = needsCompute
      ? await computeHouseholdBalancesFromDesk(householdId)
      : () => 0;

    // Null when the school has no WhatsApp number to give — the app hides
    // its card rather than showing one that goes nowhere.
    const schoolWhatsApp = await schoolWhatsAppContact().catch(() => null);

    timer.phase("build");
    const childSummaries = children.map((child) => {
      const cached = useDb ? cachedByChild.get(child.id) ?? null : null;
      const balancePaise = cached ?? computedFor(child.id);
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
    });

    const totalPaise = childSummaries.reduce(
      (s, c) => s + c.openBalancePaise,
      0,
    );

    res = apiOk({
      householdId,
      guardianName: household.guardianName,
      guardianPhotoUrl: household.guardianPhotoUrl || null,
      academicYearCode: ay,
      children: childSummaries,
      totalOpenBalancePaise: totalPaise,
      totalOpenBalanceLabel: formatInr(totalPaise),
      schoolWhatsApp,
    });
  } catch (e) {
    res = apiErr(e);
  }
  timer.done(res.status);
  return res;
}
