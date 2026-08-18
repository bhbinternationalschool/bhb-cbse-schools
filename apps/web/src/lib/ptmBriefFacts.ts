/**
 * Assemble `PtmBriefFacts` for one student from the browser-side stores
 * (exams, attendance via report cards, homework, discipline, PTM). Client
 * only — reads localStorage-backed state through each module's loader.
 *
 * Every source that has no data for this student yields `null` / `[]`, so
 * the prompt can say "not available" instead of a number that isn't true.
 */

import { classLabel as classLabelOf } from "@/lib/homework";
import {
  disciplineCategoryLabel,
  escalationLevelLabel,
  listIncidentsForStudent,
  loadDiscipline,
} from "@/lib/discipline";
import { buildReportCard, listExamTerms, loadExams, type ReportCard } from "@/lib/exams";
import { loadHomework, submissionForStudent } from "@/lib/homework";
import type { MastersState } from "@/lib/masters";
import type { PtmState } from "@/lib/ptm";
import type { PtmBriefFacts, PtmBriefTermFact } from "@/lib/ptmBriefAi";
import type { SisState } from "@/lib/sis";

function firstNameOf(fullName: string): string {
  return fullName.trim().split(/\s+/)[0] || "Student";
}

export function buildPtmBriefFacts(input: {
  sis: SisState;
  masters: MastersState;
  ptm: PtmState;
  studentId: string;
  /** The booking this brief is for — its own feedback (if any) is not "prior" */
  excludeBookingId?: string;
  academicYearCode: string;
  teacherNote?: string;
}): PtmBriefFacts | null {
  const st = input.sis.students.find((s) => s.id === input.studentId);
  if (!st) return null;
  const ay = input.academicYearCode;
  const classLabel = classLabelOf(input.masters, st.classId, st.sectionId);

  // ── Exams: last two terms that actually have marks for this student ──
  const exams = loadExams();
  const cards: ReportCard[] = [];
  for (const term of listExamTerms(ay, exams)) {
    const b = buildReportCard({ student: st, classLabel, examTermId: term.id, academicYearCode: ay });
    if ("error" in b) continue;
    if (b.totalMax > 0 && b.lines.some((l) => l.marksObtained != null)) cards.push(b);
  }
  const lastTwo = cards.slice(-2);
  const terms: PtmBriefTermFact[] = lastTwo.map((c) => ({
    label: c.examTerm.label,
    percent: c.percent,
    overallGrade: c.overallGrade,
    subjects: c.lines.map((l) => ({
      subjectName: l.subjectName,
      marksObtained: l.marksObtained,
      maxMarks: l.maxMarks,
      grade: l.grade,
    })),
  }));
  const latest = lastTwo[lastTwo.length - 1];
  const attendancePercent = latest?.attendance ? latest.attendance.percent : null;

  // ── Homework: posts that required a submission and are already due ──
  const hw = loadHomework();
  const now = new Date().toISOString();
  const due = hw.posts.filter(
    (p) =>
      p.status === "published" &&
      p.academicYearCode === ay &&
      p.sectionId === st.sectionId &&
      p.requiresSubmit &&
      p.dueAt &&
      p.dueAt <= now,
  );
  const sectionHasHomework = hw.posts.some(
    (p) => p.status === "published" && p.academicYearCode === ay && p.sectionId === st.sectionId,
  );
  const homework = sectionHasHomework
    ? {
        assigned: due.length,
        submitted: due.filter((p) => !!submissionForStudent(hw, p.id, st.id)).length,
      }
    : null;

  // ── Conduct log ──
  const disc = loadDiscipline();
  const incidents = listIncidentsForStudent(disc, st.id).filter((i) => i.academicYearCode === ay);
  const discipline =
    disc.incidents.length === 0
      ? null // module never used → not available, not "clean"
      : {
          incidents: incidents.length,
          meritPoints: incidents.filter((i) => i.pointsDelta > 0).reduce((s, i) => s + i.pointsDelta, 0),
          demeritPoints: -incidents.filter((i) => i.pointsDelta < 0).reduce((s, i) => s + i.pointsDelta, 0),
          recent: incidents.slice(0, 3).map((i) => ({
            date: i.date,
            categoryLabel: disciplineCategoryLabel(i.category),
            escalationLabel: escalationLevelLabel(i.escalationLevel),
          })),
        };

  // ── Earlier PTM notes ──
  const priorFeedback = input.ptm.feedback
    .filter((f) => f.studentId === st.id && f.bookingId !== input.excludeBookingId)
    .sort((a, b) => b.createdAt.localeCompare(a.createdAt))
    .slice(0, 3)
    .map((f) => ({
      date: f.createdAt.slice(0, 10),
      strengths: f.strengths,
      areas: f.areas,
      followUp: f.followUp,
    }));

  return {
    studentId: st.id,
    firstName: firstNameOf(st.fullName),
    classLabel,
    terms,
    attendancePercent,
    homework,
    discipline,
    priorFeedback,
    teacherNote: input.teacherNote ?? "",
  };
}
