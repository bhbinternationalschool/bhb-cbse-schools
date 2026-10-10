import assert from "node:assert/strict";
import { applyOutcomesImport, parseOutcomesCsv } from "./syllabusOutcomesImport";
import { emptyTeachingState, upsertSyllabusUnit } from "./teaching";

console.log("syllabusOutcomesImport.selftest.ts");

{
  const { rows, error } = parseOutcomesCsv(
    'Chapter code,Chapter title,Learning outcomes,LO codes\nCh 3,Understanding Quadrilaterals,"Classifies quadrilaterals; Applies angle-sum property","M801, M802"\nCh 6,Squares and Square Roots,Finds square roots by prime factorisation,m806\n',
  );
  assert.equal(error, undefined);
  assert.equal(rows.length, 2);
  assert.deepEqual(rows[0].outcomes, ["Classifies quadrilaterals", "Applies angle-sum property"]);
  assert.deepEqual(rows[0].codes, ["M801", "M802"]);
  assert.deepEqual(rows[1].codes, ["M806"], "uppercased");
}
{
  assert.match(parseOutcomesCsv("a,b\n1,2").error ?? "", /title or code/);
  assert.match(parseOutcomesCsv("title,x\nA,1").error ?? "", /learning outcomes|LO codes/);
  const tsv = parseOutcomesCsv("Title\tLO\nLight\tS701 S702");
  assert.deepEqual(tsv.rows[0].codes, ["S701", "S702"], "TSV, space-separated codes");
}
{
  // existing chapter by code gets merged; new one created
  let st = emptyTeachingState();
  const r0 = upsertSyllabusUnit(st, { academicYearCode: "2026-27", classId: "c8", subjectId: "m", code: "Ch 3", title: "Quadrilaterals", learningOutcomes: "Old outcome", competencyCodes: ["M800"] });
  assert.ok(r0.ok);
  if (!r0.ok) throw new Error();
  st = r0.value.state;
  const { rows } = parseOutcomesCsv("code,title,outcomes,codes\nch 3,Understanding Quadrilaterals,New outcome,M801\n,Squares,Finds roots,M806");
  const r = applyOutcomesImport(st, { academicYearCode: "2026-27", classId: "c8", subjectId: "m", rows });
  assert.equal(r.updated, 1);
  assert.equal(r.created, 1);
  assert.deepEqual(r.errors, []);
  const ch3 = r.state.units.find((u) => u.code === "Ch 3")!;
  assert.equal(ch3.learningOutcomes, "Old outcome\nNew outcome", "outcomes merged, not replaced");
  assert.deepEqual(ch3.competencyCodes, ["M800", "M801"]);
  const sq = r.state.units.find((u) => u.title === "Squares")!;
  assert.equal(sq.level, "chapter");
  assert.deepEqual(sq.competencyCodes, ["M806"]);
  // replace mode
  const r2 = applyOutcomesImport(st, { academicYearCode: "2026-27", classId: "c8", subjectId: "m", rows: rows.slice(0, 1), replaceOutcomes: true });
  assert.equal(r2.state.units.find((u) => u.code === "Ch 3")!.learningOutcomes, "New outcome");
}

console.log("OK — syllabusOutcomesImport.selftest.ts");
