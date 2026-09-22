import { apiErr, apiOk } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { decideChapterStandard, loadBookOutcomes } from "@/lib/chapterStandards.server";

export const runtime = "nodejs";
export const dynamic = "force-dynamic";
export const revalidate = 0;

/**
 * GET /api/v1/teaching/chapter-standards?grade=5&subjectKey=maths
 *
 * The outcomes proposed for one book, with what has been decided about each.
 * Reading is an ordinary teaching permission — anyone who can open the module
 * may look at what is proposed.
 */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "teaching", "view");
    const url = new URL(request.url);
    const grade = Number(url.searchParams.get("grade"));
    const subjectKey = url.searchParams.get("subjectKey") || "";
    if (!Number.isInteger(grade) || !subjectKey) {
      return apiOk({ book: null, error: "Pick a class and a subject." });
    }
    const book = await loadBookOutcomes({ grade, subjectKey });
    const res = apiOk({ book });
    res.headers.set("Cache-Control", "no-store, no-cache, must-revalidate");
    return res;
  } catch (e) {
    return apiErr(e);
  }
}

/**
 * POST /api/v1/teaching/chapter-standards — agree with one proposed outcome, or don't.
 *
 * Gated on `teaching:approve`, not `edit`. Approving is not an edit to one
 * lesson: it puts a sentence in front of every lesson plan for that chapter,
 * and — once the drill is wired up — behind the questions a child is asked the
 * night before a paper. That is the academic head's call, which is why only
 * the role holding `approve` can make it. Teachers can read the proposals.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    assertPermission(ctx, "teaching", "approve");
    const body = (await request.json().catch(() => ({}))) as {
      textbookId?: string;
      position?: number;
      caseUuid?: string;
      decision?: string;
    };

    const textbookId = typeof body.textbookId === "string" ? body.textbookId : "";
    const caseUuid = typeof body.caseUuid === "string" ? body.caseUuid : "";
    const position = Number(body.position);
    const decision = body.decision;
    if (!textbookId || !caseUuid || !Number.isInteger(position)) {
      return apiOk({ ok: false, error: "Which outcome? The request named no chapter." });
    }
    if (decision !== "approve" && decision !== "reject" && decision !== "undo") {
      return apiOk({ ok: false, error: "A decision is approve, reject or undo." });
    }

    const result = await decideChapterStandard({
      textbookId,
      position,
      caseUuid,
      decision,
      // Who agreed, in the words the rest of the ERP uses for a person.
      by: ctx.session.fullName || ctx.session.roleCode || "",
    });
    return apiOk(result);
  } catch (e) {
    return apiErr(e);
  }
}
