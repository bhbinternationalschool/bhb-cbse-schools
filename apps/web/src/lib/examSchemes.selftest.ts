/**
 * Run: npx tsx src/lib/examSchemes.selftest.ts
 *
 * Pins the assessment-scheme rules the school chooses between
 * (lib/examSchemes.ts) and their effect on the marks grid, the saved
 * sheet and promotion (lib/exams.ts):
 * - preset grade bands and grading per scale, the pass line included;
 * - a scheme list always has one default and no class in two schemes;
 * - components apply to term exams, not unit tests, unless told to;
 * - the grid builds one row per component, the save refuses a whole mark
 *   where components apply and a component mark over its maximum;
 * - each-component pass (XI–XII) fails a subject whose practical failed.
 */
import assert from "node:assert/strict";

import {
  CBSE_CO_SCHOLASTIC_AREAS,
  componentsForTerm,
  defaultAssessmentScheme,
  gradeBandsForPreset,
  gradeForPercent,
  normalizeAssessmentSchemes,
  SCHEME_PRESETS,
  schemeForClass,
  schemeFromPreset,
  type AssessmentScheme,
} from "./examSchemes";
import {
  buildEmptyMarksGrid,
  coScholasticAreasForClass,
  defaultExamPolicy,
  evaluatePromotionPass,
  normalizeExamPolicy,
  prepareMarkSheet,
  type ExamsState,
  type ExamSubject,
  type ExamTerm,
  type ReportCardLine,
} from "./exams";
import { defaultMasters } from "./masters";
import type { SisStudent } from "./sis";

console.log("examSchemes.selftest.ts");

// ------------------------------------------------------------ grading
{
  const cbse = defaultAssessmentScheme(33);
  assert.equal(gradeForPercent(95, cbse), "A1");
  assert.equal(gradeForPercent(41, cbse), "C2");
  assert.equal(gradeForPercent(33, cbse), "D", "the pass line is the D floor");
  assert.equal(gradeForPercent(32.9, cbse), "E");
  assert.equal(gradeForPercent(null, cbse), "—");

  const five = { ...cbse, gradeBands: gradeBandsForPreset("five", 35) };
  assert.equal(gradeForPercent(90, five), "A");
  assert.equal(gradeForPercent(35, five), "D");
  assert.equal(gradeForPercent(10, five), "E");

  const three = { ...cbse, gradeBands: gradeBandsForPreset("three", 33) };
  assert.equal(gradeForPercent(0, three), "C", "a 3-point scale has no failing letter below C");

  // A higher school pass line moves the D floor with it.
  const strict = gradeBandsForPreset("cbse8", 40);
  assert.equal(strict.find((b) => b.grade === "D")?.minPercent, 40);
}

// ------------------------------------------------------- normalisation
{
  const masters = defaultMasters();
  const [c1, c2] = masters.classes.map((c) => c.id);
  const a: Partial<AssessmentScheme> = { id: "s_a", name: "A", classIds: [c1!, c2!] };
  const b: Partial<AssessmentScheme> = { id: "s_b", name: "B", classIds: [c2!] };
  const list = normalizeAssessmentSchemes([a, b], 33);
  assert.equal(list.filter((s) => s.isDefault).length, 1, "a default is created when none was given");
  assert.ok(list[0]!.isDefault, "the default sorts first");
  assert.deepEqual(list.find((s) => s.id === "s_b")?.classIds, [], "a class already taken by A is not also B's");
  assert.equal(schemeForClass(c1!, list).id, "s_a");
  assert.ok(schemeForClass("cls_unknown", list).isDefault, "an unnamed class gets the default");

  const policy = normalizeExamPolicy({ ...defaultExamPolicy(), schemes: [a as AssessmentScheme] });
  assert.equal(policy.schemes.length, 2);
  assert.equal(normalizeExamPolicy(undefined).schemes.length, 1, "an old policy blob gets the default scheme");

  const areas = coScholasticAreasForClass(c1!, { ...policy, enableCoScholastic: true });
  assert.equal(areas.length, 2, "no areas on the scheme → the legacy NEP pair when the switch is on");
  assert.equal(coScholasticAreasForClass(c1!, policy).length, 0, "…and none when it is off");
}

// ------------------------------------------------------- components
const term = (code: string, max: number): ExamTerm => ({
  id: `term_${code.toLowerCase()}`,
  code,
  label: code,
  academicYearCode: "2026-27",
  maxMarks: max,
  sortOrder: 1,
  isActive: true,
  startsOn: "",
  endsOn: "",
  note: "",
  countsTowardHy: true,
  countsTowardFinal: true,
  weightInHy: 20,
  weightInFinal: 20,
  requiredOnMarksheet: true,
  requiresSeparateMarksheet: true,
});
const eng: ExamSubject = { id: "sub_eng", code: "ENG", name: "English", classIds: [], maxMarks: 100, sortOrder: 1, isActive: true };
{
  const middle = schemeFromPreset(SCHEME_PRESETS.find((p) => p.key === "cbse_middle")!, 33, ["cls_vi"]);
  assert.equal(componentsForTerm(middle, "UT1").length, 0, "unit tests stay single-mark");
  assert.equal(componentsForTerm(middle, "HY").map((c) => c.maxMarks).join("+"), "80+10+5+5");
  assert.equal(componentsForTerm({ ...middle, componentsApplyTo: "all" }, "UT1").length, 4);

  const senior = schemeFromPreset(SCHEME_PRESETS.find((p) => p.key === "cbse_senior")!, 33, ["cls_xi"]);
  assert.ok(senior.passEachComponent);
  assert.deepEqual(senior.coScholasticAreas, CBSE_CO_SCHOLASTIC_AREAS);

  const student = { id: "stu_1", fullName: "Test", classId: "cls_vi", sectionId: "sec_1", academicYearCode: "2026-27", status: "active" } as unknown as SisStudent;
  const grid = buildEmptyMarksGrid([student], [eng], term("HY", 80), undefined, 33, middle);
  assert.deepEqual(grid.map((g) => g.component), ["TE", "PT", "NB", "SE"], "one row per component");
  const utGrid = buildEmptyMarksGrid([student], [eng], term("UT1", 40), undefined, 33, middle);
  assert.deepEqual(utGrid.map((g) => g.component), [""]);

  // Grade-only scheme: the picked grade survives the rebuild, no number.
  const gradesOnly = schemeFromPreset(SCHEME_PRESETS.find((p) => p.key === "primary_grades_only")!, 33, ["cls_i"]);
  const existing = {
    id: "ms_1", academicYearCode: "2026-27", examTermId: "term_hy", classId: "cls_i", sectionId: "sec_1",
    marks: [{ studentId: "stu_1", subjectId: "sub_eng", component: "", marksObtained: null, grade: "B", remark: "", remarkSource: "manual" as const }],
    coScholastic: [], overallRemarks: [], itemScores: [], lockedAt: null, enteredBy: "", updatedAt: "2026-09-15T00:00:00.000Z",
  };
  const g2 = buildEmptyMarksGrid([student], [eng], term("HY", 80), existing, 33, gradesOnly);
  assert.equal(g2[0]!.grade, "B");
  assert.equal(g2[0]!.marksObtained, null);

  // The save enforces the scheme.
  const policy = normalizeExamPolicy({ ...defaultExamPolicy(), schemes: [middle] });
  const state: ExamsState = { version: 1, terms: [term("HY", 80), term("UT1", 40)], subjects: [eng], dateSheet: [], sheets: [], policy, promotions: [] };
  const deps = { state, masters: defaultMasters(), sis: { version: 1, households: [], students: [student], curriculumRequests: [] } as never };
  const base = { academicYearCode: "2026-27", examTermId: "term_hy", classId: "cls_vi", sectionId: "sec_1", enteredBy: "T" };
  const whole = prepareMarkSheet({ ...base, marks: [{ studentId: "stu_1", subjectId: "sub_eng", component: "", marksObtained: 70, grade: "", remark: "", remarkSource: "manual" }] }, state, undefined, deps);
  assert.equal(whole.ok, false, "a whole mark is refused where the exam is component-wise");
  const over = prepareMarkSheet({ ...base, marks: [{ studentId: "stu_1", subjectId: "sub_eng", component: "PT", marksObtained: 11, grade: "", remark: "", remarkSource: "manual" }] }, state, undefined, deps);
  assert.equal(over.ok, false, "11 out of a 10-mark periodic test is refused");
  const fine = prepareMarkSheet({ ...base, marks: [
    { studentId: "stu_1", subjectId: "sub_eng", component: "TE", marksObtained: 64, grade: "", remark: "", remarkSource: "manual" },
    { studentId: "stu_1", subjectId: "sub_eng", component: "PT", marksObtained: 8, grade: "", remark: "", remarkSource: "manual" },
  ] }, state, undefined, deps);
  assert.ok(fine.ok, "component marks within their maxima are accepted");
  if (fine.ok) {
    assert.equal(fine.sheet.marks.find((m) => m.component === "TE")?.grade, "B1", "64/80 = 80% → B1 on that part (A2 starts at 81)");
  }
  const utWhole = prepareMarkSheet({ ...base, examTermId: "term_ut1", marks: [{ studentId: "stu_1", subjectId: "sub_eng", component: "", marksObtained: 30, grade: "", remark: "", remarkSource: "manual" }] }, state, undefined, deps);
  assert.ok(utWhole.ok, "the unit test still takes a whole mark");
}

// ------------------------------------------------------- promotion
{
  const line = (obtained: number, max: number, parts: ReportCardLine["parts"] = []): ReportCardLine => ({
    subjectId: "s", subjectName: "Physics", maxMarks: max, marksObtained: obtained, grade: "", gradeLabel: "", remark: "", parts,
  });
  const partsFailedPractical = [
    { code: "TH", label: "Theory", maxMarks: 70, marksObtained: 60, failed: false },
    { code: "PR", label: "Practical", maxMarks: 30, marksObtained: 5, failed: true },
  ];
  const aggregateOnly = evaluatePromotionPass([line(65, 100, partsFailedPractical)], 33, true);
  assert.ok(aggregateOnly.passed, "65 % passes when only the aggregate counts");
  const each = evaluatePromotionPass([line(65, 100, partsFailedPractical)], 33, true, { passEachComponent: true });
  assert.equal(each.passed, false, "…but not when each component must pass");
  assert.deepEqual(each.failedSubjects, ["Physics"]);
}

console.log("OK — examSchemes.selftest.ts");
