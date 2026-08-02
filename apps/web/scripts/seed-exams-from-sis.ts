#!/usr/bin/env npx tsx
/**
 * Seed exam_desk_* from active SIS students (default terms/subjects + UT1 mark sheets).
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-exams-from-sis.ts
 *   cd apps/web && npx tsx scripts/seed-exams-from-sis.ts --term=term_ut1
 */

import {
  gradeFromMarks,
  loadExams,
  type ExamsState,
  type MarkSheet,
  type StudentSubjectMark,
} from "../src/lib/exams";
import { DEFAULT_AY } from "../src/lib/masters";
import { fetchSisFromDb } from "../src/lib/sisNormalized.server";
import {
  fetchExamDeskFromDb,
  pushExamDeskToDb,
} from "../src/lib/examsNormalized.server";

const SEED_SUBJECT_IDS = ["sub_eng", "sub_hin", "sub_mat"];
const UT_MAX_MARKS = 40;

function termIdArg(): string {
  const arg = process.argv.find((a) => a.startsWith("--term="));
  return arg?.split("=")[1]?.trim() || "term_ut1";
}

function groupKey(classId: string, sectionId: string) {
  return `${classId}::${sectionId}`;
}

function pseudoMark(studentIndex: number, subjectIndex: number): number {
  return 22 + ((studentIndex * 7 + subjectIndex * 11) % 17);
}

function buildMarks(
  students: { id: string }[],
  subjectIds: string[],
): StudentSubjectMark[] {
  const marks: StudentSubjectMark[] = [];
  students.forEach((st, si) => {
    subjectIds.forEach((subjectId, subi) => {
      const obtained = pseudoMark(si, subi);
      marks.push({
        studentId: st.id,
        subjectId,
        marksObtained: obtained,
        grade: gradeFromMarks(obtained, UT_MAX_MARKS),
        remark: "",
      });
    });
  });
  return marks;
}

async function main() {
  const examTermId = termIdArg();
  const { bundle } = await fetchSisFromDb();
  const active = bundle.students.filter(
    (s) => s.status === "active" && s.classId && s.sectionId,
  );
  if (!active.length) {
    throw new Error("No active SIS students with class/section — seed SIS first.");
  }

  const bySection = new Map<string, typeof active>();
  for (const s of active) {
    const key = groupKey(s.classId, s.sectionId);
    const list = bySection.get(key) ?? [];
    list.push(s);
    bySection.set(key, list);
  }

  const now = new Date().toISOString();
  const base = loadExams();
  const subjectIds = SEED_SUBJECT_IDS.filter((id) =>
    base.subjects.some((s) => s.id === id),
  );
  if (!subjectIds.length) {
    throw new Error("Default exam subjects missing — check exams emptyState.");
  }
  if (!base.terms.some((t) => t.id === examTermId)) {
    throw new Error(`Unknown exam term ${examTermId}`);
  }

  const sheets: MarkSheet[] = [];
  for (const [, students] of bySection) {
    const sample = students[0]!;
    sheets.push({
      id: `ms_seed_${examTermId}_${sample.classId}_${sample.sectionId}`,
      academicYearCode: sample.academicYearCode || DEFAULT_AY,
      examTermId,
      classId: sample.classId,
      sectionId: sample.sectionId,
      marks: buildMarks(students, subjectIds),
      lockedAt: null,
      enteredBy: "seed-exams-from-sis",
      updatedAt: now,
    });
  }

  const state: ExamsState = {
    ...base,
    sheets,
  };

  const markCount = sheets.reduce((n, s) => n + s.marks.length, 0);
  console.log(
    `Seeding ${sheets.length} mark sheets (${markCount} marks) for ${examTermId}`,
  );

  const before = await fetchExamDeskFromDb();
  console.log(
    `DB before: ${before.bundle.sheets.length} sheets, ${before.meta?.markCount ?? 0} marks`,
  );

  const result = await pushExamDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchExamDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.bundle.sheets.length} sheets, ${after.meta?.markCount ?? 0} marks, ${after.bundle.terms.length} terms, ${after.bundle.subjects.length} subjects`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
