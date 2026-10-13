import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { attendanceCoverToday } from "@/lib/attendanceCover.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/my-classes — the sections (and subjects) this member of
 * staff teaches, for every class/section/subject picker on the web ERP and
 * in the staff app.
 *
 * `unrestricted: true` means principal / office: the caller should list the
 * whole school. Otherwise `teaching` is the complete answer — an empty list
 * means the office has not given this person any classes yet (Staff →
 * Duties), and the screen should say so rather than offer every class.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const scope = await staffSectionScope(ctx);
    // Today's attendance cover (substitute / co-ordinator): registers only,
    // listed apart so no other picker offers these classes.
    const cover = scope.unrestricted ? [] : await attendanceCoverToday(ctx, scope.academicYearCode);
    const className = (id: string) => ctx.masters.classes.find((c) => c.id === id)?.name || "";
    const sectionName = (id: string) => ctx.masters.sections.find((s) => s.id === id)?.name || "";
    return apiOk({
      staffId: ctx.session.staffId || null,
      academicYearCode: scope.academicYearCode,
      unrestricted: scope.unrestricted,
      homeKind: scope.kind,
      teaching: scope.teaching,
      attendanceCover: cover.map((c) => ({
        ...c,
        className: className(c.classId),
        sectionName: sectionName(c.sectionId),
      })),
    });
  } catch (e) {
    return apiErr(e);
  }
}
