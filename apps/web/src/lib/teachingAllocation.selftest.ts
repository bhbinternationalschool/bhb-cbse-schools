/**
 * Teaching allocation regression test.
 *
 * The desk this backs writes who teaches whom. The rules worth pinning:
 * a slot has one teacher, "all sections" really means all of them, and
 * pressing Add twice must not create two links.
 *
 * Run: npx tsx src/lib/teachingAllocation.selftest.ts
 */
import assert from "node:assert/strict";

import { emptyMastersShell, type MastersState } from "./masters";
import {
  assignClassTeacher,
  assignSubjectTeaching,
  classPeriodDemand,
  findPrimaryClassTeacher,
  findSubjectTeacherConflicts,
  listAllocationGaps,
  listClassSubjectOptions,
  removeSubjectTeaching,
  teacherWeeklyLoad,
} from "./teachingAllocation";

console.log("teachingAllocation.selftest.ts");

const AY = "2026-27";
const CLASS = "cls_8";
const SEC_A = "sec_8a";
const SEC_B = "sec_8b";
const MATH = "sub_math";
const SCIENCE = "sub_sci";

function baseMasters(): MastersState {
  const m = emptyMastersShell();
  m.classes = [
    { id: CLASS, name: "VIII", sortOrder: 8, isActive: true },
  ] as unknown as typeof m.classes;
  m.sections = [
    { id: SEC_A, classId: CLASS, name: "A", isActive: true },
    { id: SEC_B, classId: CLASS, name: "B", isActive: true },
  ] as unknown as typeof m.sections;
  m.subjects = [
    { id: MATH, nameEn: "Mathematics", sortOrder: 1 },
    { id: SCIENCE, nameEn: "Science", sortOrder: 2 },
  ] as unknown as typeof m.subjects;
  m.classSubjects = [
    { id: "cs1", classId: CLASS, subjectId: MATH, periodsPerWeek: 6, isActive: true },
    { id: "cs2", classId: CLASS, subjectId: SCIENCE, periodsPerWeek: 5, isActive: true },
  ] as unknown as typeof m.classSubjects;
  m.staff = [
    {
      id: "stf_asha",
      empCode: "T001",
      fullName: "Asha",
      stream: "teaching",
      status: "active",
      classTeacherLinks: [],
      subjectTeachingLinks: [],
    },
    {
      id: "stf_ravi",
      empCode: "T002",
      fullName: "Ravi",
      stream: "teaching",
      status: "active",
      classTeacherLinks: [],
      subjectTeachingLinks: [],
    },
  ] as unknown as typeof m.staff;
  return m;
}

/* ------------------------------------------------------------------ */
/* 1. The picker offers only the class's own curriculum                 */
/* ------------------------------------------------------------------ */

{
  const m = baseMasters();
  const options = listClassSubjectOptions(m, CLASS);
  assert.equal(options.length, 2);
  assert.equal(options[0]!.name, "Mathematics");
  assert.equal(options[0]!.periodsPerWeek, 6);

  assert.deepEqual(
    listClassSubjectOptions(m, "cls_does_not_exist"),
    [],
    "an unknown class offers nothing rather than the whole subject master",
  );
  assert.deepEqual(listClassSubjectOptions(m, ""), []);
}

/* ------------------------------------------------------------------ */
/* 2. Assigning subjects, and not duplicating them                      */
/* ------------------------------------------------------------------ */

{
  let m = baseMasters();
  const first = assignSubjectTeaching(m, {
    staffId: "stf_asha",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: SEC_A,
    subjectIds: [MATH, SCIENCE],
  });
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("unreachable");
  m = first.masters;
  assert.equal(first.added, 2);

  const asha = m.staff.find((s) => s.id === "stf_asha")!;
  assert.equal(asha.subjectTeachingLinks.length, 2);
  assert.equal(
    asha.subjectTeachingLinks[0]!.periodsPerWeek,
    6,
    "periods default to the curriculum's figure",
  );

  // Pressing Add again with the same selection must not double up.
  const again = assignSubjectTeaching(m, {
    staffId: "stf_asha",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: SEC_A,
    subjectIds: [MATH, SCIENCE],
  });
  assert.equal(again.ok, false, "re-adding the same subjects adds nothing");

  // A partly-new selection adds only the new part.
  const removed = removeSubjectTeaching(m, "stf_asha", asha.subjectTeachingLinks[1]!.id);
  const partial = assignSubjectTeaching(removed, {
    staffId: "stf_asha",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: SEC_A,
    subjectIds: [MATH, SCIENCE],
  });
  assert.equal(partial.ok, true);
  if (!partial.ok) throw new Error("unreachable");
  assert.equal(partial.added, 1);
  assert.ok(partial.skipped.includes("Mathematics"));
}

/* ------------------------------------------------------------------ */
/* 3. A subject off the class's curriculum is refused                   */
/* ------------------------------------------------------------------ */

{
  const m = baseMasters();
  const result = assignSubjectTeaching(m, {
    staffId: "stf_asha",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: SEC_A,
    subjectIds: ["sub_astrophysics"],
  });
  assert.equal(
    result.ok,
    false,
    "a subject the class does not take cannot be assigned",
  );
}

/* ------------------------------------------------------------------ */
/* 4. Conflicts across teachers are reported, not merged                */
/* ------------------------------------------------------------------ */

{
  let m = baseMasters();
  const asha = assignSubjectTeaching(m, {
    staffId: "stf_asha",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: SEC_A,
    subjectIds: [MATH],
  });
  if (!asha.ok) throw new Error("unreachable");
  m = asha.masters;

  const clash = findSubjectTeacherConflicts(m, {
    academicYearCode: AY,
    classId: CLASS,
    sectionId: SEC_A,
    subjectId: MATH,
    exceptStaffId: "stf_ravi",
  });
  assert.equal(clash.length, 1);
  assert.equal(clash[0]!.teacherName, "Asha");

  // A different section of the same class is not a clash.
  assert.equal(
    findSubjectTeacherConflicts(m, {
      academicYearCode: AY,
      classId: CLASS,
      sectionId: SEC_B,
      subjectId: MATH,
      exceptStaffId: "stf_ravi",
    }).length,
    0,
  );

  // Neither is a different subject, or a different year.
  assert.equal(
    findSubjectTeacherConflicts(m, {
      academicYearCode: AY,
      classId: CLASS,
      sectionId: SEC_A,
      subjectId: SCIENCE,
    }).length,
    0,
  );
  assert.equal(
    findSubjectTeacherConflicts(m, {
      academicYearCode: "2027-28",
      classId: CLASS,
      sectionId: SEC_A,
      subjectId: MATH,
    }).length,
    0,
  );

  // The holder themselves is not their own conflict.
  assert.equal(
    findSubjectTeacherConflicts(m, {
      academicYearCode: AY,
      classId: CLASS,
      sectionId: SEC_A,
      subjectId: MATH,
      exceptStaffId: "stf_asha",
    }).length,
    0,
  );
}

/* ------------------------------------------------------------------ */
/* 5. "All sections" collides with every single section                 */
/* ------------------------------------------------------------------ */

{
  let m = baseMasters();
  const all = assignSubjectTeaching(m, {
    staffId: "stf_asha",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: null, // every section
    subjectIds: [MATH],
  });
  if (!all.ok) throw new Error("unreachable");
  m = all.masters;

  for (const section of [SEC_A, SEC_B]) {
    assert.equal(
      findSubjectTeacherConflicts(m, {
        academicYearCode: AY,
        classId: CLASS,
        sectionId: section,
        subjectId: MATH,
        exceptStaffId: "stf_ravi",
      }).length,
      1,
      "an all-sections link covers each individual section",
    );
  }

  // And the reverse: asking about all-sections finds a single-section holder.
  let m2 = baseMasters();
  const one = assignSubjectTeaching(m2, {
    staffId: "stf_asha",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: SEC_B,
    subjectIds: [MATH],
  });
  if (!one.ok) throw new Error("unreachable");
  m2 = one.masters;
  assert.equal(
    findSubjectTeacherConflicts(m2, {
      academicYearCode: AY,
      classId: CLASS,
      sectionId: null,
      subjectId: MATH,
      exceptStaffId: "stf_ravi",
    }).length,
    1,
  );

  // An all-sections holder cannot then be given one of those sections.
  const narrower = assignSubjectTeaching(m, {
    staffId: "stf_asha",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: SEC_A,
    subjectIds: [MATH],
  });
  assert.equal(narrower.ok, false, "already covered by the all-sections link");
}

/* ------------------------------------------------------------------ */
/* 6. Class teacher: one primary per section                            */
/* ------------------------------------------------------------------ */

{
  let m = baseMasters();
  const first = assignClassTeacher(m, {
    staffId: "stf_asha",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: SEC_A,
  });
  assert.equal(first.ok, true);
  if (!first.ok) throw new Error("unreachable");
  m = first.masters;
  assert.equal(first.replaced, null);
  assert.equal(
    findPrimaryClassTeacher(m, {
      academicYearCode: AY,
      classId: CLASS,
      sectionId: SEC_A,
    })?.teacherName,
    "Asha",
  );

  // Assigning the same teacher twice is refused.
  assert.equal(
    assignClassTeacher(m, {
      staffId: "stf_asha",
      academicYearCode: AY,
      classId: CLASS,
      sectionId: SEC_A,
    }).ok,
    false,
  );

  // Promoting Ravi demotes Asha rather than leaving two primaries.
  const second = assignClassTeacher(m, {
    staffId: "stf_ravi",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: SEC_A,
  });
  assert.equal(second.ok, true);
  if (!second.ok) throw new Error("unreachable");
  m = second.masters;
  assert.equal(second.replaced, "Asha", "the caller is told who was replaced");

  const primaries = m.staff.flatMap((s) =>
    (s.classTeacherLinks ?? []).filter(
      (l) => l.classId === CLASS && l.sectionId === SEC_A && l.isPrimary,
    ),
  );
  assert.equal(primaries.length, 1, "exactly one primary class teacher");
  assert.equal(
    findPrimaryClassTeacher(m, {
      academicYearCode: AY,
      classId: CLASS,
      sectionId: SEC_A,
    })?.teacherName,
    "Ravi",
  );

  // Asha keeps the link, just not the primary flag — history is not erased.
  const ashaNow = m.staff.find((s) => s.id === "stf_asha")!;
  assert.equal(ashaNow.classTeacherLinks.length, 1);
  assert.equal(ashaNow.classTeacherLinks[0]!.isPrimary, false);
}

/* ------------------------------------------------------------------ */
/* 7. Gaps count down as assignments are made                           */
/* ------------------------------------------------------------------ */

{
  let m = baseMasters();
  // 2 sections × 2 subjects
  assert.equal(listAllocationGaps(m, AY).length, 4);

  const one = assignSubjectTeaching(m, {
    staffId: "stf_asha",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: SEC_A,
    subjectIds: [MATH],
  });
  if (!one.ok) throw new Error("unreachable");
  m = one.masters;
  assert.equal(listAllocationGaps(m, AY).length, 3);

  // An all-sections assignment closes both sections at once.
  const all = assignSubjectTeaching(m, {
    staffId: "stf_ravi",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: null,
    subjectIds: [SCIENCE],
  });
  if (!all.ok) throw new Error("unreachable");
  m = all.masters;
  const remaining = listAllocationGaps(m, AY);
  assert.equal(remaining.length, 1, "only VIII-B Mathematics is left");
  assert.equal(remaining[0]!.sectionName, "B");
  assert.equal(remaining[0]!.subjectName, "Mathematics");
  assert.equal(remaining[0]!.periodsPerWeek, 6);
}

/* ------------------------------------------------------------------ */
/* 8. A subject with no curriculum periods is not a gap                 */
/* ------------------------------------------------------------------ */

{
  const m = baseMasters();
  m.classSubjects = [
    { id: "cs1", classId: CLASS, subjectId: MATH, periodsPerWeek: 0, isActive: true },
  ] as unknown as typeof m.classSubjects;
  assert.equal(
    listAllocationGaps(m, AY).length,
    0,
    "a subject the school allots no periods to is not an unfilled slot",
  );
}

/* ------------------------------------------------------------------ */
/* 9. Weekly load, including the all-sections multiplier                */
/* ------------------------------------------------------------------ */

{
  let m = baseMasters();
  const single = assignSubjectTeaching(m, {
    staffId: "stf_asha",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: SEC_A,
    subjectIds: [MATH],
  });
  if (!single.ok) throw new Error("unreachable");
  m = single.masters;
  assert.equal(teacherWeeklyLoad(m, "stf_asha", AY), 6);

  const across = assignSubjectTeaching(m, {
    staffId: "stf_ravi",
    academicYearCode: AY,
    classId: CLASS,
    sectionId: null,
    subjectIds: [SCIENCE],
  });
  if (!across.ok) throw new Error("unreachable");
  m = across.masters;
  assert.equal(
    teacherWeeklyLoad(m, "stf_ravi", AY),
    10,
    "5 periods taught to each of 2 sections is 10, not 5",
  );

  assert.equal(teacherWeeklyLoad(m, "stf_nobody", AY), 0);
}

/* ------------------------------------------------------------------ */
/* 10. Electives must not be summed into the timetable load             */
/* ------------------------------------------------------------------ */

{
  // Class IX as it really is in this school: 30 compulsory periods plus
  // nine electives totalling 23. Adding all of them gives 53 and makes a
  // 48-slot week look overloaded — which is exactly the false alarm this
  // assertion exists to prevent.
  const m = baseMasters();
  m.subjects = [
    { id: "s_math", nameEn: "Mathematics", sortOrder: 1 },
    { id: "s_sci", nameEn: "Science", sortOrder: 2 },
    { id: "s_eng", nameEn: "English", sortOrder: 3 },
    { id: "s_hin", nameEn: "Hindi", sortOrder: 4 },
    { id: "s_sst", nameEn: "Social Science", sortOrder: 5 },
    { id: "s_sans", nameEn: "Sanskrit", sortOrder: 6 },
    { id: "s_urdu", nameEn: "Urdu", sortOrder: 7 },
  ] as unknown as typeof m.subjects;
  m.classSubjects = [
    { id: "a", classId: CLASS, subjectId: "s_math", periodsPerWeek: 7, isActive: true },
    { id: "b", classId: CLASS, subjectId: "s_sci", periodsPerWeek: 7, isActive: true },
    { id: "c", classId: CLASS, subjectId: "s_eng", periodsPerWeek: 6, isActive: true },
    { id: "d", classId: CLASS, subjectId: "s_hin", periodsPerWeek: 5, isActive: true },
    { id: "e", classId: CLASS, subjectId: "s_sst", periodsPerWeek: 5, isActive: true },
    // The two third-language alternatives: a student takes one.
    { id: "f", classId: CLASS, subjectId: "s_sans", periodsPerWeek: 4, isActive: true, isOptional: true },
    { id: "g", classId: CLASS, subjectId: "s_urdu", periodsPerWeek: 4, isActive: true, isOptional: true },
  ] as unknown as typeof m.classSubjects;

  const demand = classPeriodDemand(m, CLASS);
  assert.equal(demand.compulsory, 30);
  assert.equal(demand.optionalTotal, 8, "both alternatives, added up");
  assert.equal(demand.largestOptional, 4, "what one student actually takes");
  assert.equal(
    demand.effective,
    34,
    "compulsory plus ONE elective — alternatives share a slot",
  );
  assert.equal(demand.naiveTotal, 38);
  assert.ok(
    demand.effective < 48,
    "the class fits a 48-slot week; only the naive sum suggested otherwise",
  );
  assert.ok(
    demand.effective < demand.naiveTotal,
    "the effective figure must never be the naive one",
  );

  // Electives still need teachers — they are gaps, just labelled.
  const gaps = listAllocationGaps(m, AY);
  const sanskrit = gaps.find((g) => g.subjectName === "Sanskrit");
  const maths = gaps.find((g) => g.subjectName === "Mathematics");
  assert.ok(sanskrit, "an elective with no teacher is still an unfilled slot");
  assert.equal(sanskrit!.isOptional, true);
  assert.equal(maths!.isOptional, false);
}

/* ------------------------------------------------------------------ */
/* 11. A class with no electives is unaffected                          */
/* ------------------------------------------------------------------ */

{
  const m = baseMasters(); // Maths 6 + Science 5, neither optional
  const demand = classPeriodDemand(m, CLASS);
  assert.equal(demand.compulsory, 11);
  assert.equal(demand.optionalTotal, 0);
  assert.equal(demand.largestOptional, 0);
  assert.equal(
    demand.effective,
    demand.naiveTotal,
    "with no electives both figures agree",
  );
}

console.log("  ✓ all teaching allocation assertions passed");
