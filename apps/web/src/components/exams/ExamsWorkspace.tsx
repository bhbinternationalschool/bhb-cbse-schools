"use client";
// ratchet-allow: grids_without_row_menu — the marks-entry grid and the promotion summary — cells are inputs, not a record list

import { memo, useCallback, useEffect, useMemo, useRef, useState } from "react";
import { ClipboardList } from "lucide-react";
import {
  applyPromotionsToSis,
  buildClassResultSheet,
  buildEmptyCoScholasticGrid,
  buildEmptyMarksGrid,
  buildReportCard,
  canPrintReportCard,
  coScholasticAreasForClass,
  coScholasticDomainLabel,
  componentsForTerm,
  createExamTerm,
  deactivateExamTerm,
  deleteExamTerm,
  effectiveMaxMarks,
  examHasPersistedStudentData,
  findMarkSheet,
  getExamPolicy,
  listAllExamTerms,
  listExamTerms,
  promotionDecisionLabel,
  saveExamPolicy,
  loadExams,
  saveMarkSheet,
  savePromotionDecision,
  schemeForClassId,
  subjectsForMarkEntry,
  subjectTakeMap,
  suggestPromotionsForSection,
  unlockMarkSheet,
  updateExamTerm,
  type AssessmentScheme,
  type ClassResultRow,
  type CoScholasticDomain,
  type CoScholasticRating,
  type ExamDeps,
  type ExamPolicy,
  type ExamSubject,
  type ExamTerm,
  type SchemeComponent,
  type PromotionDecision,
  type ReportCard,
  type StudentCoScholasticEntry,
  type StudentSubjectMark,
} from "@/lib/exams";
import { loadAttendance } from "@/lib/attendance";
import {
  clearExamSheetConflict,
  examSheetConflicts,
  retryPendingExamSheets,
  type SheetConflict,
} from "@/lib/examsSheetSync";
import { DeskSyncBanner } from "@/components/accounts/DeskSyncBanner";
import { AssessmentSchemesPanel } from "@/components/exams/AssessmentSchemesPanel";
import { pickableGrades, type CoScholasticArea, type GradeBand } from "@/lib/examSchemes";
import { rosterForSection } from "@/lib/attendance";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState, type SisStudent } from "@/lib/sis";
import {
  checkHold,
  checkHoldsForStudents,
  setReportCardHoldFromStage,
  type HoldCheck,
} from "@/lib/holds";
import {
  StudentAvatar,
  StudentNameLabel,
} from "@/components/students/StudentAvatar";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import { ModuleDashboardHost } from "@/components/dashboard/ModuleDashboardHost";
import { useDemoSession } from "@/components/shell/SessionContext";
import {
  HoldStatusBanner,
  PrincipalHoldOverrideDialog,
} from "@/components/fees/PrincipalHoldOverrideDialog";
import {
  ReportCardSheet,
  printReportCard,
} from "@/components/exams/ReportCardSheet";
import {
  ClassResultSheetView,
  printClassResultSheet,
} from "@/components/exams/ClassResultSheet";
import { useHoldDecisions } from "@/lib/useHoldDecisions";
import { ExamDateSheetPanel } from "@/components/exams/ExamDateSheetPanel";
import { InvigilationPanel } from "@/components/exams/InvigilationPanel";
import { ExamPapersPanel } from "@/components/exams/ExamPapersPanel";
import { AdmitCardsPanel } from "@/components/exams/AdmitCardsPanel";
import { RemarksPanel } from "@/components/exams/RemarksPanel";
import { ItemScoresPanel } from "@/components/exams/ItemScoresPanel";
import { AtRiskPanel } from "@/components/exams/AtRiskPanel";
import { ExamReportsRunner } from "@/components/reports/ModuleReportRunners";
import { hasPermission, inferRoleCodes } from "@/lib/rbac";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";

type Tab =
  | "dashboard"
  | "marks"
  | "items"
  | "atrisk"
  | "remarks"
  | "datesheet"
  | "invigilation"
  | "papers"
  | "admitcards"
  | "reports"
  | "results"
  | "result_reports"
  | "setup";

function cellKey(studentId: string, subjectId: string, component = "") {
  return `${studentId}:${subjectId}:${component}`;
}

/** One column of the marks grid: a subject, or one component of it. */
type GridColumn = { subject: ExamSubject; component: SchemeComponent | null };

function columnKey(col: GridColumn): string {
  return `${col.subject.id}:${col.component?.code ?? ""}`;
}

type MarkRowProps = {
  student: SisStudent;
  /** Passed down so the name label does not re-read the SIS blob per row. */
  sis: SisState | undefined;
  columns: GridColumn[];
  term: ExamTerm;
  /** columnKey → what the cell shows: the mark, or the picked grade. */
  values: Record<string, string>;
  /** Exam-subject ids on this student's curriculum. */
  takes: Set<string> | undefined;
  locked: boolean;
  /** "marks": numeric inputs. "grades": a grade picker per column (grade-only / descriptor schemes). */
  entryMode: "marks" | "grades";
  grades: GradeBand[];
  areas: CoScholasticArea[];
  /** domain → rating ("" for unrated). */
  ratings: Record<string, string>;
  /** Recorded absent from this exam; marks are then not entered. */
  absent: boolean;
  absentReason: string;
  onAbsent: (studentId: string, absent: boolean) => void;
  onAbsentReason: (studentId: string, reason: string) => void;
  onMark: (studentId: string, subjectId: string, component: string, value: string) => void;
  onGrade: (studentId: string, subjectId: string, component: string, grade: string) => void;
  onRating: (studentId: string, domain: CoScholasticDomain, value: string) => void;
};

/**
 * One student's row of the marks grid.
 *
 * Memoised on purpose: a keystroke changes ONE cell, and the row's props for
 * every other student are referentially the same (the parent keeps a
 * per-student values object stable while its contents are unchanged), so
 * only the edited row re-renders. Before this the whole 2,000-line
 * workspace re-rendered every cell on every keystroke and, worse, asked the
 * subject resolver per cell — see subjectTakeMap.
 */
const MarkRow = memo(function MarkRow({
  student: st,
  sis,
  columns,
  term,
  values,
  takes,
  locked,
  entryMode,
  grades,
  areas,
  ratings,
  absent,
  absentReason,
  onAbsent,
  onAbsentReason,
  onMark,
  onGrade,
  onRating,
}: MarkRowProps) {
  return (
    <tr className="border-b border-[var(--border)]">
      <td className="sticky left-0 z-10 bg-[var(--card)] px-3 py-1.5">
        <div className="flex items-center gap-2">
          <StudentAvatar student={st} size={28} />
          <div className="min-w-0">
            <div className="truncate font-medium text-[var(--brand-deep)]">
              <StudentNameLabel student={st} sis={sis} />
            </div>
            <div className="text-[10px] text-[var(--muted)]">
              {st.admissionNo}
              {st.rollNo ? ` · Roll ${st.rollNo}` : ""}
            </div>
            <label className="mt-1 flex items-center gap-1.5 text-[11px] text-[var(--muted)]">
              <input
                type="checkbox"
                checked={absent}
                disabled={locked}
                onChange={(e) => onAbsent(st.id, e.target.checked)}
                aria-label={`${st.fullName} absent in this exam`}
              />
              <span className={absent ? "font-semibold text-[var(--danger)]" : ""}>
                {absent ? "Absent" : "Present"}
              </span>
              {absent ? (
                <input
                  className="field !w-36 !px-1.5 !py-0.5 text-[11px]"
                  value={absentReason}
                  disabled={locked}
                  placeholder="Reason (optional)"
                  maxLength={200}
                  onChange={(e) => onAbsentReason(st.id, e.target.value)}
                  aria-label={`${st.fullName} reason for absence`}
                />
              ) : null}
            </label>
          </div>
        </div>
      </td>
      {columns.map((col) => {
        const sub = col.subject;
        const code = col.component?.code ?? "";
        const key = columnKey(col);
        const takesIt = takes ? takes.has(sub.id) : true;
        const max = col.component ? col.component.maxMarks : effectiveMaxMarks(term, sub);
        const name = col.component ? `${sub.name} ${col.component.label}` : sub.name;
        return (
          <td key={cellKey(st.id, sub.id, code)} className="px-1 py-1">
            {absent ? (
              <span
                className="block w-14 px-1 py-1 text-center text-[11px] font-semibold text-[var(--danger)]"
                title="Absent in this exam"
              >
                AB
              </span>
            ) : !takesIt ? (
              <span
                className="block w-14 px-1 py-1 text-center text-[10px] text-[var(--muted)]"
                title="Not on this student's curriculum"
              >
                —
              </span>
            ) : entryMode === "grades" ? (
              <select
                className="field !w-16 !px-1 !py-1 text-center"
                disabled={locked}
                value={values[key] ?? ""}
                onChange={(e) => onGrade(st.id, sub.id, code, e.target.value)}
                aria-label={`${st.fullName} ${name}`}
              >
                <option value="">—</option>
                {grades.map((g) => (
                  <option key={g.grade} value={g.grade} title={g.label}>
                    {g.grade}
                  </option>
                ))}
              </select>
            ) : (
              <input
                className="field !w-14 !px-1 !py-1 text-center tabular-nums"
                inputMode="decimal"
                disabled={locked}
                value={values[key] ?? ""}
                onChange={(e) => onMark(st.id, sub.id, code, e.target.value)}
                aria-label={`${st.fullName} ${name}`}
                title={`out of ${max}`}
              />
            )}
          </td>
        );
      })}
      {areas.map((area) => (
        <td key={`${st.id}:${area.code}`} className="px-1 py-1">
          <select
            className="field !w-16 !px-1 !py-1 text-center"
            disabled={locked}
            value={ratings[area.code] ?? ""}
            onChange={(e) => onRating(st.id, area.code, e.target.value)}
            aria-label={`${st.fullName} ${coScholasticDomainLabel(area.code, areas)}`}
          >
            <option value="">—</option>
            <option value="A">A</option>
            <option value="B">B</option>
            <option value="C">C</option>
          </select>
        </td>
      ))}
    </tr>
  );
});

/**
 * Per-student objects that keep their identity while their contents are
 * unchanged, so MarkRow's memo holds for every row but the one being typed
 * in. Cheap: one string per student per render.
 */
function useStableByStudent<T extends Record<string, string>>(
  roster: SisStudent[],
  build: (st: SisStudent) => T,
  deps: unknown[],
): Map<string, T> {
  const cache = useRef(new Map<string, { sig: string; value: T }>());
  return useMemo(() => {
    const out = new Map<string, T>();
    for (const st of roster) {
      const value = build(st);
      const sig = Object.keys(value)
        .sort()
        .map((k) => `${k}=${value[k]}`)
        .join("|");
      const prev = cache.current.get(st.id);
      if (prev && prev.sig === sig) {
        out.set(st.id, prev.value);
      } else {
        cache.current.set(st.id, { sig, value });
        out.set(st.id, value);
      }
    }
    return out;
    // `deps` is the caller's own list; `build` and `roster` are covered by it.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, deps);
}

function ConflictNotice({
  conflicts,
  onDismiss,
}: {
  conflicts: SheetConflict[];
  onDismiss: (sheetId: string) => void;
}) {
  if (conflicts.length === 0) return null;
  return (
    <div
      role="alert"
      className="mt-4 rounded-xl border border-[var(--warning)]/50 bg-[var(--warning-soft)] p-4 text-sm"
    >
      <p className="font-semibold text-[var(--ink)]">
        {conflicts.length === 1
          ? "One save was refused by the server"
          : `${conflicts.length} saves were refused by the server`}
      </p>
      <ul className="mt-2 space-y-2">
        {conflicts.map((c) => (
          <li key={c.sheetId} className="flex flex-wrap items-start justify-between gap-2">
            <span className="text-[var(--ink)]">
              {c.error}
              <span className="block text-xs text-[var(--muted)]">
                Your copy of that sheet ({c.sheet.marks.filter((m) => m.marksObtained != null).length} marks) is kept in this browser until you dismiss this.
              </span>
            </span>
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-2 py-1 text-xs font-semibold"
              onClick={() => onDismiss(c.sheetId)}
            >
              Dismiss
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

const UNLOCK_ROLES = new Set(["owner", "principal", "admin", "office"]);

export function ExamsWorkspace() {
  // Fee holds are server truth. Without this the gates below read an
  // unloaded snapshot and every child looks allowed.
  useHoldDecisions();
  const session = useDemoSession();
  const [tab, setTab] = useState<Tab>("dashboard");
  const [masters, setMasters] = useState<MastersState | null>(() =>
    typeof window !== "undefined" ? loadMasters() : null,
  );
  const [sis, setSis] = useState<SisState | null>(() =>
    typeof window !== "undefined" ? loadSis() : null,
  );
  const [classId, setClassId] = useState("");
  const [sectionId, setSectionId] = useState("");
  const [examTermId, setExamTermId] = useState("");
  const [grid, setGrid] = useState<StudentSubjectMark[]>([]);
  const [coScholasticGrid, setCoScholasticGrid] = useState<StudentCoScholasticEntry[]>([]);
  /** studentId → reason, for students marked absent in this exam. */
  const [absences, setAbsences] = useState<Map<string, string>>(new Map());
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [reportStudentId, setReportStudentId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReportCard | null>(null);
  const [holdCheck, setHoldCheck] = useState<HoldCheck | null>(null);
  const [holdDialog, setHoldDialog] = useState(false);
  const [conflicts, setConflicts] = useState<SheetConflict[]>([]);

  const [newCode, setNewCode] = useState("UT3");
  const [newLabel, setNewLabel] = useState("Unit Test 3");
  const [newMax, setNewMax] = useState("40");
  const [newStart, setNewStart] = useState("");
  const [newEnd, setNewEnd] = useState("");
  const [newNote, setNewNote] = useState("");
  const [newCountsHy, setNewCountsHy] = useState(true);
  const [newCountsFinal, setNewCountsFinal] = useState(true);
  const [newWeightHy, setNewWeightHy] = useState("20");
  const [newWeightFinal, setNewWeightFinal] = useState("20");
  const [newRequiredMs, setNewRequiredMs] = useState(true);
  const [newSeparateMs, setNewSeparateMs] = useState(true);
  const [policyDraft, setPolicyDraft] = useState<ExamPolicy | null>(null);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [editCode, setEditCode] = useState("");
  const [editLabel, setEditLabel] = useState("");
  const [editMax, setEditMax] = useState("");
  const [editStart, setEditStart] = useState("");
  const [editEnd, setEditEnd] = useState("");
  const [editNote, setEditNote] = useState("");
  const [editCountsHy, setEditCountsHy] = useState(true);
  const [editCountsFinal, setEditCountsFinal] = useState(true);
  const [editWeightHy, setEditWeightHy] = useState("0");
  const [editWeightFinal, setEditWeightFinal] = useState("0");
  const [editRequiredMs, setEditRequiredMs] = useState(true);
  const [editSeparateMs, setEditSeparateMs] = useState(true);

  const ay = session.academicYearCode || DEFAULT_AY;

  function refresh() {
    setMasters(loadMasters());
    setSis(loadSis());
    const p = getExamPolicy();
    setPolicyDraft(p);
    setReportCardHoldFromStage(p.reportCardHoldFromStage);
    setConflicts(examSheetConflicts());
    setTick((x) => x + 1);
  }

  // A refused save is recorded by the push, which runs after the click
  // handler returns; pick it up when the sync status changes.
  useEffect(() => {
    if (typeof window === "undefined") return;
    const onFailed = () => setConflicts(examSheetConflicts());
    window.addEventListener("bhb-desk-sync-failed", onFailed);
    return () => window.removeEventListener("bhb-desk-sync-failed", onFailed);
  }, []);

  useEffect(() => {
    // Paint immediately from localStorage, then refresh after remote hydrate
    refresh();
    void (async () => {
      const [{ ensureSisHydrated }, { ensureExamsHydrated }, { withHydrationSlot }] =
        await Promise.all([
          import("@/lib/sisPersistence"),
          import("@/lib/examsPersistence"),
          import("@/lib/deskHydrateGuard"),
        ]);
      await Promise.all([
        withHydrationSlot(() => ensureSisHydrated()),
        withHydrationSlot(() => ensureExamsHydrated()),
      ]);
      refresh();
    })();
  }, []);

  /**
   * ONE parse of the exams blob per change, shared by everything below.
   * Every reader in lib/exams falls back to loadExams() when not given a
   * state, and the grid used to hit that fallback per cell per render.
   */
  const exams = useMemo(() => {
    void tick;
    return loadExams();
  }, [tick]);

  /** Stores already in hand, for the readers that loop over students. */
  const examDeps = useMemo<ExamDeps>(
    () => ({
      state: exams,
      masters: masters ?? undefined,
      sis: sis ?? undefined,
    }),
    [exams, masters, sis],
  );

  const terms = useMemo(() => listExamTerms(ay, exams), [ay, exams]);

  const allTerms = useMemo(() => listAllExamTerms(ay, exams), [ay, exams]);

  useEffect(() => {
    if (!examTermId && terms[0]) setExamTermId(terms[0].id);
    if (examTermId && !terms.some((t) => t.id === examTermId) && terms[0]) {
      setExamTermId(terms[0].id);
    }
  }, [terms, examTermId]);

  const classOptions = useMemo(() => {
    if (!masters) return [];
    // Treat missing isActive as active (legacy rows)
    const active = masters.classes.filter((c) => c.isActive !== false);
    return active.length > 0 ? active : masters.classes;
  }, [masters]);

  const sectionOptions = useMemo(() => {
    if (!masters || !classId) return [];
    const forClass = masters.sections.filter((s) => s.classId === classId);
    const active = forClass.filter((s) => s.isActive !== false);
    return active.length > 0 ? active : forClass;
  }, [masters, classId]);

  useEffect(() => {
    if (!sectionId) return;
    if (!sectionOptions.some((s) => s.id === sectionId)) setSectionId("");
  }, [sectionId, sectionOptions]);

  const term = terms.find((t) => t.id === examTermId) ?? null;
  const policy = policyDraft ?? getExamPolicy(exams);

  const roster = useMemo(() => {
    if (!sis || !sectionId) return [];
    return rosterForSection(sis.students, sectionId, {
      classId: classId || undefined,
      academicYearCode: ay,
    });
  }, [sis, sectionId, classId, ay, tick]);

  const subjects = useMemo(() => {
    if (!classId) return [];
    return subjectsForMarkEntry(classId, roster, exams, examDeps);
  }, [classId, roster, exams, examDeps]);

  /** How this class is assessed — the school's scheme for it. */
  const scheme = useMemo<AssessmentScheme | null>(
    () => (classId ? schemeForClassId(classId, policy) : null),
    [classId, policy],
  );
  const entryMode: "marks" | "grades" =
    scheme && scheme.displayMode !== "marks_grade" ? "grades" : "marks";
  const gradeChoices = useMemo(() => (scheme ? pickableGrades(scheme) : []), [scheme]);
  const areas = useMemo<CoScholasticArea[]>(
    () => (classId ? coScholasticAreasForClass(classId, policy) : []),
    [classId, policy],
  );
  /** Subject × component columns for the current exam. */
  const columns = useMemo<GridColumn[]>(() => {
    if (!term) return [];
    const parts = scheme ? componentsForTerm(scheme, term.code) : [];
    const out: GridColumn[] = [];
    for (const subject of subjects) {
      if (parts.length === 0) out.push({ subject, component: null });
      else for (const component of parts) out.push({ subject, component });
    }
    return out;
  }, [subjects, scheme, term]);

  /** studentId → exam-subject ids on that child's curriculum, resolved once
   * for the section. The grid, setMark and onSave all read this. */
  const takesBy = useMemo(
    () => subjectTakeMap(roster, subjects, exams, examDeps),
    [roster, subjects, exams, examDeps],
  );

  const gridIndex = useMemo(() => {
    const m = new Map<string, StudentSubjectMark>();
    for (const c of grid) m.set(cellKey(c.studentId, c.subjectId, c.component), c);
    return m;
  }, [grid]);

  const valuesByStudent = useStableByStudent(
    roster,
    (st) => {
      const values: Record<string, string> = {};
      for (const col of columns) {
        const c = gridIndex.get(cellKey(st.id, col.subject.id, col.component?.code ?? ""));
        values[columnKey(col)] =
          entryMode === "grades"
            ? c?.grade && c.grade !== "—"
              ? c.grade
              : ""
            : c?.marksObtained == null
              ? ""
              : String(c.marksObtained);
      }
      return values;
    },
    [roster, columns, gridIndex, entryMode],
  );

  const ratingsByStudent = useStableByStudent(
    roster,
    (st) => {
      const ratings: Record<string, string> = {};
      for (const e of coScholasticGrid) {
        if (e.studentId === st.id) ratings[e.domain] = e.rating ?? "";
      }
      return ratings;
    },
    [roster, coScholasticGrid],
  );

  useEffect(() => {
    if (!term || !sectionId || !classId) {
      setGrid([]);
      setDirty(false);
      return;
    }
    const existing = findMarkSheet(ay, term.id, sectionId, exams);
    setGrid(
      buildEmptyMarksGrid(
        roster,
        subjects,
        term,
        existing,
        policy.passPercent,
        scheme ?? undefined,
      ),
    );
    setCoScholasticGrid(buildEmptyCoScholasticGrid(roster, existing, areas));
    setAbsences(new Map((existing?.absences ?? []).map((a) => [a.studentId, a.reason])));
    setDirty(false);
    // `exams` is deliberately not a dependency: a save bumps it, and
    // rebuilding the grid from the saved sheet then would be a no-op that
    // also discards anything typed between clicking Save and the re-render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ay, term?.id, sectionId, classId, roster, subjects, policy.passPercent, scheme, areas]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  const setMark = useCallback(
    (studentId: string, subjectId: string, component: string, value: string) => {
      if (!term) return;
      const col = columns.find(
        (c) => c.subject.id === subjectId && (c.component?.code ?? "") === component,
      );
      if (!col) return;
      const takes = takesBy.get(studentId);
      if (takes && !takes.has(subjectId)) return;
      const max = col.component ? col.component.maxMarks : effectiveMaxMarks(term, col.subject);
      let obtained: number | null = null;
      if (value.trim() !== "") {
        const n = Number(value);
        if (!Number.isFinite(n)) return;
        obtained = Math.min(max, Math.max(0, n));
      }
      setGrid((prev) =>
        prev.map((m) =>
          m.studentId === studentId && m.subjectId === subjectId && m.component === component
            ? { ...m, marksObtained: obtained }
            : m,
        ),
      );
      setDirty(true);
    },
    [term, columns, takesBy],
  );

  const setAbsent = useCallback((studentId: string, absent: boolean) => {
    setAbsences((prev) => {
      const next = new Map(prev);
      if (absent) next.set(studentId, prev.get(studentId) ?? "");
      else next.delete(studentId);
      return next;
    });
    setDirty(true);
  }, []);

  const setAbsentReason = useCallback((studentId: string, reason: string) => {
    setAbsences((prev) => {
      if (!prev.has(studentId)) return prev;
      const next = new Map(prev);
      next.set(studentId, reason);
      return next;
    });
    setDirty(true);
  }, []);

  /** Grade-only / descriptor schemes: the teacher picks the grade; no number. */
  const setGrade = useCallback(
    (studentId: string, subjectId: string, component: string, grade: string) => {
      const takes = takesBy.get(studentId);
      if (takes && !takes.has(subjectId)) return;
      setGrid((prev) =>
        prev.map((m) =>
          m.studentId === studentId && m.subjectId === subjectId && m.component === component
            ? { ...m, marksObtained: null, grade: grade || "—" }
            : m,
        ),
      );
      setDirty(true);
    },
    [takesBy],
  );

  const setCoScholasticRating = useCallback(
    (studentId: string, domain: CoScholasticDomain, value: string) => {
      const rating: CoScholasticRating | null =
        value === "A" || value === "B" || value === "C" ? value : null;
      setCoScholasticGrid((prev) =>
        prev.map((e) =>
          e.studentId === studentId && e.domain === domain
            ? { ...e, rating }
            : e,
        ),
      );
      setDirty(true);
    },
    [],
  );

  function onSave(lock = false) {
    if (!term || !classId || !sectionId) {
      setError("Select exam, class and section");
      return;
    }
    // Drop marks for subjects the student does not take
    const marks = grid.map((m) => {
      if (absences.has(m.studentId)) {
        return { ...m, marksObtained: null, grade: "AB" };
      }
      const takes = takesBy.get(m.studentId);
      if (takes && !takes.has(m.subjectId)) {
        return { ...m, marksObtained: null, grade: "—" };
      }
      return m;
    });
    const result = saveMarkSheet({
      academicYearCode: ay,
      examTermId: term.id,
      classId,
      sectionId,
      marks,
      coScholastic: areas.length > 0 ? coScholasticGrid : undefined,
      absences: [...absences.entries()].map(([studentId, reason]) => ({ studentId, reason })),
      enteredBy: session.fullName,
      lock,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setDirty(false);
    refresh();
    flash(
      lock
        ? "Mark sheet saved and locked · sending to the server"
        : `Marks saved · ${roster.length} students · sending to the server`,
    );
  }

  const canUnlock = useMemo(() => {
    if (!masters) return false;
    try {
      if (hasPermission(session, masters, "exams", "approve")) return true;
      return inferRoleCodes(session, masters).some((c) => UNLOCK_ROLES.has(c));
    } catch {
      return false;
    }
  }, [session, masters]);

  function onUnlock() {
    if (!term || !sectionId) return;
    const reason = window.prompt(
      "Why is this mark sheet being unlocked? (recorded in the audit log)",
      "",
    );
    if (reason === null) return;
    const result = unlockMarkSheet({
      academicYearCode: ay,
      examTermId: term.id,
      sectionId,
      reason,
      by: session.fullName,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
    flash("Mark sheet unlocked · sending to the server");
  }

  async function retrySync(): Promise<boolean> {
    const ok = await retryPendingExamSheets();
    const { scheduleExamsSync } = await import("@/lib/examsPersistence");
    scheduleExamsSync(loadExams());
    refresh();
    return ok;
  }

  function classLabelOf(studentId: string): string {
    if (!masters || !sis) return "—";
    const st = sis.students.find((s) => s.id === studentId);
    if (!st) return "—";
    const c = masters.classes.find((x) => x.id === st.classId)?.name ?? "—";
    const sec =
      masters.sections.find((x) => x.id === st.sectionId)?.name ?? "";
    return sec ? `${c}-${sec}` : c;
  }

  function openReport(studentId: string) {
    setError(null);
    const st = sis?.students.find((s) => s.id === studentId);
    if (!st || !examTermId) {
      setError("Pick exam and student");
      return;
    }
    const hold = checkHold(studentId, "HOLD_REPORT_CARD");
    setHoldCheck(hold);
    setReportStudentId(studentId);
    if (!hold.allowed) {
      setPreview(null);
      setHoldDialog(true);
      return;
    }
    const studentScheme = schemeForClassId(st.classId, policy);
    let card: ReportCard | { error: string };
    if (
      studentScheme.showRank ||
      studentScheme.showClassAverage ||
      studentScheme.showResultOnCard
    ) {
      // Rank and average need the whole section; the result comes from the
      // recorded decision. buildClassResultSheet fills all three.
      const sheet = buildClassResultSheet({
        students: rosterForSection(sis?.students ?? [], st.sectionId, {
          classId: st.classId,
          academicYearCode: ay,
        }),
        classLabel: classLabelOf(studentId),
        classId: st.classId,
        sectionId: st.sectionId,
        examTermId,
        academicYearCode: ay,
        deps: { ...examDeps, attendance: loadAttendance() },
      });
      if ("error" in sheet) {
        card = { error: sheet.error };
      } else {
        const row = sheet.rows.find((r) => r.student.id === studentId);
        card = row?.card ?? { error: row?.error || "No marks for this student" };
      }
    } else {
      card = buildReportCard({
        student: st,
        classLabel: classLabelOf(studentId),
        examTermId,
        academicYearCode: ay,
        deps: { ...examDeps, holdChecks: new Map([[studentId, hold]]) },
      });
    }
    if ("error" in card) {
      setError(card.error);
      setPreview(null);
      return;
    }
    setPreview(card);
  }

  function retryReportAfterUnlock() {
    if (!reportStudentId) return;
    setHoldDialog(false);
    const hold = checkHold(reportStudentId, "HOLD_REPORT_CARD");
    setHoldCheck(hold);
    if (!hold.allowed) return;
    openReport(reportStudentId);
    flash("Report card hold unlocked");
  }

  function onCreateExam() {
    setError(null);
    const result = createExamTerm({
      code: newCode,
      label: newLabel,
      academicYearCode: ay,
      maxMarks: Number(newMax) || policy.defaultUtMaxMarks,
      startsOn: newStart,
      endsOn: newEnd,
      note: newNote,
      countsTowardHy: newCountsHy,
      countsTowardFinal: newCountsFinal,
      weightInHy: Number(newWeightHy) || 0,
      weightInFinal: Number(newWeightFinal) || 0,
      requiredOnMarksheet: newRequiredMs,
      requiresSeparateMarksheet: newSeparateMs,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setExamTermId(result.term.id);
    setNewCode("");
    setNewLabel("");
    setNewMax(String(policy.defaultUtMaxMarks));
    setNewStart("");
    setNewEnd("");
    setNewNote("");
    setNewCountsHy(policy.defaultCountsTowardHy);
    setNewCountsFinal(policy.defaultCountsTowardFinal);
    setNewWeightHy(String(policy.defaultWeightInHy));
    setNewWeightFinal(String(policy.defaultWeightInFinal));
    setNewRequiredMs(policy.defaultRequiredOnMarksheet);
    setNewSeparateMs(policy.defaultRequiresSeparateMarksheet);
    refresh();
    flash(`Created exam ${result.term.code} · ${result.term.label}`);
    setTab("marks");
  }

  function onSavePolicy() {
    if (!policyDraft) return;
    const result = saveExamPolicy(policyDraft);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setPolicyDraft(result.policy);
    refresh();
    const n = result.updatedExamIds.length;
    flash(
      n > 0
        ? `Policy saved · updated max marks on ${n} exam${n === 1 ? "" : "s"} (no student marks yet)`
        : "Exam policy saved",
    );
  }

  function startEdit(t: ExamTerm) {
    setEditingId(t.id);
    setEditCode(t.code);
    setEditLabel(t.label);
    setEditMax(String(t.maxMarks));
    setEditStart(t.startsOn);
    setEditEnd(t.endsOn);
    setEditNote(t.note);
    setEditCountsHy(t.countsTowardHy);
    setEditCountsFinal(t.countsTowardFinal);
    setEditWeightHy(String(t.weightInHy));
    setEditWeightFinal(String(t.weightInFinal));
    setEditRequiredMs(t.requiredOnMarksheet);
    setEditSeparateMs(t.requiresSeparateMarksheet);
    setError(null);
    if (examHasPersistedStudentData(t.id)) {
      setNotice(
        "Code/max marks locked (marks exist). Aggregate & marksheet flags can still be changed.",
      );
      window.setTimeout(() => setNotice(null), 3200);
    }
  }

  function cancelEdit() {
    setEditingId(null);
  }

  function saveEdit() {
    if (!editingId) return;
    const hasData = examHasPersistedStudentData(editingId);
    const result = updateExamTerm(editingId, {
      label: editLabel,
      startsOn: editStart,
      endsOn: editEnd,
      note: editNote,
      ...(hasData
        ? {}
        : {
            code: editCode,
            maxMarks: Number(editMax) || 40,
          }),
      countsTowardHy: editCountsHy,
      countsTowardFinal: editCountsFinal,
      weightInHy: Number(editWeightHy) || 0,
      weightInFinal: Number(editWeightFinal) || 0,
      requiredOnMarksheet: editRequiredMs,
      requiresSeparateMarksheet: editSeparateMs,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    setEditingId(null);
    refresh();
    flash(`Updated ${result.term.code}`);
  }

  function onDeleteExam(t: ExamTerm) {
    if (examHasPersistedStudentData(t.id)) {
      setError("Cannot delete — student marks exist. Deactivate instead.");
      return;
    }
    if (
      !window.confirm(
        `Delete exam ${t.code} · ${t.label}? This cannot be undone.`,
      )
    ) {
      return;
    }
    const result = deleteExamTerm(t.id);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    if (examTermId === t.id) setExamTermId("");
    if (editingId === t.id) setEditingId(null);
    refresh();
    flash(`Deleted ${t.code}`);
  }

  function onToggleActive(t: ExamTerm) {
    if (t.isActive) {
      const r = deactivateExamTerm(t.id);
      if (!r.ok) {
        setError(r.error);
        return;
      }
      flash(`${t.code} deactivated`);
    } else {
      const r = updateExamTerm(t.id, { isActive: true });
      if (!r.ok) {
        setError(r.error);
        return;
      }
      flash(`${t.code} activated`);
    }
    refresh();
  }

  const sheetMeta = useMemo(() => {
    if (!examTermId || !sectionId) return null;
    return findMarkSheet(ay, examTermId, sectionId, exams);
  }, [ay, examTermId, sectionId, exams]);

  /** Fee-hold verdicts for the section, computed once per roster change
   * instead of once per child per render on the report-card list. */
  const reportHolds = useMemo(() => {
    void tick;
    if (tab !== "reports" || roster.length === 0) return new Map<string, HoldCheck>();
    return checkHoldsForStudents(
      roster.map((s) => s.id),
      "HOLD_REPORT_CARD",
    );
  }, [tab, roster, tick]);

  const classLabel = useMemo(() => {
    const c = classOptions.find((x) => x.id === classId)?.name ?? "—";
    const s = sectionOptions.find((x) => x.id === sectionId)?.name ?? "";
    return s ? `${c}-${s}` : c;
  }, [classOptions, sectionOptions, classId, sectionId]);

  const classResult = useMemo(() => {
    void tick;
    if (tab !== "results" || !examTermId || !classId || !sectionId) {
      return null;
    }
    const built = buildClassResultSheet({
      students: roster,
      classLabel,
      classId,
      sectionId,
      examTermId,
      academicYearCode: ay,
      deps: { ...examDeps, attendance: loadAttendance() },
    });
    if ("error" in built) return { error: built.error } as const;
    return { sheet: built } as const;
  }, [tab, tick, examTermId, classId, sectionId, roster, classLabel, ay, examDeps]);

  // The result sheet, best first; grade and pass sort too. Decision is a picker, not a value.
  const resultSort = useTableSort(
    classResult?.sheet?.rows ?? [],
    {
      percent: (row) => row.card ? row.card.percent : -1,
      grade: (row) => row.card?.overallGrade ?? "",
    },
    "percent",
    "desc",
  );

  function onSuggestPromotions() {
    if (!examTermId || !classId || !sectionId) {
      setError("Select exam, class and section");
      return;
    }
    const result = suggestPromotionsForSection({
      students: roster,
      classLabel,
      classId,
      sectionId,
      examTermId,
      academicYearCode: ay,
      decidedBy: session.fullName,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
    flash(
      `Suggested decisions for ${result.updated} student${result.updated === 1 ? "" : "s"}${
        result.skipped ? ` · ${result.skipped} skipped` : ""
      }`,
    );
  }

  function onSetDecision(row: ClassResultRow, decision: PromotionDecision) {
    if (!examTermId || !classId || !sectionId) return;
    const result = savePromotionDecision({
      studentId: row.student.id,
      examTermId,
      academicYearCode: ay,
      fromClassId: classId,
      fromSectionId: sectionId,
      decision,
      toClassId: row.nextClass?.id,
      toSectionId: row.nextSection?.id,
      percent: row.card?.percent,
      overallGrade: row.card?.overallGrade,
      passed: row.passed,
      decidedBy: session.fullName,
      remark:
        decision === "detained" && row.failedSubjects.length
          ? `Below pass: ${row.failedSubjects.join(", ")}`
          : row.record?.remark ?? "",
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
    flash(`${row.student.fullName}: ${promotionDecisionLabel(decision)}`);
  }

  function onApplyPromotions() {
    if (!examTermId || !sectionId) return;
    if (
      !window.confirm(
        "Move all promoted students in this section to their next class in SIS? This updates class, section, and fee group.",
      )
    ) {
      return;
    }
    const result = applyPromotionsToSis({
      examTermId,
      sectionId,
      academicYearCode: ay,
    });
    if (!result.ok) {
      setError(result.error);
      return;
    }
    refresh();
    flash(
      `Applied ${result.applied} promotion${result.applied === 1 ? "" : "s"} to SIS${
        result.skipped ? ` · ${result.skipped} skipped` : ""
      }`,
    );
    if (result.errors.length) setError(result.errors.join("; "));
  }

  return (
    <ErpWorkspaceShell
      title="Exams / report cards"
      subtitle={
        <>
          Marks · report cards · promote / detain · result sheet (hold from{" "}
          {policy.reportCardHoldFromStage})
        </>
      }
      icon={<ClipboardList className="size-6" aria-hidden />}
      error={error}
      notice={notice}
    >
      <ModuleTabs
        aria-label="Exams sections"
        value={tab}
        onChange={(id) => setTab(id as Tab)}
        items={[
          { id: "dashboard", label: "Dashboard", tone: "navy" },
          { id: "marks", label: "Mark entry", tone: "sky" },
          { id: "items", label: "Item scores", tone: "sky" },
          { id: "atrisk", label: "At-risk", tone: "coral" },
          { id: "remarks", label: "Remarks", tone: "teal" },
          { id: "datesheet", label: "Date-sheet", tone: "violet" },
          { id: "invigilation", label: "Invigilation", tone: "coral" },
          { id: "papers", label: "Question papers", tone: "rose" },
          { id: "admitcards", label: "Admit cards", tone: "sky" },
          { id: "reports", label: "Report cards", tone: "amber" },
          { id: "results", label: "Results", tone: "green" },
          { id: "result_reports", label: "Result reports", tone: "teal" },
          { id: "setup", label: "Exams & policy", tone: "navy" },
        ]}
      />

      <DeskSyncBanner
        module="exams"
        title="Your exam marks are not saved on the server"
        onRetry={retrySync}
      />
      <ConflictNotice
        conflicts={conflicts}
        onDismiss={(id) => {
          clearExamSheetConflict(id);
          setConflicts(examSheetConflicts());
        }}
      />

      {tab !== "setup" &&
      tab !== "dashboard" &&
      tab !== "datesheet" &&
      tab !== "invigilation" &&
      tab !== "papers" &&
      tab !== "admitcards" ? (
        <div className="mt-4 grid gap-3 sm:grid-cols-3">
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Exam
            </span>
            <select
              className="field !py-1.5"
              value={examTermId}
              onChange={(e) => setExamTermId(e.target.value)}
            >
              {terms.map((t) => (
                <option key={t.id} value={t.id}>
                  {t.code} · {t.label} (max {t.maxMarks})
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Class
            </span>
            <select
              className="field !py-1.5"
              value={classId}
              onChange={(e) => {
                setClassId(e.target.value);
                setSectionId("");
              }}
            >
              <option value="">
                {!masters
                  ? "Loading classes…"
                  : classOptions.length === 0
                    ? "No classes in Masters"
                    : "Select class"}
              </option>
              {classOptions.map((c) => (
                <option key={c.id} value={c.id}>
                  {c.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Section
            </span>
            <select
              className="field !py-1.5"
              value={sectionId}
              onChange={(e) => setSectionId(e.target.value)}
              disabled={!classId}
            >
              <option value="">Select section</option>
              {sectionOptions.map((s) => (
                <option key={s.id} value={s.id}>
                  {s.name}
                </option>
              ))}
            </select>
          </label>
        </div>
      ) : null}

      {tab === "datesheet" && masters ? (
        <ExamDateSheetPanel
          academicYearCode={ay}
          masters={masters}
          terms={terms}
          onChanged={refresh}
        />
      ) : null}

      {tab === "invigilation" && masters ? (
        <InvigilationPanel academicYearCode={ay} masters={masters} terms={terms} />
      ) : null}

      {tab === "admitcards" && masters ? (
        <AdmitCardsPanel academicYearCode={ay} masters={masters} terms={terms} />
      ) : null}

      {tab === "papers" && masters ? (
        <ExamPapersPanel
          masters={masters}
          academicYearCode={ay}
          terms={terms}
          canEdit={hasPermission(session, masters, "exams", "edit")}
          actorName={session.fullName || "Staff"}
          onError={setError}
          onNotice={(msg) => {
            setNotice(msg);
            setError(null);
            window.setTimeout(() => setNotice(null), 4000);
          }}
        />
      ) : null}

      {tab === "setup" ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-2">
          <AssessmentSchemesPanel
            policy={policy}
            masters={masters}
            terms={allTerms}
            onSaved={refresh}
            onFlash={flash}
            onError={setError}
          />
          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Create exam
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Add Unit Tests or term exams for session {ay}
            </p>
            <div className="mt-4 grid gap-3 sm:grid-cols-2">
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Code
                </span>
                <input
                  className="field !py-1.5 uppercase"
                  value={newCode}
                  onChange={(e) =>
                    setNewCode(
                      e.target.value.toUpperCase().replace(/\s+/g, ""),
                    )
                  }
                  placeholder="UT3"
                  maxLength={12}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Max marks
                </span>
                <input
                  className="field !py-1.5"
                  inputMode="numeric"
                  value={newMax}
                  onChange={(e) =>
                    setNewMax(e.target.value.replace(/\D/g, "").slice(0, 4))
                  }
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Name
                </span>
                <input
                  className="field !py-1.5"
                  value={newLabel}
                  onChange={(e) => setNewLabel(e.target.value)}
                  placeholder="Unit Test 3"
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Starts on
                </span>
                <input
                  type="date"
                  className="field !py-1.5"
                  value={newStart}
                  onChange={(e) => setNewStart(e.target.value)}
                />
              </label>
              <label className="block text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Ends on
                </span>
                <input
                  type="date"
                  className="field !py-1.5"
                  value={newEnd}
                  onChange={(e) => setNewEnd(e.target.value)}
                />
              </label>
              <label className="block text-sm sm:col-span-2">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Note
                </span>
                <input
                  className="field !py-1.5"
                  value={newNote}
                  onChange={(e) => setNewNote(e.target.value)}
                  placeholder="Optional"
                />
              </label>
            </div>
            <div className="mt-3 space-y-2 rounded-lg bg-[var(--surface)] p-3">
              <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                Aggregate &amp; marksheet
              </p>
              <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                <input
                  type="checkbox"
                  checked={newCountsHy}
                  onChange={(e) => setNewCountsHy(e.target.checked)}
                />
                Count toward Half-yearly aggregate
              </label>
              {newCountsHy ? (
                <label className="block text-sm pl-6">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Weight in HY
                  </span>
                  <input
                    className="field !py-1.5 max-w-[8rem]"
                    inputMode="numeric"
                    value={newWeightHy}
                    onChange={(e) =>
                      setNewWeightHy(
                        e.target.value.replace(/\D/g, "").slice(0, 3),
                      )
                    }
                  />
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                <input
                  type="checkbox"
                  checked={newCountsFinal}
                  onChange={(e) => setNewCountsFinal(e.target.checked)}
                />
                Count toward Final / Annual aggregate
              </label>
              {newCountsFinal ? (
                <label className="block text-sm pl-6">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Weight in Final
                  </span>
                  <input
                    className="field !py-1.5 max-w-[8rem]"
                    inputMode="numeric"
                    value={newWeightFinal}
                    onChange={(e) =>
                      setNewWeightFinal(
                        e.target.value.replace(/\D/g, "").slice(0, 3),
                      )
                    }
                  />
                </label>
              ) : null}
              <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                <input
                  type="checkbox"
                  checked={newRequiredMs}
                  onChange={(e) => setNewRequiredMs(e.target.checked)}
                />
                Required on consolidated marksheet
              </label>
              <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                <input
                  type="checkbox"
                  checked={newSeparateMs}
                  onChange={(e) => setNewSeparateMs(e.target.checked)}
                />
                Requires separate marksheet
              </label>
            </div>
            <div className="mt-3 flex flex-wrap gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold"
                onClick={() => {
                  setNewCode("UT3");
                  setNewLabel("Unit Test 3");
                  setNewMax(String(policy.defaultUtMaxMarks));
                  setNewCountsHy(true);
                  setNewCountsFinal(false);
                  setNewWeightHy("20");
                  setNewWeightFinal("0");
                  setNewRequiredMs(true);
                  setNewSeparateMs(true);
                }}
              >
                Prefill UT
              </button>
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold"
                onClick={() => {
                  setNewCode("PREBOARD");
                  setNewLabel("Pre-board");
                  setNewMax(String(policy.defaultTermMaxMarks));
                  setNewCountsHy(false);
                  setNewCountsFinal(true);
                  setNewWeightHy("0");
                  setNewWeightFinal("20");
                  setNewRequiredMs(true);
                  setNewSeparateMs(true);
                }}
              >
                Prefill Pre-board
              </button>
            </div>
            <button
              type="button"
              className="btn-accent mt-4 rounded-lg px-3 py-2 text-xs font-semibold"
              onClick={onCreateExam}
            >
              Create exam
            </button>

            <h3 className="mt-6 text-xs font-semibold uppercase tracking-wide text-[var(--muted)]">
              Session exams
            </h3>
            <ul className="mt-2 divide-y divide-[var(--border)]">
              {allTerms.map((t) => {
                const hasData = examHasPersistedStudentData(t.id);
                const isEditing = editingId === t.id;
                return (
                  <li key={t.id} className="py-2 text-sm">
                    {isEditing ? (
                      <div className="space-y-2 rounded-lg bg-[var(--surface)] p-3">
                        <div className="grid gap-2 sm:grid-cols-2">
                          <input
                            className="field !py-1 uppercase disabled:opacity-60"
                            value={editCode}
                            disabled={hasData}
                            onChange={(e) =>
                              setEditCode(
                                e.target.value
                                  .toUpperCase()
                                  .replace(/\s+/g, ""),
                              )
                            }
                            placeholder="Code"
                            maxLength={12}
                          />
                          <input
                            className="field !py-1 disabled:opacity-60"
                            value={editMax}
                            disabled={hasData}
                            onChange={(e) =>
                              setEditMax(
                                e.target.value.replace(/\D/g, "").slice(0, 4),
                              )
                            }
                            placeholder="Max marks"
                          />
                          <input
                            className="field !py-1 sm:col-span-2"
                            value={editLabel}
                            onChange={(e) => setEditLabel(e.target.value)}
                            placeholder="Name"
                          />
                          <input
                            type="date"
                            className="field !py-1"
                            value={editStart}
                            onChange={(e) => setEditStart(e.target.value)}
                          />
                          <input
                            type="date"
                            className="field !py-1"
                            value={editEnd}
                            onChange={(e) => setEditEnd(e.target.value)}
                          />
                          <input
                            className="field !py-1 sm:col-span-2"
                            value={editNote}
                            onChange={(e) => setEditNote(e.target.value)}
                            placeholder="Note"
                          />
                        </div>
                        <div className="space-y-2 border-t border-[var(--border)] pt-2">
                          <label className="flex items-center gap-2 text-xs text-[var(--brand-deep)]">
                            <input
                              type="checkbox"
                              checked={editCountsHy}
                              onChange={(e) =>
                                setEditCountsHy(e.target.checked)
                              }
                            />
                            Count toward HY
                            {editCountsHy ? (
                              <input
                                className="field !py-0.5 !w-14 ml-1"
                                value={editWeightHy}
                                onChange={(e) =>
                                  setEditWeightHy(
                                    e.target.value
                                      .replace(/\D/g, "")
                                      .slice(0, 3),
                                  )
                                }
                                title="Weight in HY"
                              />
                            ) : null}
                          </label>
                          <label className="flex items-center gap-2 text-xs text-[var(--brand-deep)]">
                            <input
                              type="checkbox"
                              checked={editCountsFinal}
                              onChange={(e) =>
                                setEditCountsFinal(e.target.checked)
                              }
                            />
                            Count toward Final
                            {editCountsFinal ? (
                              <input
                                className="field !py-0.5 !w-14 ml-1"
                                value={editWeightFinal}
                                onChange={(e) =>
                                  setEditWeightFinal(
                                    e.target.value
                                      .replace(/\D/g, "")
                                      .slice(0, 3),
                                  )
                                }
                                title="Weight in Final"
                              />
                            ) : null}
                          </label>
                          <label className="flex items-center gap-2 text-xs text-[var(--brand-deep)]">
                            <input
                              type="checkbox"
                              checked={editRequiredMs}
                              onChange={(e) =>
                                setEditRequiredMs(e.target.checked)
                              }
                            />
                            Required on marksheet
                          </label>
                          <label className="flex items-center gap-2 text-xs text-[var(--brand-deep)]">
                            <input
                              type="checkbox"
                              checked={editSeparateMs}
                              onChange={(e) =>
                                setEditSeparateMs(e.target.checked)
                              }
                            />
                            Separate marksheet required
                          </label>
                        </div>
                        <div className="flex flex-wrap gap-2">
                          <button
                            type="button"
                            className="btn-accent rounded-md px-2.5 py-1 text-[11px] font-semibold"
                            onClick={saveEdit}
                          >
                            Save
                          </button>
                          <button
                            type="button"
                            className="rounded-md border border-[var(--border)] px-2.5 py-1 text-[11px] font-semibold"
                            onClick={cancelEdit}
                          >
                            Cancel
                          </button>
                        </div>
                      </div>
                    ) : (
                      <div className="flex items-start justify-between gap-2">
                        <div className="min-w-0">
                          <div
                            className={`font-medium ${
                              t.isActive
                                ? "text-[var(--brand-deep)]"
                                : "text-[var(--muted)] line-through"
                            }`}
                          >
                            {t.code} · {t.label}
                          </div>
                          <div className="text-[11px] text-[var(--muted)]">
                            Max {t.maxMarks}
                            {t.startsOn ? ` · ${t.startsOn}` : ""}
                            {t.endsOn ? ` → ${t.endsOn}` : ""}
                            {hasData ? (
                              <span className="ml-1 font-semibold text-[var(--brand-mid)]">
                                · has marks
                              </span>
                            ) : (
                              <span className="ml-1">· no student data</span>
                            )}
                          </div>
                          <div className="mt-0.5 text-[10px] text-[var(--muted)]">
                            {[
                              t.countsTowardHy
                                ? `HY wt ${t.weightInHy}`
                                : null,
                              t.countsTowardFinal
                                ? `Final wt ${t.weightInFinal}`
                                : null,
                              t.requiredOnMarksheet ? "on marksheet" : null,
                              t.requiresSeparateMarksheet
                                ? "separate sheet"
                                : null,
                            ]
                              .filter(Boolean)
                              .join(" · ") || "Not in aggregates"}
                          </div>
                        </div>
                        <div className="flex shrink-0 flex-wrap justify-end gap-1.5">
                          <button
                            type="button"
                            className="text-[11px] font-semibold text-[var(--brand-mid)]"
                            onClick={() => startEdit(t)}
                          >
                            Edit
                          </button>
                          {!hasData ? (
                            <button
                              type="button"
                              className="text-[11px] font-semibold text-[var(--danger)]"
                              onClick={() => onDeleteExam(t)}
                            >
                              Delete
                            </button>
                          ) : null}
                          <button
                            type="button"
                            className="text-[11px] font-semibold text-[var(--brand-mid)]"
                            onClick={() => onToggleActive(t)}
                          >
                            {t.isActive ? "Deactivate" : "Activate"}
                          </button>
                        </div>
                      </div>
                    )}
                  </li>
                );
              })}
            </ul>
          </section>

          <section className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-5">
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Exam policy
            </h2>
            <p className="mt-1 text-xs text-[var(--muted)]">
              Grading, defaults, and report card rules
            </p>
            {policyDraft ? (
              <div className="mt-4 space-y-3">
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Pass % (grade D minimum)
                  </span>
                  <input
                    className="field !py-1.5"
                    inputMode="numeric"
                    value={policyDraft.passPercent}
                    onChange={(e) =>
                      setPolicyDraft({
                        ...policyDraft,
                        passPercent: Number(
                          e.target.value.replace(/\D/g, "") || 33,
                        ),
                      })
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Default UT max marks
                  </span>
                  <input
                    className="field !py-1.5"
                    inputMode="numeric"
                    value={policyDraft.defaultUtMaxMarks}
                    onChange={(e) =>
                      setPolicyDraft({
                        ...policyDraft,
                        defaultUtMaxMarks: Number(
                          e.target.value.replace(/\D/g, "") || 40,
                        ),
                      })
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Default term / annual max marks
                  </span>
                  <input
                    className="field !py-1.5"
                    inputMode="numeric"
                    value={policyDraft.defaultTermMaxMarks}
                    onChange={(e) =>
                      setPolicyDraft({
                        ...policyDraft,
                        defaultTermMaxMarks: Number(
                          e.target.value.replace(/\D/g, "") || 80,
                        ),
                      })
                    }
                  />
                </label>
                <label className="block text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Report card fee hold from stage
                  </span>
                  <select
                    className="field !py-1.5"
                    value={policyDraft.reportCardHoldFromStage}
                    onChange={(e) =>
                      setPolicyDraft({
                        ...policyDraft,
                        reportCardHoldFromStage: e.target
                          .value as ExamPolicy["reportCardHoldFromStage"],
                      })
                    }
                  >
                    {(["S1", "S2", "S3", "S4"] as const).map((s) => (
                      <option key={s} value={s}>
                        {s}
                      </option>
                    ))}
                  </select>
                  <p className="mt-1 text-[11px] text-[var(--muted)]">
                    Saving policy updates HOLD_REPORT_CARD and applies default
                    max marks to exams that still have no student marks (UT → UT
                    default; others → term default).
                  </p>
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                  <input
                    type="checkbox"
                    checked={policyDraft.showAttendanceOnReport}
                    onChange={(e) =>
                      setPolicyDraft({
                        ...policyDraft,
                        showAttendanceOnReport: e.target.checked,
                      })
                    }
                  />
                  Show attendance on report card
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                  <input
                    type="checkbox"
                    checked={policyDraft.includeOverallGrade}
                    onChange={(e) =>
                      setPolicyDraft({
                        ...policyDraft,
                        includeOverallGrade: e.target.checked,
                      })
                    }
                  />
                  Show overall grade
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                  <input
                    type="checkbox"
                    checked={policyDraft.enableCoScholastic}
                    onChange={(e) =>
                      setPolicyDraft({
                        ...policyDraft,
                        enableCoScholastic: e.target.checked,
                      })
                    }
                  />
                  Enable NEP 2020 co-scholastic domains (socio-emotional,
                  psychomotor) on marks entry and report cards
                </label>
                <div className="rounded-lg border border-[var(--border)] p-3">
                  <p className="text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
                    At-risk thresholds (early-warning list)
                  </p>
                  <div className="mt-2 grid gap-2 sm:grid-cols-5">
                    {(
                      [
                        ["attendancePct", "Attendance below %", 0, 100, 1],
                        ["incidents", "Incidents ≥", 1, 50, 1],
                        ["homeworkRatio", "Homework below (0–1)", 0, 1, 0.05],
                        ["homeworkMinDue", "…with at least N due", 1, 100, 1],
                        ["subjectDrops", "Subjects slipped ≥", 1, 20, 1],
                      ] as const
                    ).map(([key, label, min, max, step]) => (
                      <label key={key} className="block text-[11px] text-[var(--muted)]">
                        {label}
                        <input
                          type="number"
                          min={min}
                          max={max}
                          step={step}
                          className="field mt-0.5 !py-1 text-sm"
                          value={policyDraft.riskThresholds[key]}
                          onChange={(e) =>
                            setPolicyDraft({
                              ...policyDraft,
                              riskThresholds: {
                                ...policyDraft.riskThresholds,
                                [key]: Number(e.target.value),
                              },
                            })
                          }
                        />
                      </label>
                    ))}
                  </div>
                </div>
                <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                  <input
                    type="checkbox"
                    checked={policyDraft.requireAllSubjectsForReport}
                    onChange={(e) =>
                      setPolicyDraft({
                        ...policyDraft,
                        requireAllSubjectsForReport: e.target.checked,
                      })
                    }
                  />
                  Require all subjects marked before report
                </label>
                <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                  <input
                    type="checkbox"
                    checked={policyDraft.requireAllSubjectsPassForPromotion}
                    onChange={(e) =>
                      setPolicyDraft({
                        ...policyDraft,
                        requireAllSubjectsPassForPromotion: e.target.checked,
                      })
                    }
                  />
                  Fail promotion if any subject is below pass %
                </label>
                <div className="rounded-lg border border-[var(--border)] bg-[var(--surface)] p-3 space-y-2">
                  <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
                    HY / Final aggregates
                  </p>
                  <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                    <input
                      type="checkbox"
                      checked={policyDraft.includeComponentsInHyFinalReports}
                      onChange={(e) =>
                        setPolicyDraft({
                          ...policyDraft,
                          includeComponentsInHyFinalReports: e.target.checked,
                        })
                      }
                    />
                    Fold component exams into HY / Final reports
                  </label>
                  <label className="flex items-center gap-2 text-sm text-[var(--brand-deep)]">
                    <input
                      type="checkbox"
                      checked={
                        policyDraft.enforceSeparateMarksheetsForAggregate
                      }
                      onChange={(e) =>
                        setPolicyDraft({
                          ...policyDraft,
                          enforceSeparateMarksheetsForAggregate:
                            e.target.checked,
                        })
                      }
                    />
                    Block HY/Final if required separate marksheet missing
                  </label>
                  <p className="text-[11px] text-[var(--muted)]">
                    Defaults for new exams
                  </p>
                  <label className="flex items-center gap-2 text-xs text-[var(--brand-deep)]">
                    <input
                      type="checkbox"
                      checked={policyDraft.defaultCountsTowardHy}
                      onChange={(e) =>
                        setPolicyDraft({
                          ...policyDraft,
                          defaultCountsTowardHy: e.target.checked,
                        })
                      }
                    />
                    Count toward HY
                    <input
                      className="field !py-0.5 !w-14"
                      value={policyDraft.defaultWeightInHy}
                      onChange={(e) =>
                        setPolicyDraft({
                          ...policyDraft,
                          defaultWeightInHy: Number(
                            e.target.value.replace(/\D/g, "") || 0,
                          ),
                        })
                      }
                      title="Default HY weight"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[var(--brand-deep)]">
                    <input
                      type="checkbox"
                      checked={policyDraft.defaultCountsTowardFinal}
                      onChange={(e) =>
                        setPolicyDraft({
                          ...policyDraft,
                          defaultCountsTowardFinal: e.target.checked,
                        })
                      }
                    />
                    Count toward Final
                    <input
                      className="field !py-0.5 !w-14"
                      value={policyDraft.defaultWeightInFinal}
                      onChange={(e) =>
                        setPolicyDraft({
                          ...policyDraft,
                          defaultWeightInFinal: Number(
                            e.target.value.replace(/\D/g, "") || 0,
                          ),
                        })
                      }
                      title="Default Final weight"
                    />
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[var(--brand-deep)]">
                    <input
                      type="checkbox"
                      checked={policyDraft.defaultRequiredOnMarksheet}
                      onChange={(e) =>
                        setPolicyDraft({
                          ...policyDraft,
                          defaultRequiredOnMarksheet: e.target.checked,
                        })
                      }
                    />
                    Required on marksheet
                  </label>
                  <label className="flex items-center gap-2 text-xs text-[var(--brand-deep)]">
                    <input
                      type="checkbox"
                      checked={policyDraft.defaultRequiresSeparateMarksheet}
                      onChange={(e) =>
                        setPolicyDraft({
                          ...policyDraft,
                          defaultRequiresSeparateMarksheet: e.target.checked,
                        })
                      }
                    />
                    Requires separate marksheet
                  </label>
                </div>
                <p className="text-[11px] text-[var(--muted)]">
                  Grade scale: CBSE 8-point (A1–E)
                </p>
                <button
                  type="button"
                  className="btn-accent rounded-lg px-3 py-2 text-xs font-semibold"
                  onClick={onSavePolicy}
                >
                  Save policy
                </button>
              </div>
            ) : null}
          </section>
        </div>
      ) : null}

      {tab === "dashboard" ? (
        <div className="mt-6">
          <ModuleDashboardHost
            moduleId="exams"
            onNavigateTab={(t) => setTab(t as Tab)}
          />
        </div>
      ) : null}

      {tab === "marks" ? (
        <div className="mt-6">
          {!classId || !sectionId || !term ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-10 text-center text-sm text-[var(--muted)]">
              Select exam, class and section to enter marks. Create new exams
              under <strong>Exams &amp; policy</strong>.
            </p>
          ) : roster.length === 0 ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-10 text-center text-sm text-[var(--muted)]">
              No active students in this section.
            </p>
          ) : (
            <>
              <div className="mb-3 flex flex-wrap items-center justify-between gap-2 text-xs text-[var(--muted)]">
                <span>
                  {roster.length} students · {subjects.length} subjects
                  (enrollment-aware)
                  {scheme ? ` · ${scheme.name}` : ""}
                  {entryMode === "grades" ? " · grades, not marks" : ""}
                  {absences.size > 0 ? ` · ${absences.size} absent` : ""}
                  {sheetMeta?.lockedAt
                    ? " · locked"
                    : sheetMeta
                      ? ` · last saved ${sheetMeta.updatedAt.slice(0, 16).replace("T", " ")}`
                      : " · not saved yet"}
                  {dirty ? " · unsaved changes" : ""}
                </span>
                <div className="flex gap-2">
                  <button
                    type="button"
                    className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    disabled={!!sheetMeta?.lockedAt}
                    onClick={() => onSave(false)}
                  >
                    Save marks
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
                    disabled={!!sheetMeta?.lockedAt}
                    onClick={() => onSave(true)}
                  >
                    Save & lock
                  </button>
                  {sheetMeta?.lockedAt && canUnlock ? (
                    <button
                      type="button"
                      className="rounded-lg border border-[var(--warning)]/60 px-3 py-1.5 text-xs font-semibold"
                      onClick={onUnlock}
                      title="Lift the lock so marks can be corrected. The reason is recorded."
                    >
                      Unlock
                    </button>
                  ) : null}
                </div>
              </div>

              <ErpTableShell>
                <ErpTable minWidth="min-w-full" className="text-xs sm:text-sm">
                  <ErpTableHead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-[var(--surface-sunken)] px-4 py-2.5 font-bold text-[var(--brand-deep)]">
                        Student
                      </th>
                      {columns.map((col) => (
                        <th
                          key={columnKey(col)}
                          className="px-3 py-2.5 text-center font-bold text-[var(--brand-deep)]"
                        >
                          {col.subject.code}
                          {col.component ? (
                            <span className="block text-[10px] font-semibold text-[var(--muted)]">
                              {col.component.label}
                            </span>
                          ) : null}
                          <div className="text-[10px] font-normal text-[var(--muted)]">
                            {entryMode === "grades"
                              ? "grade"
                              : `/${col.component ? col.component.maxMarks : term ? effectiveMaxMarks(term, col.subject) : "—"}`}
                          </div>
                        </th>
                      ))}
                      {areas.map((area) => (
                        <th
                          key={area.code}
                          className="px-4 py-2.5 text-center font-bold text-[var(--brand-deep)]"
                        >
                          {coScholasticDomainLabel(area.code, areas)}
                        </th>
                      ))}
                    </tr>
                  </ErpTableHead>
                  <ErpTableBody>
                    {term
                      ? roster.map((st) => (
                          <MarkRow
                            key={st.id}
                            student={st}
                            sis={sis ?? undefined}
                            columns={columns}
                            term={term}
                            values={valuesByStudent.get(st.id) ?? {}}
                            takes={takesBy.get(st.id)}
                            locked={!!sheetMeta?.lockedAt}
                            entryMode={entryMode}
                            grades={gradeChoices}
                            areas={areas}
                            ratings={ratingsByStudent.get(st.id) ?? {}}
                            absent={absences.has(st.id)}
                            absentReason={absences.get(st.id) ?? ""}
                            onAbsent={setAbsent}
                            onAbsentReason={setAbsentReason}
                            onMark={setMark}
                            onGrade={setGrade}
                            onRating={setCoScholasticRating}
                          />
                        ))
                      : null}
                  </ErpTableBody>
                </ErpTable>
              </ErpTableShell>
            </>
          )}
        </div>
      ) : null}

      {tab === "items" ? (
        <ItemScoresPanel
          ay={ay}
          term={term}
          classId={classId}
          sectionId={sectionId}
          roster={roster}
          subjects={subjects}
          classLabel={classLabel}
          masters={masters}
          canEdit={!!masters && hasPermission(session, masters, "exams", "edit")}
          enteredBy={session.fullName}
          onSaved={refresh}
          onFlash={flash}
          onError={setError}
        />
      ) : null}

      {tab === "atrisk" ? (
        <AtRiskPanel
          ay={ay}
          term={term}
          classId={classId}
          sectionId={sectionId}
          roster={roster}
          masters={masters}
          policy={policy}
          canEdit={!!masters && hasPermission(session, masters, "exams", "edit")}
          onFlash={flash}
          onError={setError}
        />
      ) : null}

      {tab === "remarks" ? (
        <RemarksPanel
          ay={ay}
          term={term}
          terms={terms}
          classId={classId}
          sectionId={sectionId}
          classLabel={classLabel}
          roster={roster}
          subjects={subjects}
          policy={policy}
          canEdit={!!masters && hasPermission(session, masters, "exams", "edit")}
          onSaved={refresh}
          onFlash={flash}
          onError={setError}
        />
      ) : null}

      {tab === "reports" ? (
        <div className="mt-6 grid gap-6 lg:grid-cols-[1fr_1.1fr]">
          <div>
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Students
            </h2>
            {!sectionId ? (
              <p className="mt-3 text-sm text-[var(--muted)]">
                Select class and section above.
              </p>
            ) : (
              <ul className="mt-3 divide-y divide-[var(--border)] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]">
                {roster.map((st) => {
                  const hold =
                    reportHolds.get(st.id) ?? checkHold(st.id, "HOLD_REPORT_CARD");
                  return (
                    <li key={st.id}>
                      <button
                        type="button"
                        className={`flex w-full items-center gap-3 px-4 py-3 text-left hover:bg-[var(--surface-sunken)] ${
                          reportStudentId === st.id
                            ? "bg-[var(--surface-sunken)]"
                            : ""
                        }`}
                        onClick={() => openReport(st.id)}
                      >
                        <StudentAvatar student={st} size={36} />
                        <div className="min-w-0 flex-1">
                          <div className="truncate font-medium text-[var(--ink)]">
                            <StudentNameLabel student={st} sis={sis ?? undefined} />
                          </div>
                          <div className="text-xs text-[var(--muted)]">
                            {st.admissionNo}
                            {!hold.allowed ? (
                              <span className="ml-1 font-semibold text-[var(--danger)]">
                                · Report held
                              </span>
                            ) : null}
                          </div>
                        </div>
                        <span className="text-xs font-semibold text-[var(--brand-mid)]">
                          Open
                        </span>
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </div>

          <div>
            {reportStudentId && holdCheck && !holdCheck.allowed ? (
              <div className="space-y-3">
                <HoldStatusBanner
                  check={holdCheck}
                  onOverride={() => setHoldDialog(true)}
                />
                <p className="text-sm text-[var(--muted)]">
                  Clear dues or unhold HOLD_REPORT_CARD (Principal PIN) to print.
                </p>
              </div>
            ) : null}

            {preview ? (
              <div>
                <div className="mb-3 flex flex-wrap items-center justify-between gap-2 print-hide">
                  <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                    Preview
                  </h2>
                  <button
                    type="button"
                    className="btn-accent rounded-lg px-3 py-1.5 text-xs font-bold"
                    onClick={() => {
                      const gate = canPrintReportCard(preview.student.id);
                      if (!gate.allowed) {
                        setError(gate.message);
                        setHoldCheck(
                          checkHold(preview.student.id, "HOLD_REPORT_CARD"),
                        );
                        setHoldDialog(true);
                        return;
                      }
                      printReportCard(
                        preview.student.id,
                        preview.examTerm.id,
                      );
                    }}
                  >
                    Print report card
                  </button>
                </div>
                <ReportCardSheet card={preview} />
              </div>
            ) : (
              <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-10 text-center text-sm text-[var(--muted)]">
                Select a student to preview their report card for the chosen
                exam.
              </p>
            )}
          </div>
        </div>
      ) : null}

      {tab === "results" ? (
        <div className="mt-6 space-y-4">
          {!classId || !sectionId || !examTermId ? (
            <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-10 text-center text-sm text-[var(--muted)]">
              Select exam, class and section. Use Annual / Half-yearly for
              promotion decisions (aggregates apply when enabled in policy).
            </p>
          ) : classResult && "error" in classResult ? (
            <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
              {classResult.error}
            </p>
          ) : classResult && "sheet" in classResult ? (
            <>
              <div className="flex flex-wrap items-center justify-between gap-2">
                <div className="text-xs text-[var(--muted)]">
                  {classResult.sheet.summary.withMarks}/
                  {classResult.sheet.summary.total} with marks · Pass{" "}
                  {classResult.sheet.summary.passed} · Fail{" "}
                  {classResult.sheet.summary.failed} · Promoted{" "}
                  {classResult.sheet.summary.promoted} · Detained{" "}
                  {classResult.sheet.summary.detained}
                  {classResult.sheet.summary.applied
                    ? ` · ${classResult.sheet.summary.applied} applied to SIS`
                    : ""}
                </div>
                <div className="flex flex-wrap gap-2 print-hide">
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
                    onClick={onSuggestPromotions}
                  >
                    Auto suggest
                  </button>
                  <button
                    type="button"
                    className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold"
                    onClick={onApplyPromotions}
                  >
                    Apply promotions to SIS
                  </button>
                  <button
                    type="button"
                    className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold"
                    onClick={() =>
                      printClassResultSheet(
                        `class-result-${classResult.sheet.examTerm.id}-${classResult.sheet.sectionId}`,
                      )
                    }
                  >
                    Print result sheet
                  </button>
                </div>
              </div>

              <ErpTableShell className="print-hide">
                <ErpTable minWidth="min-w-full" className="text-xs sm:text-sm">
                  <ErpTableHead>
                    <tr>
                      <th className="px-4 py-2.5 font-bold text-[var(--brand-deep)]">
                        Student
                      </th>
                      <ErpSortTh sort={resultSort} field="percent" align="right" className="px-4 py-2.5 text-right font-bold">%</ErpSortTh>
                      <ErpSortTh sort={resultSort} field="grade" className="px-4 py-2.5 text-right font-bold">Grade</ErpSortTh>
                      <th className="px-4 py-2.5 font-bold">Pass</th>
                      <th className="px-4 py-2.5 font-bold">Decision</th>
                      <th className="px-4 py-2.5 font-bold">Next class</th>
                    </tr>
                  </ErpTableHead>
                  <ErpTableBody>
                    {resultSort.rows.map((row) => {
                      const decision =
                        row.record?.decision ??
                        (row.card ? "pending" : "pending");
                      const applied = !!row.record?.appliedToSisAt;
                      return (
                        <tr
                          key={row.student.id}
                          className="border-b border-[var(--border)]"
                        >
                          <td className="px-3 py-2">
                            <div className="flex items-center gap-2">
                              <StudentAvatar student={row.student} size={28} />
                              <div className="min-w-0">
                                <div className="truncate font-medium text-[var(--brand-deep)]">
                                  <StudentNameLabel student={row.student} />
                                </div>
                                <div className="text-[10px] text-[var(--muted)]">
                                  {row.student.admissionNo}
                                  {row.error ? (
                                    <span className="ml-1 text-[var(--warning)]">
                                      · {row.error}
                                    </span>
                                  ) : null}
                                  {applied ? (
                                    <span className="ml-1 font-semibold text-[var(--brand-mid)]">
                                      · in SIS
                                    </span>
                                  ) : null}
                                </div>
                              </div>
                            </div>
                          </td>
                          <td className="px-2 py-2 text-right tabular-nums font-semibold">
                            {row.card ? row.card.percent : "—"}
                          </td>
                          <td className="px-2 py-2 text-right font-semibold">
                            {row.card?.overallGrade ?? "—"}
                          </td>
                          <td className="px-2 py-2">
                            {!row.card ? (
                              <span className="text-[var(--muted)]">—</span>
                            ) : row.passed ? (
                              <span className="font-semibold text-[var(--success)]">
                                Pass
                              </span>
                            ) : (
                              <span className="font-semibold text-[var(--warning)]">
                                Fail
                              </span>
                            )}
                          </td>
                          <td className="px-2 py-2">
                            <select
                              className="field !py-1 !text-xs"
                              disabled={!row.card || applied}
                              value={decision}
                              onChange={(e) =>
                                onSetDecision(
                                  row,
                                  e.target.value as PromotionDecision,
                                )
                              }
                            >
                              {(
                                [
                                  "pending",
                                  "promoted",
                                  "detained",
                                  "conditional",
                                ] as const
                              ).map((d) => (
                                <option key={d} value={d}>
                                  {promotionDecisionLabel(d)}
                                </option>
                              ))}
                            </select>
                          </td>
                          <td className="px-2 py-2 text-[11px] text-[var(--muted)]">
                            {row.record?.decision === "promoted" ||
                            decision === "promoted"
                              ? row.nextClass
                                ? `${row.nextClass.name}${
                                    row.nextSection
                                      ? `-${row.nextSection.name}`
                                      : ""
                                  }`
                                : "No next class"
                              : decision === "detained"
                                ? "Same class"
                                : "—"}
                          </td>
                        </tr>
                      );
                    })}
                  </ErpTableBody>
                </ErpTable>
              </ErpTableShell>

              <ClassResultSheetView sheet={classResult.sheet} />
            </>
          ) : null}
        </div>
      ) : null}

      {tab === "result_reports" ? (
        <div className="mt-6">
          <ExamReportsRunner ay={ay} />
        </div>
      ) : null}

      {holdDialog &&
      reportStudentId &&
      holdCheck &&
      !holdCheck.allowed ? (
        <PrincipalHoldOverrideDialog
          studentId={reportStudentId}
          studentName={
            sis?.students.find((s) => s.id === reportStudentId)?.fullName ??
            "Student"
          }
          holdCode="HOLD_REPORT_CARD"
          block={holdCheck}
          overriddenBy={session.fullName}
          onClose={() => setHoldDialog(false)}
          onGranted={retryReportAfterUnlock}
        />
      ) : null}
    </ErpWorkspaceShell>
  );
}
