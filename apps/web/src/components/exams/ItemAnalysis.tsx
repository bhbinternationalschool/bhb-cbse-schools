"use client";

/**
 * Below the item-score grid: what the saved marks say about the class.
 * Roll-ups by unit / LO code / Bloom level / question type / question,
 * weakest first; the students under half in a chosen bucket (the remedial
 * group); AI teaching moves; and a remedial worksheet saved as a draft
 * question paper. Reads the saved sheet, never the unsaved grid — what the
 * teacher sees here is what is on record.
 */

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import { findMarkSheet, type ExamTerm } from "@/lib/exams";
import {
  createExamPaper,
  emptySection,
  saveExamPaper,
  questionTypeLabel,
  type ExamPaper,
  type ExamPaperQuestion,
} from "@/lib/examPapers";
import { loadTeaching } from "@/lib/teaching";
import {
  indexItemScores,
  rollupItemScores,
  studentsBelowHalf,
  type PedagogyDraft,
  type PedagogyFacts,
  type RollupDimension,
  type RollupRow,
} from "@/lib/itemAnalytics";
import type { SisStudent } from "@/lib/sis";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";

const DIMENSIONS: { id: RollupDimension; label: string }[] = [
  { id: "unit", label: "Chapter / topic" },
  { id: "competency", label: "LO code" },
  { id: "bloom", label: "Bloom level" },
  { id: "type", label: "Question type" },
  { id: "question", label: "Question" },
];

export function ItemAnalysis(props: {
  ay: string;
  term: ExamTerm;
  classId: string;
  sectionId: string;
  paper: ExamPaper;
  setCode: string;
  questions: ExamPaperQuestion[];
  roster: SisStudent[];
  classLabel: string;
  subjectName: string;
  canEdit: boolean;
  enteredBy: string;
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
  onPaperCreated: () => void;
}) {
  const { ay, term, sectionId, paper, setCode, questions, roster } = props;
  const [dimension, setDimension] = useState<RollupDimension>("unit");
  const [selectedKey, setSelectedKey] = useState<string>("");
  const [aiBusy, setAiBusy] = useState<"suggest" | "worksheet" | null>(null);
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [pedagogy, setPedagogy] = useState<(PedagogyDraft & { model: string; generationId: string }) | null>(null);

  const units = useMemo(() => {
    const all = loadTeaching().units;
    return new Map(all.map((u) => [u.id, u]));
  }, []);
  const unitLabel = (id: string) => {
    const u = units.get(id);
    return u ? `${u.code ? `${u.code} · ` : ""}${u.title}` : "";
  };

  const scoresByStudent = useMemo(() => {
    const sheet = findMarkSheet(ay, term.id, sectionId);
    return indexItemScores(sheet?.itemScores ?? [], paper.id, setCode);
  }, [ay, term.id, sectionId, paper.id, setCode]);
  const studentsMarked = scoresByStudent.size;

  const rows = useMemo(
    () => rollupItemScores({ questions, scoresByStudent, dimension, unitLabel }),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [questions, scoresByStudent, dimension, units],
  );
  const selected = rows.find((r) => r.key === selectedKey) ?? null;
  const below = selected
    ? studentsBelowHalf({ questions, scoresByStudent, questionIds: selected.questionIds })
    : [];

  const weakAll = useMemo(() => {
    // Weak buckets across the actionable dimensions (not per-question noise).
    const out: RollupRow[] = [];
    for (const d of ["unit", "competency", "bloom", "type"] as RollupDimension[]) {
      out.push(...rollupItemScores({ questions, scoresByStudent, dimension: d, unitLabel }).filter((r) => r.weak));
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [questions, scoresByStudent, units]);

  if (studentsMarked === 0) {
    return (
      <p className="rounded-xl border border-dashed border-[var(--border)] px-4 py-4 text-center text-xs text-[var(--muted)]">
        Analysis appears once item scores are saved for this paper.
      </p>
    );
  }

  const qById = new Map(questions.map((q) => [q.id, q]));

  async function suggest() {
    if (aiBusy) return;
    setAiBusy("suggest");
    try {
      const strong = rollupItemScores({ questions, scoresByStudent, dimension: "unit", unitLabel })
        .filter((r) => r.students >= 3 && r.avgPct >= 75)
        .slice(-3)
        .map((r) => ({ dimension: r.dimension, label: r.label, avgPct: r.avgPct }));
      const facts: PedagogyFacts = {
        classLabel: props.classLabel,
        subjectName: props.subjectName || paper.subjectId,
        examLabel: term.label,
        studentsMarked,
        weak: weakAll.slice(0, 8).map((r) => ({
          dimension: r.dimension,
          label: r.label,
          avgPct: r.avgPct,
          belowHalfShare: r.belowHalfShare,
          sampleQuestions: r.questionIds.slice(0, 2).map((id) => qById.get(id)?.text ?? "").filter(Boolean),
        })),
        strong,
        teacherNote: "",
      };
      const res = await fetch("/api/ai/pedagogy-suggestions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, facts }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; draft?: PedagogyDraft; model?: string; generationId?: string };
      if (!res.ok || !json.ok || !json.draft) {
        props.onError(json.error || "Suggestions failed");
        return;
      }
      setPedagogy({ ...json.draft, model: json.model || "", generationId: json.generationId || "" });
    } catch (e) {
      props.onError(e instanceof Error ? e.message : "Suggestions failed");
    } finally {
      setAiBusy(null);
    }
  }

  async function worksheet() {
    if (aiBusy) return;
    setAiBusy("worksheet");
    try {
      const weakUnitIds = new Set(weakAll.filter((r) => r.dimension === "unit").map((r) => r.key));
      const weakCodes = new Set(weakAll.filter((r) => r.dimension === "competency").map((r) => r.key));
      // Units to draw from: weak units, plus units of weak-LO questions.
      for (const q of questions) if (weakCodes.has(q.competencyCode) && q.unitId) weakUnitIds.add(q.unitId);
      const unitFacts = [...weakUnitIds]
        .map((id) => units.get(id))
        .filter((u): u is NonNullable<typeof u> => !!u)
        .map((u) => ({
          id: u.id,
          code: u.code,
          title: u.title,
          level: u.level,
          learningOutcomes: u.learningOutcomes,
          competencyCodes: u.competencyCodes,
        }));
      const weakLabels = weakAll.slice(0, 6).map((r) => `${r.label} (${Math.round(r.avgPct)}%)`);
      const res = await fetch("/api/ai/remedial-worksheet", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ classId: props.classId, subjectId: paper.subjectId, units: unitFacts, weakLabels, count: 8 }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; questions?: ExamPaperQuestion[]; generationId?: string };
      if (!res.ok || !json.ok || !json.questions?.length) {
        props.onError(json.error || "Worksheet failed");
        return;
      }
      // Save as a draft question paper under the same exam so it prints like any paper.
      const created = createExamPaper({
        academicYearCode: ay,
        examTermId: term.id,
        classId: props.classId,
        subjectId: paper.subjectId,
        title: `Remedial worksheet — ${weakAll.slice(0, 2).map((r) => r.label).join(", ") || props.subjectName}`,
        examName: `${term.label} · remedial`,
        durationMinutes: 40,
        maxMarks: json.questions.reduce((a, q) => a + q.marks, 0),
        hardness: "medium",
        createdBy: props.enteredBy,
      });
      if (!created.ok) {
        props.onError(created.error);
        return;
      }
      const draft: ExamPaper = {
        ...created.paper,
        unitIds: [...weakUnitIds],
        sets: [
          {
            ...created.paper.sets[0],
            sections: [
              emptySection({
                title: "Practice",
                instructions: "Attempt all. Show your working.",
                questions: json.questions,
              }),
            ],
          },
        ],
      };
      const saved = saveExamPaper(draft, props.enteredBy);
      if (!saved.ok) {
        props.onError(saved.error);
        return;
      }
      if (json.generationId) {
        reportAiOutcome({ ids: [json.generationId], outcome: "accepted", targetType: "exam_paper", targetId: saved.paper.id });
      }
      props.onPaperCreated();
      props.onFlash(`Remedial worksheet saved as draft paper ${saved.paper.paperCode} — open it under Question papers to edit and print`);
    } catch (e) {
      props.onError(e instanceof Error ? e.message : "Worksheet failed");
    } finally {
      setAiBusy(null);
    }
  }

  return (
    <div className="space-y-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <p className="text-sm font-semibold text-[var(--brand-deep)]">Where the class stood</p>
        <span className="text-[11px] text-[var(--muted)]">
          {studentsMarked} of {roster.length} students marked · weak = class average under 50 % with 5+ marked
        </span>
        <div className="ml-auto flex flex-wrap items-center gap-2">
          <select
            className="field !w-auto !py-1 text-xs"
            value={dimension}
            onChange={(e) => {
              setDimension(e.target.value as RollupDimension);
              setSelectedKey("");
            }}
          >
            {DIMENSIONS.map((d) => (
              <option key={d.id} value={d.id}>
                By {d.label.toLowerCase()}
              </option>
            ))}
          </select>
          {props.canEdit ? (
            <>
              <select className="field !w-auto !py-1 text-xs" value={language} onChange={(e) => setLanguage(e.target.value as "en" | "hi")}>
                <option value="en">English</option>
                <option value="hi">हिंदी</option>
              </select>
              <button
                type="button"
                disabled={!!aiBusy || weakAll.length === 0}
                onClick={() => void suggest()}
                className="inline-flex items-center gap-1 rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-deep)] disabled:opacity-50"
                title={weakAll.length === 0 ? "No weak area yet — nothing to advise on" : "3–6 teaching moves for the weak areas"}
              >
                <Sparkles className="h-3.5 w-3.5" />
                {aiBusy === "suggest" ? "Thinking…" : "Teaching moves"}
              </button>
              <button
                type="button"
                disabled={!!aiBusy || weakAll.length === 0}
                onClick={() => void worksheet()}
                className="inline-flex items-center gap-1 rounded-lg bg-[var(--primary)] px-2.5 py-1 text-xs font-bold text-[var(--primary-foreground)] disabled:opacity-50"
                title="Drafts 8 practice questions on the weak units / LO codes and saves them as a draft question paper"
              >
                <Sparkles className="h-3.5 w-3.5" />
                {aiBusy === "worksheet" ? "Drafting…" : "Remedial worksheet"}
              </button>
            </>
          ) : null}
        </div>
      </div>

      {rows.length === 0 ? (
        <p className="text-xs text-[var(--muted)]">
          No question on this paper is tagged by {DIMENSIONS.find((d) => d.id === dimension)?.label.toLowerCase()} — tag questions in the paper editor (or pick a
          different view).
        </p>
      ) : (
        <div className="grid gap-3 lg:grid-cols-[1.4fr_1fr]">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="py-1 text-left">Area</th>
                <th className="py-1 text-right">Marks</th>
                <th className="py-1 text-right">Marked</th>
                <th className="py-1 text-right">Class avg</th>
                <th className="py-1 text-right">Under ½</th>
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr
                  key={r.key}
                  onClick={() => setSelectedKey(r.key === selectedKey ? "" : r.key)}
                  className={`cursor-pointer border-t border-[var(--border)] ${selectedKey === r.key ? "bg-[var(--surface-sunken)]" : ""}`}
                >
                  <td className="py-1.5 pr-2">
                    {r.label}
                    {r.weak ? <span className="ml-1 rounded-full bg-[var(--danger)]/15 px-1.5 text-[10px] font-bold text-[var(--danger)]">weak</span> : null}
                    <span className="ml-1 text-[10px] text-[var(--muted)]">
                      {r.questionIds.map((id) => `Q${questions.findIndex((q) => q.id === id) + 1}`).join(" ")}
                    </span>
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{r.maxMarks}</td>
                  <td className="py-1.5 text-right tabular-nums">{r.students}</td>
                  <td className={`py-1.5 text-right font-semibold tabular-nums ${r.students && r.avgPct < 50 ? "text-[var(--danger)]" : ""}`}>
                    {r.students ? `${Math.round(r.avgPct)}%` : "—"}
                  </td>
                  <td className="py-1.5 text-right tabular-nums">{r.students ? `${Math.round(r.belowHalfShare * 100)}%` : "—"}</td>
                </tr>
              ))}
            </tbody>
          </table>

          <div className="rounded-lg bg-[var(--surface-sunken)] p-2 text-xs">
            {selected ? (
              <>
                <p className="font-semibold">
                  {selected.label} — students under half ({below.length})
                </p>
                <p className="mb-1 text-[10px] text-[var(--muted)]">
                  {selected.questionIds
                    .map((id) => qById.get(id))
                    .filter(Boolean)
                    .map((q) => `${questionTypeLabel(q!.type)}${q!.competencyCode ? ` · ${q!.competencyCode}` : ""}`)
                    .join(" · ")}
                </p>
                {below.length === 0 ? (
                  <p className="text-[var(--muted)]">Nobody under half here.</p>
                ) : (
                  <ul className="max-h-40 space-y-0.5 overflow-y-auto">
                    {below.map((s) => {
                      const st = roster.find((x) => x.id === s.studentId);
                      return (
                        <li key={s.studentId} className="flex justify-between gap-2">
                          <span>{st?.fullName ?? s.studentId}</span>
                          <span className="tabular-nums text-[var(--muted)]">
                            {s.obtained}/{s.max}
                          </span>
                        </li>
                      );
                    })}
                  </ul>
                )}
              </>
            ) : (
              <p className="text-[var(--muted)]">Tap an area to see who needs the remedial group.</p>
            )}
          </div>
        </div>
      )}

      {pedagogy ? (
        <div className="rounded-lg border border-[var(--border)] p-3 text-sm">
          <p className="mb-1 text-[11px] font-bold uppercase tracking-wide text-[var(--muted)]">
            Teaching moves · AI draft{pedagogy.model ? ` · ${pedagogy.model}` : ""}
          </p>
          <ol className="list-decimal space-y-1 pl-5" lang={language === "hi" ? "hi" : undefined}>
            {pedagogy.suggestions.map((sug, i) => (
              <li key={i}>{sug}</li>
            ))}
          </ol>
          {pedagogy.remedialFocus ? (
            <p className="mt-2 text-xs text-[var(--muted)]" lang={language === "hi" ? "hi" : undefined}>
              <strong>Remedial focus:</strong> {pedagogy.remedialFocus}
            </p>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
