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
  CHAPTER_TOPICS_MAX,
  preschoolPromptBlock,
  cleanChapterName,
  cleanOutcomeName,
  indexGrade,
  outcomesListing,
  outcomesPromptBlock,
  preschoolGoalsFor,
  preschoolGrade,
  subjectKeyFor,
  textbooksListing,
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
  assert.equal(lines[0], "Textbooks: the books this school's Class 7 children use, chapter by chapter — these are the books in the child's school bag.", "the school's books by default");
  assert.equal(
    textbooksListing({ grade: 7, books, chapters, source: "ncert" }).split("\n")[0],
    "Textbooks: the current NCERT books for Class 7, as listed on DIKSHA, the government's school platform.",
    "the NCERT header only when asked for by name",
  );
  assert.match(all, /never an NCERT book: the child does not have one/);
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

// ── The bare listing (lesson plans) ────────────────────────────────────
{
  const listing = textbooksListing({ grade: 7, books, chapters });
  assert.equal(`${listing}\n${textbooksPromptBlock({ grade: 7, books, chapters }).split("\n").at(-1)}`, textbooksPromptBlock({ grade: 7, books, chapters }), "the tutor block is the listing plus its one rule");
  assert.ok(!listing.includes("Using the textbooks"), "the listing carries no tutor instructions");

  assert.equal(textbooksListing({ grade: 7, books, chapters, subjectLabel: "Computational Thinking / ICT", coreFallback: false }), "", "no book for the subject and no fallback → nothing");
  assert.equal(textbooksListing({ grade: 7, books, chapters, coreFallback: false }), "", "no subject and no fallback → nothing");
  const mathsOnly = textbooksListing({ grade: 7, books, chapters, subjectLabel: "Mathematics", coreFallback: false });
  assert.ok(mathsOnly.includes("Ganita Prakash II") && !mathsOnly.includes("Curiosity"), "a known subject lists only itself");

  const hindiPlan = textbooksListing({ grade: 7, books, chapters, subjectLabel: "Mathematics", coreFallback: false, medium: "Hindi" });
  assert.deepEqual(hindiPlan.split("\n").slice(1), [
    "Mathematics — Ganita Prakash(Hindi) (English-medium edition: Ganita Prakash, Ganita Prakash II): 1. हमारे आस-पास की बड़ी संख्याएँ",
  ], "a Hindi plan lists the Hindi-medium edition's chapters and names the English one");
  const hindiNoEdition = textbooksListing({ grade: 7, books, chapters, subjectLabel: "Science", coreFallback: false, medium: "Hindi" });
  assert.ok(hindiNoEdition.includes("Science — Curiosity: 1. The Ever-Evolving World of Science"), "no Hindi-medium edition → the English one, with no false note");
  const hindiSubject = textbooksListing({ grade: 7, books, chapters, subjectLabel: "Hindi", coreFallback: false, medium: "English" });
  assert.ok(hindiSubject.includes("Hindi — मल्हार"), "Hindi the subject is always its own book");
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

// ── Pre-primary: NCERT's outcomes as a minimum ─────────────────────────
{
  assert.equal(preschoolGrade("Nursery A"), -2);
  assert.equal(preschoolGrade("LKG B"), -1);
  assert.equal(preschoolGrade("UKG"), 0);
  assert.equal(preschoolGrade("KG"), 0);
  assert.equal(preschoolGrade("VI A"), null);
  assert.equal(indexGrade("LKG A"), -1);
  assert.equal(indexGrade("VII A"), 7);
  assert.equal(indexGrade("their class"), null);

  // The school's own Masters subject names.
  assert.deepEqual(preschoolGoalsFor("Early Numeracy"), ["Involved Learners"]);
  assert.deepEqual(preschoolGoalsFor("World Around Us / Environmental awareness"), ["Involved Learners"]);
  assert.deepEqual(preschoolGoalsFor("English — Oral"), ["Effective Communicators"]);
  assert.deepEqual(preschoolGoalsFor("Hindi — Written"), ["Effective Communicators"]);
  assert.deepEqual(preschoolGoalsFor("Music, rhymes & movement"), ["Effective Communicators", "Health and Well-being"], "rhymes are communication, movement is well-being");
  assert.deepEqual(preschoolGoalsFor("Socio-emotional & ethical development"), ["Health and Well-being"]);
  assert.deepEqual(preschoolGoalsFor("Positive learning habits & self-help"), ["Health and Well-being"]);
  assert.deepEqual(preschoolGoalsFor("Art Education"), ["Effective Communicators", "Health and Well-being"]);
  assert.deepEqual(preschoolGoalsFor("Computational Thinking / ICT"), []);
  assert.deepEqual(preschoolGoalsFor(""), []);

  // DIKSHA's own spellings of outcome codes.
  const outcomeCases: [string, string][] = [
    ["IL 2.9 Counts and perceives objects up to five", "Counts and perceives objects up to five"],
    ["IL 2.3a Remembers and recalls 3–4 objects seen at a time", "Remembers and recalls 3–4 objects seen at a time"],
    ["IL 2. 30 Demonstrates awareness about technology like T.V., mobile phones.", "Demonstrates awareness about technology like T.V., mobile phones."],
    ["ECL1 1.1 a Attempts to engage in conversation or small talk with known, ...", "Attempts to engage in conversation or small talk with known, ..."],
    ["ECL2-2.5 Identifies few letters and sounds", "Identifies few letters and sounds"],
    ["HW 2.9 Suggests solutions to conflicts (with the support of adults)", "Suggests solutions to conflicts (with the support of adults)"],
    ["HW2.14 Demonstrates awareness about good touch and bad touch (with guidance from parents and teachers)", "Demonstrates awareness about good touch and bad touch (with guidance from parents and teachers)"],
    ["Key Competencies", "Key Competencies"],
  ];
  for (const [raw, clean] of outcomeCases) assert.equal(cleanOutcomeName(raw), clean, raw);
  const long = cleanOutcomeName(`IL 3.1 ${"observes ".repeat(20)}`);
  assert.ok(long.length <= 100 && long.endsWith("…"), "a long outcome is cut at a word, marked");

  const ppBooks: SyllabusBook[] = [
    { id: "il2", medium: "English", subjects: ["Involved Learners"], name: "Children become involved learners (IL) Preschool 2" },
    { id: "ec2", medium: "English", subjects: ["Effective Communicators"], name: "CHILDREN BECOME EFFECTIVE COMMUNICATORS (EC) Pre School 2 DG 2" },
    { id: "hw2", medium: "English", subjects: ["Health and Well-being"], name: "HEALTH AND WELL BEING (HW) Pre School 2 DG 1" },
  ];
  const ppChapters: SyllabusChapter[] = [
    { textbookId: "il2", position: 1, name: "Key Competencies" },
    { textbookId: "il2", position: 3, name: "IL 2.11 Identifies numerals with corresponding numbers up to 5" },
    { textbookId: "il2", position: 2, name: "IL 2.9 Counts and perceives objects up to five" },
    { textbookId: "ec2", position: 1, name: "Key Competencies" },
    { textbookId: "ec2", position: 2, name: "ECL2-2.2 Sings short poems and rhymes" },
    { textbookId: "ec2", position: 3, name: "ECL2-1.6 Spends time in reading area or play area." },
    { textbookId: "ec2", position: 4, name: "ECL2-1.4 a Spends time in reading area or play area." },
    { textbookId: "hw2", position: 2, name: "HW2.14 Demonstrates awareness about good touch and bad touch (with guidance from parents and teachers)" },
  ];
  const all = outcomesListing({ grade: -1, books: ppBooks, chapters: ppChapters });
  assert.deepEqual(all.split("\n"), [
    "NCERT's minimum for LKG (DIKSHA Preschool 2), from NCERT's pre-primary competency books. The school teaches pre-primary from its own publisher books, which go further than this.",
    "Involved Learners: Counts and perceives objects up to five; Identifies numerals with corresponding numbers up to 5",
    "Effective Communicators: Sings short poems and rhymes; Spends time in reading area or play area.",
    "Health and Well-being: Demonstrates awareness about good touch and bad touch (with guidance from parents and teachers)",
  ], "goals in a fixed order, outcomes in book order, overviews and repeats dropped, the header says minimum and names the school's books");
  const numeracy = outcomesListing({ grade: -1, books: ppBooks, chapters: ppChapters, subjectLabel: "Early Numeracy", coreFallback: false });
  assert.equal(numeracy.split("\n").length, 2, "a subject narrows to its goal");
  assert.ok(numeracy.includes("Involved Learners:"));
  assert.equal(outcomesListing({ grade: -1, books: ppBooks, chapters: ppChapters, subjectLabel: "Computational Thinking / ICT", coreFallback: false }), "", "no goal for the subject and no fallback → nothing");
  assert.equal(outcomesListing({ grade: -1, books: ppBooks, chapters: ppChapters, subjectLabel: "Computational Thinking / ICT" }), all, "no goal → all three for the tutor");
  assert.equal(outcomesListing({ grade: 3, books: ppBooks, chapters: ppChapters }), "", "not a pre-primary grade");
  assert.equal(outcomesListing({ grade: -2, books: [], chapters: [] }), "", "nothing indexed → no block");
  assert.match(outcomesListing({ grade: -2, books: ppBooks, chapters: ppChapters }), /^NCERT's minimum for Nursery \(DIKSHA Preschool 1\)/);

  const block = outcomesPromptBlock({ grade: -1, books: ppBooks, chapters: ppChapters });
  assert.ok(block.startsWith(all));
  assert.match(block, /not a ceiling — the child's own book may ask for more/);
  assert.match(block, /Never quote outcome codes, and never name an NCERT book or chapter: pre-primary has none/);
  assert.doesNotMatch(block, /IL ?\d|ECL\d|HW ?\d/, "no outcome code reaches the prompt");
}


// ── Chapter topics: listed for one subject only, capped, never the book ──
{
  const sBooks: SyllabusBook[] = [
    { id: "sm6", medium: "English", subjects: ["Mathematics"], name: "Propel New Prime Mathematics Coursebook Grade 6" },
    { id: "se6", medium: "English", subjects: ["English"], name: "Propel New Prime English Coursebook Grade 6" },
  ];
  const long = "x".repeat(200);
  const sChapters: SyllabusChapter[] = [
    { textbookId: "sm6", position: 5, name: "Factors and Multiples", topics: ["Prime Factorisation", "Highest Common Factor", "  Lowest   Common Multiple (LCM) "] },
    { textbookId: "sm6", position: 6, name: "Perimeter and Area" },
    { textbookId: "se6", position: 1, name: "Uncle Ken on the Job", topics: ["a", "b", "c", "d", "e", "f", "g", "h", "i", "j", long] },
  ];

  const maths = textbooksPromptBlock({ grade: 6, books: sBooks, chapters: sChapters, subjectLabel: "Maths" });
  assert.match(maths, /5\. Factors and Multiples \[Prime Factorisation, Highest Common Factor, Lowest Common Multiple \(LCM\)\]; 6\. Perimeter and Area$/m, "one subject → topics in brackets, spaces tidied; a chapter without topics has no brackets");
  assert.match(maths, /The words in \[brackets\] after a chapter are the topics it covers/, "and the model is told what the brackets are");
  assert.match(maths, /not the book's text: explain in your own words/);

  const all = textbooksPromptBlock({ grade: 6, books: sBooks, chapters: sChapters });
  assert.ok(!all.includes("["), "every subject at once → titles only, no topics and no brackets rule");

  const eng = textbooksListing({ grade: 6, books: sBooks, chapters: sChapters, subjectLabel: "English", coreFallback: false });
  const kept = eng.match(/\[(.*)\]/)![1]!.split(", ");
  assert.equal(kept.length, CHAPTER_TOPICS_MAX, `at most ${CHAPTER_TOPICS_MAX} topics per chapter`);
  assert.ok(!eng.includes(long), "an over-long topic never reaches the prompt whole");

  const none = textbooksPromptBlock({ grade: 6, books: sBooks, chapters: sChapters.map((c) => ({ ...c, topics: undefined })), subjectLabel: "Maths" });
  assert.ok(!none.includes("[brackets]"), "no topics loaded → the prompt is exactly as before");
}


// ── Pre-primary: the school's books (units, no numbers) above NCERT's minimum
{
  const pBooks: SyllabusBook[] = [
    { id: "lw-e", medium: "English", subjects: ["English"], name: "Propel Little Wonder English Literacy Coursebook LKG" },
    { id: "lw-m", medium: "English", subjects: ["Mathematics"], name: "Propel Little Wonder Numeracy Coursebook LKG" },
  ];
  const pChapters: SyllabusChapter[] = [
    { textbookId: "lw-e", position: 1, name: "Story—Who Gets the Apple?" },
    { textbookId: "lw-e", position: 2, name: "Letter Aa", topics: ["alligator", "apple"] },
    { textbookId: "lw-m", position: 1, name: "Shapes", topics: ["circle", "square"] },
  ];
  const english = preschoolPromptBlock({ grade: -1, school: { books: pBooks, chapters: pChapters }, ncert: { books: [], chapters: [] }, subjectLabel: "English" });
  assert.match(english, /^Books: the books this school's LKG children use, unit by unit in book order/, "pre-primary header names the year, not a class number");
  assert.match(english, /Propel Little Wonder English Literacy Coursebook LKG: Story—Who Gets the Apple\?; Letter Aa \[alligator, apple\]$/m, "units in book order, no numbers, topics for one subject");
  assert.ok(!/\b1\. /.test(english), "no chapter numbers for pre-primary");
  assert.match(english, /never invent one/, "the rule forbids a chapter number");
  assert.ok(!english.includes("Numeracy"), "only the asked subject");

  const none = preschoolPromptBlock({ grade: -1, school: { books: [], chapters: [] }, ncert: { books: [], chapters: [] } });
  assert.equal(none, "", "nothing loaded → nothing, as before");

  // Classes 1–8 keep their numbers.
  const c3 = textbooksListing({ grade: 3, books: [{ ...pBooks[1]!, name: "Maths 3" }], chapters: [{ textbookId: "lw-m", position: 1, name: "Numbers" }] });
  assert.match(c3, /Maths 3: 1\. Numbers/);
}

console.log("tutorSyllabus.selftest: ok");
