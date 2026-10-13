import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { buildParentDateSheet } from "@/lib/parentResults.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/parent/datesheet — upcoming papers for each child's class,
 * from the date sheets the school has PUBLISHED to parents (Exams →
 * Date-sheet → "Show to parents"). Household from the session only.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    return apiOk(await buildParentDateSheet(ctx, householdId));
  } catch (e) {
    return apiErr(e);
  }
}
