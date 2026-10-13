import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { resolveMobileAccess } from "@/lib/api/v1/mobileAccess.server";
import { staffSectionScope } from "@/lib/api/v1/staffScope";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { MOBILE_FEATURES } from "@/lib/mobileFeatures";

/**
 * The heading each tile sits under on the app's home (director, 13 Oct 2026:
 * "put actions in their grouping"). The same groups the office sees in
 * Masters → Roles → Mobile app; tiles the server injects carry their own.
 */
const GROUP_ORDER = ["Teaching", "Students", "Fees", "Admissions", "Leadership", "Gate", "Transport", "Self service"] as const;
const FEATURE_GROUP: Record<string, string> = {
  ...Object.fromEntries(MOBILE_FEATURES.map((f) => [f.id, f.group])),
  subject_requests: "Teaching",
  class_gallery: "Students",
  teacher_ai_tools: "Teaching",
};

/**
 * The app screens whose AI helpers the "AI tools" tile gathers (2026-10-13):
 * answer-sheet marks, question paper and remedial worksheet sit on marks
 * entry (exams.edit), the lesson-plan draft on the period log
 * (teaching.edit), the PTM brief on PTM meetings (ptm.edit). The web ERP
 * offers these to anyone holding those grants, with no switch of its own, so
 * the tile follows them; switching the underlying screen off removes it.
 */
const AI_TOOL_BASES = ["marks_entry", "period_log", "ptm_meet"];

export const runtime = "nodejs";

/**
 * GET /api/v1/staff/features — what this staff member may open in the app.
 * The app renders its tiles from this, so switching a feature off in the
 * ERP makes it disappear from the phone on the next load.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    await ensureSchoolMirrorHydrated();
    const access = resolveMobileAccess(ctx);
    // A class teacher always sees their own class's fee dues (read-only,
    // scoped server-side in /api/v1/staff/fees/defaulters).
    const scope = await staffSectionScope(ctx);
    const features: string[] =
      scope.classTeacherOf.size > 0 && !access.features.includes("fee_defaulters")
        ? [...access.features, "fee_defaulters"]
        : [...access.features];
    // Anyone who teaches a class may ask the office to change what it
    // studies (My subjects; the office approves in Masters → Subjects). A
    // request changes nothing, so it needs no grant of its own.
    if ((scope.unrestricted || scope.teaching.length > 0) && !features.includes("subject_requests")) {
      features.push("subject_requests");
    }
    // Class gallery (10 Oct 2026): a class teacher posts their class's photos
    // and videos; only that class's families see them.
    if (scope.classTeacherOf.size > 0 && !features.includes("class_gallery")) {
      features.push("class_gallery");
    }
    if (AI_TOOL_BASES.some((f) => features.includes(f)) && !features.includes("teacher_ai_tools")) {
      features.push("teacher_ai_tools");
    }
    return apiOk({
      staffId: ctx.session.staffId || "",
      fullName: ctx.session.fullName,
      homeKind: scope.kind,
      features,
      groups: Object.fromEntries(features.map((f) => [f, FEATURE_GROUP[f] || "Self service"])),
      groupOrder: GROUP_ORDER,
      blockedByRbac: access.blockedByRbac,
    });
  } catch (e) {
    return apiErr(e);
  }
}
