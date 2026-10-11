/**
 * Run: npx tsx src/lib/examGradedParts.selftest.ts
 *
 * Graded parts inside a subject split (director, 11 Oct 2026): Half-yearly
 * English = Oral 20 + Written 80, Handwriting graded A/B/C. Pins:
 * - old splits normalise to marks parts; a graded part drops maxima and
 *   pass line, keeps its scale / own list and the exams it applies to;
 * - componentsForSubject (every total's column list) never returns a
 *   graded part; gradedPartsForSubject follows term / unit / both;
 * - grade validation, editor problems;
 * - the grid gets a letter row; the save refuses a number or an off-list
 *   letter for a graded part and stores "—" for not entered;
 * - the report card total is the marks parts only (71 + 18 = 89 / 100,
 *   whatever Handwriting got, or if it is missing), pass/fail ignores it,
 *   a whole-mark subject's mark is never read off its graded row;
 * - readiness counts a graded cell as filled by its letter;
 * - the staff-app API refuses numbers / off-list letters / marks parts and
 *   an old build's whole mark never lands on or wipes a graded row.
 */
import assert from "node:assert/strict";

import {
  componentsForSubject,
  gradedPartsForSubject,
  normalizeAssessmentScheme,
  normalizeSubjectSplits,
  parsePartGrade,
  schemeSummary,
  subjectSplitProblems,
  type AssessmentScheme,
} from "./examSchemes";
import {
  buildEmptyMarksGrid,
  buildReportCard,
  defaultExamPolicy,
  evaluatePromotionPass,
  normalizeExamPolicy,
  prepareMarkSheet,
  reportLinePartsText,
  type ExamsState,
  type ExamSubject,
  type ExamTerm,
  type MarkSheet,
  type StudentSubjectMark,
} from "./exams";
import { sectionReadiness } from "./examReadiness";
import { mergeStaffAppEntries, staffAppEntriesProblem } from "./staffExamMarks";
import { defaultMasters } from "./masters";
import type { SisStudent } from "./sis";

console.log("examGradedParts.selftest.ts");

// ------------------------------------------------------------ normalisation
const englishSplit = {
  subjectCode: "ENG",
  passPercent: null,
  parts: [
    { code: "ORAL", label: "Oral", termMax: 20, unitTestMax: 0, kind: "internal", passPercent: null },
    { code: "WRIT", label: "Written", termMax: 80, unitTestMax: 0, kind: "exam", passPercent: null },
    {
      code: "HW", label: "Handwriting", termMax: 20, unitTestMax: 5, kind: "internal", passPercent: 40,
      assess: "grade", gradeScale: "three",
    },
  ],
};
{
  const [split] = normalizeSubjectSplits([englishSplit]);
  assert.ok(split);
  assert.deepEqual(split.parts.map((p) => p.assess), ["marks", "marks", "grade"], "old parts become marks parts");
  const hw = split.parts[2]!;
  assert.equal(hw.termMax, 0, "a graded part has no term maximum");
  assert.equal(hw.unitTestMax, 0, "…nor a unit-test maximum");
  assert.equal(hw.passPercent, null, "…nor a pass line");
  assert.equal(hw.appliesTo, "term", "graded in term exams unless told otherwise");
  assert.equal(hw.gradeScale, "three");

  const [custom] = normalizeSubjectSplits([
    { subjectCode: "ENG", parts: [
      { code: "W", label: "W", termMax: 80, unitTestMax: 0, kind: "exam" },
      { code: "HW", label: "Handwriting", assess: "grade", gradeScale: "custom", grades: [" A ", "b", "B", "", "AB", "—", "C+"], appliesTo: "both" },
    ] },
  ]);
  assert.deepEqual(custom!.parts[1]!.grades, ["A", "b", "C+"], "own list trimmed, repeats/AB/— dropped");
  assert.equal(custom!.parts[1]!.appliesTo, "both");
  // A part saved before 2026-10-11 keeps its exact marks.
  const [old] = normalizeSubjectSplits([{ subjectCode: "ENG", parts: [{ code: "WRIT", label: "Written", termMax: 80, unitTestMax: 30, kind: "exam", passPercent: 33 }] }]);
  assert.deepEqual(
    { ...old!.parts[0] },
    { code: "WRIT", label: "Written", termMax: 80, unitTestMax: 30, kind: "exam", passPercent: 33, assess: "marks" },
  );
}

// ------------------------------------------------- which parts, which exam
const scheme: AssessmentScheme = normalizeAssessmentScheme(
  { id: "s_mid", name: "Middle", classIds: ["cls_vi"], isDefault: true, subjectSplits: [englishSplit as never] },
  33,
);
{
  assert.deepEqual(
    componentsForSubject(scheme, "HY", "ENG").map((c) => `${c.code}${c.maxMarks}`),
    ["ORAL20", "WRIT80"],
    "the marks columns (what every total sums) never include Handwriting",
  );
  assert.deepEqual(gradedPartsForSubject(scheme, "HY", "ENG"), [{ code: "HW", label: "Handwriting", grades: ["A", "B", "C"] }]);
  assert.deepEqual(gradedPartsForSubject(scheme, "UT1", "ENG"), [], "term-only: not in unit tests");
  assert.equal(componentsForSubject(scheme, "UT1", "ENG").length, 0, "UT: marks parts all 0 → whole mark");
  const unitOnly = normalizeAssessmentScheme(
    { ...scheme, subjectSplits: [{ ...englishSplit, parts: [englishSplit.parts[0], englishSplit.parts[1], { ...englishSplit.parts[2], appliesTo: "unit", gradeScale: "five" }] } as never] },
    33,
  );
  assert.deepEqual(gradedPartsForSubject(unitOnly, "HY", "ENG"), []);
  assert.deepEqual(gradedPartsForSubject(unitOnly, "PT1", "ENG")[0]!.grades, ["A", "B", "C", "D", "E"]);
  const both = normalizeAssessmentScheme(
    { ...scheme, subjectSplits: [{ ...englishSplit, parts: [englishSplit.parts[0], { ...englishSplit.parts[2], appliesTo: "both" }] } as never] },
    33,
  );
  assert.equal(gradedPartsForSubject(both, "HY", "ENG").length, 1);
  assert.equal(gradedPartsForSubject(both, "UT2", "ENG").length, 1);
  assert.deepEqual(gradedPartsForSubject(scheme, "HY", "MAT"), [], "an unsplit subject has none");
  assert.match(schemeSummary(scheme), /1 graded part/);
}

// ------------------------------------------------------- grade validation
{
  const g = ["A", "B", "C"];
  assert.deepEqual(parsePartGrade(g, "a"), { ok: true, grade: "A" }, "typing the letter in lower case");
  assert.deepEqual(parsePartGrade(g, ""), { ok: true, grade: "" }, "blank = not entered");
  assert.deepEqual(parsePartGrade(g, "—"), { ok: true, grade: "" });
  assert.deepEqual(parsePartGrade(g, "ab"), { ok: true, grade: "AB" }, "absent");
  assert.equal(parsePartGrade(g, "D").ok, false, "D is not on a 3-point list");
  assert.equal(parsePartGrade(g, "18").ok, false, "a number is not a grade");

  assert.deepEqual(subjectSplitProblems(scheme.subjectSplits[0]!), []);
  const bad = subjectSplitProblems({
    subjectCode: "ENG", passPercent: null,
    parts: [
      { code: "WRIT", label: "Written", termMax: 80, unitTestMax: 0, kind: "exam", passPercent: null },
      { code: "HW", label: "Handwriting", termMax: 0, unitTestMax: 0, kind: "internal", passPercent: null, assess: "grade", gradeScale: "custom", grades: ["A"] },
      { code: "WRIT", label: "Dup", termMax: 0, unitTestMax: 0, kind: "internal", passPercent: null },
    ],
  });
  assert.equal(bad.length, 2, "custom list needs two grades; duplicate code");
}

// ------------------------------------------------- grid, save, report card
const term = (code: string, max: number): ExamTerm => ({
  id: `term_${code.toLowerCase()}`, academicYearCode: "2026-27", code, label: code, maxMarks: max, sortOrder: 1,
  isActive: true, startsOn: "", endsOn: "", note: "", countsTowardHy: false, countsTowardFinal: false,
  weightInHy: 0, weightInFinal: 0, requiredOnMarksheet: false, requiresSeparateMarksheet: false,
});
const eng: ExamSubject = { id: "sub_eng", code: "ENG", name: "English", classIds: ["cls_vi"], maxMarks: 100, sortOrder: 1, isActive: true };
const mat: ExamSubject = { id: "sub_mat", code: "MAT", name: "Maths", classIds: ["cls_vi"], maxMarks: 100, sortOrder: 2, isActive: true };
const student = {
  id: "stu_1", fullName: "Test Child", classId: "cls_vi", sectionId: "sec_1", academicYearCode: "2026-27", status: "active",
} as unknown as SisStudent;
// Single-exam cards here; the HY-aggregate card is checked on its own below.
const policy = normalizeExamPolicy({ ...defaultExamPolicy(), includeComponentsInHyFinalReports: false, schemes: [scheme] });
const makeState = (sheets: MarkSheet[] = []): ExamsState => ({
  version: 1, terms: [term("HY", 100), term("UT1", 25)], subjects: [eng, mat], dateSheet: [], sheets, policy,
  promotions: [], rooms: [], seating: [],
});
const deps = (state: ExamsState) => ({
  state,
  masters: { ...defaultMasters(), classSubjects: [] } as never,
  sis: { version: 1, households: [], students: [student], curriculumRequests: [] } as never,
  attendance: { version: 1, registers: [] } as never,
  attendanceOverrides: { version: 1, overrides: [] } as never,
  holdChecks: new Map([["stu_1", { allowed: true, message: "" }]]) as never,
  todayIso: "2026-10-11",
});
const mk = (subjectId: string, component: string, marksObtained: number | null, grade = ""): StudentSubjectMark => ({
  studentId: "stu_1", subjectId, component, marksObtained, grade, remark: "", remarkSource: "manual",
});
const base = { academicYearCode: "2026-27", examTermId: "term_hy", classId: "cls_vi", sectionId: "sec_1", enteredBy: "T" };
{
  const grid = buildEmptyMarksGrid([student], [eng, mat], term("HY", 100), undefined, 33, scheme);
  assert.deepEqual(grid.map((g) => `${g.subjectId}:${g.component}`), ["sub_eng:ORAL", "sub_eng:WRIT", "sub_eng:HW", "sub_mat:"]);
  assert.equal(grid[2]!.marksObtained, null);
  assert.equal(grid[2]!.grade, "—", "a fresh graded cell is not entered");

  const state = makeState();
  const d = deps(state);
  const numeric = prepareMarkSheet({ ...base, marks: [mk("sub_eng", "HW", 18)] }, state, undefined, d);
  assert.equal(numeric.ok, false, "a number for Handwriting is refused");
  const offList = prepareMarkSheet({ ...base, marks: [mk("sub_eng", "HW", null, "D")] }, state, undefined, d);
  assert.equal(offList.ok, false, "D off a 3-point list is refused");
  const utGraded = prepareMarkSheet({ ...base, examTermId: "term_ut1", marks: [mk("sub_eng", "HW", null, "A")] }, state, undefined, d);
  assert.equal(utGraded.ok, false, "Handwriting is not assessed in unit tests here");

  const saved = prepareMarkSheet(
    { ...base, marks: [mk("sub_eng", "ORAL", 18), mk("sub_eng", "WRIT", 71), mk("sub_eng", "HW", null, "a"), mk("sub_mat", "", 60)] },
    state,
    undefined,
    d,
  );
  assert.ok(saved.ok, saved.ok ? "" : saved.error);
  if (!saved.ok) throw new Error("unreachable");
  const hwRow = saved.sheet.marks.find((m) => m.component === "HW")!;
  assert.equal(hwRow.grade, "A", "the picked letter, as listed");
  assert.equal(hwRow.marksObtained, null);

  // The card: English = Oral 18 + Written 71 = 89 / 100; Handwriting A beside it.
  const card = buildReportCard({ student, classLabel: "VI-A", examTermId: "term_hy", deps: deps(makeState([saved.sheet])) });
  assert.ok(!("error" in card), "error" in card ? card.error : "");
  if ("error" in card) throw new Error("unreachable");
  const engLine = card.lines.find((l) => l.subjectId === "sub_eng")!;
  assert.equal(engLine.maxMarks, 100, "max = marks parts only (20 + 80)");
  assert.equal(engLine.marksObtained, 89, "obtained = 18 + 71, Handwriting not added");
  assert.deepEqual(engLine.parts.map((p) => p.code), ["ORAL", "WRIT"]);
  assert.deepEqual(engLine.gradedParts, [{ code: "HW", label: "Handwriting", grade: "A" }]);
  assert.equal(card.totalMax, 200, "card total: English 100 + Maths 100");
  assert.equal(card.totalObtained, 149);
  assert.equal(card.percent, 74.5);
  assert.equal(reportLinePartsText(engLine, { includeMarksParts: true }), "Oral 18/20 · Written 71/80 · Handwriting: A");
  assert.equal(reportLinePartsText(engLine, { includeMarksParts: false }), "Handwriting: A");
  assert.equal(reportLinePartsText(card.lines.find((l) => l.subjectId === "sub_mat")!, { includeMarksParts: true }), "");

  // The Half-yearly aggregate card (HY counted at weight 100): the line is
  // scaled from the marks parts only, Handwriting read off HY's own sheet.
  {
    const aggState: ExamsState = {
      ...makeState([saved.sheet]),
      terms: [{ ...term("HY", 100), countsTowardHy: true, weightInHy: 100 }, term("UT1", 25)],
      policy: normalizeExamPolicy({ ...defaultExamPolicy(), includeComponentsInHyFinalReports: true, schemes: [scheme] }),
    };
    const agg = buildReportCard({ student, classLabel: "VI-A", examTermId: "term_hy", deps: deps(aggState) });
    if ("error" in agg) throw new Error(agg.error);
    assert.equal(agg.aggregateMode, "hy");
    const l = agg.lines.find((x) => x.subjectId === "sub_eng")!;
    assert.equal(l.marksObtained, 89, "aggregate: 89 % of English's marks parts");
    assert.deepEqual(l.gradedParts, [{ code: "HW", label: "Handwriting", grade: "A" }]);
    assert.equal(agg.totalObtained, 149);
  }

  // Same marks, Handwriting C or not entered: identical totals; missing is "—", never a fail.
  for (const g of ["C", ""]) {
    const s2 = prepareMarkSheet(
      { ...base, marks: [mk("sub_eng", "ORAL", 18), mk("sub_eng", "WRIT", 71), mk("sub_eng", "HW", null, g), mk("sub_mat", "", 60)] },
      state, undefined, d,
    );
    assert.ok(s2.ok);
    if (!s2.ok) continue;
    const c2 = buildReportCard({ student, classLabel: "VI-A", examTermId: "term_hy", deps: deps(makeState([s2.sheet])) });
    if ("error" in c2) throw new Error(c2.error);
    const l2 = c2.lines.find((l) => l.subjectId === "sub_eng")!;
    assert.equal(l2.marksObtained, 89, `Handwriting "${g}" does not move the total`);
    assert.equal(c2.totalObtained, 149);
    assert.equal(l2.grade, engLine.grade, "nor the subject grade");
    assert.equal(l2.gradedParts![0]!.grade, g || null, "missing = null (not entered)");
    assert.equal(reportLinePartsText(l2, { includeMarksParts: false }), `Handwriting: ${g || "—"}`);
    const verdict = evaluatePromotionPass(c2.lines, 33, true);
    assert.ok(verdict.passed, "a missing or low Handwriting grade never fails the child");
    assert.deepEqual(verdict.failedSubjects, []);
  }

  // Only Handwriting entered: the card has no marks for English, and the
  // letter is not mistaken for a mark or a subject grade.
  const onlyHw = prepareMarkSheet({ ...base, marks: [mk("sub_eng", "HW", null, "B"), mk("sub_mat", "", 50)] }, state, undefined, d);
  assert.ok(onlyHw.ok);
  if (onlyHw.ok) {
    const c3 = buildReportCard({ student, classLabel: "VI-A", examTermId: "term_hy", deps: deps(makeState([onlyHw.sheet])) });
    if ("error" in c3) throw new Error(c3.error);
    const l3 = c3.lines.find((l) => l.subjectId === "sub_eng")!;
    assert.equal(l3.marksObtained, null, "no marks part entered → no English mark");
    assert.equal(l3.grade, "—");
    assert.equal(c3.totalMax, 100, "English left out of the total until its marks are in");
  }
}

// A whole-mark subject with a graded part: the mark is read off the whole
// row, never off the graded row that sits beside it.
{
  const hwOnly = normalizeAssessmentScheme(
    { ...scheme, subjectSplits: [{ subjectCode: "ENG", passPercent: null, parts: [{ ...englishSplit.parts[2] }] } as never] },
    33,
  );
  assert.equal(componentsForSubject(hwOnly, "HY", "ENG").length, 0, "no marks part → one whole mark");
  const pol = normalizeExamPolicy({ ...defaultExamPolicy(), includeComponentsInHyFinalReports: false, schemes: [hwOnly] });
  const state = { ...makeState(), policy: pol };
  const grid = buildEmptyMarksGrid([student], [eng], term("HY", 100), undefined, 33, hwOnly);
  assert.deepEqual(grid.map((g) => g.component), ["", "HW"]);
  // Graded row FIRST in storage order — the old `rows[0]` fallback read it.
  const saved = prepareMarkSheet({ ...base, marks: [mk("sub_eng", "HW", null, "A"), mk("sub_eng", "", 77), mk("sub_mat", "", 40)] }, state, undefined, deps(state));
  assert.ok(saved.ok, saved.ok ? "" : saved.error);
  if (saved.ok) {
    const card = buildReportCard({ student, classLabel: "VI-A", examTermId: "term_hy", deps: deps({ ...state, sheets: [saved.sheet] }) });
    if ("error" in card) throw new Error(card.error);
    const l = card.lines.find((x) => x.subjectId === "sub_eng")!;
    assert.equal(l.marksObtained, 77);
    assert.equal(l.maxMarks, 100);
    assert.deepEqual(l.gradedParts, [{ code: "HW", label: "Handwriting", grade: "A" }]);
  }
  const noWhole = prepareMarkSheet({ ...base, marks: [mk("sub_eng", "HW", null, "A"), mk("sub_mat", "", 40)] }, state, undefined, deps(state));
  if (noWhole.ok) {
    const card = buildReportCard({ student, classLabel: "VI-A", examTermId: "term_hy", deps: deps({ ...state, sheets: [noWhole.sheet] }) });
    if ("error" in card) throw new Error(card.error);
    const l = card.lines.find((x) => x.subjectId === "sub_eng")!;
    assert.equal(l.marksObtained, null, "the graded row never stands in for the whole mark");
    assert.equal(l.grade, "—", "…nor its letter for the subject grade");
  }
}

// AB on a graded part is that part only: Oral/Written marks and the total stay.
{
  const state = makeState();
  const saved = prepareMarkSheet(
    { ...base, marks: [mk("sub_eng", "ORAL", 18), mk("sub_eng", "WRIT", 71), mk("sub_eng", "HW", null, "AB"), mk("sub_mat", "", 60)] },
    state, undefined, deps(state),
  );
  assert.ok(saved.ok, saved.ok ? "" : saved.error);
  if (saved.ok) {
    assert.equal(saved.sheet.absences.length, 0, "no subject absence recorded");
    assert.equal(saved.sheet.marks.find((m) => m.component === "WRIT")?.marksObtained, 71, "Written untouched");
    const card = buildReportCard({ student, classLabel: "VI-A", examTermId: "term_hy", deps: deps(makeState([saved.sheet])) });
    if ("error" in card) throw new Error(card.error);
    const l = card.lines.find((x) => x.subjectId === "sub_eng")!;
    assert.equal(l.marksObtained, 89);
    assert.equal(l.absent, false);
    assert.deepEqual(l.gradedParts, [{ code: "HW", label: "Handwriting", grade: "AB" }]);
    assert.ok(evaluatePromotionPass(card.lines, 33, true).passed);
  }
}

// A stale letter (the list changed mid-term) never blocks a later save.
{
  const withList = (grades: string[]) =>
    normalizeAssessmentScheme(
      { ...scheme, subjectSplits: [{ ...englishSplit, parts: [englishSplit.parts[0], englishSplit.parts[1], { ...englishSplit.parts[2], gradeScale: "custom", grades }] } as never] },
      33,
    );
  const before = withList(["A", "B", "C", "D"]);
  const st1 = { ...makeState(), policy: normalizeExamPolicy({ ...defaultExamPolicy(), includeComponentsInHyFinalReports: false, schemes: [before] }) };
  const first = prepareMarkSheet(
    { ...base, marks: [mk("sub_eng", "ORAL", 18), mk("sub_eng", "WRIT", 71), mk("sub_eng", "HW", null, "D"), mk("sub_mat", "", 60)] },
    st1, undefined, deps(st1),
  );
  assert.ok(first.ok);
  if (!first.ok) throw new Error("unreachable");
  // The school drops D from the list.
  const after = withList(["A", "B", "C"]);
  const st2 = { ...makeState([first.sheet]), policy: normalizeExamPolicy({ ...defaultExamPolicy(), includeComponentsInHyFinalReports: false, schemes: [after] }) };
  // Staff app saving Maths only (the route sends the posted subject alone).
  const mathsOnly = mergeStaffAppEntries(first.sheet.marks, "sub_mat", [{ studentId: "stu_1", marksObtained: 65 }])
    .filter((m) => m.subjectId === "sub_mat");
  const app = prepareMarkSheet({ ...base, marks: mathsOnly }, st2, first.sheet, deps(st2));
  assert.ok(app.ok, app.ok ? "" : app.error);
  if (app.ok) {
    assert.equal(app.sheet.marks.find((m) => m.component === "HW")?.grade, "D", "English's stale letter kept as stored");
    assert.equal(app.sheet.marks.find((m) => m.subjectId === "sub_mat")?.marksObtained, 65);
  }
  // Desk / app re-sending English with D unchanged: accepted, kept.
  const resend = prepareMarkSheet(
    { ...base, marks: mergeStaffAppEntries(first.sheet.marks, "sub_eng", [{ studentId: "stu_1", component: "HW", grade: "D" }]).filter((m) => m.subjectId === "sub_eng") },
    st2, first.sheet, deps(st2),
  );
  assert.ok(resend.ok, "an unchanged stale letter is not re-judged");
  // …but newly picking an off-list letter is still refused.
  const fresh = prepareMarkSheet(
    { ...base, marks: [mk("sub_eng", "ORAL", 18), mk("sub_eng", "WRIT", 71), mk("sub_eng", "HW", null, "E")] },
    st2, first.sheet, deps(st2),
  );
  assert.equal(fresh.ok, false);
  const changedToStale = prepareMarkSheet(
    { ...base, marks: [mk("sub_eng", "ORAL", 18), mk("sub_eng", "WRIT", 71), mk("sub_eng", "HW", null, "D")] },
    st2, { ...first.sheet, marks: first.sheet.marks.map((m) => (m.component === "HW" ? { ...m, grade: "A" } : m)) }, deps(st2),
  );
  assert.equal(changedToStale.ok, false, "changing A → D (off the new list) is refused");
}

// A split with ONLY a graded part keeps the scheme's components for marks.
{
  const withComponents = normalizeAssessmentScheme(
    {
      ...scheme,
      components: [
        { code: "TE", label: "Term exam", maxMarks: 80, kind: "exam" },
        { code: "IA", label: "Internal", maxMarks: 20, kind: "internal" },
      ],
      subjectSplits: [{ subjectCode: "ENG", passPercent: null, parts: [{ ...englishSplit.parts[2] }] } as never],
    },
    33,
  );
  assert.deepEqual(componentsForSubject(withComponents, "HY", "ENG").map((c) => c.code), ["TE", "IA"], "not silently one whole mark");
  assert.deepEqual(gradedPartsForSubject(withComponents, "HY", "ENG").map((g) => g.code), ["HW"]);
}

// ------------------------------------------------------------- readiness
{
  const sheet = {
    marks: [mk("sub_eng", "ORAL", 18), mk("sub_eng", "WRIT", 71), mk("sub_eng", "HW", null, "—")],
    absences: [], coScholastic: [], lockedAt: null,
  };
  const columns = [
    { subjectId: "sub_eng", subjectName: "English", component: "ORAL" },
    { subjectId: "sub_eng", subjectName: "English", component: "WRIT" },
    { subjectId: "sub_eng", subjectName: "English", component: "HW", graded: true },
  ];
  const r1 = sectionReadiness({ studentIds: ["stu_1"], columns, takes: new Map(), areas: [], sheet, entryMode: "marks" });
  assert.equal(r1.filled, 2, "Handwriting not picked yet");
  assert.equal(r1.status, "partial");
  sheet.marks[2] = mk("sub_eng", "HW", null, "B");
  const r2 = sectionReadiness({ studentIds: ["stu_1"], columns, takes: new Map(), areas: [], sheet, entryMode: "marks" });
  assert.equal(r2.status, "ready", "a graded cell is filled by its letter, in a marks scheme");
}

// ------------------------------------------------------- staff app API
{
  const rules = {
    subjectName: "English",
    termLabel: "Half-yearly",
    marksParts: componentsForSubject(scheme, "HY", "ENG"),
    gradedParts: gradedPartsForSubject(scheme, "HY", "ENG"),
    gradeOnlyScheme: false,
  };
  assert.match(staffAppEntriesProblem([{ studentId: "stu_1", marksObtained: 80 }], rules) ?? "", /marked in parts/, "old app: whole mark for a split subject → desk");
  assert.match(staffAppEntriesProblem([{ studentId: "stu_1", component: "HW", marksObtained: 18 }], rules) ?? "", /graded/, "a number for a graded part");
  assert.match(staffAppEntriesProblem([{ studentId: "stu_1", component: "HW", marksObtained: 0 }], rules) ?? "", /graded/, "…even 0");
  assert.match(staffAppEntriesProblem([{ studentId: "stu_1", component: "HW", grade: "E" }], rules) ?? "", /not one of the grades/);
  assert.match(staffAppEntriesProblem([{ studentId: "stu_1", component: "WRIT", marksObtained: 70 }], rules) ?? "", /marks part/);
  assert.match(staffAppEntriesProblem([{ studentId: "stu_1", component: "ZZ", grade: "A" }], rules) ?? "", /not one of its parts/);
  assert.equal(staffAppEntriesProblem([{ studentId: "stu_1", component: "hw", grade: "b" }], rules), null, "a listed letter is fine");
  assert.equal(staffAppEntriesProblem([{ studentId: "stu_1", component: "HW", grade: "" }], rules), null, "clearing is fine");

  // Maths (one mark) beside a whole-mark subject with Handwriting.
  const wholeRules = { ...rules, marksParts: [] };
  assert.equal(staffAppEntriesProblem([{ studentId: "stu_1", marksObtained: 77 }], wholeRules), null);
  assert.match(staffAppEntriesProblem([{ studentId: "stu_1", marksObtained: 77 }], { ...wholeRules, gradeOnlyScheme: true }) ?? "", /assessed by grades/);
  assert.match(staffAppEntriesProblem([{ studentId: "stu_1", marksObtained: -1 }], wholeRules) ?? "", /number ≥ 0/);

  // An old build saving the whole mark keeps Handwriting's row as it was.
  const existing = [mk("sub_eng", "HW", null, "A"), mk("sub_eng", "", 60), mk("sub_mat", "", 40)];
  const merged = mergeStaffAppEntries(existing, "sub_eng", [{ studentId: "stu_1", marksObtained: 77 }]);
  assert.equal(merged.length, 3, "no row lost, none added");
  assert.equal(merged.find((m) => m.subjectId === "sub_eng" && m.component === "HW")?.grade, "A", "graded row untouched");
  assert.equal(merged.find((m) => m.subjectId === "sub_eng" && !m.component)?.marksObtained, 77);
  const picked = mergeStaffAppEntries(existing, "sub_eng", [{ studentId: "stu_1", component: "hw", grade: "B" }]);
  assert.equal(picked.find((m) => m.component === "HW")?.grade, "B");
  assert.equal(picked.find((m) => m.subjectId === "sub_eng" && !m.component)?.marksObtained, 60, "the whole mark untouched");
}

console.log("OK — examGradedParts.selftest.ts");
