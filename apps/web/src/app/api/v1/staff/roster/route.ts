import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { staffHomeKind } from "@/lib/staffHomeKind";

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/roster — the active roster for leadership / office:
 * name, designation, mobile, and which app home each person lands on.
 * Staff with no mobile come first — they cannot sign in until the office
 * adds one (POST ./mobile), which is the point of this list.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "staff", "view");
    const scope = await staffSectionScope(ctx);
    if (!scope.unrestricted) {
      throw new ApiError("forbidden", "Only leadership and the office see the roster", 403);
    }
    await ensureSchoolMirrorHydrated();

    const desOf = (id: string | null | undefined) =>
      ctx.masters.designations.find((d) => d.id === id);
    const rows = ctx.masters.staff
      .filter((s) => s.status === "active")
      .map((s) => {
        const des = desOf(s.designationId);
        const mobile = (s.mobile || "").replace(/\D/g, "");
        return {
          id: s.id,
          empCode: s.empCode || "",
          fullName: s.fullName,
          designation: des?.name || "",
          stream: s.stream || "",
          mobile,
          hasMobile: mobile.length >= 10,
          homeKind: staffHomeKind({
            roleCode: "",
            designation: `${des?.code || ""} ${des?.name || ""}`,
            stream: s.stream || "",
            teachesClasses: (s.classTeacherLinks?.length ?? 0) > 0,
          }),
        };
      })
      .sort(
        (a, b) =>
          Number(a.hasMobile) - Number(b.hasMobile) ||
          a.designation.localeCompare(b.designation) ||
          a.fullName.localeCompare(b.fullName),
      );

    return apiOk({
      total: rows.length,
      missingMobile: rows.filter((r) => !r.hasMobile).length,
      staff: rows,
    });
  } catch (e) {
    return apiErr(e);
  }
}
