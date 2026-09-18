import assert from "node:assert/strict";
import {
  classifyExam,
  defaultImportMappings,
  mergeImportMappings,
  parseImportPath,
  parsePaperBody,
  planPaperImport,
  readPaperHeader,
  readSetNumber,
  splitInlineOptions,
  type ImportCatalog,
  type ImportFileFacts,
} from "./examPaperImport";

console.log("examPaperImport.selftest.ts");

const ids = {
  questionId: (n: number) => `q${n}`,
  sectionId: (n: number) => `sec${n}`,
};

const catalog: ImportCatalog = {
  academicYearCode: "2026-27",
  classes: [
    { id: "cls_nur", name: "Nursery" },
    { id: "cls_5", name: "V" },
    { id: "cls_6", name: "VI" },
    { id: "cls_7", name: "VII" },
  ],
  subjects: [
    { id: "sub_mat", code: "MAT", nameEn: "Mathematics" },
    { id: "sub_hin", code: "HIN", nameEn: "Hindi" },
    { id: "sub_eng", code: "ENG", nameEn: "English" },
    { id: "sub_sci", code: "SCI", nameEn: "Science" },
  ],
  terms: [
    { id: "term_ut1", code: "UT1", label: "Unit Test 1", academicYearCode: "2026-27", maxMarks: 40 },
    { id: "term_hy", code: "HY", label: "Half-yearly", academicYearCode: "2026-27", maxMarks: 80 },
    { id: "term_ann", code: "ANNUAL", label: "Annual", academicYearCode: "2026-27", maxMarks: 80 },
  ],
};
const mappings = defaultImportMappings();

/* -------------------------------------------------------------------------- */
/* Paths                                                                      */
/* -------------------------------------------------------------------------- */

{
  const p = parseImportPath(
    "Class6/Division A/Math/Editable/MOY/Summative Assessment 1 - Set 1/x_Question Paper_paper_doc.docx",
  );
  assert.ok(p);
  assert.equal(p.classFolder, "Class6");
  assert.equal(p.subjectFolder, "Math", "Division A and Editable are wrappers, not the subject");
  assert.equal(p.bucketFolder, "MOY");
  assert.equal(p.paperFolder, "Summative Assessment 1 - Set 1");
}

{
  // Publishers drop levels; the same reading must still work.
  const p = parseImportPath("Class6/Math/Formative Assessment 1 - Set 2/paper.docx");
  assert.ok(p);
  assert.equal(p.subjectFolder, "Math");
  assert.equal(p.paperFolder, "Formative Assessment 1 - Set 2");
}

{
  // A browser puts the picked folder's own name in front of every path. The
  // class is found by what the school has mapped, not by counting segments.
  const knows = (w: string) => !!mappings.classes[w.toLowerCase().replace(/\s+/g, "")];
  const p = parseImportPath(
    "Lead Assessments 2/Class6/Division A/Math/Editable/MOY/Summative Assessment 1 - Set 1/x.docx",
    knows,
  );
  assert.ok(p);
  assert.equal(p.classFolder, "Class6", "not the folder the office happened to pick");
  assert.equal(p.subjectFolder, "Math");
  assert.equal(p.paperFolder, "Summative Assessment 1 - Set 1");

  // Picking one class folder instead must still read the same way.
  const q = parseImportPath("Class6/Division A/Math/Editable/MOY/Set 1/x.docx", knows);
  assert.equal(q?.classFolder, "Class6");
  assert.equal(q?.subjectFolder, "Math");

  // Nothing recognisable: the first segment is reported, so the school can
  // see the word it has to map rather than the file vanishing.
  const r = parseImportPath("Downloads/Std 6/Math/Set 1/x.docx", knows);
  assert.equal(r?.classFolder, "Downloads");
}

assert.equal(parseImportPath("Class6/Math/notes.pdf"), null, "only .docx");
assert.equal(parseImportPath("paper.docx"), null, "a loose file has no class");

/* -------------------------------------------------------------------------- */
/* Header                                                                     */
/* -------------------------------------------------------------------------- */

{
  const h = readPaperHeader([
    "------------------------------",
    "Class6",
    "Summative Assessment 1 - Set 1",
    "Math",
    "Name: ..........",
    "Date: ......",
    "Max. Marks: 80",
    "Time: 180 min.",
    "------------------------------",
    "Instructions:",
    "Read the questions carefully.",
  ]);
  assert.equal(h.docClass, "Class6");
  assert.equal(h.docTitle, "Summative Assessment 1 - Set 1");
  assert.equal(h.docSubject, "Math");
  assert.equal(h.maxMarks, 80);
  assert.equal(h.durationMinutes, 180);
}

{
  // Every pre-primary paper in the school's download states a time and no marks.
  const h = readPaperHeader(["Nursery", "Formative Assessment 1 - Set 1", "Numeracy", "Time: 40 min."]);
  assert.equal(h.maxMarks, 0, "absent marks stay absent — not 0 pretending to be a total");
  assert.equal(h.durationMinutes, 40);
}

{
  const h = readPaperHeader(["Class9", "Annual", "Science", "Time: 2.5 hours"]);
  assert.equal(h.durationMinutes, 150, "hours are converted");
}

/* -------------------------------------------------------------------------- */
/* Which exam                                                                 */
/* -------------------------------------------------------------------------- */

{
  // The case that made this rule: a Half-Yearly paper filed under Assessment 2.
  const guess = classifyExam(
    {
      docTitle: "BHB INTERNATIONAL SCHOOL - HALF YEARLY EXAMINATION",
      paperFolder: "BHB INTERNATIONAL SCHOOL - HALF YEARLY EXAMINATION",
      bucketFolder: "Assessment 2",
    },
    mappings,
  );
  assert.equal(guess.code, "HY");
  assert.equal(guess.from, "title", "the paper outranks the folder it was put in");
}

{
  const guess = classifyExam(
    { docTitle: "Formative Assessment 1 - Set 1", paperFolder: "", bucketFolder: "MOY" },
    mappings,
  );
  assert.equal(guess.code, "UT1");
}

{
  const guess = classifyExam(
    { docTitle: "Summative Assessment 2 - Set 1", paperFolder: "", bucketFolder: "" },
    mappings,
  );
  assert.equal(guess.code, "ANNUAL", "longest phrase wins over the shorter prefix");
}

{
  // A title that names only the school says nothing about which exam it is.
  const guess = classifyExam(
    { docTitle: "BHB INTERNATIONAL SCHOOL", paperFolder: "BHB INTERNATIONAL SCHOOL", bucketFolder: "Assessment 2" },
    mappings,
  );
  assert.equal(guess.code, "", "unknown stays unknown");
}

assert.equal(readSetNumber("Summative Assessment 1 - Set 3"), 3);
assert.equal(readSetNumber("Formative Assessment 1"), 1, "no set stated → the first");
assert.equal(readSetNumber("Paper - Set II"), 2);

/* -------------------------------------------------------------------------- */
/* Body                                                                       */
/* -------------------------------------------------------------------------- */

{
  const body = parsePaperBody(
    [
      "Section A",
      "Choose the correct option.",
      "(2×1=2 marks)",
      "1)",
      "Which angle is obtuse?",
      "(i)",
      "45°",
      "(ii)",
      "120°",
      "(1 mark)",
      "2)",
      "State true or false: parallel lines meet.",
      "(1 mark)",
      "Section B",
      "Answer the following.",
      "(1×4=4 marks)",
      "3)",
      "Three bells ring at 36, 45 and 60 minutes. [[img:rId9]]",
      "(4 marks)",
    ],
    ids,
  );
  assert.equal(body.sections.length, 2);
  assert.equal(body.questionCount, 3);
  assert.equal(body.parsedMarks, 6);
  assert.equal(body.unassignedMarks, 0);

  const [a, b] = body.sections;
  assert.equal(a!.questions[0]!.type, "mcq");
  assert.deepEqual(a!.questions[0]!.options, ["45°", "120°"], "a marker in its own cell takes the next line");
  assert.equal(a!.questions[1]!.type, "true_false");
  assert.equal(b!.questions[0]!.marks, 4);
  assert.deepEqual(
    b!.questions[0]!.images.map((i) => i.id),
    ["rId9"],
    "the picture is noted against the question",
  );
  assert.equal(
    b!.questions[0]!.images[0]!.dataUrl,
    "",
    "and left without a URL until one has actually been stored",
  );
  assert.ok(!b!.questions[0]!.text.includes("[[img"), "the token itself never reaches the question text");
}

{
  // Hindi papers print their marks in Hindi. Reading them as zero made every
  // Hindi paper in the school's folder look like it was worth nothing.
  const body = parsePaperBody(
    [
      "Section A",
      "उचित विकल्प चुनिए —",
      "(2×1=2 अंक)",
      "1)",
      "'नौ दो ग्यारह होना' का अर्थ चुनिए—",
      "(i) प्रश्न हल करना (ii) भाग जाना",
      "(1 अंक)",
      "2)",
      "रिक्त स्थान भरिए।",
      "(1 अंक)",
    ],
    ids,
  );
  assert.equal(body.parsedMarks, 2);
  assert.deepEqual(
    body.sections[0]!.questions[0]!.options,
    ["प्रश्न हल करना", "भाग जाना"],
    "two options printed on one line are two options",
  );
}

{
  // An oral component carries marks with nothing printed to attach them to.
  const body = parsePaperBody(
    ["Section A", "(1×4=4 marks)", "1)", "Name two fruits.", "(4 marks)", "Section B", "Oral Questions", "(10 marks)"],
    ids,
  );
  assert.equal(body.parsedMarks, 4);
  assert.equal(body.unassignedMarks, 10, "counted, but never turned into a question nobody wrote");
  assert.deepEqual(body.unassignedSections, ["Section B"]);
  assert.equal(body.questionCount, 1);
}

{
  // A case study states its own total and then its parts. Counting both would
  // make every paper with one over-total.
  const body = parsePaperBody(
    ["Section E", "Case-Based Questions", "(1×4=4 marks)", "1)", "A tile pattern grows by 5 each row.", "(4 marks)", "a)", "How many in row three?", "(1 mark)", "b)", "How many in seven rows?", "(3 marks)"],
    ids,
  );
  assert.equal(body.parsedMarks, 4, "the parent's marks, not the parent plus its parts");
  assert.equal(body.sections[0]!.questions[0]!.type, "case_study");
  assert.match(body.sections[0]!.questions[0]!.text, /a\) How many in row three\?/);
}

assert.deepEqual(splitInlineOptions("(i) red (ii) blue (iii) green"), ["red", "blue", "green"]);
assert.deepEqual(
  splitInlineOptions("Choose (i) carefully"),
  [],
  "one marker inside a sentence is not an option list",
);
assert.deepEqual(
  splitInlineOptions("Compare (i) and (ii) below"),
  [],
  "a line that does not start with a marker is prose",
);

/* -------------------------------------------------------------------------- */
/* Planning                                                                   */
/* -------------------------------------------------------------------------- */

function facts(
  relPath: string,
  over: Partial<ImportFileFacts> & { docClass?: string; docTitle?: string; docSubject?: string } = {},
): ImportFileFacts {
  const folder = relPath.split("/").slice(-2)[0] ?? "";
  return {
    relPath,
    fileHash: over.fileHash ?? `hash-${relPath}`,
    header: {
      docClass: over.docClass ?? (relPath.split("/")[0] ?? ""),
      docTitle: over.docTitle ?? folder,
      docSubject: over.docSubject ?? (relPath.split("/")[1] ?? ""),
      maxMarks: over.header?.maxMarks ?? 80,
      durationMinutes: 180,
    },
    questionCount: over.questionCount ?? 10,
    parsedMarks: over.parsedMarks ?? 80,
    unassignedMarks: over.unassignedMarks,
    unassignedSections: over.unassignedSections,
    readError: over.readError,
  };
}

{
  // Sets of one paper, including the gap where the school has 1 and 3 but no 2.
  const plan = planPaperImport({
    files: [
      facts("Class5/Science/Summative Assessment 1 - Set 1/a.docx"),
      facts("Class5/Science/Summative Assessment 1 - Set 3/b.docx"),
    ],
    catalog,
    mappings,
    existing: [],
  });
  assert.equal(plan.counts.import, 2);
  assert.equal(plan.groups.length, 1, "two sets, one paper");
  assert.deepEqual(plan.groups[0]!.rows.map((r) => r.setCode), ["A", "C"]);
  assert.equal(plan.groups[0]!.rows[1]!.publisherLabel, "Summative Assessment 1 - Set 3");
  assert.equal(plan.groups[0]!.examTermId, "term_hy");
  assert.equal(plan.groups[0]!.classId, "cls_5");
}

{
  // Re-running the same folder must not make second copies.
  const file = facts("Class6/Math/Summative Assessment 1 - Set 1/a.docx");
  const plan = planPaperImport({
    files: [file],
    catalog,
    mappings,
    existing: [
      {
        paperId: "ep_1",
        academicYearCode: "2026-27",
        examTermId: "term_hy",
        classId: "cls_6",
        subjectId: "sub_mat",
        sets: [{ setCode: "A", fileHash: file.fileHash }],
      },
    ],
  });
  assert.equal(plan.counts.duplicate, 1);
  assert.equal(plan.counts.import, 0);
  assert.match(plan.rows[0]!.reasons[0]!, /has not changed/);
}

{
  // A changed paper joins the existing one as the next free set.
  const plan = planPaperImport({
    files: [facts("Class6/Math/Summative Assessment 1 - Set 1/a.docx", { fileHash: "new" })],
    catalog,
    mappings,
    existing: [
      {
        paperId: "ep_1",
        academicYearCode: "2026-27",
        examTermId: "term_hy",
        classId: "cls_6",
        subjectId: "sub_mat",
        sets: [{ setCode: "A", fileHash: "old" }],
      },
    ],
  });
  assert.equal(plan.counts.import, 1);
  assert.equal(plan.rows[0]!.targetPaperId, "ep_1", "it joins the paper, it does not replace it");
  assert.equal(plan.rows[0]!.setCode, "B");
  assert.match(plan.rows[0]!.warnings.join(" "), /already taken/);
}

{
  // An unknown subject is named, not guessed at and not dropped.
  const plan = planPaperImport({
    files: [facts("Class6/Moral Science/Formative Assessment 1 - Set 1/a.docx")],
    catalog,
    mappings,
    existing: [],
  });
  assert.equal(plan.counts.needs_mapping, 1);
  assert.deepEqual(plan.unmapped, ["subject:Moral Science"]);
  assert.equal(plan.rows[0]!.subjectId, "");
}

{
  // Once the school teaches it the word, the same file goes through.
  const learned = mergeImportMappings({ subjects: { "moral science": "ENG" } });
  const plan = planPaperImport({
    files: [facts("Class6/Moral Science/Formative Assessment 1 - Set 1/a.docx", { docSubject: "Moral Science" })],
    catalog,
    mappings: learned,
    existing: [],
  });
  assert.equal(plan.counts.import, 1);
  assert.equal(plan.rows[0]!.subjectId, "sub_eng");
}

{
  // The document disagreeing with the folder is the one case where neither
  // wins: a human looks.
  const plan = planPaperImport({
    files: [facts("Class6/Math/Summative Assessment 1 - Set 1/a.docx", { docClass: "Class7" })],
    catalog,
    mappings,
    existing: [],
  });
  assert.equal(plan.counts.rejected, 1);
  assert.match(plan.rows[0]!.reasons[0]!, /Filed under Class6 but the paper says "Class7"/);
}

{
  // A paper with nothing readable in it is not an empty paper.
  const plan = planPaperImport({
    files: [facts("Class6/Math/Summative Assessment 1 - Set 1/a.docx", { questionCount: 0, parsedMarks: 0 })],
    catalog,
    mappings,
    existing: [],
  });
  assert.equal(plan.counts.rejected, 1);
  assert.match(plan.rows[0]!.reasons.join(" "), /No questions could be read/);
}

{
  // Marks are reported and never corrected — not the paper's, not the term's.
  const plan = planPaperImport({
    files: [
      facts("Class6/Math/Formative Assessment 1 - Set 1/a.docx", {
        header: { docClass: "", docTitle: "", docSubject: "", maxMarks: 20, durationMinutes: 60 },
        parsedMarks: 20,
      }),
    ],
    catalog,
    mappings,
    existing: [],
  });
  assert.equal(plan.counts.import, 1);
  assert.match(
    plan.rows[0]!.warnings.join(" | "),
    /Unit Test 1 is set to 40 marks in the exams desk; this paper is 20/,
  );
}

{
  // An oral section's marks explain a gap instead of looking like a bad parse.
  const plan = planPaperImport({
    files: [
      facts("Class6/Math/Summative Assessment 1 - Set 1/a.docx", {
        header: { docClass: "", docTitle: "", docSubject: "", maxMarks: 100, durationMinutes: 180 },
        parsedMarks: 80,
        unassignedMarks: 20,
        unassignedSections: ["Section G"],
      }),
    ],
    catalog,
    mappings,
    existing: [],
  });
  const warnings = plan.rows[0]!.warnings.join(" | ");
  assert.match(warnings, /20 marks sit in a section with no printed questions \(Section G\)/);
  assert.doesNotMatch(warnings, /Questions add up to/, "80 + 20 reconciles with the stated 100");
}

{
  // No exam of that name in this year is a different problem from an
  // unrecognised word, and says so.
  const thin: ImportCatalog = { ...catalog, terms: [catalog.terms[0]!] };
  const plan = planPaperImport({
    files: [facts("Class6/Math/Summative Assessment 1 - Set 1/a.docx")],
    catalog: thin,
    mappings,
    existing: [],
  });
  assert.equal(plan.counts.rejected, 1);
  assert.match(plan.rows[0]!.reasons.join(" "), /No HY exam exists in 2026-27/);
}

console.log("OK — examPaperImport.selftest.ts");
