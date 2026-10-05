/**
 * Self-test: npx tsx src/lib/examReadiness.selftest.ts
 * What the exam dashboard calls ready, partial and pending.
 */
import assert from "node:assert/strict";
import { readinessStatusLabel, sectionReadiness, type SectionReadinessInput } from "./examReadiness";

const mark = (studentId: string, subjectId: string, marksObtained: number | null, component = "", grade = "") => ({
  studentId,
  subjectId,
  component,
  marksObtained,
  grade,
  remark: "",
  remarkSource: "manual" as const,
});

const base: SectionReadinessInput = {
  studentIds: ["s1", "s2"],
  columns: [
    { subjectId: "ENG", subjectName: "English", component: "W" },
    { subjectId: "ENG", subjectName: "English", component: "O" },
    { subjectId: "MATH", subjectName: "Mathematics", component: "" },
  ],
  takes: new Map(),
  areas: [{ code: "ART", label: "Art Education" }],
  sheet: null,
  entryMode: "marks",
};

// No sheet: nothing filled, every part pending.
{
  const r = sectionReadiness(base);
  assert.equal(r.status, "not_started");
  assert.equal(r.total, 8); // 2 students × (2 English parts + Maths + Art)
  assert.deepEqual(r.pending.map((p) => p.label), ["English", "Mathematics", "Art Education"]);
  assert.equal(r.studentsPending, 2);
}

// Partial: English Oral missing for s2, Art not rated for s2.
{
  const r = sectionReadiness({
    ...base,
    sheet: {
      marks: [
        mark("s1", "ENG", 30, "W"),
        mark("s1", "ENG", 8, "O"),
        mark("s1", "MATH", 0), // a zero is a mark, not a gap
        mark("s2", "ENG", 25, "W"),
        mark("s2", "ENG", null, "O"),
        mark("s2", "MATH", 40),
      ],
      absences: [],
      coScholastic: [
        { studentId: "s1", domain: "ART", rating: "A" },
        { studentId: "s2", domain: "ART", rating: null },
      ],
      lockedAt: null,
    },
  });
  assert.equal(r.status, "partial");
  assert.equal(r.filled, 6);
  assert.deepEqual(
    r.pending.map((p) => `${p.label} ${p.filled}/${p.total}`),
    ["English 3/4", "Art Education 1/2"],
  );
  assert.equal(r.studentsPending, 1);
  assert.equal(readinessStatusLabel(r), "Partial");
}

// Absent counts as answered for every part of that subject; AB rating counts too.
{
  const r = sectionReadiness({
    ...base,
    sheet: {
      marks: [mark("s1", "ENG", 30, "W"), mark("s1", "ENG", 8, "O"), mark("s1", "MATH", 33)],
      absences: [
        { studentId: "s2", subjectId: "ENG", reason: "" },
        { studentId: "s2", subjectId: "MATH", reason: "ill" },
      ],
      coScholastic: [
        { studentId: "s1", domain: "ART", rating: "B" },
        { studentId: "s2", domain: "ART", rating: "AB" },
      ],
      lockedAt: "2026-10-05T10:00:00Z",
    },
  });
  assert.equal(r.status, "ready");
  assert.equal(r.pending.length, 0);
  assert.equal(readinessStatusLabel(r), "Ready · locked");
}

// A subject the child does not take is not a gap.
{
  const r = sectionReadiness({
    ...base,
    areas: [],
    takes: new Map([
      ["s1", new Set(["ENG", "MATH"])],
      ["s2", new Set(["ENG"])],
    ]),
    sheet: {
      marks: [mark("s1", "ENG", 1, "W"), mark("s1", "ENG", 1, "O"), mark("s1", "MATH", 1), mark("s2", "ENG", 1, "W"), mark("s2", "ENG", 1, "O")],
      absences: [],
      coScholastic: [],
      lockedAt: null,
    },
  });
  assert.equal(r.status, "ready");
  assert.equal(r.total, 5);
}

// Grade-only schemes read the grade, and "—" is the empty placeholder.
{
  const r = sectionReadiness({
    ...base,
    studentIds: ["s1"],
    columns: [{ subjectId: "EVS", subjectName: "EVS", component: "" }],
    areas: [],
    entryMode: "grades",
    sheet: { marks: [mark("s1", "EVS", null, "", "—")], absences: [], coScholastic: [], lockedAt: null },
  });
  assert.equal(r.status, "not_started");
  const r2 = sectionReadiness({
    ...base,
    studentIds: ["s1"],
    columns: [{ subjectId: "EVS", subjectName: "EVS", component: "" }],
    areas: [],
    entryMode: "grades",
    sheet: { marks: [mark("s1", "EVS", null, "", "A1")], absences: [], coScholastic: [], lockedAt: null },
  });
  assert.equal(r2.status, "ready");
}

// Empty section and a section with nothing to enter are their own states.
assert.equal(sectionReadiness({ ...base, studentIds: [] }).status, "no_students");
assert.equal(sectionReadiness({ ...base, columns: [], areas: [] }).status, "nothing_to_enter");

console.log("examReadiness selftest: ok");
