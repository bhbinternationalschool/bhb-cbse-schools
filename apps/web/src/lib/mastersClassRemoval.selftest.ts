/**
 * Class / section removal cascade test.
 *
 * Removing a class used to delete only the class row, leaving its
 * subject links and teacher assignments pointing at an id that no longer
 * existed — rows no screen renders, nothing cleans up, and which still
 * counted toward "what is unassigned". This pins the cascade.
 *
 * Run: npx tsx src/lib/mastersClassRemoval.selftest.ts
 */
import assert from "node:assert/strict";

import {
  checkClassRemoval,
  emptyMastersShell,
  removeClass,
  removeSection,
  type MastersState,
} from "./masters";

console.log("mastersClassRemoval.selftest.ts");

const AY = "2026-27";
const CLASS = "cls_xi";
const OTHER = "cls_x";
const SEC = "sec_xi_a";
const OTHER_SEC = "sec_x_a";

function base(): MastersState {
  const m = emptyMastersShell();
  m.classes = [
    { id: CLASS, name: "XI", sortOrder: 11, isActive: true },
    { id: OTHER, name: "X", sortOrder: 10, isActive: true },
  ] as unknown as typeof m.classes;
  m.sections = [
    { id: SEC, classId: CLASS, name: "A", isActive: true },
    { id: OTHER_SEC, classId: OTHER, name: "A", isActive: true },
  ] as unknown as typeof m.sections;
  m.subjects = [
    { id: "sub_phy", nameEn: "Physics", sortOrder: 1 },
  ] as unknown as typeof m.subjects;
  m.classSubjects = [
    { id: "cs_xi", classId: CLASS, subjectId: "sub_phy", periodsPerWeek: 7, isActive: true },
    { id: "cs_x", classId: OTHER, subjectId: "sub_phy", periodsPerWeek: 7, isActive: true },
  ] as unknown as typeof m.classSubjects;
  m.staff = [
    {
      id: "stf_a",
      empCode: "T1",
      fullName: "Asha",
      stream: "teaching",
      status: "active",
      classTeacherLinks: [
        { id: "ct1", classId: CLASS, sectionId: SEC, academicYearCode: AY, isPrimary: true },
        { id: "ct2", classId: OTHER, sectionId: OTHER_SEC, academicYearCode: AY, isPrimary: true },
      ],
      subjectTeachingLinks: [
        { id: "st1", classId: CLASS, sectionId: SEC, subjectId: "sub_phy", academicYearCode: AY, periodsPerWeek: 7 },
        { id: "st2", classId: OTHER, sectionId: OTHER_SEC, subjectId: "sub_phy", academicYearCode: AY, periodsPerWeek: 7 },
      ],
    },
  ] as unknown as typeof m.staff;
  return m;
}

/* ------------------------------------------------------------------ */
/* 1. Sections still block removal                                      */
/* ------------------------------------------------------------------ */

{
  const m = base();
  const check = checkClassRemoval(m, CLASS);
  assert.equal(check.canRemove, false, "a class with a section cannot be removed");
  assert.ok(check.blockers.some((b) => b.includes("section")));
  const attempt = removeClass(m, CLASS);
  assert.equal(attempt.ok, false);
}

/* ------------------------------------------------------------------ */
/* 2. Fee groups block, and the message says where to unlink            */
/* ------------------------------------------------------------------ */

{
  const m = base();
  m.sections = m.sections.filter((s) => s.classId !== CLASS);
  m.feeGroups = [
    { id: "fg1", name: "New admission · XI–XII", classIds: [CLASS] },
  ] as unknown as typeof m.feeGroups;

  const check = checkClassRemoval(m, CLASS);
  assert.equal(check.canRemove, false, "a fee group holds the class");
  assert.ok(
    check.suggestion.includes("Masters → Fees"),
    "the blocker must say where to go, not just that something is linked",
  );
  assert.ok(check.suggestion.includes("Inactivate"));
}

/* ------------------------------------------------------------------ */
/* 3. Cascades are announced before the user confirms                   */
/* ------------------------------------------------------------------ */

{
  const m = base();
  m.sections = m.sections.filter((s) => s.classId !== CLASS);
  const check = checkClassRemoval(m, CLASS);
  assert.equal(check.canRemove, true);
  assert.ok(check.cascades?.some((c) => c.includes("subject link")));
  assert.ok(check.cascades?.some((c) => c.includes("teacher assignment")));
  assert.ok(
    check.suggestion.includes("Also deletes"),
    "the confirm text must state what else goes",
  );
}

/* ------------------------------------------------------------------ */
/* 4. Removing a class takes its links, and leaves other classes alone  */
/* ------------------------------------------------------------------ */

{
  const m = base();
  m.sections = m.sections.filter((s) => s.classId !== CLASS);

  const result = removeClass(m, CLASS);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  const next = result.state;

  assert.equal(next.classes.length, 1);
  assert.equal(next.classes[0]!.id, OTHER);

  assert.equal(
    next.classSubjects.filter((l) => l.classId === CLASS).length,
    0,
    "subject links must not survive their class",
  );
  assert.equal(
    next.classSubjects.filter((l) => l.classId === OTHER).length,
    1,
    "another class's links are untouched",
  );

  const asha = next.staff[0]!;
  assert.equal(
    asha.classTeacherLinks.filter((l) => l.classId === CLASS).length,
    0,
    "class-teacher links must not point at a deleted class",
  );
  assert.equal(
    asha.subjectTeachingLinks.filter((l) => l.classId === CLASS).length,
    0,
    "subject-teaching links must not point at a deleted class",
  );
  assert.equal(asha.classTeacherLinks.length, 1, "the other class survives");
  assert.equal(asha.subjectTeachingLinks.length, 1);

  // Nothing anywhere may still reference the removed id.
  const serialized = JSON.stringify(next);
  assert.equal(
    serialized.includes(CLASS),
    false,
    "no orphan reference to the removed class may remain",
  );
}

/* ------------------------------------------------------------------ */
/* 5. Removing a section takes the assignments that named it            */
/* ------------------------------------------------------------------ */

{
  const m = base();
  const result = removeSection(m, SEC);
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  const next = result.state;

  assert.equal(next.sections.filter((s) => s.id === SEC).length, 0);
  const asha = next.staff[0]!;
  assert.equal(
    asha.classTeacherLinks.filter((l) => l.sectionId === SEC).length,
    0,
    "a class teacher of a deleted section is not a class teacher",
  );
  assert.equal(
    asha.subjectTeachingLinks.filter((l) => l.sectionId === SEC).length,
    0,
  );
  assert.equal(
    asha.classTeacherLinks.length,
    1,
    "the other section's assignment survives",
  );
}

/* ------------------------------------------------------------------ */
/* 6. A class nothing references removes cleanly and quietly            */
/* ------------------------------------------------------------------ */

{
  const m = emptyMastersShell();
  m.classes = [
    { id: "cls_solo", name: "XIII", sortOrder: 13, isActive: true },
  ] as unknown as typeof m.classes;
  m.sections = [] as unknown as typeof m.sections;
  m.classSubjects = [] as unknown as typeof m.classSubjects;
  m.staff = [] as unknown as typeof m.staff;

  const check = checkClassRemoval(m, "cls_solo");
  assert.equal(check.canRemove, true);
  assert.equal(check.cascades?.length ?? 0, 0, "nothing to announce");
  const result = removeClass(m, "cls_solo");
  assert.equal(result.ok, true);
  if (!result.ok) throw new Error("unreachable");
  assert.equal(result.state.classes.length, 0);
}

console.log("  ✓ all class removal assertions passed");
