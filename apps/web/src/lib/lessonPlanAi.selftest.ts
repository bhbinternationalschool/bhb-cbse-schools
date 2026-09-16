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

// ─── NCERT textbooks in the prompt ─────────────────────────────────────

{
  const listing = "Textbooks: the current NCERT books for Class 8, as listed on DIKSHA, the government's school platform.\nMathematics — Ganita Prakash (Hindi-medium edition: Ganita Prakash (Hindi)): 1. A SQUARE AND A CUBE; 2. POWER PLAY";
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
  assert.doesNotMatch(grounded.split("Textbooks: the current")[0]!, /Ganita|Curiosity|Poorvi/, "the instructions name no real book — only the list does");

  for (const p of [plain, grounded, buildLessonPlanSystemPrompt({ language: "hi", schoolName: "BHB", textbooks: listing })]) {
    assert.doesNotMatch(p, /CBSE-affiliated/, "the school follows the CBSE pattern; it is not CBSE-affiliated");
    assert.match(p, /following the CBSE pattern and NCERT textbooks/);
  }
}

console.log("OK — lessonPlanAi.selftest.ts");
