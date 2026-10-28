import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { assertMobileFeature } from "@/lib/api/v1/mobileAccess.server";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { colleagueProfileView } from "@/lib/staffSelfProfile";
import { readOwnStaff } from "@/lib/staffSelfProfile.server";

export const runtime = "nodejs";

type Params = { params: Promise<{ staffId: string }> };

/**
 * GET /api/v1/staff/roster/:staffId — one colleague's profile for the app's
 * Staff list (principal home → "Active staff" → a name; request
 * mr_mv9yf8qf6y0j).
 *
 * The same gate as the roster itself (Staff · view, school-wide sessions)
 * plus the Staff contacts switch. Read for this request from sis_staff, not
 * a server copy. Contact, personal and qualification fields only — no
 * identity numbers, bank or statutory details (lib/staffSelfProfile
 * colleagueProfileView).
 */
export async function GET(request: Request, { params }: Params) {
  try {
    const ctx = await resolveApiAuth(request);
    assertMobileFeature(ctx, "staff_roster");
    assertPermission(ctx, "staff", "view");
    const scope = await staffSectionScope(ctx);
    if (!scope.unrestricted) {
      throw new ApiError("forbidden", "Only leadership and the office see staff profiles", 403);
    }
    const { staffId } = await params;
    const read = await readOwnStaff(staffId);
    if (!read) {
      // Unknown id and an unreadable row look alike from here; a roster row
      // that exists in Masters but cannot be read is a read failure.
      const known = (ctx.masters.staff ?? []).some((s) => s.id === staffId);
      throw known
        ? new ApiError("server_error", "Could not read this profile — try again.", 503)
        : new ApiError("not_found", "No such member of staff", 404);
    }
    const s = read.staff;
    const designation = ctx.masters.designations?.find((d) => d.id === s.designationId)?.name || "";
    const department = ctx.masters.departments?.find((d) => d.id === s.departmentId)?.name || "";
    return apiOk({
      staff: {
        id: s.id,
        empCode: s.empCode || "",
        fullName: s.fullName,
        photoUrl: s.photoUrl || "",
        designation,
        department,
        stream: s.stream || "",
        joiningDate: s.joiningDate || "",
        status: s.status,
        mobile: (s.mobile || "").replace(/\D/g, ""),
        classTeacherOf: (s.classTeacherLinks ?? [])
          .map((l) => {
            const c = ctx.masters.classes.find((x) => x.id === l.classId)?.name || "";
            const sec = ctx.masters.sections.find((x) => x.id === l.sectionId)?.name || "";
            return `${c} ${sec}`.trim();
          })
          .filter(Boolean),
      },
      fields: colleagueProfileView(s),
    });
  } catch (e) {
    return apiErr(e);
  }
}
