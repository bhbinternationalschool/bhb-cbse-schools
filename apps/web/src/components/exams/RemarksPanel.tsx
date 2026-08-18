"use client";

/**
 * Exams → Remarks: class teacher's report-card remarks for one exam ×
 * section, with an AI draft button per student and for the whole section.
 *
 * Human-in-the-loop by construction: AI output lands in editable text
 * areas, nothing is saved until "Save remarks", and each saved remark
 * carries its provenance (manual / ai / ai_edited) onto the report card
 * record and the audit trail.
 */

import { useEffect, useMemo, useState } from "react";
import { Sparkles } from "lucide-react";
import {
  buildReportCard,
  findMarkSheet,
  saveSheetRemarks,
  type ExamPolicy,
  type ExamSubject,
  type ExamTerm,
  type RemarkSource,
  type ReportCard,
  type StudentOverallRemark,
} from "@/lib/exams";
import type { SisStudent } from "@/lib/sis";
import {
  REMARK_MAX_STUDENTS_PER_REQUEST,
  REMARK_TONES,
  type RemarkLanguage,
  type RemarkTone,
  type StudentRemarkDraft,
  type StudentRemarkFacts,
} from "@/lib/reportRemarkAi";
import {
  StudentAvatar,
  StudentNameLabel,
} from "@/components/students/StudentAvatar";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";

type RowState = {
  studentId: string;
  text: string;
  textHi: string;
  source: RemarkSource;
  generatedAt: string | null;
  model: string;
  /** What the AI last produced, to tell "ai" from "ai_edited" on save */
  aiText: string;
  aiTextHi: string;
  subjects: {
    subjectId: string;
    subjectName: string;
    remark: string;
    source: RemarkSource;
    aiRemark: string;
  }[];
  card: ReportCard | null;
  cardError: string;
};

function sourceLabel(s: RemarkSource): string {
  return s === "ai" ? "AI draft" : s === "ai_edited" ? "AI · edited" : "Manual";
}

function firstNameOf(st: SisStudent): string {
  return (st.fullName || "").trim().split(/\s+/)[0] || "Student";
}

export function RemarksPanel(props: {
  ay: string;
  term: ExamTerm | null;
  terms: ExamTerm[];
  classId: string;
  sectionId: string;
  classLabel: string;
  roster: SisStudent[];
  subjects: ExamSubject[];
  policy: ExamPolicy;
  canEdit: boolean;
  onSaved: () => void;
  onFlash: (msg: string) => void;
  onError: (msg: string) => void;
}) {
  const {
    ay,
    term,
    terms,
    classId,
    sectionId,
    classLabel,
    roster,
    subjects,
    canEdit,
  } = props;

  const [rows, setRows] = useState<RowState[]>([]);
  const [tone, setTone] = useState<RemarkTone>("balanced");
  const [language, setLanguage] = useState<RemarkLanguage>("en");
  const [includeSubjects, setIncludeSubjects] = useState(true);
  const [busy, setBusy] = useState<string | "all" | null>(null);
  const [dirty, setDirty] = useState(false);
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [engineNote, setEngineNote] = useState<string>("");

  const sheet = useMemo(
    () => (term && sectionId ? findMarkSheet(ay, term.id, sectionId) : undefined),
    [ay, term, sectionId],
  );

  const previousTerm = useMemo(() => {
    if (!term) return null;
    const earlier = terms
      .filter((t) => t.sortOrder < term.sortOrder)
      .sort((a, b) => b.sortOrder - a.sortOrder);
    return earlier[0] ?? null;
  }, [term, terms]);

  // (Re)build rows from the saved sheet whenever the selection changes.
  useEffect(() => {
    if (!term || !sectionId || !classId) {
      setRows([]);
      setDirty(false);
      return;
    }
    const next: RowState[] = roster.map((st) => {
      const saved = sheet?.overallRemarks.find((r) => r.studentId === st.id);
      const built = buildReportCard({
        student: st,
        classLabel,
        examTermId: term.id,
        academicYearCode: ay,
      });
      const card = "error" in built ? null : built;
      const subjectRows = subjects
        .filter((sub) => card?.lines.some((l) => l.subjectId === sub.id) ?? true)
        .map((sub) => {
          const m = sheet?.marks.find(
            (x) => x.studentId === st.id && x.subjectId === sub.id,
          );
          return {
            subjectId: sub.id,
            subjectName: sub.name,
            remark: m?.remark ?? "",
            source: m?.remarkSource ?? "manual",
            aiRemark: "",
          };
        });
      return {
        studentId: st.id,
        text: saved?.text ?? "",
        textHi: saved?.textHi ?? "",
        source: saved?.source ?? "manual",
        generatedAt: saved?.generatedAt ?? null,
        model: saved?.model ?? "",
        aiText: "",
        aiTextHi: "",
        subjects: subjectRows,
        card,
        cardError: "error" in built ? built.error : "",
      };
    });
    setRows(next);
    setDirty(false);
    setExpanded(new Set());
  }, [ay, term, sectionId, classId, roster, subjects, sheet, classLabel]);

  function factsFor(row: RowState): StudentRemarkFacts | null {
    const st = roster.find((s) => s.id === row.studentId);
    if (!st || !row.card || !term) return null;
    const card = row.card;
    let prev: ReportCard | null = null;
    if (previousTerm) {
      const b = buildReportCard({
        student: st,
        classLabel,
        examTermId: previousTerm.id,
        academicYearCode: ay,
      });
      prev = "error" in b ? null : b;
    }
    return {
      studentId: st.id,
      firstName: firstNameOf(st),
      classLabel,
      examLabel: term.label,
      percent: card.percent,
      overallGrade: card.overallGrade,
      previousPercent: prev ? prev.percent : null,
      previousExamLabel: prev && previousTerm ? previousTerm.label : "",
      attendancePercent: card.attendance ? card.attendance.percent : null,
      subjects: card.lines.map((l) => {
        const pl = prev?.lines.find((x) => x.subjectId === l.subjectId);
        const cur =
          l.marksObtained != null && l.maxMarks > 0
            ? (l.marksObtained / l.maxMarks) * 100
            : null;
        const prv =
          pl && pl.marksObtained != null && pl.maxMarks > 0
            ? (pl.marksObtained / pl.maxMarks) * 100
            : null;
        return {
          subjectId: l.subjectId,
          subjectName: l.subjectName,
          marksObtained: l.marksObtained,
          maxMarks: l.maxMarks,
          grade: l.grade,
          previousGrade: pl && pl.marksObtained != null ? pl.grade : "",
          deltaPercent:
            cur != null && prv != null ? Math.round((cur - prv) * 10) / 10 : null,
        };
      }),
      coScholastic: card.coScholastic
        .filter((c) => c.rating)
        .map((c) => ({ domainLabel: c.domainLabel, ratingLabel: c.ratingLabel })),
      existingOverallRemark: row.source === "manual" ? row.text : "",
    };
  }

  async function generate(targetIds: string[] | "all") {
    if (!canEdit || !term) return;
    const targets =
      targetIds === "all"
        ? rows.filter((r) => r.card)
        : rows.filter((r) => targetIds.includes(r.studentId) && r.card);
    if (targets.length === 0) {
      props.onError("No students with marks to generate remarks for");
      return;
    }
    if (targets.length > REMARK_MAX_STUDENTS_PER_REQUEST) {
      props.onError(`At most ${REMARK_MAX_STUDENTS_PER_REQUEST} students at a time`);
      return;
    }
    const students = targets
      .map(factsFor)
      .filter((f): f is StudentRemarkFacts => !!f);
    setBusy(targetIds === "all" ? "all" : targetIds[0]);
    try {
      const res = await fetch("/api/ai/report-remarks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          tone,
          language,
          includeSubjectRemarks: includeSubjects,
          students,
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        drafts?: StudentRemarkDraft[];
        missing?: string[];
        engine?: string;
        hindiEngine?: string;
        model?: string;
        generatedAt?: string;
        warnings?: string[];
      };
      if (!res.ok || !data.ok || !data.drafts) {
        props.onError(data.error || "AI remarks failed");
        return;
      }
      const byId = new Map(data.drafts.map((d) => [d.studentId, d]));
      const generatedAt = data.generatedAt || new Date().toISOString();
      const model = data.model || data.engine || "ai";
      setRows((prev) =>
        prev.map((r) => {
          const d = byId.get(r.studentId);
          if (!d) return r;
          const useEn = language !== "hi";
          const subjects = r.subjects.map((s) => {
            const ds = d.subjects.find((x) => x.subjectId === s.subjectId);
            if (!ds || !includeSubjects) return s;
            return { ...s, remark: ds.remark, source: "ai" as const, aiRemark: ds.remark };
          });
          return {
            ...r,
            text: useEn ? d.overall : r.text,
            textHi: language !== "en" ? d.overallHi : r.textHi,
            source: "ai",
            generatedAt,
            model,
            aiText: d.overall,
            aiTextHi: d.overallHi,
            subjects,
          };
        }),
      );
      setDirty(true);
      const parts = [
        `${data.drafts.length} draft${data.drafts.length === 1 ? "" : "s"} · ${model}`,
      ];
      if (language !== "en" && data.hindiEngine) parts.push(`Hindi via ${data.hindiEngine}`);
      if (data.missing?.length) parts.push(`${data.missing.length} not returned`);
      if (data.warnings?.length) parts.push(data.warnings[0]);
      setEngineNote(parts.join(" · "));
      props.onFlash(`AI drafted ${data.drafts.length} remark${data.drafts.length === 1 ? "" : "s"} — review before saving`);
    } catch (e) {
      props.onError((e as Error).message || "AI remarks failed");
    } finally {
      setBusy(null);
    }
  }

  function setText(studentId: string, field: "text" | "textHi", value: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.studentId !== studentId) return r;
        const next = { ...r, [field]: value } as RowState;
        // Provenance follows the English text (Hindi is a rendering of it).
        if (r.aiText) {
          next.source =
            next.text.trim() === r.aiText.trim() && next.textHi.trim() === r.aiTextHi.trim()
              ? "ai"
              : "ai_edited";
        } else if (r.source !== "manual" && r.generatedAt) {
          // Saved AI remark being edited in a later session.
          next.source = "ai_edited";
        } else {
          next.source = "manual";
        }
        return next;
      }),
    );
    setDirty(true);
  }

  function setSubjectRemark(studentId: string, subjectId: string, value: string) {
    setRows((prev) =>
      prev.map((r) => {
        if (r.studentId !== studentId) return r;
        return {
          ...r,
          subjects: r.subjects.map((s) => {
            if (s.subjectId !== subjectId) return s;
            const source: RemarkSource = s.aiRemark
              ? value.trim() === s.aiRemark.trim()
                ? "ai"
                : "ai_edited"
              : s.source === "manual"
                ? "manual"
                : "ai_edited";
            return { ...s, remark: value, source };
          }),
        };
      }),
    );
    setDirty(true);
  }

  function onSave() {
    if (!term || !sectionId) return;
    const overallRemarks: StudentOverallRemark[] = rows
      .filter((r) => r.text.trim() || r.textHi.trim())
      .map((r) => ({
        studentId: r.studentId,
        text: r.text.trim(),
        textHi: r.textHi.trim(),
        source: r.source,
        generatedAt: r.source === "manual" ? null : r.generatedAt,
        model: r.source === "manual" ? "" : r.model,
      }));
    const subjectRemarks = rows.flatMap((r) =>
      r.subjects.map((s) => ({
        studentId: r.studentId,
        subjectId: s.subjectId,
        remark: s.remark.trim(),
        remarkSource: s.source,
      })),
    );
    const result = saveSheetRemarks({
      academicYearCode: ay,
      examTermId: term.id,
      sectionId,
      overallRemarks,
      subjectRemarks,
    });
    if (!result.ok) {
      props.onError(result.error);
      return;
    }
    setDirty(false);
    props.onSaved();
    props.onFlash(`Remarks saved · ${overallRemarks.length} student${overallRemarks.length === 1 ? "" : "s"}`);
  }

  if (!term || !classId || !sectionId) {
    return (
      <p className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-10 text-center text-sm text-[var(--muted)]">
        Select exam, class and section to write report-card remarks.
      </p>
    );
  }
  if (!sheet) {
    return (
      <p className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-10 text-center text-sm text-[var(--muted)]">
        No marks saved for this exam and section yet — enter marks first, then
        write remarks here.
      </p>
    );
  }

  const withCards = rows.filter((r) => r.card).length;
  const aiCount = rows.filter((r) => r.source !== "manual" && (r.text || r.textHi)).length;

  return (
    <div className="mt-6">
      <div className="mb-3 flex flex-wrap items-end justify-between gap-3">
        <div className="flex flex-wrap items-end gap-3">
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Tone</span>
            <select
              className="field !py-1.5 text-sm"
              value={tone}
              onChange={(e) => setTone(e.target.value as RemarkTone)}
              disabled={!canEdit}
            >
              {REMARK_TONES.map((t) => (
                <option key={t.id} value={t.id} title={t.hint}>
                  {t.label}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Language</span>
            <select
              className="field !py-1.5 text-sm"
              value={language}
              onChange={(e) => setLanguage(e.target.value as RemarkLanguage)}
              disabled={!canEdit}
            >
              <option value="en">English</option>
              <option value="both">English + हिंदी</option>
              <option value="hi">हिंदी only</option>
            </select>
          </label>
          <label className="flex items-center gap-2 pb-2 text-xs text-[var(--muted)]">
            <input
              type="checkbox"
              checked={includeSubjects}
              onChange={(e) => setIncludeSubjects(e.target.checked)}
              disabled={!canEdit}
            />
            Subject remarks too
          </label>
        </div>
        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={!canEdit || busy !== null || withCards === 0}
            onClick={() => generate("all")}
            title="Draft remarks for every student with marks; existing text is replaced by the new draft until you save"
          >
            <Sparkles className="size-3.5" aria-hidden />
            {busy === "all" ? "Drafting…" : `AI draft all (${withCards})`}
          </button>
          <button
            type="button"
            className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50"
            disabled={!canEdit || !dirty}
            onClick={onSave}
          >
            Save remarks
          </button>
        </div>
      </div>

      <p className="mb-3 text-xs text-[var(--muted)]">
        {roster.length} students · {withCards} with marks
        {previousTerm ? ` · compared with ${previousTerm.label}` : " · no earlier exam to compare"}
        {aiCount ? ` · ${aiCount} AI-assisted` : ""}
        {dirty ? " · unsaved changes" : ""}
        {sheet.lockedAt ? " · marks locked (remarks still editable)" : ""}
        {engineNote ? ` · ${engineNote}` : ""}
      </p>

      <ErpTableShell>
        <ErpTable minWidth="min-w-full" className="text-xs sm:text-sm">
          <ErpTableHead>
            <tr>
              <th className="px-4 py-2.5 font-bold text-[var(--brand-deep)]">Student</th>
              <th className="px-4 py-2.5 font-bold text-[var(--brand-deep)]">Result</th>
              <th className="w-[45%] px-4 py-2.5 font-bold text-[var(--brand-deep)]">
                Class teacher&apos;s remark
              </th>
              <th className="px-4 py-2.5 font-bold text-[var(--brand-deep)]">Source</th>
              <th className="px-2 py-2.5" />
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {rows.map((row) => {
              const st = roster.find((s) => s.id === row.studentId);
              if (!st) return null;
              const isOpen = expanded.has(row.studentId);
              return (
                <tr key={row.studentId} className="border-b border-[var(--border)] align-top">
                  <td className="px-3 py-2">
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
                  <td className="px-4 py-2 tabular-nums">
                    {row.card ? (
                      <>
                        <div className="font-semibold text-[var(--brand-deep)]">
                          {row.card.percent}% · {row.card.overallGrade}
                        </div>
                        <div className="text-[10px] text-[var(--muted)]">
                          {row.card.attendance ? `Att. ${row.card.attendance.percent}%` : "Att. —"}
                        </div>
                      </>
                    ) : (
                      <span className="text-[10px] text-[var(--muted)]" title={row.cardError}>
                        No result yet
                      </span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <textarea
                      className="field min-h-[64px] w-full !px-2 !py-1.5 text-xs leading-relaxed"
                      value={row.text}
                      placeholder={row.card ? "Overall remark (English)" : "Enter marks first"}
                      disabled={!canEdit || !row.card}
                      onChange={(e) => setText(row.studentId, "text", e.target.value)}
                      aria-label={`${st.fullName} remark`}
                    />
                    {language !== "en" || row.textHi ? (
                      <textarea
                        className="field mt-1 min-h-[56px] w-full !px-2 !py-1.5 text-xs leading-relaxed"
                        value={row.textHi}
                        placeholder="हिंदी में टिप्पणी"
                        disabled={!canEdit || !row.card}
                        onChange={(e) => setText(row.studentId, "textHi", e.target.value)}
                        aria-label={`${st.fullName} remark (Hindi)`}
                        lang="hi"
                      />
                    ) : null}
                    {isOpen ? (
                      <div className="mt-2 grid gap-1 sm:grid-cols-2">
                        {row.subjects.map((s) => (
                          <label key={s.subjectId} className="block">
                            <span className="mb-0.5 flex items-center justify-between text-[10px] text-[var(--muted)]">
                              <span>{s.subjectName}</span>
                              <span>{s.remark ? sourceLabel(s.source) : ""}</span>
                            </span>
                            <input
                              className="field w-full !px-2 !py-1 text-xs"
                              value={s.remark}
                              disabled={!canEdit}
                              onChange={(e) =>
                                setSubjectRemark(row.studentId, s.subjectId, e.target.value)
                              }
                              aria-label={`${st.fullName} ${s.subjectName} remark`}
                            />
                          </label>
                        ))}
                      </div>
                    ) : null}
                  </td>
                  <td className="px-4 py-2">
                    {row.text || row.textHi ? (
                      <span
                        className={
                          row.source === "manual"
                            ? "rounded-md bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-semibold text-[var(--muted)]"
                            : "rounded-md bg-[var(--info-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--info)]"
                        }
                        title={
                          row.generatedAt
                            ? `Generated ${row.generatedAt.slice(0, 16).replace("T", " ")} · ${row.model}`
                            : undefined
                        }
                      >
                        {sourceLabel(row.source)}
                      </span>
                    ) : (
                      <span className="text-[10px] text-[var(--muted)]">—</span>
                    )}
                  </td>
                  <td className="px-2 py-2">
                    <div className="flex flex-col gap-1">
                      <button
                        type="button"
                        className="inline-flex items-center gap-1 rounded-md border border-[var(--border)] px-2 py-1 text-[10px] font-semibold disabled:opacity-50"
                        disabled={!canEdit || busy !== null || !row.card}
                        onClick={() => generate([row.studentId])}
                        title="Draft with AI"
                      >
                        <Sparkles className="size-3" aria-hidden />
                        {busy === row.studentId ? "…" : row.text ? "Redraft" : "AI draft"}
                      </button>
                      <button
                        type="button"
                        className="rounded-md px-2 py-1 text-[10px] text-[var(--muted)] underline-offset-2 hover:underline"
                        onClick={() =>
                          setExpanded((prev) => {
                            const n = new Set(prev);
                            if (n.has(row.studentId)) n.delete(row.studentId);
                            else n.add(row.studentId);
                            return n;
                          })
                        }
                      >
                        {isOpen ? "Hide subjects" : `Subjects (${row.subjects.filter((s) => s.remark).length}/${row.subjects.length})`}
                      </button>
                    </div>
                  </td>
                </tr>
              );
            })}
          </ErpTableBody>
        </ErpTable>
      </ErpTableShell>
    </div>
  );
}
