/**
 * Run: npx tsx src/lib/examPaperQuestionTypes.selftest.ts
 *
 * Pins what each question type carries on a paper (lib/examPapers.ts):
 * - choosing a type fills in the structure it needs (MCQ options, the four
 *   Assertion–Reason choices, True/False key, match pairs, case-study
 *   sub-questions, ruled answer lines) without touching existing content;
 * - a question with sub-questions is worth their sum;
 * - Column B of a match question prints shuffled, the same way every time
 *   for the same paper, never in the answer order, and the teacher key
 *   names the printed letters;
 * - pairs and sub-questions survive normalisation (save, bank, hydrate).
 */
import assert from "node:assert/strict";

import {
  ASSERTION_REASON_OPTIONS,
  autoOptionColumns,
  defaultsForType,
  emptyQuestion,
  emptySubQuestion,
  matchAnswerKey,
  normalizeExamPapersState,
  questionTotalMarks,
  shuffledMatchRights,
} from "./examPapers";

console.log("examPaperQuestionTypes.selftest.ts");

{
  const blank = emptyQuestion({ text: "" });
  assert.deepEqual(defaultsForType("mcq", blank).options, ["", "", "", ""]);
  assert.deepEqual(defaultsForType("assertion_reason", blank).options, ASSERTION_REASON_OPTIONS);
  assert.equal(defaultsForType("true_false", blank).answerKey, "True");
  assert.equal(defaultsForType("match", blank).pairs?.length, 4);
  assert.equal(defaultsForType("case_study", blank).subQuestions?.length, 3);
  assert.equal(defaultsForType("short", blank).answerLines, 3);
  assert.equal(defaultsForType("long", blank).answerLines, 8);
  assert.equal(defaultsForType("mcq", blank).answerLines, undefined, "objective items get no ruled lines");

  const typed = emptyQuestion({ text: "Water boils at", options: ["a", "b", "c"], answerLines: 2 });
  const asMcq = defaultsForType("mcq", typed);
  assert.equal(asMcq.options, undefined, "existing options are kept");
  assert.equal(asMcq.answerLines, undefined, "a chosen line count is kept");
  const asAr = defaultsForType("assertion_reason", typed);
  assert.ok(asAr.text?.startsWith("Assertion (A): Water boils at"), "existing text becomes the assertion");
  const asFill = defaultsForType("fill", typed);
  assert.equal(asFill.text, "Water boils at ___", "a blank is appended when none exists");

  // Structure the new type does not use is dropped on the switch.
  const caseQ = emptyQuestion({ type: "case_study", subQuestions: [{ text: "a", marks: 2 }] as never, pairs: [{ left: "x", right: "y" }], options: ["p", "q"] });
  const toLong = defaultsForType("long", caseQ);
  assert.deepEqual(toLong.subQuestions, [], "sub-questions go when leaving case study");
  assert.deepEqual(toLong.pairs, []);
  assert.deepEqual(toLong.options, []);
  assert.equal(defaultsForType("competency", caseQ).subQuestions, undefined, "…but competency keeps them");
  const toFill = defaultsForType("fill", caseQ);
  assert.equal(toFill.options, undefined, "fill keeps options as its word bank");
}

{
  const q = emptyQuestion({ marks: 1, subQuestions: [{ text: "a", marks: 1 }, { text: "b", marks: 2 }, { text: "c", marks: 1.5 }] as never });
  assert.equal(questionTotalMarks(q), 4.5, "sub-questions set the total");
  assert.equal(questionTotalMarks(emptyQuestion({ marks: 3 })), 3);
  assert.equal(questionTotalMarks({ ...q, attemptAny: 2 }), 3.5, "attempt any 2 → the two largest");
  assert.equal(questionTotalMarks({ ...q, attemptAny: 9 }), 4.5, "attempt-any beyond the count means all");

  // Parts carry their own type, options and key; a fresh MCQ part comes with four options.
  const mcqPart = emptySubQuestion("mcq", 1);
  assert.equal(mcqPart.options.length, 4);
  const tf = emptySubQuestion("true_false");
  assert.equal(tf.answerKey, "True");
  assert.equal(emptySubQuestion("match" as never).type, "short", "a type that does not fit a part falls back to short");
  const typed = emptyQuestion({
    subQuestions: [
      { text: " Capital of India? ", marks: 1, type: "mcq", options: ["Delhi", "Mumbai"], answerKey: "Delhi" },
      { text: "x", marks: 1, type: "diagram", options: ["p"], answerKey: "" },
    ] as never,
  });
  assert.equal(typed.subQuestions[0]!.type, "mcq");
  assert.deepEqual(typed.subQuestions[0]!.options, ["Delhi", "Mumbai"]);
  assert.equal(typed.subQuestions[0]!.answerKey, "Delhi");
  assert.equal(typed.subQuestions[1]!.type, "short", "an unsupported part type becomes short");
}

{
  const pairs = [
    { left: "Delhi", right: "India" },
    { left: "Paris", right: "France" },
    { left: "Tokyo", right: "Japan" },
    { left: "Cairo", right: "Egypt" },
  ];
  const a = shuffledMatchRights(pairs, "paper1:A:q1");
  const b = shuffledMatchRights(pairs, "paper1:A:q1");
  assert.deepEqual(a, b, "the same paper prints the same order every time");
  assert.deepEqual([...a].sort(), pairs.map((p) => p.right).sort(), "nothing is lost or invented");
  assert.notDeepEqual(a, pairs.map((p) => p.right), "never the answer order");
  const key = matchAnswerKey(pairs, a);
  assert.match(key, /^1-[a-d], 2-[a-d], 3-[a-d], 4-[a-d]$/);
  for (const [i, p] of pairs.entries()) {
    const letter = key.split(", ")[i]!.split("-")[1]!;
    assert.equal(a[letter.charCodeAt(0) - 97], p.right, "each key letter points at the right printed item");
  }
  const two = shuffledMatchRights(pairs.slice(0, 2), "x");
  assert.notDeepEqual(two, ["India", "France"], "even two items are not left in answer order");
}

{
  const state = normalizeExamPapersState({
    version: 1,
    papers: [],
    blueprints: [],
    bank: [
      {
        id: "b1",
        classId: "c",
        subjectId: "s",
        tags: [],
        addedBy: "",
        addedAt: "",
        usedCount: 0,
        lastUsedAt: "",
        question: {
          id: "q1",
          type: "match",
          text: "Match",
          marks: 4,
          pairs: [{ left: " A ", right: " 1 " }, { left: "", right: "" }],
          subQuestions: [{ text: " sub ", marks: "2" }, { text: "", marks: 1 }],
          answerLines: "99",
        },
      },
    ],
  } as never);
  const q = state.bank[0]!.question;
  assert.deepEqual(q.pairs, [{ left: "A", right: "1" }], "pairs are trimmed and empty rows dropped");
  assert.deepEqual(q.subQuestions, [{ text: "sub", marks: 2, type: "short", options: [], answerKey: "" }], "sub-questions likewise, marks numeric, short by default");
  assert.equal(q.answerLines, 40, "answer lines are capped");
}

{
  assert.equal(autoOptionColumns(["4", "8", "16", "32"]), 5, "one-word options sit five to a line");
  assert.equal(autoOptionColumns(["Delhi", "Mumbai", "Chennai", "Kolkata"]), 4);
  assert.equal(autoOptionColumns(["Photosynthesis", "Respiration", "Transpiration", "Digestion"]), 3);
  assert.equal(autoOptionColumns(["Both A and R are true", "A is true but R is false"]), 2);
  assert.equal(autoOptionColumns(["Both A and R are true and R is the correct explanation of A"]), 1, "a sentence gets its own line");
  assert.equal(emptyQuestion({}).optionColumns, 0, "auto by default");
  assert.equal(emptyQuestion({ optionColumns: 7 as never }).optionColumns, 0, "out-of-range falls back to auto");
  assert.equal(emptyQuestion({ imageColumns: 3 }).imageColumns, 3);
  assert.equal(emptyQuestion({ imageColumns: 9 as never }).imageColumns, 1);
}

{
  const state = normalizeExamPapersState({
    version: 1, papers: [], blueprints: [],
    bank: [{ id: "b2", classId: "c", subjectId: "s", tags: [], addedBy: "", addedAt: "", usedCount: 0, lastUsedAt: "",
      question: { id: "q2", type: "diagram", text: "Label", marks: 2,
        images: [{ id: "i1", dataUrl: "data:image/png;base64,AAAA", caption: "", labels: [{ n: 1, x: 0.5, y: 0.25, lx: 1.7, ly: -0.2 }, { x: "0.1", y: "0.9", lx: 0.95, ly: 0.9 }] }] } }],
  } as never);
  const labels = state.bank[0]!.question.images[0]!.labels;
  assert.equal(labels.length, 2);
  assert.deepEqual(labels[0], { n: 1, x: 0.5, y: 0.25, lx: 1, ly: 0 }, "positions are clamped to the picture");
  assert.deepEqual(labels[1], { n: 2, x: 0.1, y: 0.9, lx: 0.95, ly: 0.9 }, "a missing number is filled from its position");
}

console.log("OK — examPaperQuestionTypes.selftest.ts");
