"use client";

/**
 * Scan a child's answer sheet → AI-suggested marks → the teacher confirms
 * → the total lands in that child's cell of the marks grid (2026-09-30).
 *
 * Built for a teacher on a phone: camera capture, pages added one or many
 * at a time, each shrunk to ~1600 px JPEG before it leaves the device (a
 * raw phone photo is 4 MB; eight of them over school Wi-Fi is a minute of
 * waiting before the model has seen anything).
 *
 * The mark sheet stores ONE number per subject (see
 * /api/v1/staff/exams/marks), so per-question marks live only in this
 * dialog: the teacher reviews them, and "Use these marks" writes their sum
 * into the grid. Nothing is saved until the teacher presses the grid's own
 * Save — the same path as a typed mark.
 *
 * A question the AI could not mark is shown highlighted and BLANK, and the
 * total cannot be used until the teacher has filled every blank: a missing
 * answer silently counted as zero is exactly the "unknown became fact"
 * mistake this ERP keeps paying for.
 */

import { useEffect, useMemo, useRef, useState } from "react";
import { Camera, Loader2, ScanLine, Trash2 } from "lucide-react";
import { Dialog, DialogPopup } from "@/components/ui/dialog";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import {
  ANSWER_SHEET_MAX_PAGES,
  answerSheetOutcome,
  type AnswerSheetConfidence,
  type AnswerSheetSuggestion,
} from "@/lib/answerSheetAi";

export type ScanSubject = { id: string; code: string; name: string; maxMarks: number };

type PaperOption = {
  id: string;
  paperCode: string;
  title: string;
  examName: string;
  termMatch: boolean;
  activeSetCode: string;
  sets: { setCode: string; label: string; questionCount: number; keyedCount: number; maxTotal: number }[];
};

type ReviewRow = AnswerSheetSuggestion & { text: string; hasKey: boolean };

type ScanResult = {
  generationId: string;
  maxTotal: number;
  questions: ReviewRow[];
};

type Page = { id: string; base64: string; previewUrl: string; bytes: number };

/** Longest edge sent to the model — handwriting stays legible, the upload stays small. */
const MAX_EDGE = 1600;

async function shrinkToJpeg(file: File): Promise<{ base64: string; blob: Blob }> {
  const bitmap = await createImageBitmap(file);
  const scale = Math.min(1, MAX_EDGE / Math.max(bitmap.width, bitmap.height));
  const canvas = document.createElement("canvas");
  canvas.width = Math.max(1, Math.round(bitmap.width * scale));
  canvas.height = Math.max(1, Math.round(bitmap.height * scale));
  const ctx = canvas.getContext("2d");
  if (!ctx) {
    bitmap.close();
    throw new Error("no canvas");
  }
  // JPEG has no transparency; a PNG screenshot would otherwise go black.
  ctx.fillStyle = "white";
  ctx.fillRect(0, 0, canvas.width, canvas.height);
  ctx.drawImage(bitmap, 0, 0, canvas.width, canvas.height);
  bitmap.close();
  const blob = await new Promise<Blob | null>((resolve) => canvas.toBlob(resolve, "image/jpeg", 0.82));
  if (!blob) throw new Error("encode failed");
  const base64 = await new Promise<string>((resolve, reject) => {
    const reader = new FileReader();
    reader.onload = () => resolve(String(reader.result).replace(/^data:[^;]+;base64,/, ""));
    reader.onerror = () => reject(new Error("read failed"));
    reader.readAsDataURL(blob);
  });
  return { base64, blob };
}

function parseMark(raw: string): number | null {
  const t = raw.trim();
  if (!t) return null;
  const n = Number(t);
  return Number.isFinite(n) ? n : null;
}

const CONFIDENCE_LABEL: Record<AnswerSheetConfidence, string> = {
  high: "Sure",
  medium: "Check",
  low: "Unsure",
};

const CONFIDENCE_TONE: Record<AnswerSheetConfidence, string> = {
  high: "text-[var(--tone-green)]",
  medium: "text-[var(--tone-amber)]",
  low: "text-[var(--danger)]",
};

export function AnswerSheetScanDialog({
  studentId,
  studentName,
  classId,
  sectionId,
  termId,
  subjects,
  defaultSubjectId,
  onUse,
  onClose,
}: {
  studentId: string;
  studentName: string;
  classId: string;
  sectionId: string;
  termId: string;
  /** The grid's whole-subject columns this child takes. */
  subjects: ScanSubject[];
  defaultSubjectId?: string;
  onUse: (subjectId: string, total: number) => void;
  onClose: () => void;
}) {
  const [subjectId, setSubjectId] = useState(defaultSubjectId || subjects[0]?.id || "");
  const subject = subjects.find((s) => s.id === subjectId) ?? null;
  const [papers, setPapers] = useState<PaperOption[] | null>(null);
  const [papersError, setPapersError] = useState<string | null>(null);
  const [paperId, setPaperId] = useState("");
  const [setCode, setSetCode] = useState("");
  const [pages, setPages] = useState<Page[]>([]);
  const [busy, setBusy] = useState<"adding" | "reading" | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [result, setResult] = useState<ScanResult | null>(null);
  /** questionId → what the teacher has in the box. */
  const [marks, setMarks] = useState<Record<string, string>>({});
  const fileRef = useRef<HTMLInputElement>(null);
  const reported = useRef(false);

  // Object URLs outlive the component unless released.
  const pagesRef = useRef(pages);
  pagesRef.current = pages;
  useEffect(() => () => pagesRef.current.forEach((p) => URL.revokeObjectURL(p.previewUrl)), []);

  useEffect(() => {
    if (!subject) return;
    let cancelled = false;
    setPapers(null);
    setPapersError(null);
    const qs = new URLSearchParams({ classId, sectionId, subjectCode: subject.code, termId });
    fetch(`/api/ai/answer-sheet-marks?${qs.toString()}`)
      .then(async (res) => {
        const json = (await res.json().catch(() => null)) as
          | { ok: true; data: { papers: PaperOption[] } }
          | { ok: false; error?: { message?: string } }
          | null;
        if (cancelled) return;
        if (!json || !json.ok) {
          setPapersError((json && !json.ok && json.error?.message) || "Could not load the question papers");
          setPapers([]);
          return;
        }
        setPapers(json.data.papers);
        // The obvious paper is this exam's; failing that, the only one.
        const pick = json.data.papers.find((p) => p.termMatch) ?? (json.data.papers.length === 1 ? json.data.papers[0] : undefined);
        setPaperId(pick?.id ?? "");
        setSetCode(pick?.activeSetCode ?? "");
      })
      .catch(() => {
        if (cancelled) return;
        setPapersError("Could not load the question papers");
        setPapers([]);
      });
    return () => {
      cancelled = true;
    };
  }, [classId, sectionId, termId, subject]);

  const paper = papers?.find((p) => p.id === paperId) ?? null;
  const set = paper?.sets.find((s) => s.setCode === setCode) ?? paper?.sets[0] ?? null;

  async function addFiles(files: FileList | null) {
    if (!files || !files.length) return;
    const room = ANSWER_SHEET_MAX_PAGES - pages.length;
    const list = Array.from(files).slice(0, Math.max(0, room));
    if (!list.length) {
      setError(`At most ${ANSWER_SHEET_MAX_PAGES} pages`);
      return;
    }
    setBusy("adding");
    setError(null);
    const added: Page[] = [];
    for (const f of list) {
      try {
        const { base64, blob } = await shrinkToJpeg(f);
        added.push({
          id: `${Date.now()}-${Math.random().toString(36).slice(2, 7)}`,
          base64,
          previewUrl: URL.createObjectURL(blob),
          bytes: blob.size,
        });
      } catch {
        setError(`Could not open ${f.name || "that photo"} — take it again with the camera`);
      }
    }
    setPages((prev) => [...prev, ...added]);
    setBusy(null);
    if (fileRef.current) fileRef.current.value = "";
  }

  function removePage(id: string) {
    setPages((prev) => {
      const gone = prev.find((p) => p.id === id);
      if (gone) URL.revokeObjectURL(gone.previewUrl);
      return prev.filter((p) => p.id !== id);
    });
  }

  async function read() {
    if (!subject || !paper || !set || !pages.length) return;
    setBusy("reading");
    setError(null);
    try {
      const res = await fetch("/api/ai/answer-sheet-marks", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          paperId: paper.id,
          setCode: set.setCode,
          studentId,
          classId,
          sectionId,
          subjectCode: subject.code,
          pages: pages.map((p) => ({ imageBase64: p.base64, mimeType: "image/jpeg" })),
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: ScanResult }
        | { ok: false; error?: { message?: string } }
        | null;
      if (!json || !json.ok) {
        setError((json && !json.ok && json.error?.message) || `Could not read the sheet (${res.status})`);
        return;
      }
      // A second reading replaces the first; the first was not used.
      if (result && !reported.current) {
        reportAiOutcome({ ids: [result.generationId], outcome: "rejected", targetType: "answer_sheet", targetId: studentId });
      }
      reported.current = false;
      setResult(json.data);
      setMarks(
        Object.fromEntries(
          json.data.questions.map((q) => [
            q.questionId,
            q.needsTeacher || q.suggestedMarks == null ? "" : String(q.suggestedMarks),
          ]),
        ),
      );
    } catch {
      setError("No connection — try again");
    } finally {
      setBusy(null);
    }
  }

  const review = useMemo(() => {
    if (!result) return null;
    let total = 0;
    let blanks = 0;
    let over = 0;
    for (const q of result.questions) {
      const n = parseMark(marks[q.questionId] ?? "");
      if (n == null) blanks += 1;
      else if (n < 0 || n > q.maxMarks) over += 1;
      else total += n;
    }
    return { total: Math.round(total * 2) / 2, blanks, over };
  }, [result, marks]);

  const subjectMax = subject?.maxMarks ?? 0;
  const canUse =
    !!result && !!review && review.blanks === 0 && review.over === 0 && review.total <= subjectMax;

  function close() {
    if (result && !reported.current) {
      reportAiOutcome({ ids: [result.generationId], outcome: "rejected", targetType: "answer_sheet", targetId: studentId });
      reported.current = true;
    }
    onClose();
  }

  /**
   * Back to the photos — a page the AI reported missing can be added, or a
   * blurred one retaken, and the sheet read again. This reading was not used.
   */
  function backToPhotos() {
    if (result && !reported.current) {
      reportAiOutcome({ ids: [result.generationId], outcome: "rejected", targetType: "answer_sheet", targetId: studentId });
      reported.current = true;
    }
    setResult(null);
    setMarks({});
    setError(null);
  }

  function use() {
    if (!canUse || !result || !review || !subject) return;
    const final = new Map(result.questions.map((q) => [q.questionId, parseMark(marks[q.questionId] ?? "")]));
    reportAiOutcome({
      ids: [result.generationId],
      outcome: answerSheetOutcome(result.questions, final),
      targetType: "answer_sheet",
      targetId: studentId,
    });
    reported.current = true;
    onUse(subject.id, review.total);
  }

  return (
    <Dialog open onOpenChange={(next) => !next && busy !== "reading" && close()}>
      <DialogPopup
        aria-labelledby="answer-sheet-scan-title"
        size="lg"
        className="max-h-[92vh] w-full overflow-y-auto rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4 shadow-2xl sm:p-5"
      >
        <div className="mb-3 flex items-start justify-between gap-3">
          <div className="min-w-0">
            <h2 id="answer-sheet-scan-title" className="text-base font-semibold text-[var(--brand-deep)]">
              Scan answer sheet · उत्तर पुस्तिका स्कैन
            </h2>
            <p className="truncate text-xs text-[var(--muted)]">{studentName}</p>
          </div>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-2.5 py-1 text-xs font-semibold"
            onClick={close}
            disabled={busy === "reading"}
          >
            Close
          </button>
        </div>

        {!result ? (
          <div className="space-y-3 text-sm">
            <label className="block text-xs font-semibold text-[var(--brand-deep)]">
              Subject · विषय
              <select
                className="field mt-1 w-full"
                value={subjectId}
                onChange={(e) => setSubjectId(e.target.value)}
              >
                {subjects.map((s) => (
                  <option key={s.id} value={s.id}>
                    {s.name} ({s.code}) · out of {s.maxMarks}
                  </option>
                ))}
              </select>
            </label>

            <label className="block text-xs font-semibold text-[var(--brand-deep)]">
              Question paper · प्रश्न पत्र
              {papers === null ? (
                <span className="mt-1 flex items-center gap-2 text-xs font-normal text-[var(--muted)]">
                  <Loader2 className="size-3.5 animate-spin" aria-hidden /> Loading papers…
                </span>
              ) : papers.length === 0 ? (
                <span className="mt-1 block text-xs font-normal text-[var(--danger)]">
                  {papersError || "No question paper for this class and subject on the papers desk — mark this one by hand."}
                </span>
              ) : (
                <select
                  className="field mt-1 w-full"
                  value={paperId}
                  onChange={(e) => {
                    setPaperId(e.target.value);
                    setSetCode(papers.find((p) => p.id === e.target.value)?.activeSetCode ?? "");
                  }}
                >
                  <option value="">Choose the paper…</option>
                  {papers.map((p) => (
                    <option key={p.id} value={p.id}>
                      {p.title}
                      {p.examName ? ` · ${p.examName}` : ""}
                      {p.termMatch ? " · this exam" : ""}
                    </option>
                  ))}
                </select>
              )}
            </label>

            {paper && paper.sets.length > 1 ? (
              <label className="block text-xs font-semibold text-[var(--brand-deep)]">
                Set the child wrote
                <select className="field mt-1 w-full" value={set?.setCode ?? ""} onChange={(e) => setSetCode(e.target.value)}>
                  {paper.sets.map((s) => (
                    <option key={s.setCode} value={s.setCode}>
                      Set {s.setCode}
                      {s.label ? ` · ${s.label}` : ""}
                    </option>
                  ))}
                </select>
              </label>
            ) : null}

            {set ? (
              <p className="text-xs text-[var(--muted)]">
                {set.questionCount} questions · out of {set.maxTotal} ·{" "}
                <span className={set.keyedCount < set.questionCount ? "font-semibold text-[var(--tone-amber)]" : ""}>
                  {set.keyedCount} with an answer key
                </span>
                {set.keyedCount < set.questionCount
                  ? " — the rest you will mark yourself"
                  : ""}
                {subject && set.maxTotal !== subject.maxMarks
                  ? ` · note: this exam is out of ${subject.maxMarks}`
                  : ""}
              </p>
            ) : null}

            <div>
              <div className="text-xs font-semibold text-[var(--brand-deep)]">
                Pages · पन्ने ({pages.length}/{ANSWER_SHEET_MAX_PAGES}) — in order, first page first
              </div>
              {pages.length ? (
                <div className="mt-2 grid grid-cols-4 gap-2">
                  {pages.map((p, i) => (
                    <div key={p.id} className="relative overflow-hidden rounded-lg border border-[var(--border)]">
                      {/* eslint-disable-next-line @next/next/no-img-element -- a local blob preview, never optimised */}
                      <img src={p.previewUrl} alt={`Page ${i + 1}`} className="aspect-[3/4] w-full object-cover" />
                      <span className="absolute left-1 top-1 rounded bg-[var(--card)] px-1 text-[10px] font-semibold">
                        {i + 1}
                      </span>
                      <button
                        type="button"
                        className="absolute right-1 top-1 rounded bg-[var(--card)] p-0.5"
                        onClick={() => removePage(p.id)}
                        aria-label={`Remove page ${i + 1}`}
                      >
                        <Trash2 className="size-3.5 text-[var(--danger)]" aria-hidden />
                      </button>
                    </div>
                  ))}
                </div>
              ) : null}
              <input
                ref={fileRef}
                type="file"
                accept="image/*"
                capture="environment"
                multiple
                className="hidden"
                onChange={(e) => void addFiles(e.target.files)}
              />
              <button
                type="button"
                className="mt-2 inline-flex w-full items-center justify-center gap-2 rounded-lg border border-dashed border-[var(--border)] px-3 py-3 text-sm font-semibold text-[var(--brand-deep)] disabled:opacity-50"
                onClick={() => fileRef.current?.click()}
                disabled={busy !== null || pages.length >= ANSWER_SHEET_MAX_PAGES}
              >
                {busy === "adding" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <Camera className="size-4" aria-hidden />}
                {pages.length ? "Add page · पन्ना जोड़ें" : "Take photo · फोटो लें"}
              </button>
            </div>

            {error ? <p className="text-xs font-semibold text-[var(--danger)]">{error}</p> : null}

            <button
              type="button"
              className="btn-accent inline-flex w-full items-center justify-center gap-2 rounded-lg px-3 py-2.5 text-sm font-semibold disabled:opacity-50"
              onClick={() => void read()}
              disabled={busy !== null || !paper || !set || !pages.length}
            >
              {busy === "reading" ? <Loader2 className="size-4 animate-spin" aria-hidden /> : <ScanLine className="size-4" aria-hidden />}
              {busy === "reading" ? "Reading the sheet… (up to a minute)" : "Suggest marks · अंक सुझाएँ"}
            </button>
            <p className="text-[11px] text-[var(--muted)]">
              The AI only suggests. You check every mark; nothing is saved until you press Save marks.
            </p>
          </div>
        ) : (
          <div className="space-y-3 text-sm">
            <p className="text-xs text-[var(--muted)]">
              Check each mark. Highlighted questions need you — the AI could not mark them.
            </p>
            <ol className="space-y-2">
              {result.questions.map((q) => {
                const value = marks[q.questionId] ?? "";
                const n = parseMark(value);
                const bad = n != null && (n < 0 || n > q.maxMarks);
                return (
                  <li
                    key={q.questionId}
                    className={`rounded-xl border p-2.5 ${
                      q.needsTeacher
                        ? "border-[var(--warning)]/60 bg-[var(--warning-soft)]"
                        : "border-[var(--border)]"
                    }`}
                  >
                    <div className="flex items-start gap-2">
                      <div className="min-w-0 flex-1">
                        <div className="flex flex-wrap items-center gap-x-2 text-xs">
                          <span className="font-bold text-[var(--brand-deep)]">Q{q.number}</span>
                          <span className="text-[var(--muted)]">max {q.maxMarks}</span>
                          <span className={`font-semibold ${CONFIDENCE_TONE[q.confidence]}`}>
                            {CONFIDENCE_LABEL[q.confidence]}
                          </span>
                          {!q.hasKey ? <span className="text-[var(--muted)]">· no key</span> : null}
                        </div>
                        <p className="mt-0.5 line-clamp-2 text-xs text-[var(--muted)]">{q.text}</p>
                        <p className="mt-1 text-xs">
                          <span className="font-semibold">Read · पढ़ा: </span>
                          {q.readAnswer ? q.readAnswer : <span className="text-[var(--muted)]">—</span>}
                        </p>
                        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
                          {q.reason}
                          {q.needsTeacher && q.suggestedMarks != null ? ` · AI suggested ${q.suggestedMarks}` : ""}
                        </p>
                      </div>
                      <label className="shrink-0 text-center text-[10px] text-[var(--muted)]">
                        <input
                          className={`field !w-16 !px-1 !py-1.5 text-center text-sm tabular-nums ${bad ? "!border-[var(--danger)]" : ""}`}
                          inputMode="decimal"
                          value={value}
                          placeholder="?"
                          onChange={(e) =>
                            setMarks((prev) => ({ ...prev, [q.questionId]: e.target.value.replace(/[^0-9.]/g, "") }))
                          }
                          aria-label={`Marks for question ${q.number}, out of ${q.maxMarks}`}
                        />
                        <span className="mt-0.5 block">/ {q.maxMarks}</span>
                      </label>
                    </div>
                  </li>
                );
              })}
            </ol>

            {review ? (
              <div className="sticky bottom-0 -mx-4 border-t border-[var(--border)] bg-[var(--card)] px-4 pt-3 sm:-mx-5 sm:px-5">
                <div className="flex flex-wrap items-baseline justify-between gap-2">
                  <span className="text-sm font-semibold text-[var(--brand-deep)]">
                    Total · कुल {review.total} / {result.maxTotal}
                  </span>
                  <span className="text-xs text-[var(--muted)]">
                    {review.blanks > 0
                      ? `${review.blanks} blank — fill them to continue`
                      : review.over > 0
                        ? `${review.over} over the question's max`
                        : review.total > subjectMax
                          ? `More than this exam's ${subjectMax} — enter it by hand`
                          : `Goes into ${subject?.name ?? "the subject"} (out of ${subjectMax})`}
                  </span>
                </div>
                {error ? <p className="mt-1 text-xs font-semibold text-[var(--danger)]">{error}</p> : null}
                <div className="mt-2 flex gap-2 pb-1">
                  <button
                    type="button"
                    className="flex-1 rounded-lg border border-[var(--border)] px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    onClick={backToPhotos}
                    disabled={busy !== null}
                  >
                    Back to photos
                  </button>
                  <button
                    type="button"
                    className="btn-accent flex-[2] rounded-lg px-3 py-2 text-xs font-semibold disabled:opacity-50"
                    onClick={use}
                    disabled={!canUse || busy !== null}
                  >
                    Use these marks · ये अंक लगाएँ
                  </button>
                </div>
              </div>
            ) : null}
          </div>
        )}
      </DialogPopup>
    </Dialog>
  );
}
