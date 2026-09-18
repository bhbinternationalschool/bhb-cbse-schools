"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MastersState } from "@/lib/masters";
import type { ExamTerm } from "@/lib/exams";
import {
  FONT_SCALES,
  PAGE_SIZES,
  PAPER_LANGUAGES,
  PAPER_LAYOUTS,
  fontScaleForClass,
  languageForSubject,
  resolveLanguage,
  type ExamPaperPrintSettings,
} from "@/lib/examPaperPrint";
import {
  emptySubQuestion,
  SUB_QUESTION_TYPES,
  type ExamSubQuestion,
  autoOptionColumns,
  type ExamPaperImage,
  type ExamPaperImageLabel,
  ASSERTION_REASON_OPTIONS,
  defaultsForType,
  questionTotalMarks,
  HARDNESS_LEVELS,
  PRIMARY_ICON_BANK,
  QUESTION_TYPES,
  BLOOM_LEVELS,
  activeSet,
  createExamPaper,
  deleteExamPaper,
  duplicateSetAs,
  emptyQuestion,
  emptySection,
  getExamPaper,
  listExamPapers,
  recordPaperPrint,
  saveExamPaper,
  saveExamPapers,
  loadExamPapers,
  addQuestionsToBank,
  sectionMarks,
  setMarks,
  totalPrintCount,
  type ExamPaper,
  type ExamPaperHardness,
  type ExamPaperQuestion,
  type ExamPaperQuestionType,
  type ExamPaperSection,
  type ExamPaperSet,
  schoolHeaderDefaults,
  questionTransliterationTexts,
  applyTransliteratedQuestion,
  questionHasConvertibleText,
} from "@/lib/examPapers";
import { loadTeaching, type SyllabusUnit } from "@/lib/teaching";
import { BlueprintPanel } from "@/components/exams/BlueprintPanel";
import { ExamPaperImportPanel } from "@/components/exams/ExamPaperImportPanel";
import { BankPicker } from "@/components/exams/BankPicker";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import {
  catalogFor,
  groupsFor,
  searchCatalog,
  subjectKeyLabel,
  type FormulaEntry,
} from "@/lib/examFormulaCatalog";
import {
  suggestExamPaperDraft,
  suggestMoreQuestions,
} from "@/lib/examPaperAi";
import {
  ExamPaperPrintSheet,
  printExamPaper,
} from "@/components/exams/ExamPaperPrintSheet";

const IMG_MAX = 800_000;

type Props = {
  masters: MastersState;
  academicYearCode: string;
  terms: ExamTerm[];
  canEdit: boolean;
  actorName: string;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
};

export function ExamPapersPanel({
  masters,
  academicYearCode: ay,
  terms,
  canEdit,
  actorName,
  onError,
  onNotice,
}: Props) {
  const [tick, setTick] = useState(0);
  const [editingId, setEditingId] = useState<string | null>(null);
  const [draft, setDraft] = useState<ExamPaper | null>(null);
  const [printCount, setPrintCount] = useState(1);
  const [headerConverting, setHeaderConverting] = useState(false);
  const [headerConvertError, setHeaderConvertError] = useState("");
  const [showPreview, setShowPreview] = useState(false);
  const [aiHardness, setAiHardness] = useState<ExamPaperHardness>("mixed");
  const [aiLoading, setAiLoading] = useState(false);
  const [aiMoreType, setAiMoreType] = useState<ExamPaperQuestionType | "">("");

  /** Chapters/topics in the Teaching plan for this paper's class + subject. */
  const syllabusUnits = useMemo<SyllabusUnit[]>(() => {
    void tick;
    if (!draft?.classId || !draft?.subjectId) return [];
    return loadTeaching()
      .units.filter(
        (u) =>
          u.isActive &&
          u.academicYearCode === ay &&
          u.classId === draft.classId &&
          u.subjectId === draft.subjectId,
      )
      .sort((a, b) => a.sortOrder - b.sortOrder);
  }, [ay, draft?.classId, draft?.subjectId, tick]);

  /** What the AI is told about the ticked units (id, code, title, outcomes, LO codes). */
  function unitFactsForAi() {
    if (!draft) return [];
    const picked = new Set(draft.unitIds);
    return syllabusUnits
      .filter((u) => picked.has(u.id))
      .map((u) => ({
        id: u.id,
        code: u.code,
        title: u.title,
        level: u.level,
        learningOutcomes: u.learningOutcomes,
        competencyCodes: u.competencyCodes,
      }));
  }

  const [newExamTermId, setNewExamTermId] = useState(terms[0]?.id ?? "");
  const [newClassId, setNewClassId] = useState("");
  const [newSubjectId, setNewSubjectId] = useState("");
  const [filterClassId, setFilterClassId] = useState("");
  /**
   * A paper is set for the whole class, not for one section — so picking a
   * section narrows to that section's class. Kept as its own filter because
   * that is how the office thinks about a class ("VI B"), and hiding the
   * distinction would be worse than stating it.
   */
  const [filterSectionId, setFilterSectionId] = useState("");
  const [filterSubjectId, setFilterSubjectId] = useState("");
  const [filterExamTermId, setFilterExamTermId] = useState("");

  useEffect(() => {
    void Promise.all([
      import("@/lib/examPapersPersistence"),
      import("@/lib/deskHydrateGuard"),
    ]).then(([{ ensureExamPapersHydrated }, { withHydrationSlot }]) => {
      void withHydrationSlot(() => ensureExamPapersHydrated()).then(
        (changed) => {
          if (changed) setTick((t) => t + 1);
        },
      );
    });
  }, []);

  useEffect(() => {
    if (!newExamTermId && terms[0]) setNewExamTermId(terms[0].id);
  }, [terms, newExamTermId]);

  /** Everything for this session, before the filter bar narrows it. */
  const allPapers = useMemo(() => {
    void tick;
    return listExamPapers(ay);
  }, [ay, tick]);

  const papers = useMemo(
    () =>
      allPapers
        .filter((p) => !filterClassId || p.classId === filterClassId)
        .filter((p) => !filterSubjectId || p.subjectId === filterSubjectId)
        .filter((p) => !filterExamTermId || p.examTermId === filterExamTermId),
    [allPapers, filterClassId, filterSubjectId, filterExamTermId],
  );

  const classOptions = useMemo(
    () => masters.classes.filter((c) => c.isActive),
    [masters],
  );

  const sectionOptions = useMemo(
    () =>
      (masters.sections ?? []).filter(
        (x) => x.isActive && (!filterClassId || x.classId === filterClassId),
      ),
    [masters, filterClassId],
  );

  /**
   * The filter bar offers what is actually there.
   *
   * Listing every subject in masters would let the office pick one of the
   * forty that has no paper and be told there is nothing — which reads like a
   * fault rather than an empty shelf. So each list is built from the papers
   * that survive the *other* filters, and only falls back to the masters list
   * while the session has no papers at all.
   */
  const filterSubjectOptions = useMemo(() => {
    const ids = new Set(
      allPapers
        .filter((p) => !filterClassId || p.classId === filterClassId)
        .filter((p) => !filterExamTermId || p.examTermId === filterExamTermId)
        .map((p) => p.subjectId),
    );
    const list = (masters.subjects ?? []).filter((x) => ids.has(x.id));
    if (list.length) return list;
    return allPapers.length
      ? []
      : (masters.subjects ?? []).filter((x) => x.isActive && !x.parentId);
  }, [allPapers, masters, filterClassId, filterExamTermId]);

  const filterExamOptions = useMemo(() => {
    const ids = new Set(
      allPapers
        .filter((p) => !filterClassId || p.classId === filterClassId)
        .filter((p) => !filterSubjectId || p.subjectId === filterSubjectId)
        .map((p) => p.examTermId),
    );
    const list = terms.filter((t) => ids.has(t.id));
    if (list.length) return list;
    return allPapers.length ? [] : terms;
  }, [allPapers, terms, filterClassId, filterSubjectId]);

  const filtersOn = !!(
    filterClassId ||
    filterSectionId ||
    filterSubjectId ||
    filterExamTermId
  );

  /** Narrowing the class must not leave a section or subject behind that no
   * longer belongs to it — a filter bar that contradicts itself shows an
   * empty list and no reason for it. */
  function pickClass(classId: string) {
    setFilterClassId(classId);
    if (
      filterSectionId &&
      !(masters.sections ?? []).some(
        (x) => x.id === filterSectionId && (!classId || x.classId === classId),
      )
    ) {
      setFilterSectionId("");
    }
    if (
      filterSubjectId &&
      classId &&
      !allPapers.some((p) => p.classId === classId && p.subjectId === filterSubjectId)
    ) {
      setFilterSubjectId("");
    }
  }

  /** A section stands for its class: papers are set class-wide. */
  function pickSection(sectionId: string) {
    setFilterSectionId(sectionId);
    const section = (masters.sections ?? []).find((x) => x.id === sectionId);
    if (section) pickClass(section.classId);
  }

  function clearFilters() {
    setFilterClassId("");
    setFilterSectionId("");
    setFilterSubjectId("");
    setFilterExamTermId("");
  }

  const subjectOptions = useMemo(() => {
    const classId = draft?.classId || newClassId;
    if (!classId) {
      return (masters.subjects ?? []).filter((s) => s.isActive && !s.parentId);
    }
    const linked = (masters.classSubjects ?? [])
      .filter((l) => l.classId === classId && l.isActive !== false)
      .map((l) => l.subjectId);
    const set = new Set(linked);
    const fromLinks = (masters.subjects ?? []).filter((s) => set.has(s.id));
    return fromLinks.length
      ? fromLinks
      : (masters.subjects ?? []).filter((s) => s.isActive && !s.parentId);
  }, [masters, draft?.classId, newClassId]);

  function refresh() {
    setTick((t) => t + 1);
  }

  function labelClass(id: string) {
    return masters.classes.find((c) => c.id === id)?.name || id || "—";
  }
  function labelSubject(id: string) {
    const s = (masters.subjects ?? []).find((x) => x.id === id);
    return s?.nameEn || s?.code || id || "—";
  }
  function labelExam(id: string) {
    const t = terms.find((x) => x.id === id);
    return t ? `${t.code} · ${t.label}` : id || "—";
  }

  function openEdit(id: string) {
    const p = getExamPaper(id);
    if (!p) {
      onError("Paper not found");
      return;
    }
    setEditingId(id);
    setDraft(structuredClone(p));
    setShowPreview(false);
  }

  function onCreate() {
    if (!canEdit) return;
    const term = terms.find((t) => t.id === newExamTermId);
    const cls = masters.classes.find((c) => c.id === newClassId);
    const sub = (masters.subjects ?? []).find((s) => s.id === newSubjectId);
    const r = createExamPaper({
      academicYearCode: ay,
      examTermId: newExamTermId,
      classId: newClassId,
      subjectId: newSubjectId,
      examName: term ? `${term.code} · ${term.label}` : "",
      maxMarks: term?.maxMarks || 80,
      durationMinutes: term && term.maxMarks <= 40 ? 60 : 90,
      createdBy: actorName,
      examCode: term?.code,
      className: cls?.name,
      subjectCode: sub?.code || sub?.nameEn,
    });
    if (!r.ok) {
      onError(r.error);
      return;
    }
    refresh();
    openEdit(r.paper.id);
    onNotice(`Created ${r.paper.paperCode} — draft ready to edit`);
  }

  /** Save questions into the bank for this paper's class × subject. */
  function bankQuestions(qs: ExamPaperQuestion[], label: string) {
    if (!draft || !canEdit) return;
    const r = addQuestionsToBank(loadExamPapers(), {
      classId: draft.classId,
      subjectId: draft.subjectId,
      questions: qs.filter((q) => q.text.trim()),
      tags: [draft.examName || ""].filter(Boolean),
      by: actorName,
    });
    saveExamPapers(r.state);
    setTick((t) => t + 1);
    onNotice(r.added ? `${r.added} question${r.added === 1 ? "" : "s"} added to the bank (${label})` : `Already in the bank (${label})`);
  }

  function updatePrint(patch: Partial<ExamPaperPrintSettings>) {
    if (!draft) return;
    updateDraft({ print: { ...draft.print, ...patch } });
  }

  /**
   * Header + instructions + section titles in the paper's script, via the
   * same Hinglish → Hindi / Sanskrit route the questions use. The school's
   * English name and address are the inputs when no override exists yet.
   */
  async function convertHeaderTo(target: "hi" | "sa") {
    if (!draft) return;
    setHeaderConvertError("");
    setHeaderConverting(true);
    try {
      const defaults = schoolHeaderDefaults();
      const h = draft.print.header;
      const sections = draft.sets.flatMap((st) => st.sections);
      const texts = [
        h.schoolName || defaults.schoolName,
        h.address || defaults.address,
        h.examName || draft.examName || labelExam(draft.examTermId),
        h.title || draft.title,
        draft.generalInstructions,
        ...sections.flatMap((s) => [s.title, s.instructions]),
      ];
      const res = await fetch("/api/ai/transliterate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts, target }),
      });
      const body = (await res.json().catch(() => null)) as { texts?: string[]; generationId?: string; error?: string } | null;
      if (!res.ok || !body?.texts) {
        setHeaderConvertError(body?.error || `Could not convert (HTTP ${res.status})`);
        return;
      }
      const out = body.texts;
      let i = 0;
      const header = { schoolName: out[i++]!, address: out[i++]!, examName: out[i++]!, title: out[i++]! };
      const generalInstructions = out[i++]!;
      const sets = draft.sets.map((st) => ({
        ...st,
        sections: st.sections.map((s) => ({ ...s, title: out[i++]!, instructions: out[i++]! })),
      }));
      updateDraft({ print: { ...draft.print, header, language: target }, generalInstructions, sets });
      if (out.every((t, i) => t === texts[i])) {
        setHeaderConvertError(
          "The AI returned the text unchanged — it may already be in Devanagari. Try again, or type it directly.",
        );
        if (body.generationId) reportAiOutcome({ ids: [body.generationId], outcome: "rejected" });
        return;
      }
      if (body.generationId) reportAiOutcome({ ids: [body.generationId], outcome: "accepted" });
    } catch (e) {
      setHeaderConvertError(e instanceof Error ? e.message : String(e));
    } finally {
      setHeaderConverting(false);
    }
  }

  function updateDraft(patch: Partial<ExamPaper>) {
    setDraft((prev) => (prev ? { ...prev, ...patch } : prev));
  }

  function mutateActiveSet(fn: (set: ExamPaperSet) => ExamPaperSet) {
    setDraft((prev) => {
      if (!prev) return prev;
      const code = prev.activeSetCode;
      return {
        ...prev,
        sets: prev.sets.map((s) => (s.setCode === code ? fn(s) : s)),
      };
    });
  }

  function onSave() {
    if (!draft || !canEdit) return;
    const r = saveExamPaper(draft, actorName);
    if (!r.ok) {
      onError(r.error);
      return;
    }
    setDraft(r.paper);
    refresh();
    onNotice(`Saved ${r.paper.paperCode}`);
  }

  async function onAiFill() {
    if (!draft || !canEdit || aiLoading) return;
    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/exam-paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "draft",
          classId: draft.classId,
          subjectId: draft.subjectId,
          hardness: aiHardness,
          maxMarks: draft.maxMarks,
          units: unitFactsForAi(),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        sections?: ExamPaperSection[];
        explanation?: string[];
        engine?: string;
        source?: string;
        error?: string;
        generationId?: string;
      };
      if (res.ok && json.ok && json.sections?.length) {
        mutateActiveSet((set) => ({
          ...set,
          sections: json.sections!,
        }));
        updateDraft({ hardness: aiHardness });
        // Whole-set draft accepted into the editor; the teacher edits before print.
        if (json.generationId) {
          reportAiOutcome({
            ids: [json.generationId],
            outcome: "accepted",
            targetType: "exam_paper",
            targetId: draft.id,
          });
        }
        onNotice(
          [
            ...(json.explanation || []),
            json.engine && json.engine !== "local"
              ? `(Engine: ${json.engine})`
              : "",
          ]
            .filter(Boolean)
            .join(" "),
        );
        return;
      }
    } catch {
      /* fallback below */
    } finally {
      setAiLoading(false);
    }

    const result = suggestExamPaperDraft({
      masters,
      classId: draft.classId,
      subjectId: draft.subjectId,
      hardness: aiHardness,
      maxMarks: draft.maxMarks,
    });
    mutateActiveSet((set) => ({
      ...set,
      sections: result.sections,
    }));
    updateDraft({ hardness: aiHardness });
    onNotice(`${result.explanation.join(" ")} (offline draft)`);
  }

  async function onAiMore(sectionId: string) {
    if (!draft || !canEdit || aiLoading) return;
    const set = activeSet(draft);
    const section = set.sections.find((s) => s.id === sectionId);
    if (!section) return;

    setAiLoading(true);
    try {
      const res = await fetch("/api/ai/exam-paper", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          mode: "more",
          classId: draft.classId,
          subjectId: draft.subjectId,
          hardness: draft.hardness,
          count: 2,
          excludeTexts: section.questions.map((q) => q.text),
          units: unitFactsForAi(),
          type: aiMoreType || undefined,
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        questions?: ExamPaperQuestion[];
        engine?: string;
        generationId?: string;
      };
      if (res.ok && json.ok && json.questions?.length) {
        mutateActiveSet((s) => ({
          ...s,
          sections: s.sections.map((sec) =>
            sec.id === sectionId
              ? { ...sec, questions: [...sec.questions, ...json.questions!] }
              : sec,
          ),
        }));
        onNotice(
          `Added ${json.questions.length} AI suggestion(s)${json.engine && json.engine !== "local" ? ` (${json.engine})` : ""} — edit as needed`,
        );
        return;
      }
    } catch {
      /* fallback */
    } finally {
      setAiLoading(false);
    }

    const more = suggestMoreQuestions({
      masters,
      classId: draft.classId,
      subjectId: draft.subjectId,
      hardness: draft.hardness === "mixed" ? "medium" : draft.hardness,
      count: 2,
      excludeTexts: section.questions.map((q) => q.text),
    });
    if (!more.length) {
      onNotice("No more AI suggestions for this hardness — type your own.");
      return;
    }
    mutateActiveSet((s) => ({
      ...s,
      sections: s.sections.map((sec) =>
        sec.id === sectionId
          ? { ...sec, questions: [...sec.questions, ...more] }
          : sec,
      ),
    }));
    onNotice(`Added ${more.length} offline suggestion(s) — edit as needed`);
  }

  function onAddSet() {
    if (!draft) return;
    const used = new Set(draft.sets.map((s) => s.setCode));
    const next = ["A", "B", "C", "D", "E"].find((c) => !used.has(c));
    if (!next) {
      onError("Maximum 5 sets (A–E)");
      return;
    }
    const from = draft.activeSetCode;
    setDraft({
      ...duplicateSetAs(draft, from, next),
      activeSetCode: next,
    });
    onNotice(`Set ${next} cloned from Set ${from} — shuffle/edit questions`);
  }

  function onDelete() {
    if (!draft || !canEdit) return;
    if (!window.confirm(`Delete paper ${draft.paperCode}?`)) return;
    const r = deleteExamPaper(draft.id);
    if (!r.ok) {
      onError(r.error);
      return;
    }
    setDraft(null);
    setEditingId(null);
    refresh();
    onNotice("Paper deleted");
  }

  function onPrint() {
    if (!draft) return;
    const saved = saveExamPaper(draft, actorName);
    if (!saved.ok) {
      onError(saved.error);
      return;
    }
    const logged = recordPaperPrint({
      paperId: draft.id,
      count: printCount,
      setCode: draft.activeSetCode,
      by: actorName,
    });
    if (logged.ok) {
      setDraft(logged.paper);
      refresh();
    }
    setShowPreview(true);
    window.setTimeout(() => printExamPaper(draft.id), 200);
    onNotice(
      `Print logged · ${printCount} copy/copies · Set ${draft.activeSetCode}`,
    );
  }

  function readImageFile(
    file: File,
    onDone: (dataUrl: string) => void,
  ) {
    if (!file.type.startsWith("image/")) {
      onError("Choose an image file");
      return;
    }
    if (file.size > IMG_MAX) {
      onError("Image must be under 800 KB");
      return;
    }
    const reader = new FileReader();
    reader.onload = () => {
      if (typeof reader.result === "string") onDone(reader.result);
    };
    reader.readAsDataURL(file);
  }

  if (editingId && draft) {
    const set = activeSet(draft);
    const currentMarks = setMarks(set);

    return (
      <div className="mt-5 space-y-4">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <button
            type="button"
            className="text-sm font-semibold text-[var(--brand-deep)] underline"
            onClick={() => {
              setEditingId(null);
              setDraft(null);
              refresh();
            }}
          >
            ← All papers
          </button>
          <div className="flex flex-wrap gap-2">
            {canEdit ? (
              <>
                <button
                  type="button"
                  className="btn-accent rounded-lg px-3 py-1.5 text-sm font-bold"
                  onClick={onSave}
                >
                  Save paper
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold"
                  onClick={() => {
                    updateDraft({
                      status: draft.status === "ready" ? "draft" : "ready",
                    });
                  }}
                >
                  Mark {draft.status === "ready" ? "draft" : "ready"}
                </button>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--danger)]/40 px-3 py-1.5 text-sm font-semibold text-[var(--danger)]"
                  onClick={onDelete}
                >
                  Delete
                </button>
              </>
            ) : null}
            <button
              type="button"
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold"
              onClick={() => setShowPreview((v) => !v)}
            >
              {showPreview ? "Hide preview" : "Preview"}
            </button>
            <button
              type="button"
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-bold text-[var(--primary-foreground)]"
              onClick={onPrint}
            >
              Print
            </button>
          </div>
        </div>

        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex flex-wrap items-start justify-between gap-2">
            <div>
              <h2 className="text-sm font-bold text-[var(--brand-deep)]">
                {draft.title}
              </h2>
              <p className="mt-0.5 font-mono text-[11px] text-[var(--muted)]">
                {draft.paperCode} · {draft.status} · printed{" "}
                {totalPrintCount(draft)} time(s)
              </p>
            </div>
            <label className="text-sm">
              <span className="mr-2 text-[11px] text-[var(--muted)]">
                Print copies
              </span>
              <input
                type="number"
                min={1}
                max={500}
                className="field !inline-block !w-20 !py-1"
                value={printCount}
                onChange={(e) =>
                  setPrintCount(Math.max(1, Number(e.target.value) || 1))
                }
              />
            </label>
          </div>

          <div className="mt-3 grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Paper title
              </span>
              <input
                className="field !py-1.5"
                disabled={!canEdit}
                value={draft.title}
                onChange={(e) => updateDraft({ title: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Exam name (header)
              </span>
              <input
                className="field !py-1.5"
                disabled={!canEdit}
                value={draft.examName}
                onChange={(e) => updateDraft({ examName: e.target.value })}
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Duration (minutes)
              </span>
              <input
                type="number"
                className="field !py-1.5"
                disabled={!canEdit}
                value={draft.durationMinutes}
                onChange={(e) =>
                  updateDraft({
                    durationMinutes: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Maximum marks
              </span>
              <input
                type="number"
                className="field !py-1.5"
                disabled={!canEdit}
                value={draft.maxMarks}
                onChange={(e) =>
                  updateDraft({
                    maxMarks: Math.max(0, Number(e.target.value) || 0),
                  })
                }
              />
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Hardness
              </span>
              <select
                className="field !py-1.5"
                disabled={!canEdit}
                value={draft.hardness}
                onChange={(e) =>
                  updateDraft({
                    hardness: e.target.value as ExamPaperHardness,
                  })
                }
              >
                {HARDNESS_LEVELS.map((h) => (
                  <option key={h.code} value={h.code}>
                    {h.label}
                  </option>
                ))}
              </select>
            </label>
            <div className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Class / Subject / Exam
              </span>
              <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 font-semibold">
                {labelClass(draft.classId)} · {labelSubject(draft.subjectId)} ·{" "}
                {labelExam(draft.examTermId)}
              </p>
            </div>
          </div>

          <label className="mt-3 block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              General instructions
            </span>
            <textarea
              className="field min-h-[72px] !py-1.5"
              disabled={!canEdit}
              value={draft.generalInstructions}
              onChange={(e) =>
                updateDraft({ generalInstructions: e.target.value })
              }
            />
          </label>

          <PrintLayoutCard
            draft={draft}
            canEdit={canEdit}
            classLabel={labelClass(draft.classId)}
            subjectLabel={labelSubject(draft.subjectId)}
            onChange={updatePrint}
            onConvertHeader={convertHeaderTo}
            converting={headerConverting}
            convertError={headerConvertError}
          />

          <div className="mt-3 text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">
              Syllabus covered · from Teaching → Syllabus (LO codes drive competency tagging)
            </span>
            {syllabusUnits.length === 0 ? (
              <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--muted)]">
                No chapters in the Teaching plan for this class + subject yet —
                the AI drafts for the whole subject and cannot tag LO codes.
              </p>
            ) : (
              <div className="flex max-h-36 flex-wrap gap-1.5 overflow-y-auto rounded-lg border border-[var(--border)] p-2">
                {syllabusUnits.map((u) => {
                  const on = draft.unitIds.includes(u.id);
                  return (
                    <label
                      key={u.id}
                      className={`inline-flex cursor-pointer items-center gap-1 rounded-full border px-2 py-0.5 text-[11px] ${
                        on
                          ? "border-[var(--brand-deep)] bg-[var(--brand-deep)] text-white"
                          : "border-[var(--border)] text-[var(--brand-deep)]"
                      } ${u.level === "topic" ? "ml-3" : ""}`}
                      title={
                        u.competencyCodes.length
                          ? `LO codes: ${u.competencyCodes.join(", ")}`
                          : "No LO codes recorded for this unit"
                      }
                    >
                      <input
                        type="checkbox"
                        className="sr-only"
                        disabled={!canEdit}
                        checked={on}
                        onChange={() =>
                          updateDraft({
                            unitIds: on
                              ? draft.unitIds.filter((id) => id !== u.id)
                              : [...draft.unitIds, u.id],
                          })
                        }
                      />
                      {u.code ? `${u.code} · ` : ""}
                      {u.title}
                      {u.competencyCodes.length ? (
                        <span className="opacity-70">· {u.competencyCodes.length} LO</span>
                      ) : null}
                    </label>
                  );
                })}
              </div>
            )}
          </div>
        </div>

        {/* Sets + AI */}
        <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
          <div className="flex flex-wrap items-end justify-between gap-3">
            <div>
              <h3 className="text-sm font-bold text-[var(--brand-deep)]">
                Sets (exam day pick)
              </h3>
              <p className="text-[11px] text-[var(--muted)]">
                Create Set A/B/C… Office chooses which set to print on the day.
                Active set marks: {currentMarks}
                {draft.maxMarks ? ` / ${draft.maxMarks}` : ""}.
              </p>
            </div>
            <div className="flex flex-wrap gap-2">
              {draft.sets.map((s) => (
                <button
                  key={s.id}
                  type="button"
                  className={`rounded-lg px-3 py-1.5 text-sm font-bold ${
                    s.setCode === draft.activeSetCode
                      ? "bg-[var(--primary)] text-[var(--primary-foreground)]"
                      : "border border-[var(--border)]"
                  }`}
                  onClick={() => updateDraft({ activeSetCode: s.setCode })}
                >
                  Set {s.setCode}
                </button>
              ))}
              {canEdit ? (
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold"
                  onClick={onAddSet}
                >
                  + Clone set
                </button>
              ) : null}
            </div>
          </div>

          {canEdit ? (
            <div className="mt-3 flex flex-wrap items-end gap-2 rounded-lg bg-[rgba(124,58,237,0.08)] p-3">
              <div>
                <p className="text-[12px] font-bold text-[var(--tone-violet)]">
                  AI paper assistant
                </p>
                <p className="text-[11px] text-[var(--muted)]">
                  Suggests sections + questions by class stage, subject flavour
                  and hardness. You can edit every line after.
                </p>
              </div>
              <select
                className="field !w-auto !py-1 text-sm"
                value={aiHardness}
                onChange={(e) =>
                  setAiHardness(e.target.value as ExamPaperHardness)
                }
              >
                {HARDNESS_LEVELS.map((h) => (
                  <option key={h.code} value={h.code}>
                    {h.label}
                  </option>
                ))}
              </select>
              <button
                type="button"
                className="rounded-lg bg-[var(--tone-violet-solid)] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
                onClick={() => void onAiFill()}
                disabled={aiLoading}
              >
                {aiLoading ? "Drafting…" : "AI draft this set"}
              </button>
              <label className="text-[11px] text-[var(--muted)]">
                &ldquo;+ AI Qs&rdquo; format
                <select
                  className="field mt-0.5 !w-auto !py-1 text-xs"
                  value={aiMoreType}
                  onChange={(e) => setAiMoreType(e.target.value as ExamPaperQuestionType | "")}
                >
                  <option value="">Model&apos;s choice</option>
                  {QUESTION_TYPES.map((t) => (
                    <option key={t.code} value={t.code}>
                      {t.label}
                    </option>
                  ))}
                </select>
              </label>
            </div>
          ) : null}

          <BlueprintPanel
            key={draft.id}
            paper={draft}
            syllabusUnits={syllabusUnits}
            canEdit={canEdit}
            actorName={actorName}
            onGenerated={(sections, unitIds, note) => {
              mutateActiveSet((st) => ({ ...st, sections }));
              if (unitIds.length) {
                updateDraft({ unitIds: Array.from(new Set([...draft.unitIds, ...unitIds])) });
              }
              onNotice(note);
            }}
            onError={onError}
            onNotice={onNotice}
          />
        </div>

        {/* Sections / questions */}
        {set.sections.map((section, sIdx) => (
          <SectionEditor
            key={section.id}
            section={section}
            canEdit={canEdit}
            subjectLabel={labelSubject(draft.subjectId)}
            unitLabel={(id) => {
              const u = syllabusUnits.find((x) => x.id === id);
              return u ? `${u.code ? `${u.code} · ` : ""}${u.title}` : "";
            }}
            index={sIdx}
            onChange={(next) =>
              mutateActiveSet((st) => ({
                ...st,
                sections: st.sections.map((sec) =>
                  sec.id === section.id ? next : sec,
                ),
              }))
            }
            onRemove={() =>
              mutateActiveSet((st) => ({
                ...st,
                sections: st.sections.filter((sec) => sec.id !== section.id),
              }))
            }
            onAiMore={() => onAiMore(section.id)}
            onBankSection={() => bankQuestions(section.questions, section.title)}
            onBankQuestion={(q) => bankQuestions([q], `Q in ${section.title}`)}
            bankPicker={{
              classId: draft.classId,
              subjectId: draft.subjectId,
              excludeTexts: set.sections.flatMap((s) => s.questions.map((q) => q.text)),
              onAdd: (q) =>
                mutateActiveSet((st) => ({
                  ...st,
                  sections: st.sections.map((sec) =>
                    sec.id === section.id ? { ...sec, questions: [...sec.questions, q] } : sec,
                  ),
                })),
            }}
            onAddQuestion={() =>
              mutateActiveSet((st) => ({
                ...st,
                sections: st.sections.map((sec) =>
                  sec.id === section.id
                    ? {
                        ...sec,
                        questions: [
                          ...sec.questions,
                          emptyQuestion({ type: "short", marks: 2 }),
                        ],
                      }
                    : sec,
                ),
              }))
            }
            readImageFile={readImageFile}
          />
        ))}

        {canEdit ? (
          <button
            type="button"
            className="rounded-lg border border-dashed border-[var(--border)] px-4 py-3 text-sm font-semibold"
            onClick={() =>
              mutateActiveSet((st) => ({
                ...st,
                sections: [
                  ...st.sections,
                  emptySection({
                    title: `Section ${String.fromCharCode(65 + st.sections.length)}`,
                  }),
                ],
              }))
            }
          >
            + Add section
          </button>
        ) : null}

        {showPreview ? (
          <div className="space-y-2">
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              Print preview · Set {draft.activeSetCode}
            </h3>
            <ExamPaperPrintSheet
              paper={draft}
              classLabel={labelClass(draft.classId)}
              subjectLabel={labelSubject(draft.subjectId)}
              examLabel={labelExam(draft.examTermId)}
              showAnswers
            />
          </div>
        ) : null}

        {draft.printLog.length ? (
          <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              Print history
            </h3>
            <ul className="mt-2 space-y-1 text-[12px] text-[var(--muted)]">
              {draft.printLog.slice(0, 8).map((e) => (
                <li key={e.id}>
                  {new Date(e.at).toLocaleString()} · Set {e.setCode} ·{" "}
                  {e.count} copies · {e.by || "—"}
                </li>
              ))}
            </ul>
          </div>
        ) : null}
      </div>
    );
  }

  // List view
  return (
    <div className="mt-5 space-y-4">
      <ExamPaperImportPanel
        masters={masters}
        academicYearCode={ay}
        terms={terms}
        canEdit={canEdit}
        actorName={actorName}
        onError={onError}
        onNotice={onNotice}
        onImported={refresh}
      />

      <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
        <h2 className="text-sm font-bold text-[var(--brand-deep)]">
          Question papers · {ay}
        </h2>
        <p className="mt-1 max-w-3xl text-[12px] text-[var(--muted)]">
          Build papers with school logo &amp; name, exam header, duration, max
          marks, sections, formulas, pictures (primary-friendly icons), multiple
          sets for exam day, unique paper codes, and print with copy count.
          Teachers can type, upload images, or start from an AI draft by class
          and hardness.
        </p>

        {canEdit ? (
          <div className="mt-4 grid gap-3 sm:grid-cols-4">
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Exam
              </span>
              <select
                className="field !py-1.5"
                value={newExamTermId}
                onChange={(e) => setNewExamTermId(e.target.value)}
              >
                {terms.map((t) => (
                  <option key={t.id} value={t.id}>
                    {t.code} · {t.label}
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
                value={newClassId}
                onChange={(e) => {
                  setNewClassId(e.target.value);
                  setNewSubjectId("");
                }}
              >
                <option value="">Select…</option>
                {classOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="block text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Subject
              </span>
              <select
                className="field !py-1.5"
                value={newSubjectId}
                disabled={!newClassId}
                onChange={(e) => setNewSubjectId(e.target.value)}
              >
                <option value="">Select…</option>
                {subjectOptions.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.nameEn || s.code}
                  </option>
                ))}
              </select>
            </label>
            <div className="flex items-end">
              <button
                type="button"
                className="btn-accent w-full rounded-lg px-3 py-2 text-sm font-bold"
                onClick={onCreate}
              >
                New paper
              </button>
            </div>
          </div>
        ) : (
          <p className="mt-3 text-[11px] text-[var(--muted)]">
            View only — need Exams → Edit to create papers.
          </p>
        )}
      </div>

      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Class
          </span>
          <select
            className="field !w-auto !py-1.5"
            value={filterClassId}
            onChange={(e) => pickClass(e.target.value)}
          >
            <option value="">All classes</option>
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
            className="field !w-auto !py-1.5"
            value={filterSectionId}
            onChange={(e) => pickSection(e.target.value)}
          >
            <option value="">All sections</option>
            {sectionOptions.map((x) => (
              <option key={x.id} value={x.id}>
                {labelClass(x.classId)} {x.name}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Subject
          </span>
          <select
            className="field !w-auto !py-1.5"
            value={filterSubjectId}
            onChange={(e) => setFilterSubjectId(e.target.value)}
            disabled={!filterSubjectOptions.length && !filterSubjectId}
          >
            <option value="">All subjects</option>
            {filterSubjectOptions.map((x) => (
              <option key={x.id} value={x.id}>
                {x.nameEn || x.code}
              </option>
            ))}
          </select>
        </label>
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Exam
          </span>
          <select
            className="field !w-auto !py-1.5"
            value={filterExamTermId}
            onChange={(e) => setFilterExamTermId(e.target.value)}
            disabled={!filterExamOptions.length && !filterExamTermId}
          >
            <option value="">All exams</option>
            {filterExamOptions.map((t) => (
              <option key={t.id} value={t.id}>
                {t.code} · {t.label}
              </option>
            ))}
          </select>
        </label>
        {filtersOn ? (
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm"
            onClick={clearFilters}
          >
            Clear
          </button>
        ) : null}
        <p className="text-[12px] text-[var(--muted)]">
          {papers.length} of {allPapers.length} paper
          {allPapers.length === 1 ? "" : "s"}
          {filterSectionId ? (
            <span className="ml-1">
              {"· "}a paper is set for the whole class, so a section shows its
              class&rsquo;s papers
            </span>
          ) : null}
        </p>
      </div>

      {papers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted)]">
          {allPapers.length ? (
            <>
              No paper matches these filters. <strong>Clear</strong> them to see
              all {allPapers.length}.
            </>
          ) : (
            <>
              No papers yet for this session. Import your publisher&rsquo;s
              folder above, or create one and use{" "}
              <strong>AI draft this set</strong>.
            </>
          )}
        </p>
      ) : (
        <ul className="space-y-2">
          {papers.map((p) => {
            const set = activeSet(p);
            return (
              <li
                key={p.id}
                className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3"
              >
                <div>
                  <p className="font-semibold text-[var(--brand-deep)]">
                    {p.title}{" "}
                    <span className="text-[11px] font-normal text-[var(--muted)]">
                      · Set {p.activeSetCode} · {setMarks(set)} mk · {p.status}
                    </span>
                  </p>
                  <p className="text-[11px] text-[var(--muted)]">
                    {labelClass(p.classId)} · {labelSubject(p.subjectId)} ·{" "}
                    {labelExam(p.examTermId)} ·{" "}
                    <span className="font-mono">{p.paperCode}</span>
                    {p.printLog.length
                      ? ` · printed ${totalPrintCount(p)}`
                      : ""}
                  </p>
                </div>
                <button
                  type="button"
                  className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold"
                  onClick={() => openEdit(p.id)}
                >
                  Open
                </button>
              </li>
            );
          })}
        </ul>
      )}
    </div>
  );
}

function SectionEditor(props: {
  subjectLabel: string;
  section: ExamPaperSection;
  canEdit: boolean;
  index: number;
  onChange: (s: ExamPaperSection) => void;
  onRemove: () => void;
  onAddQuestion: () => void;
  onAiMore: () => void;
  onBankSection: () => void;
  onBankQuestion: (q: ExamPaperQuestion) => void;
  bankPicker: {
    classId: string;
    subjectId: string;
    excludeTexts: string[];
    onAdd: (q: ExamPaperQuestion) => void;
  };
  readImageFile: (file: File, onDone: (dataUrl: string) => void) => void;
  unitLabel: (unitId: string) => string;
}) {
  const { section, canEdit } = props;
  const [showBank, setShowBank] = useState(false);

  function patchQuestion(qid: string, patch: Partial<ExamPaperQuestion>) {
    props.onChange({
      ...section,
      questions: section.questions.map((q) =>
        q.id === qid ? { ...q, ...patch } : q,
      ),
    });
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-2">
        <div className="min-w-0 flex-1 space-y-2">
          <input
            className="field !py-1.5 font-bold"
            disabled={!canEdit}
            value={section.title}
            onChange={(e) =>
              props.onChange({ ...section, title: e.target.value })
            }
          />
          <input
            className="field !py-1 text-[12px]"
            disabled={!canEdit}
            placeholder="Section instructions (optional)"
            value={section.instructions}
            onChange={(e) =>
              props.onChange({ ...section, instructions: e.target.value })
            }
          />
        </div>
        <div className="text-right text-[11px] text-[var(--muted)]">
          {sectionMarks(section)} marks · {section.questions.length} Q
          {canEdit ? (
            <div className="mt-1 flex flex-wrap justify-end gap-1">
              <button
                type="button"
                className="rounded border border-[rgba(124,58,237,0.3)] px-2 py-0.5 text-[11px] font-semibold text-[var(--tone-violet)]"
                onClick={props.onAiMore}
              >
                + AI Qs
              </button>
              <button
                type="button"
                className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-deep)]"
                onClick={() => setShowBank((v) => !v)}
                title="Add questions from the question bank"
              >
                + From bank
              </button>
              <button
                type="button"
                className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--muted)]"
                onClick={props.onBankSection}
                title="Save every question in this section to the bank"
                disabled={section.questions.length === 0}
              >
                → Bank all
              </button>
              <button
                type="button"
                className="rounded border border-[var(--danger)]/30 px-2 py-0.5 text-[11px] font-semibold text-[var(--danger)]"
                onClick={props.onRemove}
              >
                Remove section
              </button>
            </div>
          ) : null}
        </div>
      </div>

      {showBank && canEdit ? (
        <BankPicker
          classId={props.bankPicker.classId}
          subjectId={props.bankPicker.subjectId}
          excludeTexts={props.bankPicker.excludeTexts}
          unitLabel={props.unitLabel}
          onAdd={props.bankPicker.onAdd}
          onClose={() => setShowBank(false)}
        />
      ) : null}

      <ul className="mt-3 space-y-3">
        {section.questions.map((q, qi) => (
          <QuestionEditor
            key={q.id}
            question={q}
            index={qi}
            canEdit={canEdit}
            subjectLabel={props.subjectLabel}
            unitLabel={props.unitLabel}
            onBank={() => props.onBankQuestion(q)}
            onChange={(patch) => patchQuestion(q.id, patch)}
            onRemove={() =>
              props.onChange({
                ...section,
                questions: section.questions.filter((x) => x.id !== q.id),
              })
            }
            readImageFile={props.readImageFile}
          />
        ))}
      </ul>

      {canEdit ? (
        <button
          type="button"
          className="mt-3 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold"
          onClick={props.onAddQuestion}
        >
          + Add question
        </button>
      ) : null}
    </div>
  );
}

function QuestionEditor(props: {
  question: ExamPaperQuestion;
  index: number;
  canEdit: boolean;
  /** The paper's subject name — picks the formula catalogue. */
  subjectLabel: string;
  onChange: (patch: Partial<ExamPaperQuestion>) => void;
  onRemove: () => void;
  readImageFile: (file: File, onDone: (dataUrl: string) => void) => void;
  /** "Ch 3 · Quadrilaterals" for a unitId, "" when unknown / unlinked */
  unitLabel: (unitId: string) => string;
  onBank: () => void;
}) {
  const { question: q, canEdit } = props;
  const [showIcons, setShowIcons] = useState(false);
  const [showFormulas, setShowFormulas] = useState(false);
  const [showPictureSearch, setShowPictureSearch] = useState(false);
  const [labelling, setLabelling] = useState<string | null>(null);
  const [converting, setConverting] = useState<"hi" | "sa" | null>(null);
  const [convertError, setConvertError] = useState("");
  /** A question with parts is usually just their heading; its own answer fields fold away. */
  const [showOwnFields, setShowOwnFields] = useState(false);

  // A question that is only a heading for its parts has no own text, and
  // both buttons used to be dead on it — the teacher pressed and nothing
  // happened. Anything typed anywhere on the question is enough.
  const hasConvertible = questionHasConvertibleText(q);

  /** Hinglish → Hindi / Sanskrit for every text field of this question. */
  async function convertTo(target: "hi" | "sa") {
    setConvertError("");
    setConverting(target);
    try {
      const texts = questionTransliterationTexts(q);
      const res = await fetch("/api/ai/transliterate", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ texts, target }),
      });
      const body = (await res.json().catch(() => null)) as { texts?: string[]; generationId?: string; error?: string } | null;
      if (!res.ok || !body?.texts) {
        setConvertError(body?.error || `Could not convert (HTTP ${res.status})`);
        return;
      }
      // Applied first — the teacher gets whatever the model did return.
      props.onChange(applyTransliteratedQuestion(q, body.texts));
      // …but "it did nothing" must not read as success. A model that hands
      // back exactly what it was given (already Devanagari, or it simply
      // declined) looks like a dead button, which is how this was reported.
      const unchanged = body.texts.every((t, i) => t === texts[i]);
      if (unchanged) {
        setConvertError(
          "The AI returned the text unchanged — it may already be in Devanagari. Try again, or type it directly.",
        );
        if (body.generationId) reportAiOutcome({ ids: [body.generationId], outcome: "rejected" });
        return;
      }
      if (body.generationId) reportAiOutcome({ ids: [body.generationId], outcome: "accepted" });
    } catch (e) {
      setConvertError(e instanceof Error ? e.message : String(e));
    } finally {
      setConverting(null);
    }
  }

  return (
    <li className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <span className="text-[11px] font-bold text-[var(--muted)]">
          Q{props.index + 1}
        </span>
        <select
          className="field !w-auto !py-1 text-xs"
          disabled={!canEdit}
          value={q.type}
          onChange={(e) =>
            props.onChange(defaultsForType(e.target.value as ExamPaperQuestionType, q))
          }
          title={QUESTION_TYPES.find((t) => t.code === q.type)?.label}
        >
          {QUESTION_TYPES.map((t) => (
            <option key={t.code} value={t.code}>
              {t.label}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1 text-xs">
          Marks
          <input
            type="number"
            className="field !w-16 !py-1"
            disabled={!canEdit || q.subQuestions.length > 0}
            value={q.subQuestions.length > 0 ? questionTotalMarks(q) : q.marks}
            title={q.subQuestions.length > 0 ? "Sum of the sub-questions" : ""}
            onChange={(e) =>
              props.onChange({ marks: Math.max(0, Number(e.target.value) || 0) })
            }
          />
        </label>
        <select
          className="field !w-auto !py-1 text-xs"
          disabled={!canEdit}
          value={q.hardness}
          onChange={(e) =>
            props.onChange({
              hardness: e.target.value as "easy" | "medium" | "hard",
            })
          }
        >
          <option value="easy">Easy</option>
          <option value="medium">Medium</option>
          <option value="hard">Hard</option>
        </select>
        {q.source === "ai" ? (
          <span className="rounded-full bg-[rgba(124,58,237,0.12)] px-2 py-0.5 text-[9px] font-semibold text-[var(--tone-violet)]">
            AI
          </span>
        ) : null}
        {q.source === "bank" ? (
          <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[9px] font-semibold text-[var(--muted)]">
            bank
          </span>
        ) : null}
        {canEdit ? (
          <div className="ml-auto flex items-center gap-2">
            <button
              type="button"
              className="text-[11px] font-semibold text-[var(--muted)] underline"
              onClick={props.onBank}
              title="Save this question to the bank for reuse"
              disabled={!q.text.trim()}
            >
              → Bank
            </button>
            <button
              type="button"
              className="text-sm font-bold text-[var(--danger)]"
              onClick={props.onRemove}
            >
              ×
            </button>
          </div>
        ) : null}
      </div>

      {q.type === "assertion_reason" ? (
        <AssertionReasonFields q={q} canEdit={canEdit} onChange={props.onChange} />
      ) : (
        <textarea
          className="field mt-2 min-h-[64px] !py-1.5 text-sm"
          disabled={!canEdit}
          placeholder={
            q.type === "case_study"
              ? "Passage / data / source the sub-questions are based on…"
              : q.type === "fill"
                ? "Type the sentence with ___ where the blank goes…"
                : q.type === "match"
                  ? "Instruction line, e.g. Match the items in Column A with Column B"
                  : q.type === "diagram"
                    ? "Instruction, e.g. Label the parts of the flower shown"
                    : q.type === "primary_picture"
                      ? "One short line for the child, e.g. Circle the fruits"
                      : "Type the question…"
          }
          value={q.text}
          onChange={(e) => props.onChange({ text: e.target.value })}
        />
      )}

      {q.subQuestions.length > 0 ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px] text-[var(--muted)]">
          <span>
            This question is a heading for its parts
            {q.options.length || q.pairs.length || q.answerKey || q.answerLines ? " — it still carries its own options / key / lines" : ""}.
          </span>
          {canEdit ? (
            <button
              type="button"
              className="font-semibold underline"
              onClick={() => setShowOwnFields((v) => !v)}
            >
              {showOwnFields ? "Hide its own fields" : "Show its own fields"}
            </button>
          ) : null}
          {canEdit && (q.options.length || q.pairs.length || q.answerKey || q.answerLines || q.formulas.length) ? (
            <button
              type="button"
              className="font-semibold text-[var(--danger)] underline"
              onClick={() =>
                props.onChange({ options: [], pairs: [], answerKey: "", answerLines: 0, formulas: [], markingScheme: [] })
              }
              title="Remove the main question's own options, pairs, answer key, answer lines, formulas and marking scheme — the parts keep theirs"
            >
              Clear its own fields
            </button>
          ) : null}
        </div>
      ) : null}
      {q.subQuestions.length === 0 || showOwnFields ? (
        <QuestionTypeFields q={q} canEdit={canEdit} onChange={props.onChange} />
      ) : null}
      <SubQuestionsFields q={q} canEdit={canEdit} onChange={props.onChange} />
      {convertError ? <p className="mt-1 text-[11px] text-[var(--danger)]">{convertError}</p> : null}

      {q.formulas.length ? (
        <ul className="mt-2 space-y-1 font-mono text-xs text-[var(--brand-deep)]">
          {q.formulas.map((f, i) => (
            <li key={i} className="flex items-center gap-2">
              <span>{f}</span>
              {canEdit ? (
                <button
                  type="button"
                  className="text-[var(--danger)]"
                  onClick={() =>
                    props.onChange({
                      formulas: q.formulas.filter((_, j) => j !== i),
                    })
                  }
                >
                  ×
                </button>
              ) : null}
            </li>
          ))}
        </ul>
      ) : null}

      {q.icons.length ? (
        <div className="mt-2 flex flex-wrap gap-2 text-2xl">
          {q.icons.map((ic, i) => (
            <button
              key={i}
              type="button"
              disabled={!canEdit}
              title="Remove icon"
              onClick={() =>
                canEdit &&
                props.onChange({
                  icons: q.icons.filter((_, j) => j !== i),
                })
              }
            >
              {ic}
            </button>
          ))}
        </div>
      ) : null}

      {q.images.length > 1 && canEdit ? (
        <label className="mt-2 inline-flex items-center gap-1 text-[11px] text-[var(--muted)]">
          Pictures in
          <select
            className="field !w-auto !py-0.5 text-[11px]"
            value={q.imageColumns}
            onChange={(e) => props.onChange({ imageColumns: Number(e.target.value) as 1 | 2 | 3 })}
          >
            <option value={1}>1 column</option>
            <option value={2}>2 columns</option>
            <option value={3}>3 columns</option>
          </select>
          (rows wrap on the paper)
        </label>
      ) : null}
      {q.images.length ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {q.images.map((img) => (
            <figure key={img.id} className="relative max-w-[140px]">
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img
                src={img.dataUrl}
                alt=""
                className="max-h-28 rounded border object-contain"
              />
              {img.labels.length ? (
                <span className="absolute bottom-0 left-0 rounded bg-[var(--card)]/90 px-1 text-[10px] font-semibold text-[var(--brand-deep)]">
                  {img.labels.length} label{img.labels.length === 1 ? "" : "s"}
                </span>
              ) : null}
              {canEdit ? (
                <button
                  type="button"
                  className="mt-1 block w-full rounded border border-[var(--border)] px-1 py-0.5 text-[10px] font-semibold"
                  onClick={() => setLabelling(img.id)}
                  title="Draw numbered pointer lines on the picture to ask the names of parts"
                >
                  {img.labels.length ? "Edit labels" : "Label parts"}
                </button>
              ) : null}
              {canEdit ? (
                <button
                  type="button"
                  className="absolute right-0 top-0 rounded bg-[var(--card)]/90 px-1 text-xs font-bold text-[var(--danger)]"
                  onClick={() =>
                    props.onChange({
                      images: q.images.filter((x) => x.id !== img.id),
                    })
                  }
                >
                  ×
                </button>
              ) : null}
            </figure>
          ))}
        </div>
      ) : null}

      {canEdit ? (
        <div className="mt-2 flex flex-wrap gap-2">
          <button
            type="button"
            className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold"
            onClick={() => setShowFormulas((v) => !v)}
          >
            Formulas / symbols
          </button>
          <button
            type="button"
            className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold"
            onClick={() => setShowIcons((v) => !v)}
          >
            Icons list
          </button>
          <label className="cursor-pointer rounded border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold">
            Upload picture
            <input
              type="file"
              accept="image/*"
              className="hidden"
              onChange={(e) => {
                const file = e.target.files?.[0];
                if (!file) return;
                props.readImageFile(file, (dataUrl) => {
                  props.onChange({
                    images: [
                      ...q.images,
                      {
                        id: `img_${Math.random().toString(36).slice(2, 8)}`,
                        dataUrl,
                        caption: "",
                        labels: [],
                      },
                    ],
                  });
                });
                e.target.value = "";
              }}
            />
          </label>
          <button
            type="button"
            className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold"
            onClick={() => setShowPictureSearch(true)}
            title="Find a free, licensed picture (Wikimedia Commons)"
          >
            Search pictures
          </button>
          <button
            type="button"
            className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold"
            disabled={converting !== null || !hasConvertible}
            onClick={() => void convertTo("hi")}
            title="Typed in Hinglish? Convert this question (text, options, pairs, sub-questions, key) to Hindi"
          >
            {converting === "hi" ? "Converting…" : "Hinglish → हिंदी"}
          </button>
          <button
            type="button"
            className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold"
            disabled={converting !== null || !hasConvertible}
            onClick={() => void convertTo("sa")}
            title="Convert this question to Sanskrit"
          >
            {converting === "sa" ? "Converting…" : "→ संस्कृतम्"}
          </button>
          {q.type !== "mcq" && q.type !== "assertion_reason" && q.type !== "true_false" && q.type !== "match" ? (
            <input
              className="field !inline-block !w-48 !py-0.5 text-[11px]"
              placeholder={
                q.type === "fill"
                  ? "Blank answers, in order (comma-separated)"
                  : q.type === "numerical"
                    ? "Final answer with unit"
                    : "Answer key (teacher)"
              }
              value={q.answerKey}
              onChange={(e) => props.onChange({ answerKey: e.target.value })}
            />
          ) : null}
          {q.answerLines > 0 || defaultAnswerLinesFor(q.type) > 0 ? (
            <label className="inline-flex items-center gap-1 text-[11px]">
              Answer lines
              <input
                type="number"
                min={0}
                max={40}
                className="field !w-14 !py-0.5 text-[11px]"
                value={q.answerLines}
                onChange={(e) => props.onChange({ answerLines: Math.max(0, Math.min(40, Number(e.target.value) || 0)) })}
                title="Ruled lines printed under the question on the student copy"
              />
            </label>
          ) : null}
        </div>
      ) : null}

      {canEdit || q.competencyCode || q.bloomLevel || q.markingScheme.length ? (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-[11px]">
          <input
            className="field !inline-block !w-24 !py-0.5 text-[11px] uppercase"
            placeholder="LO code"
            title="CBSE learning-outcome code this item assesses (from the Syllabus tab)"
            disabled={!canEdit}
            value={q.competencyCode}
            onChange={(e) => props.onChange({ competencyCode: e.target.value.toUpperCase() })}
          />
          <select
            className="field !inline-block !w-auto !py-0.5 text-[11px]"
            disabled={!canEdit}
            value={q.bloomLevel}
            onChange={(e) =>
              props.onChange({ bloomLevel: e.target.value as ExamPaperQuestion["bloomLevel"] })
            }
            title="Bloom's level"
          >
            <option value="">Bloom —</option>
            {BLOOM_LEVELS.map((b) => (
              <option key={b.code} value={b.code}>
                {b.label}
              </option>
            ))}
          </select>
          {props.unitLabel(q.unitId) ? (
            <span className="rounded-full border border-[var(--border)] px-2 py-0.5 text-[var(--muted)]">
              {props.unitLabel(q.unitId)}
            </span>
          ) : null}
          <textarea
            className="field min-h-[28px] !flex-1 !py-0.5 text-[11px]"
            rows={Math.max(1, Math.min(4, q.markingScheme.length || 1))}
            placeholder="Marking scheme (teacher copy) — one step per line, e.g. formula 1 · substitution 1 · answer 1"
            disabled={!canEdit}
            value={q.markingScheme.join("\n")}
            onChange={(e) =>
              props.onChange({
                markingScheme: e.target.value.split("\n").map((l) => l.trimEnd()),
              })
            }
            onBlur={() =>
              props.onChange({ markingScheme: q.markingScheme.map((l) => l.trim()).filter(Boolean) })
            }
          />
        </div>
      ) : null}

      {showFormulas && canEdit ? (
        <FormulaCatalogPanel
          subjectLabel={props.subjectLabel}
          onInsert={(insert) =>
            props.onChange({
              text: q.text ? `${q.text} ${insert}` : insert,
              formulas: q.formulas.includes(insert) ? q.formulas : [...q.formulas, insert],
            })
          }
          onAddLine={(line) => props.onChange({ formulas: [...q.formulas, line] })}
        />
      ) : null}

      {showPictureSearch && canEdit ? (
        <PictureSearchDialog
          onClose={() => setShowPictureSearch(false)}
          onPick={(dataUrl, caption) => {
            props.onChange({
              images: [...q.images, { id: `img_${Math.random().toString(36).slice(2, 8)}`, dataUrl, caption, labels: [] }],
            });
            setShowPictureSearch(false);
          }}
        />
      ) : null}

      {labelling && canEdit ? (
        (() => {
          const img = q.images.find((x) => x.id === labelling);
          return img ? (
            <ImageLabelEditor
              image={img}
              onClose={() => setLabelling(null)}
              onSave={(labels) => {
                props.onChange({ images: q.images.map((x) => (x.id === img.id ? { ...x, labels } : x)) });
                setLabelling(null);
              }}
            />
          ) : null;
        })()
      ) : null}

      {showIcons && canEdit ? (
        <div className="mt-2 rounded-lg bg-[var(--card)] p-2">
          <p className="mb-1 text-[10px] text-[var(--muted)]">
            Primary classes — tap icons to attach (multiple allowed).
          </p>
          <div className="flex flex-wrap gap-1">
            {PRIMARY_ICON_BANK.map((item) => (
              <button
                key={item.icon}
                type="button"
                title={item.label}
                className="rounded border border-[var(--border)] px-1.5 py-0.5 text-xl hover:bg-[var(--surface-sunken)]"
                onClick={() =>
                  props.onChange({ icons: [...q.icons, item.icon] })
                }
              >
                {item.icon}
              </button>
            ))}
          </div>
        </div>
      ) : null}
    </li>
  );
}


function defaultAnswerLinesFor(type: ExamPaperQuestionType): number {
  return type === "short" || type === "long" || type === "numerical" || type === "competency" || type === "diagram" ? 1 : 0;
}

/** Assertion (A) and Reason (R) as two fields, stored in `text` the way the
 * board writes it; the four CBSE choices follow, with the correct one picked. */
function AssertionReasonFields({
  q,
  canEdit,
  onChange,
}: {
  q: ExamPaperQuestion;
  canEdit: boolean;
  onChange: (patch: Partial<ExamPaperQuestion>) => void;
}) {
  const m = /Assertion \(A\):\s*([\s\S]*?)\n?Reason \(R\):\s*([\s\S]*)$/.exec(q.text);
  const assertion = m ? m[1]!.trim() : q.text;
  const reason = m ? m[2]!.trim() : "";
  const write = (a: string, r: string) => onChange({ text: `Assertion (A): ${a}\nReason (R): ${r}` });
  return (
    <div className="mt-2 space-y-1">
      <textarea
        className="field min-h-[40px] !py-1.5 text-sm"
        disabled={!canEdit}
        placeholder="Assertion (A)…"
        value={assertion}
        onChange={(e) => write(e.target.value, reason)}
      />
      <textarea
        className="field min-h-[40px] !py-1.5 text-sm"
        disabled={!canEdit}
        placeholder="Reason (R)…"
        value={reason}
        onChange={(e) => write(assertion, e.target.value)}
      />
    </div>
  );
}

/** The fields each question type needs beyond its text. */
function QuestionTypeFields({
  q,
  canEdit,
  onChange,
}: {
  q: ExamPaperQuestion;
  canEdit: boolean;
  onChange: (patch: Partial<ExamPaperQuestion>) => void;
}) {
  const optionRows = (labelFor: (i: number) => string, pickCorrect: boolean, minWanted = 2, max = 6) => {
    // A heading with parts may drop all of its own options.
    const min = q.subQuestions.length > 0 ? 0 : minWanted;
    return (
    <div className="mt-2 space-y-1">
      {q.options.map((opt, i) => (
        <div key={i} className="flex items-center gap-2">
          {pickCorrect ? (
            <input
              type="radio"
              name={`correct-${q.id}`}
              checked={!!opt && q.answerKey === opt}
              disabled={!canEdit || !opt}
              onChange={() => onChange({ answerKey: opt })}
              title="Correct option"
              aria-label={`Option ${labelFor(i)} is correct`}
            />
          ) : null}
          <span className="w-6 text-xs text-[var(--muted)]">({labelFor(i)})</span>
          <input
            className="field !py-1 text-xs"
            disabled={!canEdit}
            placeholder={`Option ${labelFor(i)}`}
            value={opt}
            onChange={(e) => {
              const options = [...q.options];
              const wasKey = q.answerKey === opt && !!opt;
              options[i] = e.target.value;
              onChange({ options, ...(wasKey ? { answerKey: e.target.value } : {}) });
            }}
          />
          {canEdit && q.options.length > min ? (
            <button
              type="button"
              className="text-xs text-[var(--danger)]"
              onClick={() => onChange({ options: q.options.filter((_, j) => j !== i) })}
              aria-label={`Remove option ${labelFor(i)}`}
            >
              ×
            </button>
          ) : null}
        </div>
      ))}
      <div className="flex flex-wrap items-center gap-3 text-[10px] text-[var(--muted)]">
        {canEdit && q.options.length < max ? (
          <button
            type="button"
            className="text-[11px] font-semibold text-[var(--muted)] underline"
            onClick={() => onChange({ options: [...q.options, ""] })}
          >
            + option
          </button>
        ) : null}
        {pickCorrect && q.options.length ? <span>{q.answerKey ? `Correct: ${q.answerKey}` : "Tick the correct option"}</span> : null}
        {canEdit && min === 0 && q.options.length > 0 ? (
          <button
            type="button"
            className="text-[11px] font-semibold text-[var(--danger)] underline"
            onClick={() => onChange({ options: [], answerKey: "" })}
            title="The parts carry their own options; the heading needs none"
          >
            Remove all options
          </button>
        ) : null}
        {q.type === "mcq" ? (
          <label className="inline-flex items-center gap-1">
            Print options in
            <select
              className="field !w-auto !py-0.5 text-[10px]"
              disabled={!canEdit}
              value={q.optionColumns}
              onChange={(e) => onChange({ optionColumns: Number(e.target.value) as 0 | 1 | 2 | 3 | 4 | 5 })}
              aria-label="Option columns"
            >
              <option value={0}>auto ({autoOptionColumns(q.options)} col by length)</option>
              {[1, 2, 3, 4, 5].map((n) => (
                <option key={n} value={n}>
                  {n} {n === 1 ? "column" : "columns"}
                </option>
              ))}
            </select>
          </label>
        ) : null}
      </div>
    </div>
    );
  };

  switch (q.type) {
    case "mcq":
      return optionRows((i) => String.fromCharCode(97 + i), true);
    case "assertion_reason":
      return (
        <div>
          {optionRows((i) => String.fromCharCode(97 + i), true, 4, 4)}
          {canEdit && q.options.join("|") !== ASSERTION_REASON_OPTIONS.join("|") ? (
            <button
              type="button"
              className="mt-1 text-[11px] font-semibold text-[var(--muted)] underline"
              onClick={() => onChange({ options: ASSERTION_REASON_OPTIONS })}
            >
              Reset to the four CBSE choices
            </button>
          ) : null}
        </div>
      );
    case "true_false":
      return (
        <div className="mt-2 flex items-center gap-4 text-xs">
          <span className="text-[var(--muted)]">Correct answer:</span>
          {(["True", "False"] as const).map((v) => (
            <label key={v} className="inline-flex items-center gap-1">
              <input
                type="radio"
                name={`tf-${q.id}`}
                disabled={!canEdit}
                checked={q.answerKey === v}
                onChange={() => onChange({ answerKey: v })}
              />
              {v}
            </label>
          ))}
        </div>
      );
    case "fill":
      return (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          {canEdit ? (
            <button
              type="button"
              className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold"
              onClick={() => onChange({ text: `${q.text}${q.text.endsWith(" ") || !q.text ? "" : " "}___ ` })}
            >
              Insert blank ___
            </button>
          ) : null}
          <span className="text-[var(--muted)]">
            {(q.text.match(/___/g) ?? []).length} blank{(q.text.match(/___/g) ?? []).length === 1 ? "" : "s"}
          </span>
          <input
            className="field !inline-block !w-64 !py-0.5 text-[11px]"
            disabled={!canEdit}
            placeholder="Word bank (optional, comma-separated)"
            value={q.options.join(", ")}
            onChange={(e) => onChange({ options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
          />
        </div>
      );
    case "match":
      return (
        <div className="mt-2 space-y-1">
          <div className="grid grid-cols-[1.5rem_1fr_1fr_auto] gap-2 text-[10px] uppercase tracking-wide text-[var(--muted)]">
            <span />
            <span>Column A</span>
            <span>Column B (matching)</span>
            <span />
          </div>
          {q.pairs.map((pair, i) => (
            <div key={i} className="grid grid-cols-[1.5rem_1fr_1fr_auto] items-center gap-2">
              <span className="text-xs text-[var(--muted)]">{i + 1}.</span>
              <input
                className="field !py-1 text-xs"
                disabled={!canEdit}
                value={pair.left}
                placeholder="Item"
                onChange={(e) => onChange({ pairs: q.pairs.map((x, j) => (j === i ? { ...x, left: e.target.value } : x)) })}
                aria-label={`Pair ${i + 1} column A`}
              />
              <input
                className="field !py-1 text-xs"
                disabled={!canEdit}
                value={pair.right}
                placeholder="Its match"
                onChange={(e) => onChange({ pairs: q.pairs.map((x, j) => (j === i ? { ...x, right: e.target.value } : x)) })}
                aria-label={`Pair ${i + 1} column B`}
              />
              {canEdit && q.pairs.length > 2 ? (
                <button type="button" className="text-xs text-[var(--danger)]" onClick={() => onChange({ pairs: q.pairs.filter((_, j) => j !== i) })} aria-label={`Remove pair ${i + 1}`}>
                  ×
                </button>
              ) : (
                <span />
              )}
            </div>
          ))}
          {canEdit && q.pairs.length < 8 ? (
            <button type="button" className="text-[11px] font-semibold text-[var(--muted)] underline" onClick={() => onChange({ pairs: [...q.pairs, { left: "", right: "" }] })}>
              + pair
            </button>
          ) : null}
          <p className="text-[10px] text-[var(--muted)]">Column B prints shuffled; the teacher copy shows the key (1-c, 2-a …).</p>
        </div>
      );
    case "diagram":
      return (
        <div className="mt-2 flex flex-wrap items-center gap-2 text-xs">
          <span className="text-[var(--muted)]">Labels to mark:</span>
          <input
            className="field !inline-block !w-72 !py-0.5 text-[11px]"
            disabled={!canEdit}
            placeholder="e.g. Stamen, Pistil, Petal (comma-separated)"
            value={q.options.join(", ")}
            onChange={(e) => onChange({ options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
          />
          {q.images.length === 0 ? <span className="text-[10px] text-[var(--danger)]">Upload or search a picture below, then &ldquo;Label parts&rdquo; to draw the pointer lines.</span> : null}
        </div>
      );
    case "primary_picture":
      return (
        <p className="mt-2 text-[10px] text-[var(--muted)]">
          Add a picture or icons below; keep the line short. {q.images.length === 0 && q.icons.length === 0 ? "No picture or icons yet." : ""}
        </p>
      );
    case "numerical":
      return (
        <p className="mt-2 text-[10px] text-[var(--muted)]">
          Put the final answer with its unit in the answer key and the step marks in the marking scheme.
        </p>
      );
    default:
      return null;
  }
}

/**
 * Sub-questions (i), (ii), (iii)… under any main question — a passage with
 * parts, "attempt any three", a long question in steps. Main questions
 * keep 1, 2, 3; parts take (i), (ii)…; MCQ options stay (a), (b)…. When
 * parts exist they set the question's marks.
 */
function SubQuestionsFields({
  q,
  canEdit,
  onChange,
}: {
  q: ExamPaperQuestion;
  canEdit: boolean;
  onChange: (patch: Partial<ExamPaperQuestion>) => void;
}) {
  const roman = (i: number) => ["i", "ii", "iii", "iv", "v", "vi", "vii", "viii", "ix", "x"][i] ?? String(i + 1);
  const setSub = (i: number, patch: Partial<ExamSubQuestion>) =>
    onChange({ subQuestions: q.subQuestions.map((x, j) => (j === i ? { ...x, ...patch } : x)) });
  const addSub = () => {
    const last = q.subQuestions[q.subQuestions.length - 1];
    // A new part copies the previous part's type and marks — six MCQ parts
    // in a row is the common case.
    onChange({ subQuestions: [...q.subQuestions, emptySubQuestion(last?.type ?? "short", last?.marks ?? 1)] });
  };

  if (q.subQuestions.length === 0) {
    if (!canEdit) return null;
    return (
      <button
        type="button"
        className="mt-2 text-[11px] font-semibold text-[var(--muted)] underline"
        onClick={addSub}
      >
        + Add sub-question (i), (ii)…
      </button>
    );
  }
  return (
    <div className="mt-2 space-y-1.5">
      <div className="flex flex-wrap items-center gap-3">
        <p className="text-[10px] uppercase tracking-wide text-[var(--muted)]">Sub-questions</p>
        <label className="inline-flex items-center gap-1 text-[11px] text-[var(--muted)]">
          Attempt any
          <input
            type="number"
            min={0}
            max={q.subQuestions.length}
            className="field !w-14 !py-0.5 text-[11px]"
            disabled={!canEdit}
            value={q.attemptAny}
            onChange={(e) => onChange({ attemptAny: Math.max(0, Math.min(20, Number(e.target.value) || 0)) })}
            aria-label="Attempt any N sub-questions"
            title="0 = all parts compulsory"
          />
          of {q.subQuestions.length}
        </label>
      </div>
      {q.subQuestions.map((sq, i) => (
        <div key={i} className="rounded border border-[var(--border)] p-1.5">
          <div className="grid grid-cols-[2.2rem_auto_1fr_4rem_auto] items-center gap-2">
            <span className="text-xs text-[var(--muted)]">({roman(i)})</span>
            <select
              className="field !w-auto !py-1 text-[11px]"
              disabled={!canEdit}
              value={sq.type}
              onChange={(e) => {
                const fresh = emptySubQuestion(e.target.value as ExamPaperQuestionType, sq.marks);
                setSub(i, { type: fresh.type, options: fresh.options, pairs: fresh.pairs, answerKey: fresh.answerKey });
              }}
              aria-label={`Sub-question ${i + 1} type`}
            >
              {SUB_QUESTION_TYPES.map((t) => (
                <option key={t} value={t}>
                  {QUESTION_TYPES.find((x) => x.code === t)?.short ?? t}
                </option>
              ))}
            </select>
            <input
              className="field !py-1 text-xs"
              disabled={!canEdit}
              value={sq.text}
              placeholder={sq.type === "fill" ? "Sentence with ___ for the blank" : "Sub-question"}
              onChange={(e) => setSub(i, { text: e.target.value })}
              aria-label={`Sub-question ${i + 1}`}
            />
            <input
              type="number"
              min={0}
              className="field !py-1 text-xs"
              disabled={!canEdit}
              value={sq.marks}
              onChange={(e) => setSub(i, { marks: Math.max(0, Number(e.target.value) || 0) })}
              aria-label={`Sub-question ${i + 1} marks`}
            />
            {canEdit ? (
              <button type="button" className="text-xs text-[var(--danger)]" onClick={() => onChange({ subQuestions: q.subQuestions.filter((_, j) => j !== i) })} aria-label={`Remove sub-question ${i + 1}`}>
                ×
              </button>
            ) : (
              <span />
            )}
          </div>
          {sq.type === "mcq" || sq.type === "assertion_reason" ? (
            <div className="ml-9 mt-1 grid gap-1 sm:grid-cols-2">
              {sq.options.map((opt, k) => (
                <div key={k} className="flex items-center gap-1.5">
                  <input
                    type="radio"
                    name={`sub-correct-${q.id}-${i}`}
                    checked={!!opt && sq.answerKey === opt}
                    disabled={!canEdit || !opt}
                    onChange={() => setSub(i, { answerKey: opt })}
                    title="Correct option"
                    aria-label={`Sub-question ${i + 1} option ${String.fromCharCode(97 + k)} is correct`}
                  />
                  <span className="w-5 text-[11px] text-[var(--muted)]">({String.fromCharCode(97 + k)})</span>
                  <input
                    className="field !py-0.5 text-[11px]"
                    disabled={!canEdit}
                    value={opt}
                    placeholder={`Option ${String.fromCharCode(97 + k)}`}
                    onChange={(e) => {
                      const options = [...sq.options];
                      const wasKey = !!opt && sq.answerKey === opt;
                      options[k] = e.target.value;
                      setSub(i, { options, ...(wasKey ? { answerKey: e.target.value } : {}) });
                    }}
                    aria-label={`Sub-question ${i + 1} option ${String.fromCharCode(97 + k)}`}
                  />
                  {canEdit && sq.type === "mcq" && sq.options.length > 2 ? (
                    <button type="button" className="text-[11px] text-[var(--danger)]" onClick={() => setSub(i, { options: sq.options.filter((_, m) => m !== k) })} aria-label={`Remove option ${String.fromCharCode(97 + k)}`}>
                      ×
                    </button>
                  ) : null}
                </div>
              ))}
              {canEdit && sq.type === "mcq" && sq.options.length < 6 ? (
                <button type="button" className="justify-self-start text-[11px] font-semibold text-[var(--muted)] underline" onClick={() => setSub(i, { options: [...sq.options, ""] })}>
                  + option
                </button>
              ) : null}
            </div>
          ) : sq.type === "true_false" ? (
            <div className="ml-9 mt-1 flex items-center gap-3 text-[11px]">
              <span className="text-[var(--muted)]">Correct:</span>
              {(["True", "False"] as const).map((v) => (
                <label key={v} className="inline-flex items-center gap-1">
                  <input type="radio" name={`sub-tf-${q.id}-${i}`} disabled={!canEdit} checked={sq.answerKey === v} onChange={() => setSub(i, { answerKey: v })} />
                  {v}
                </label>
              ))}
            </div>
          ) : sq.type === "match" ? (
            <div className="ml-9 mt-1 space-y-1">
              <div className="grid grid-cols-[1.5rem_1fr_1fr_auto] gap-2 text-[10px] uppercase tracking-wide text-[var(--muted)]">
                <span />
                <span>Column A</span>
                <span>Column B</span>
                <span />
              </div>
              {sq.pairs.map((pair, k) => (
                <div key={k} className="grid grid-cols-[1.5rem_1fr_1fr_auto] items-center gap-2">
                  <span className="text-[11px] text-[var(--muted)]">{k + 1}.</span>
                  <input
                    className="field !py-0.5 text-[11px]"
                    disabled={!canEdit}
                    value={pair.left}
                    placeholder="Item"
                    onChange={(e) => setSub(i, { pairs: sq.pairs.map((x, m) => (m === k ? { ...x, left: e.target.value } : x)) })}
                    aria-label={`Sub-question ${i + 1} pair ${k + 1} column A`}
                  />
                  <input
                    className="field !py-0.5 text-[11px]"
                    disabled={!canEdit}
                    value={pair.right}
                    placeholder="Its match"
                    onChange={(e) => setSub(i, { pairs: sq.pairs.map((x, m) => (m === k ? { ...x, right: e.target.value } : x)) })}
                    aria-label={`Sub-question ${i + 1} pair ${k + 1} column B`}
                  />
                  {canEdit && sq.pairs.length > 2 ? (
                    <button type="button" className="text-[11px] text-[var(--danger)]" onClick={() => setSub(i, { pairs: sq.pairs.filter((_, m) => m !== k) })} aria-label={`Remove pair ${k + 1}`}>
                      ×
                    </button>
                  ) : (
                    <span />
                  )}
                </div>
              ))}
              {canEdit && sq.pairs.length < 8 ? (
                <button type="button" className="text-[11px] font-semibold text-[var(--muted)] underline" onClick={() => setSub(i, { pairs: [...sq.pairs, { left: "", right: "" }] })}>
                  + pair
                </button>
              ) : null}
              <p className="text-[10px] text-[var(--muted)]">Column B prints shuffled; the teacher copy shows the key.</p>
            </div>
          ) : sq.type === "diagram" ? (
            <div className="ml-9 mt-1 flex flex-wrap items-center gap-2 text-[11px]">
              <span className="text-[var(--muted)]">Labels to mark:</span>
              <input
                className="field !inline-block !w-72 !py-0.5 text-[11px]"
                disabled={!canEdit}
                value={sq.options.join(", ")}
                placeholder="e.g. Stamen, Pistil, Petal (comma-separated)"
                onChange={(e) => setSub(i, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                aria-label={`Sub-question ${i + 1} labels`}
              />
              <input
                className="field !inline-block !w-56 !py-0.5 text-[11px]"
                disabled={!canEdit}
                value={sq.answerKey}
                placeholder="Answer key (teacher)"
                onChange={(e) => setSub(i, { answerKey: e.target.value })}
                aria-label={`Sub-question ${i + 1} answer key`}
              />
              <span className="text-[10px] text-[var(--muted)]">Uses the question&apos;s picture above.</span>
            </div>
          ) : (
            <div className="ml-9 mt-1 flex flex-wrap items-center gap-2">
              <input
                className="field !inline-block !w-64 !py-0.5 text-[11px]"
                disabled={!canEdit}
                value={sq.answerKey}
                placeholder={sq.type === "fill" ? "Blank answers, in order" : sq.type === "numerical" ? "Final answer with unit" : "Answer key (teacher)"}
                onChange={(e) => setSub(i, { answerKey: e.target.value })}
                aria-label={`Sub-question ${i + 1} answer key`}
              />
              {sq.type === "fill" ? (
                <input
                  className="field !inline-block !w-56 !py-0.5 text-[11px]"
                  disabled={!canEdit}
                  value={sq.options.join(", ")}
                  placeholder="Word bank (optional)"
                  onChange={(e) => setSub(i, { options: e.target.value.split(",").map((x) => x.trim()).filter(Boolean) })}
                  aria-label={`Sub-question ${i + 1} word bank`}
                />
              ) : null}
            </div>
          )}
        </div>
      ))}
      {canEdit && q.subQuestions.length < 10 ? (
        <button type="button" className="text-[11px] font-semibold text-[var(--muted)] underline" onClick={addSub}>
          + sub-question
        </button>
      ) : null}
      <p className="text-[10px] text-[var(--muted)]">
        Total {questionTotalMarks(q)} marks
        {q.attemptAny > 0 && q.attemptAny < q.subQuestions.length ? ` (best ${q.attemptAny} of ${q.subQuestions.length})` : ""} — the sub-questions set the question&apos;s marks.
      </p>
    </div>
  );
}

/**
 * Formulas and symbols for the paper's subject: the catalogue's groups for
 * that subject (Maths, Physics, Hindi matras…), a search box over them, and
 * an AI search for anything missing — the teacher picks; nothing is saved
 * until inserted.
 */
function FormulaCatalogPanel({
  subjectLabel,
  onInsert,
  onAddLine,
}: {
  subjectLabel: string;
  onInsert: (insert: string) => void;
  onAddLine: (line: string) => void;
}) {
  const all = useMemo(() => catalogFor(subjectLabel), [subjectLabel]);
  const groups = useMemo(() => groupsFor(all), [all]);
  const [group, setGroup] = useState<string>("");
  const [query, setQuery] = useState("");
  const [aiItems, setAiItems] = useState<{ insert: string; label: string; note: string }[] | null>(null);
  const [aiBusy, setAiBusy] = useState(false);
  const [aiError, setAiError] = useState("");

  const shown = useMemo(() => {
    const searched = searchCatalog(all, query);
    if (query.trim() || !group) return searched;
    return searched.filter((f) => `${f.subject}::${f.group}` === group);
  }, [all, group, query]);

  async function askAi() {
    setAiBusy(true);
    setAiError("");
    setAiItems(null);
    try {
      const res = await fetch("/api/ai/exam-symbols", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ query, subject: subjectLabel }),
      });
      const body = (await res.json().catch(() => null)) as { items?: { insert: string; label: string; note: string }[]; error?: string } | null;
      if (!res.ok || !body?.items) {
        setAiError(body?.error || `Search failed (HTTP ${res.status})`);
        return;
      }
      setAiItems(body.items);
    } catch (e) {
      setAiError(e instanceof Error ? e.message : String(e));
    } finally {
      setAiBusy(false);
    }
  }

  const chip = (f: { insert: string; label: string; title?: string }) => (
    <button
      key={`${f.label}|${f.insert}`}
      type="button"
      title={f.title || f.insert}
      className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[11px] hover:bg-[var(--surface-sunken)]"
      onClick={() => onInsert(f.insert)}
    >
      {f.label}
    </button>
  );

  return (
    <div className="mt-2 space-y-2 rounded-lg bg-[var(--card)] p-2">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-[10px] text-[var(--muted)]">
          {subjectLabel ? `${subjectLabel} — ` : ""}tap to insert into the question. Groups:
        </p>
        <select className="field !w-auto !py-0.5 text-[11px]" value={group} onChange={(e) => setGroup(e.target.value)} aria-label="Formula group">
          <option value="">All ({all.length})</option>
          {groups.map((g) => (
            <option key={`${g.subject}::${g.group}`} value={`${g.subject}::${g.group}`}>
              {subjectKeyLabel(g.subject)} · {g.group}
            </option>
          ))}
        </select>
        <input
          className="field !w-56 !py-0.5 text-[11px]"
          placeholder="Search formulas / symbols…"
          value={query}
          onChange={(e) => setQuery(e.target.value)}
          aria-label="Search formulas"
        />
        <button
          type="button"
          className="rounded border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold disabled:opacity-50"
          disabled={aiBusy || query.trim().length < 2}
          onClick={() => void askAi()}
          title="Not in the list? Ask the AI for the formula or symbol"
        >
          {aiBusy ? "Searching…" : "Search with AI"}
        </button>
      </div>
      <div className="flex max-h-48 flex-wrap gap-1 overflow-y-auto">
        {shown.slice(0, 200).map((f: FormulaEntry) => chip({ insert: f.insert, label: f.label, title: `${f.group} · ${f.insert}` }))}
        {shown.length === 0 ? <span className="text-[11px] text-[var(--muted)]">Nothing matches — try &ldquo;Search with AI&rdquo;.</span> : null}
      </div>
      {aiError ? <p className="text-[11px] text-[var(--danger)]">{aiError}</p> : null}
      {aiItems ? (
        <div className="rounded border border-[var(--border)] p-2">
          <p className="text-[10px] text-[var(--muted)]">AI suggestions — check before you insert:</p>
          <div className="mt-1 flex flex-wrap gap-1">
            {aiItems.map((it) => chip({ insert: it.insert, label: it.label || it.insert, title: it.note || it.insert }))}
            {aiItems.length === 0 ? <span className="text-[11px] text-[var(--muted)]">No suggestions.</span> : null}
          </div>
        </div>
      ) : null}
      <input
        className="field !py-1 font-mono text-xs"
        placeholder="Or type a custom formula line and press Enter"
        onKeyDown={(e) => {
          if (e.key !== "Enter") return;
          const v = (e.target as HTMLInputElement).value.trim();
          if (!v) return;
          onAddLine(v);
          (e.target as HTMLInputElement).value = "";
        }}
      />
    </div>
  );
}

type PictureHit = { id: string; title: string; thumbUrl: string; license: string; author: string; pageUrl: string };

/** Free, licensed pictures from Wikimedia Commons; the credit becomes the caption. */
function PictureSearchDialog({
  onClose,
  onPick,
}: {
  onClose: () => void;
  onPick: (dataUrl: string, caption: string) => void;
}) {
  const [query, setQuery] = useState("");
  const [hits, setHits] = useState<PictureHit[]>([]);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState("");
  const [picking, setPicking] = useState<string | null>(null);

  async function search() {
    setBusy(true);
    setError("");
    try {
      const res = await fetch(`/api/exam-papers/picture-search?q=${encodeURIComponent(query)}`);
      const body = (await res.json().catch(() => null)) as { results?: PictureHit[]; error?: string } | null;
      if (!res.ok || !body?.results) {
        setError(body?.error || `Search failed (HTTP ${res.status})`);
        return;
      }
      setHits(body.results);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy(false);
    }
  }

  async function pick(h: PictureHit) {
    setPicking(h.id);
    setError("");
    try {
      const res = await fetch("/api/exam-papers/picture-fetch", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ url: h.thumbUrl }),
      });
      const body = (await res.json().catch(() => null)) as { dataUrl?: string; error?: string } | null;
      if (!res.ok || !body?.dataUrl) {
        setError(body?.error || `Could not fetch (HTTP ${res.status})`);
        return;
      }
      const credit = [h.author, h.license].filter(Boolean).join(" · ");
      onPick(body.dataUrl, credit ? `Source: Wikimedia Commons (${credit})` : "Source: Wikimedia Commons");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setPicking(null);
    }
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Search pictures">
      <div className="max-h-[90vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-[var(--card)] p-4 shadow-xl">
        <div className="flex flex-wrap items-center gap-2">
          <input
            className="field flex-1 !py-1.5 text-sm"
            placeholder="e.g. human heart diagram, neem leaf, water cycle"
            value={query}
            autoFocus
            onChange={(e) => setQuery(e.target.value)}
            onKeyDown={(e) => {
              if (e.key === "Enter" && query.trim().length >= 2) void search();
            }}
          />
          <button type="button" className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50" disabled={busy || query.trim().length < 2} onClick={() => void search()}>
            {busy ? "Searching…" : "Search"}
          </button>
          <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold" onClick={onClose}>
            Close
          </button>
        </div>
        <p className="mt-1 text-[10px] text-[var(--muted)]">
          Free pictures from Wikimedia Commons (openly licensed). The credit is added as the caption; keep it on the paper.
        </p>
        {error ? <p className="mt-2 text-xs text-[var(--danger)]">{error}</p> : null}
        <div className="mt-3 grid grid-cols-2 gap-3 sm:grid-cols-4">
          {hits.map((h) => (
            <button
              key={h.id}
              type="button"
              className="rounded-lg border border-[var(--border)] p-1 text-left hover:bg-[var(--surface-sunken)] disabled:opacity-50"
              disabled={picking !== null}
              onClick={() => void pick(h)}
              title={h.title}
            >
              {/* eslint-disable-next-line @next/next/no-img-element */}
              <img src={h.thumbUrl} alt={h.title} className="h-28 w-full rounded object-contain" />
              <span className="mt-1 block truncate text-[10px] text-[var(--muted)]">{picking === h.id ? "Adding…" : h.license || "licensed"}</span>
            </button>
          ))}
        </div>
      </div>
    </div>
  );
}

/**
 * Draw numbered pointer lines on a picture: click a part to place its dot,
 * the number sits in the margin; drag either end to adjust. Positions are
 * fractions of the picture, so the paper draws the same lines at any size.
 */
function ImageLabelEditor({
  image,
  onClose,
  onSave,
}: {
  image: ExamPaperImage;
  onClose: () => void;
  onSave: (labels: ExamPaperImageLabel[]) => void;
}) {
  const [labels, setLabels] = useState<ExamPaperImageLabel[]>(image.labels);
  const [drag, setDrag] = useState<{ n: number; end: "dot" | "num" } | null>(null);
  const boxRef = useRef<HTMLDivElement | null>(null);

  const frac = (e: { clientX: number; clientY: number }) => {
    const r = boxRef.current?.getBoundingClientRect();
    if (!r || r.width === 0) return { x: 0, y: 0 };
    return { x: Math.max(0, Math.min(1, (e.clientX - r.left) / r.width)), y: Math.max(0, Math.min(1, (e.clientY - r.top) / r.height)) };
  };

  function addAt(e: React.MouseEvent) {
    if (drag) return;
    const { x, y } = frac(e);
    const n = labels.length + 1;
    // Number goes to the nearer margin on the same line.
    const lx = x < 0.5 ? 0.06 : 0.94;
    setLabels([...labels, { n, x, y, lx, ly: y }]);
  }

  function move(e: React.MouseEvent) {
    if (!drag) return;
    const { x, y } = frac(e);
    setLabels((prev) => prev.map((l) => (l.n === drag.n ? (drag.end === "dot" ? { ...l, x, y } : { ...l, lx: x, ly: y }) : l)));
  }

  function remove(n: number) {
    setLabels((prev) => prev.filter((l) => l.n !== n).map((l, i) => ({ ...l, n: i + 1 })));
  }

  return (
    <div className="fixed inset-0 z-50 flex items-center justify-center bg-black/50 p-4" role="dialog" aria-modal="true" aria-label="Label parts of the picture">
      <div className="max-h-[92vh] w-full max-w-3xl overflow-y-auto rounded-xl bg-[var(--card)] p-4 shadow-xl">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <p className="text-sm font-semibold text-[var(--brand-deep)]">Label parts — click a part to add a numbered pointer; drag a dot or a number to move it</p>
          <div className="flex gap-2">
            <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold" onClick={() => setLabels([])}>
              Clear all
            </button>
            <button type="button" className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold" onClick={onClose}>
              Cancel
            </button>
            <button type="button" className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold" onClick={() => onSave(labels)}>
              Save labels
            </button>
          </div>
        </div>
        <div
          ref={boxRef}
          className="relative mt-3 inline-block max-w-full cursor-crosshair select-none"
          onClick={addAt}
          onMouseMove={move}
          onMouseUp={() => setDrag(null)}
          onMouseLeave={() => setDrag(null)}
        >
          {/* eslint-disable-next-line @next/next/no-img-element */}
          <img src={image.dataUrl} alt="" className="max-h-[70vh] w-auto max-w-full rounded border border-[var(--border)]" draggable={false} />
          <svg className="pointer-events-none absolute inset-0 h-full w-full" viewBox="0 0 100 100" preserveAspectRatio="none" aria-hidden>
            {labels.map((l) => (
              <line key={l.n} x1={l.x * 100} y1={l.y * 100} x2={l.lx * 100} y2={l.ly * 100} stroke="#b42318" strokeWidth={0.6} vectorEffect="non-scaling-stroke" />
            ))}
          </svg>
          {labels.map((l) => (
            <span key={`dot-${l.n}`}>
              <span
                className="absolute h-3 w-3 -translate-x-1/2 -translate-y-1/2 cursor-move rounded-full border-2 border-white bg-[#b42318]"
                style={{ left: `${l.x * 100}%`, top: `${l.y * 100}%` }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDrag({ n: l.n, end: "dot" });
                }}
                onClick={(e) => e.stopPropagation()}
                title={`Dot ${l.n} — drag to move`}
              />
              <span
                className="absolute flex h-6 w-6 -translate-x-1/2 -translate-y-1/2 cursor-move items-center justify-center rounded-full border border-[#b42318] bg-white text-[11px] font-bold text-[#b42318]"
                style={{ left: `${l.lx * 100}%`, top: `${l.ly * 100}%` }}
                onMouseDown={(e) => {
                  e.stopPropagation();
                  setDrag({ n: l.n, end: "num" });
                }}
                onClick={(e) => e.stopPropagation()}
                onDoubleClick={(e) => {
                  e.stopPropagation();
                  remove(l.n);
                }}
                title={`Label ${l.n} — drag to move, double-click to remove`}
              >
                {l.n}
              </span>
            </span>
          ))}
        </div>
        <p className="mt-2 text-[10px] text-[var(--muted)]">
          {labels.length} label{labels.length === 1 ? "" : "s"}. The paper prints the lines with the numbers and a blank list &ldquo;1. ____ 2. ____&rdquo; under the picture; put the answers in the answer key.
        </p>
      </div>
    </div>
  );
}


/* ─── Print layout ───────────────────────────────────────────────── */

function PrintLayoutCard(props: {
  draft: ExamPaper;
  canEdit: boolean;
  classLabel: string;
  subjectLabel: string;
  onChange: (patch: Partial<ExamPaperPrintSettings>) => void;
  onConvertHeader: (target: "hi" | "sa") => void;
  converting: boolean;
  convertError: string;
}) {
  const { draft, canEdit, classLabel, subjectLabel, onChange, converting, convertError } = props;
  const s = draft.print;
  const lang = resolveLanguage(s, subjectLabel);
  const autoLang = languageForSubject(subjectLabel);
  const autoScale = fontScaleForClass(classLabel);
  const layout = PAPER_LAYOUTS.find((l) => l.code === s.layout);
  const scriptName = lang === "sa" ? "संस्कृतम्" : "हिंदी";
  return (
    <div className="mt-3 rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3 text-sm">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[13px] font-bold text-[var(--brand-deep)]">Print layout</h3>
        <p className="text-[11px] text-[var(--muted)]">
          Bold is kept for the school name, exam name, section titles and question numbers; marks sit in brackets at the right; instructions are smaller.
        </p>
      </div>
      <div className="mt-2 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
        <label className="block">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Paper size</span>
          <select className="field !py-1.5" disabled={!canEdit} value={s.pageSize} onChange={(e) => onChange({ pageSize: e.target.value as ExamPaperPrintSettings["pageSize"] })}>
            {PAGE_SIZES.map((p) => (
              <option key={p.code} value={p.code}>
                {p.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block lg:col-span-2">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Layout</span>
          <select className="field !py-1.5" disabled={!canEdit} value={s.layout} onChange={(e) => onChange({ layout: e.target.value as ExamPaperPrintSettings["layout"] })}>
            {PAPER_LAYOUTS.map((l) => (
              <option key={l.code} value={l.code}>
                {l.label}
              </option>
            ))}
          </select>
          {layout ? <span className="mt-1 block text-[11px] text-[var(--muted)]">{layout.hint}</span> : null}
        </label>
        {s.layout === "booklet" ? (
          <label className="block">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Printer flips the sheet on</span>
            <select className="field !py-1.5" disabled={!canEdit} value={s.duplexFlip} onChange={(e) => onChange({ duplexFlip: e.target.value as ExamPaperPrintSettings["duplexFlip"] })}>
              <option value="short">Short edge (usual for landscape)</option>
              <option value="long">Long edge</option>
            </select>
            <span className="mt-1 block text-[11px] text-[var(--muted)]">Wrong choice = back pages upside down. Test one sheet first.</span>
          </label>
        ) : null}
        <label className="block">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Type size</span>
          <select className="field !py-1.5" disabled={!canEdit} value={s.fontScale} onChange={(e) => onChange({ fontScale: e.target.value as ExamPaperPrintSettings["fontScale"] })}>
            {FONT_SCALES.map((f) => (
              <option key={f.code} value={f.code}>
                {f.code === "auto" ? `Auto by class → ${autoScale === "large" ? "Large" : autoScale === "normal" ? "Medium" : "Standard"} for ${classLabel}` : f.label}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Paper language</span>
          <select className="field !py-1.5" disabled={!canEdit} value={s.language} onChange={(e) => onChange({ language: e.target.value as ExamPaperPrintSettings["language"] })}>
            {PAPER_LANGUAGES.map((l) => (
              <option key={l.code} value={l.code}>
                {l.code === "auto" ? `Auto by subject → ${autoLang === "hi" ? "हिंदी" : autoLang === "sa" ? "संस्कृतम्" : "English"}` : l.label}
              </option>
            ))}
          </select>
          <span className="mt-1 block text-[11px] text-[var(--muted)]">Labels (Class, Subject, Max marks, Section, Column A/B…) and the subject name follow it.</span>
        </label>
      </div>

      {lang !== "en" ? (
        <div className="mt-3 rounded-lg border border-[var(--border)] bg-[var(--card)] p-3">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <p className="text-[12px] font-semibold text-[var(--brand-deep)]">Header in {scriptName}</p>
            {canEdit ? (
              <button
                type="button"
                className="btn-accent !py-1 text-[12px]"
                disabled={converting}
                onClick={() => props.onConvertHeader(lang)}
                title="School name, address, exam name, paper title, general instructions and section titles → this script (AI). Edit the result below."
              >
                {converting ? "Converting…" : `Convert header & instructions → ${scriptName}`}
              </button>
            ) : null}
          </div>
          {convertError ? <p className="mt-1 text-[11px] text-[var(--danger)]">{convertError}</p> : null}
          <div className="mt-2 grid gap-2 sm:grid-cols-2">
            {(
              [
                ["schoolName", "School name", schoolHeaderDefaults().schoolName],
                ["address", "Address line", schoolHeaderDefaults().address],
                ["examName", "Exam name", draft.examName],
                ["title", "Paper title", draft.title],
              ] as const
            ).map(([k, label, fallback]) => (
              <label key={k} className="block">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">{label}</span>
                <input
                  className="field !py-1.5"
                  disabled={!canEdit}
                  value={s.header[k]}
                  placeholder={fallback ? `Blank = ${fallback}` : "Blank = English default"}
                  onChange={(e) => onChange({ header: { ...s.header, [k]: e.target.value } })}
                />
              </label>
            ))}
          </div>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            Affiliation number, school code, paper code and marks stay in figures. Question text converts per question with the Hinglish → {scriptName} button.
          </p>
        </div>
      ) : null}
    </div>
  );
}
