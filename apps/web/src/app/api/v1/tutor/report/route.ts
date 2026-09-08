import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { resolveApiAuth } from "@/lib/api/v1/auth";
import { requireParentHousehold } from "@/lib/api/v1/household";
import { parseAiContentReport } from "@/lib/aiContentReports";
import { recordAiContentReport } from "@/lib/aiContentReports.server";

export const runtime = "nodejs";

/**
 * POST /api/v1/tutor/report — a parent flags an AI reply.
 *
 * Google Play's generative-AI policy requires an in-app way to report
 * offensive AI output; the school's own reason is stronger, since the tutor
 * speaks to children in its name. Either way this is the path from "that
 * answer was wrong" to somebody at the school reading it.
 *
 * The parent sends the text back to us because ai_generations stores only
 * hashes. That means a modified client could file a report containing
 * anything — which is acceptable: a report is a claim for a human to judge,
 * never an instruction, and nothing acts on it automatically.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    const householdId = requireParentHousehold(ctx);

    const body = await request.json().catch(() => ({}));
    const parsed = parseAiContentReport(body);
    if (!parsed.ok) throw new ApiError("bad_request", parsed.error, 400);

    const saved = await recordAiContentReport({
      report: parsed.value,
      householdId,
      reportedBy: ctx.session.fullName || "Parent",
    });
    if (!saved.ok) {
      // Deliberately a 503, not a cheerful 200: telling a parent their
      // safety report was sent when it was not is the one outcome worth
      // failing loudly for.
      throw new ApiError("server_error", saved.error, 503);
    }

    return apiOk({ id: saved.id });
  } catch (e) {
    return apiErr(e);
  }
}
