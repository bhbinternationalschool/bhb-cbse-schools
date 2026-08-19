"use client";

/**
 * Blueprint editor + generator for one question paper (class × subject).
 * Rows = the blueprint matrix (unit · type · marks each · count · hardness
 * · LO code). "Generate" fills the active set: bank items first (least
 * used, exact match on type/marks/unit/LO/hardness), then one AI call per
 * still-empty cell. Blueprints save per class × subject so next term's
 * paper starts from the same pattern.
 */

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  assembleSectionsFromCells,
  blueprintTotalMarks,
  fillBlueprintFromBank,
  HARDNESS_LEVELS,
  listBlueprints,
  loadExamPapers,
  matchBankForRow,
  QUESTION_TYPES,
  removeBlueprint,
  saveExamPapers,
  upsertBlueprint,
  type ExamBlueprint,
  type ExamBlueprintRow,
  type ExamPaper,
  type ExamPaperQuestion,
  type ExamPaperQuestionType,
  type ExamPaperSection,
} from "@/lib/examPapers";
import type { SyllabusUnit } from "@/lib/teaching";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";

function nid() {
  return `bpr_${Math.random().toString(36).slice(2, 10)}`;
}

function blankRow(): ExamBlueprintRow {
  return { id: nid(), unitId: "", questionType: "mcq", marks: 1, count: 5, hardness: "mixed", competencyCode: "" };
}

export function BlueprintPanel(props: {
  paper: ExamPaper;
  syllabusUnits: SyllabusUnit[];
  canEdit: boolean;
  actorName: string;
  /** Replace the active set's sections with generated ones */
  onGenerated: (sections: ExamPaperSection[], unitIds: string[], note: string) => void;
  onError: (msg: string) => void;
  onNotice: (msg: string) => void;
}) {
  const { paper, syllabusUnits, canEdit } = props;
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ExamBlueprintRow[]>([]);
  const [title, setTitle] = useState("");
  const [blueprintId, setBlueprintId] = useState("");
  const [busy, setBusy] = useState(false);
  const [tick, setTick] = useState(0);

  const saved = useMemo(() => {
    void tick;
    return listBlueprints(loadExamPapers(), {
      academicYearCode: paper.academicYearCode,
      classId: paper.classId,
      subjectId: paper.subjectId,
    });
  }, [paper.academicYearCode, paper.classId, paper.subjectId, tick]);

  // Load the most recent saved blueprint for this class × subject once.
  useEffect(() => {
    if (rows.length > 0 || saved.length === 0) return;
    const latest = [...saved].sort((a, b) => b.updatedAt.localeCompare(a.updatedAt))[0];
    setRows(latest.rows.map((r) => ({ ...r })));
    setTitle(latest.title);
    setBlueprintId(latest.id);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [saved]);

  const total = blueprintTotalMarks({ rows });
  const bankState = useMemo(() => {
    void tick;
    return loadExamPapers();
  }, [tick]);
  const ctx = { classId: paper.classId, subjectId: paper.subjectId };
  const bankAvail = (row: ExamBlueprintRow) => matchBankForRow(bankState, ctx, row).length;

  function patchRow(id: string, patch: Partial<ExamBlueprintRow>) {
    setRows((prev) => prev.map((r) => (r.id === id ? { ...r, ...patch } : r)));
  }

  function save() {
    const r = upsertBlueprint(loadExamPapers(), {
      id: blueprintId || undefined,
      academicYearCode: paper.academicYearCode,
      classId: paper.classId,
      subjectId: paper.subjectId,
      examTermId: paper.examTermId,
      title: title.trim() || `${paper.examName || "Exam"} pattern`,
      rows,
      by: props.actorName,
    });
    if (!r.ok) return props.onError(r.error);
    saveExamPapers(r.state);
    setBlueprintId(r.blueprint.id);
    setTick((t) => t + 1);
    props.onNotice(`Blueprint saved · ${blueprintTotalMarks(r.blueprint)} marks`);
  }

  function load(bp: ExamBlueprint) {
    setRows(bp.rows.map((r) => ({ ...r })));
    setTitle(bp.title);
    setBlueprintId(bp.id);
  }

  function drop(bp: ExamBlueprint) {
    saveExamPapers(removeBlueprint(loadExamPapers(), bp.id));
    if (bp.id === blueprintId) setBlueprintId("");
    setTick((t) => t + 1);
    props.onNotice("Blueprint removed");
  }

  async function generate() {
    if (busy || !canEdit) return;
    const usable = rows.filter((r) => r.marks > 0 && r.count > 0);
    if (usable.length === 0) return props.onError("Add at least one row with marks and count");
    setBusy(true);
    try {
      // 1. Bank first.
      const filled = fillBlueprintFromBank(loadExamPapers(), ctx, usable);
      const fromBank = filled.cells.reduce((a, c) => a + c.taken.length, 0);
      const gaps = filled.cells.filter((c) => c.missing > 0);
      const byRow = new Map(filled.cells.map((c) => [c.row.id, [...c.taken]]));
      let engineNote = "";
      // 2. AI for what is still missing.
      if (gaps.length > 0) {
        const unitFacts = syllabusUnits.map((u) => ({
          id: u.id,
          code: u.code,
          title: u.title,
          level: u.level,
          learningOutcomes: u.learningOutcomes,
          competencyCodes: u.competencyCodes,
        }));
        const res = await fetch("/api/ai/exam-paper", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({
            mode: "blueprint",
            classId: paper.classId,
            subjectId: paper.subjectId,
            units: unitFacts,
            cells: gaps.map((c) => ({
              rowId: c.row.id,
              type: c.row.questionType,
              marks: c.row.marks,
              count: c.missing,
              hardness: c.row.hardness,
              unitId: c.row.unitId,
              competencyCode: c.row.competencyCode,
            })),
          }),
        });
        const json = (await res.json()) as {
          ok?: boolean;
          error?: string;
          engine?: string;
          cells?: { rowId: string; questions: ExamPaperQuestion[]; error?: string }[];
          generationIds?: string[];
        };
        if (!res.ok || !json.ok || !json.cells) {
          props.onError(json.error || "AI could not fill the blueprint");
          return;
        }
        for (const c of json.cells) {
          const list = byRow.get(c.rowId) ?? [];
          list.push(...c.questions);
          byRow.set(c.rowId, list);
        }
        const failed = json.cells.filter((c) => c.error).length;
        engineNote = ` · AI filled ${json.cells.reduce((a, c) => a + c.questions.length, 0)} (${json.engine})${failed ? ` · ${failed} cell(s) failed` : ""}`;
        if (json.generationIds?.length) {
          reportAiOutcome({ ids: json.generationIds, outcome: "accepted", targetType: "exam_paper", targetId: paper.id });
        }
      }
      // 3. Persist bank use counts, assemble sections.
      saveExamPapers(filled.state);
      setTick((t) => t + 1);
      const sections = assembleSectionsFromCells(usable.map((r) => ({ row: r, questions: byRow.get(r.id) ?? [] })));
      const got = sections.reduce((a, s) => a + s.questions.length, 0);
      const want = usable.reduce((a, r) => a + r.count, 0);
      props.onGenerated(
        sections,
        Array.from(new Set(usable.map((r) => r.unitId).filter(Boolean))),
        `Blueprint: ${got}/${want} questions · ${fromBank} from bank${engineNote}. Edit every line before printing.`,
      );
    } catch (e) {
      props.onError(e instanceof Error ? e.message : "Blueprint generation failed");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-lg border border-[var(--border)] p-3">
      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          onClick={() => setOpen((o) => !o)}
          className="text-sm font-semibold text-[var(--brand-deep)]"
        >
          {open ? "▾" : "▸"} Blueprint · {rows.length} row{rows.length === 1 ? "" : "s"} · {total} marks
          {paper.maxMarks && total !== paper.maxMarks ? (
            <span className="ml-1 text-[11px] font-normal text-[var(--muted)]">(paper max {paper.maxMarks})</span>
          ) : null}
        </button>
        <span className="text-[11px] text-[var(--muted)]">
          unit × type × marks × count — bank first, AI fills the gaps
        </span>
        {saved.length ? (
          <select
            className="field ml-auto !w-auto !py-1 text-xs"
            value={blueprintId}
            onChange={(e) => {
              const bp = saved.find((b) => b.id === e.target.value);
              if (bp) load(bp);
            }}
          >
            <option value="">Saved blueprints…</option>
            {saved.map((b) => (
              <option key={b.id} value={b.id}>
                {b.title} · {blueprintTotalMarks(b)}m
              </option>
            ))}
          </select>
        ) : null}
      </div>

      {open ? (
        <div className="mt-2 space-y-2">
          <table className="w-full text-xs">
            <thead className="text-[10px] uppercase tracking-wide text-[var(--muted)]">
              <tr>
                <th className="py-1 text-left">Chapter / topic</th>
                <th className="py-1 text-left">Type</th>
                <th className="py-1 text-right">Marks each</th>
                <th className="py-1 text-right">Count</th>
                <th className="py-1 text-left">Hardness</th>
                <th className="py-1 text-left">LO code</th>
                <th className="py-1 text-right" title="Matching questions already in the bank">Bank</th>
                <th />
              </tr>
            </thead>
            <tbody>
              {rows.map((r) => (
                <tr key={r.id} className="border-t border-[var(--border)]">
                  <td className="py-1 pr-1">
                    <select
                      className="field !w-full !py-0.5 text-xs"
                      disabled={!canEdit}
                      value={r.unitId}
                      onChange={(e) => patchRow(r.id, { unitId: e.target.value })}
                    >
                      <option value="">Any (whole subject)</option>
                      {syllabusUnits.map((u) => (
                        <option key={u.id} value={u.id}>
                          {u.level === "topic" ? "   " : ""}
                          {u.code ? `${u.code} · ` : ""}
                          {u.title}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-1">
                    <select
                      className="field !w-auto !py-0.5 text-xs"
                      disabled={!canEdit}
                      value={r.questionType}
                      onChange={(e) => patchRow(r.id, { questionType: e.target.value as ExamPaperQuestionType })}
                    >
                      {QUESTION_TYPES.map((t) => (
                        <option key={t.code} value={t.code}>
                          {t.short}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-1 text-right">
                    <input
                      type="number"
                      min={0.5}
                      step={0.5}
                      className="field !w-16 !py-0.5 text-right text-xs"
                      disabled={!canEdit}
                      value={r.marks}
                      onChange={(e) => patchRow(r.id, { marks: Math.max(0, Number(e.target.value) || 0) })}
                    />
                  </td>
                  <td className="py-1 pr-1 text-right">
                    <input
                      type="number"
                      min={0}
                      className="field !w-14 !py-0.5 text-right text-xs"
                      disabled={!canEdit}
                      value={r.count}
                      onChange={(e) => patchRow(r.id, { count: Math.max(0, Math.floor(Number(e.target.value) || 0)) })}
                    />
                  </td>
                  <td className="py-1 pr-1">
                    <select
                      className="field !w-auto !py-0.5 text-xs"
                      disabled={!canEdit}
                      value={r.hardness}
                      onChange={(e) => patchRow(r.id, { hardness: e.target.value as ExamBlueprintRow["hardness"] })}
                    >
                      {HARDNESS_LEVELS.map((h) => (
                        <option key={h.code} value={h.code}>
                          {h.label}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-1">
                    <input
                      className="field !w-20 !py-0.5 text-xs uppercase"
                      placeholder="—"
                      disabled={!canEdit}
                      value={r.competencyCode}
                      onChange={(e) => patchRow(r.id, { competencyCode: e.target.value.toUpperCase() })}
                      list={`lo-${r.id}`}
                    />
                    <datalist id={`lo-${r.id}`}>
                      {(syllabusUnits.find((u) => u.id === r.unitId)?.competencyCodes ?? []).map((c) => (
                        <option key={c} value={c} />
                      ))}
                    </datalist>
                  </td>
                  <td className="py-1 text-right tabular-nums text-[var(--muted)]">{bankAvail(r)}</td>
                  <td className="py-1 pl-1 text-right">
                    {canEdit ? (
                      <button
                        type="button"
                        className="text-[11px] text-[var(--danger)] underline"
                        onClick={() => setRows((prev) => prev.filter((x) => x.id !== r.id))}
                      >
                        ✕
                      </button>
                    ) : null}
                  </td>
                </tr>
              ))}
            </tbody>
          </table>
          {canEdit ? (
            <div className="flex flex-wrap items-center gap-2">
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold"
                onClick={() => setRows((prev) => [...prev, blankRow()])}
              >
                + Row
              </button>
              <input
                className="field !w-52 !py-1 text-xs"
                placeholder="Blueprint name (e.g. Half Yearly pattern)"
                value={title}
                onChange={(e) => setTitle(e.target.value)}
              />
              <button
                type="button"
                className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold text-[var(--brand-deep)]"
                onClick={save}
                disabled={rows.length === 0}
              >
                Save blueprint
              </button>
              {blueprintId ? (
                <button
                  type="button"
                  className="text-[11px] text-[var(--danger)] underline"
                  onClick={() => {
                    const bp = saved.find((b) => b.id === blueprintId);
                    if (bp) drop(bp);
                  }}
                >
                  delete saved
                </button>
              ) : null}
              <button
                type="button"
                disabled={busy || rows.length === 0}
                onClick={() => void generate()}
                className="ml-auto inline-flex items-center gap-1.5 rounded-lg bg-[#6d28d9] px-3 py-1.5 text-sm font-bold text-white disabled:opacity-50"
                title="Replaces this set's sections: bank items first, AI for the rest"
              >
                <Sparkles className="h-4 w-4" />
                {busy ? "Generating…" : "Generate set from blueprint"}
              </button>
            </div>
          ) : null}
        </div>
      ) : null}
    </div>
  );
}
