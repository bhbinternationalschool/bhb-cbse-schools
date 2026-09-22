/**
 * Reading and deciding the outcomes proposed for a book's chapters.
 *
 * THIS FILE READS THE BASE TABLE, NOT THE VIEW, and that is deliberate.
 * `learning_chapter_outcomes` exists so no other screen can see a match a
 * teacher has not agreed with. The review screen is the one place that must
 * see exactly those — an unreviewed row is its whole subject — so it reads
 * `textbook_chapter_standards` directly. Every OTHER caller should read the
 * view; if a second file ever selects from this table, that is the thing to
 * question.
 *
 * The standard's `code` is never selected. See lib/chapterStandards.ts for why
 * the type has no field for it.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import type { ChapterOutcomes, ProposedOutcome, ReviewVerdict } from "@/lib/chapterStandards";

/** A row of textbook_chapter_standards as it comes back. */
type MatchRow = {
  textbook_id: string;
  position: number;
  case_uuid: string;
  confidence: string;
  rationale: string;
  reviewed_at: string | null;
  reviewed_by: string;
  rejected_at: string | null;
};

/**
 * Which way a row was decided.
 *
 * The table's own check constraint forbids reviewed_at and rejected_at being
 * set together, so the order of these two tests cannot matter — but rejection
 * is tested first anyway, so that a row which somehow carried both would read
 * as "not in use" rather than as approved.
 */
function verdictOf(row: { reviewed_at: string | null; rejected_at: string | null }): ReviewVerdict {
  if (row.rejected_at) return "rejected";
  if (row.reviewed_at) return "approved";
  return "pending";
}

export type BookOutcomes = {
  textbookId: string;
  bookName: string;
  grade: number;
  chapters: ChapterOutcomes[];
};

/**
 * Every chapter of one book, with whatever was proposed for it.
 *
 * Chapters with nothing proposed are returned too, empty. They are the point
 * of several of them — the three the seed deliberately skipped need to appear
 * and say so, not vanish and read as a short book.
 */
export async function loadBookOutcomes(input: {
  grade: number;
  subjectKey: string;
}): Promise<BookOutcomes | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { sb, tenantId } = ctx;

  const { data: book } = await sb
    .from("school_textbooks")
    .select("id, name, grade")
    .eq("tenant_id", tenantId)
    .eq("grade", input.grade)
    .eq("subject_key", input.subjectKey)
    .is("retired_at", null)
    .maybeSingle();
  if (!book?.id) return null;

  const { data: chapterRows } = await sb
    .from("school_textbook_chapters")
    .select("position, name, topics")
    .eq("tenant_id", tenantId)
    .eq("textbook_id", book.id)
    .order("position");

  const { data: matchRows } = await sb
    .from("textbook_chapter_standards")
    .select("textbook_id, position, case_uuid, confidence, rationale, reviewed_at, reviewed_by, rejected_at")
    .eq("tenant_id", tenantId)
    .eq("textbook_id", book.id);

  const matches = (matchRows ?? []) as MatchRow[];

  // The statements, in one read. Joined here rather than through PostgREST's
  // relationship inference: this is a plain lookup by primary key, and doing
  // it by hand keeps the selected columns explicit — which is how `code` stays
  // out of the payload.
  const uuids = [...new Set(matches.map((m) => m.case_uuid))];
  const statements = new Map<string, string>();
  if (uuids.length > 0) {
    const { data: standards } = await sb
      .from("learning_standards")
      .select("case_uuid, statement")
      .in("case_uuid", uuids);
    for (const s of (standards ?? []) as { case_uuid: string; statement: string }[]) {
      statements.set(s.case_uuid, s.statement);
    }
  }

  const byPosition = new Map<number, ProposedOutcome[]>();
  for (const m of matches) {
    const statement = statements.get(m.case_uuid);
    // A match whose standard we cannot name has nothing to show a reviewer;
    // the foreign key makes this unreachable, and dropping it beats rendering
    // a blank row that cannot be agreed with.
    if (!statement) continue;
    const list = byPosition.get(m.position) ?? [];
    list.push({
      caseUuid: m.case_uuid,
      statement,
      confidence: m.confidence === "high" ? "high" : "medium",
      rationale: m.rationale ?? "",
      verdict: verdictOf(m),
      reviewedBy: m.reviewed_by ?? "",
      reviewedAt: m.reviewed_at,
    });
    byPosition.set(m.position, list);
  }

  const chapters: ChapterOutcomes[] = (
    (chapterRows ?? []) as { position: number; name: string; topics: string[] | null }[]
  ).map((c) => ({
    textbookId: book.id as string,
    position: c.position,
    chapterName: c.name,
    topics: c.topics ?? [],
    // Sorted so the list does not reshuffle between loads: confidence first so
    // the ones worth a second look sit together, then the sentence itself.
    outcomes: (byPosition.get(c.position) ?? []).sort(
      (a, b) =>
        (a.confidence === b.confidence ? 0 : a.confidence === "high" ? -1 : 1) ||
        a.statement.localeCompare(b.statement),
    ),
  }));

  return {
    textbookId: book.id as string,
    bookName: (book.name as string) ?? "",
    grade: (book.grade as number) ?? input.grade,
    chapters,
  };
}

export type DecisionResult =
  | {
      ok: true;
      decision: {
        textbookId: string;
        position: number;
        caseUuid: string;
        verdict: ReviewVerdict;
        reviewedBy: string;
        reviewedAt: string | null;
      };
    }
  | { ok: false; error: string };

/**
 * Record one teacher's decision about one proposed outcome.
 *
 * Approving is what puts a sentence in front of a lesson plan, so it is
 * written as an UPDATE of a row that must already exist: a decision about a
 * match the seed never proposed is refused rather than inserted. That keeps
 * the table meaning what it says — our proposals, and what was done about them
 * — instead of becoming a second, hand-made mapping nobody generated.
 *
 * "undo" returns a row to pending, because a reviewer who clicks the wrong
 * button on a Friday afternoon should not need a migration to fix it.
 */
export async function decideChapterStandard(input: {
  textbookId: string;
  position: number;
  caseUuid: string;
  decision: "approve" | "reject" | "undo";
  by: string;
}): Promise<DecisionResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No database connection." };
  const { sb, tenantId } = ctx;

  const now = new Date().toISOString();
  // reviewed_at and rejected_at are mutually exclusive by check constraint, so
  // every branch writes BOTH columns rather than only the one it cares about —
  // otherwise approving a previously rejected row would violate the check.
  const patch =
    input.decision === "approve"
      ? { reviewed_at: now, reviewed_by: input.by, rejected_at: null }
      : input.decision === "reject"
        ? { reviewed_at: null, reviewed_by: input.by, rejected_at: now }
        : { reviewed_at: null, reviewed_by: "", rejected_at: null };

  const { data, error } = await sb
    .from("textbook_chapter_standards")
    .update(patch)
    .eq("tenant_id", tenantId)
    .eq("textbook_id", input.textbookId)
    .eq("position", input.position)
    .eq("case_uuid", input.caseUuid)
    .select("reviewed_at, reviewed_by, rejected_at")
    .maybeSingle();

  if (error) return { ok: false, error: error.message };
  if (!data) {
    return {
      ok: false,
      error: "That outcome is no longer on this chapter — reload the page.",
    };
  }

  const row = data as { reviewed_at: string | null; reviewed_by: string; rejected_at: string | null };
  return {
    ok: true,
    decision: {
      textbookId: input.textbookId,
      position: input.position,
      caseUuid: input.caseUuid,
      verdict: verdictOf(row),
      reviewedBy: row.reviewed_by ?? "",
      reviewedAt: row.reviewed_at,
    },
  };
}
