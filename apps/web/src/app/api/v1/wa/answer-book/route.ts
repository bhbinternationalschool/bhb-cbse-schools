import { apiErr, apiOk, ApiError } from "@/lib/api/v1/errors";
import { assertPermission, resolveApiAuth } from "@/lib/api/v1/auth";
import { writeAudit } from "@/lib/audit.server";
import { requestMeta } from "@/lib/api/v1/auth";
import {
  approveAnswerEntry,
  listAnswerBook,
  retireAnswerEntry,
  saveAnswerEntry,
} from "@/lib/answerBook.server";

export const runtime = "nodejs";

/** GET /api/v1/wa/answer-book — the book, newest first. */
export async function GET(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    assertPermission(ctx, "wa_chatbot", "view");
    const status = new URL(request.url).searchParams.get("status") || undefined;
    return apiOk({ entries: await listAnswerBook({ status }) });
  } catch (e) {
    return apiErr(e);
  }
}

type Body = {
  action?: "save" | "approve" | "retire";
  id?: string;
  question?: string;
  answer?: string;
  category?: string;
  language?: string;
  validUntil?: string | null;
};

/**
 * POST /api/v1/wa/answer-book — write, approve or retire an answer.
 *
 * Writing needs "wa_chatbot: edit". APPROVING is deliberately heavier — an
 * approved entry is the school speaking, in its own words, to every parent
 * who asks from then on. Owner and principal hold that action; the office
 * and admin can write an answer and propose it, which is the maker-checker
 * split the rest of the ERP uses for anything a family is told.
 */
export async function POST(request: Request) {
  try {
    const ctx = await resolveApiAuth(request);
    if (ctx.session.persona !== "staff") {
      throw new ApiError("forbidden", "Staff session required", 403);
    }
    const body = (await request.json()) as Body;
    const action = body.action || "save";
    const by = ctx.session.fullName || ctx.session.roleCode || "Staff";

    if (action === "save") {
      assertPermission(ctx, "wa_chatbot", "edit");
      const r = await saveAnswerEntry({
        id: body.id,
        question: String(body.question || ""),
        answer: String(body.answer || ""),
        category: body.category,
        language: body.language,
        validUntil: body.validUntil ?? null,
        by,
      });
      if (!r.ok) throw new ApiError("bad_request", r.error || "Could not save", 400);
      return apiOk({ id: r.id });
    }

    if (!body.id) throw new ApiError("bad_request", "Which entry?", 400);

    if (action === "approve") {
      assertPermission(ctx, "wa_chatbot", "approve");
      const r = await approveAnswerEntry({ id: body.id, by });
      if (!r.ok) throw new ApiError("bad_request", r.error || "Could not approve", 400);
      const meta = requestMeta(request);
      await writeAudit({
        session: ctx.session,
        module: "wa_chatbot",
        action: "approve",
        entityType: "wa_answer",
        entityId: body.id,
        summary: "Approved an answer for the WhatsApp answer book",
        ip: meta.ip,
        userAgent: meta.userAgent,
      });
      return apiOk({ id: body.id });
    }

    if (action === "retire") {
      assertPermission(ctx, "wa_chatbot", "approve");
      const r = await retireAnswerEntry({ id: body.id });
      if (!r.ok) throw new ApiError("bad_request", r.error || "Could not retire", 400);
      return apiOk({ id: body.id });
    }

    throw new ApiError("bad_request", "Unknown action", 400);
  } catch (e) {
    return apiErr(e);
  }
}
