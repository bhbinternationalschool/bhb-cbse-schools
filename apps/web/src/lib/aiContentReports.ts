/**
 * Reporting an AI reply — the pure half.
 *
 * A parent taps "Report this reply" in the tutor and the app posts what was
 * asked, what came back, and optionally why they objected. This module
 * decides what a valid report is, so the rule is one testable function
 * rather than something spread across a route handler.
 *
 * The governing principle here is that a safety report must not be lost.
 * Over-long text is TRUNCATED, never rejected — a parent reporting an
 * unsafe answer should not be told their complaint was too long — and a
 * missing or malformed generation id is dropped rather than refused, since
 * the report is still actionable without it. The only thing worth a 400 is
 * a report with no reply text at all, which has nothing to act on.
 */

/** Why the parent objected, in their words. Optional. */
export const AI_REPORT_REASON_MAX = 500;

/**
 * The exchange itself. Generous: tutor answers run long, and a truncated
 * reply is still enough to judge, whereas a rejected report is nothing.
 */
export const AI_REPORT_TEXT_MAX = 4000;

export type AiReportCategory =
  | "wrong"
  | "inappropriate"
  | "confusing"
  | "other";

export const AI_REPORT_CATEGORIES: readonly AiReportCategory[] = [
  "wrong",
  "inappropriate",
  "confusing",
  "other",
];

export type ParsedAiReport = {
  generationId: string;
  studentId: string;
  category: AiReportCategory;
  reason: string;
  question: string;
  reply: string;
};

export type ParseResult =
  | { ok: true; value: ParsedAiReport }
  | { ok: false; error: string };

/** ai_generations ids look like `aig_` + 8–32 hex-ish characters. */
const GENERATION_ID = /^aig_[a-z0-9]{8,32}$/i;

function text(v: unknown, max: number): string {
  return String(v ?? "")
    .trim()
    .slice(0, max);
}

/**
 * Normalise and validate one report. Never throws — the caller decides the
 * status code — and never widens what it was given.
 */
export function parseAiContentReport(body: unknown): ParseResult {
  const b = (body ?? {}) as Record<string, unknown>;

  const reply = text(b.reply, AI_REPORT_TEXT_MAX);
  if (!reply) {
    return { ok: false, error: "Nothing to report — the reply was empty" };
  }

  const rawCategory = String(b.category ?? "").trim() as AiReportCategory;
  const category = AI_REPORT_CATEGORIES.includes(rawCategory)
    ? rawCategory
    : "other";

  // An id we cannot recognise is dropped, not refused: the report still
  // carries the text, which is what a human needs to judge it.
  const rawGen = String(b.generationId ?? "").trim();
  const generationId = GENERATION_ID.test(rawGen) ? rawGen : "";

  return {
    ok: true,
    value: {
      generationId,
      studentId: text(b.studentId, 120),
      category,
      reason: text(b.reason, AI_REPORT_REASON_MAX),
      question: text(b.question, AI_REPORT_TEXT_MAX),
      reply,
    },
  };
}

/**
 * What the school sees in the queue. The category is folded into the
 * reason line so one column carries both, because a report with a category
 * and no words is still a report and should not read as blank.
 */
export function reportSummary(r: {
  category?: string;
  reason?: string;
}): string {
  const label: Record<string, string> = {
    wrong: "Wrong answer",
    inappropriate: "Inappropriate",
    confusing: "Confusing",
    other: "Reported",
  };
  const head = label[String(r.category ?? "other")] ?? "Reported";
  const said = String(r.reason ?? "").trim();
  return said ? `${head} — ${said}` : head;
}
