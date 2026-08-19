import assert from "node:assert/strict";

import {
  addQuestionsToBank,
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

console.log("OK — questionBank.selftest.ts");
