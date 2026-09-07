import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureAdmissionsHydratedServer } from "@/lib/admissionsPersistence";
import { loadAdmissions } from "@/lib/admissions";
import { istToday } from "@/lib/api/v1/staffFees";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/survey/beats — the areas the school is canvassing, with
 * how many families this agent has already captured in each, plus the class
 * list the capture form needs.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "field_survey");
    await ensureSchoolMirrorHydrated();
    await ensureAdmissionsHydratedServer();

    const state = loadAdmissions();
    const me = (ctx.session.fullName || "").trim().toLowerCase();
    const today = istToday();

    const capturedByBeat = new Map<string, number>();
    let mineToday = 0;
    for (const l of state.leads) {
      if (l.source !== "field_survey") continue;
      const beat = l.surveyBeatId || "";
      if (beat) capturedByBeat.set(beat, (capturedByBeat.get(beat) ?? 0) + 1);
      if (
        (l.assignedTo || "").trim().toLowerCase() === me &&
        (l.leadDate || "").slice(0, 10) === today
      ) {
        mineToday += 1;
      }
    }

    return apiOk({
      today,
      capturedTodayByMe: mineToday,
      beats: (state.surveyBeats ?? [])
        .filter((b) => b.isActive)
        .map((b) => ({
          id: b.id,
          code: b.code,
          name: b.name,
          area: b.area,
          targetHouseholds: b.targetHouseholds,
          captured: capturedByBeat.get(b.id) ?? 0,
          note: b.note,
        })),
      classes: ctx.masters.classes
        .filter((c) => c.isActive !== false)
        .sort((a, b) => a.sortOrder - b.sortOrder)
        .map((c) => ({ id: c.id, name: c.name })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
