/**
 * A released report card, as a parent may see it.
 *
 * The school's printed card (components/exams/ReportCardSheet) is the rule
 * for what a family sees: a number, a total, a percentage, a rank or a
 * remark reaches the parent ONLY when that card would print it for this
 * class. The office's ReportCard object carries more than it prints (the
 * subject remarks a template hides, who corrected the attendance, the fee
 * hold message, the curriculum note); none of that leaves the server.
 *
 * Pure — no I/O — so the selftest pins every rule.
 */

import type { ReportCard } from "@/lib/exams";

export type ParentSubjectResult = {
  subjectId: string;
  name: string;
  /** null when the card shows grades only (no numbers). */
  maxMarks: number | null;
  obtained: number | null;
  grade: string;
  gradeLabel: string;
  absent: boolean;
  /** "" unless the card prints subject remarks. */
  remark: string;
  /** Marks parts (Written 71/80, Oral 18/20) when the card shows them. */
  parts: { code: string; label: string; maxMarks: number; obtained: number | null }[];
  /** Graded parts (Handwriting: A) — never in any total. */
  gradedParts: { label: string; grade: string | null }[];
};

export type ParentReportCardView = {
  title: string;
  termLabel: string;
  academicYearCode: string;
  /** "hy" / "final": a weighted aggregate of the exams that count toward it. */
  aggregateMode: "none" | "hy" | "final";
  /** The card shows no numbers — grades (or descriptors) only. */
  gradesOnly: boolean;
  /** The grade column is a descriptor ("Meets expectations"). */
  descriptors: boolean;
  subjects: ParentSubjectResult[];
  /** Present only when the card prints totals. */
  totals: { obtained: number; max: number } | null;
  percent: number | null;
  overallGrade: string | null;
  rank: number | null;
  classSize: number | null;
  classAverage: number | null;
  result: string | null;
  attendance: { presentDays: number; workingDays: number; percent: number } | null;
  coScholastic: { label: string; rating: string | null; ratingLabel: string }[];
  /** The class teacher's remark, when the card prints remarks. */
  remark: { text: string; textHi: string } | null;
  absent: { reason: string } | null;
  absentSubjects: string[];
};

/** The SisStudent fields the printed sheet reads — nothing else leaves. */
export type ParentPrintStudent = {
  id: string;
  fullName: string;
  rollNo: string;
  admissionNo: string;
  dob: string;
  fatherName: string;
  motherName: string;
  heightCm: string;
  weightKg: string;
  bloodGroup: string;
  photoUrl: string;
};

/** ReportCard minus the student record, with what the card hides removed. */
export type ParentPrintableCard = Omit<ReportCard, "student"> & { student: ParentPrintStudent };

export function gradesOnlyCard(card: Pick<ReportCard, "presentation" | "displayMode">): boolean {
  return card.presentation.layout === "hpc" || card.displayMode !== "marks_grade";
}

export function toParentReportCardView(card: ReportCard): ParentReportCardView {
  const p = card.presentation;
  const gradesOnly = gradesOnlyCard(card);
  const descriptors = p.layout === "hpc" || card.displayMode === "descriptors";
  const showTotals = !gradesOnly && card.totalMax > 0;
  const showParts = p.showComponents && !gradesOnly;
  return {
    title: p.title,
    termLabel: card.examTerm.label,
    academicYearCode: card.academicYearCode,
    aggregateMode: card.aggregateMode,
    gradesOnly,
    descriptors,
    subjects: card.lines.map((l) => ({
      subjectId: l.subjectId,
      name: l.subjectName,
      maxMarks: gradesOnly ? null : l.maxMarks,
      obtained: gradesOnly || l.absent ? null : l.marksObtained,
      grade: l.absent ? "AB" : l.grade,
      gradeLabel: l.absent ? "" : l.gradeLabel,
      absent: l.absent,
      remark: p.showSubjectRemarks ? l.remark.trim() : "",
      parts: showParts
        ? l.parts.map((x) => ({ code: x.code, label: x.label, maxMarks: x.maxMarks, obtained: x.marksObtained }))
        : [],
      gradedParts: (l.gradedParts ?? []).map((g) => ({ label: g.label, grade: g.grade })),
    })),
    totals: showTotals ? { obtained: card.totalObtained, max: card.totalMax } : null,
    percent: showTotals && p.showPercent ? card.percent : null,
    overallGrade:
      showTotals && p.showOverallGrade && card.overallGrade && card.overallGrade !== "—"
        ? card.overallGrade
        : null,
    // buildClassResultSheet fills these only when the template prints them.
    rank: p.showRank ? card.rank : null,
    classSize: p.showRank ? card.classSize : null,
    classAverage: p.showClassAverage ? card.classAverage : null,
    result: card.result,
    attendance:
      p.showAttendance && card.attendance
        ? {
            presentDays: card.attendance.presentDays,
            workingDays: card.attendance.workingDays,
            percent: card.attendance.percent,
          }
        : null,
    coScholastic: p.showCoScholastic
      ? card.coScholastic.map((c) => ({ label: c.domainLabel, rating: c.rating, ratingLabel: c.ratingLabel }))
      : [],
    remark:
      p.showRemarks && card.overallRemark
        ? { text: card.overallRemark.text, textHi: card.overallRemark.textHi }
        : null,
    absent: card.absent,
    absentSubjects: card.absentSubjects,
  };
}

/**
 * The card for the parent's print / PDF view: what ReportCardSheet needs,
 * with everything the template hides blanked so it is not in the response.
 */
export function toParentPrintableCard(card: ReportCard): ParentPrintableCard {
  const p = card.presentation;
  const st = card.student;
  return {
    ...card,
    student: {
      id: st.id,
      fullName: st.fullName,
      rollNo: st.rollNo || "",
      admissionNo: st.admissionNo || "",
      dob: p.showDob ? st.dob || "" : "",
      fatherName: p.showParents ? st.fatherName || "" : "",
      motherName: p.showParents ? st.motherName || "" : "",
      heightCm: p.showHealth ? st.heightCm || "" : "",
      weightKg: p.showHealth ? st.weightKg || "" : "",
      bloodGroup: p.showHealth ? st.bloodGroup || "" : "",
      photoUrl: p.showPhoto ? st.photoUrl || "" : "",
    },
    lines: card.lines.map((l) => ({ ...l, remark: p.showSubjectRemarks ? l.remark : "" })),
    rank: p.showRank ? card.rank : null,
    classSize: p.showRank ? card.classSize : null,
    classAverage: p.showClassAverage ? card.classAverage : null,
    attendance:
      p.showAttendance && card.attendance
        ? {
            presentDays: card.attendance.presentDays,
            workingDays: card.attendance.workingDays,
            percent: card.attendance.percent,
          }
        : null,
    coScholastic: p.showCoScholastic ? card.coScholastic : [],
    overallRemark: p.showRemarks ? card.overallRemark : null,
    holdBlocked: false,
    holdMessage: "",
    curriculumNote: "",
  };
}

/** Why a released exam has no card for this child, in the parent's terms. */
export type ParentTermStatus = "ready" | "no_marks" | "held" | "unavailable";

export type ParentTermResult = {
  termId: string;
  termCode: string;
  termLabel: string;
  academicYearCode: string;
  releasedAt: string;
  status: ParentTermStatus;
  /** For anything but "ready": what to tell the parent. */
  message: string;
  card: ParentReportCardView | null;
  /** The school's printed card for this child, for the web print / PDF view. */
  printable: ParentPrintableCard | null;
};

export type ParentChildResults = {
  studentId: string;
  fullName: string;
  classLabel: string;
  terms: ParentTermResult[];
};

export type ParentDateSheetExam = {
  termId: string;
  termLabel: string;
  publishedAt: string;
  rows: {
    date: string;
    startTime: string;
    durationMinutes: number;
    subjectName: string;
    note: string;
  }[];
};

export type ParentChildDateSheet = {
  studentId: string;
  fullName: string;
  classLabel: string;
  exams: ParentDateSheetExam[];
};

