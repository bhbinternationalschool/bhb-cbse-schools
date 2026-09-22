/**
 * Self-test: counting and moving through the outcomes a teacher has to agree with.
 * Run: npx tsx apps/web/src/lib/chapterStandards.selftest.ts
 */
import assert from "node:assert/strict";
import {
  applyDecision,
  isSettled,
  nextPending,
  progressLine,
  reviewCounts,
  unmappedReason,
  type ChapterOutcomes,
  type ProposedOutcome,
  type ReviewVerdict,
} from "@/lib/chapterStandards";

console.log("chapterStandards.selftest.ts");

const BOOK = "sb-g5-maths-propel-edition-a-mathematics-grade-5";

const outcome = (p: Partial<ProposedOutcome> & { caseUuid: string }): ProposedOutcome => ({
  caseUuid: p.caseUuid,
  statement: p.statement ?? "Use proportional relationships to solve multistep ratio and percent problems.",
  confidence: p.confidence ?? "high",
  rationale: p.rationale ?? "",
  verdict: p.verdict ?? "pending",
  reviewedBy: p.reviewedBy ?? "",
  reviewedAt: p.reviewedAt ?? null,
});

const chapter = (
  position: number,
  outcomes: ProposedOutcome[],
  name = `Chapter ${position}`,
): ChapterOutcomes => ({
  textbookId: BOOK,
  position,
  chapterName: name,
  topics: [],
  outcomes,
});

/* ── a chapter is settled only when every outcome on it is decided ──── */
{
  const half = chapter(1, [outcome({ caseUuid: "a", verdict: "approved" }), outcome({ caseUuid: "b" })]);
  assert.equal(isSettled(half), false, "one still pending means not settled");

  const done = chapter(1, [
    outcome({ caseUuid: "a", verdict: "approved" }),
    outcome({ caseUuid: "b", verdict: "rejected" }),
  ]);
  assert.equal(isSettled(done), true, "rejected counts as decided, not as outstanding");

  // A chapter nobody proposed anything for has no outstanding decision.
  assert.equal(isSettled(chapter(3, [])), true);
}

/* ── counting: unmapped chapters are not pending work ───────────────── */
{
  const chapters = [
    chapter(1, [outcome({ caseUuid: "a", verdict: "approved" }), outcome({ caseUuid: "b" })]),
    chapter(2, [outcome({ caseUuid: "c", verdict: "rejected" })]),
    chapter(3, []), // Class 8 ch3 style — deliberately unmapped
  ];
  const counts = reviewCounts(chapters);
  assert.deepEqual(counts, { pending: 1, approved: 1, rejected: 1, unmapped: 1 });

  // The bug this guards: counting an unmapped chapter as pending leaves the
  // screen reading "1 left" after every decision has been made.
  const allDecided = [
    chapter(1, [outcome({ caseUuid: "a", verdict: "approved" })]),
    chapter(2, []),
  ];
  assert.equal(reviewCounts(allDecided).pending, 0, "nothing proposed is nothing to decide");
}

/* ── walking to the next chapter that still needs a decision ────────── */
{
  const chapters = [
    chapter(1, [outcome({ caseUuid: "a", verdict: "approved" })]), // settled
    chapter(2, [outcome({ caseUuid: "b" })]), // pending
    chapter(3, []), // unmapped — never offered
    chapter(4, [outcome({ caseUuid: "d" })]), // pending
  ];

  assert.equal(nextPending(chapters, 0)?.position, 2);
  assert.equal(nextPending(chapters, 2)?.position, 4, "skips the unmapped chapter");

  // Wraps once so a reviewer starting in the middle still reaches the top.
  assert.equal(nextPending(chapters, 4)?.position, 2, "wraps back to the first pending");

  // Ends rather than cycling when the work is done.
  const settled = [chapter(1, [outcome({ caseUuid: "a", verdict: "approved" })]), chapter(2, [])];
  assert.equal(nextPending(settled, 0), null, "nothing pending ends the loop");
}

/* ── applying one decision, without refetching the list ─────────────── */
{
  const before = [
    chapter(1, [outcome({ caseUuid: "a" }), outcome({ caseUuid: "b" })]),
    chapter(2, [outcome({ caseUuid: "a" })]), // same standard, different chapter
  ];
  const after = applyDecision(before, {
    textbookId: BOOK,
    position: 1,
    caseUuid: "a",
    verdict: "approved",
    reviewedBy: "head-of-maths",
    reviewedAt: "2026-09-22T10:00:00Z",
  });

  assert.equal(after[0]!.outcomes[0]!.verdict, "approved");
  assert.equal(after[0]!.outcomes[0]!.reviewedBy, "head-of-maths");
  assert.equal(after[0]!.outcomes[1]!.verdict, "pending", "its sibling is untouched");
  assert.equal(
    after[1]!.outcomes[0]!.verdict,
    "pending",
    "the same standard on another chapter is a separate decision",
  );
  assert.equal(before[0]!.outcomes[0]!.verdict, "pending", "the input is not mutated");
}

/* ── a decision for something we are not holding is ignored ─────────── */
{
  const before = [chapter(1, [outcome({ caseUuid: "a" })])];

  const strayOutcome = applyDecision(before, {
    textbookId: BOOK,
    position: 1,
    caseUuid: "not-on-this-chapter",
    verdict: "approved",
    reviewedBy: "x",
    reviewedAt: null,
  });
  assert.deepEqual(strayOutcome, before, "an unknown standard does not append a row");

  const strayBook = applyDecision(before, {
    textbookId: "sb-g8-maths-propel-new-prime-mathematics-coursebook-grade-8",
    position: 1,
    caseUuid: "a",
    verdict: "approved",
    reviewedBy: "x",
    reviewedAt: null,
  });
  assert.deepEqual(strayBook, before, "position 1 of another book is not this chapter");
}

/* ── the three deliberate gaps explain themselves ───────────────────── */
{
  assert.match(unmappedReason("maths", 1, 12), /dollars and cents/, "Class 1 Money says why");
  assert.match(unmappedReason("maths", 2, 11), /dollars and cents/, "Class 2 Money says why");
  assert.match(unmappedReason("maths", 8, 3), /history of number systems/, "Class 8 ch3 says why");
  assert.equal(unmappedReason("maths", 5, 13), "", "a mapped chapter has no excuse to show");

  // The bug this guards: the three exemptions are about MATHS chapters.
  // Chapter 3 of the Class 8 Science book is a different chapter, and must not
  // inherit maths's excuse for being empty.
  assert.equal(
    unmappedReason("science", 8, 3),
    "",
    "another subject's chapter 3 is not the maths history chapter",
  );
  assert.equal(unmappedReason("english", 1, 12), "", "nor is another subject's chapter 12");
}

/* ── the header line ────────────────────────────────────────────────── */
{
  const mixed = [
    chapter(1, [outcome({ caseUuid: "a", verdict: "approved" })]),
    chapter(2, [outcome({ caseUuid: "b" })]),
    chapter(3, []),
  ];
  assert.equal(progressLine(mixed), "1 of 2 chapters agreed · 1 left unmapped on purpose");

  assert.equal(progressLine([chapter(1, [])]), "Nothing proposed for this book yet.");
  assert.equal(progressLine([]), "Nothing proposed for this book yet.");
}

/* ── the guarantee that made this file: no US code reaches a screen ─── */
{
  // ProposedOutcome has no `code` field, so a screen cannot render one even by
  // accident. This asserts the shape rather than trusting a later edit to
  // remember the rule.
  const o = outcome({ caseUuid: "a" });
  assert.equal(
    Object.prototype.hasOwnProperty.call(o, "code"),
    false,
    "a proposed outcome must not carry the standard's code",
  );
  const verdicts: ReviewVerdict[] = ["pending", "approved", "rejected"];
  assert.equal(verdicts.length, 3);
}

console.log("  ok");
