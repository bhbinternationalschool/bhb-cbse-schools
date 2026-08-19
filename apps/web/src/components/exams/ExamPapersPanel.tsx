"use client";

import { useEffect, useMemo, useState } from "react";
import type { MastersState } from "@/lib/masters";
import type { ExamTerm } from "@/lib/exams";
import {
  FORMULA_PALETTE,
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
} from "@/lib/examPapers";
import { loadTeaching, type SyllabusUnit } from "@/lib/teaching";
import { BlueprintPanel } from "@/components/exams/BlueprintPanel";
import { BankPicker } from "@/components/exams/BankPicker";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
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

  const papers = useMemo(() => {
    void tick;
    return listExamPapers(ay, {
      classId: filterClassId || undefined,
    });
  }, [ay, filterClassId, tick]);

  const classOptions = useMemo(
    () => masters.classes.filter((c) => c.isActive),
    [masters],
  );

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
                <p className="text-[12px] font-bold text-[#6d28d9]">
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
                className="rounded-lg bg-[#6d28d9] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
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

      <div className="flex flex-wrap items-end gap-3">
        <label className="block text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Filter by class
          </span>
          <select
            className="field !w-auto !py-1.5"
            value={filterClassId}
            onChange={(e) => setFilterClassId(e.target.value)}
          >
            <option value="">All</option>
            {classOptions.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
        </label>
        <p className="text-[12px] text-[var(--muted)]">
          {papers.length} paper(s)
        </p>
      </div>

      {papers.length === 0 ? (
        <p className="rounded-xl border border-dashed border-[var(--border)] p-6 text-sm text-[var(--muted)]">
          No papers yet for this session. Create one, then use{" "}
          <strong>AI draft this set</strong> or add sections manually.
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
                className="rounded border border-[rgba(124,58,237,0.3)] px-2 py-0.5 text-[11px] font-semibold text-[#6d28d9]"
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
            props.onChange({
              type: e.target.value as ExamPaperQuestionType,
            })
          }
        >
          {QUESTION_TYPES.map((t) => (
            <option key={t.code} value={t.code}>
              {t.short}
            </option>
          ))}
        </select>
        <label className="inline-flex items-center gap-1 text-xs">
          Marks
          <input
            type="number"
            className="field !w-16 !py-1"
            disabled={!canEdit}
            value={q.marks}
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
          <span className="rounded-full bg-[rgba(124,58,237,0.12)] px-2 py-0.5 text-[9px] font-semibold text-[#6d28d9]">
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

      <textarea
        className="field mt-2 min-h-[64px] !py-1.5 text-sm"
        disabled={!canEdit}
        placeholder="Type the question…"
        value={q.text}
        onChange={(e) => props.onChange({ text: e.target.value })}
      />

      {q.type === "mcq" ? (
        <div className="mt-2 space-y-1">
          {(q.options.length ? q.options : ["", "", "", ""]).map((opt, i) => (
            <input
              key={i}
              className="field !py-1 text-xs"
              disabled={!canEdit}
              placeholder={`Option ${String.fromCharCode(97 + i)}`}
              value={opt}
              onChange={(e) => {
                const options = [...(q.options.length ? q.options : ["", "", "", ""])];
                options[i] = e.target.value;
                props.onChange({ options });
              }}
            />
          ))}
        </div>
      ) : null}

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
                      },
                    ],
                  });
                });
                e.target.value = "";
              }}
            />
          </label>
          <input
            className="field !inline-block !w-40 !py-0.5 text-[11px]"
            placeholder="Answer key (teacher)"
            value={q.answerKey}
            onChange={(e) => props.onChange({ answerKey: e.target.value })}
          />
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
        <div className="mt-2 space-y-2 rounded-lg bg-[var(--card)] p-2">
          <p className="text-[10px] text-[var(--muted)]">
            Tap to insert into question text or as a formula line.
          </p>
          <div className="flex flex-wrap gap-1">
            {FORMULA_PALETTE.map((f) => (
              <button
                key={f.label + f.insert}
                type="button"
                title={f.group}
                className="rounded border border-[var(--border)] px-1.5 py-0.5 font-mono text-[11px] hover:bg-[var(--surface-sunken)]"
                onClick={() => {
                  props.onChange({
                    text: q.text ? `${q.text} ${f.insert}` : f.insert,
                    formulas: q.formulas.includes(f.insert)
                      ? q.formulas
                      : [...q.formulas, f.insert],
                  });
                }}
              >
                {f.label}
              </button>
            ))}
          </div>
          <input
            className="field !py-1 font-mono text-xs"
            placeholder="Or type a custom formula line and press Enter"
            onKeyDown={(e) => {
              if (e.key !== "Enter") return;
              const v = (e.target as HTMLInputElement).value.trim();
              if (!v) return;
              props.onChange({ formulas: [...q.formulas, v] });
              (e.target as HTMLInputElement).value = "";
            }}
          />
        </div>
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
