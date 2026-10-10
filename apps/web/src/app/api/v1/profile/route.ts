import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadMasters } from "@/lib/masters";
import { classLabelForStudent } from "@/lib/parentPortal";
import {
  documentChecklist,
  householdForParent,
  studentProfileForParent,
} from "@/lib/parentProfile";
import { loadSis, profileCompleteness } from "@/lib/sis";

export const runtime = "nodejs";

/**
 * GET /api/v1/profile — the household as the school has it, every child's
 * full record (Aadhaar masked), each child's document checklist with
 * status, and which household fields the parent may change themselves.
 *
 * Hydrated from the database first, so a verification the office did a
 * minute ago is what the parent sees.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();

    const sis = loadSis();
    const household = sis.households.find((h) => h.id === householdId);
    if (!household) throw new ApiError("not_found", "Household not found", 404);
    const masters = loadMasters();

    const sessionAy = ctx.session.academicYearCode;
    const byAdmission = new Map<string, (typeof sis.students)[number]>();
    for (const s of sis.students) {
      if (s.householdId !== householdId || s.status !== "active") continue;
      const key = s.admissionNo || s.id;
      const prev = byAdmission.get(key);
      if (
        !prev ||
        s.academicYearCode === sessionAy ||
        (prev.academicYearCode !== sessionAy && s.academicYearCode > prev.academicYearCode)
      ) {
        byAdmission.set(key, s);
      }
    }

    return apiOk({
      household: householdForParent(household),
      editableHouseholdFields: [
        "guardianName", "altMobile", "email", "address", "locality",
        "landmark", "city", "state", "pincode",
      ],
      documents: documentChecklist(),
      children: [...byAdmission.values()].map((s) => ({
        ...studentProfileForParent(s, classLabelForStudent(s, masters)),
        completeness: profileCompleteness(s, household),
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
