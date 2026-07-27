/**
 * Date-specific exam overlays for the weekly timetable.
 *
 * The weekly grid remains the reusable teaching template. On an exam date,
 * overlapping teaching periods are masked by these blocks instead of deleting
 * the normal weekly lesson (which is still needed on later weeks).
 */

import {
  listExamDateSheet,
  loadExams,
  type ExamDateSheetEntry,
} from "@/lib/exams";
import { loadTimetable, type BellPeriod } from "@/lib/timetable";

export type ExamTimetableBlock = {
  entry: ExamDateSheetEntry;
  termLabel: string;
  subjectLabel: string;
  endTime: string;
  periodNos: number[];
};

export function isoDateWeekday(date: string): number | null {
  if (!/^\d{4}-\d{2}-\d{2}$/.test(date)) return null;
  const parsed = new Date(`${date}T12:00:00`);
  return Number.isNaN(parsed.getTime()) ? null : parsed.getDay();
}

function toMinutes(value: string): number {
  const [hours, minutes] = value.split(":").map(Number);
  return (hours || 0) * 60 + (minutes || 0);
}

function fromMinutes(value: number): string {
  const clamped = Math.max(0, Math.min(24 * 60 - 1, value));
  return `${String(Math.floor(clamped / 60)).padStart(2, "0")}:${String(
    clamped % 60,
  ).padStart(2, "0")}`;
}

export function examEntryEndTime(entry: ExamDateSheetEntry): string {
  return fromMinutes(toMinutes(entry.startTime) + entry.durationMinutes);
}

export function examOverlapsBellPeriod(
  entry: ExamDateSheetEntry,
  period: Pick<BellPeriod, "startTime" | "endTime">,
): boolean {
  const examStart = toMinutes(entry.startTime);
  const examEnd = examStart + entry.durationMinutes;
  const periodStart = toMinutes(period.startTime);
  const periodEnd = toMinutes(period.endTime);
  return examStart < periodEnd && periodStart < examEnd;
}

export function examBlocksForClassDate(input: {
  academicYearCode: string;
  classId: string;
  date: string;
  bellTemplate?: BellPeriod[];
}): ExamTimetableBlock[] {
  if (!input.classId || isoDateWeekday(input.date) == null) return [];
  const exams = loadExams();
  const bell = input.bellTemplate ?? loadTimetable().bellTemplate;
  return listExamDateSheet(
    input.academicYearCode,
    undefined,
    exams,
  )
    .filter((entry) => entry.classId === input.classId && entry.date === input.date)
    .map((entry) => {
      const term = exams.terms.find((row) => row.id === entry.examTermId);
      const subject = exams.subjects.find((row) => row.id === entry.subjectId);
      return {
        entry,
        termLabel: term ? `${term.code} · ${term.label}` : "Exam",
        subjectLabel: subject?.name || subject?.code || "Exam",
        endTime: examEntryEndTime(entry),
        periodNos: bell
          .filter(
            (period) =>
              period.kind === "teaching" &&
              examOverlapsBellPeriod(entry, period),
          )
          .map((period) => period.no),
      };
    });
}

export function examBlockAt(
  blocks: ExamTimetableBlock[],
  periodNo: number,
): ExamTimetableBlock | undefined {
  return blocks.find((block) => block.periodNos.includes(periodNo));
}

