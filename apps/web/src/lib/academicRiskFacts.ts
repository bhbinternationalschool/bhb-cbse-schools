/**
 * Assemble `StudentRiskFacts` for every student in a section from the
 * browser-side stores — current term report card, the previous term with
 * marks, attendance (from the card), homework and the conduct log. Client
 * only. Absent sources yield null so the rules stay silent on them.
 */

import { classLabel as classLabelOf } from "@/lib/homework";
import { listIncidentsForStudent, loadDiscipline } from "@/lib/discipline";
import { buildReportCard, listExamTerms, loadExams, type ExamTerm, type ReportCard } from "@/lib/exams";
import { loadHomework, submissionForStudent } from "@/lib/homework";
import type { MastersState } from "@/lib/masters";
import type { SisStudent } from "@/lib/sis";
import type { StudentRiskFacts } from "@/lib/academicRisk";

function cardFor(st: SisStudent, classLabel: string, termId: string, ay: string): ReportCard | null {
  const b = buildReportCard({ student: st, classLabel, examTermId: termId, academicYearCode: ay });
  if ("error" in b) return null;
  if (!(b.totalMax > 0 && b.lines.some((l) => l.marksObtained != null))) return null;
  return b;
}

/**
 * Facts for `roster` at `term`. The previous term is the nearest earlier
 * active term in which the student has marks (per student — a child who
 * missed PT2 is compared with PT1).
 */
export function buildSectionRiskFacts(input: {
  masters: MastersState;
  roster: SisStudent[];
  term: ExamTerm;
  academicYearCode: string;
}): { facts: StudentRiskFacts[]; previousTermLabels: string[] } {
  const ay = input.academicYearCode;
  const exams = loadExams();
  const terms = listExamTerms(ay, exams);
  const earlier = terms.filter((t) => t.sortOrder < input.term.sortOrder).reverse();
  const hw = loadHomework();
  const disc = loadDiscipline();
  const discUsed = disc.incidents.length > 0;
  const now = new Date().toISOString();
  const prevLabels = new Set<string>();

  const facts: StudentRiskFacts[] = [];
  for (const st of input.roster) {
    const classLabel = classLabelOf(input.masters, st.classId, st.sectionId);
    const cur = cardFor(st, classLabel, input.term.id, ay);
    let prev: ReportCard | null = null;
    for (const t of earlier) {
      prev = cardFor(st, classLabel, t.id, ay);
      if (prev) break;
    }
    if (prev) prevLabels.add(prev.examTerm.label);

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
    const incidents = listIncidentsForStudent(disc, st.id).filter((i) => i.academicYearCode === ay);

    facts.push({
      studentId: st.id,
      fullName: st.fullName,
      examLabel: input.term.label,
      percent: cur ? cur.percent : null,
      overallGrade: cur ? cur.overallGrade : "",
      previousExamLabel: prev ? prev.examTerm.label : "",
      previousPercent: prev ? prev.percent : null,
      previousGrade: prev ? prev.overallGrade : "",
      subjects: (cur?.lines ?? []).map((l) => ({
        subjectName: l.subjectName,
        grade: l.marksObtained == null ? "" : l.grade,
        previousGrade: (() => {
          const pl = prev?.lines.find((x) => x.subjectId === l.subjectId);
          return pl && pl.marksObtained != null ? pl.grade : "";
        })(),
      })),
      attendancePercent: cur?.attendance ? cur.attendance.percent : null,
      incidents: discUsed ? incidents.length : null,
      escalations: incidents.filter(
        (i) => i.escalationLevel === "parent_meeting" || i.escalationLevel === "suspension_recommendation",
      ).length,
      homework: sectionHasHomework
        ? {
            assigned: due.length,
            submitted: due.filter((p) => !!submissionForStudent(hw, p.id, st.id)).length,
          }
        : null,
    });
  }
  return { facts, previousTermLabels: [...prevLabels] };
}
