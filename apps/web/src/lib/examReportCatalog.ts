/**
 * Exam reports — result analysis, toppers, CBSE-style result summary.
 * Exams had a rich result engine (buildClassResultSheet, report cards,
 * promotion suggestions) but nothing exportable came out of it beyond a
 * single class's printed report cards — no cross-class rollup, no ranked
 * topper list, no pass/fail summary an office could hand to an inspector.
 */

import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { rosterForSection } from "@/lib/attendance";
import {
  buildClassResultSheet,
  listAllExamTerms,
  loadExams,
  type ClassResultRow,
  type ExamTerm,
  type ExamsState,
} from "@/lib/exams";
import {
  describeFilters,
  exportFilterReport,
  type ReportColumn,
} from "@/lib/reportExport";
import { TENANT } from "@/lib/types";

export type ExamReportFormat = "excel" | "pdf";

export type ExamReportId = "result_analysis" | "toppers" | "result_summary";

export type ExamReportCategory = "results";

export type ExamReportDef = {
  id: ExamReportId;
  category: ExamReportCategory;
  label: string;
  hint?: string;
};

export const EXAM_REPORT_CATEGORIES: {
  id: ExamReportCategory;
  title: string;
  headerClass: string;
}[] = [{ id: "results", title: "Results", headerClass: "bg-[#7c3aed]" }];

export const EXAM_REPORTS: ExamReportDef[] = [
  {
    id: "result_analysis",
    category: "results",
    label: "Result analysis",
    hint: "Every student's marks, grade, pass/fail — by class",
  },
  {
    id: "toppers",
    category: "results",
    label: "Toppers",
    hint: "Ranked by percentage, across the selected scope",
  },
  {
    id: "result_summary",
    category: "results",
    label: "CBSE-style result summary",
    hint: "Pass/fail/promoted counts per class",
  },
];

export type ExamReportFilters = {
  examTermId: string;
  classId?: string;
  sectionId?: string;
  academicYearCode?: string;
  /** toppers only — how many to list per class (default 10) */
  topN?: number;
  format: ExamReportFormat;
  masters?: MastersState;
  sis?: SisState;
  exams?: ExamsState;
};

function classLabel(masters: MastersState, classId: string): string {
  return masters.classes.find((c) => c.id === classId)?.name ?? classId;
}

function sectionLabel(masters: MastersState, sectionId: string): string {
  return masters.sections.find((s) => s.id === sectionId)?.name ?? sectionId;
}

/** Every (classId, sectionId) pair in scope for these filters. */
function scopeSections(
  masters: MastersState,
  filters: Pick<ExamReportFilters, "classId" | "sectionId">,
): { classId: string; sectionId: string }[] {
  return masters.sections
    .filter((s) => {
      if (filters.sectionId) return s.id === filters.sectionId;
      if (filters.classId) return s.classId === filters.classId;
      return true;
    })
    .map((s) => ({ classId: s.classId, sectionId: s.id }));
}

type ResultRowWithScope = ClassResultRow & { classId: string; sectionId: string };

/**
 * Subjects whose marks count toward the card's total. An absent paper (AB)
 * and a subject with no marks entered are left out of BOTH marks and
 * maximum, so a child who sat 2 of 5 papers had a percentage over those 2.
 */
export function subjectsCounted(card: { lines: { marksObtained: number | null; absent: boolean }[] }): {
  counted: number;
  total: number;
} {
  return {
    counted: card.lines.filter((l) => l.marksObtained != null && !l.absent).length,
    total: card.lines.length,
  };
}

/** Result word: an absent child did not fail, and a child with no marks has no result. */
export function resultWord(r: Pick<ClassResultRow, "error" | "card" | "passed">): string {
  if (r.error || !r.card) return "No marks";
  if (r.card.absent) return "Absent";
  return r.passed ? "PASS" : "FAIL";
}

/**
 * Standard competition ranking: equal percentages share a rank and the next
 * rank skips (1, 1, 3) — as the report card ranks. The list used i + 1, so
 * two children on 92.5% were "1st" and "2nd".
 */
export function competitionRanks<T>(sorted: T[], score: (t: T) => number): number[] {
  const ranks: number[] = [];
  sorted.forEach((t, i) => {
    ranks.push(i > 0 && score(sorted[i - 1]!) === score(t) ? ranks[i - 1]! : i + 1);
  });
  return ranks;
}

function buildResultRows(
  masters: MastersState,
  sis: SisState,
  ay: string,
  term: ExamTerm,
  filters: Pick<ExamReportFilters, "classId" | "sectionId">,
): ResultRowWithScope[] {
  const students = sis.students;
  const out: ResultRowWithScope[] = [];
  for (const { classId, sectionId } of scopeSections(masters, filters)) {
    const roster = rosterForSection(students, sectionId, { classId, academicYearCode: ay });
    if (!roster.length) continue;
    const sheet = buildClassResultSheet({
      students: roster,
      classLabel: classLabel(masters, classId),
      classId,
      sectionId,
      examTermId: term.id,
      academicYearCode: ay,
    });
    if ("error" in sheet) continue;
    for (const row of sheet.rows) {
      out.push({ ...row, classId, sectionId });
    }
  }
  return out;
}

function runResultAnalysis(
  masters: MastersState,
  sis: SisState,
  ay: string,
  term: ExamTerm,
  filters: Pick<ExamReportFilters, "classId" | "sectionId">,
) {
  const rows = buildResultRows(masters, sis, ay, term, filters);
  return {
    columns: [
      { key: "admissionNo", header: "Adm no", width: 1 },
      { key: "name", header: "Student", width: 1.4 },
      { key: "className", header: "Class", width: 0.6 },
      { key: "section", header: "Sec", width: 0.5 },
      { key: "obtained", header: "Marks", width: 0.7, align: "right" as const },
      { key: "max", header: "Max", width: 0.7, align: "right" as const },
      { key: "percent", header: "%", width: 0.6, align: "right" as const },
      { key: "grade", header: "Grade", width: 0.6 },
      { key: "subjects", header: "Subjects counted", width: 0.8, align: "right" as const },
      { key: "result", header: "Result", width: 0.7 },
      { key: "failedSubjects", header: "Failed in", width: 1.4 },
    ],
    rows: rows.map((r) => ({
      admissionNo: r.student.admissionNo,
      name: r.student.fullName,
      className: classLabel(masters, r.classId),
      section: sectionLabel(masters, r.sectionId),
      obtained: r.card?.totalObtained ?? "",
      max: r.card?.totalMax ?? "",
      percent: r.card ? `${r.card.percent.toFixed(1)}%` : "",
      grade: r.card?.overallGrade ?? "",
      subjects: r.card ? `${subjectsCounted(r.card).counted}/${subjectsCounted(r.card).total}` : "",
      result: resultWord(r),
      failedSubjects: r.failedSubjects.join(", "),
    })),
  };
}

function runToppers(
  masters: MastersState,
  sis: SisState,
  ay: string,
  term: ExamTerm,
  filters: Pick<ExamReportFilters, "classId" | "sectionId" | "topN">,
) {
  const topN = Math.max(1, filters.topN ?? 10);
  const withCards = buildResultRows(masters, sis, ay, term, filters).filter((r) => r.card && !r.card.absent);
  // Only children with every subject counted are ranked: a percentage over
  // the papers a child happened to sit is not comparable.
  const rows = withCards.filter((r) => {
    const c = subjectsCounted(r.card!);
    return c.total > 0 && c.counted === c.total;
  });
  const leftOut = withCards.length - rows.length;

  // Rank within each class so "toppers" means "top of class", not just
  // whichever class happens to have easier papers dominating a school-wide
  // list.
  const byClass = new Map<string, ResultRowWithScope[]>();
  for (const r of rows) {
    const key = r.classId;
    const list = byClass.get(key) ?? [];
    list.push(r);
    byClass.set(key, list);
  }

  const out: Record<string, string | number>[] = [];
  for (const [classId, list] of byClass) {
    const sorted = [...list].sort((a, b) => (b.card!.percent ?? 0) - (a.card!.percent ?? 0));
    const ranks = competitionRanks(sorted, (r) => r.card!.percent ?? 0);
    // Top N by rank: a tie on the last place keeps every child on it.
    sorted.forEach((r, i) => {
      if (ranks[i]! > topN) return;
      out.push({
        rank: ranks[i]!,
        className: classLabel(masters, classId),
        admissionNo: r.student.admissionNo,
        name: r.student.fullName,
        section: sectionLabel(masters, r.sectionId),
        obtained: r.card!.totalObtained,
        max: r.card!.totalMax,
        percent: `${r.card!.percent.toFixed(1)}%`,
        grade: r.card!.overallGrade,
      });
    });
  }

  return {
    columns: [
      { key: "className", header: "Class", width: 0.7 },
      { key: "rank", header: "Rank", width: 0.5, align: "right" as const },
      { key: "admissionNo", header: "Adm no", width: 1 },
      { key: "name", header: "Student", width: 1.4 },
      { key: "section", header: "Sec", width: 0.5 },
      { key: "obtained", header: "Marks", width: 0.7, align: "right" as const },
      { key: "max", header: "Max", width: 0.7, align: "right" as const },
      { key: "percent", header: "%", width: 0.6, align: "right" as const },
      { key: "grade", header: "Grade", width: 0.6 },
    ],
    rows: out,
    leftOut,
  };
}

function runResultSummary(
  masters: MastersState,
  sis: SisState,
  ay: string,
  term: ExamTerm,
  filters: Pick<ExamReportFilters, "classId" | "sectionId">,
) {
  const rows: Record<string, string | number>[] = [];
  for (const { classId, sectionId } of scopeSections(masters, filters)) {
    const roster = rosterForSection(sis.students, sectionId, { classId, academicYearCode: ay });
    if (!roster.length) continue;
    const sheet = buildClassResultSheet({
      students: roster,
      classLabel: classLabel(masters, classId),
      classId,
      sectionId,
      examTermId: term.id,
      academicYearCode: ay,
    });
    if ("error" in sheet) continue;
    const s = sheet.summary;
    // Absent is its own count: the sheet's summary called an absent child
    // "appeared" and "failed", which lowered the pass %.
    const absent = sheet.rows.filter((r) => r.card?.absent).length;
    const appeared = sheet.rows.filter((r) => r.card && !r.card.absent).length;
    const passed = sheet.rows.filter((r) => r.card && !r.card.absent && r.passed).length;
    rows.push({
      className: classLabel(masters, classId),
      section: sectionLabel(masters, sectionId),
      total: s.total,
      withMarks: appeared,
      absent,
      passed,
      failed: appeared - passed,
      passPercent: appeared ? `${((passed / appeared) * 100).toFixed(1)}%` : "—",
      promoted: s.promoted,
      detained: s.detained,
      conditional: s.conditional,
      pending: s.pending,
    });
  }
  return {
    columns: [
      { key: "className", header: "Class", width: 0.8 },
      { key: "section", header: "Sec", width: 0.6 },
      { key: "total", header: "Total", width: 0.6, align: "right" as const },
      { key: "withMarks", header: "Appeared", width: 0.8, align: "right" as const },
      { key: "absent", header: "Absent", width: 0.7, align: "right" as const },
      { key: "passed", header: "Passed", width: 0.7, align: "right" as const },
      { key: "failed", header: "Failed", width: 0.7, align: "right" as const },
      { key: "passPercent", header: "Pass %", width: 0.7, align: "right" as const },
      { key: "promoted", header: "Promoted", width: 0.8, align: "right" as const },
      { key: "detained", header: "Detained", width: 0.8, align: "right" as const },
      { key: "conditional", header: "Conditional", width: 0.9, align: "right" as const },
      { key: "pending", header: "Pending", width: 0.8, align: "right" as const },
    ],
    rows,
  };
}

export function runExamReport(
  id: ExamReportId,
  filters: ExamReportFilters,
): { ok: true; message: string } | { ok: false; error: string } {
  const masters = filters.masters ?? loadMasters();
  const sis = filters.sis ?? loadSis();
  const exams = filters.exams ?? loadExams();
  const ay = filters.academicYearCode || DEFAULT_AY;
  const term = listAllExamTerms(ay, exams).find((t) => t.id === filters.examTermId);
  if (!term) return { ok: false, error: "Pick an exam term first" };

  const def = EXAM_REPORTS.find((r) => r.id === id);
  const title = def?.label ?? id;
  const note = describeFilters([
    `Term ${term.label}`,
    filters.classId ? `Class ${classLabel(masters, filters.classId)}` : "All classes",
    filters.sectionId ? `Sec ${sectionLabel(masters, filters.sectionId)}` : "",
  ]);

  let built: { columns: ReportColumn[]; rows: Record<string, string | number>[]; leftOut?: number };
  switch (id) {
    case "result_analysis":
      built = runResultAnalysis(masters, sis, ay, term, filters);
      break;
    case "toppers":
      built = runToppers(masters, sis, ay, term, filters);
      break;
    case "result_summary":
      built = runResultSummary(masters, sis, ay, term, filters);
      break;
    default:
      return { ok: false, error: "Unknown report" };
  }

  if (!built.rows.length) {
    return { ok: false, error: "No results found for this scope — check marks are entered" };
  }

  const result = exportFilterReport(
    {
      title,
      subtitle: `${TENANT.shortName} · Exams`,
      filterNote: built.leftOut
        ? `${note} · ${built.leftOut} child(ren) not ranked: absent or no marks in a subject`
        : note,
      columns: built.columns,
      rows: built.rows,
      fileBaseName: `exams_${id}`,
    },
    filters.format,
  );
  if (!result.ok) return result;
  return {
    ok: true,
    message: `${title} · ${filters.format.toUpperCase()} · ${built.rows.length} row(s)`,
  };
}

