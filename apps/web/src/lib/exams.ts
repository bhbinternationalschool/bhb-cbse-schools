/**
 * Exams & report cards — terms, subjects, mark entry (demo localStorage).
 * Report card print is gated by HOLD_REPORT_CARD.
 */

import {
  DEFAULT_AY,
  loadMasters,
  resolveFeeGroupId,
  type MastersState,
  type SchoolClass,
  type Section,
} from "@/lib/masters";
import {
  loadSis,
  normalizeStudent,
  saveSis,
  type SisStudent,
} from "@/lib/sis";
import {
  assessmentEnrollmentSource,
  classGroupForStudent,
  curriculumChoiceMode,
  isCurriculumConfirmed,
  resolveStudentSubjects,
} from "@/lib/studentCurriculum";
import { curriculumAfterClassChange } from "@/lib/officeCurriculumWorkflow";
import { checkHold, setReportCardHoldFromStage } from "@/lib/holds";
import {
  loadAttendance,
  type AttendanceRegister,
} from "@/lib/attendance";
import type { Subject as MasterSubject } from "@/lib/foundationMasters";
import { ncfTagForSubject } from "@/lib/cbseSubjectGroups";

export type ExamTerm = {
  id: string;
  code: string;
  label: string;
  academicYearCode: string;
  maxMarks: number;
  sortOrder: number;
  isActive: boolean;
  /** Optional exam window */
  startsOn: string;
  endsOn: string;
  note: string;
  /** Include this exam’s marks in Half-yearly aggregate */
  countsTowardHy: boolean;
  /** Include this exam’s marks in Final / Annual aggregate */
  countsTowardFinal: boolean;
  /** Relative weight in HY aggregate (parts; normalised across contributors) */
  weightInHy: number;
  /** Relative weight in Final aggregate */
  weightInFinal: number;
  /** Must appear on consolidated / HY-Final marksheet views */
  requiredOnMarksheet: boolean;
  /** School requires a dedicated mark-entry sheet for this exam */
  requiresSeparateMarksheet: boolean;
};

export type ExamGradeScale = "cbse8";

/** School-wide exam / report card policy + defaults for new exams. */
export type ExamPolicy = {
  passPercent: number;
  gradeScale: ExamGradeScale;
  /** Default max marks when creating a Unit Test */
  defaultUtMaxMarks: number;
  /** Default max marks when creating Half-yearly / Annual style exams */
  defaultTermMaxMarks: number;
  showAttendanceOnReport: boolean;
  /** Require every subject marked before report card preview */
  requireAllSubjectsForReport: boolean;
  /**
   * Report cards are blocked by fee hold from this stage
   * (enforced via HOLD_REPORT_CARD in holds engine).
   */
  reportCardHoldFromStage: "S1" | "S2" | "S3" | "S4";
  includeOverallGrade: boolean;
  /** When printing HY / Annual, fold in exams flagged for that aggregate */
  includeComponentsInHyFinalReports: boolean;
  /** Block HY/Final report if a required separate marksheet is missing */
  enforceSeparateMarksheetsForAggregate: boolean;
  /** Defaults applied when creating a new exam */
  defaultCountsTowardHy: boolean;
  defaultCountsTowardFinal: boolean;
  defaultWeightInHy: number;
  defaultWeightInFinal: number;
  defaultRequiredOnMarksheet: boolean;
  defaultRequiresSeparateMarksheet: boolean;
  /** Fail promotion if any subject is below pass % */
  requireAllSubjectsPassForPromotion: boolean;
};

export type ExamSubject = {
  id: string;
  code: string;
  name: string;
  /** Empty = all classes */
  classIds: string[];
  maxMarks: number;
  sortOrder: number;
  isActive: boolean;
};

export type StudentSubjectMark = {
  studentId: string;
  subjectId: string;
  /** null = not entered / absent */
  marksObtained: number | null;
  grade: string;
  remark: string;
};

export type MarkSheet = {
  id: string;
  academicYearCode: string;
  examTermId: string;
  classId: string;
  sectionId: string;
  marks: StudentSubjectMark[];
  lockedAt: string | null;
  enteredBy: string;
  updatedAt: string;
};

export type PromotionDecision =
  | "pending"
  | "promoted"
  | "detained"
  | "conditional";

/** Class-section promotion / detain record for a result exam. */
export type PromotionRecord = {
  id: string;
  studentId: string;
  examTermId: string;
  academicYearCode: string;
  fromClassId: string;
  fromSectionId: string;
  decision: PromotionDecision;
  toClassId: string;
  toSectionId: string;
  remark: string;
  percent: number;
  overallGrade: string;
  passed: boolean;
  decidedAt: string | null;
  decidedBy: string;
  appliedToSisAt: string | null;
};

export type ExamsState = {
  version: 1;
  terms: ExamTerm[];
  subjects: ExamSubject[];
  sheets: MarkSheet[];
  policy: ExamPolicy;
  promotions: PromotionRecord[];
};

const STORAGE_KEY = "bhb_exams_v1";

function id(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}

export function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function defaultExamPolicy(): ExamPolicy {
  return {
    passPercent: 33,
    gradeScale: "cbse8",
    defaultUtMaxMarks: 40,
    defaultTermMaxMarks: 80,
    showAttendanceOnReport: true,
    requireAllSubjectsForReport: false,
    reportCardHoldFromStage: "S2",
    includeOverallGrade: true,
    includeComponentsInHyFinalReports: true,
    enforceSeparateMarksheetsForAggregate: true,
    defaultCountsTowardHy: true,
    defaultCountsTowardFinal: true,
    defaultWeightInHy: 20,
    defaultWeightInFinal: 20,
    defaultRequiredOnMarksheet: true,
    defaultRequiresSeparateMarksheet: true,
    requireAllSubjectsPassForPromotion: true,
  };
}

export function normalizeExamPolicy(
  p?: Partial<ExamPolicy> | null,
): ExamPolicy {
  const d = defaultExamPolicy();
  if (!p) return d;
  const stage = p.reportCardHoldFromStage;
  return {
    passPercent: Math.min(
      100,
      Math.max(1, Math.floor(p.passPercent ?? d.passPercent)),
    ),
    gradeScale: "cbse8",
    defaultUtMaxMarks: Math.max(
      1,
      Math.floor(p.defaultUtMaxMarks ?? d.defaultUtMaxMarks),
    ),
    defaultTermMaxMarks: Math.max(
      1,
      Math.floor(p.defaultTermMaxMarks ?? d.defaultTermMaxMarks),
    ),
    showAttendanceOnReport: p.showAttendanceOnReport !== false,
    requireAllSubjectsForReport: !!p.requireAllSubjectsForReport,
    reportCardHoldFromStage:
      stage === "S1" || stage === "S2" || stage === "S3" || stage === "S4"
        ? stage
        : d.reportCardHoldFromStage,
    includeOverallGrade: p.includeOverallGrade !== false,
    includeComponentsInHyFinalReports:
      p.includeComponentsInHyFinalReports !== false,
    enforceSeparateMarksheetsForAggregate:
      p.enforceSeparateMarksheetsForAggregate !== false,
    defaultCountsTowardHy: p.defaultCountsTowardHy !== false,
    defaultCountsTowardFinal: p.defaultCountsTowardFinal !== false,
    defaultWeightInHy: Math.max(
      0,
      Math.floor(p.defaultWeightInHy ?? d.defaultWeightInHy),
    ),
    defaultWeightInFinal: Math.max(
      0,
      Math.floor(p.defaultWeightInFinal ?? d.defaultWeightInFinal),
    ),
    defaultRequiredOnMarksheet: p.defaultRequiredOnMarksheet !== false,
    defaultRequiresSeparateMarksheet:
      p.defaultRequiresSeparateMarksheet !== false,
    requireAllSubjectsPassForPromotion:
      p.requireAllSubjectsPassForPromotion !== false,
  };
}

/** CBSE-style 8-point grade from percentage (pass line from policy). */
export function gradeFromPercent(
  pct: number,
  passPercent = 33,
): string {
  if (pct >= 91) return "A1";
  if (pct >= 81) return "A2";
  if (pct >= 71) return "B1";
  if (pct >= 61) return "B2";
  if (pct >= 51) return "C1";
  if (pct >= 41) return "C2";
  if (pct >= passPercent) return "D";
  return "E";
}

export function gradeFromMarks(
  obtained: number | null,
  maxMarks: number,
  passPercent = 33,
): string {
  if (obtained == null || maxMarks <= 0) return "—";
  const pct = (obtained / maxMarks) * 100;
  return gradeFromPercent(pct, passPercent);
}

function defaultTerms(ay = DEFAULT_AY): ExamTerm[] {
  return [
    {
      id: "term_ut1",
      code: "UT1",
      label: "Unit Test 1",
      academicYearCode: ay,
      maxMarks: 40,
      sortOrder: 1,
      isActive: true,
      startsOn: "",
      endsOn: "",
      note: "",
      countsTowardHy: true,
      countsTowardFinal: false,
      weightInHy: 20,
      weightInFinal: 0,
      requiredOnMarksheet: true,
      requiresSeparateMarksheet: true,
    },
    {
      id: "term_hy",
      code: "HY",
      label: "Half-yearly",
      academicYearCode: ay,
      maxMarks: 80,
      sortOrder: 2,
      isActive: true,
      startsOn: "",
      endsOn: "",
      note: "",
      countsTowardHy: true,
      countsTowardFinal: true,
      weightInHy: 80,
      weightInFinal: 30,
      requiredOnMarksheet: true,
      requiresSeparateMarksheet: true,
    },
    {
      id: "term_ut2",
      code: "UT2",
      label: "Unit Test 2",
      academicYearCode: ay,
      maxMarks: 40,
      sortOrder: 3,
      isActive: true,
      startsOn: "",
      endsOn: "",
      note: "",
      countsTowardHy: false,
      countsTowardFinal: true,
      weightInHy: 0,
      weightInFinal: 20,
      requiredOnMarksheet: true,
      requiresSeparateMarksheet: true,
    },
    {
      id: "term_ann",
      code: "ANNUAL",
      label: "Annual examination",
      academicYearCode: ay,
      maxMarks: 80,
      sortOrder: 4,
      isActive: true,
      startsOn: "",
      endsOn: "",
      note: "",
      countsTowardHy: false,
      countsTowardFinal: true,
      weightInHy: 0,
      weightInFinal: 50,
      requiredOnMarksheet: true,
      requiresSeparateMarksheet: true,
    },
  ];
}

function defaultSubjects(): ExamSubject[] {
  return [
    {
      id: "sub_eng",
      code: "ENG",
      name: "English",
      classIds: [],
      maxMarks: 100,
      sortOrder: 1,
      isActive: true,
    },
    {
      id: "sub_hin",
      code: "HIN",
      name: "Hindi",
      classIds: [],
      maxMarks: 100,
      sortOrder: 2,
      isActive: true,
    },
    {
      id: "sub_mat",
      code: "MAT",
      name: "Mathematics",
      classIds: [],
      maxMarks: 100,
      sortOrder: 3,
      isActive: true,
    },
    {
      id: "sub_sci",
      code: "SCI",
      name: "Science",
      classIds: [],
      maxMarks: 100,
      sortOrder: 4,
      isActive: true,
    },
    {
      id: "sub_sst",
      code: "SST",
      name: "Social Science",
      classIds: [],
      maxMarks: 100,
      sortOrder: 5,
      isActive: true,
    },
    {
      id: "sub_evs",
      code: "EVS",
      name: "EVS",
      classIds: [],
      maxMarks: 100,
      sortOrder: 6,
      isActive: true,
    },
    {
      id: "sub_cs",
      code: "CS",
      name: "Computer",
      classIds: [],
      maxMarks: 100,
      sortOrder: 7,
      isActive: true,
    },
  ];
}

function emptyState(): ExamsState {
  return {
    version: 1,
    terms: defaultTerms(),
    subjects: defaultSubjects(),
    sheets: [],
    policy: defaultExamPolicy(),
    promotions: [],
  };
}

/** Migrate legacy Periodic Test (PT) codes → Unit Test (UT). */
export function isUnitTestCode(code: string): boolean {
  return /^UT\d*$/i.test(code.trim()) || /^UT[-_]/i.test(code.trim());
}

function isHyCode(code: string): boolean {
  return code.trim().toUpperCase() === "HY";
}

function isFinalCode(code: string): boolean {
  const c = code.trim().toUpperCase();
  return c === "ANNUAL" || c === "FINAL";
}

function migratePtToUt(term: ExamTerm): ExamTerm {
  if (term.code === "PT1") {
    return {
      ...term,
      code: "UT1",
      label:
        term.label.toLowerCase().includes("periodic") || term.label === "PT1"
          ? "Unit Test 1"
          : term.label.replace(/Periodic Test/gi, "Unit Test"),
    };
  }
  if (term.code === "PT2") {
    return {
      ...term,
      code: "UT2",
      label:
        term.label.toLowerCase().includes("periodic") || term.label === "PT2"
          ? "Unit Test 2"
          : term.label.replace(/Periodic Test/gi, "Unit Test"),
    };
  }
  if (/periodic test/i.test(term.label)) {
    return {
      ...term,
      label: term.label.replace(/Periodic Test/gi, "Unit Test"),
      code: term.code.replace(/^PT/i, "UT"),
    };
  }
  return term;
}

function normalizeTerm(t: Partial<ExamTerm>): ExamTerm {
  const code = (t.code ?? "").trim().toUpperCase() || "EXAM";
  const isUt = isUnitTestCode(code);
  const isHy = isHyCode(code);
  const isAnnual = isFinalCode(code);
  return migratePtToUt({
    id: t.id ?? id("term"),
    code,
    label: t.label ?? t.code ?? "Exam",
    academicYearCode: t.academicYearCode ?? DEFAULT_AY,
    maxMarks: Math.max(1, Math.floor(t.maxMarks ?? 100)),
    sortOrder: t.sortOrder ?? 0,
    isActive: t.isActive !== false,
    startsOn: t.startsOn ?? "",
    endsOn: t.endsOn ?? "",
    note: t.note ?? "",
    countsTowardHy:
      t.countsTowardHy ?? (isUt || isHy ? true : false),
    countsTowardFinal:
      t.countsTowardFinal ?? (isUt || isHy || isAnnual ? true : false),
    weightInHy: Math.max(
      0,
      Math.floor(
        t.weightInHy ?? (isUt ? 20 : isHy ? 80 : 0),
      ),
    ),
    weightInFinal: Math.max(
      0,
      Math.floor(
        t.weightInFinal ??
          (isUt ? 20 : isHy ? 30 : isAnnual ? 50 : 0),
      ),
    ),
    requiredOnMarksheet: t.requiredOnMarksheet !== false,
    requiresSeparateMarksheet: t.requiresSeparateMarksheet !== false,
  });
}

function normalizeSubject(s: Partial<ExamSubject>): ExamSubject {
  return {
    id: s.id ?? id("sub"),
    code: (s.code ?? "").trim() || "SUB",
    name: s.name ?? s.code ?? "Subject",
    classIds: Array.isArray(s.classIds) ? s.classIds : [],
    maxMarks: Math.max(1, Math.floor(s.maxMarks ?? 100)),
    sortOrder: s.sortOrder ?? 0,
    isActive: s.isActive !== false,
  };
}

function normalizeMark(m: Partial<StudentSubjectMark>): StudentSubjectMark {
  const obtained =
    m.marksObtained == null || Number.isNaN(Number(m.marksObtained))
      ? null
      : Math.max(0, Number(m.marksObtained));
  return {
    studentId: m.studentId ?? "",
    subjectId: m.subjectId ?? "",
    marksObtained: obtained,
    grade: m.grade ?? "—",
    remark: m.remark ?? "",
  };
}

function normalizeSheet(s: Partial<MarkSheet>): MarkSheet {
  return {
    id: s.id ?? id("ms"),
    academicYearCode: s.academicYearCode ?? DEFAULT_AY,
    examTermId: s.examTermId ?? "",
    classId: s.classId ?? "",
    sectionId: s.sectionId ?? "",
    marks: Array.isArray(s.marks) ? s.marks.map(normalizeMark) : [],
    lockedAt: s.lockedAt ?? null,
    enteredBy: s.enteredBy ?? "",
    updatedAt: s.updatedAt ?? new Date().toISOString(),
  };
}

function normalizePromotion(p: Partial<PromotionRecord>): PromotionRecord {
  const decision =
    p.decision === "promoted" ||
    p.decision === "detained" ||
    p.decision === "conditional"
      ? p.decision
      : "pending";
  return {
    id: p.id ?? id("prom"),
    studentId: p.studentId ?? "",
    examTermId: p.examTermId ?? "",
    academicYearCode: p.academicYearCode ?? DEFAULT_AY,
    fromClassId: p.fromClassId ?? "",
    fromSectionId: p.fromSectionId ?? "",
    decision,
    toClassId: p.toClassId ?? "",
    toSectionId: p.toSectionId ?? "",
    remark: p.remark ?? "",
    percent: Math.max(0, Number(p.percent) || 0),
    overallGrade: p.overallGrade ?? "—",
    passed: !!p.passed,
    decidedAt: p.decidedAt ?? null,
    decidedBy: p.decidedBy ?? "",
    appliedToSisAt: p.appliedToSisAt ?? null,
  };
}

export function loadExams(): ExamsState {
  if (typeof window === "undefined") return emptyState();
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyState();
    const parsed = JSON.parse(raw) as ExamsState;
    const terms =
      Array.isArray(parsed.terms) && parsed.terms.length > 0
        ? parsed.terms.map(normalizeTerm)
        : defaultTerms();
    const subjects =
      Array.isArray(parsed.subjects) && parsed.subjects.length > 0
        ? parsed.subjects.map(normalizeSubject)
        : defaultSubjects();
    const next: ExamsState = {
      version: 1,
      terms,
      subjects,
      sheets: Array.isArray(parsed.sheets)
        ? parsed.sheets.map(normalizeSheet)
        : [],
      policy: normalizeExamPolicy(parsed.policy),
      promotions: Array.isArray(parsed.promotions)
        ? parsed.promotions.map(normalizePromotion)
        : [],
    };
    const migrated = terms.some(
      (t, i) =>
        t.code !== (parsed.terms?.[i] as ExamTerm | undefined)?.code ||
        t.label !== (parsed.terms?.[i] as ExamTerm | undefined)?.label,
    );
    const missingPolicy = !parsed.policy;
    if (migrated || missingPolicy) {
      localStorage.setItem(STORAGE_KEY, JSON.stringify(next));
    }
    return next;
  } catch {
    return emptyState();
  }
}

export function saveExams(state: ExamsState) {
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
}

export function getExamPolicy(state?: ExamsState): ExamPolicy {
  return normalizeExamPolicy((state ?? loadExams()).policy);
}

/** True when any mark sheet for this exam has at least one entered mark. */
export function examHasPersistedStudentData(
  examTermId: string,
  state?: ExamsState,
): boolean {
  const s = state ?? loadExams();
  for (const sheet of s.sheets) {
    if (sheet.examTermId !== examTermId) continue;
    if (sheet.marks.some((m) => m.marksObtained != null)) return true;
  }
  return false;
}

function policyMaxForExam(term: ExamTerm, policy: ExamPolicy): number {
  return isUnitTestCode(term.code)
    ? policy.defaultUtMaxMarks
    : policy.defaultTermMaxMarks;
}

/**
 * Save policy and apply default max marks to exams that have no student marks yet.
 * Also syncs report-card fee-hold stage into the holds engine.
 */
export function saveExamPolicy(
  patch: Partial<ExamPolicy>,
):
  | {
      ok: true;
      policy: ExamPolicy;
      updatedExamIds: string[];
    }
  | { ok: false; error: string } {
  const state = loadExams();
  const prev = normalizeExamPolicy(state.policy);
  const policy = normalizeExamPolicy({ ...prev, ...patch });

  const updatedExamIds: string[] = [];
  const terms = state.terms.map((t) => {
    if (examHasPersistedStudentData(t.id, state)) return t;
    const nextMax = policyMaxForExam(t, policy);
    if (t.maxMarks === nextMax) return t;
    updatedExamIds.push(t.id);
    return normalizeTerm({ ...t, maxMarks: nextMax });
  });

  saveExams({ ...state, policy, terms });
  setReportCardHoldFromStage(policy.reportCardHoldFromStage);

  return { ok: true, policy, updatedExamIds };
}

export function listExamTerms(
  ay = DEFAULT_AY,
  state?: ExamsState,
): ExamTerm[] {
  const s = state ?? loadExams();
  return s.terms
    .filter((t) => t.isActive && t.academicYearCode === ay)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function listAllExamTerms(
  ay = DEFAULT_AY,
  state?: ExamsState,
): ExamTerm[] {
  const s = state ?? loadExams();
  return s.terms
    .filter((t) => t.academicYearCode === ay)
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

export function createExamTerm(input: {
  code: string;
  label: string;
  academicYearCode?: string;
  maxMarks: number;
  startsOn?: string;
  endsOn?: string;
  note?: string;
  countsTowardHy?: boolean;
  countsTowardFinal?: boolean;
  weightInHy?: number;
  weightInFinal?: number;
  requiredOnMarksheet?: boolean;
  requiresSeparateMarksheet?: boolean;
}):
  | { ok: true; term: ExamTerm }
  | { ok: false; error: string } {
  const code = input.code.trim().toUpperCase().replace(/\s+/g, "");
  const label = input.label.trim();
  if (!code || code.length > 12) {
    return { ok: false, error: "Exam code is required (max 12 chars)" };
  }
  if (!label) return { ok: false, error: "Exam name is required" };
  const maxMarks = Math.max(1, Math.floor(input.maxMarks));
  if (maxMarks > 1000) {
    return { ok: false, error: "Max marks looks too high" };
  }
  if (
    input.startsOn &&
    input.endsOn &&
    input.endsOn < input.startsOn
  ) {
    return { ok: false, error: "End date cannot be before start date" };
  }

  const ay = input.academicYearCode ?? DEFAULT_AY;
  const state = loadExams();
  const policy = getExamPolicy(state);
  if (
    state.terms.some(
      (t) =>
        t.academicYearCode === ay &&
        t.code.toUpperCase() === code &&
        t.isActive,
    )
  ) {
    return { ok: false, error: `Exam code ${code} already exists for ${ay}` };
  }

  const maxSort = state.terms
    .filter((t) => t.academicYearCode === ay)
    .reduce((m, t) => Math.max(m, t.sortOrder), 0);

  const term = normalizeTerm({
    id: id("term"),
    code,
    label,
    academicYearCode: ay,
    maxMarks,
    sortOrder: maxSort + 1,
    isActive: true,
    startsOn: input.startsOn ?? "",
    endsOn: input.endsOn ?? "",
    note: input.note?.trim() ?? "",
    countsTowardHy: input.countsTowardHy ?? policy.defaultCountsTowardHy,
    countsTowardFinal:
      input.countsTowardFinal ?? policy.defaultCountsTowardFinal,
    weightInHy: input.weightInHy ?? policy.defaultWeightInHy,
    weightInFinal: input.weightInFinal ?? policy.defaultWeightInFinal,
    requiredOnMarksheet:
      input.requiredOnMarksheet ?? policy.defaultRequiredOnMarksheet,
    requiresSeparateMarksheet:
      input.requiresSeparateMarksheet ??
      policy.defaultRequiresSeparateMarksheet,
  });

  saveExams({ ...state, terms: [...state.terms, term] });
  return { ok: true, term };
}

export function updateExamTerm(
  termId: string,
  patch: Partial<
    Pick<
      ExamTerm,
      | "code"
      | "label"
      | "maxMarks"
      | "startsOn"
      | "endsOn"
      | "note"
      | "isActive"
      | "sortOrder"
      | "countsTowardHy"
      | "countsTowardFinal"
      | "weightInHy"
      | "weightInFinal"
      | "requiredOnMarksheet"
      | "requiresSeparateMarksheet"
    >
  >,
): { ok: true; term: ExamTerm } | { ok: false; error: string } {
  const state = loadExams();
  const existing = state.terms.find((t) => t.id === termId);
  if (!existing) return { ok: false, error: "Exam not found" };

  const hasData = examHasPersistedStudentData(termId, state);
  if (hasData) {
    if (
      patch.code != null &&
      patch.code.toUpperCase() !== existing.code
    ) {
      return {
        ok: false,
        error: "Cannot change code — student marks already saved for this exam",
      };
    }
    if (
      patch.maxMarks != null &&
      patch.maxMarks !== existing.maxMarks
    ) {
      return {
        ok: false,
        error:
          "Cannot change max marks — student marks already saved for this exam",
      };
    }
  }

  if (
    patch.startsOn &&
    patch.endsOn &&
    patch.endsOn < patch.startsOn
  ) {
    return { ok: false, error: "End date cannot be before start date" };
  }

  const nextCode = (patch.code ?? existing.code).trim().toUpperCase();
  if (
    nextCode !== existing.code &&
    state.terms.some(
      (t) =>
        t.id !== termId &&
        t.academicYearCode === existing.academicYearCode &&
        t.code.toUpperCase() === nextCode &&
        t.isActive,
    )
  ) {
    return { ok: false, error: `Exam code ${nextCode} already exists` };
  }

  const term = normalizeTerm({
    ...existing,
    ...patch,
    code: nextCode,
    maxMarks: patch.maxMarks ?? existing.maxMarks,
    label: patch.label ?? existing.label,
  });
  saveExams({
    ...state,
    terms: state.terms.map((t) => (t.id === termId ? term : t)),
  });
  return { ok: true, term };
}

export function deactivateExamTerm(
  termId: string,
): { ok: true } | { ok: false; error: string } {
  const result = updateExamTerm(termId, { isActive: false });
  if (!result.ok) return result;
  return { ok: true };
}

/** Delete exam only when no student marks are persisted. */
export function deleteExamTerm(
  termId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadExams();
  const existing = state.terms.find((t) => t.id === termId);
  if (!existing) return { ok: false, error: "Exam not found" };
  if (examHasPersistedStudentData(termId, state)) {
    return {
      ok: false,
      error:
        "Cannot delete — student marks exist. Deactivate instead, or clear marks first.",
    };
  }
  saveExams({
    ...state,
    terms: state.terms.filter((t) => t.id !== termId),
    sheets: state.sheets.filter((s) => s.examTermId !== termId),
  });
  return { ok: true };
}

/** Subjects applicable to a class (empty classIds = all). */
export function subjectsForClass(
  classId: string,
  state?: ExamsState,
): ExamSubject[] {
  const s = state ?? loadExams();
  return s.subjects
    .filter(
      (sub) =>
        sub.isActive &&
        (sub.classIds.length === 0 || sub.classIds.includes(classId)),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

/**
 * Ensure exam catalog has master subjects linked to this class (Tag A–D).
 * Creates missing rows by code; widens classIds when needed.
 */
export function syncExamSubjectsFromMasters(
  classId?: string,
  state?: ExamsState,
): ExamsState {
  const s = state ?? loadExams();
  let masters: MastersState;
  try {
    masters = loadMasters();
  } catch {
    return s;
  }

  const classIds =
    classId
      ? [classId]
      : masters.classes.filter((c) => c.isActive).map((c) => c.id);

  const linkedCodes = new Map<string, MasterSubject>();
  for (const cid of classIds) {
    for (const link of masters.classSubjects ?? []) {
      if (!link.isActive || link.classId !== cid) continue;
      const sub = masters.subjects.find((x) => x.id === link.subjectId);
      if (!sub || !sub.isActive || sub.parentId) continue;
      const tag = ncfTagForSubject(sub);
      if (tag === "CO") continue;
      linkedCodes.set(sub.code.toUpperCase(), sub);
    }
  }

  // Also pull any confirmed student enrollments so cart-only codes exist
  try {
    const sis = loadSis();
    for (const st of sis.students) {
      if (classId && st.classId !== classId) continue;
      if (!isCurriculumConfirmed(st)) continue;
      const enrolled = resolveStudentSubjects(st, masters, {
        forAssessment: true,
      });
      for (const sub of enrolled) {
        if (sub.parentId) continue;
        linkedCodes.set(sub.code.toUpperCase(), sub);
      }
    }
  } catch {
    /* ignore */
  }

  let changed = false;
  let subjects = [...s.subjects];
  const byCode = new Map(
    subjects.map((e) => [e.code.toUpperCase(), e] as const),
  );

  for (const [code, master] of linkedCodes) {
    const existing = byCode.get(code);
    if (!existing) {
      const row: ExamSubject = {
        id: id("esub"),
        code: master.code,
        name: master.nameEn,
        classIds: classId ? [classId] : [],
        maxMarks: 100,
        sortOrder: master.sortOrder || subjects.length + 1,
        isActive: true,
      };
      subjects.push(row);
      byCode.set(code, row);
      changed = true;
      continue;
    }
    if (classId && existing.classIds.length > 0 && !existing.classIds.includes(classId)) {
      subjects = subjects.map((e) =>
        e.id === existing.id
          ? { ...e, classIds: [...existing.classIds, classId] }
          : e,
      );
      byCode.set(code, {
        ...existing,
        classIds: [...existing.classIds, classId],
      });
      changed = true;
    }
    if (existing.name !== master.nameEn && master.nameEn) {
      subjects = subjects.map((e) =>
        e.id === existing.id ? { ...e, name: master.nameEn } : e,
      );
      changed = true;
    }
  }

  if (!changed) return s;
  const next = { ...s, subjects };
  saveExams(next);
  return next;
}

function matchExamSubjectsToCodes(
  codes: string[],
  examSubs: ExamSubject[],
  mastersSubs: MasterSubject[],
): ExamSubject[] {
  const want = codes.map((c) => c.toUpperCase());
  const byExamCode = new Map(
    examSubs.map((e) => [e.code.toUpperCase(), e] as const),
  );
  const out: ExamSubject[] = [];
  const seen = new Set<string>();

  for (const code of want) {
    if (seen.has(code)) continue;
    seen.add(code);
    const existing = byExamCode.get(code);
    if (existing) {
      out.push(existing);
      continue;
    }
    const master = mastersSubs.find((s) => s.code.toUpperCase() === code);
    if (!master) continue;
    out.push({
      id: id("esub"),
      code: master.code,
      name: master.nameEn,
      classIds: [],
      maxMarks: 100,
      sortOrder: master.sortOrder || out.length + 1,
      isActive: true,
    });
  }
  return out;
}

/**
 * Prefer confirmed SIS curriculum enrollment when present; else class exam subjects.
 * Synthesizes missing exam-subject rows from Masters so cart electives appear on reports.
 */
export function subjectsForStudent(
  student: SisStudent,
  state?: ExamsState,
): ExamSubject[] {
  let s = state ?? loadExams();
  s = syncExamSubjectsFromMasters(student.classId, s);
  const examSubs = subjectsForClass(student.classId, s);

  let masters: MastersState;
  try {
    masters = loadMasters();
  } catch {
    return examSubs;
  }

  const enrolled = resolveStudentSubjects(student, masters, {
    forAssessment: true,
  });
  const source = assessmentEnrollmentSource(student, masters);

  if (enrolled.length === 0) {
    // Confirmed cart with zero subjects — do not invent class list
    if (source === "confirmed_cart") return [];
    return examSubs;
  }

  const matched = matchExamSubjectsToCodes(
    enrolled.map((e) => e.code),
    s.subjects.filter((x) => x.isActive),
    masters.subjects,
  );

  // Persist any synthesized exam subjects
  const knownIds = new Set(s.subjects.map((x) => x.id));
  const toAdd = matched.filter((m) => !knownIds.has(m.id));
  if (toAdd.length > 0) {
    const next = { ...s, subjects: [...s.subjects, ...toAdd] };
    saveExams(next);
  }

  if (matched.length > 0) return matched;
  return source === "confirmed_cart" ? [] : examSubs;
}

/** Union of subjects needed for a section mark sheet (per-student enrollment aware). */
export function subjectsForMarkEntry(
  classId: string,
  students: SisStudent[],
  state?: ExamsState,
): ExamSubject[] {
  const s = syncExamSubjectsFromMasters(classId, state ?? loadExams());
  const byCode = new Map<string, ExamSubject>();

  for (const st of students) {
    for (const sub of subjectsForStudent(st, s)) {
      byCode.set(sub.code.toUpperCase(), sub);
    }
  }

  if (byCode.size === 0) {
    return subjectsForClass(classId, s);
  }

  return [...byCode.values()].sort(
    (a, b) => a.sortOrder - b.sortOrder || a.code.localeCompare(b.code),
  );
}

/** Whether this exam subject is on the student's enrollment (by code). */
export function studentTakesExamSubject(
  student: SisStudent,
  subject: ExamSubject,
  state?: ExamsState,
): boolean {
  const list = subjectsForStudent(student, state);
  const code = subject.code.toUpperCase();
  return list.some((s) => s.code.toUpperCase() === code);
}

export function findMarkSheet(
  ay: string,
  examTermId: string,
  sectionId: string,
  state?: ExamsState,
): MarkSheet | undefined {
  const s = state ?? loadExams();
  return s.sheets.find(
    (x) =>
      x.academicYearCode === ay &&
      x.examTermId === examTermId &&
      x.sectionId === sectionId,
  );
}

export function effectiveMaxMarks(
  term: ExamTerm,
  subject: ExamSubject,
): number {
  return Math.min(term.maxMarks, subject.maxMarks);
}

export function buildEmptyMarksGrid(
  students: SisStudent[],
  subjects: ExamSubject[],
  term: ExamTerm,
  existing?: MarkSheet,
  passPercent = 33,
): StudentSubjectMark[] {
  const map = new Map<string, StudentSubjectMark>();
  for (const m of existing?.marks ?? []) {
    map.set(`${m.studentId}:${m.subjectId}`, m);
  }
  const out: StudentSubjectMark[] = [];
  for (const st of students) {
    for (const sub of subjects) {
      const key = `${st.id}:${sub.id}`;
      const prev = map.get(key);
      const max = effectiveMaxMarks(term, sub);
      const obtained = prev?.marksObtained ?? null;
      out.push({
        studentId: st.id,
        subjectId: sub.id,
        marksObtained: obtained,
        grade: gradeFromMarks(obtained, max, passPercent),
        remark: prev?.remark ?? "",
      });
    }
  }
  return out;
}

export function saveMarkSheet(input: {
  academicYearCode: string;
  examTermId: string;
  classId: string;
  sectionId: string;
  marks: StudentSubjectMark[];
  enteredBy: string;
  lock?: boolean;
}):
  | { ok: true; sheet: MarkSheet }
  | { ok: false; error: string } {
  if (!input.examTermId || !input.sectionId || !input.classId) {
    return { ok: false, error: "Select exam, class and section" };
  }
  const state = loadExams();
  const term = state.terms.find((t) => t.id === input.examTermId);
  if (!term) return { ok: false, error: "Exam term not found" };

  const subjects = subjectsForMarkEntry(
    input.classId,
    // Validate against marks' student ids present in sheet
    (() => {
      try {
        const sis = loadSis();
        const ids = new Set(input.marks.map((m) => m.studentId));
        return sis.students.filter((st) => ids.has(st.id));
      } catch {
        return [];
      }
    })(),
    state,
  );
  const subById = new Map(subjects.map((s) => [s.id, s]));
  // Also allow any active exam subject by id (legacy sheets)
  for (const s of state.subjects) {
    if (s.isActive && !subById.has(s.id)) subById.set(s.id, s);
  }
  const passPercent = getExamPolicy(state).passPercent;

  for (const m of input.marks) {
    const sub = subById.get(m.subjectId);
    if (!sub) continue;
    const max = effectiveMaxMarks(term, sub);
    if (m.marksObtained != null && m.marksObtained > max) {
      return {
        ok: false,
        error: `${sub.name}: marks cannot exceed ${max}`,
      };
    }
  }

  const existing = findMarkSheet(
    input.academicYearCode,
    input.examTermId,
    input.sectionId,
    state,
  );
  if (existing?.lockedAt && !input.lock) {
    return {
      ok: false,
      error: "Mark sheet is locked — unlock is not available in demo",
    };
  }

  const normalizedMarks = input.marks.map((m) => {
    const sub = subById.get(m.subjectId);
    const max = sub ? effectiveMaxMarks(term, sub) : 100;
    return normalizeMark({
      ...m,
      grade: gradeFromMarks(m.marksObtained, max, passPercent),
    });
  });

  const now = new Date().toISOString();
  const sheet = normalizeSheet({
    id: existing?.id ?? id("ms"),
    academicYearCode: input.academicYearCode,
    examTermId: input.examTermId,
    classId: input.classId,
    sectionId: input.sectionId,
    marks: normalizedMarks,
    lockedAt: input.lock ? now : existing?.lockedAt ?? null,
    enteredBy: input.enteredBy,
    updatedAt: now,
  });

  const sheets = existing
    ? state.sheets.map((s) => (s.id === existing.id ? sheet : s))
    : [sheet, ...state.sheets];
  saveExams({ ...state, sheets });
  return { ok: true, sheet };
}

export type ReportCardLine = {
  subjectId: string;
  subjectName: string;
  maxMarks: number;
  marksObtained: number | null;
  grade: string;
  remark: string;
};

export type ReportCardComponentLine = {
  examTermId: string;
  examCode: string;
  examLabel: string;
  weight: number;
  subjectId: string;
  maxMarks: number;
  marksObtained: number | null;
  requiredOnMarksheet: boolean;
};

export type ReportCard = {
  student: SisStudent;
  classLabel: string;
  examTerm: ExamTerm;
  academicYearCode: string;
  lines: ReportCardLine[];
  /** Component exams folded into HY / Final aggregate (empty for single-exam sheets) */
  components: ReportCardComponentLine[];
  aggregateMode: "none" | "hy" | "final";
  totalObtained: number;
  totalMax: number;
  percent: number;
  overallGrade: string;
  attendance: {
    presentDays: number;
    workingDays: number;
    percent: number;
  } | null;
  holdBlocked: boolean;
  holdMessage: string;
  /** How subject list was resolved for this card */
  curriculumSource: "confirmed_cart" | "class_map";
  /** Soft note when enrollment is provisional */
  curriculumNote: string;
};

function attendanceSummaryForStudent(
  studentId: string,
  sectionId: string,
  ay: string,
): ReportCard["attendance"] {
  const regs = loadAttendance().registers.filter(
    (r: AttendanceRegister) =>
      r.academicYearCode === ay && r.sectionId === sectionId,
  );
  if (regs.length === 0) return null;
  let present = 0;
  let working = 0;
  for (const r of regs) {
    const mark = r.marks.find((m) => m.studentId === studentId);
    if (!mark) continue;
    working += 1;
    if (mark.status === "P" || mark.status === "L" || mark.status === "HD") {
      present += mark.status === "HD" ? 0.5 : 1;
    }
  }
  if (working === 0) return null;
  return {
    presentDays: present,
    workingDays: working,
    percent: Math.round((present / working) * 1000) / 10,
  };
}

function contributorsForAggregate(
  mode: "hy" | "final",
  ay: string,
  state: ExamsState,
): ExamTerm[] {
  return state.terms
    .filter(
      (t) =>
        t.isActive &&
        t.academicYearCode === ay &&
        (mode === "hy" ? t.countsTowardHy : t.countsTowardFinal) &&
        (mode === "hy" ? t.weightInHy > 0 : t.weightInFinal > 0),
    )
    .sort((a, b) => a.sortOrder - b.sortOrder);
}

function studentHasMarksOnSheet(
  sheet: MarkSheet | undefined,
  studentId: string,
): boolean {
  if (!sheet) return false;
  return sheet.marks.some(
    (m) => m.studentId === studentId && m.marksObtained != null,
  );
}

/** Resolve a mark row by exam-subject id or matching code (legacy id drift). */
function markForExamSubject(
  sheet: MarkSheet | undefined,
  studentId: string,
  subject: ExamSubject,
  allSubjects: ExamSubject[],
): StudentSubjectMark | undefined {
  if (!sheet) return undefined;
  const direct = sheet.marks.find(
    (m) => m.studentId === studentId && m.subjectId === subject.id,
  );
  if (direct) return direct;
  const code = subject.code.toUpperCase();
  const ids = new Set(
    allSubjects
      .filter((s) => s.code.toUpperCase() === code)
      .map((s) => s.id),
  );
  return sheet.marks.find(
    (m) => m.studentId === studentId && ids.has(m.subjectId),
  );
}

export function buildReportCard(input: {
  student: SisStudent;
  classLabel: string;
  examTermId: string;
  academicYearCode?: string;
}): ReportCard | { error: string } {
  const ay = input.academicYearCode ?? input.student.academicYearCode ?? DEFAULT_AY;
  const state = loadExams();
  const term = state.terms.find((t) => t.id === input.examTermId);
  if (!term) return { error: "Exam term not found" };

  let masters: MastersState | null = null;
  try {
    masters = loadMasters();
  } catch {
    masters = null;
  }

  const mode = masters
    ? curriculumChoiceMode(classGroupForStudent(input.student, masters))
    : "none";
  const cartStage = mode === "secondary_cart" || mode === "senior_cart";
  const confirmed = isCurriculumConfirmed(input.student);
  const curriculumSource =
    masters
      ? assessmentEnrollmentSource(input.student, masters)
      : "class_map";

  if (cartStage && confirmed) {
    const enrolled = masters
      ? resolveStudentSubjects(input.student, masters, { forAssessment: true })
      : [];
    if (enrolled.length === 0) {
      return {
        error:
          "Curriculum is confirmed but has no subjects. Open Students → Subjects and enroll the cart before generating a report card.",
      };
    }
  }

  const subjects = subjectsForStudent(input.student, state);
  if (subjects.length === 0) {
    return {
      error: cartStage
        ? confirmed
          ? "No exam subjects match the confirmed enrollment. Sync Masters subjects or add exam subjects."
          : "Confirm subject enrollment (Students → Subjects) before printing the report card for IX–XII."
        : "No exam subjects configured for this class.",
    };
  }

  const curriculumNote =
    cartStage && !confirmed
      ? "Subject list is provisional (class map) — confirm curriculum enrollment for the final report."
      : curriculumSource === "confirmed_cart"
        ? "Subjects from confirmed curriculum enrollment."
        : "";

  const policy = getExamPolicy(state);
  const hold = checkHold(input.student.id, "HOLD_REPORT_CARD");
  const allExamSubs = state.subjects;

  const wantAggregate =
    policy.includeComponentsInHyFinalReports &&
    (isHyCode(term.code) || isFinalCode(term.code));
  const aggregateMode: ReportCard["aggregateMode"] = wantAggregate
    ? isHyCode(term.code)
      ? "hy"
      : "final"
    : "none";

  if (aggregateMode !== "none") {
    const contributors = contributorsForAggregate(
      aggregateMode,
      ay,
      state,
    );
    if (contributors.length === 0) {
      return {
        error: `No exams are flagged to count toward ${
          aggregateMode === "hy" ? "Half-yearly" : "Final"
        } aggregate. Set this on each exam under Exams & policy.`,
      };
    }

    if (policy.enforceSeparateMarksheetsForAggregate) {
      const missing: string[] = [];
      for (const c of contributors) {
        if (!c.requiresSeparateMarksheet) continue;
        const sheet = findMarkSheet(ay, c.id, input.student.sectionId, state);
        if (!studentHasMarksOnSheet(sheet, input.student.id)) {
          missing.push(c.code);
        }
      }
      if (missing.length > 0) {
        return {
          error: `Separate marksheet required but missing for: ${missing.join(", ")}`,
        };
      }
    }

    const components: ReportCardComponentLine[] = [];
    const lines: ReportCardLine[] = [];
    let totalObtained = 0;
    let totalMax = 0;
    let subjectsWithMarks = 0;

    for (const sub of subjects) {
      let weightedSum = 0;
      let weightTotal = 0;
      let anyMark = false;
      let remark = "";

      for (const c of contributors) {
        const weight =
          aggregateMode === "hy" ? c.weightInHy : c.weightInFinal;
        const sheet = findMarkSheet(ay, c.id, input.student.sectionId, state);
        const m = markForExamSubject(
          sheet,
          input.student.id,
          sub,
          allExamSubs,
        );
        const max = effectiveMaxMarks(c, sub);
        const obtained = m?.marksObtained ?? null;
        if (c.requiredOnMarksheet || obtained != null) {
          components.push({
            examTermId: c.id,
            examCode: c.code,
            examLabel: c.label,
            weight,
            subjectId: sub.id,
            maxMarks: max,
            marksObtained: obtained,
            requiredOnMarksheet: c.requiredOnMarksheet,
          });
        }
        if (obtained != null && weight > 0 && max > 0) {
          weightedSum += (obtained / max) * weight;
          weightTotal += weight;
          anyMark = true;
          if (m?.remark) remark = m.remark;
        }
      }

      const displayMax = 100;
      const obtainedScaled =
        anyMark && weightTotal > 0
          ? Math.round((weightedSum / weightTotal) * displayMax * 10) / 10
          : null;

      lines.push({
        subjectId: sub.id,
        subjectName: sub.name,
        maxMarks: displayMax,
        marksObtained: obtainedScaled,
        grade: gradeFromMarks(
          obtainedScaled,
          displayMax,
          policy.passPercent,
        ),
        remark,
      });

      if (obtainedScaled != null) {
        totalObtained += obtainedScaled;
        totalMax += displayMax;
        subjectsWithMarks += 1;
      }
    }

    if (subjectsWithMarks === 0) {
      return {
        error: `No component marks found for ${
          aggregateMode === "hy" ? "Half-yearly" : "Final"
        } aggregate`,
      };
    }
    if (
      policy.requireAllSubjectsForReport &&
      subjectsWithMarks < subjects.length
    ) {
      return {
        error: `Exam policy requires all ${subjects.length} subjects marked (${subjectsWithMarks} with aggregate marks)`,
      };
    }

    const percent =
      totalMax > 0
        ? Math.round((totalObtained / totalMax) * 1000) / 10
        : 0;

    return {
      student: input.student,
      classLabel: input.classLabel,
      examTerm: term,
      academicYearCode: ay,
      lines,
      components,
      aggregateMode,
      totalObtained: Math.round(totalObtained * 10) / 10,
      totalMax,
      percent,
      overallGrade: policy.includeOverallGrade
        ? gradeFromPercent(percent, policy.passPercent)
        : "—",
      attendance: policy.showAttendanceOnReport
        ? attendanceSummaryForStudent(
            input.student.id,
            input.student.sectionId,
            ay,
          )
        : null,
      holdBlocked: !hold.allowed,
      holdMessage: hold.allowed ? "" : hold.message,
      curriculumSource,
      curriculumNote,
    };
  }

  const sheet = findMarkSheet(ay, term.id, input.student.sectionId, state);
  if (!sheet) {
    return {
      error: "No marks saved for this class section and exam yet",
    };
  }

  const lines: ReportCardLine[] = [];
  let totalObtained = 0;
  let totalMax = 0;
  let counted = 0;

  for (const sub of subjects) {
    const m = markForExamSubject(sheet, input.student.id, sub, allExamSubs);
    const max = effectiveMaxMarks(term, sub);
    const obtained = m?.marksObtained ?? null;
    lines.push({
      subjectId: sub.id,
      subjectName: sub.name,
      maxMarks: max,
      marksObtained: obtained,
      grade: gradeFromMarks(obtained, max, policy.passPercent),
      remark: m?.remark ?? "",
    });
    if (obtained != null) {
      totalObtained += obtained;
      totalMax += max;
      counted += 1;
    }
  }

  if (counted === 0) {
    return { error: "No marks entered for this student in this exam" };
  }
  if (
    policy.requireAllSubjectsForReport &&
    counted < subjects.length
  ) {
    return {
      error: `Exam policy requires all ${subjects.length} subjects marked (${counted} entered)`,
    };
  }

  const percent =
    totalMax > 0
      ? Math.round((totalObtained / totalMax) * 1000) / 10
      : 0;

  return {
    student: input.student,
    classLabel: input.classLabel,
    examTerm: term,
    academicYearCode: ay,
    lines,
    components: [],
    aggregateMode: "none",
    totalObtained,
    totalMax,
    percent,
    overallGrade: policy.includeOverallGrade
      ? gradeFromPercent(percent, policy.passPercent)
      : "—",
    attendance: policy.showAttendanceOnReport
      ? attendanceSummaryForStudent(
          input.student.id,
          input.student.sectionId,
          ay,
        )
      : null,
    holdBlocked: !hold.allowed,
    holdMessage: hold.allowed ? "" : hold.message,
    curriculumSource,
    curriculumNote,
  };
}

export function canPrintReportCard(studentId: string): {
  allowed: boolean;
  message: string;
} {
  const hold = checkHold(studentId, "HOLD_REPORT_CARD");
  if (!hold.allowed) {
    return { allowed: false, message: hold.message };
  }
  return { allowed: true, message: "" };
}

export function evaluatePromotionPass(
  lines: ReportCardLine[],
  passPercent: number,
  requireAllSubjects: boolean,
): { passed: boolean; failedSubjects: string[] } {
  const failedSubjects: string[] = [];
  let obtainedTotal = 0;
  let maxTotal = 0;
  for (const line of lines) {
    if (line.marksObtained == null || line.maxMarks <= 0) continue;
    obtainedTotal += line.marksObtained;
    maxTotal += line.maxMarks;
    const pct = (line.marksObtained / line.maxMarks) * 100;
    if (pct < passPercent) failedSubjects.push(line.subjectName);
  }
  const overallPct = maxTotal > 0 ? (obtainedTotal / maxTotal) * 100 : 0;
  if (requireAllSubjects && failedSubjects.length > 0) {
    return { passed: false, failedSubjects };
  }
  return {
    passed: overallPct >= passPercent,
    failedSubjects,
  };
}

export function nextClassAfter(
  classId: string,
  masters?: MastersState,
): SchoolClass | null {
  const m = masters ?? loadMasters();
  const current = m.classes.find((c) => c.id === classId);
  if (!current) return null;
  const ordered = m.classes
    .filter((c) => c.isActive)
    .sort((a, b) => a.sortOrder - b.sortOrder);
  const idx = ordered.findIndex((c) => c.id === classId);
  if (idx < 0 || idx >= ordered.length - 1) return null;
  return ordered[idx + 1] ?? null;
}

export function defaultSectionForClass(
  classId: string,
  masters?: MastersState,
): Section | null {
  const m = masters ?? loadMasters();
  return (
    m.sections.find((s) => s.classId === classId && s.isActive) ??
    m.sections.find((s) => s.classId === classId) ??
    null
  );
}

export function findPromotionRecord(
  studentId: string,
  examTermId: string,
  ay: string,
  state?: ExamsState,
): PromotionRecord | undefined {
  const s = state ?? loadExams();
  return s.promotions.find(
    (p) =>
      p.studentId === studentId &&
      p.examTermId === examTermId &&
      p.academicYearCode === ay,
  );
}

export type ClassResultRow = {
  student: SisStudent;
  card: ReportCard | null;
  error: string | null;
  passed: boolean;
  failedSubjects: string[];
  suggested: PromotionDecision;
  record: PromotionRecord | null;
  nextClass: SchoolClass | null;
  nextSection: Section | null;
};

export type ClassResultSheet = {
  academicYearCode: string;
  examTerm: ExamTerm;
  classId: string;
  sectionId: string;
  classLabel: string;
  rows: ClassResultRow[];
  summary: {
    total: number;
    withMarks: number;
    passed: number;
    failed: number;
    promoted: number;
    detained: number;
    conditional: number;
    pending: number;
    applied: number;
  };
};

export function buildClassResultSheet(input: {
  students: SisStudent[];
  classLabel: string;
  classId: string;
  sectionId: string;
  examTermId: string;
  academicYearCode?: string;
}): ClassResultSheet | { error: string } {
  const ay = input.academicYearCode ?? DEFAULT_AY;
  const state = loadExams();
  const term = state.terms.find((t) => t.id === input.examTermId);
  if (!term) return { error: "Exam term not found" };
  const policy = getExamPolicy(state);
  const masters = loadMasters();
  const nextClass = nextClassAfter(input.classId, masters);
  const nextSection = nextClass
    ? defaultSectionForClass(nextClass.id, masters)
    : null;

  const rows: ClassResultRow[] = [];
  for (const student of input.students) {
    const card = buildReportCard({
      student,
      classLabel: input.classLabel,
      examTermId: term.id,
      academicYearCode: ay,
    });
    if ("error" in card) {
      const record =
        findPromotionRecord(student.id, term.id, ay, state) ?? null;
      rows.push({
        student,
        card: null,
        error: card.error,
        passed: false,
        failedSubjects: [],
        suggested: "pending",
        record,
        nextClass,
        nextSection,
      });
      continue;
    }
    const evalPass = evaluatePromotionPass(
      card.lines,
      policy.passPercent,
      policy.requireAllSubjectsPassForPromotion,
    );
    const suggested: PromotionDecision = evalPass.passed
      ? "promoted"
      : "detained";
    const record =
      findPromotionRecord(student.id, term.id, ay, state) ?? null;
    rows.push({
      student,
      card,
      error: null,
      passed: evalPass.passed,
      failedSubjects: evalPass.failedSubjects,
      suggested,
      record,
      nextClass,
      nextSection,
    });
  }

  const summary = {
    total: rows.length,
    withMarks: rows.filter((r) => r.card).length,
    passed: rows.filter((r) => r.passed).length,
    failed: rows.filter((r) => r.card && !r.passed).length,
    promoted: rows.filter((r) => r.record?.decision === "promoted").length,
    detained: rows.filter((r) => r.record?.decision === "detained").length,
    conditional: rows.filter((r) => r.record?.decision === "conditional")
      .length,
    pending: rows.filter(
      (r) => !r.record || r.record.decision === "pending",
    ).length,
    applied: rows.filter((r) => r.record?.appliedToSisAt).length,
  };

  return {
    academicYearCode: ay,
    examTerm: term,
    classId: input.classId,
    sectionId: input.sectionId,
    classLabel: input.classLabel,
    rows,
    summary,
  };
}

export function savePromotionDecision(input: {
  studentId: string;
  examTermId: string;
  academicYearCode?: string;
  fromClassId: string;
  fromSectionId: string;
  decision: PromotionDecision;
  toClassId?: string;
  toSectionId?: string;
  remark?: string;
  percent?: number;
  overallGrade?: string;
  passed?: boolean;
  decidedBy: string;
}):
  | { ok: true; record: PromotionRecord }
  | { ok: false; error: string } {
  if (!input.studentId || !input.examTermId) {
    return { ok: false, error: "Student and exam are required" };
  }
  if (input.decision === "promoted") {
    if (!input.toClassId || !input.toSectionId) {
      return {
        ok: false,
        error: "Select destination class and section for promotion",
      };
    }
  }

  const ay = input.academicYearCode ?? DEFAULT_AY;
  const state = loadExams();
  const existing = findPromotionRecord(
    input.studentId,
    input.examTermId,
    ay,
    state,
  );
  if (existing?.appliedToSisAt && input.decision !== existing.decision) {
    return {
      ok: false,
      error:
        "Already applied to SIS — cannot change decision. Undo apply first (not available in demo).",
    };
  }

  const now = new Date().toISOString();
  const record = normalizePromotion({
    id: existing?.id,
    studentId: input.studentId,
    examTermId: input.examTermId,
    academicYearCode: ay,
    fromClassId: input.fromClassId,
    fromSectionId: input.fromSectionId,
    decision: input.decision,
    toClassId:
      input.decision === "promoted"
        ? (input.toClassId ?? "")
        : input.decision === "detained"
          ? input.fromClassId
          : (input.toClassId ?? existing?.toClassId ?? ""),
    toSectionId:
      input.decision === "promoted"
        ? (input.toSectionId ?? "")
        : input.decision === "detained"
          ? input.fromSectionId
          : (input.toSectionId ?? existing?.toSectionId ?? ""),
    remark: input.remark ?? existing?.remark ?? "",
    percent: input.percent ?? existing?.percent ?? 0,
    overallGrade: input.overallGrade ?? existing?.overallGrade ?? "—",
    passed: input.passed ?? existing?.passed ?? false,
    decidedAt: input.decision === "pending" ? null : now,
    decidedBy: input.decidedBy,
    appliedToSisAt: existing?.appliedToSisAt ?? null,
  });

  const promotions = existing
    ? state.promotions.map((p) => (p.id === existing.id ? record : p))
    : [...state.promotions, record];
  saveExams({ ...state, promotions });
  return { ok: true, record };
}

export function suggestPromotionsForSection(input: {
  students: SisStudent[];
  classLabel: string;
  classId: string;
  sectionId: string;
  examTermId: string;
  academicYearCode?: string;
  decidedBy: string;
}):
  | { ok: true; updated: number; skipped: number }
  | { ok: false; error: string } {
  const sheet = buildClassResultSheet(input);
  if ("error" in sheet) return { ok: false, error: sheet.error };

  let updated = 0;
  let skipped = 0;
  for (const row of sheet.rows) {
    if (!row.card) {
      skipped += 1;
      continue;
    }
    if (row.record?.appliedToSisAt) {
      skipped += 1;
      continue;
    }
    if (row.suggested === "promoted" && (!row.nextClass || !row.nextSection)) {
      const r = savePromotionDecision({
        studentId: row.student.id,
        examTermId: input.examTermId,
        academicYearCode: input.academicYearCode,
        fromClassId: input.classId,
        fromSectionId: input.sectionId,
        decision: "conditional",
        remark: "Highest class — no next class in masters",
        percent: row.card.percent,
        overallGrade: row.card.overallGrade,
        passed: row.passed,
        decidedBy: input.decidedBy,
      });
      if (r.ok) updated += 1;
      else skipped += 1;
      continue;
    }
    const r = savePromotionDecision({
      studentId: row.student.id,
      examTermId: input.examTermId,
      academicYearCode: input.academicYearCode,
      fromClassId: input.classId,
      fromSectionId: input.sectionId,
      decision: row.suggested,
      toClassId: row.nextClass?.id,
      toSectionId: row.nextSection?.id,
      percent: row.card.percent,
      overallGrade: row.card.overallGrade,
      passed: row.passed,
      decidedBy: input.decidedBy,
      remark:
        row.failedSubjects.length > 0
          ? `Below pass: ${row.failedSubjects.join(", ")}`
          : "",
    });
    if (r.ok) updated += 1;
    else skipped += 1;
  }
  return { ok: true, updated, skipped };
}

export function applyPromotionsToSis(input: {
  examTermId: string;
  sectionId: string;
  academicYearCode?: string;
}):
  | { ok: true; applied: number; skipped: number; errors: string[] }
  | { ok: false; error: string } {
  const ay = input.academicYearCode ?? DEFAULT_AY;
  const state = loadExams();
  const masters = loadMasters();
  const sis = loadSis();
  const errors: string[] = [];
  let applied = 0;
  let skipped = 0;

  const pending = state.promotions.filter(
    (p) =>
      p.examTermId === input.examTermId &&
      p.academicYearCode === ay &&
      p.fromSectionId === input.sectionId &&
      p.decision === "promoted" &&
      !p.appliedToSisAt,
  );

  if (pending.length === 0) {
    return {
      ok: false,
      error: "No promoted students pending SIS apply for this section",
    };
  }

  let students = [...sis.students];
  const now = new Date().toISOString();
  const appliedIds = new Set<string>();

  for (const p of pending) {
    const st = students.find((s) => s.id === p.studentId);
    if (!st) {
      errors.push(`Student missing: ${p.studentId}`);
      skipped += 1;
      continue;
    }
    const cls = masters.classes.find((c) => c.id === p.toClassId);
    const sec = masters.sections.find((s) => s.id === p.toSectionId);
    if (!cls || !sec || sec.classId !== cls.id) {
      errors.push(`${st.fullName}: invalid destination class/section`);
      skipped += 1;
      continue;
    }
    const feeGroupId = resolveFeeGroupId(masters, {
      studentType: "PROMOTE",
      classId: cls.id,
      academicYearCode: ay,
      preferPublished: true,
    });

    students = students.map((s) =>
      s.id === st.id
        ? normalizeStudent({
            ...s,
            classId: cls.id,
            sectionId: sec.id,
            studentType: "PROMOTE",
            feeGroupId: feeGroupId ?? s.feeGroupId,
            rollNo: "",
            curriculum: curriculumAfterClassChange({
              previous: st,
              toClassId: cls.id,
              decision: "promoted",
            }),
          })
        : s,
    );
    appliedIds.add(p.id);
    applied += 1;
  }

  if (applied === 0) {
    return {
      ok: false,
      error: errors[0] ?? "Could not apply any promotions",
    };
  }

  saveSis({ ...sis, students });
  saveExams({
    ...state,
    promotions: state.promotions.map((p) =>
      appliedIds.has(p.id) ? { ...p, appliedToSisAt: now } : p,
    ),
  });

  return { ok: true, applied, skipped, errors };
}

export function promotionDecisionLabel(d: PromotionDecision): string {
  switch (d) {
    case "promoted":
      return "Promoted";
    case "detained":
      return "Detained";
    case "conditional":
      return "Conditional";
    default:
      return "Pending";
  }
}
