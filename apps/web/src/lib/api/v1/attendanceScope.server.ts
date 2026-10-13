import "server-only";

import { ApiError } from "@/lib/api/v1/errors";
import type { ApiAuthContext } from "@/lib/api/v1/auth";
import { assertSectionScope, scopeAllows, staffSectionScope, type StaffScope } from "@/lib/api/v1/staffScope";
import { coversSectionToday } from "@/lib/attendanceCover.server";
import { todayIst, type CoverSection } from "@/lib/attendanceCover";

/**
 * The student-register guard: the section's own teachers and the office as
 * before (assertSectionScope), plus TODAY's cover — a substitute on one of
 * the class's periods, or its co-ordinator while the class teacher is away
 * (lib/attendanceCover). Cover opens the register for today's date only and
 * nothing else of the class.
 */
export async function assertAttendanceScope(
  ctx: ApiAuthContext,
  classId: string,
  sectionId: string,
  date: string,
): Promise<{ scope: StaffScope; cover: CoverSection | null }> {
  const scope = await staffSectionScope(ctx);
  if (scopeAllows(scope, classId, sectionId)) return { scope, cover: null };
  const cover = await coversSectionToday(ctx, scope.academicYearCode, classId, sectionId);
  if (cover) {
    if (date !== todayIst()) {
      throw new ApiError(
        "forbidden",
        `You are covering this class today only (${cover.detail}) — its register for ${date} is for its own teachers or the office`,
        403,
      );
    }
    return { scope, cover };
  }
  await assertSectionScope(ctx, classId, sectionId); // throws the usual "not a teacher of …"
  return { scope, cover: null };
}
