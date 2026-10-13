import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { buildParentResults } from "@/lib/parentResults.server";

export const runtime = "nodejs";

/**
 * GET /api/v1/parent/results — each child of the signed-in parent's
 * household, with the exam results the school has RELEASED to parents
 * (Exams → Results → "Show to parents"). The household comes from the
 * session only; no id from the caller decides whose results are read.
 *
 * Each released exam carries the card as the school's printed report card
 * shows it (marks, totals, percentage, grade, rank and remarks only where
 * that card prints them), or a status saying why there is none: marks not
 * ready, held by the office, or could not be checked. Nothing released →
 * releasedTermCount 0 and empty term lists ("Results not published yet").
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);
    return apiOk(await buildParentResults(ctx, householdId));
  } catch (e) {
    return apiErr(e);
  }
}
