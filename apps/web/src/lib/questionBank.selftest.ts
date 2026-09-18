import assert from "node:assert/strict";

import {
  addQuestionsToBank,
  applyImportedSets,
  bankImportedQuestions,
  assembleSectionsFromCells,
  blueprintTotalMarks,
  emptyExamPapersState,
  emptyQuestion,
  fillBlueprintFromBank,
  listBank,
  matchBankForRow,
  normalizeExamPapersState,
  removeFromBank,
  takeFromBank,
  upsertBlueprint,
  type ExamBlueprintRow,
} from "./examPapers";

console.log("questionBank.selftest.ts");

const ctx = { classId: "c8", subjectId: "math" };
const q = (over: Partial<Parameters<typeof emptyQuestion>[0]>) =>
  emptyQuestion({ text: "x", marks: 2, type: "mcq", hardness: "medium", ...over });

// add + dedupe + tags
let st = emptyExamPapersState();
{
  const r = addQuestionsToBank(st, {
    ...ctx,
    by: "t1",
    tags: ["ch3", " "],
    questions: [
      q({ id: "p1", text: "What is a rhombus?", unitId: "u1", competencyCode: "M801" }),
      q({ id: "p2", text: "  what is a RHOMBUS? " }), // dup by normalised text
      q({ id: "p3", text: "Find angle x.", type: "numerical", marks: 3, unitId: "u1", competencyCode: "M802", hardness: "hard" }),
    ],
  });
  st = r.state;
  assert.equal(r.added, 2, "duplicate text skipped");
  assert.equal(st.bank.length, 2);
  assert.notEqual(st.bank[0].question.id, "p1", "bank copy gets its own question id");
  assert.equal(st.bank[0].question.source, "bank");
  assert.deepEqual(st.bank[0].tags, ["ch3"]);
  // adding the same again to another class is allowed
  const r2 = addQuestionsToBank(st, { classId: "c9", subjectId: "math", by: "t1", questions: [q({ text: "What is a rhombus?" })] });
  assert.equal(r2.added, 1);
}

// list filters
{
  assert.equal(listBank(st, { classId: "c8", subjectId: "math" }).length, 2);
  assert.equal(listBank(st, { classId: "c8", subjectId: "math", type: "numerical" }).length, 1);
  assert.equal(listBank(st, { search: "M802" }).length, 1, "search covers LO code");
  assert.equal(listBank(st, { classId: "c9" }).length, 0);
}

// blueprint upsert + totals; rows with 0 count are dropped
{
  const r = upsertBlueprint(st, {
    ...ctx,
    by: "t1",
    academicYearCode: "2026-27",
    title: "PT1 pattern",
    rows: [
      { id: "r1", unitId: "u1", questionType: "mcq", marks: 2, count: 2, hardness: "mixed", competencyCode: "" },
      { id: "r2", unitId: "u1", questionType: "numerical", marks: 3, count: 1, hardness: "hard", competencyCode: "M802" },
      { id: "r3", unitId: "", questionType: "long", marks: 5, count: 0, hardness: "mixed", competencyCode: "" },
    ],
  });
  assert.ok(r.ok);
  if (!r.ok) throw new Error();
  st = r.state;
  assert.equal(r.blueprint.rows.length, 2, "0-count row dropped");
  assert.equal(blueprintTotalMarks(r.blueprint), 7);
  const bad = upsertBlueprint(st, { ...ctx, by: "t1", rows: [] });
  assert.equal(bad.ok, false);
}

// matching honours type, marks, unit, LO, hardness
{
  const row: ExamBlueprintRow = { id: "r", unitId: "u1", questionType: "numerical", marks: 3, count: 1, hardness: "hard", competencyCode: "M802" };
  assert.equal(matchBankForRow(st, ctx, row).length, 1);
  assert.equal(matchBankForRow(st, ctx, { ...row, hardness: "easy" }).length, 0, "hardness must match unless mixed");
  assert.equal(matchBankForRow(st, ctx, { ...row, marks: 2 }).length, 0, "marks must match");
  assert.equal(matchBankForRow(st, ctx, { ...row, competencyCode: "" }).length, 1, "row without LO accepts any");
  assert.equal(matchBankForRow(st, { classId: "c9", subjectId: "math" }, row).length, 0);
}

// fill from bank: mcq row wants 2, bank has 1 → 1 taken, 1 missing; use counts bump; no double-take
{
  const bp = st.blueprints[0];
  const r = fillBlueprintFromBank(st, ctx, bp.rows);
  const mcq = r.cells.find((c) => c.row.questionType === "mcq")!;
  assert.equal(mcq.taken.length, 1);
  assert.equal(mcq.missing, 1);
  const num = r.cells.find((c) => c.row.questionType === "numerical")!;
  assert.equal(num.taken.length, 1);
  assert.equal(num.missing, 0);
  assert.ok(r.state.bank.every((b) => b.usedCount === 1), "each pulled item counted once");
  assert.notEqual(mcq.taken[0].id, st.bank[0].question.id, "paper copy has a new id");
  // assemble → mcq before numerical
  const sections = assembleSectionsFromCells(r.cells.map((c) => ({ row: c.row, questions: c.taken })));
  assert.deepEqual(sections.map((s) => s.title), ["Section A — Multiple choice", "Section B — Numerical / sum"]);
  assert.equal(sections[0].instructions, "1 question × 2 marks.");
}

// take/remove + normalize round-trip keeps bank & blueprints
{
  const t = takeFromBank(st, st.bank[1].id)!;
  assert.equal(t.question.source, "bank");
  assert.equal(t.state.bank[1].usedCount, 1);
  const removed = removeFromBank(st, st.bank[0].id);
  assert.equal(removed.bank.length, 1);
  const round = normalizeExamPapersState(JSON.parse(JSON.stringify(st)));
  assert.equal(round.bank.length, 2);
  assert.equal(round.blueprints.length, 1);
  assert.equal(normalizeExamPapersState({ papers: [] }).bank.length, 0, "old blobs without bank still load");
}

// An import fills the bank as well as the papers — otherwise the questions
// are only reprintable, never reusable.
{
  const question = (text: string, marks: number) =>
    emptyQuestion({ text, marks, images: [{ id: "i1", dataUrl: "/api/file/x.png", caption: "", labels: [] }] });
  const set = (code: string, texts: string[]) => ({
    id: `set_${code}`,
    setCode: code,
    label: `Summative Assessment 1 - Set ${code}`,
    sections: [
      { id: `sec_${code}`, title: "Section A", instructions: "", questions: texts.map((t) => question(t, 2)) },
    ],
    source: {
      fileName: `set-${code}.docx`,
      filePath: `exam-papers/x/${code}.docx`,
      fileUrl: `/api/file/exam-papers/x/${code}.docx`,
      fileHash: `hash-${code}`,
      publisherLabel: `Summative Assessment 1 - Set ${code}`,
      importedAt: "2026-09-18T00:00:00.000Z",
      importedBy: "test",
    },
  });

  const input = {
    targetPaperId: "",
    academicYearCode: "2026-27",
    examTermId: "term_hy",
    classId: "cls_6",
    subjectId: "sub_mat",
    examCode: "HY",
    examName: "HY · Half-yearly",
    className: "VI",
    subjectCode: "MAT",
    title: "Half-yearly · VI · Mathematics",
    maxMarks: 80,
    durationMinutes: 180,
    // Two sets that share a question — the shared one must bank once.
    sets: [set("A", ["Find the HCF of 42 and 70.", "Draw a pentagon."]), set("B", ["Find the HCF of 42 and 70.", "Name two prime numbers."])],
  };

  const filed = applyImportedSets(emptyExamPapersState(), [input], "test");
  assert.equal(filed.created, 1);

  const banked = bankImportedQuestions(filed.state, [input], "test");
  assert.equal(banked.added, 3, "four questions, one of them shared, bank as three");

  const forClass = listBank(banked.state, { classId: "cls_6", subjectId: "sub_mat" });
  assert.equal(forClass.length, 3);
  assert.equal(
    listBank(banked.state, { classId: "cls_7", subjectId: "sub_mat" }).length,
    0,
    "a bank item belongs to one class and subject",
  );
  assert.deepEqual(
    forClass[0]!.question.images.map((i) => i.dataUrl),
    ["/api/file/x.png"],
    "the picture comes along as a stored URL, not a second copy of the file",
  );
  assert.ok(
    forClass[0]!.tags.includes("HY"),
    "tagged with the exam so a teacher can search by it",
  );
  assert.equal(
    listBank(banked.state, { classId: "cls_6", subjectId: "sub_mat", search: "hcf" }).length,
    1,
    "and found by its text",
  );

  // Re-importing the same folder must not double the bank.
  const again = bankImportedQuestions(banked.state, [input], "test");
  assert.equal(again.added, 0);
  assert.equal(again.state.bank.length, 3);

  // A bank item is a copy: editing it leaves the printed paper alone.
  const taken = takeFromBank(again.state, forClass[0]!.id);
  assert.ok(taken);
  assert.notEqual(taken.question.id, forClass[0]!.question.id);
}

console.log("OK — questionBank.selftest.ts");
