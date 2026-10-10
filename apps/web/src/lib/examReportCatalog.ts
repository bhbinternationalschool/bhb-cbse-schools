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
      result: r.error ? "No marks" : r.passed ? "PASS" : "FAIL",
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
  const rows = buildResultRows(masters, sis, ay, term, filters).filter((r) => r.card);

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
    const ranked = [...list]
      .sort((a, b) => (b.card!.percent ?? 0) - (a.card!.percent ?? 0))
      .slice(0, topN);
    ranked.forEach((r, i) => {
      out.push({
        rank: i + 1,
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
    rows.push({
      className: classLabel(masters, classId),
      section: sectionLabel(masters, sectionId),
      total: s.total,
      withMarks: s.withMarks,
      passed: s.passed,
      failed: s.failed,
      passPercent: s.withMarks ? `${((s.passed / s.withMarks) * 100).toFixed(1)}%` : "",
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

  let built: { columns: ReportColumn[]; rows: Record<string, string | number>[] };
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
      filterNote: note,
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

