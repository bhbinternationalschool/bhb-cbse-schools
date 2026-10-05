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
 * - each-component pass (XI–XII) fails a subject whose practical failed;
 * - a subject split (English = Written 80 + Oral 20) overrides the common
 *   components for that subject only, in term exams AND unit tests, with a
 *   pass line of its own per part and for the subject's total;
 * - co-scholastic grades on a 3- or 5-point scale;
 * - a subject Masters calls co-scholastic is a grade row, never a marks
 *   column — even when the exam catalogue still holds an old marks row for it.
 */
import assert from "node:assert/strict";

import {
  CBSE_CO_SCHOLASTIC_AREAS,
  componentFailed,
  componentsForSubject,
  componentsForTerm,
  coScholasticRatingsFor,
  normalizeAssessmentScheme,
  splitPartsFromMasterComponents,
  subjectPassPercent,
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
  coScholasticRatingLabel,
  subjectsForMarkEntry,
  parseCoScholasticRating,
  isGradedNotMarked,
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
  const withDefaultClasses = normalizeAssessmentSchemes(
    [{ id: "d", name: "D", isDefault: true, classIds: [c1!] }, a],
    33,
  );
  assert.deepEqual(withDefaultClasses.find((s) => s.isDefault)?.classIds, [c1!], "the fallback may name classes too");
  assert.equal(schemeForClass(c1!, withDefaultClasses).id, "d", "…and then keeps them from later schemes");
  assert.equal(schemeForClass("cls_other", withDefaultClasses).id, "d", "unnamed classes still fall back to it");
  assert.equal(list[0]!.showPhoto, false);
  assert.equal(list[0]!.showAttendance, null);
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
    absences: [],
    coScholastic: [], overallRemarks: [], itemScores: [], lockedAt: null, enteredBy: "", updatedAt: "2026-09-15T00:00:00.000Z",
  };
  const g2 = buildEmptyMarksGrid([student], [eng], term("HY", 80), existing, 33, gradesOnly);
  assert.equal(g2[0]!.grade, "B");
  assert.equal(g2[0]!.marksObtained, null);

  // The save enforces the scheme.
  const policy = normalizeExamPolicy({ ...defaultExamPolicy(), schemes: [middle] });
  const state: ExamsState = { version: 1, terms: [term("HY", 80), term("UT1", 40)], subjects: [eng], dateSheet: [], sheets: [], policy, promotions: [], rooms: [], seating: [] };
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
    subjectId: "s", subjectName: "Physics", maxMarks: max, marksObtained: obtained, grade: "", gradeLabel: "", absent: false, remark: "", parts,
  });
  const absentLine = line(0, 100);
  absentLine.marksObtained = null;
  absentLine.absent = true;
  const ab = evaluatePromotionPass([absentLine, line(80, 100)], 33, true);
  assert.equal(ab.passed, false, "an absent paper fails that subject");
  assert.deepEqual(ab.failedSubjects, ["Physics (absent)"]);

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

// ------------------------------------------------------- subject splits
{
  // Class VI: the CBSE middle preset (TE 80 + PT 10 + NB 5 + SE 5) for every
  // subject — except English, which the school marks Written + Oral, in unit
  // tests too, with Oral to be passed on its own.
  const middle = schemeFromPreset(SCHEME_PRESETS.find((p) => p.key === "cbse_middle")!, 33, ["cls_vi"]);
  const scheme = normalizeAssessmentScheme(
    {
      ...middle,
      subjectSplits: [
        {
          subjectCode: "eng",
          passPercent: 40,
          parts: [
            { code: "wr-it", label: "Written", termMax: 80, unitTestMax: 30, kind: "exam", passPercent: null },
            { code: "ORAL", label: "Oral", termMax: 20, unitTestMax: 10, kind: "internal", passPercent: 33 },
            { code: "", label: "blank code is dropped", termMax: 5, unitTestMax: 5, kind: "exam", passPercent: null },
          ],
        },
        { subjectCode: "HIN", passPercent: null, parts: [] },
      ],
    },
    33,
  );
  assert.equal(scheme.subjectSplits.length, 1, "a split with no parts is no split");
  assert.equal(scheme.subjectSplits[0]!.subjectCode, "ENG", "subject codes upper-cased");
  assert.deepEqual(scheme.subjectSplits[0]!.parts.map((p) => p.code), ["WRIT", "ORAL"], "part codes A–Z0–9, blanks dropped");

  const hyEng = componentsForSubject(scheme, "HY", "ENG");
  assert.deepEqual(hyEng.map((c) => `${c.code}${c.maxMarks}`), ["WRIT80", "ORAL20"], "English: Written 80 + Oral 20 in term exams");
  const utEng = componentsForSubject(scheme, "UT1", "ENG");
  assert.deepEqual(utEng.map((c) => `${c.code}${c.maxMarks}`), ["WRIT30", "ORAL10"], "…and its own unit-test marks");
  assert.deepEqual(
    componentsForSubject(scheme, "HY", "MAT").map((c) => c.code),
    ["TE", "PT", "NB", "SE"],
    "Maths keeps the scheme's common components",
  );
  assert.equal(componentsForSubject(scheme, "UT1", "MAT").length, 0, "…and a whole mark in unit tests");

  // A part with 0 for an exam type is not assessed in it; all 0 = whole mark.
  const noOralInUt = normalizeAssessmentScheme(
    { ...scheme, subjectSplits: [{ subjectCode: "ENG", passPercent: null, parts: [
      { code: "WRIT", label: "Written", termMax: 80, unitTestMax: 40, kind: "exam", passPercent: null },
      { code: "ORAL", label: "Oral", termMax: 20, unitTestMax: 0, kind: "internal", passPercent: null },
    ] }] },
    33,
  );
  assert.deepEqual(componentsForSubject(noOralInUt, "UT2", "ENG").map((c) => c.code), ["WRIT"]);
  const termOnly = normalizeAssessmentScheme(
    { ...scheme, subjectSplits: [{ subjectCode: "ENG", passPercent: null, parts: [
      { code: "WRIT", label: "Written", termMax: 80, unitTestMax: 0, kind: "exam", passPercent: null },
      { code: "ORAL", label: "Oral", termMax: 20, unitTestMax: 0, kind: "internal", passPercent: null },
    ] }] },
    33,
  );
  assert.equal(componentsForSubject(termOnly, "UT1", "ENG").length, 0, "split only in term exams: unit test is one mark");

  // Pass lines.
  assert.equal(subjectPassPercent(scheme, "ENG", 33), 40, "English's own total pass line");
  assert.equal(subjectPassPercent(scheme, "MAT", 33), 33, "others use the scheme / school line");
  const oral = hyEng[1]!;
  assert.equal(componentFailed(oral, 6, scheme, 33), true, "6/20 = 30 % < Oral's own 33 %");
  assert.equal(componentFailed(oral, 7, scheme, 33), false, "7/20 = 35 %");
  assert.equal(componentFailed(hyEng[0]!, 10, scheme, 33), false, "Written has no line of its own");
  assert.equal(componentFailed(hyEng[0]!, 10, { ...scheme, passEachComponent: true }, 33), true, "…unless every part must pass");

  // The grid: English in Written/Oral, Maths in the common four.
  const mat: ExamSubject = { ...eng, id: "sub_mat", code: "MAT", name: "Maths" };
  const student = { id: "stu_1", fullName: "Test", classId: "cls_vi", sectionId: "sec_1", academicYearCode: "2026-27", status: "active" } as unknown as SisStudent;
  const grid = buildEmptyMarksGrid([student], [eng, mat], term("HY", 80), undefined, 33, scheme);
  assert.deepEqual(
    grid.map((g) => `${g.subjectId}:${g.component}`),
    ["sub_eng:WRIT", "sub_eng:ORAL", "sub_mat:TE", "sub_mat:PT", "sub_mat:NB", "sub_mat:SE"],
  );
  const utGrid = buildEmptyMarksGrid([student], [eng, mat], term("UT1", 40), undefined, 33, scheme);
  assert.deepEqual(utGrid.map((g) => `${g.subjectId}:${g.component}`), ["sub_eng:WRIT", "sub_eng:ORAL", "sub_mat:"]);

  // The save enforces each subject's own parts and maxima.
  const policy = normalizeExamPolicy({ ...defaultExamPolicy(), schemes: [scheme] });
  const state: ExamsState = { version: 1, terms: [term("HY", 80), term("UT1", 40)], subjects: [eng, mat], dateSheet: [], sheets: [], policy, promotions: [], rooms: [], seating: [] };
  const deps = { state, masters: defaultMasters(), sis: { version: 1, households: [], students: [student], curriculumRequests: [] } as never };
  const base = { academicYearCode: "2026-27", examTermId: "term_hy", classId: "cls_vi", sectionId: "sec_1", enteredBy: "T" };
  const mk = (subjectId: string, component: string, marksObtained: number) =>
    ({ studentId: "stu_1", subjectId, component, marksObtained, grade: "", remark: "", remarkSource: "manual" as const });
  assert.equal(prepareMarkSheet({ ...base, marks: [mk("sub_eng", "TE", 60)] }, state, undefined, deps).ok, false, "English has no TE part");
  assert.equal(prepareMarkSheet({ ...base, marks: [mk("sub_eng", "ORAL", 21)] }, state, undefined, deps).ok, false, "21 of a 20-mark Oral is refused");
  assert.equal(prepareMarkSheet({ ...base, marks: [mk("sub_mat", "WRIT", 50)] }, state, undefined, deps).ok, false, "Maths has no Written part");
  const ok = prepareMarkSheet({ ...base, marks: [mk("sub_eng", "WRIT", 70), mk("sub_eng", "ORAL", 18), mk("sub_mat", "TE", 60)] }, state, undefined, deps);
  assert.ok(ok.ok, "each subject's own parts within their maxima are accepted");
  const ut = prepareMarkSheet({ ...base, examTermId: "term_ut1", marks: [mk("sub_eng", "WRIT", 25), mk("sub_eng", "ORAL", 9), mk("sub_mat", "", 35)] }, state, undefined, deps);
  assert.ok(ut.ok, "unit test: English in parts, Maths whole");
  assert.equal(
    prepareMarkSheet({ ...base, examTermId: "term_ut1", marks: [mk("sub_eng", "WRIT", 31)] }, state, undefined, deps).ok,
    false,
    "31 of the unit test's 30-mark Written is refused",
  );

  // Promotion: English's own 40 % total line and Oral's own 33 %.
  const line = (name: string, obtained: number, max: number, passPercent: number | undefined, parts: ReportCardLine["parts"] = []): ReportCardLine => ({
    subjectId: name, subjectName: name, maxMarks: max, marksObtained: obtained, grade: "", gradeLabel: "", absent: false, remark: "", parts, passPercent,
  });
  const engParts = (w: number, o: number): ReportCardLine["parts"] => [
    { code: "WRIT", label: "Written", maxMarks: 80, marksObtained: w, failed: false, passPercent: null },
    { code: "ORAL", label: "Oral", maxMarks: 20, marksObtained: o, failed: componentFailed(oral, o, scheme, 33), passPercent: 33 },
  ];
  const r1 = evaluatePromotionPass([line("English", 38, 100, 40, engParts(32, 6))], 33, true);
  assert.deepEqual(r1.failedSubjects, ["English"], "38 % is under English's 40 % line (and Oral 6/20 failed)");
  const r2 = evaluatePromotionPass([line("English", 50, 100, 40, engParts(44, 6))], 33, true);
  assert.deepEqual(r2.failedSubjects, ["English"], "50 % overall, but Oral 30 % fails it on its own");
  const r3 = evaluatePromotionPass([line("English", 52, 100, 40, engParts(44, 8))], 33, true);
  assert.deepEqual(r3.failedSubjects, [], "both lines met");
  const r4 = evaluatePromotionPass([line("Maths", 36, 100, undefined)], 33, true);
  assert.ok(r4.passed, "a line without its own pass % uses the scheme's");

  // Suggested parts from Masters components.
  const suggested = splitPartsFromMasterComponents("ENG", [
    { code: "ENG-WRIT", nameEn: "English — Written" },
    { code: "ENG-ORAL", nameEn: "English — Oral" },
    { code: "ENG-ORAL", nameEn: "duplicate" },
  ]);
  assert.deepEqual(suggested.map((p) => [p.code, p.label, p.masterCode]), [
    ["WRIT", "Written", "ENG-WRIT"],
    ["ORAL", "Oral", "ENG-ORAL"],
  ]);
}

// ------------------------------------------------------- co-scholastic scale
{
  // Graded, not marked: Masters' category OR the CO tag. Work Education is
  // co-scholastic in Masters but tagged B — it was getting a marks column.
  assert.equal(isGradedNotMarked({ code: "WE", category: "co_scholastic", ncfTagId: "B" }), true);
  assert.equal(isGradedNotMarked({ code: "SEE", category: "scholastic", ncfTagId: "CO" }), true);
  assert.equal(isGradedNotMarked({ code: "ENG", category: "scholastic", ncfTagId: "A" }), false);

  assert.deepEqual(coScholasticRatingsFor("three"), ["A", "B", "C"]);
  assert.deepEqual(coScholasticRatingsFor("five"), ["A", "B", "C", "D", "E"]);
  assert.equal(normalizeAssessmentScheme({ coScholasticScale: "five" }, 33).coScholasticScale, "five");
  assert.equal(normalizeAssessmentScheme({ coScholasticScale: "nonsense" as never }, 33).coScholasticScale, "three");
  // The same letter means different things on the two scales.
  assert.equal(coScholasticRatingLabel("C", "three"), "Needs Improvement");
  assert.equal(coScholasticRatingLabel("C", "five"), "Good");
  assert.equal(coScholasticRatingLabel("E", "five"), "Needs Improvement");
  assert.equal(coScholasticRatingLabel(null, "five"), "Not rated");
  // Absent is a recorded outcome, not a grade and not "not rated".
  assert.equal(parseCoScholasticRating("AB"), "AB");
  assert.equal(coScholasticRatingLabel("AB", "three"), "Absent");
  assert.equal(coScholasticRatingLabel("AB", "five"), "Absent");
  assert.equal(parseCoScholasticRating("E"), "E", "the five-point letters survive a read");
  assert.equal(parseCoScholasticRating("ab"), null, "only the exact code");
}

// ------------------------------------------------- co-scholastic follows Masters
{
  // ART/GK/MUS were marked co-scholastic in Masters but kept their old marks
  // rows (out of 100) in the exam catalogue, and no scheme had areas, so the
  // grid showed numbers for them and offered no grade at all (2026-10-05).
  const masters = defaultMasters();
  const cls = masters.classes.find((c) => c.isActive)!;
  const sub = (id: string, code: string, category: string, ncfTagId: string) => ({
    id, code, nameEn: code === "ART" ? "Art Education" : code, category, coScholasticArea: "",
    parentId: null, isElective: false, isActive: true, sortOrder: 1, ncfTagId, cbseGroupId: null,
    languageSubtype: "",
  });
  const m = {
    ...masters,
    subjects: [sub("s_eng", "ENG", "scholastic", "A"), sub("s_art", "ART", "co_scholastic", "C"), sub("s_gk", "GK", "scholastic", "CO")],
    classSubjects: [
      { id: "l1", classId: cls.id, subjectId: "s_eng", periodsPerWeek: 6, isActive: true },
      { id: "l2", classId: cls.id, subjectId: "s_art", periodsPerWeek: 2, isActive: true },
      { id: "l3", classId: cls.id, subjectId: "s_gk", periodsPerWeek: 1, isActive: true },
    ],
  } as never;

  const policy = defaultExamPolicy();
  const areas = coScholasticAreasForClass(cls.id, policy, m);
  assert.deepEqual(areas.map((a) => a.code), ["ART", "GK"], "Masters' co-scholastic subjects become grade rows even with no scheme areas");
  assert.equal(areas[0]!.label, "Art Education");
  assert.equal(coScholasticAreasForClass(cls.id, policy).length, 0, "without Masters, nothing is invented");
  const withScheme = coScholasticAreasForClass(
    cls.id,
    { ...policy, schemes: [{ ...policy.schemes[0]!, coScholasticAreas: [{ code: "art", label: "Art (scheme)" }] }] },
    m,
  );
  assert.deepEqual(withScheme.map((a) => a.code), ["art", "GK"], "the scheme's own area wins; Masters adds only what is missing");

  const examSub = (code: string): ExamSubject => ({
    id: `esub_${code.toLowerCase()}`, code, name: code, classIds: [cls.id], maxMarks: 100, sortOrder: 1, isActive: true,
  });
  const state = {
    version: 1, terms: [], subjects: [examSub("ENG"), examSub("ART"), examSub("GK")], dateSheet: [], sheets: [],
    policy, promotions: [], rooms: [], seating: [],
  } as ExamsState;
  const deps = { state, masters: m, sis: { version: 1, households: [], students: [], curriculumRequests: [] } as never };
  assert.deepEqual(
    subjectsForMarkEntry(cls.id, [], state, deps).map((x) => x.code),
    ["ENG"],
    "a stale marks row for a co-scholastic subject never reaches the marks grid",
  );
}

console.log("OK — examSchemes.selftest.ts");
