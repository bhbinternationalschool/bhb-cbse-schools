/**
 * The learning outcomes proposed for a chapter, and what a teacher did about them.
 *
 * Phase 1 seeded a judgement: this Propel chapter teaches what this CASE
 * standard describes. That judgement is NOT usable until somebody who teaches
 * the subject agrees with it — `learning_chapter_outcomes`, the view every
 * other screen reads, cannot see an unreviewed row. This file is the shape of
 * the screen where that agreement happens, and the counting behind it.
 *
 * WHY THE CODE IS NOT IN HERE. The standards are American (`3.NF.A.1`,
 * `7.RP.A.3`). They earn their place as well-formed outcome SENTENCES and, for
 * maths, as prerequisite order — never as curriculum, and never as something a
 * teacher, a parent or a child is asked to read. `ProposedOutcome` therefore
 * has no field for the code: the server does not select it and the screen
 * could not render it if it tried. Leaving it out of the type is the only
 * version of that rule that cannot be forgotten in a later edit.
 */

/** What the teacher decided, or that they have not yet. */
export type ReviewVerdict = "pending" | "approved" | "rejected";

/** One proposed outcome for one chapter. */
export type ProposedOutcome = {
  caseUuid: string;
  /** The outcome sentence. The only text from the standard any screen shows. */
  statement: string;
  /**
   * 'high' — the chapter and the standard teach the same thing.
   * 'medium' — the standard covers part of the chapter, or the chapter spans a
   * band and the grade could not be pinned. Shown so a reviewer knows which
   * rows deserve a second look, not to sort them.
   */
  confidence: "high" | "medium";
  /** Why the seed proposed this, in one line, for the teacher who must agree. */
  rationale: string;
  verdict: ReviewVerdict;
  reviewedBy: string;
  reviewedAt: string | null;
};

/** A chapter of the school's own book, with everything proposed for it. */
export type ChapterOutcomes = {
  textbookId: string;
  position: number;
  chapterName: string;
  topics: string[];
  outcomes: ProposedOutcome[];
};

export type ReviewCounts = {
  pending: number;
  approved: number;
  rejected: number;
  /** Chapters with nothing proposed at all — see `UNMAPPED_REASON`. */
  unmapped: number;
};

/**
 * Chapters the seed deliberately left alone, and why — so the screen can say
 * so rather than show an empty row that reads like a bug.
 *
 * Keyed by `<subjectKey>:<grade>:<position>`. The SUBJECT belongs in the key:
 * these are the three decisions recorded in
 * 20260922110000_learning_standards_seed_maths.sql, and they are about maths
 * chapters. Class 8 chapter 3 of the Science book is a different chapter
 * entirely, and telling its reader it is "a history of number systems" would
 * be worse than saying nothing.
 *
 * A re-seed leaves these three unmapped again, so the screen keeps explaining
 * them rather than treating the gap as a fault.
 */
export const UNMAPPED_REASON: Record<string, string> = {
  "maths:1:12":
    "Left unmapped on purpose. The only money standard available is written in dollars and cents, and a rupee chapter must not inherit American currency as its outcome.",
  "maths:2:11":
    "Left unmapped on purpose. The only money standard available is written in dollars and cents, and a rupee chapter must not inherit American currency as its outcome.",
  "maths:8:3":
    "Left unmapped on purpose. A history of number systems, which the standards do not cover.",
};

/** The stated reason this chapter has nothing proposed, or "" if there is none. */
export function unmappedReason(subjectKey: string, grade: number, position: number): string {
  return UNMAPPED_REASON[`${subjectKey}:${grade}:${position}`] ?? "";
}

/** A chapter is settled when every outcome on it has been decided. */
export function isSettled(chapter: ChapterOutcomes): boolean {
  return chapter.outcomes.every((o) => o.verdict !== "pending");
}

/**
 * How much is left to do.
 *
 * `unmapped` counts chapters with no proposal at all, mapped or not: they need
 * no decision, and counting them as pending would leave the screen reading
 * "3 left" for ever.
 */
export function reviewCounts(chapters: ChapterOutcomes[]): ReviewCounts {
  const counts: ReviewCounts = { pending: 0, approved: 0, rejected: 0, unmapped: 0 };
  for (const c of chapters) {
    if (c.outcomes.length === 0) {
      counts.unmapped += 1;
      continue;
    }
    for (const o of c.outcomes) counts[o.verdict] += 1;
  }
  return counts;
}

/**
 * The next chapter still waiting on a decision, after `afterPosition`.
 *
 * Wraps once, so a reviewer who starts in the middle and works down still
 * reaches the ones above without scrolling back. Returns null when nothing is
 * pending — which is what ends the loop rather than cycling for ever.
 */
export function nextPending(
  chapters: ChapterOutcomes[],
  afterPosition: number,
): ChapterOutcomes | null {
  const open = chapters.filter((c) => c.outcomes.length > 0 && !isSettled(c));
  if (open.length === 0) return null;
  return open.find((c) => c.position > afterPosition) ?? open[0] ?? null;
}

/**
 * Fold one decision into the loaded chapters, without refetching.
 *
 * The screen applies the server's answer to the row in place. A decision that
 * names a chapter or outcome we are not holding is ignored rather than
 * appended: it means the list moved on underneath us, and inventing a row
 * would show a teacher an outcome that is not on their screen's book.
 */
export function applyDecision(
  chapters: ChapterOutcomes[],
  decision: {
    textbookId: string;
    position: number;
    caseUuid: string;
    verdict: ReviewVerdict;
    reviewedBy: string;
    reviewedAt: string | null;
  },
): ChapterOutcomes[] {
  return chapters.map((c) => {
    if (c.textbookId !== decision.textbookId || c.position !== decision.position) return c;
    if (!c.outcomes.some((o) => o.caseUuid === decision.caseUuid)) return c;
    return {
      ...c,
      outcomes: c.outcomes.map((o) =>
        o.caseUuid === decision.caseUuid
          ? {
              ...o,
              verdict: decision.verdict,
              reviewedBy: decision.reviewedBy,
              reviewedAt: decision.reviewedAt,
            }
          : o,
      ),
    };
  });
}

/* ── feeding agreed outcomes into a lesson-plan draft ─────────────────
   lib/lessonPlanAi.ts tells the model, in as many words: "If no outcomes
   are given for a unit, derive sensible ones from its title at the level
   of the class." That sentence is the guess this replaces — but only for
   chapters a teacher has actually agreed with, and only where the teacher
   has not written outcomes of their own. */

/**
 * The chapter number a syllabus unit's code refers to, or null.
 *
 * lib/syllabusFromBooks.ts sets a unit's code to the chapter's position as a
 * bare string, so the common case is exactly "7". Hand-made plans write "Ch 7"
 * or "Chapter 7", which mean the same thing. ANYTHING ELSE RETURNS NULL rather
 * than guessing: matching the wrong chapter would put another chapter's
 * outcomes in front of a teacher, which is worse than the honest blank the
 * prompt already handles.
 */
export function chapterPositionOf(code: string): number | null {
  const m = /^\s*(?:ch(?:apter)?\.?\s*)?(\d{1,3})\s*$/i.exec(code || "");
  if (!m) return null;
  const n = Number(m[1]);
  return Number.isInteger(n) && n > 0 ? n : null;
}

/** The shape this needs from a lesson-plan unit; LessonPlanUnitFact satisfies it. */
export type OutcomeFillable = {
  level: string;
  code: string;
  learningOutcomes: string;
};

/**
 * Put the agreed outcomes in front of the model, where there is nothing else.
 *
 * Three rules, and each is a decision rather than an implementation detail:
 *
 *   THE TEACHER'S OWN WORDS WIN. A unit whose learningOutcomes the teacher has
 *   filled in is left exactly as it is. This only ever fills a blank.
 *
 *   CHAPTERS ONLY. A topic is finer than the chapter it sits in, and a
 *   chapter's outcome describes more than that topic — attaching it to the
 *   topic would overstate what the lesson covers.
 *
 *   NO MATCH, NO FILL. A unit whose code is not a chapter number, or whose
 *   chapter nobody has agreed outcomes for, is left blank and the prompt's own
 *   "derive sensible ones from its title" handles it as before.
 */
export function fillAgreedOutcomes<T extends OutcomeFillable>(
  units: T[],
  agreedByPosition: Map<number, string[]>,
): { units: T[]; filled: number } {
  let filled = 0;
  const out = units.map((u) => {
    if (u.level !== "chapter") return u;
    if (u.learningOutcomes.trim()) return u;
    const position = chapterPositionOf(u.code);
    if (position === null) return u;
    const agreed = agreedByPosition.get(position);
    if (!agreed || agreed.length === 0) return u;
    filled += 1;
    return { ...u, learningOutcomes: agreed.join("\n") };
  });
  return { units: out, filled };
}

/** "12 of 14 chapters agreed" — the line the header shows. */
export function progressLine(chapters: ChapterOutcomes[]): string {
  const mapped = chapters.filter((c) => c.outcomes.length > 0);
  if (mapped.length === 0) return "Nothing proposed for this book yet.";
  const settled = mapped.filter(isSettled).length;
  const unmapped = chapters.length - mapped.length;
  const tail = unmapped > 0 ? ` · ${unmapped} left unmapped on purpose` : "";
  return `${settled} of ${mapped.length} chapters agreed${tail}`;
}
