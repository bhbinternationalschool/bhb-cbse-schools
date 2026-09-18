/**
 * The revision drill — the loop, and what may be asked of a child.
 * Run: npx tsx src/lib/examDrill.selftest.ts
 */
import assert from "node:assert/strict";
import {
  DRILL_ANSWER_MAX,
  DRILL_NOTE_MAX,
  MAX_QUESTIONS,
  STREAK_TO_FINISH,
  buildCheckPrompt,
  buildQuestionPrompt,
  drillScore,
  newDrill,
  nextDrillStep,
  parseDrillCheck,
  parseDrillQuestion,
  parseScopeAnswer,
  recordAnswer,
  renderCheck,
  renderFinish,
  renderQuestion,
  renderScopeQuestion,
  SCOPE_LIST_MAX,
  type DrillChapter,
  type DrillState,
} from "./examDrill";

console.log("examDrill.selftest.ts");

const chapters: DrillChapter[] = [
  { position: 1, name: "Numbers up to 10,000", topics: ["place value", "comparing numbers"] },
  { position: 2, name: "Addition and Subtraction", topics: ["carrying", "borrowing"] },
  { position: 5, name: "More about Operations on Numbers", topics: ["DMAS", "unitary method"] },
  { position: 6, name: "Multiples and Factors", topics: ["prime and composite"] },
  { position: 9, name: "Decimals", topics: ["tenths and hundredths"] },
];

/* ── Nothing is asked from outside what the class has been taught ── */
const scopeQ = renderScopeQuestion({
  childName: "Aarohi", subjectLabel: "Mathematics", paperLabel: "Mathematics",
  chapters, hindi: false,
});
assert.match(scopeQ, /how far has the class done/i);
assert.match(scopeQ, /5\. More about Operations on Numbers/);
assert.match(scopeQ, /just the number/);
assert.ok(
  renderScopeQuestion({ childName: "A", subjectLabel: "M", paperLabel: "M", hindi: false,
    chapters: Array.from({ length: 30 }, (_, i) => ({ position: i + 1, name: `Ch ${i + 1}`, topics: [] })) })
    .split("\n").filter((l) => /^\d+\. /.test(l)).length <= SCOPE_LIST_MAX,
  "a child does not read twenty chapters at nine at night",
);

assert.equal(parseScopeAnswer("6", 9), 6);
assert.equal(parseScopeAnswer("chapter 6 tak", 9), 6);
assert.equal(parseScopeAnswer("६", 9), 6, "Devanagari digits");
assert.equal(parseScopeAnswer("12", 9), null, "past the end of the book is not an answer");
assert.equal(parseScopeAnswer("0", 9), null);
assert.equal(parseScopeAnswer("dunno", 9), null);

/* ── The loop ─────────────────────────────────────────────────────── */
const s2Base: DrillState = {
  ...newDrill({ studentId: "stu_1", subjectLabel: "Hindi", paperLabel: "Hindi", paperDate: "2026-09-19", nowIso: "2026-09-18T15:00:00Z" }),
  scope: 6,
  phase: "asking",
};

let s: DrillState = newDrill({
  studentId: "stu_1", subjectLabel: "Mathematics", paperLabel: "Mathematics",
  paperDate: "2026-09-19", nowIso: "2026-09-18T15:00:00Z",
});
assert.deepEqual(nextDrillStep(s), { kind: "ask_scope" }, "scope first, always");

s = { ...s, scope: 6, phase: "asking" };
const first = nextDrillStep(s);
assert.equal(first.kind, "ask_question");
if (first.kind === "ask_question") {
  assert.equal(first.number, 1);
  assert.equal(first.retrySkill, null);
}

// A wrong answer sends a NEW question on the SAME idea — repeating the
// identical question teaches recall, not the work.
s = { ...s, asked: [{ question: "What is 12 × 4?", skill: "multiplication", chapterPosition: 2 }] };
s = recordAnswer(s, "wrong");
assert.equal(s.streak, 0);
const retry = nextDrillStep(s);
assert.equal(retry.kind, "ask_question");
if (retry.kind === "ask_question") {
  assert.equal(retry.retrySkill, "multiplication");
  assert.deepEqual(retry.avoid, ["What is 12 × 4?"], "and not the same question again");
}

// "Close" holds the streak: right method, wrong arithmetic is not a loss.
let c: DrillState = { ...s, streak: 2, asked: [{ question: "q", skill: "k", chapterPosition: 1 }] };
c = recordAnswer(c, "close");
assert.equal(c.streak, 2, "a slip does not wipe out two right answers");
c = recordAnswer(c, "right");
assert.equal(c.streak, 3);
assert.deepEqual(nextDrillStep(c), { kind: "finish", reason: "mastered" });

// Three in a row from scratch, and it ends.
let m: DrillState = { ...newDrill({ studentId: "s", subjectLabel: "M", paperLabel: "M", paperDate: "d", nowIso: "n" }), scope: 6, phase: "asking" };
for (let i = 0; i < STREAK_TO_FINISH; i += 1) {
  m = { ...m, asked: [...m.asked, { question: `q${i}`, skill: "k", chapterPosition: 1 }] };
  m = recordAnswer(m, "right");
}
assert.deepEqual(nextDrillStep(m), { kind: "finish", reason: "mastered" });
assert.deepEqual(drillScore(m), { right: 3, asked: 3 });

// A child who cannot get three in a row is not asked a fourteenth question.
let tired: DrillState = { ...newDrill({ studentId: "s", subjectLabel: "M", paperLabel: "M", paperDate: "d", nowIso: "n" }), scope: 6, phase: "asking" };
for (let i = 0; i < MAX_QUESTIONS; i += 1) {
  tired = { ...tired, asked: [...tired.asked, { question: `q${i}`, skill: "k", chapterPosition: 1 }] };
  tired = recordAnswer(tired, i % 2 === 0 ? "wrong" : "right");
}
assert.deepEqual(nextDrillStep(tired), { kind: "finish", reason: "ceiling" });
assert.match(renderFinish({ state: tired, reason: "ceiling", hindi: false }), /enough for tonight/);
assert.match(renderFinish({ state: tired, reason: "ceiling", hindi: false }), /sleep matters more/);
assert.match(renderFinish({ state: m, reason: "mastered", hindi: true }), /शाबाश/);

/* ── What the model may hand back ─────────────────────────────────── */
const qPrompt = buildQuestionPrompt({
  className: "5", subjectLabel: "Mathematics", chapters, scope: 6,
  retrySkill: "unitary method", avoid: ["What is 12 × 4?"], number: 3,
});
assert.match(qPrompt, /5\. More about Operations on Numbers/);
assert.doesNotMatch(qPrompt, /9\. Decimals/, "a chapter past the scope never reaches the prompt");
assert.match(qPrompt, /DIFFERENT and EASIER question on that same idea/);

const good = JSON.stringify({ question: "A pen costs ₹12. What do 5 cost?", skill: "unitary method", chapter: 5 });
assert.deepEqual(parseDrillQuestion(good, 6), {
  question: "A pen costs ₹12. What do 5 cost?", skill: "unitary method", chapter: 5,
});
// The guard that matters: a question the model itself places beyond what the
// child has been taught is refused, not shown with an apology.
assert.equal(parseDrillQuestion(JSON.stringify({ question: "Add 0.5 and 0.25", skill: "decimals", chapter: 9 }), 6), null);
assert.equal(parseDrillQuestion(JSON.stringify({ question: "", skill: "x", chapter: 1 }), 6), null);
assert.equal(parseDrillQuestion("not json", 6), null);

// Measured failures of 18 Sep, now written into the prompt: five viलोम
// questions in a row, and words an eight-year-old has never met.
const varied = buildQuestionPrompt({
  className: "III", subjectLabel: "Hindi", chapters, scope: 6,
  retrySkill: null, avoid: ["q1"], avoidSkills: ["विलोम शब्द", "संज्ञा"], number: 3,
});
assert.match(varied, /Already tested this session: विलोम शब्द, संज्ञा/);
assert.match(varied, /Pick a different idea/);
// A retry names the skill and asks for EASIER, and does not also nag about
// variety — the two instructions would contradict each other.
const retryPrompt = buildQuestionPrompt({
  className: "III", subjectLabel: "Hindi", chapters, scope: 6,
  retrySkill: "विलोम शब्द", avoid: [], avoidSkills: ["विलोम शब्द"], number: 2,
});
assert.match(retryPrompt, /EASIER question on that same idea/);
assert.doesNotMatch(retryPrompt, /Pick a different idea/);
// The step hands the skills up so the prompt can use them.
const afterTwo = nextDrillStep({
  ...s2Base,
  asked: [
    { question: "a", skill: "विलोम शब्द", chapterPosition: 2, verdict: "right" },
    { question: "b", skill: "संज्ञा", chapterPosition: 2, verdict: "right" },
  ],
  streak: 2,
});
assert.equal(afterTwo.kind, "ask_question");
if (afterTwo.kind === "ask_question") {
  assert.deepEqual(afterTwo.avoidSkills, ["विलोम शब्द", "संज्ञा"]);
  assert.equal(afterTwo.retrySkill, null, "after a right answer nothing is being revisited");
}

assert.match(buildCheckPrompt({ className: "5", subjectLabel: "Maths", question: "Q", skill: "k", answer: "60" }), /The child answered:\n60/);

const wrong = parseDrillCheck(JSON.stringify({
  verdict: "wrong", whatWentWrong: "You added instead of multiplying.",
  howToDoIt: "One pen is ₹12, so five pens are 12 × 5.", praise: "",
}));
assert.ok(wrong);
assert.equal(wrong!.verdict, "wrong");
// A wrong answer with nothing said about it is exactly what this module
// exists to prevent, so it is not accepted as a reading at all.
assert.equal(parseDrillCheck(JSON.stringify({ verdict: "wrong", whatWentWrong: "", howToDoIt: "", praise: "" })), null);
assert.equal(parseDrillCheck(JSON.stringify({ verdict: "right", whatWentWrong: "", howToDoIt: "", praise: "Neat working" }))!.verdict, "right");
// Anything the model invents for a verdict is read as wrong, never as right.
assert.equal(parseDrillCheck(JSON.stringify({ verdict: "excellent", whatWentWrong: "x", howToDoIt: "y" }))!.verdict, "wrong");

/* ── What the child reads ─────────────────────────────────────────── */
assert.match(renderQuestion({ number: 2, question: "What is 12 × 5?", hindi: false }), /\*Question 2\*/);
assert.match(renderCheck({ check: { verdict: "right", whatWentWrong: "", howToDoIt: "", praise: "Neat working" }, hindi: false }), /✅ Neat working/);
const shown = renderCheck({ check: wrong!, hindi: false });
assert.match(shown, /You added instead of multiplying/);
assert.match(shown, /💡 One pen is ₹12/);
assert.doesNotMatch(shown, /^❌ Not quite$/m, "never just 'wrong'");

/* ── A session must read back as a lesson, not a scoreboard ───────── */
//
// The verdict alone does not say what a child was taught, or whether the
// marking was fair. "What did it actually say to them?" is the first
// question anyone asks about a drill that upset a child.
let taught: DrillState = {
  ...newDrill({ studentId: "s", subjectLabel: "Hindi", paperLabel: "Hindi", paperDate: "2026-09-19", nowIso: "n" }),
  scope: 6,
  phase: "asking",
  asked: [{ question: "'लड़का' का स्त्रीलिंग?", skill: "लिंग बदलना", chapterPosition: 5 }],
};
taught = recordAnswer(taught, "wrong", {
  answer: "लड़का",
  check: {
    whatWentWrong: "आपने वही शब्द दोबारा लिख दिया।",
    howToDoIt: "'लड़का' का स्त्रीलिंग 'लड़की' होता है — अंत की 'आ' को 'ई' कर दीजिए।",
    praise: "",
  },
});
const recorded = taught.asked[0]!;
assert.equal(recorded.verdict, "wrong");
assert.equal(recorded.answer, "लड़का", "what the child typed is kept");
assert.match(recorded.whatWentWrong!, /वही शब्द/);
assert.match(recorded.howToDoIt!, /लड़की/);

// Long answers are cut rather than carried whole: this sits in a jsonb
// column that grows with every question of every child.
let long: DrillState = { ...taught, asked: [{ question: "q", skill: "k", chapterPosition: 1 }] };
long = recordAnswer(long, "wrong", {
  answer: "क".repeat(DRILL_ANSWER_MAX + 200),
  check: { whatWentWrong: "x".repeat(DRILL_NOTE_MAX + 200), howToDoIt: "y", praise: "" },
});
assert.equal(long.asked[0]!.answer!.length, DRILL_ANSWER_MAX);
assert.equal(long.asked[0]!.whatWentWrong!.length, DRILL_NOTE_MAX);

// A right answer keeps the praise and carries no correction.
let praised: DrillState = { ...taught, asked: [{ question: "q", skill: "k", chapterPosition: 1 }] };
praised = recordAnswer(praised, "right", { answer: "रानी", check: { whatWentWrong: "", howToDoIt: "", praise: "बिलकुल सही" } });
assert.equal(praised.asked[0]!.praise, "बिलकुल सही");
assert.equal(praised.asked[0]!.whatWentWrong, undefined, "nothing empty is stored");

// Recording without detail still works — the older call shape.
let bare: DrillState = { ...taught, asked: [{ question: "q", skill: "k", chapterPosition: 1 }] };
bare = recordAnswer(bare, "right");
assert.equal(bare.asked[0]!.verdict, "right");
assert.equal(bare.asked[0]!.answer, undefined);

console.log("ok");
