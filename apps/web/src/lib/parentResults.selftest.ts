/**
 * Parent results: nothing reaches a family unless the school released it,
 * and a released card shows only what the school's printed card prints.
 *
 * Run: npx tsx src/lib/parentResults.selftest.ts
 */
import assert from "node:assert/strict";

import {
  emptyExamParentRelease,
  isReleasedToParents,
  normalizeExamParentRelease,
  releaseSwitchFor,
  withReleaseSwitch,
} from "./examParentRelease";
import { normalizeReportCardTemplates, resolvePresentation } from "./examReportTemplates";
import type { ReportCard } from "./exams";
import { normalizeStudent } from "./sis";
import { toParentPrintableCard, toParentReportCardView } from "./parentResults";

console.log("parentResults.selftest.ts");

/* ── release switches ─────────────────────────────────────────────── */

{
  const empty = emptyExamParentRelease();
  assert.equal(isReleasedToParents(empty, "term_hy", "results"), false, "default is OFF");
  assert.equal(isReleasedToParents(null, "term_hy", "results"), false, "unknown is OFF");

  const on = withReleaseSwitch(empty, { termId: "term_hy", kind: "results", on: true, at: "2026-10-13T10:00:00Z", by: "Principal" });
  assert.equal(isReleasedToParents(on, "term_hy", "results"), true);
  assert.equal(isReleasedToParents(on, "term_hy", "dateSheet"), false, "switches are independent");
  assert.equal(isReleasedToParents(on, "term_ut1", "results"), false, "other exams untouched");
  assert.equal(releaseSwitchFor(on, "term_hy", "results")?.by, "Principal");

  const both = withReleaseSwitch(on, { termId: "term_hy", kind: "dateSheet", on: true, at: "x", by: "Office" });
  assert.equal(isReleasedToParents(both, "term_hy", "results"), true, "setting one keeps the other");
  const off = withReleaseSwitch(both, { termId: "term_hy", kind: "results", on: false, at: "y", by: "Office" });
  assert.equal(isReleasedToParents(off, "term_hy", "results"), false, "withdrawn");
  assert.equal(isReleasedToParents(off, "term_hy", "dateSheet"), true);
  assert.equal(off.terms.length, 1, "one row per exam");

  // A damaged row never releases anything.
  const damaged = normalizeExamParentRelease({
    terms: [
      { termId: "a", results: { on: "true" } },
      { termId: "b", results: { on: 1 } },
      { termId: "c", results: { on: true } },
      { termId: "c", results: { on: false } },
      { results: { on: true } },
      "junk",
    ],
  });
  assert.equal(isReleasedToParents(damaged, "a", "results"), false);
  assert.equal(isReleasedToParents(damaged, "b", "results"), false);
  assert.equal(isReleasedToParents(damaged, "c", "results"), true, "first row for an id wins");
  assert.equal(damaged.terms.length, 3);
  assert.deepEqual(normalizeExamParentRelease(null), emptyExamParentRelease());
  assert.deepEqual(normalizeExamParentRelease({ terms: "x" }), emptyExamParentRelease());
}

/* ── the card as the parent sees it ───────────────────────────────── */

function card(over: Partial<ReportCard["presentation"]> = {}, extra: Partial<ReportCard> = {}): ReportCard {
  const presentation = {
    ...resolvePresentation(normalizeReportCardTemplates([])[0]!, {
      showPhoto: false,
      showAttendance: true,
      showRank: false,
      showClassAverage: false,
      showResult: false,
    }),
    ...over,
  };
  return {
    student: normalizeStudent({
      id: "stu_1",
      fullName: "Aarav Singh",
      dob: "2015-04-02",
      fatherName: "R Singh",
      motherName: "S Singh",
      bloodGroup: "B+",
      heightCm: "130",
      weightKg: "28",
    }),
    classLabel: "V-A",
    examTerm: {
      id: "term_hy",
      code: "HY",
      label: "Half-yearly",
      academicYearCode: "2026-27",
      maxMarks: 80,
      sortOrder: 2,
      isActive: true,
      startsOn: "",
      endsOn: "",
      note: "",
      countsTowardHy: true,
      countsTowardFinal: true,
      weightInHy: 80,
      weightInFinal: 30,
      requiredOnMarksheet: true,
      requiresSeparateMarksheet: true,
    },
    academicYearCode: "2026-27",
    lines: [
      {
        subjectId: "sub_eng",
        subjectName: "English",
        maxMarks: 100,
        marksObtained: 72,
        grade: "B1",
        gradeLabel: "",
        absent: false,
        remark: "Reads well",
        parts: [
          { code: "TE", label: "Written", maxMarks: 80, marksObtained: 56, failed: false },
          { code: "OR", label: "Oral", maxMarks: 20, marksObtained: 16, failed: false },
        ],
        gradedParts: [{ code: "HW", label: "Handwriting", grade: "A" }],
      },
      {
        subjectId: "sub_mat",
        subjectName: "Mathematics",
        maxMarks: 100,
        marksObtained: null,
        grade: "AB",
        gradeLabel: "",
        absent: true,
        remark: "",
        parts: [],
      },
    ],
    components: [],
    aggregateMode: "none",
    totalObtained: 72,
    totalMax: 100,
    percent: 72,
    overallGrade: "B1",
    attendance: {
      presentDays: 90,
      workingDays: 100,
      percent: 90,
      edited: { note: "medical", by: "Clerk", at: "x", computedPresent: 88, computedWorking: 100 },
    },
    holdBlocked: true,
    holdMessage: "Report card held at S3 (40d overdue · ₹12,000 overdue)",
    curriculumSource: "class_map",
    curriculumNote: "Subject list is provisional",
    coScholastic: [{ domain: "ART", domainLabel: "Art", rating: "A", ratingLabel: "Outstanding" }],
    overallRemark: { text: "Good progress", textHi: "अच्छी प्रगति", source: "manual" },
    schemeId: "default",
    schemeName: "Default",
    displayMode: "marks_grade",
    rank: 3,
    classSize: 30,
    classAverage: 61.2,
    result: null,
    absent: null,
    absentSubjects: ["Mathematics"],
    showPhoto: false,
    presentation,
    ...extra,
  };
}

{
  // Everything on: the parent sees what the card prints.
  const v = toParentReportCardView(
    card({
      showPercent: true,
      showOverallGrade: true,
      showRank: true,
      showClassAverage: true,
      showRemarks: true,
      showSubjectRemarks: true,
      showComponents: true,
      showCoScholastic: true,
      showAttendance: true,
    }),
  );
  assert.equal(v.gradesOnly, false);
  assert.deepEqual(v.totals, { obtained: 72, max: 100 });
  assert.equal(v.percent, 72);
  assert.equal(v.overallGrade, "B1");
  assert.equal(v.rank, 3);
  assert.equal(v.classSize, 30);
  assert.equal(v.classAverage, 61.2);
  assert.equal(v.remark?.textHi, "अच्छी प्रगति");
  assert.equal(v.subjects[0]!.remark, "Reads well");
  assert.equal(v.subjects[0]!.parts.length, 2);
  assert.equal(v.subjects[0]!.gradedParts[0]!.grade, "A");
  assert.equal(v.subjects[1]!.absent, true);
  assert.equal(v.subjects[1]!.obtained, null);
  assert.equal(v.subjects[1]!.grade, "AB");
  assert.deepEqual(v.attendance, { presentDays: 90, workingDays: 100, percent: 90 });
  assert.equal(v.coScholastic.length, 1);
}

{
  // Everything off: no percentage, grade, rank, average, remarks, parts.
  const v = toParentReportCardView(
    card({
      showPercent: false,
      showOverallGrade: false,
      showRank: false,
      showClassAverage: false,
      showRemarks: false,
      showSubjectRemarks: false,
      showComponents: false,
      showCoScholastic: false,
      showAttendance: false,
    }),
  );
  assert.equal(v.percent, null);
  assert.equal(v.overallGrade, null);
  assert.equal(v.rank, null, "rank only when the card prints it");
  assert.equal(v.classSize, null);
  assert.equal(v.classAverage, null);
  assert.equal(v.remark, null, "remarks only when the card prints them");
  assert.equal(v.subjects[0]!.remark, "");
  assert.equal(v.subjects[0]!.parts.length, 0);
  assert.equal(v.attendance, null);
  assert.equal(v.coScholastic.length, 0);
  assert.deepEqual(v.totals, { obtained: 72, max: 100 }, "the marks table still has its total row");
}

{
  // Grades-only scheme: no numbers anywhere.
  const v = toParentReportCardView(card({ showPercent: true, showComponents: true }, { displayMode: "grade_only" }));
  assert.equal(v.gradesOnly, true);
  assert.equal(v.totals, null);
  assert.equal(v.percent, null);
  assert.equal(v.subjects[0]!.maxMarks, null);
  assert.equal(v.subjects[0]!.obtained, null);
  assert.equal(v.subjects[0]!.parts.length, 0);
  const hpc = toParentReportCardView(card({ layout: "hpc" }));
  assert.equal(hpc.gradesOnly, true, "HPC never shows numbers");
  assert.equal(hpc.descriptors, true);
}

{
  // The print copy leaves the office's private fields behind.
  const p = toParentPrintableCard(
    card({ showDob: false, showParents: false, showHealth: false, showRemarks: false, showSubjectRemarks: false, showRank: false }),
  );
  assert.equal(p.holdMessage, "");
  assert.equal(p.holdBlocked, false);
  assert.equal(p.curriculumNote, "");
  assert.equal(p.attendance?.edited, undefined, "who corrected attendance stays in the office");
  assert.equal(p.student.dob, "");
  assert.equal(p.student.fatherName, "");
  assert.equal(p.student.bloodGroup, "");
  assert.equal(p.overallRemark, null);
  assert.equal(p.lines[0]!.remark, "");
  assert.equal(p.rank, null);
  const keys = Object.keys(p.student).sort();
  assert.deepEqual(
    keys,
    ["admissionNo", "bloodGroup", "dob", "fatherName", "fullName", "heightCm", "id", "motherName", "photoUrl", "rollNo", "weightKg"],
    "no other SIS field (Aadhaar, phones, address) leaves the server",
  );
  const shown = toParentPrintableCard(card({ showDob: true, showParents: true }));
  assert.equal(shown.student.dob, "2015-04-02");
  assert.equal(shown.student.fatherName, p.student.fatherName === "" ? card().student.fatherName : "");
}

console.log("parentResults.selftest.ts: OK");
