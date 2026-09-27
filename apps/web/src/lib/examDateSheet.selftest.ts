/**
 * Self-test: the date sheet moves a paper, and says so only when it did.
 * Run: npx tsx apps/web/src/lib/examDateSheet.selftest.ts
 *
 * TWO FAILURES THIS EXISTS FOR, reported together on 27 September 2026.
 *
 * "Changing any date of exam is only giving message but not changing
 * actual." saveExams() returned void, so a refused write — a closed
 * academic year selected in the header, or a role without `exams: edit` —
 * returned early and every caller read that as success. The date sheet
 * answered "Paper updated" over a paper that had not moved. A screen that
 * says the opposite of what the data says is worse than one that says
 * nothing.
 *
 * "Date sheet is not sliding by hand, only by tab." The grid put
 * `overflow-x-auto` OUTSIDE ErpTableShell, and the shell is `overflow-hidden`
 * — so a table wider than the shell was clipped by it and never overflowed
 * the scroll box. With nothing wider than itself to scroll, that box showed
 * no scrollbar and answered no wheel, trackpad or touch; tabbing into a cell
 * was the only way to reach a column off the right edge.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  loadExams,
  saveExamDateSheetEntry,
  writeExamsLocalRaw,
  type ExamSubject,
  type ExamTerm,
} from "@/lib/exams";

console.log("examDateSheet.selftest.ts");

const AY = "2026-27";
const TERM: ExamTerm = {
  ...(loadExams().terms[0] as ExamTerm),
  id: "term_probe",
  code: "PROBE",
  label: "Probe exam",
  academicYearCode: AY,
  // Empty means "no window", so the test is about the move, not the range.
  startsOn: "",
  endsOn: "",
};
const SUBJECT: ExamSubject = {
  id: "sub_probe",
  code: "PRB",
  name: "Probe subject",
  classIds: [],
  maxMarks: 100,
  sortOrder: 1,
  isActive: true,
};

/* ── a changed date actually changes the date ────────────────────────── */
{
  writeExamsLocalRaw({
    ...loadExams(),
    terms: [TERM],
    subjects: [SUBJECT],
    dateSheet: [],
  });

  const added = saveExamDateSheetEntry({
    academicYearCode: AY,
    examTermId: TERM.id,
    classId: "cls_probe",
    subjectId: SUBJECT.id,
    date: "2026-11-10",
    startTime: "09:00",
    durationMinutes: 120,
  });
  assert.ok(added.ok, `the paper was added: ${added.ok ? "" : added.error}`);
  if (!added.ok) throw new Error("unreachable");
  const entryId = added.entry.id;

  const moved = saveExamDateSheetEntry({
    id: entryId,
    academicYearCode: AY,
    examTermId: TERM.id,
    classId: "cls_probe",
    subjectId: SUBJECT.id,
    date: "2026-11-14",
    startTime: "09:00",
    durationMinutes: 120,
  });
  assert.ok(moved.ok, `the paper moved: ${moved.ok ? "" : moved.error}`);

  const sheet = loadExams().dateSheet;
  // One paper, not two: an update that appended instead of replacing would
  // leave the paper showing on BOTH days, which reads as "it did not move".
  assert.equal(sheet.length, 1, "the paper was moved, not duplicated");
  assert.equal(sheet[0].id, entryId, "and it kept its identity");
  assert.equal(sheet[0].date, "2026-11-14", "the stored date is the new one");
}

/* ── the save reports what it did, not what it was asked ─────────────── */
{
  const src = readFileSync(
    join(
      process.cwd(),
      process.cwd().endsWith("apps/web") ? "src/lib" : "apps/web/src/lib",
      "exams.ts",
    ),
    "utf8",
  );

  assert.match(
    src,
    /export function saveExams\(state: ExamsState\): \{ ok: boolean; error\?: string \}/,
    "saveExams reports whether it stored — returning void is what let a " +
      "refused write be announced as a successful one",
  );
  // Every early return must carry that answer, not fall off the end.
  assert.doesNotMatch(
    src,
    /if \(!assertModulePermission\("exams", "edit", "saveExams"\)\) return;/,
    "the permission refusal returns a reason, not a bare early return",
  );
  assert.match(
    src,
    /const saved = saveExams\(\{[\s\S]*?if \(!saved\.ok\) return \{ ok: false/,
    "saveExamDateSheetEntry checks the write before reporting success",
  );
  assert.match(
    src,
    /export function deleteExamDateSheetEntry[\s\S]*?if \(!saved\.ok\) return \{ ok: false/,
    "and so does the delete",
  );
}

/* ── the grid can be scrolled by hand, not only by Tab ───────────────── */
{
  const grid = readFileSync(
    join(
      process.cwd(),
      process.cwd().endsWith("apps/web")
        ? "src/components/exams"
        : "apps/web/src/components/exams",
      "ExamDateSheetGrid.tsx",
    ),
    "utf8",
  );

  // The className itself, not the word: the comment above it says
  // "overflow-x-auto" too, and matching that proves nothing.
  const shellAt = grid.indexOf("<ErpTableShell>");
  const scrollAt = grid.indexOf('<div className="overflow-x-auto');
  const tableAt = grid.indexOf("<ErpTable ");
  assert.ok(shellAt >= 0 && scrollAt >= 0 && tableAt >= 0, "the grid is shaped as expected");
  assert.ok(
    shellAt < scrollAt && scrollAt < tableAt,
    "the scroll box is INSIDE ErpTableShell and wraps the table — outside it, " +
      "the shell's overflow-hidden clips the table and nothing can scroll",
  );
}

console.log("  ok");
