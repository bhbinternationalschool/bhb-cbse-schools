import assert from "node:assert/strict";

import {
  buildLessonPlanSystemPrompt,
  buildLessonPlanUserPrompt,
  cleanLessonPlanAiInput,
  LESSON_PLAN_MAX_PERIODS,
  LESSON_PLAN_MAX_UNITS,
  parseLessonPlanJson,
} from "./lessonPlanAi";

console.log("lessonPlanAi.selftest.ts");

// ─── cleanLessonPlanAiInput ────────────────────────────────────────────

{
  const input = cleanLessonPlanAiInput({
    classLabel: "VIII",
    subjectName: "Mathematics",
    periods: 2,
    language: "hi",
    units: [
      {
        level: "chapter",
        code: "Ch 3",
        title: "Understanding Quadrilaterals",
        learningOutcomes: "Classify quadrilaterals\nApply angle-sum property",
        plannedPeriods: 8,
      },
      { level: "topic", title: "Kinds of quadrilaterals" },
      { title: "" }, // dropped — no title
    ],
    existing: { title: "", objectives: "angle sum", teachingAids: "" },
    teacherNote: "focus on ICSE-style proofs",
  });
  assert.ok(input);
  assert.equal(input.language, "hi");
  assert.equal(input.periods, 2);
  assert.equal(input.units.length, 2, "untitled unit dropped");
  assert.equal(input.units[0].plannedPeriods, 8);
  assert.equal(input.units[1].level, "topic");
  assert.equal(input.units[1].plannedPeriods, 0, "missing planned periods → 0, never invented");
  assert.equal(input.existing.objectives, "angle sum");
  assert.equal(input.existing.homework, "");
}

{
  // Caps: periods clamp, unit list truncated, language defaults to en.
  const input = cleanLessonPlanAiInput({
    subjectName: "Science",
    periods: 999,
    language: "fr",
    units: Array.from({ length: 40 }, (_, i) => ({ title: `Unit ${i}` })),
  });
  assert.ok(input);
  assert.equal(input.periods, LESSON_PLAN_MAX_PERIODS);
  assert.equal(input.units.length, LESSON_PLAN_MAX_UNITS);
  assert.equal(input.language, "en");
}

{
  // Nothing to plan from → null (route returns 400, no LLM call).
  assert.equal(cleanLessonPlanAiInput({ periods: 1 }), null);
  assert.equal(cleanLessonPlanAiInput(null), null);
  assert.equal(cleanLessonPlanAiInput("x"), null);
  // Periods that are garbage → 1, not NaN.
  const p = cleanLessonPlanAiInput({ subjectName: "Hindi", periods: "abc" });
  assert.ok(p);
  assert.equal(p.periods, 1);
}

// ─── prompts ───────────────────────────────────────────────────────────

{
  const sys = buildLessonPlanSystemPrompt({ language: "en", schoolName: "BHB" });
  assert.match(sys, /40 minutes/);
  assert.match(sys, /JSON only/);
  assert.match(sys, /do not invent CBSE competency codes/);
  const sysHi = buildLessonPlanSystemPrompt({ language: "hi", schoolName: "BHB" });
  assert.match(sysHi, /Devanagari/);
}

{
  const input = cleanLessonPlanAiInput({
    classLabel: "VI",
    subjectName: "Science",
    periods: 1,
    units: [
      { level: "chapter", code: "Ch 5", title: "Separation of Substances", learningOutcomes: "" },
      { level: "topic", title: "Sieving", learningOutcomes: "Explain sieving\nGive two examples", plannedPeriods: 1 },
    ],
    existing: { activities: "start with kitchen examples" },
    teacherNote: "no lab today",
  })!;
  const user = buildLessonPlanUserPrompt(input);
  assert.match(user, /Class: VI/);
  assert.match(user, /Subject: Science/);
  assert.match(user, /\[chapter\] Ch 5 · Separation of Substances/);
  assert.match(user, /learning outcomes: \(none recorded\)/, "absent outcomes are marked absent");
  assert.match(user, /outcome: Explain sieving/);
  assert.match(user, /\(year plan: 1 periods\)/);
  assert.match(user, /activities: start with kitchen examples/);
  assert.match(user, /Teacher's note: no lab today/);
  assert.doesNotMatch(user, /Teacher has already typed[\s\S]*title:/, "empty existing fields are not echoed");
}

// ─── parseLessonPlanJson ───────────────────────────────────────────────

{
  const d = parseLessonPlanJson(
    JSON.stringify({
      title: "Sieving and filtration",
      objectives: "Explain sieving\r\nGive examples",
      teachingAids: "Sieve, sand, gram",
      activities: "Period 1 — Recap (5 min): …",
      assessment: "Exit ticket",
      homework: "Ex 5.1 Q1–3",
      extra: "ignored",
    }),
  );
  assert.ok(d);
  assert.equal(d.title, "Sieving and filtration");
  assert.equal(d.objectives, "Explain sieving\nGive examples", "CRLF normalised");
  assert.equal((d as unknown as Record<string, unknown>).extra, undefined);
}

{
  assert.equal(parseLessonPlanJson("not json"), null);
  assert.equal(parseLessonPlanJson("[]"), null);
  assert.equal(
    parseLessonPlanJson(JSON.stringify({ title: "x", homework: "y" })),
    null,
    "no objectives and no activities → not a plan",
  );
  const partial = parseLessonPlanJson(JSON.stringify({ objectives: "one" }));
  assert.ok(partial);
  assert.equal(partial.activities, "");
}

// ─── The school's textbooks in the prompt (Propel, not NCERT) ──────────

{
  const listing = "Textbooks: the books this school's Class 8 children use, chapter by chapter — these are the books in the child's school bag.\nMathematics — Propel Middle Mathematics 8: 1. Rational Numbers; 2. Linear Equations in One Variable";
  const plain = buildLessonPlanSystemPrompt({ language: "en", schoolName: "BHB" });
  const grounded = buildLessonPlanSystemPrompt({ language: "en", schoolName: "BHB", textbooks: listing });
  const blank = buildLessonPlanSystemPrompt({ language: "en", schoolName: "BHB", textbooks: "   " });

  assert.match(plain, /since the edition is unknown/, "no list → homework stays generic");
  assert.doesNotMatch(plain, /Textbooks:/);
  assert.equal(blank, plain, "a blank list is no list");

  assert.ok(grounded.endsWith(listing), "the list closes the prompt");
  assert.doesNotMatch(grounded, /edition is unknown/, "with a list the edition is known");
  assert.match(grounded, /Refer to the textbook by book and chapter as listed/);
  assert.match(grounded, /if a ticked unit matches none of the listed chapters, plan it from its title and name no chapter/, "an older edition's unit title is not forced onto a chapter");
  assert.match(grounded, /Never name a book, chapter or chapter number that is not listed/);
  assert.match(grounded, /do not invent CBSE competency codes or textbook page numbers/, "the original guard stays");
  assert.doesNotMatch(grounded.split("Textbooks: the books this school")[0]!, /Ganita|Curiosity|Poorvi|Propel/, "the instructions name no real book — only the list does");
  assert.match(grounded, /the school teaches from its own books, listed at the end/);
  assert.match(grounded, /never an NCERT book/, "the listed books are the school's; NCERT's are never named");

  for (const p of [plain, grounded, buildLessonPlanSystemPrompt({ language: "hi", schoolName: "BHB", textbooks: listing })]) {
    assert.doesNotMatch(p, /CBSE-affiliated/, "the school follows the CBSE pattern; it is not CBSE-affiliated");
    assert.match(p, /following the CBSE pattern and teaching from its own publisher's books, not NCERT textbooks — never name an NCERT book or chapter/, "Classes 1–8 are taught from the school's books (director, 16 Sep 2026)");
    assert.doesNotMatch(p, /school uses the current NCERT books/);
  }
}

// ─── Pre-primary: NCERT's outcomes as a minimum ────────────────────────

{
  const outcomes = "NCERT's minimum for LKG (DIKSHA Preschool 2), from NCERT's pre-primary competency books. The school teaches pre-primary from its own publisher books, which go further than this.\nInvolved Learners: Counts and perceives objects up to five";
  const pp = buildLessonPlanSystemPrompt({ language: "en", schoolName: "BHB", textbooks: outcomes, textbooksKind: "outcomes" });
  assert.ok(pp.endsWith(outcomes));
  assert.match(pp, /Pre-primary: the school teaches from its own publisher books/);
  assert.match(pp, /the minimum a child should reach — not the syllabus and not a ceiling/);
  assert.match(pp, /where the unit goes beyond them, follow the unit/, "a publisher-book unit above the minimum is planned as asked");
  assert.match(pp, /never an outcome code, and never an NCERT book or chapter/);
  assert.match(pp, /short play activity a parent can do with the child at home/, "pre-primary homework is play, not exercises");
  assert.doesNotMatch(pp, /begin the title with the book and chapter/, "no chapter titles for pre-primary");
  assert.doesNotMatch(pp, /questions at the end of <book>/);

  const chapters = buildLessonPlanSystemPrompt({ language: "en", schoolName: "BHB", textbooks: "Textbooks: x\nMathematics — Ganita Prakash: 1. A", textbooksKind: "chapters" });
  const defaultKind = buildLessonPlanSystemPrompt({ language: "en", schoolName: "BHB", textbooks: "Textbooks: x\nMathematics — Ganita Prakash: 1. A" });
  assert.equal(defaultKind, chapters, "chapters are the default kind");
  assert.doesNotMatch(chapters, /Pre-primary:/);
  const noList = buildLessonPlanSystemPrompt({ language: "en", schoolName: "BHB", textbooksKind: "outcomes" });
  assert.equal(noList, buildLessonPlanSystemPrompt({ language: "en", schoolName: "BHB" }), "a kind without a list changes nothing");
}

console.log("OK — lessonPlanAi.selftest.ts");
