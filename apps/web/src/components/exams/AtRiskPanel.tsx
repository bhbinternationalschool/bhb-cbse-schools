"use client";

/**
 * Exams → At-risk — early-warning list for one section at one exam.
 * Who is flagged is decided by lib/academicRisk.ts rules over marks,
 * attendance, homework and conduct; the AI only drafts a "what to do" note
 * per flagged student (draft — copy into PTM feedback / remarks by hand).
 */

import { useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  assessStudentRisk,
  RISK_LEVEL_LABEL,
  RISK_NOTES_MAX_STUDENTS,
  type RiskLevel,
  type RiskNoteDraft,
  type StudentRiskFacts,
  type StudentRiskResult,
} from "@/lib/academicRisk";
import { buildSectionRiskFacts } from "@/lib/academicRiskFacts";
import type { ExamPolicy, ExamTerm } from "@/lib/exams";
import type { MastersState } from "@/lib/masters";
import type { SisStudent } from "@/lib/sis";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import { StudentAvatar, StudentNameLabel } from "@/components/students/StudentAvatar";
import { ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";

const LEVEL_TONE: Record<RiskLevel, string> = {
  high: "bg-[var(--danger)]/15 text-[var(--danger)]",
  watch: "bg-[rgba(245,158,11,0.15)] text-[#b45309]",
  none: "bg-[var(--success-soft)] text-[var(--success)]",
};

export function AtRiskPanel(props: {
  ay: string;
  term: ExamTerm | null;
  classId: string;
  sectionId: string;
  roster: SisStudent[];
  masters: MastersState | null;
  policy: ExamPolicy;
  canEdit: boolean;
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const { ay, term, classId, sectionId, roster, masters, canEdit } = props;
  const thresholds = props.policy.riskThresholds;
  const [showAll, setShowAll] = useState(false);
  const [language, setLanguage] = useState<"en" | "hi">("en");
  const [busy, setBusy] = useState(false);
  const [notes, setNotes] = useState<Map<string, RiskNoteDraft>>(new Map());
  const [noteMeta, setNoteMeta] = useState<{ model: string; generationIds: string[] } | null>(null);

  const { rows, prevLabels } = useMemo(() => {
    if (!term || !masters || roster.length === 0) return { rows: [], prevLabels: [] as string[] };
    const { facts, previousTermLabels } = buildSectionRiskFacts({
      masters,
      roster,
      term,
      academicYearCode: ay,
    });
    const rows = facts
      .map((f) => ({ facts: f, result: assessStudentRisk(f, thresholds) }))
      .sort((a, b) => b.result.score - a.result.score || a.facts.fullName.localeCompare(b.facts.fullName));
    return { rows, prevLabels: previousTermLabels };
  }, [ay, term, masters, roster, thresholds]);

  const flagged = rows.filter((r) => r.result.level !== "none");
  const counts = {
    high: rows.filter((r) => r.result.level === "high").length,
    watch: rows.filter((r) => r.result.level === "watch").length,
    withMarks: rows.filter((r) => r.facts.percent != null).length,
  };
  const visible = showAll ? rows : flagged;

  async function draftNotes() {
    if (!canEdit || busy || flagged.length === 0) return;
    setBusy(true);
    try {
      const students: StudentRiskFacts[] = flagged.slice(0, RISK_NOTES_MAX_STUDENTS).map((r) => r.facts);
      const res = await fetch("/api/ai/at-risk-notes", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language, students, thresholds }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        notes?: RiskNoteDraft[];
        model?: string;
        generationIds?: string[];
        missing?: string[];
        warnings?: string[];
      };
      if (!res.ok || !json.ok || !json.notes) {
        props.onError(json.error || "AI notes failed");
        return;
      }
      setNotes(new Map(json.notes.map((n) => [n.studentId, n])));
      setNoteMeta({ model: json.model || "", generationIds: json.generationIds || [] });
      props.onFlash(
        `${json.notes.length} note${json.notes.length === 1 ? "" : "s"} drafted · ${json.model || "ai"}${
          json.missing?.length ? ` · ${json.missing.length} not returned` : ""
        }`,
      );
    } catch (e) {
      props.onError(e instanceof Error ? e.message : "AI notes failed");
    } finally {
      setBusy(false);
    }
  }

  async function copyNote(studentId: string) {
    const n = notes.get(studentId);
    if (!n) return;
    try {
      await navigator.clipboard.writeText(n.note);
      props.onFlash("Note copied");
      if (noteMeta?.generationIds.length) {
        reportAiOutcome({
          ids: noteMeta.generationIds,
          outcome: "accepted",
          targetType: "at_risk_note",
          targetId: `${term?.id}:${sectionId}`,
        });
        setNoteMeta({ ...noteMeta, generationIds: [] });
      }
    } catch {
      props.onError("Could not copy — select the text and copy manually");
    }
  }

  if (!term || !classId || !sectionId) {
    return (
      <p className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-10 text-center text-sm text-[var(--muted)]">
        Select exam, class and section to see the early-warning list.
      </p>
    );
  }

  return (
    <div className="mt-6 space-y-3">
      <div className="flex flex-wrap items-center gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] p-3 text-sm">
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${LEVEL_TONE.high}`}>
          {counts.high} high
        </span>
        <span className={`rounded-full px-2 py-0.5 text-xs font-bold ${LEVEL_TONE.watch}`}>
          {counts.watch} watch
        </span>
        <span className="text-xs text-[var(--muted)]">
          of {roster.length} students · {counts.withMarks} with marks in {term.label}
          {prevLabels.length ? ` · compared with ${prevLabels.join(" / ")}` : " · no earlier exam to compare"}
        </span>
        <label className="ml-auto inline-flex items-center gap-1.5 text-xs text-[var(--muted)]">
          <input type="checkbox" checked={showAll} onChange={(e) => setShowAll(e.target.checked)} />
          Show all students
        </label>
        {canEdit ? (
          <>
            <select
              className="field !w-auto !py-1 text-xs"
              value={language}
              onChange={(e) => setLanguage(e.target.value as "en" | "hi")}
            >
              <option value="en">English</option>
              <option value="hi">हिंदी</option>
            </select>
            <button
              type="button"
              disabled={busy || flagged.length === 0}
              onClick={() => void draftNotes()}
              className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
              title="Drafts one 'what to do' note per flagged student. Rules decide who is flagged; the AI only writes the note."
            >
              <Sparkles className="h-4 w-4" />
              {busy ? "Drafting…" : `AI notes for ${flagged.length}`}
            </button>
          </>
        ) : null}
      </div>

      <p className="text-[11px] text-[var(--muted)]">
        Rules: overall grade dropped a band vs the previous exam · ≥{thresholds.subjectDrops} subjects slipped a band ·
        any subject below pass · attendance &lt; {thresholds.attendancePct} % · ≥{thresholds.incidents} conduct incidents
        or any escalation · homework &lt; {Math.round(thresholds.homeworkRatio * 100)} % of due (≥{thresholds.homeworkMinDue} due).
        A source with no data for a student never counts for or against them. Thresholds: Exams &amp; policy.
      </p>

      {visible.length === 0 ? (
        <p className="rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-8 text-center text-sm text-[var(--muted)]">
          {counts.withMarks === 0
            ? `No marks entered for ${term.label} yet — enter marks first.`
            : "No student is flagged for this exam."}
        </p>
      ) : (
        <ErpTableShell>
          <ErpTable>
            <ErpTableHead>
              <tr>
                <th className="px-3 py-2 text-left">Student</th>
                <th className="px-2 py-2 text-left">Level</th>
                <th className="px-2 py-2 text-left">Why</th>
                <th className="px-2 py-2 text-right">{term.label}</th>
                <th className="px-2 py-2 text-right">Att.</th>
                <th className="px-3 py-2 text-left">What to do (AI draft)</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {visible.map(({ facts: f, result: r }: { facts: StudentRiskFacts; result: StudentRiskResult }) => {
                const st = roster.find((s) => s.id === f.studentId);
                const note = notes.get(f.studentId);
                return (
                  <tr key={f.studentId} className="align-top">
                    <td className="px-3 py-2">
                      {st ? (
                        <div className="flex items-center gap-2">
                          <StudentAvatar student={st} size={28} />
                          <StudentNameLabel student={st} />
                        </div>
                      ) : (
                        f.fullName
                      )}
                    </td>
                    <td className="px-2 py-2">
                      <span className={`rounded-full px-2 py-0.5 text-[11px] font-bold ${LEVEL_TONE[r.level]}`}>
                        {RISK_LEVEL_LABEL[r.level]}
                      </span>
                    </td>
                    <td className="px-2 py-2 text-xs">
                      {r.flags.length === 0 ? (
                        <span className="text-[var(--muted)]">—</span>
                      ) : (
                        <ul className="space-y-0.5">
                          {r.flags.map((fl) => (
                            <li key={fl.id}>
                              <span className="font-semibold">{fl.label}</span>
                              <span className="text-[var(--muted)]"> · {fl.detail}</span>
                            </li>
                          ))}
                        </ul>
                      )}
                    </td>
                    <td className="px-2 py-2 text-right text-xs tabular-nums">
                      {f.percent == null ? "—" : `${Math.round(f.percent)}% ${f.overallGrade}`}
                      {f.previousPercent != null ? (
                        <div className="text-[10px] text-[var(--muted)]">
                          was {Math.round(f.previousPercent)}% {f.previousGrade}
                        </div>
                      ) : null}
                    </td>
                    <td className="px-2 py-2 text-right text-xs tabular-nums">
                      {f.attendancePercent == null ? "—" : `${Math.round(f.attendancePercent)}%`}
                    </td>
                    <td className="max-w-md px-3 py-2 text-xs">
                      {note ? (
                        <div>
                          <p className="whitespace-pre-wrap" lang={language === "hi" ? "hi" : undefined}>
                            {note.note}
                          </p>
                          <button
                            type="button"
                            className="mt-1 text-[11px] font-semibold text-[var(--brand-deep)] underline"
                            onClick={() => void copyNote(f.studentId)}
                          >
                            Copy
                          </button>
                        </div>
                      ) : r.level === "none" ? (
                        <span className="text-[var(--muted)]">—</span>
                      ) : (
                        <span className="text-[var(--muted)]">not drafted</span>
                      )}
                    </td>
                  </tr>
                );
              })}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}
    </div>
  );
}
