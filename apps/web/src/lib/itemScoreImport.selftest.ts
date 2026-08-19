import assert from "node:assert/strict";
import { itemScoreTemplateCsv, parseItemScoreGrid } from "./itemScoreImport";

console.log("itemScoreImport.selftest.ts");

const students = [
  { id: "s1", admissionNo: "BHB-1001", rollNo: "1", fullName: "Aarav Singh" },
  { id: "s2", admissionNo: "BHB-1002", rollNo: "2", fullName: "Riya Verma" },
  { id: "s3", admissionNo: "", rollNo: "3", fullName: "Kabir Das" },
];
const questions = [
  { id: "q1", marks: 2 },
  { id: "q2", marks: 3 },
  { id: "q3", marks: 5 },
];

// template round-trip header
const tpl = itemScoreTemplateCsv(students, questions);
assert.match(tpl.split("\n")[0], /^Admission No,Roll,Student,Q1 \(\/2\),Q2 \(\/3\),Q3 \(\/5\)$/);
assert.equal(tpl.split("\n").length, 4);

// CSV by admission no; absent; blank; over-max; bad number; unmatched row
{
  const csv = [
    "Admission No,Student,Q1 (/2),Q2 (/3),Q3 (/5)",
    "BHB-1001,Aarav Singh,2,3,4",
    "BHB-1002,Riya Verma,AB,,7",
    "3,Kabir Das,1,x,5",
    "BHB-9999,Nobody,1,1,1",
  ].join("\n");
  const r = parseItemScoreGrid(csv, { students, questions });
  assert.deepEqual(r.questionColumns, ["Q1 (/2)", "Q2 (/3)", "Q3 (/5)"]);
  assert.equal(r.matched, 3);
  assert.deepEqual(r.unmatchedRows, [{ row: 4, key: "BHB-9999" }]);
  const s1 = r.scores.filter((s) => s.studentId === "s1").map((s) => s.marks);
  assert.deepEqual(s1, [2, 3, 4]);
  const s2 = r.scores.filter((s) => s.studentId === "s2");
  assert.deepEqual(s2.map((s) => s.marks), [null, null], "AB and blank → null; 7 over max skipped");
  assert.deepEqual(r.problems.map((p) => `${p.row}:${p.question}:${p.reason}`), ["2:Q3 (/5):above max 5", "3:Q2 (/3):not a number"]);
  const s3 = r.scores.filter((s) => s.studentId === "s3").map((s) => s.marks);
  assert.deepEqual(s3, [1, 5], "matched by roll no");
}

// TSV pasted from a sheet, columns in a different order, name match with odd spacing
{
  const tsv = ["Student\tQ2\tQ1", "riya  verma\t1\t2"].join("\n");
  const r = parseItemScoreGrid(tsv, { students, questions });
  assert.equal(r.matched, 1);
  assert.deepEqual(
    r.scores.map((s) => `${s.questionId}=${s.marks}`),
    ["q2=1", "q1=2"],
  );
}

// no question columns → nothing
{
  const r = parseItemScoreGrid("Name,Total\nAarav Singh,9", { students, questions });
  assert.equal(r.scores.length, 0);
  assert.equal(r.questionColumns.length, 0);
}

console.log("OK — itemScoreImport.selftest.ts");
