import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import {
  assertMobileFeature,
  hasMobileFeature,
} from "@/lib/api/v1/mobileAccess.server";
import {
  gateBoard,
  gatePassesForDay,
  loadVisitorState,
} from "@/lib/api/v1/staffVisitors.server";
import { todayIstKey } from "@/lib/visitorSelfService.server";
import { VISITOR_PURPOSES } from "@/lib/visitors";
import { classLabelOf } from "@/lib/api/v1/staffFees";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { ensureSisHydratedServer } from "@/lib/sisPersistence";
import { loadSis } from "@/lib/sis";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/visitors — the gate board.
 *
 * Everyone still on campus (including anyone who never checked out on an
 * earlier day — that is precisely who the guard needs to see), today's
 * departures, and today's early-pickup passes with the child named.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "visitor_gate");

    const day = new URL(request.url).searchParams.get("date")?.trim() || todayIstKey();
    const state = await loadVisitorState();
    const board = gateBoard(state);

    await ensureSchoolMirrorHydrated();
    await ensureSisHydratedServer();
    const sis = loadSis();
    const ay = ctx.session.academicYearCode;
    const students = new Map(
      sis.students
        .filter((s) => s.academicYearCode === ay)
        .map((s) => [s.id, s] as const),
    );
    const passes = gatePassesForDay(state, day, {
      studentName: (id) => students.get(id)?.fullName || "",
      classLabel: (id) => {
        const s = students.get(id);
        return s ? classLabelOf(ctx, s) : "";
      },
      staffName: (id) => ctx.masters.staff.find((s) => s.id === id)?.fullName || "",
    });

    return apiOk({
      date: day,
      onCampus: board.onCampus,
      departedToday: board.departedToday,
      gatePasses: passes,
      purposes: VISITOR_PURPOSES,
      /** Whether this person may actually release a child, so the app can
       *  show the pass list read-only instead of offering a dead button. */
      canRelease: hasMobileFeature(ctx, "gate_pass_release"),
    });
  } catch (e) {
    return apiErr(e);
  }
}
