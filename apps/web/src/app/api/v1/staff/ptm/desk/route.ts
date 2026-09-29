import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { ensurePtmHydratedServer } from "@/lib/ptmPersistence";
import { loadPtm } from "@/lib/ptm";
import { loadSis } from "@/lib/sis";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { scopedPtmState } from "@/lib/ptmTeacherScope.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/ptm/desk — the web PTM desk's data for a teacher, in
 * the desk's own shape (events / slots / bookings / feedback), cut to what
 * the teacher may see (lib/ptmTeacherScope.server.ts). The office keeps
 * reading the whole desk from /api/school-data/ptm-desk; this route exists
 * so a teacher's browser never has to hold the whole school's PTM
 * (2026-09-29).
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "ptm", "view");
    const staffId = ctx.session.staffId || "";
    const scope = await staffSectionScope(ctx);

    await ensureSchoolMirrorHydrated();
    await Promise.all([ensureSisHydratedServer(), ensurePtmHydratedServer()]);
    const state = scopedPtmState({ state: loadPtm(), scope, staffId, sis: loadSis() });
    return apiOk({ staffId, unrestricted: scope.unrestricted, state });
  } catch (e) {
    return apiErr(e);
  }
}
