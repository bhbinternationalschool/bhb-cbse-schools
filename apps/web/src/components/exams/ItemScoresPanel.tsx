"use client";

/**
 * Exams → Item scores — question-wise marks for one paper (and set), one
 * row per student, one column per question. The grid is what makes
 * "8-B is weak on Ch 3 / LO M802" derivable; the subject total on the mark
 * sheet can be summed from it ("Apply totals").
 *
 * Reads the paper's questions from Exam papers (same class + subject +
 * exam) and stores marks on the section's mark sheet (`itemScores`),
 * pushed with the sheet through the exams desk. Nothing here calls an LLM.
 */

import { useEffect, useMemo, useState } from "react";
import {
  effectiveMaxMarks,
  findMarkSheet,
  saveSheetItemScores,
  type ExamSubject,
  type ExamTerm,
} from "@/lib/exams";
import {
  listExamPapers,
  questionTypeLabel,
  type ExamPaper,
  type ExamPaperQuestion,
} from "@/lib/examPapers";
import type { SisStudent } from "@/lib/sis";
import type { MastersState } from "@/lib/masters";
import { StudentAvatar, StudentNameLabel } from "@/components/students/StudentAvatar";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";

type Cell = string; // raw text in the input; "" = not marked

export function ItemScoresPanel(props: {
  ay: string;
  term: ExamTerm | null;
  classId: string;
  sectionId: string;
  roster: SisStudent[];
  subjects: ExamSubject[];
  /** Question papers are keyed by masters subject id; exam subjects link to masters by code */
  masters: MastersState | null;
  canEdit: boolean;
  enteredBy: string;
  onSaved: () => void;
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const { ay, term, classId, sectionId, roster, subjects, canEdit } = props;
  const [subjectId, setSubjectId] = useState("");
  const [paperId, setPaperId] = useState("");
  const [setCode, setSetCode] = useState("A");
  const [grid, setGrid] = useState<Map<string, Cell>>(new Map()); // key studentId:questionId
  const [dirty, setDirty] = useState(false);
  const [applyTotals, setApplyTotals] = useState(true);
  const [tick, setTick] = useState(0);

  const subject = subjects.find((s) => s.id === subjectId) ?? null;

  const papers = useMemo<ExamPaper[]>(() => {
    void tick;
    if (!term || !classId || !subject) return [];
    // ExamSubject ↔ masters subject is a code link (see syncExamSubjectsFromMasters).
    const code = subject.code.toUpperCase();
    const mastersIds = new Set(
      (props.masters?.subjects ?? [])
        .filter((m) => m.code.toUpperCase() === code)
        .map((m) => m.id),
    );
    return listExamPapers(ay, { examTermId: term.id, classId }).filter(
      (p) => p.status !== "archived" && (mastersIds.has(p.subjectId) || p.subjectId === subject.id),
    );
  }, [ay, term, classId, subject, props.masters, tick]);

  const paper = papers.find((p) => p.id === paperId) ?? null;
  const set = paper?.sets.find((s) => s.setCode === setCode) ?? paper?.sets[0] ?? null;
  const questions = useMemo<ExamPaperQuestion[]>(
    () => (set ? set.sections.flatMap((s) => s.questions) : []),
    [set],
  );
  const paperMax = questions.reduce((a, q) => a + q.marks, 0);
  const subjectMax = term && subject ? effectiveMaxMarks(term, subject) : null;

  // Default subject/paper/set when the selection above changes.
  useEffect(() => {
    if (!subjectId && subjects[0]) setSubjectId(subjects[0].id);
  }, [subjects, subjectId]);
  useEffect(() => {
    if (papers.length && !papers.some((p) => p.id === paperId)) {
      setPaperId(papers[0].id);
      setSetCode(papers[0].activeSetCode || papers[0].sets[0]?.setCode || "A");
    }
    if (!papers.length && paperId) setPaperId("");
  }, [papers, paperId]);

  // Load the saved grid for this paper+set from the mark sheet.
  useEffect(() => {
    if (!term || !sectionId || !paperId) {
      setGrid(new Map());
      setDirty(false);
      return;
    }
    const sheet = findMarkSheet(ay, term.id, sectionId);
    const next = new Map<string, Cell>();
    for (const e of sheet?.itemScores ?? []) {
      if (e.paperId !== paperId || e.setCode !== setCode) continue;
      next.set(`${e.studentId}:${e.questionId}`, e.marks == null ? "" : String(e.marks));
    }
    setGrid(next);
    setDirty(false);
  }, [ay, term, sectionId, paperId, setCode, tick]);

  function setCell(studentId: string, q: ExamPaperQuestion, raw: string) {
    const v = raw.trim();
    if (v !== "") {
      const n = Number(v);
      if (!Number.isFinite(n)) return;
      if (n > q.marks) {
        props.onError(`Q${questions.indexOf(q) + 1} is out of ${q.marks}`);
        return;
      }
      if (n < 0) return;
    }
    setGrid((prev) => {
      const next = new Map(prev);
      next.set(`${studentId}:${q.id}`, v);
      return next;
    });
    setDirty(true);
  }

  function rowTotal(studentId: string): number | null {
    let any = false;
    let sum = 0;
    for (const q of questions) {
      const v = grid.get(`${studentId}:${q.id}`);
      if (v !== undefined && v !== "") {
        any = true;
        sum += Number(v);
      }
    }
    return any ? Math.round(sum * 100) / 100 : null;
  }

  /** Class average on a question as % of its marks; null when nobody is marked. */
  function colAvgPct(q: ExamPaperQuestion): number | null {
    let n = 0;
    let sum = 0;
    for (const st of roster) {
      const v = grid.get(`${st.id}:${q.id}`);
      if (v !== undefined && v !== "") {
        n += 1;
        sum += Number(v);
      }
    }
    if (n === 0 || q.marks === 0) return null;
    return Math.round((sum / (n * q.marks)) * 100);
  }

  function onSave() {
    if (!term || !paper || !canEdit) return;
    const scores: { studentId: string; questionId: string; marks: number | null }[] = [];
    for (const st of roster) {
      for (const q of questions) {
        const v = grid.get(`${st.id}:${q.id}`);
        if (v === undefined) continue; // never touched → not stored
        scores.push({ studentId: st.id, questionId: q.id, marks: v === "" ? null : Number(v) });
      }
    }
    const r = saveSheetItemScores({
      academicYearCode: ay,
      examTermId: term.id,
      classId,
      sectionId,
      subjectId,
      paperId: paper.id,
      setCode,
      scores,
      applyTotals,
      enteredBy: props.enteredBy,
    });
    if (!r.ok) {
      props.onError(r.error);
      return;
    }
    setDirty(false);
    setTick((t) => t + 1);
    props.onSaved();
    props.onFlash(
      `Item scores saved · ${scores.filter((s) => s.marks != null).length} marks${
        applyTotals ? ` · ${r.totalsApplied} subject total${r.totalsApplied === 1 ? "" : "s"} updated` : ""
      }`,
    );
  }

  if (!term || !classId || !sectionId) {
    return (
      <p className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-10 text-center text-sm text-[var(--muted)]">
        Select exam, class and section to enter question-wise marks.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
        <label className="text-xs font-semibold text-[var(--muted)]">
          Subject
          <select
            className="field mt-1 block !w-auto !py-1.5 text-sm"
            value={subjectId}
            onChange={(e) => setSubjectId(e.target.value)}
          >
            {subjects.map((s) => (
              <option key={s.id} value={s.id}>
                {s.name}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-[var(--muted)]">
          Question paper
          <select
            className="field mt-1 block !w-auto !py-1.5 text-sm"
            value={paperId}
            onChange={(e) => setPaperId(e.target.value)}
            disabled={papers.length === 0}
          >
            {papers.length === 0 ? <option value="">No paper for this exam · subject</option> : null}
            {papers.map((p) => (
              <option key={p.id} value={p.id}>
                {p.paperCode} · {p.title} · {p.maxMarks}
              </option>
            ))}
          </select>
        </label>
        {paper && paper.sets.length > 1 ? (
          <label className="text-xs font-semibold text-[var(--muted)]">
            Set
            <select
              className="field mt-1 block !w-auto !py-1.5 text-sm"
              value={setCode}
              onChange={(e) => setSetCode(e.target.value)}
            >
              {paper.sets.map((s) => (
                <option key={s.setCode} value={s.setCode}>
                  Set {s.setCode}
                </option>
              ))}
            </select>
          </label>
        ) : null}
        <label className="inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <input
            type="checkbox"
            checked={applyTotals}
            onChange={(e) => setApplyTotals(e.target.checked)}
            disabled={!canEdit}
          />
          Apply totals to the mark sheet
          {subjectMax != null && paperMax !== subjectMax ? (
            <span className="text-[var(--warning,orange)]" title="Paper marks and subject max differ; totals are clamped to the subject max">
              (paper {paperMax} · subject max {subjectMax})
            </span>
          ) : null}
        </label>
        <div className="ml-auto flex items-center gap-2">
          <span className="text-[11px] text-[var(--muted)]">
            {roster.length} students · {questions.length} questions
            {dirty ? " · unsaved changes" : ""}
          </span>
          {canEdit ? (
            <button
              type="button"
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
              disabled={!paper || !dirty}
              onClick={onSave}
            >
              Save item scores
            </button>
          ) : null}
        </div>
      </div>

      {!paper ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          Create the question paper for this exam and subject under{" "}
          <strong>Question papers</strong> first — item marks are entered against its questions.
        </p>
      ) : (
        <ErpTableShell>
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="sticky left-0 z-10 bg-[var(--card)] px-3 py-2 text-left">Student</th>
                {questions.map((q, i) => (
                  <th
                    key={q.id}
                    className="px-1 py-2 text-center"
                    title={`${questionTypeLabel(q.type)}${q.competencyCode ? ` · ${q.competencyCode}` : ""}${q.bloomLevel ? ` · ${q.bloomLevel}` : ""}\n${q.text.slice(0, 160)}`}
                  >
                    <div className="text-[11px] font-bold">Q{i + 1}</div>
                    <div className="text-[10px] font-normal text-[var(--muted)]">/{q.marks}</div>
                    {q.competencyCode ? (
                      <div className="text-[9px] font-normal text-[var(--muted)]">{q.competencyCode}</div>
                    ) : null}
                  </th>
                ))}
                <th className="px-2 py-2 text-right">Total /{paperMax}</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {roster.map((st) => {
                const total = rowTotal(st.id);
                return (
                  <tr key={st.id}>
                    <td className="sticky left-0 z-10 bg-[var(--card)] px-3 py-1">
                      <div className="flex items-center gap-2">
                        <StudentAvatar student={st} size={28} />
                        <StudentNameLabel student={st} />
                      </div>
                    </td>
                    {questions.map((q) => (
                      <td key={q.id} className="px-1 py-1">
                        <input
                          className="field !w-12 !px-1 !py-1 text-center tabular-nums"
                          inputMode="decimal"
                          disabled={!canEdit}
                          value={grid.get(`${st.id}:${q.id}`) ?? ""}
                          onChange={(e) => setCell(st.id, q, e.target.value)}
                          aria-label={`${st.fullName} Q${questions.indexOf(q) + 1}`}
                        />
                      </td>
                    ))}
                    <td className="px-2 py-1 text-right font-semibold tabular-nums">
                      {total == null ? "—" : total}
                    </td>
                  </tr>
                );
              })}
              <tr className="border-t border-[var(--border)] text-[11px] text-[var(--muted)]">
                <td className="sticky left-0 z-10 bg-[var(--card)] px-3 py-1.5 font-semibold">
                  Class avg (% of marks)
                </td>
                {questions.map((q) => {
                  const pct = colAvgPct(q);
                  return (
                    <td
                      key={q.id}
                      className={`px-1 py-1.5 text-center tabular-nums ${
                        pct != null && pct < 40 ? "font-bold text-[var(--danger)]" : ""
                      }`}
                    >
                      {pct == null ? "—" : `${pct}%`}
                    </td>
                  );
                })}
                <td />
              </tr>
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}
    </div>
  );
}
