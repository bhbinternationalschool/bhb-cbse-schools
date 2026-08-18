"use client";

import { useEffect, useMemo, useState } from "react";
import { ClipboardList } from "lucide-react";
import {
  applyPromotionsToSis,
  buildClassResultSheet,
  buildEmptyCoScholasticGrid,
  buildEmptyMarksGrid,
  buildReportCard,
  canPrintReportCard,
  CO_SCHOLASTIC_DOMAINS,
  coScholasticDomainLabel,
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
  saveMarkSheet,
  savePromotionDecision,
  studentTakesExamSubject,
  subjectsForMarkEntry,
  suggestPromotionsForSection,
  updateExamTerm,
  type ClassResultRow,
  type CoScholasticRating,
  type ExamPolicy,
  type ExamTerm,
  type PromotionDecision,
  type ReportCard,
  type StudentCoScholasticEntry,
  type StudentSubjectMark,
} from "@/lib/exams";
import { rosterForSection } from "@/lib/attendance";
import { DEFAULT_AY, loadMasters, type MastersState } from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";
import { checkHold, setReportCardHoldFromStage, type HoldCheck } from "@/lib/holds";
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
import { ExamDateSheetPanel } from "@/components/exams/ExamDateSheetPanel";
import { InvigilationPanel } from "@/components/exams/InvigilationPanel";
import { ExamPapersPanel } from "@/components/exams/ExamPapersPanel";
import { AdmitCardsPanel } from "@/components/exams/AdmitCardsPanel";
import { RemarksPanel } from "@/components/exams/RemarksPanel";
import { ItemScoresPanel } from "@/components/exams/ItemScoresPanel";
import { ExamReportsRunner } from "@/components/reports/ModuleReportRunners";
import { hasPermission } from "@/lib/rbac";

type Tab =
  | "dashboard"
  | "marks"
  | "items"
  | "remarks"
  | "datesheet"
  | "invigilation"
  | "papers"
  | "admitcards"
  | "reports"
  | "results"
  | "result_reports"
  | "setup";

export function ExamsWorkspace() {
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
  const [dirty, setDirty] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);
  const [reportStudentId, setReportStudentId] = useState<string | null>(null);
  const [preview, setPreview] = useState<ReportCard | null>(null);
  const [holdCheck, setHoldCheck] = useState<HoldCheck | null>(null);
  const [holdDialog, setHoldDialog] = useState(false);

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
    setTick((x) => x + 1);
  }

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

  const terms = useMemo(() => {
    void tick;
    return listExamTerms(ay);
  }, [ay, tick]);

  const allTerms = useMemo(() => {
    void tick;
    return listAllExamTerms(ay);
  }, [ay, tick]);

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
  const policy = policyDraft ?? getExamPolicy();

  const roster = useMemo(() => {
    if (!sis || !sectionId) return [];
    return rosterForSection(sis.students, sectionId, {
      classId: classId || undefined,
      academicYearCode: ay,
    });
  }, [sis, sectionId, classId, ay, tick]);

  const subjects = useMemo(() => {
    if (!classId) return [];
    return subjectsForMarkEntry(classId, roster);
  }, [classId, roster, tick]);

  useEffect(() => {
    if (!term || !sectionId || !classId) {
      setGrid([]);
      setDirty(false);
      return;
    }
    const existing = findMarkSheet(ay, term.id, sectionId);
    setGrid(
      buildEmptyMarksGrid(
        roster,
        subjects,
        term,
        existing,
        policy.passPercent,
      ),
    );
    setCoScholasticGrid(buildEmptyCoScholasticGrid(roster, existing));
    setDirty(false);
  }, [ay, term?.id, sectionId, classId, roster, subjects, policy.passPercent]);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function cellKey(studentId: string, subjectId: string) {
    return `${studentId}:${subjectId}`;
  }

  function setMark(studentId: string, subjectId: string, value: string) {
    if (!term) return;
    const sub = subjects.find((s) => s.id === subjectId);
    if (!sub) return;
    const st = roster.find((s) => s.id === studentId);
    if (st && !studentTakesExamSubject(st, sub)) return;
    const max = effectiveMaxMarks(term, sub);
    let obtained: number | null = null;
    if (value.trim() !== "") {
      const n = Number(value);
      if (!Number.isFinite(n)) return;
      obtained = Math.min(max, Math.max(0, n));
    }
    setGrid((prev) =>
      prev.map((m) =>
        m.studentId === studentId && m.subjectId === subjectId
          ? { ...m, marksObtained: obtained }
          : m,
      ),
    );
    setDirty(true);
  }

  function setCoScholasticRating(
    studentId: string,
    domain: StudentCoScholasticEntry["domain"],
    value: string,
  ) {
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
  }

  function onSave(lock = false) {
    if (!term || !classId || !sectionId) {
      setError("Select exam, class and section");
      return;
    }
    // Drop marks for subjects the student does not take
    const marks = grid.map((m) => {
      const st = roster.find((s) => s.id === m.studentId);
      const sub = subjects.find((s) => s.id === m.subjectId);
      if (st && sub && !studentTakesExamSubject(st, sub)) {
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
      coScholastic: policy.enableCoScholastic ? coScholasticGrid : undefined,
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
        ? "Mark sheet saved and locked"
        : `Marks saved · ${roster.length} students`,
    );
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
    const card = buildReportCard({
      student: st,
      classLabel: classLabelOf(studentId),
      examTermId,
      academicYearCode: ay,
    });
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
    void tick;
    if (!examTermId || !sectionId) return null;
    return findMarkSheet(ay, examTermId, sectionId);
  }, [ay, examTermId, sectionId, tick]);

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
    });
    if ("error" in built) return { error: built.error } as const;
    return { sheet: built } as const;
  }, [tab, tick, examTermId, classId, sectionId, roster, classLabel, ay]);

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
                </div>
              </div>

              <ErpTableShell>
                <ErpTable minWidth="min-w-full" className="text-xs sm:text-sm">
                  <ErpTableHead>
                    <tr>
                      <th className="sticky left-0 z-10 bg-[var(--surface-sunken)] px-4 py-2.5 font-bold text-[var(--brand-deep)]">
                        Student
                      </th>
                      {subjects.map((sub) => (
                        <th
                          key={sub.id}
                          className="px-4 py-2.5 text-center font-bold text-[var(--brand-deep)]"
                        >
                          {sub.code}
                          <div className="text-[10px] font-normal text-[var(--muted)]">
                            /{term ? effectiveMaxMarks(term, sub) : "—"}
                          </div>
                        </th>
                      ))}
                      {policy.enableCoScholastic
                        ? CO_SCHOLASTIC_DOMAINS.map((domain) => (
                            <th
                              key={domain}
                              className="px-4 py-2.5 text-center font-bold text-[var(--brand-deep)]"
                            >
                              {coScholasticDomainLabel(domain)}
                            </th>
                          ))
                        : null}
                    </tr>
                  </ErpTableHead>
                  <ErpTableBody>
                    {roster.map((st) => (
                      <tr
                        key={st.id}
                        className="border-b border-[var(--border)]"
                      >
                        <td className="sticky left-0 z-10 bg-[var(--card)] px-3 py-1.5">
                          <div className="flex items-center gap-2">
                            <StudentAvatar student={st} size={28} />
                            <div className="min-w-0">
                              <div className="truncate font-medium text-[var(--brand-deep)]">
                                <StudentNameLabel student={st} />
                              </div>
                              <div className="text-[10px] text-[var(--muted)]">
                                {st.admissionNo}
                                {st.rollNo ? ` · Roll ${st.rollNo}` : ""}
                              </div>
                            </div>
                          </div>
                        </td>
                        {subjects.map((sub) => {
                          const cell = grid.find(
                            (m) =>
                              m.studentId === st.id &&
                              m.subjectId === sub.id,
                          );
                          const takes = studentTakesExamSubject(st, sub);
                          return (
                            <td
                              key={cellKey(st.id, sub.id)}
                              className="px-1 py-1"
                            >
                              {takes ? (
                                <input
                                  className="field !w-14 !px-1 !py-1 text-center tabular-nums"
                                  inputMode="decimal"
                                  disabled={!!sheetMeta?.lockedAt}
                                  value={
                                    cell?.marksObtained == null
                                      ? ""
                                      : String(cell.marksObtained)
                                  }
                                  onChange={(e) =>
                                    setMark(st.id, sub.id, e.target.value)
                                  }
                                  aria-label={`${st.fullName} ${sub.name}`}
                                />
                              ) : (
                                <span
                                  className="block w-14 px-1 py-1 text-center text-[10px] text-[var(--muted)]"
                                  title="Not on this student's curriculum"
                                >
                                  —
                                </span>
                              )}
                            </td>
                          );
                        })}
                        {policy.enableCoScholastic
                          ? CO_SCHOLASTIC_DOMAINS.map((domain) => {
                              const entry = coScholasticGrid.find(
                                (e) =>
                                  e.studentId === st.id && e.domain === domain,
                              );
                              return (
                                <td
                                  key={`${st.id}:${domain}`}
                                  className="px-1 py-1"
                                >
                                  <select
                                    className="field !w-16 !px-1 !py-1 text-center"
                                    disabled={!!sheetMeta?.lockedAt}
                                    value={entry?.rating ?? ""}
                                    onChange={(e) =>
                                      setCoScholasticRating(
                                        st.id,
                                        domain,
                                        e.target.value,
                                      )
                                    }
                                    aria-label={`${st.fullName} ${coScholasticDomainLabel(domain)}`}
                                  >
                                    <option value="">—</option>
                                    <option value="A">A</option>
                                    <option value="B">B</option>
                                    <option value="C">C</option>
                                  </select>
                                </td>
                              );
                            })
                          : null}
                      </tr>
                    ))}
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
          masters={masters}
          canEdit={!!masters && hasPermission(session, masters, "exams", "edit")}
          enteredBy={session.fullName}
          onSaved={refresh}
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
                  const hold = checkHold(st.id, "HOLD_REPORT_CARD");
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
                            <StudentNameLabel student={st} />
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
                      <th className="px-4 py-2.5 text-right font-bold">%</th>
                      <th className="px-4 py-2.5 text-right font-bold">
                        Grade
                      </th>
                      <th className="px-4 py-2.5 font-bold">Pass</th>
                      <th className="px-4 py-2.5 font-bold">Decision</th>
                      <th className="px-4 py-2.5 font-bold">Next class</th>
                    </tr>
                  </ErpTableHead>
                  <ErpTableBody>
                    {classResult.sheet.rows.map((row) => {
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
