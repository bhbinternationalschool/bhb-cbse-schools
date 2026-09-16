/**
 * Self-test: the tutor's textbook block — which class and subject it is for,
 * how DIKSHA's chapter names read, which books a question gets, and that the
 * prompt only carries a list when there is one. Names are DIKSHA's own
 * (September 2026).
 * Run: npx tsx apps/web/src/lib/tutorSyllabus.selftest.ts
 */
import assert from "node:assert/strict";
import { buildTutorSystemPrompt } from "@/lib/tutorPlans";
import {
  cleanChapterName,
  subjectKeyFor,
  textbooksPromptBlock,
  tutorGrade,
  type SyllabusBook,
  type SyllabusChapter,
} from "@/lib/tutorSyllabus";

// ── Class ───────────────────────────────────────────────────────────────
{
  assert.equal(tutorGrade("VII A"), 7);
  assert.equal(tutorGrade("I A"), 1);
  assert.equal(tutorGrade("VIII"), 8);
  assert.equal(tutorGrade("IV B"), 4);
  assert.equal(tutorGrade("Class 3"), 3);
  assert.equal(tutorGrade("LKG A"), null, "the index has no pre-primary books");
  assert.equal(tutorGrade("Nursery"), null);
  assert.equal(tutorGrade("UKG B"), null);
  assert.equal(tutorGrade("IX A"), null, "outside Classes 1–8");
  assert.equal(tutorGrade("10"), null);
  assert.equal(tutorGrade("their class"), null, "the placeholder label names no class");
  assert.equal(tutorGrade(undefined), null);
}

// ── Subject names (Masters, DIKSHA, typed) ─────────────────────────────
{
  const cases: [string, string | null][] = [
    ["Mathematics", "maths"],
    ["Early Numeracy", "maths"],
    ["गणित", "maths"],
    ["Science", "science"],
    ["Social Science", "social"],
    ["History", "social"],
    ["Environmental Studies / World Around Us", "evs"],
    ["The World Around Us", "evs"],
    ["Environmental Education", "evs"],
    ["English — Written", "english"],
    ["Hindi — Oral", "hindi"],
    ["हिंदी", "hindi"],
    ["Sanskrit", "sanskrit"],
    ["Health & Physical Education", "pe"],
    ["Physical Education And Well Being", "pe"],
    ["Art Education", "arts"],
    ["Arts", "arts"],
    ["Work Education", "vocational"],
    ["Vocational / Skill subject", "vocational"],
    ["Information Technology / Computer Applications", null],
    ["Socio-emotional & ethical development", null],
    ["", null],
  ];
  for (const [label, key] of cases) assert.equal(subjectKeyFor(label), key, label);
}

// ── Chapter names ───────────────────────────────────────────────────────
{
  const cases: [string, string][] = [
    ["Chapter 7: Fractions", "Fractions"],
    ["Chapter-2 POWER PLAY", "POWER PLAY"],
    ["Chapter -4 Project 4: AI Assistant", "Project 4: AI Assistant"],
    ["Unit 1 - Chapter 2 Greetings", "Greetings"],
    ["Unit 1: Fables and Folk Tales", "Fables and Folk Tales"],
    ["अध्याय-15: भारत", "भारत"],
    // DIKSHA's own spelling carries a zero-width joiner inside "अध्याय".
    ["अध\u094D\u200Dयाय 1: फेंकना व लपकना", "फेंकना व लपकना"],
    ["पाठ 1 मीना का परिवार", "मीना का परिवार"],
    ["12 - कुछ लेना, कुछ देना", "कुछ लेना, कुछ देना"],
    ["10. नृत्य एवं अंग संचालन", "नृत्य एवं अंग संचालन"],
    ["1- नाम में क्या है?", "नाम में क्या है?"],
    ["What’s in a Name?", "What’s in a Name?"],
    ["पञ्चमः पाठः गीता सुगीता कर्तव्या", "पञ्चमः पाठः गीता सुगीता कर्तव्या"],
    ["3D Shapes", "3D Shapes"],
    ["Chapter 1", "Chapter 1"],
  ];
  for (const [raw, clean] of cases) assert.equal(cleanChapterName(raw), clean, raw);
}

// ── The block ───────────────────────────────────────────────────────────
const books: SyllabusBook[] = [
  { id: "gp1", medium: "English", subjects: ["Mathematics"], name: "Ganita Prakash" },
  { id: "gp2", medium: "English", subjects: ["Mathematics"], name: "Ganita Prakash II" },
  { id: "gp1h", medium: "Hindi", subjects: ["Mathematics"], name: "Ganita Prakash(Hindi)" },
  { id: "cur", medium: "English", subjects: ["Science"], name: "Curiosity" },
  { id: "mal", medium: "Hindi", subjects: ["Hindi"], name: "मल्हार" },
  { id: "dee", medium: "Sanskrit", subjects: ["Sanskrit"], name: "दीपकम्" },
  { id: "kri", medium: "English", subjects: ["Arts"], name: "Kriti" },
  { id: "nochap", medium: "English", subjects: ["Social Science"], name: "Exploring Society" },
  { id: "odd", medium: "English", subjects: ["Something Else"], name: "Unmapped" },
];
const chapters: SyllabusChapter[] = [
  { textbookId: "gp1", position: 2, name: "Chapter 2: Arithmetic Expressions" },
  { textbookId: "gp1", position: 1, name: "Chapter 1: Large Numbers Around Us" },
  { textbookId: "gp2", position: 1, name: "Chapter 1: Geometric Twins" },
  { textbookId: "gp1h", position: 1, name: "अध्याय 1: हमारे आस-पास की बड़ी संख्याएँ" },
  { textbookId: "cur", position: 1, name: "Chapter 1: The Ever-Evolving World of Science" },
  { textbookId: "mal", position: 1, name: "पाठ 1- माँ, कह एक कहानी" },
  { textbookId: "dee", position: 1, name: "पाठ 1- वन्देभारतमातरम्" },
  { textbookId: "kri", position: 1, name: "Chapter 1- Understanding Emotions" },
  { textbookId: "odd", position: 1, name: "Chapter 1: Hidden" },
];
{
  const all = textbooksPromptBlock({ grade: 7, books, chapters });
  const lines = all.split("\n");
  assert.equal(lines[0], "Textbooks: the current NCERT books for Class 7, as listed on DIKSHA, the government's school platform.");
  assert.deepEqual(lines.slice(1, -1), [
    "Mathematics — Ganita Prakash: 1. Large Numbers Around Us; 2. Arithmetic Expressions",
    "Mathematics — Ganita Prakash II (Hindi-medium edition: Ganita Prakash(Hindi)): 1. Geometric Twins",
    "Science — Curiosity: 1. The Ever-Evolving World of Science",
    "Hindi — मल्हार: 1. माँ, कह एक कहानी",
    "Sanskrit — दीपकम्: 1. वन्देभारतमातरम्",
  ], "core subjects in a fixed order, English editions with the Hindi one named once, chapters in book order; arts only when asked; a book with no chapters or no known subject is left out");
  assert.match(lines.at(-1)!, /Never name a book, chapter or chapter number that is not in this list/);
  assert.ok(!all.includes("अध्याय 1: हमारे"), "the Hindi edition's chapters are not listed twice");

  const maths = textbooksPromptBlock({ grade: 7, books, chapters, subjectLabel: "Mathematics" });
  assert.ok(maths.includes("Ganita Prakash II") && !maths.includes("Curiosity") && !maths.includes("मल्हार"), "a homework subject narrows the list to that subject");
  const art = textbooksPromptBlock({ grade: 7, books, chapters, subjectLabel: "Art Education" });
  assert.ok(art.includes("Arts — Kriti: 1. Understanding Emotions") && !art.includes("Ganita"), "arts is listed when it is the subject, and nothing else");
  assert.ok(!textbooksPromptBlock({ grade: 3, books: [books[6]!], chapters }).match(/Ganita|Curiosity|Poorvi/), "the instructions name no real book of another class");
  const unknownSubject = textbooksPromptBlock({ grade: 7, books, chapters, subjectLabel: "Computational Thinking / ICT" });
  assert.equal(unknownSubject, all, "a subject the index has no book for falls back to the core list");

  const hindiOnly = textbooksPromptBlock({
    grade: 2,
    books: [{ id: "ag", medium: "Hindi", subjects: ["Mathematics"], name: "आनंदमय गणित" }],
    chapters: [{ textbookId: "ag", position: 1, name: "पाठ 1 समुद्र किनारे एक दिन" }],
  });
  assert.ok(hindiOnly.includes("Mathematics — आनंदमय गणित: 1. समुद्र किनारे एक दिन"), "no English edition → the Hindi one is listed");

  assert.equal(textbooksPromptBlock({ grade: 7, books: [], chapters: [] }), "", "nothing indexed → no block");
  assert.equal(textbooksPromptBlock({ grade: 7, books: [books[7]!], chapters: [] }), "", "books without chapters → no block");
}

// ── The prompt carries the block only when there is one ────────────────
{
  const block = textbooksPromptBlock({ grade: 7, books, chapters });
  const without = buildTutorSystemPrompt("teach", { childName: "Dipti", className: "VII A" }, "BHB", "hi");
  const withList = buildTutorSystemPrompt("teach", { childName: "Dipti", className: "VII A" }, "BHB", "hi", block);
  assert.ok(!without.includes("Textbooks:"), "no list → the prompt is as it was");
  assert.equal(withList.replace(`${block}\n`, ""), without, "the list is added as one block and changes nothing else");
  assert.ok(withList.indexOf("Level guide") < withList.indexOf("Textbooks:"), "after the class and level lines");
  assert.ok(withList.indexOf("Textbooks:") < withList.indexOf("Teach the topic"), "before the mode's instructions");
}

console.log("tutorSyllabus.selftest: ok");
