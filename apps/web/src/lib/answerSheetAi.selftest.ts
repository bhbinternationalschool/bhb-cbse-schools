import assert from "node:assert/strict";

import type { ExamPaper, ExamPaperQuestion } from "./examPapers";
import {
  answerSheetFactsFromPaper,
  answerSheetOutcome,
  buildAnswerSheetSystemPrompt,
  buildAnswerSheetUserPrompt,
  cleanAnswerSheetSuggestions,
  parseAnswerSheetReply,
  questionHasBasis,
  sumSuggested,
} from "./answerSheetAi";

console.log("answerSheetAi.selftest.ts");

function q(over: Partial<ExamPaperQuestion> & { id: string }): ExamPaperQuestion {
  return {
    type: "short",
    text: "",
    marks: 1,
    options: [],
    answerKey: "",
    formulas: [],
    images: [],
    icons: [],
    hardness: "medium",
    source: "bank",
    competencyCode: "",
    unitId: "",
    bloomLevel: "",
    markingScheme: [],
    pairs: [],
    subQuestions: [],
    attemptAny: 0,
    answerLines: 0,
    optionColumns: 0,
    imageColumns: 1,
    ...over,
  };
}

const paper = {
  id: "ep1",
  paperCode: "EP-1",
  title: "Unit Test 1 Science",
  examName: "UT1",
  sets: [
    {
      id: "set-a",
      setCode: "A",
      label: "Set A",
      source: null,
      answerKey: null,
      sections: [
        {
          id: "s1",
          title: "A",
          instructions: "",
          questions: [
            q({ id: "q1", type: "mcq", text: "Plants make food by", marks: 1, options: ["respiration", "photosynthesis"], answerKey: "photosynthesis" }),
            q({ id: "q2", type: "short", text: "Name two gases in air", marks: 2, answerKey: "Nitrogen, oxygen" }),
            // Importer mis-split: worth nothing, must not be asked about.
            q({ id: "q3", type: "short", text: "passage fragment", marks: 0 }),
          ],
        },
        {
          id: "s2",
          title: "B",
          instructions: "",
          questions: [
            q({ id: "q4", type: "long", text: "Explain the water cycle", marks: 5, markingScheme: ["Evaporation 1", "Condensation 1", "Precipitation 1", "Diagram 2"] }),
            q({ id: "q5", type: "long", text: "Describe your school garden", marks: 3 }),
            q({
              id: "q6",
              type: "mcq",
              text: "Choose the right answer (any two)",
              marks: 2,
              attemptAny: 2,
              subQuestions: [
                { text: "Sun is a", marks: 1, type: "mcq", options: [], pairs: [], answerKey: "star" },
                { text: "Moon is a", marks: 1, type: "mcq", options: [], pairs: [], answerKey: "satellite" },
              ],
            }),
          ],
        },
      ],
    },
  ],
} as unknown as ExamPaper;

const facts = answerSheetFactsFromPaper(paper, "A", { subjectLabel: "Science", classLabel: "VI" });
assert.ok(facts);

// ─── facts ─────────────────────────────────────────────────────────────
{
  assert.deepEqual(facts.questions.map((x) => x.id), ["q1", "q2", "q4", "q5", "q6"], "zero-mark question left out");
  assert.deepEqual(facts.questions.map((x) => x.number), [1, 2, 4, 5, 6], "numbers are the printed positions");
  assert.equal(facts.maxTotal, 13);
  assert.equal(facts.questions[2]!.answerKey, null, "no own key and no parts → null, not empty string");
  assert.match(facts.questions[2]!.modelAnswer ?? "", /Condensation 1/);
  assert.equal(facts.questions[3]!.answerKey, null);
  assert.equal(facts.questions[3]!.modelAnswer, null);
  assert.equal(questionHasBasis(facts.questions[3]!), false);
  assert.match(facts.questions[4]!.answerKey ?? "", /\(i\) star; \(ii\) satellite/, "parts' keys fold into the question's");
  assert.match(facts.questions[4]!.text, /attempt any 2/);
  assert.equal(answerSheetFactsFromPaper(paper, "Z", { subjectLabel: "", classLabel: "" }), null, "unknown set");
}

// ─── prompts ───────────────────────────────────────────────────────────
{
  const sys = buildAnswerSheetSystemPrompt();
  assert.match(sys, /marks MUST be null/);
  const user = buildAnswerSheetUserPrompt(facts);
  assert.match(user, /questionId: q1/);
  assert.match(user, /Answer key: photosynthesis/);
  assert.match(user, /Q5 \(long, max 3\)[\s\S]*Answer key: NONE[\s\S]*marks must be null/);
  assert.ok(!user.includes("passage fragment"));
}

// ─── cleaner ───────────────────────────────────────────────────────────
{
  const r = cleanAnswerSheetSuggestions(
    {
      questions: [
        { questionId: "q1", status: "answered", readAnswer: "photosynthesis", marks: 1, confidence: "high", reason: "Matches key" },
        // Over the max → clamped; 1.7 → half-mark steps.
        { questionId: "q2", status: "answered", readAnswer: "nitrogen oxygen", marks: 7, confidence: "high", reason: "Both named" },
        { questionId: "q4", status: "answered", readAnswer: "water goes up and comes down", marks: "1.7", confidence: "medium", reason: "Partial" },
        // No key, no scheme: the model's 3 must not survive.
        { questionId: "q5", status: "answered", readAnswer: "Our garden has roses", marks: 3, confidence: "high", reason: "Good" },
        // Not on the paper → dropped.
        { questionId: "q99", status: "answered", readAnswer: "x", marks: 5, confidence: "high", reason: "" },
        // Repeat of q1 → first wins.
        { questionId: "q1", status: "answered", readAnswer: "respiration", marks: 0, confidence: "high", reason: "" },
      ],
    },
    facts,
  );
  assert.equal(r.questions.length, 5, "one row per paper question, no more");
  const [a, b, c, d, e] = r.questions;
  assert.deepEqual([a!.suggestedMarks, a!.confidence, a!.needsTeacher], [1, "high", false]);
  assert.equal(a!.readAnswer, "photosynthesis");
  assert.equal(b!.suggestedMarks, 2, "clamped to max");
  assert.equal(b!.confidence, "medium", "a descriptive answer is never 'high'");
  assert.equal(c!.suggestedMarks, 1.5, "half-mark rounding");
  assert.equal(d!.suggestedMarks, null, "no basis → null, not the model's number");
  assert.equal(d!.needsTeacher, true);
  assert.match(d!.reason, /No answer key/);
  assert.equal(e!.suggestedMarks, null, "skipped by the model → unknown, never 0");
  assert.equal(e!.needsTeacher, true);
  assert.equal(r.unknownCount, 2);
  assert.equal(r.totalSuggested, 4.5);
  assert.equal(r.maxTotal, 13);
}
{
  const r = cleanAnswerSheetSuggestions(
    {
      questions: [
        { questionId: "q1", status: "unreadable", readAnswer: "ph..?", marks: 1, confidence: "high" },
        { questionId: "q2", status: "not_found", marks: 0, confidence: "high" },
        { questionId: "q4", status: "blank", marks: 3, confidence: "high", reason: "" },
        { questionId: "q5", status: "blank", marks: null, confidence: "low" },
        { questionId: "q6", status: "answered", readAnswer: "", marks: 2, confidence: "high" },
      ],
    },
    facts,
  );
  const [a, b, c, d, e] = r.questions;
  assert.equal(a!.suggestedMarks, null, "unreadable → null even though the model offered 1");
  assert.match(a!.reason, /Could not read/);
  assert.equal(b!.suggestedMarks, null, "not found → null, never the model's 0");
  assert.match(b!.reason, /missing page/);
  assert.equal(c!.suggestedMarks, 0, "blank → 0, whatever mark the model attached");
  assert.equal(c!.needsTeacher, false);
  assert.equal(d!.suggestedMarks, 0, "blank holds without a key");
  assert.equal(d!.needsTeacher, true, "…but an unsure blank is the teacher's");
  assert.equal(e!.suggestedMarks, null, "'answered' with nothing read is unreadable");
  assert.equal(r.unknownCount, 3);
}
{
  const r = cleanAnswerSheetSuggestions(
    { questions: [{ questionId: "q1", status: "answered", readAnswer: "photosynthesis", marks: -2, confidence: "weird" }] },
    facts,
  );
  assert.equal(r.questions[0]!.suggestedMarks, 0, "negative clamps to 0");
  assert.equal(r.questions[0]!.confidence, "low", "unknown confidence → low");
  assert.equal(r.questions[0]!.needsTeacher, true);
  assert.equal(cleanAnswerSheetSuggestions(null, facts).unknownCount, 5, "garbage → every question unknown");
}

// ─── parser ────────────────────────────────────────────────────────────
{
  assert.equal(parseAnswerSheetReply("not json", facts), null);
  assert.equal(parseAnswerSheetReply('{"total": 5}', facts), null, "no questions array → failed call, not an empty sheet");
  const fenced = parseAnswerSheetReply(
    '```json\n{"questions":[{"questionId":"q1","status":"answered","readAnswer":"photosynthesis","marks":1,"confidence":"high","reason":"ok"}]}\n```',
    facts,
  );
  assert.ok(fenced);
  assert.equal(fenced.questions[0]!.suggestedMarks, 1);
  const bare = parseAnswerSheetReply('[{"questionId":"q1","status":"blank","confidence":"high"}]', facts);
  assert.ok(bare);
  assert.equal(bare.questions[0]!.suggestedMarks, 0);
}

// ─── outcome + totals ──────────────────────────────────────────────────
{
  const rows = [
    { questionId: "q1", suggestedMarks: 1, needsTeacher: false },
    { questionId: "q5", suggestedMarks: null, needsTeacher: true },
    { questionId: "q2", suggestedMarks: 1, needsTeacher: true },
  ];
  assert.equal(answerSheetOutcome(rows, new Map([["q1", 1], ["q5", null], ["q2", null]])), "accepted");
  assert.equal(answerSheetOutcome(rows, new Map([["q1", 1], ["q5", 2], ["q2", null]])), "edited", "filling a blank is an edit");
  assert.equal(answerSheetOutcome(rows, new Map([["q1", 0.5], ["q5", null], ["q2", null]])), "edited");
  assert.equal(sumSuggested([{ suggestedMarks: 1.5 }, { suggestedMarks: null }, { suggestedMarks: 2 }]), 3.5);
}

console.log("  ok");
