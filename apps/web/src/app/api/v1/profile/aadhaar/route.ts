import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { householdChildren, saveFamilyAadhaar } from "@/lib/appPopups.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";

/**
 * POST /api/v1/profile/aadhaar { studentId, who: "child" | "father" | "mother", number }
 *
 * "Correct Aadhaar" on the child's profile in the parent app (director,
 * 12 Oct 2026). Same rule as the pop-up: a number not yet verified by the
 * school is added or corrected by the family; one verified for UDISE+ is
 * never replaced from the app (outcome kept_verified → contact the office).
 * A father's or mother's number is stored on every child of the family, as
 * the pop-up does. The answer carries the last 4 digits only.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    const body = (await request.json().catch(() => ({}))) as Record<string, unknown>;
    const studentId = String(body.studentId ?? "").slice(0, 60);
    const who = String(body.who ?? "");
    const number = String(body.number ?? "").slice(0, 20);
    if (who !== "child" && who !== "father" && who !== "mother") {
      throw new ApiError("bad_request", "who must be child, father or mother", 400);
    }
    const children = await householdChildren(householdId, ctx.session.academicYearCode || "");
    if (!children.length) throw new ApiError("not_found", "No children on roll for this family", 404);
    if (who === "child" && !children.some((c) => c.id === studentId)) {
      throw new ApiError("forbidden", "Not your child", 403);
    }
    const key = who === "child" ? studentId : who;
    const by = `${ctx.session.fullName || "Parent"} · parent app profile`;
    const r = await saveFamilyAadhaar(children, { [key]: number }, by);
    if (!r.ok) throw new ApiError("bad_request", r.error, 400);
    const outcome = r.outcomes.find((o) => o.key === key) ?? null;
    return apiOk({ outcome });
  } catch (e) {
    return apiErr(e);
  }
}
