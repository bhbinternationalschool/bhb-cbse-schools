"use client";

/**
 * Inline picker over the question bank for one class × subject: search,
 * filter by type, add items into a section (copied with a fresh id,
 * source "bank", use count bumped).
 */

import { useMemo, useState } from "react";
import {
  listBank,
  loadExamPapers,
  QUESTION_TYPES,
  questionTypeLabel,
  removeFromBank,
  saveExamPapers,
  takeFromBank,
  type ExamPaperQuestion,
  type ExamPaperQuestionType,
} from "@/lib/examPapers";

export function BankPicker(props: {
  classId: string;
  subjectId: string;
  /** Texts already on the paper — hidden from the list */
  excludeTexts: string[];
  unitLabel: (unitId: string) => string;
  onAdd: (q: ExamPaperQuestion) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  const [type, setType] = useState<ExamPaperQuestionType | "">("");
  const [tick, setTick] = useState(0);
  const excluded = useMemo(
    () => new Set(props.excludeTexts.map((t) => t.toLowerCase().replace(/\s+/g, " ").trim())),
    [props.excludeTexts],
  );
  const items = useMemo(() => {
    void tick;
    return listBank(loadExamPapers(), {
      classId: props.classId,
      subjectId: props.subjectId,
      type: type || undefined,
      search,
    }).filter((b) => !excluded.has(b.question.text.toLowerCase().replace(/\s+/g, " ").trim()));
  }, [props.classId, props.subjectId, type, search, excluded, tick]);

  function remove(bankId: string) {
    if (!window.confirm("Remove this question from the bank? Papers that already use it are not affected.")) return;
    saveExamPapers(removeFromBank(loadExamPapers(), bankId));
    setTick((x) => x + 1);
  }

  function add(bankId: string) {
    const t = takeFromBank(loadExamPapers(), bankId);
    if (!t) return;
    saveExamPapers(t.state);
    setTick((x) => x + 1);
    props.onAdd(t.question);
  }

  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">Question bank · {items.length}</span>
        <input
          className="field !w-56 !py-1 text-xs"
          placeholder="Search text, LO code, tag…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <select className="field !w-auto !py-1 text-xs" value={type} onChange={(e) => setType(e.target.value as ExamPaperQuestionType | "")}>
          <option value="">All types</option>
          {QUESTION_TYPES.map((t) => (
            <option key={t.code} value={t.code}>
              {t.label}
            </option>
          ))}
        </select>
        <button type="button" className="ml-auto text-[11px] underline" onClick={props.onClose}>
          Close
        </button>
      </div>
      {items.length === 0 ? (
        <p className="mt-2 text-[var(--muted)]">
          Nothing in the bank for this class · subject{search || type ? " with these filters" : ""}. Use “→ Bank” on a question to
          add it.
        </p>
      ) : (
        <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
          {items.slice(0, 40).map((b) => (
            <li key={b.id} className="flex items-start gap-2 rounded border border-[var(--border)] p-1.5">
              <div className="min-w-0 flex-1">
                <p className="line-clamp-2">{b.question.text}</p>
                <p className="text-[10px] text-[var(--muted)]">
                  {questionTypeLabel(b.question.type)} · {b.question.marks}m · {b.question.hardness}
                  {b.question.competencyCode ? ` · ${b.question.competencyCode}` : ""}
                  {b.question.unitId && props.unitLabel(b.question.unitId) ? ` · ${props.unitLabel(b.question.unitId)}` : ""}
                  {b.usedCount ? ` · used ${b.usedCount}×` : " · unused"}
                </p>
              </div>
              <button
                type="button"
                className="shrink-0 rounded border border-[var(--border)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-deep)]"
                onClick={() => add(b.id)}
              >
                Add
              </button>
              <button
                type="button"
                className="shrink-0 text-[11px] text-[var(--danger)]"
                title="Remove from bank"
                onClick={() => remove(b.id)}
              >
                ✕
              </button>
            </li>
          ))}
        </ul>
      )}
    </div>
  );
}
