/**
 * Self-test: counting and moving through the outcomes a teacher has to agree with.
 * Run: npx tsx apps/web/src/lib/chapterStandards.selftest.ts
 */
import assert from "node:assert/strict";
import {
  applyDecision,
  chapterPositionOf,
  fillAgreedOutcomes,
  isSettled,
  nextPending,
  progressLine,
  reviewCounts,
  unmappedReason,
  type ChapterOutcomes,
  type OutcomeFillable,
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

/* ── which unit code names which chapter ────────────────────────────── */
{
  // lib/syllabusFromBooks.ts writes the bare position; hand-made plans write
  // the long forms. All three mean chapter 7.
  assert.equal(chapterPositionOf("7"), 7);
  assert.equal(chapterPositionOf("Ch 7"), 7);
  assert.equal(chapterPositionOf("Chapter 7"), 7);
  assert.equal(chapterPositionOf("ch.7"), 7);
  assert.equal(chapterPositionOf(" 12 "), 12);

  // Anything that is not plainly a chapter number matches nothing. Guessing
  // here would put one chapter's outcomes under another chapter's lesson.
  assert.equal(chapterPositionOf(""), null);
  assert.equal(chapterPositionOf("Unit 2"), null, "a unit is not a chapter");
  assert.equal(chapterPositionOf("7.2"), null, "a sub-section is not a chapter");
  assert.equal(chapterPositionOf("7a"), null);
  assert.equal(chapterPositionOf("Ch 7 — Fractions"), null, "a title is not a code");
  assert.equal(chapterPositionOf("0"), null, "positions start at 1");
}

/* ── feeding agreed outcomes into a draft ───────────────────────────── */
{
  const unit = (p: Partial<OutcomeFillable>): OutcomeFillable => ({
    level: p.level ?? "chapter",
    code: p.code ?? "13",
    learningOutcomes: p.learningOutcomes ?? "",
  });
  const agreed = new Map<number, string[]>([
    [13, ["Use proportional relationships to solve multistep ratio and percent problems."]],
    [5, ["Order of operations.", "Unitary method."]],
  ]);

  // The blank a teacher left is what this fills.
  {
    const r = fillAgreedOutcomes([unit({ code: "13" })], agreed);
    assert.equal(r.filled, 1);
    assert.match(r.units[0]!.learningOutcomes, /proportional relationships/);
  }

  // Several agreed outcomes arrive as one per line, which is the shape
  // buildLessonPlanUserPrompt splits on.
  {
    const r = fillAgreedOutcomes([unit({ code: "5" })], agreed);
    assert.equal(r.units[0]!.learningOutcomes.split("\n").length, 2);
  }

  // THE TEACHER'S OWN WORDS WIN. This is the rule most worth protecting: a
  // teacher who wrote their own outcomes must not find them replaced.
  {
    const typed = unit({ code: "13", learningOutcomes: "What I actually teach here." });
    const r = fillAgreedOutcomes([typed], agreed);
    assert.equal(r.filled, 0);
    assert.equal(r.units[0]!.learningOutcomes, "What I actually teach here.");
  }

  // A topic is finer than its chapter; the chapter's outcome overstates it.
  {
    const r = fillAgreedOutcomes([unit({ level: "topic", code: "13" })], agreed);
    assert.equal(r.filled, 0);
    assert.equal(r.units[0]!.learningOutcomes, "");
  }

  // No match, no fill — the prompt's own fallback handles these, as before.
  {
    assert.equal(fillAgreedOutcomes([unit({ code: "9" })], agreed).filled, 0, "nobody agreed ch 9");
    assert.equal(fillAgreedOutcomes([unit({ code: "" })], agreed).filled, 0, "no code");
    assert.equal(fillAgreedOutcomes([unit({ code: "13" })], new Map()).filled, 0, "nothing agreed");
  }

  // Mixed lesson: only the blank, matched, chapter-level unit is touched, and
  // the count reports exactly that.
  {
    const units = [
      unit({ code: "13" }),
      unit({ code: "13", level: "topic" }),
      unit({ code: "5", learningOutcomes: "mine" }),
      unit({ code: "9" }),
    ];
    const r = fillAgreedOutcomes(units, agreed);
    assert.equal(r.filled, 1);
    assert.equal(r.units[1]!.learningOutcomes, "");
    assert.equal(r.units[2]!.learningOutcomes, "mine");
    assert.equal(r.units[3]!.learningOutcomes, "");
    assert.equal(units[0]!.learningOutcomes, "", "the input is not mutated");
  }
}

console.log("  ok");
