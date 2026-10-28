/**
 * Run: npx tsx src/lib/academicsMastersAsData.selftest.ts
 *
 * data-layer 2.3b-2: the academics readers take Masters (and, where they
 * read it, the student register) as DATA. Handed none, they refuse — they
 * never fall back to `loadMasters()`, whose answer before the tab's copy
 * loaded was an empty book: "no subjects" on a VI marks sheet, "no next
 * class" on a result sheet, a report built over zero classes.
 *
 * Fail-on-old: every "refuses" case below answered (empty, or from the
 * fallback copy) on origin/main before this change.
 */
import assert from "node:assert/strict";
import { normalizeSubject, type ClassSubjectLink, type Subject } from "./foundationMasters";
import { defaultMasters, type MastersState } from "./masters";
import { emptySisState, type SisState, type SisStudent } from "./sis";
import {
  buildClassResultSheet,
  buildReportCard,
  defaultSectionForClass,
  loadExams,
  nextClassAfter,
  saveExamDateSheetEntry,
  subjectTakeMap,
  writeExamsLocalRaw,
  subjectsForMarkEntry,
  subjectsForStudent,
  syncExamSubjectsFromMasters,
  type ExamTerm,
  type ExamsState,
} from "./exams";
import { runPtmReport } from "./ptm";
import { runStudentLeaveReport } from "./studentLeave";
import { runTimetableReport } from "./timetableReportCatalog";
import { runTeachingReport } from "./teachingReportCatalog";
import { runHomeworkReport } from "./homework";
import { runExamReport } from "./examReportCatalog";
import { upgradeStudentClass } from "./classUpgrade";
import { downloadAdmitCardsPdf } from "./admitCardPdf";
import { canOverrideAttendanceLock, resolveAttendanceException } from "./attendance";
import { MASTERS_NOT_LOADED_MESSAGE } from "./data/requireData";

console.log("academicsMastersAsData.selftest.ts");

let failures = 0;
async function check(name: string, fn: () => void | Promise<void>) {
  try {
    await fn();
    console.log(`  ok   ${name}`);
  } catch (e) {
    failures++;
    console.log(`  FAIL ${name}\n       ${e instanceof Error ? e.message : String(e)}`);
  }
}

/** The reader refused with DataNotLoadedError — not some other failure. */
function refuses(fn: () => unknown, label: string) {
  let thrown: unknown = null;
  let answer: unknown;
  try {
    answer = fn();
  } catch (e) {
    thrown = e;
  }
  assert.ok(
    thrown instanceof Error && thrown.name === "DataNotLoadedError",
    `${label}: expected a refusal (DataNotLoadedError), got ${
      thrown ? `${(thrown as Error).name}: ${(thrown as Error).message}` : `an answer: ${JSON.stringify(answer)?.slice(0, 160)}`
    }`,
  );
}

// ── Fixture: Class VI with Sanskrit linked COMPULSORY (the #725 case) ─────
const base = defaultMasters();
const vi = base.classes.find((c) => c.name === "VI")!;
const vii = base.classes.find((c) => c.name === "VII")!;
const sub = (code: string, nameEn: string, extra: Partial<Subject> = {}): Subject =>
  normalizeSubject({ id: `s-${code}`, code, nameEn, ...extra });
const subjects = [
  sub("ENG", "English", { ncfTagId: "D" }),
  sub("HIN", "Hindi", { ncfTagId: "D" }),
  sub("SKT", "Sanskrit", { ncfTagId: "A" }),
  sub("MAT", "Mathematics"),
];
const classSubjects: ClassSubjectLink[] = subjects.map((s, i) => ({
  id: `l${i}`,
  classId: vi.id,
  subjectId: s.id,
  periodsPerWeek: 5,
  isActive: true,
  isOptional: false,
}));
const AY = "2026-27";
const viSection = base.sections.find((s) => s.classId === vi.id) ?? {
  id: "sec-vi-a",
  classId: vi.id,
  name: "A",
  isActive: true,
};
const masters = {
  ...base,
  subjects,
  classSubjects,
  sections: base.sections.some((s) => s.id === viSection.id) ? base.sections : [...base.sections, viSection],
} as MastersState;

const kid = {
  id: "stu-vi-1",
  fullName: "Asha",
  admissionNo: "1",
  rollNo: "1",
  classId: vi.id,
  sectionId: viSection.id,
  status: "active",
  academicYearCode: AY,
  joinedOn: "2024-04-01",
  campusId: "",
  householdId: "",
} as unknown as SisStudent;
const sis: SisState = { ...emptySisState(), students: [kid] };

const TERM: ExamTerm = {
  id: "term_pt1",
  code: "PT1",
  label: "Periodic Test 1",
  academicYearCode: AY,
  maxMarks: 40,
  sortOrder: 1,
  isActive: true,
  startsOn: "",
  endsOn: "",
  note: "",
  countsTowardHy: false,
  countsTowardFinal: false,
  weightInHy: 0,
  weightInFinal: 0,
  requiredOnMarksheet: false,
  requiresSeparateMarksheet: false,
};
const exams: ExamsState = { ...loadExams(), terms: [TERM], subjects: [], dateSheet: [] };

async function main() {
  // ── With the data in hand: the answer (Sanskrit on VI's marks sheet) ────
  await check("given Masters, VI mark entry lists Sanskrit (compulsory in Masters)", () => {
    const codes = subjectsForMarkEntry(vi.id, [kid], exams, { state: exams, masters, sis }).map((s) => s.code);
    assert.ok(codes.includes("SKT"), `VI subjects: ${codes.join(", ")}`);
  });
  await check("given Masters, next class after VI is VII", () => {
    assert.equal(nextClassAfter(vi.id, masters)?.id, vii.id);
  });

  // ── Not loaded yet: refuse, never an empty answer ───────────────────────
  // `as never`: an old caller (or a screen rendering before Masters landed)
  // that passes nothing. The types forbid it; the readers refuse it anyway.
  await check("subjectsForMarkEntry without Masters refuses (old: [] or the fallback copy's subjects)", () =>
    refuses(() => subjectsForMarkEntry(vi.id, [kid], exams, { state: exams, sis } as never), "subjectsForMarkEntry"));
  await check("subjectsForMarkEntry without the register refuses", () =>
    refuses(() => subjectsForMarkEntry(vi.id, [kid], exams, { state: exams, masters } as never), "subjectsForMarkEntry/sis"));
  await check("subjectsForStudent without Masters refuses", () =>
    refuses(() => subjectsForStudent(kid, exams, { state: exams, sis } as never), "subjectsForStudent"));
  await check("subjectTakeMap without Masters refuses", () =>
    refuses(() => subjectTakeMap([kid], [], exams, { state: exams, sis } as never), "subjectTakeMap"));
  await check("syncExamSubjectsFromMasters without Masters refuses (old: returned the catalog unwidened)", () =>
    refuses(() => syncExamSubjectsFromMasters(vi.id, exams, { state: exams, sis } as never), "syncExamSubjectsFromMasters"));
  await check("buildReportCard without Masters refuses", () =>
    refuses(
      () => buildReportCard({ student: kid, classLabel: "VI-A", examTermId: TERM.id, academicYearCode: AY, deps: { state: exams, sis } as never }),
      "buildReportCard",
    ));
  await check("buildClassResultSheet without Masters refuses", () =>
    refuses(
      () =>
        buildClassResultSheet({
          students: [kid],
          classLabel: "VI-A",
          classId: vi.id,
          sectionId: viSection.id,
          examTermId: TERM.id,
          academicYearCode: AY,
          deps: { state: exams, sis } as never,
        }),
      "buildClassResultSheet",
    ));
  await check("nextClassAfter without Masters refuses (old: null = 'no next class')", () =>
    refuses(() => nextClassAfter(vi.id, undefined as never), "nextClassAfter"));
  await check("defaultSectionForClass without Masters refuses (old: null = 'no section')", () =>
    refuses(() => defaultSectionForClass(vi.id, undefined as never), "defaultSectionForClass"));
  await check("saveExamDateSheetEntry without Masters refuses (old: session dates from the fallback copy)", () =>
    refuses(
      () => {
        // The date-sheet writer reads the exams book from storage.
        writeExamsLocalRaw({
          ...exams,
          subjects: [{ id: "sub_probe", code: "PRB", name: "Probe", classIds: [], maxMarks: 100, sortOrder: 1, isActive: true }],
        });
        return saveExamDateSheetEntry({
          academicYearCode: AY,
          examTermId: TERM.id,
          classId: vi.id,
          subjectId: "sub_probe",
          date: "2026-11-10",
          startTime: "09:00",
          durationMinutes: 60,
        } as never);
      },
      "saveExamDateSheetEntry",
    ));
  await check("upgradeStudentClass without Masters refuses", () =>
    refuses(
      () => upgradeStudentClass({ studentId: kid.id, toClassId: vii.id, toSectionId: "x" } as never),
      "upgradeStudentClass",
    ));
  await check("resolveAttendanceException without Masters refuses", () =>
    refuses(() => resolveAttendanceException({ id: "x", note: "n", resolvedBy: "me" } as never), "resolveAttendanceException"));
  await check("canOverrideAttendanceLock: no Masters = no grant proven = no override", () => {
    const teacher = { roleCode: "teacher", staffId: "t1", fullName: "T" } as never;
    assert.equal(canOverrideAttendanceLock(null, teacher), false);
    assert.equal(canOverrideAttendanceLock(null, { roleCode: "office" } as never), true, "office roles never needed Masters");
  });
  await check("downloadAdmitCardsPdf without Masters refuses before drawing", async () => {
    let thrown: unknown = null;
    try {
      await downloadAdmitCardsPdf([{ qrPayload: "x" } as never], {} as never);
    } catch (e) {
      thrown = e;
    }
    assert.ok(
      thrown instanceof Error && thrown.name === "DataNotLoadedError",
      `expected DataNotLoadedError, got ${thrown instanceof Error ? `${thrown.name}: ${thrown.message}` : String(thrown)}`,
    );
  });

  // ── Report runners: a refusal the screen shows, never an empty file ─────
  const notLoaded = (r: { ok: boolean; error?: string; message?: string }, label: string) =>
    assert.deepEqual(r, { ok: false, error: MASTERS_NOT_LOADED_MESSAGE }, `${label}: ${JSON.stringify(r)}`);
  await check("runPtmReport with Masters not loaded refuses", () =>
    notLoaded(runPtmReport("bookings_register", { format: "excel", masters: null, ptm: { events: [], slots: [], bookings: [], feedback: [] } as never }), "ptm"));
  await check("runStudentLeaveReport with Masters not loaded refuses", () =>
    notLoaded(
      runStudentLeaveReport("leave_register", { academicYearCode: AY, fromDate: "2026-04-01", toDate: "2026-10-01", format: "excel", masters: null, leave: { requests: [] } as never }),
      "student leave",
    ));
  await check("runTimetableReport with Masters not loaded refuses", () =>
    notLoaded(runTimetableReport("teacher_load", { academicYearCode: AY, format: "excel", masters: null, timetable: { grids: [], publishedGrids: [] } as never }), "timetable"));
  await check("runTeachingReport with Masters not loaded refuses", () =>
    notLoaded(runTeachingReport("syllabus_coverage", { academicYearCode: AY, format: "excel", masters: null }), "teaching"));
  await check("runHomeworkReport with Masters not loaded refuses", () =>
    notLoaded(
      runHomeworkReport("missing_hw_days", { academicYearCode: AY, fromDate: "2026-10-01", toDate: "2026-10-09", format: "excel", masters: null, homework: { posts: [], diary: [] } as never, sis }),
      "homework",
    ));
  await check("runExamReport with Masters not loaded refuses", () =>
    notLoaded(runExamReport("result_summary", { examTermId: TERM.id, academicYearCode: AY, format: "excel", masters: null, sis, exams }), "exam reports"));

  if (failures) {
    console.log(`\n${failures} FAILED`);
    process.exit(1);
  }
  console.log("OK — academicsMastersAsData.selftest.ts");
}

void main();
