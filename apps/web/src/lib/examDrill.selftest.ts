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
  DRILL_CHECK_SYSTEM,
  DRILL_QUESTION_SYSTEM,
  paperLanguageFor,
  renderChapterVideos,
  renderAside,
  renderAsideFailed,
  renderTopicVideo,
  subjectNameForModel,
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
  classifyDrillReply,
  looksLikeOwnQuestion,
  readScopeAnswer,
  drillIsForAPastPaper,
  isAnotherRoundInvite,
  looksLikeKeyboardMash,
} from "./examDrill";
import { isPracticeTap, PRACTICE_BUTTON_EN, PRACTICE_BUTTON_HI } from "./examEve";

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
  chapters, hindi: false, isToday: false,
});
assert.match(scopeQ, /how far has the class done/i);
assert.match(scopeQ, /5\. More about Operations on Numbers/);
assert.match(scopeQ, /just the number/);
assert.ok(
  renderScopeQuestion({ childName: "A", subjectLabel: "M", paperLabel: "M", hindi: false, isToday: false,
    chapters: Array.from({ length: 30 }, (_, i) => ({ position: i + 1, name: `Ch ${i + 1}`, topics: [] })) })
    .split("\n").filter((l) => /^\d+\. /.test(l)).length <= SCOPE_LIST_MAX,
  "a child does not read twenty chapters at nine at night",
);

// 24 Sep 2026, 8:37 IST: MR. AMIT KUMAR MISHRA tapped *अभ्यास शुरू करें*
// seven minutes after NUTAN's Maths paper had begun — a paper still "to
// come" until 9 (papersFromDate) — and the drill opened with
// "📚 NUTAN, कल *गणित* है।" Maths was that morning, not tomorrow.
assert.match(
  renderScopeQuestion({ childName: "NUTAN", subjectLabel: "गणित", paperLabel: "गणित", chapters, hindi: true, isToday: true }),
  /^📚 NUTAN, आज \*गणित\* है।/,
  "a paper that starts this morning is today",
);
assert.match(
  renderScopeQuestion({ childName: "NUTAN", subjectLabel: "गणित", paperLabel: "गणित", chapters, hindi: true, isToday: false }),
  /^📚 NUTAN, कल \*गणित\* है।/,
  "and the evening tap is still tomorrow",
);
assert.match(
  renderScopeQuestion({ childName: "Aarohi", subjectLabel: "Mathematics", paperLabel: "Mathematics", chapters, hindi: false, isToday: true }),
  /^📚 Aarohi, today is \*Mathematics\*\./,
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
  // Nothing was set from an agreed idea, so there is no prerequisite to walk.
  assert.equal(retry.retryComponentId, null);
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
  // No agreed menu was given, so nothing can be attributed to one.
  skillRef: 0,
});

// skillRef is checked against the menu the prompt ACTUALLY listed. A number
// past its end is read as 0: the id it would resolve to is what a later wrong
// answer walks back from, and the wrong idea taught there is worse than none.
{
  const withRef = (ref: unknown) =>
    JSON.stringify({ question: "A pen costs ₹12. What do 5 cost?", skill: "unitary method", chapter: 5, skillRef: ref });
  assert.equal(parseDrillQuestion(withRef(2), 6, 4)!.skillRef, 2);
  assert.equal(parseDrillQuestion(withRef(9), 6, 4)!.skillRef, 0, "past the end of the menu");
  assert.equal(parseDrillQuestion(withRef(2), 6)!.skillRef, 0, "no menu means no reference");
  assert.equal(parseDrillQuestion(withRef("two"), 6, 4)!.skillRef, 0);
  assert.equal(parseDrillQuestion(withRef(1.5), 6, 4)!.skillRef, 0);
}
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

// The agreed menu and the prerequisite hint (lib/drillSkills.ts) are optional
// parts of this same prompt: absent for every drill that has none, and the
// prompt is then byte-for-byte the one above.
{
  const plain = buildQuestionPrompt({
    className: "III", subjectLabel: "Hindi", chapters, scope: 6, retrySkill: null, avoid: [], number: 1,
  });
  assert.doesNotMatch(plain, /agreed are worth testing/, "no menu, no mention of one");

  const withMenu = buildQuestionPrompt({
    className: "V", subjectLabel: "Mathematics", chapters, scope: 6, retrySkill: null, avoid: [],
    avoidSkills: ["unitary method"], number: 3,
    skillMenu: "Ideas ...\n  [1] (chapter 2) Fluently add within 100",
    avoidRefs: [1],
  });
  assert.match(withMenu, /\[1\] \(chapter 2\) Fluently add within 100/);
  assert.match(withMenu, /Ideas already used from the list above: \[1\]/);

  // The hint about what is missing underneath belongs to a retry and only to
  // a retry: on a question they got right it would read as a correction.
  const withFoundation = buildQuestionPrompt({
    className: "V", subjectLabel: "Mathematics", chapters, scope: 6,
    retrySkill: "unitary method", avoid: [], number: 2,
    retryFoundation: "What usually sits underneath that idea: multiply within 100.",
  });
  assert.match(withFoundation, /sits underneath that idea/);
  const notARetry = buildQuestionPrompt({
    className: "V", subjectLabel: "Mathematics", chapters, scope: 6,
    retrySkill: null, avoid: [], number: 2,
    retryFoundation: "What usually sits underneath that idea: multiply within 100.",
  });
  assert.doesNotMatch(notARetry, /sits underneath/, "nothing was got wrong, so nothing is underneath it");
}
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
  assert.deepEqual(afterTwo.askedComponentIds, [], "and none of them came off an agreed menu");
}

// An agreed micro-skill is carried as a stored id, not as a sentence.
{
  const asked = nextDrillStep({
    ...s2Base,
    asked: [
      { question: "a", skill: "unitary method", componentId: "c-1", chapterPosition: 2, verdict: "right" },
      { question: "b", skill: "value of one", componentId: "c-1", chapterPosition: 2, verdict: "right" },
      { question: "c", skill: "place value", componentId: "c-2", chapterPosition: 3, verdict: "right" },
    ],
    streak: 2,
  });
  assert.equal(asked.kind, "ask_question");
  if (asked.kind === "ask_question") {
    // THE BUG THIS EXISTS FOR: one idea under two names is two entries in
    // avoidSkills and one id here, so "already tested" finally means it.
    assert.equal(asked.avoidSkills.length, 3);
    assert.deepEqual(asked.askedComponentIds, ["c-1", "c-2"]);
  }

  // A wrong answer on a question set from an agreed idea hands up the way
  // into its prerequisites.
  const wrong = nextDrillStep({
    ...s2Base,
    asked: [{ question: "a", skill: "unitary method", componentId: "c-1", chapterPosition: 2, verdict: "wrong" }],
    streak: 0,
  });
  assert.equal(wrong.kind, "ask_question");
  if (wrong.kind === "ask_question") assert.equal(wrong.retryComponentId, "c-1");

  // And a right answer does not, whatever it was set from.
  const right = nextDrillStep({
    ...s2Base,
    asked: [{ question: "a", skill: "unitary method", componentId: "c-1", chapterPosition: 2, verdict: "right" }],
    streak: 1,
  });
  if (right.kind === "ask_question") assert.equal(right.retryComponentId, null);
}

assert.match(buildCheckPrompt({ className: "5", subjectLabel: "Maths", question: "Q", skill: "k", answer: "60" }), /The child answered:\n60/);

/* ── English medium: the paper decides the language (21 Sep 2026) ── */
{
  // The drill was handed "विज्ञान" and a Hindi family, set a Science question
  // in Hindi and told the child to write the exam answer in Hindi.
  for (const label of ["विज्ञान", "Science", "गणित", "Mathematics", "सामाजिक विज्ञान", "पर्यावरण अध्ययन", "अंग्रेज़ी", "English", "G.K."]) {
    assert.equal(paperLanguageFor(label), "english", `${label} is written in English`);
  }
  assert.equal(paperLanguageFor("हिंदी"), "hindi");
  assert.equal(paperLanguageFor("Hindi"), "hindi");
  assert.equal(paperLanguageFor("संस्कृत"), "sanskrit");
  assert.equal(subjectNameForModel("विज्ञान"), "Science", "the model is told the English name, never the Hindi display one");

  const sci = buildQuestionPrompt({ className: "VII", subjectLabel: "विज्ञान", chapters, scope: 6, retrySkill: null, avoid: [], number: 1 });
  assert.match(sci, /Subject: Science/);
  assert.match(sci, /Paper language: ENGLISH/);
  assert.match(sci, /NEVER tell the child to write anything in Hindi/);
  assert.ok(!/Subject: विज्ञान/.test(sci));
  const hin = buildQuestionPrompt({ className: "VII", subjectLabel: "हिंदी", chapters, scope: 6, retrySkill: null, avoid: [], number: 1 });
  assert.match(hin, /Paper language: HINDI/);

  // Marking follows the paper, not the phone: an English paper is marked in
  // English with Hindi alongside, for a Hindi family too.
  const english = { className: "6", subjectLabel: "अंग्रेज़ी", question: "Which word is the adjective: The tall boy won the race?", skill: "adjectives", answer: "Won" };
  assert.match(buildCheckPrompt({ ...english, hindi: true }), /Paper language: ENGLISH/);
  assert.match(buildCheckPrompt({ ...english, subjectLabel: "हिंदी", hindi: false }), /Paper language: HINDI/);
  assert.match(DRILL_CHECK_SYSTEM, /NEVER tell the child to write in Hindi/);
  // 23 Sep 2026: ARNAV (VII) wrote "8,6,5,3,1" for the largest 5-digit
  // number from 3,8,1,6,5 — 86531, right — and was marked 🟡 "You separated
  // the digits with commas". His next two were right and marked the same.
  assert.match(DRILL_CHECK_SYSTEM, /HOW A NUMBER IS PUNCTUATED IS NOT THE ANSWER/);
  assert.match(DRILL_CHECK_SYSTEM, /8,6,5,3,1 are the SAME number/);
  assert.match(DRILL_CHECK_SYSTEM, /'you used commas' is NEVER whatWentWrong/);
  // …but a question that is itself about comma placement still marks them:
  // "Large Numbers around Us" teaches exactly that.
  assert.match(DRILL_CHECK_SYSTEM, /ITSELF about writing a number with commas/);
  assert.match(DRILL_CHECK_SYSTEM, /quoted FROM the question or FROM the child's answer stay exactly as they are/);
  assert.ok(!/asking them to write it in Hindi in the exam/.test(DRILL_CHECK_SYSTEM), "the line behind 'write in Hindi' is gone");
  assert.ok(!/An English paper is still explained to a Hindi family in Hindi/.test(DRILL_CHECK_SYSTEM));
  assert.match(DRILL_QUESTION_SYSTEM, /ENGLISH MEDIUM/);

  // Both languages reach the child, English first.
  const q = parseDrillQuestion(JSON.stringify({ question: "What colour does blue litmus turn in an acid?", questionHi: "अम्ल में नीला लिटमस किस रंग का हो जाता है?", skill: "litmus test", chapter: 2 }), 6)!;
  const shownQ = renderQuestion({ number: 1, question: q.question, questionHi: q.questionHi, hindi: true });
  assert.ok(shownQ.indexOf("What colour") < shownQ.indexOf("अम्ल में"), shownQ);
  assert.match(shownQ, /Question 1 \/ प्रश्न 1/);
  const c = parseDrillCheck(JSON.stringify({ verdict: "wrong", whatWentWrong: "Blue litmus turns red in an acid, not blue.", howToDoIt: "Acids turn blue litmus red.", praise: "", whatWentWrongHi: "अम्ल में नीला लिटमस लाल हो जाता है।", howToDoItHi: "अम्ल नीले लिटमस को लाल कर देता है।", praiseHi: "" }))!;
  const shownC = renderCheck({ check: c, hindi: true });
  assert.match(shownC, /Blue litmus turns red[\s\S]*अम्ल में नीला/);
  assert.match(shownC, /Acids turn blue litmus red\.\nअम्ल नीले/);
}

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

/* ── 21 Sep 2026: what tonight's families actually wrote ─────────── */
{
  assert.equal(classifyDrillReply("Nhi malum"), "help", "'don't know' is a request for teaching, not 'method right, one slip'");
  assert.equal(classifyDrillReply("pta nhi"), "help");
  assert.equal(classifyDrillReply("Hello sir online registration"), "school", "a message to the school is never marked");
  assert.equal(classifyDrillReply("फीस कब जमा करनी है"), "school");
  for (const answer of ["means of transport", "by bus", "Vah", "Kitab", "leaves", "प्रवेश"]) {
    assert.notEqual(classifyDrillReply(answer), "school", `an answer, not school business: ${answer}`);
  }
  assert.equal(subjectNameForModel("सामाजिक विज्ञान"), "Social Science", "SST is not the Science book");
  assert.equal(paperLanguageFor("सामाजिक विज्ञान"), "english");
}

/* ── 23 Sep 2026: asking for the answer, in English ───────────────── */
{
  // RUDRA (VII), 19:45 IST, asked for the third angle of a triangle. He
  // wrote "Plz answer" and was told his method was right — about a method
  // he had never shown. "Ans que" (18 Sep) is the same ask.
  for (const asked of [
    "Plz answer",
    "Please answer",
    "answer plz",
    "Tell me the answer",
    "Give me the answer",
    "What is the answer",
    "Ans que",
    "pls solve",
  ]) {
    assert.equal(classifyDrillReply(asked), "help", `a request for the answer, not an attempt: ${asked}`);
  }
  // …and the ask is TEACHING, never "your method was right, one slip".
  const taught = renderCheck({
    check: { verdict: "close", whatWentWrong: "", howToDoIt: "The three angles add to 180°, so 180 − 110 = 70°.", praise: "" },
    hindi: true,
    askedForHelp: true,
  });
  assert.doesNotMatch(taught, /तरीका सही है/, "never credit a method that was never shown");
  assert.match(taught, /कोई बात नहीं/);
  assert.match(taught, /180/, "and the answer is actually taught");

  // The other side of the line: these are ATTEMPTS and must still be marked.
  // MR. VINOD KUMAR GUPTA sent the first of these the same evening.
  for (const attempt of ["0,2,3,5,8 answer", "852", "Red", "Zebra crossing", "answer 70", "Yes"]) {
    assert.equal(classifyDrillReply(attempt), "answer", `an attempt, not a request: ${attempt}`);
  }
}

/* ── Anything asked mid-question is answered, never marked (21 Sep) ─ */
{
  const off = parseDrillCheck(JSON.stringify({ notAnAnswer: true, verdict: "", whatWentWrong: "", howToDoIt: "", praise: "" }));
  assert.ok(off && off.notAnAnswer, "the marker's 'not an answer' survives parsing, though every field is empty");
  assert.match(DRILL_CHECK_SYSTEM, /ATTEMPT at this question at all/);
  const a = renderAside({ answer: "The capital of India is New Delhi.", question: "What is 3 × 4?", questionHi: "3 × 4 कितना होता है?", number: 2, hindi: true });
  assert.ok(a.startsWith("The capital of India"), "the answer comes first");
  assert.match(a, /now back to the practice \/ अब वापस अभ्यास पर/);
  assert.match(a, /3 × 4 कितना होता है/, "and the pending question is put back, in both languages");
  assert.ok(!/शिक्षक से|ask your teacher/i.test(renderAsideFailed(true) + renderAsideFailed(false)), "never 'ask your teacher tomorrow'");
}

/* ── 23 Sep 2026: the aside's Markdown reached the phone ──────────── */
{
  // MR. VIKAL KUMAR GUPTA typed "Jayash" mid-practice at 21:27 IST and
  // SHREYASH (Grade 1) was sent this, asterisks and all. The standalone
  // tutor already converted its reply (waTutorBot.server.ts); the aside,
  // which is the same model writing to the same family, did not.
  const real = [
    "English",
    "",
    "If you meant **Joystick**, here is a quick lesson for Shreyash!",
    "",
    "In **Click Code Connect Grade 1**, **Chapter 2: Parts of a Computer**, we learn about extra devices connected to a computer.",
    "",
    "**What it is:** A joystick is a device with a lever or stick that moves in different directions.",
    "",
    "***",
    "",
    "### हिंदी",
  ].join("\n");
  const a = renderAside({ answer: real, question: "Does a computer run on electricity? Write Yes or No.", questionHi: "क्या कंप्यूटर बिजली (electricity) से चलता है?", number: 10, hindi: true });
  assert.ok(!a.includes("**"), "no double asterisk reaches the phone");
  assert.ok(!/^\s*\*\*\*\s*$/m.test(a), "no rule line either");
  assert.ok(!a.includes("###"), "no hash heading either");
  // Converted, not stripped: the emphasis is the point of the lesson.
  assert.ok(a.includes("*Joystick*"), "bold survives as WhatsApp bold");
  assert.ok(a.includes("*Click Code Connect Grade 1*"), "the book's name too");
  assert.ok(a.includes("*What it is:*"), "a bold run opening a line");
  assert.ok(a.includes("*हिंदी*"), "the heading becomes a bold line, not a lost one");
  // The pending question is still put back underneath, untouched.
  assert.match(a, /now back to the practice \/ अब वापस अभ्यास पर/);
  assert.match(a, /क्या कंप्यूटर बिजली \(electricity\) से चलता है/);
  // A reply with no Markdown in it is still passed through unchanged: an
  // aside is full of maths and an eaten multiplication sign is a wrong sum.
  const plain = renderAside({ answer: "4 * 5 = 20, so five pens cost ₹20.", question: "What is 12 × 5?", number: 3, hindi: false });
  assert.ok(plain.startsWith("4 * 5 = 20, so five pens cost ₹20."), plain);
}

/* ── Videos: the missed idea, and every chapter of the portion ─────── */
{
  assert.equal(renderTopicVideo(null, true), "", "no video found: no made-up link");
  const one = renderTopicVideo({ title: "Acids and bases", url: "https://diksha.gov.in/play/content/do_1" }, true);
  assert.match(one, /📺 .*Acids and bases/);
  assert.match(one, /https:\/\/diksha\.gov\.in\/play\/content\/do_1/);
  const all = renderChapterVideos(
    [
      { chapter: "Nutrition in Plants", video: { title: "a", url: "https://youtu.be/x1" } },
      { chapter: "Acids, Bases and Salts", video: null },
      { chapter: "Physical and Chemical Changes", video: { title: "c", url: "https://youtu.be/x3" } },
    ],
    false,
    "https://www.youtube.com/results?search_query=x",
  );
  assert.match(all, /Revise every chapter/);
  assert.match(all, /• Nutrition in Plants: https:\/\/youtu\.be\/x1/);
  assert.ok(!all.includes("Acids, Bases"), "a chapter with no video is not listed with a blank link");
  assert.match(renderChapterVideos([{ chapter: "x", video: null }], false, "https://s"), /Chapter videos: https:\/\/s/, "nothing found: the search page instead");
}

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

/* ── the scope answer: a name is an answer too (19 Sep 2026) ────────── */
{
  const hindiChapters = [
    { position: 1, name: "कोशिश करने वालों की हार नहीं होती", topics: [] },
    { position: 2, name: "यह मेरा, यह मीत का", topics: [] },
    { position: 3, name: "मेरी सोनचिरैया", topics: [] },
    { position: 4, name: "माँ, मुझे अपने आँचल में", topics: [] },
    { position: 5, name: "ईमानदार बालक", topics: [] },
    { position: 6, name: "सूरज और चाँद", topics: [] },
  ];

  // The number still wins — it is what the message asks for.
  assert.deepEqual(readScopeAnswer("5", hindiChapters), { kind: "position", position: 5 });
  assert.deepEqual(readScopeAnswer("६", hindiChapters), { kind: "position", position: 6 });

  // The actual message that stalled nine drills: the chapter's name, typed
  // in Latin letters because that is the keyboard the family has.
  assert.deepEqual(
    readScopeAnswer("Imandar balak", hindiChapters),
    { kind: "position", position: 5 },
    "a chapter read back by name is an answer",
  );
  // The same name in its own script, and with noise around it.
  assert.deepEqual(readScopeAnswer("ईमानदार बालक", hindiChapters), { kind: "position", position: 5 });
  assert.deepEqual(readScopeAnswer("imandar balak tak padha hai", hindiChapters), {
    kind: "position",
    position: 5,
  });
  // A title of short words is still a title read back.
  assert.deepEqual(readScopeAnswer("yah mera yah meet ka", hindiChapters), {
    kind: "position",
    position: 2,
  });
  // Half a name is enough when only one chapter can be meant.
  assert.deepEqual(readScopeAnswer("sonchiraiya", hindiChapters), { kind: "position", position: 3 });
  // "All of it" is the last chapter, in either language.
  assert.deepEqual(readScopeAnswer("पूरा", hindiChapters), { kind: "position", position: 6 });
  assert.deepEqual(readScopeAnswer("all", hindiChapters), { kind: "position", position: 6 });

  // What must still be refused: nothing to go on, and a chapter past the end.
  assert.equal(readScopeAnswer("", hindiChapters).kind, "unclear");
  assert.equal(readScopeAnswer("हाँ", hindiChapters).kind, "unclear");
  assert.equal(readScopeAnswer("12", hindiChapters).kind, "unclear", "past the end of the book");
  // Guessing between two chapters would set questions from the wrong one.
  const twins = [
    { position: 1, name: "पानी की कहानी", topics: [] },
    { position: 2, name: "पानी की कहानी", topics: [] },
  ];
  assert.equal(readScopeAnswer("pani ki kahani", twins).kind, "unclear", "a tie is not a reading");
}

/* ── asking is not answering, and good night is not a wrong answer ──── */
{
  for (const t of ["Lekin kaise", "कैसे करें", "samajh nahi aaya", "पता नहीं", "I don't know", "batao", "help", ""]) {
    assert.equal(classifyDrillReply(t), "help", t || "(blank)");
  }
  for (const t of ["Sorry 😔 bye bye", "bye", "bas", "अब नहीं", "so raha hoon", "good night", "कल करेंगे"]) {
    assert.equal(classifyDrillReply(t), "stop", t);
  }
  // Real answers must not be mistaken for either.
  for (const t of ["चित्रकार", "Darji", "कुम्हार", "42", "कि", "सैनिक"]) {
    assert.equal(classifyDrillReply(t), "answer", t);
  }
}

/* ── a child's own question is answered, not marked wrong ───────────── */
//
// 19 Sep 2026, the director: a child who asks something from their own
// syllabus in the middle of the drill must get a real answer. Before this
// the question was marked against the drill's question and they were told
// they were wrong.
{
  for (const q of [
    "समुच्चयबोधक का मतलब क्या है?",
    "photosynthesis kya hai",
    "what is a synonym",
    "sangya kitne prakar ki hoti hai",
    "noun kya hota hai",
    "meaning of noun please",
  ]) {
    assert.equal(classifyDrillReply(q), "question", q);
    assert.equal(looksLikeOwnQuestion(q), true, q);
  }

  // The length rule is what protects the answers: an attempt is a word or
  // two, even when it happens to contain a question word.
  for (const a of ["चित्रकार", "कुम्हार", "42", "42 kg", "kya", "क्या", "दो शब्द", "Darji"]) {
    assert.equal(classifyDrillReply(a), "answer", a);
    assert.equal(looksLikeOwnQuestion(a), false, a);
  }

  // "I don't know" is about OUR question — help, never a new ask.
  assert.equal(classifyDrillReply("mujhe nahi pata ye kaise hota hai"), "help");

  // The drill's question comes back underneath the answer, with its number.
  const aside = renderAside({
    answer: "समुच्चयबोधक दो शब्दों को जोड़ता है, जैसे 'और'।",
    question: "'राधा और मीना खेल रही हैं।' में समुच्चयबोधक कौन-सा है?",
    number: 7,
    hindi: true,
  });
  assert.ok(aside.startsWith("समुच्चयबोधक दो शब्दों"), "their answer comes first");
  assert.ok(aside.includes("वापस अभ्यास पर"), "then the way back");
  assert.ok(aside.includes("प्रश्न 7"), "and the question they were on");
}

/* ── what the child reads back ──────────────────────────────────────── */
{
  // Asking for help is answered with teaching, not with ❌.
  const helped = renderCheck({
    check: { verdict: "close", whatWentWrong: "", howToDoIt: "देश की रक्षा करने वाले को 'सैनिक' कहते हैं।", praise: "" },
    hindi: true,
    askedForHelp: true,
  });
  assert.ok(helped.startsWith("🤝"), "a question gets help, not a cross");
  assert.ok(!helped.includes("❌") && !helped.includes("सही नहीं"), helped);
  assert.ok(helped.includes("सैनिक"), "and the answer is actually taught");

  // A right answer written in Latin letters keeps its tick and carries the
  // one line about the exam.
  const script = renderCheck({
    check: { verdict: "right", whatWentWrong: "", howToDoIt: "परीक्षा में इसे हिंदी में 'दर्जी' लिखिए।", praise: "सही उत्तर" },
    hindi: true,
  });
  assert.ok(script.startsWith("✅"), script);
  assert.ok(script.includes("दर्जी"), "the exam note is still said");

  // Stopping is thanked, not scored as a failure.
  const fresh: DrillState = {
    ...newDrill({ studentId: "s", subjectLabel: "हिंदी", paperLabel: "हिंदी", paperDate: "2026-09-19", nowIso: "n" }),
    scope: 5,
    phase: "asking",
  };
  const stopped = renderFinish({ state: fresh, reason: "stopped", hindi: true });
  assert.ok(stopped.includes("शुभकामनाएँ"), stopped);
  assert.ok(!stopped.includes("में से"), "no score when nothing was marked");
}

/* ── A drill dies with its paper ─────────────────────────────────── */
{
  // The 20 Sep 2026 night, exactly: a session for the 19 Sep paper, a
  // parent tapping practice for the 21 Sep one.
  assert.equal(drillIsForAPastPaper("2026-09-19", "2026-09-21"), true);
  // The day of the paper it is still alive — the exam is in the morning and
  // the drill ran the evening before.
  assert.equal(drillIsForAPastPaper("2026-09-21", "2026-09-21"), false);
  assert.equal(drillIsForAPastPaper("2026-09-22", "2026-09-21"), false);

  // ...until the paper starts. 22 Sep 2026: SHIVANGI's drill was opened at
  // 23:03 on the 21st for her Maths paper on the 22nd and never got a
  // chapter number. At 18:19 on the 22nd, with that paper long handed in,
  // her father sent a voice note about the next one — "कल मेरा SST का paper
  // है" — and the drill answered it three times with "send me a chapter
  // number". Papers start at 8:30, so 9 is the cut-off.
  assert.equal(drillIsForAPastPaper("2026-09-22", "2026-09-22", 7), false, "before the paper");
  assert.equal(drillIsForAPastPaper("2026-09-22", "2026-09-22", 8), false, "8:30 has not come");
  assert.equal(drillIsForAPastPaper("2026-09-22", "2026-09-22", 9), true, "it has started");
  assert.equal(drillIsForAPastPaper("2026-09-22", "2026-09-22", 18), true, "his 18:19");
  // Tomorrow's paper is never past, whatever the hour is today.
  assert.equal(drillIsForAPastPaper("2026-09-23", "2026-09-22", 23), false, "tomorrow's drill lives");
  // No hour given is no claim about the time — the old, date-only answer.
  assert.equal(drillIsForAPastPaper("2026-09-22", "2026-09-22"), false);
  // An ISO timestamp, not just a date, still reads as its day.
  assert.equal(drillIsForAPastPaper("2026-09-19T00:00:00Z", "2026-09-21"), true);
  // A date nobody can read says nothing about the paper, so it says nothing.
  assert.equal(drillIsForAPastPaper("", "2026-09-21"), false);
  assert.equal(drillIsForAPastPaper("19/09/2026", "2026-09-21"), false);
  assert.equal(drillIsForAPastPaper("2026-09-19", ""), false);
}

/* ── The practice button is never an answer ──────────────────────── */
{
  // `continueExamDrill` hands these straight back so exam-eve can pick the
  // paper that is actually next. If this ever stops being true, the button
  // is graded against whatever question the drill was holding — which is
  // what six families got on 20 Sep 2026.
  for (const tap of [PRACTICE_BUTTON_EN, PRACTICE_BUTTON_HI, "practice", "अभ्यास"]) {
    assert.ok(isPracticeTap(tap), `the button must be recognised: ${tap}`);
  }
  // And the words of the button are not something a child would ever write
  // as an answer, so nothing is lost by letting them through.
  assert.equal(classifyDrillReply(PRACTICE_BUTTON_HI), "answer");
}

/* ── Politeness and "not now" are not wrong answers ──────────────── */
{
  // 20 Sep 2026: "बेटा कोचिंग गया है आएगा तो करेगा" was marked ❌ and the
  // father was taught the preposition his son had got wrong.
  assert.equal(classifyDrillReply("बेटा कोचिंग गया है आएगा तो करेगा"), "stop");
  assert.equal(classifyDrillReply("abhi nahi, baad me"), "stop");
  assert.equal(classifyDrillReply("बाहर गया है"), "stop");

  for (const ack of ["Ok", "ok.", "ठीक है", "thik hai", "धन्यवाद", "🙏", "Thanks"]) {
    assert.equal(classifyDrillReply(ack), "chatter", `acknowledgement: ${ack}`);
  }

  // The narrowness is the point: these are attempts, and marking one as
  // small talk would lose a child's real answer.
  for (const real of ["haan", "yes", "ji", "two", "दो", "night", "tall"]) {
    assert.equal(classifyDrillReply(real), "answer", `a real attempt: ${real}`);
  }
}

/* ── Random keys are not an answer (23 Sep 2026) ─────────────────── */
{
  assert.ok(looksLikeKeyboardMash("Tdhyhh fb hywu tb y, 475788"), "the pocket-typed message");
  assert.equal(classifyDrillReply("Tdhyhh fb hywu tb y, 475788"), "chatter", "put the question back, unmarked");
  for (const real of [
    "CPU", "RAM and ROM", "the rhythm of the poem", "475788", "Largest is 98765", "LCM of 12 and 18 is 36",
    "Space bar", "Tux Paint lines tool", "8,6,5,3,1", "HCF LCM 1234", "brb", "rhythm",
  ]) {
    assert.equal(looksLikeKeyboardMash(real), false, `a real answer: ${real}`);
  }
}

/* ── Another round after a mastered drill (22 Sep 2026) ──────────── */
{
  const mastered = renderFinish({
    state: { ...newDrill({ studentId: "s", subjectLabel: "कंप्यूटर", paperLabel: "कंप्यूटर", paperDate: "2026-09-23", nowIso: "2026-09-22T12:00:00Z" }), phase: "done" },
    reason: "mastered",
    hindi: true,
  });
  assert.ok(isAnotherRoundInvite(mastered), "the mastered message invites a chapter number");
  const masteredEn = renderFinish({
    state: { ...newDrill({ studentId: "s", subjectLabel: "Computer", paperLabel: "Computer", paperDate: "2026-09-23", nowIso: "2026-09-22T12:00:00Z" }), phase: "done" },
    reason: "mastered",
    hindi: false,
  });
  assert.ok(isAnotherRoundInvite(masteredEn));
  // Good night is good night: no invitation to keep going.
  const stopped = renderFinish({
    state: { ...newDrill({ studentId: "s", subjectLabel: "Computer", paperLabel: "Computer", paperDate: "2026-09-23", nowIso: "2026-09-22T12:00:00Z" }), phase: "done" },
    reason: "stopped",
    hindi: true,
  });
  assert.equal(isAnotherRoundInvite(stopped), false);
  assert.equal(isAnotherRoundInvite(undefined), false);
  // What the father actually sent next.
  const computer: DrillChapter[] = [
    { position: 1, name: "Computer—A Smart Machine", topics: [] },
    { position: 2, name: "Roles of Computers", topics: [] },
    { position: 3, name: "Working of a Computer", topics: [] },
  ];
  assert.deepEqual(readScopeAnswer("2", computer), { kind: "position", position: 2 });
  assert.deepEqual(readScopeAnswer("Role of computer", computer), { kind: "position", position: 2 });
  assert.notEqual(readScopeAnswer("ok", computer).kind, "position", "ok ends the evening");
}

console.log("ok");
