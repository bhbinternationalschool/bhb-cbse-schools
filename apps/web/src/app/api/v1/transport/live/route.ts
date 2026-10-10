/**
 * GET /api/v1/transport/live — where each of the family's buses is right now.
 *
 * Only their own children's routes; only during the transport day; only
 * while the tracker is reporting. An untracked vehicle (Rajesh's van) is
 * returned as tracked:false so the app can say so plainly.
 */
import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { buildParentBusViews } from "@/lib/fleetLive.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis } from "@/lib/sis";
import { fetchTransportDeskFromDb } from "@/lib/transportNormalized.server";

export const runtime = "nodejs";

export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    await ensureSchoolMirrorHydrated();
    const sis = loadSis();
    const sessionAy = ctx.session.academicYearCode;
    const byAdmission = new Map<string, (typeof sis.students)[number]>();
    for (const s of sis.students) {
      if (s.householdId !== householdId || s.status !== "active") continue;
      const key = s.admissionNo || s.id;
      const prev = byAdmission.get(key);
      if (!prev || s.academicYearCode === sessionAy || (prev.academicYearCode !== sessionAy && s.academicYearCode > prev.academicYearCode)) byAdmission.set(key, s);
    }
    const students = [...byAdmission.values()].map((s) => ({ id: s.id, fullName: s.fullName }));
    const { bundle } = await fetchTransportDeskFromDb();
    const ids = new Set(students.map((s) => s.id));
    const assignments = bundle.assignments
      .filter((a) => ids.has(a.studentId))
      .map((a) => ({ studentId: a.studentId, routeId: a.routeId, stopId: a.stopId, effectiveTo: a.effectiveTo ?? null }));
    const children = await buildParentBusViews({ students, assignments });
    return apiOk({ at: new Date().toISOString(), children: children.filter((c) => c.routeName) });
  } catch (e) {
    return apiErr(e);
  }
}
