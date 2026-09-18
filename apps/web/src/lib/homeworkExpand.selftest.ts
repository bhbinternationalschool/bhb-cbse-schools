/**
 * Short homework, made complete — what may be named and what may not.
 * Run: npx tsx src/lib/homeworkExpand.selftest.ts
 */
import assert from "node:assert/strict";
import {
  buildHomeworkExpandPrompt,
  expansionInventsChapter,
  formatDueLabel,
  homeworkExpandFacts,
  parseHomeworkExpansion,
  parseHomeworkReference,
  renderHomeworkExpansion,
  resolutionNoteForTeacher,
  resolveHomeworkChapter,
  homeworkWaBody,
  homeworkWaDue,
  homeworkWaLine,
  WA_LINE_MAX,
  type BookFact,
} from "./homeworkExpand";

console.log("homeworkExpand.selftest.ts");

/* ── Reading the shorthand ────────────────────────────────────────── */
const ex = parseHomeworkReference("ex 5.2 Q1-5, due kal");
assert.equal(ex.chapterPosition, 5, "5.2 is chapter 5, exercise 2");
assert.equal(ex.exercise, "5.2");
assert.equal(ex.questions, "1–5");

// The refusal that matters: a bare exercise number is NOT a chapter number.
const bare = parseHomeworkReference("do exercise 4");
assert.equal(bare.exercise, "4");
assert.equal(bare.chapterPosition, 0, "a bare exercise number names no chapter");

assert.equal(parseHomeworkReference("ch 7 questions 1 to 3").chapterPosition, 7);
assert.equal(parseHomeworkReference("paath 3 ke prashn").chapterPosition, 3);
assert.equal(parseHomeworkReference("पाठ ३ के प्रश्न").chapterPosition, 3, "Devanagari digits");
assert.equal(parseHomeworkReference("अध्याय 9 पढ़ें").chapterPosition, 9);
assert.equal(parseHomeworkReference("Lesson 4, pg 45-46").pages, "45–46");
assert.equal(parseHomeworkReference("read pages 12 to 14").pages, "12–14");
// A chapter stated outright wins over the digits inside an exercise number.
assert.equal(parseHomeworkReference("ch 3 ex 5.2").chapterPosition, 3);
// Nothing numeric at all.
const none = parseHomeworkReference("learn the spellings");
assert.equal(none.chapterPosition, 0);
assert.equal(none.exercise, "");
assert.equal(none.nameFragment, "spellings", "stopwords dropped, the subject word kept");

/* ── Resolving against the school's real book ─────────────────────── */
// Propel Edition A Mathematics Grade 5, as loaded in production.
const maths: BookFact = {
  name: "Propel Edition A Mathematics Grade 5",
  chapters: [
    { position: 5, name: "More about Operations on Numbers", topics: ["problems with multiple operations", "numeric expressions and DMAS", "unitary method: value of one and many"] },
    { position: 6, name: "Multiples and Factors", topics: ["multiples of two or more numbers", "factors of two or more numbers", "prime and composite numbers", "divisibility by 2, 3, 4, 5, 6, 9 and 10"] },
  ],
};

const byPosition = resolveHomeworkChapter({ books: [maths], reference: ex });
assert.equal(byPosition.kind, "chapter");
if (byPosition.kind === "chapter") {
  assert.equal(byPosition.chapter.name, "More about Operations on Numbers");
  assert.equal(byPosition.how, "position");
}

const byName = resolveHomeworkChapter({ books: [maths], reference: parseHomeworkReference("do the sums on factors") });
assert.equal(byName.kind, "chapter");
if (byName.kind === "chapter") assert.equal(byName.chapter.position, 6);

const byTopic = resolveHomeworkChapter({ books: [maths], reference: parseHomeworkReference("practise divisibility rules") });
assert.equal(byTopic.kind, "chapter");
if (byTopic.kind === "chapter") {
  assert.equal(byTopic.chapter.position, 6);
  assert.equal(byTopic.how, "topic");
}

// A chapter the book does not have resolves to NOTHING, never to the nearest one.
const tooFar = resolveHomeworkChapter({ books: [maths], reference: parseHomeworkReference("ch 19 questions") });
assert.deepEqual(tooFar, { kind: "none", reason: "no_match" });
assert.match(resolutionNoteForTeacher(tooFar, parseHomeworkReference("ch 19 questions")), /no chapter 19/);

// Nothing to resolve is not a problem to report.
const nothing = resolveHomeworkChapter({ books: [maths], reference: none });
assert.equal(nothing.kind, "none");
assert.equal(resolutionNoteForTeacher(nothing, none), "", "a teacher who asked for no chapter is not nagged");
// Ordinary words that match no chapter are not a warning either.
const noMatchByWords = resolveHomeworkChapter({ books: [maths], reference: parseHomeworkReference("finish the worksheet") });
assert.equal(noMatchByWords.kind, "none");
assert.equal(resolutionNoteForTeacher(noMatchByWords, parseHomeworkReference("finish the worksheet")), "");

// No book loaded for the subject: silence, not a guess.
assert.deepEqual(resolveHomeworkChapter({ books: [], reference: ex }), { kind: "none", reason: "no_book" });
assert.equal(resolutionNoteForTeacher({ kind: "none", reason: "no_book" }, ex), "");

// Two editions for one subject: the teacher decides, not the ERP.
const two = resolveHomeworkChapter({ books: [maths, { ...maths, name: "Propel Edition A गणित कक्षा 5" }], reference: ex });
assert.equal(two.kind, "ambiguous");

/* ── The facts, and what may be named ─────────────────────────────── */
const facts = homeworkExpandFacts({
  classLabel: "Class 5-A",
  subjectLabel: "Mathematics",
  teacherText: "ex 5.2 Q1-5",
  dueLabel: "tomorrow (Sat 19 Sep)",
  reference: ex,
  resolution: byPosition,
});
assert.equal(facts.chapterNumber, 5);
assert.equal(facts.topics.length, 3, "at most three topics reach the message");
assert.match(buildHomeworkExpandPrompt(facts), /Chapter: 5 — More about Operations on Numbers/);

const unresolvedFacts = homeworkExpandFacts({
  classLabel: "Class 5-A",
  subjectLabel: "Mathematics",
  teacherText: "learn the spellings",
  dueLabel: "",
  reference: none,
  resolution: nothing,
});
assert.match(buildHomeworkExpandPrompt(unresolvedFacts), /Chapter: not known — name no chapter/);
assert.match(buildHomeworkExpandPrompt(unresolvedFacts), /Due: not stated — do not invent one/);

/* ── The guard: a chapter nobody gave it ──────────────────────────── */
assert.equal(expansionInventsChapter("Chapter 5 — More about Operations on Numbers", facts), false);
assert.equal(expansionInventsChapter("अध्याय 5 के प्रश्न", facts), false, "the Hindi body may name the same chapter");
assert.equal(expansionInventsChapter("Revise Chapter 9 as well", facts), true, "a second chapter is an invention");
assert.equal(expansionInventsChapter("Do the work from chapter 4", unresolvedFacts), true, "no facts, no chapter");
// A number the teacher wrote themselves is theirs to be wrong about.
const teacherSaidNine = homeworkExpandFacts({
  classLabel: "5-A", subjectLabel: "Maths", teacherText: "ch 9 questions", dueLabel: "",
  reference: parseHomeworkReference("ch 9 questions"), resolution: { kind: "none", reason: "no_match" },
});
assert.equal(expansionInventsChapter("Chapter 9 questions", teacherSaidNine), false);

const good = JSON.stringify({ title: "Maths — Exercise 5.2", bodyEn: "Chapter 5 work, questions 1–5.", bodyHi: "अध्याय 5 का कार्य, प्रश्न 1–5।" });
assert.ok(parseHomeworkExpansion(good, facts));
const invented = JSON.stringify({ title: "Maths", bodyEn: "Also revise chapter 8.", bodyHi: "ठीक है।" });
assert.equal(parseHomeworkExpansion(invented, facts), null, "a draft that invents a chapter is refused");
assert.equal(parseHomeworkExpansion("not json", facts), null);
assert.equal(parseHomeworkExpansion(JSON.stringify({ title: "x", bodyEn: "only english" }), facts), null, "both languages or nothing");

/* ── The message without a model ──────────────────────────────────── */
const plain = renderHomeworkExpansion(facts);
assert.match(plain.bodyEn, /Propel Edition A Mathematics Grade 5/);
assert.match(plain.bodyEn, /Chapter 5 — More about Operations on Numbers/);
assert.match(plain.bodyEn, /Work: ex 5.2 Q1-5/, "the teacher's own words survive verbatim");
assert.match(plain.bodyEn, /Due: tomorrow/);
assert.match(plain.bodyHi, /अध्याय 5/);
assert.match(plain.bodyHi, /कार्य: ex 5.2 Q1-5/);

const plainUnresolved = renderHomeworkExpansion(unresolvedFacts);
assert.doesNotMatch(plainUnresolved.bodyEn, /Chapter|Book:/, "nothing resolved, nothing named");
assert.doesNotMatch(plainUnresolved.bodyHi, /अध्याय|पुस्तक/);
assert.match(plainUnresolved.bodyEn, /Work: learn the spellings/);

/* ── Due dates ────────────────────────────────────────────────────── */
assert.match(formatDueLabel("2026-09-19", "2026-09-18"), /^tomorrow/);
assert.match(formatDueLabel("2026-09-18", "2026-09-18"), /^today/);
// "Sep" or "Sept" depending on the runtime's CLDR — the day and date are
// what the test is about.
assert.match(formatDueLabel("2026-09-25", "2026-09-18"), /^Fri 25 Sept?$/);
assert.equal(formatDueLabel("", "2026-09-18"), "", "no due date is not a due date");
assert.equal(formatDueLabel("kal", "2026-09-18"), "");

/* ── What fits in a WhatsApp template ─────────────────────────────── */
//
// Meta rejects a variable containing a newline, a tab, or four spaces in a
// row, so the expanded message cannot ride inside the template — one line
// carries the chapter and the work instead.
const line = homeworkWaLine({ title: "Maths — Exercise 5.2", aiTutorHint: "Ch 5 — More about Operations on Numbers" });
assert.equal(line, "Ch 5 — More about Operations on Numbers · Maths — Exercise 5.2");
assert.doesNotMatch(line, /[\n\t]/, "a template variable is one line");
assert.doesNotMatch(line, / {4}/, "Meta rejects four spaces in a row");

// Older posts put the subject CODE in aiTutorHint ("ENG"); that is not a
// chapter and is not worth a parent's attention.
assert.equal(homeworkWaLine({ title: "English — practice", aiTutorHint: "ENG" }), "English — practice");
assert.equal(homeworkWaLine({ title: "English — practice" }), "English — practice");
assert.equal(homeworkWaLine({ title: "", aiTutorHint: "" }), "See the parent app", "never an empty variable");
assert.match(homeworkWaLine({ title: "क्ष ".repeat(200), aiTutorHint: "पाठ 3" }), /…$/);
assert.ok(homeworkWaLine({ title: "x".repeat(400), aiTutorHint: "Ch 2 — Y" }).length <= WA_LINE_MAX);

// Meta forbids an empty variable, and a due date is often absent.
assert.equal(homeworkWaDue("tomorrow (Sat 19 Sep)", "en"), "tomorrow (Sat 19 Sep)");
assert.equal(homeworkWaDue("", "en"), "not given");
assert.equal(homeworkWaDue("", "hi"), "बताई नहीं गई");

// The full message, for a family whose window is open: the family's own
// language, and the school's name at the end.
const waHi = homeworkWaBody({ expansion: plain, language: "hi", schoolName: "BHB International School" });
assert.match(waHi, /अध्याय 5/);
assert.match(waHi, /BHB International School/);
assert.doesNotMatch(waHi, /Chapter 5 — More/, "a Hindi family is not sent the English body");
const waEn = homeworkWaBody({ expansion: plain, language: "en", schoolName: "BHB International School" });
assert.match(waEn, /Chapter 5 — More about Operations on Numbers/);
assert.match(waEn, /Ask tutor/);

console.log("ok");
