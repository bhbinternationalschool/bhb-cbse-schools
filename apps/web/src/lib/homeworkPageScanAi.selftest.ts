/**
 * A photographed book page → homework: what may be kept, and what is refused.
 * Run: npx tsx src/lib/homeworkPageScanAi.selftest.ts
 */
import assert from "node:assert/strict";
import {
  buildHomeworkPageScanPrompt,
  buildHomeworkPageScanSystem,
  cleanHomeworkPageScanInput,
  compactQuestionNumbers,
  droppedNote,
  homeworkPageAuditDescriptor,
  labelInTranscript,
  parseHomeworkPageReading,
  renderHomeworkFromPage,
  HOMEWORK_PAGE_MAX_IMAGES,
  HOMEWORK_PAGE_QUOTED_QUESTIONS,
  type HomeworkPageReading,
} from "./homeworkPageScanAi";

console.log("homeworkPageScanAi.selftest.ts");

type Readable = Extract<HomeworkPageReading, { readable: true }>;
function readable(r: HomeworkPageReading | null): Readable {
  assert.ok(r, "parsed");
  assert.equal(r.readable, true, "readable");
  return r as Readable;
}

/* ── Input ────────────────────────────────────────────────────────── */
{
  const ok = cleanHomeworkPageScanInput({
    classId: "c5",
    sectionId: "s5a",
    subjectId: "math",
    language: "hi",
    images: [{ imageBase64: "data:image/jpeg;base64,QUJD", mimeType: "image/jpeg" }],
  });
  assert.ok(typeof ok !== "string");
  assert.equal(ok.language, "hi");
  assert.equal(ok.images[0]!.base64, "QUJD", "a data: prefix is stripped");

  assert.equal(typeof cleanHomeworkPageScanInput({ images: [] }), "string", "class/section/subject required");
  assert.match(
    String(cleanHomeworkPageScanInput({ classId: "c", sectionId: "s", subjectId: "m", images: [] })),
    /photo/,
  );
  const tooMany = Array.from({ length: HOMEWORK_PAGE_MAX_IMAGES + 1 }, () => ({ imageBase64: "QQ==", mimeType: "image/jpeg" }));
  assert.match(String(cleanHomeworkPageScanInput({ classId: "c", sectionId: "s", subjectId: "m", images: tooMany })), /At most/);
  assert.match(
    String(cleanHomeworkPageScanInput({ classId: "c", sectionId: "s", subjectId: "m", images: [{ imageBase64: "QQ==", mimeType: "application/pdf" }] })),
    /JPG or PNG/,
    "a PDF is not a photo",
  );
  assert.equal(
    (cleanHomeworkPageScanInput({ classId: "c", sectionId: "s", subjectId: "m", language: "fr", images: [{ imageBase64: "QQ==" }] }) as { language: string }).language,
    "en",
    "an unknown language falls back to English",
  );
}

/* ── Prompt ───────────────────────────────────────────────────────── */
{
  const sys = buildHomeworkPageScanSystem("hi");
  assert.match(sys, /Never guess a number/);
  assert.match(sys, /readable to false/);
  assert.match(sys, /Hindi/);
  assert.match(buildHomeworkPageScanSystem("en"), /simple English/);
  const p = buildHomeworkPageScanPrompt({ classLabel: "Class 5 A", subjectLabel: "Maths", language: "en", pageCount: 2 });
  assert.match(p, /Class 5 A/);
  assert.match(p, /2 photos, in order/);

  const d = homeworkPageAuditDescriptor({
    classLabel: "Class 5 A",
    subjectLabel: "Maths",
    language: "en",
    images: [{ base64: "A".repeat(4096), mimeType: "image/jpeg" }],
  });
  assert.match(d, /page 1: image\/jpeg, ~3 kB/);
  assert.ok(!d.includes("AAAA"), "the photo's bytes never reach the audit row");
}

/* ── Labels are found as labels, not as digits inside other numbers ── */
{
  const t = "Exercise 5.2\nPage 45\n1. Find 15.25 + 3\nQ.2 Add\n(iii) Write";
  assert.ok(labelInTranscript("5.2", t));
  assert.ok(labelInTranscript("45", t));
  assert.ok(labelInTranscript("1", t));
  assert.ok(labelInTranscript("2", t), "Q.2 prints question 2");
  assert.ok(labelInTranscript("iii", t));
  assert.ok(!labelInTranscript("5.3", t));
  assert.ok(!labelInTranscript("15", t), "15 is not printed on its own — only inside 15.25");
  assert.ok(!labelInTranscript("25", t), "…nor 25");
  assert.ok(!labelInTranscript("4", t), "the 4 of 45 is not a label");
  assert.ok(labelInTranscript("3", "अभ्यास ३"), "Devanagari digits count");
  assert.ok(!labelInTranscript("", t));
}

/* ── Parsing: what is kept ────────────────────────────────────────── */
const good = readable(
  parseHomeworkPageReading(
    JSON.stringify({
      readable: true,
      transcript: "Chapter 5 Fractions\nExercise 5.2\n45\n1. Add 1/2 and 1/4\n2. Subtract 1/3 from 1\n3. Write 3/4 in words",
      pageNumber: "45",
      chapterHeading: "Chapter 5 Fractions",
      exercise: "Exercise 5.2",
      questions: [
        { number: "1.", text: "Add 1/2 and 1/4" },
        { number: "2", text: "Subtract 1/3 from 1" },
        { number: "3", text: "Write 3/4 in words" },
        { number: "3", text: "Write 3/4 in words" },
      ],
      instruction: "Write the answers in your homework notebook.",
    }),
  ),
);
assert.equal(good.exercise, "5.2", "the word Exercise is stripped");
assert.equal(good.pageNumber, "45");
assert.equal(good.chapterHeading, "Chapter 5 Fractions");
assert.equal(good.questions.length, 3, "a repeated question is kept once");
assert.equal(good.questions[0]!.number, "1", "a trailing dot is stripped");
assert.equal(good.dropped.length, 0);

/* ── Parsing: the refusals that matter ────────────────────────────── */
{
  const r = readable(
    parseHomeworkPageReading(
      JSON.stringify({
        readable: true,
        transcript: "Exercise 3\n1. Name three animals\n2. Draw a tree",
        pageNumber: "27",
        chapterHeading: "My Family",
        exercise: "3.4",
        questions: [
          { number: "1", text: "Name three animals" },
          { number: "2", text: "Draw a tree" },
          { number: "7", text: "Write a poem" },
        ],
        instruction: "Answer all 12 questions.",
      }),
    ),
  );
  assert.equal(r.pageNumber, "", "a page number not printed is dropped");
  assert.equal(r.exercise, "", "an exercise number not printed is dropped");
  assert.equal(r.chapterHeading, "", "a heading not in the transcript is dropped");
  assert.deepEqual(r.questions.map((q) => q.number), ["1", "2"], "a question number not printed is dropped");
  assert.equal(r.instruction, "", "an instruction with an invented number is refused");
  assert.deepEqual(r.dropped, ["page 27", "exercise 3.4", 'chapter heading "My Family"', "question 7"]);
  assert.match(droppedNote(r.dropped), /page 27/);
  assert.equal(droppedNote([]), "");
}
{
  const r = parseHomeworkPageReading(JSON.stringify({ readable: false, unreadableReason: "Too blurred to read" }));
  assert.deepEqual(r, { readable: false, reason: "Too blurred to read" });
  const r2 = parseHomeworkPageReading(JSON.stringify({ readable: false }));
  assert.equal(r2 && !r2.readable && r2.reason, "The page could not be read", "unreadable always carries a reason");
  const noTranscript = parseHomeworkPageReading(JSON.stringify({ readable: true, exercise: "5.2", questions: [{ number: "1", text: "x" }] }));
  assert.equal(noTranscript?.readable, false, "no transcript → nothing can be checked → unreadable");
  const empty = parseHomeworkPageReading(JSON.stringify({ readable: true, transcript: "a photo of a cat", questions: [] }));
  assert.equal(empty?.readable, false, "no exercise, heading or question → unreadable, not an empty draft");
  assert.equal(parseHomeworkPageReading("not json"), null);
  assert.equal(parseHomeworkPageReading("```json\n[1,2]\n```")?.readable, false, "a non-object reply is not a reading");
}
{
  // Unnumbered activities are kept by text; Hindi page with Devanagari numbering.
  const r = readable(
    parseHomeworkPageReading(
      JSON.stringify({
        transcript: "पाठ ४ मेरा गाँव\nअभ्यास ४\nप्रश्न १ गाँव का नाम लिखिए।\nअपने गाँव का चित्र बनाइए।",
        chapterHeading: "पाठ ४ मेरा गाँव",
        exercise: "अभ्यास 4",
        questions: [
          { number: "1", text: "गाँव का नाम लिखिए।" },
          { number: "", text: "अपने गाँव का चित्र बनाइए।" },
        ],
        instruction: "ये प्रश्न कॉपी में लिखिए।",
      }),
    ),
  );
  assert.equal(r.exercise, "4");
  assert.equal(r.questions.length, 2);
  assert.equal(r.instruction, "ये प्रश्न कॉपी में लिखिए।");
}

/* ── Question numbers ─────────────────────────────────────────────── */
assert.equal(compactQuestionNumbers(["1", "2", "3", "5"]), "1–3, 5");
assert.equal(compactQuestionNumbers(["4", "2", "3"]), "2–4");
assert.equal(compactQuestionNumbers(["1", "2"]), "1, 2");
assert.equal(compactQuestionNumbers(["7"]), "7");
assert.equal(compactQuestionNumbers(["i", "ii", "iv"]), "i, ii, iv", "roman numerals are listed as printed");
assert.equal(compactQuestionNumbers([]), "");

/* ── The draft ────────────────────────────────────────────────────── */
{
  const all = renderHomeworkFromPage({ reading: good, selected: [0, 1, 2], language: "en", subjectLabel: "Maths" });
  assert.equal(all.title, "Maths — Exercise 5.2");
  assert.match(all.body, /^Chapter: Chapter 5 Fractions/);
  assert.match(all.body, /Exercise 5\.2, page 45/);
  assert.match(all.body, /All questions \(1–3\)/);
  assert.match(all.body, /1\. Add 1\/2 and 1\/4/);
  assert.match(all.body, /Write the answers in your homework notebook\.$/);

  const some = renderHomeworkFromPage({ reading: good, selected: [2, 0], language: "en", subjectLabel: "Maths" });
  assert.equal(some.title, "Maths — Exercise 5.2 · Q 1, 3");
  assert.match(some.body, /Questions: 1, 3/);
  assert.ok(!some.body.includes("Subtract"), "an unticked question is not in the draft");

  const hi = renderHomeworkFromPage({ reading: { ...good, instruction: "" }, selected: [0, 1], language: "hi", subjectLabel: "गणित" });
  assert.match(hi.body, /अभ्यास 5\.2, पृष्ठ 45/);
  assert.match(hi.body, /प्रश्न: 1, 2/);
  assert.match(hi.body, /गृहकार्य की कॉपी/, "no instruction read → the plain default, in the teacher's language");

  // Nothing named that was not read: no page, no exercise → neither appears.
  const bare: Readable = { ...good, pageNumber: "", exercise: "", chapterHeading: "" };
  const b = renderHomeworkFromPage({ reading: bare, selected: [0], language: "en", subjectLabel: "Maths" });
  assert.ok(!/Exercise|page|Chapter/.test(b.body), "a missing field is left out, never filled");
  assert.equal(b.title, "Maths · Q 1");

  // Long exercises quote the first few and count the rest.
  const many: Readable = {
    ...good,
    questions: Array.from({ length: 14 }, (_, i) => ({ number: String(i + 1), text: `Question ${i + 1}` })),
  };
  const m = renderHomeworkFromPage({ reading: many, selected: many.questions.map((_, i) => i), language: "en", subjectLabel: "Maths" });
  assert.match(m.body, /All questions \(1–14\)/);
  assert.match(m.body, new RegExp(`…and ${14 - HOMEWORK_PAGE_QUOTED_QUESTIONS} more`));
  assert.ok(!m.body.includes("Question 14"));
}

console.log("homeworkPageScanAi.selftest.ts — all passed");
