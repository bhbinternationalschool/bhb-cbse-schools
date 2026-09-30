"use client";

import { useRef, useState } from "react";
import { Camera, Loader2 } from "lucide-react";
import { photoForOcr } from "@/lib/ocrClient";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import {
  droppedNote,
  renderHomeworkFromPage,
  HOMEWORK_PAGE_MAX_IMAGES,
  type HomeworkPageLanguage,
  type HomeworkPageReading,
} from "@/lib/homeworkPageScanAi";

type Readable = Extract<HomeworkPageReading, { readable: true }>;

type ScanResponse = {
  reading: HomeworkPageReading;
  chapterHint: string;
  language: HomeworkPageLanguage;
  generationId: string;
};

export type HomeworkPageDraftForForm = {
  title: string;
  body: string;
  language: HomeworkPageLanguage;
  /** "Ch 5 — Fractions" from the school's own book, or "" */
  chapterHint: string;
  generationId: string;
};

/**
 * "Scan book page" on the homework form (2026-09-30).
 *
 * The teacher photographs the page they are setting; the page is read
 * (POST /api/ai/homework-page-scan, which refuses a subject they do not
 * teach before any reading is paid for) and the questions come back as a
 * ticked list. "Put in the form" writes the draft into the ordinary title
 * and body fields — it saves nothing. The teacher edits and posts through
 * the normal Publish button; the form reports accepted / edited against
 * the generationId, and Discard here reports rejected.
 *
 * A page that could not be read says so, with the reason, and offers no
 * draft: an empty or guessed homework is worse than typing it.
 */
export function HomeworkPageScan(props: {
  classId: string;
  sectionId: string;
  subjectId: string;
  subjectLabel: string;
  disabled?: boolean;
  onUse: (draft: HomeworkPageDraftForForm) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [language, setLanguage] = useState<HomeworkPageLanguage>("en");
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [unreadable, setUnreadable] = useState<string | null>(null);
  const [result, setResult] = useState<(ScanResponse & { reading: Readable }) | null>(null);
  const [selected, setSelected] = useState<Set<number>>(new Set());

  const ready = !!(props.classId && props.sectionId && props.subjectId);

  function clear() {
    setResult(null);
    setUnreadable(null);
    setSelected(new Set());
  }

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    setError(null);
    clear();
    if (files.length > HOMEWORK_PAGE_MAX_IMAGES) {
      setError(`At most ${HOMEWORK_PAGE_MAX_IMAGES} pages at a time`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setBusy(true);
    try {
      const images: { imageBase64: string; mimeType: string }[] = [];
      for (const [i, file] of files.entries()) {
        const photo = await photoForOcr(file);
        if (!photo.ok) {
          setError(files.length > 1 ? `Page ${i + 1}: ${photo.error}` : photo.error);
          return;
        }
        images.push({ imageBase64: photo.base64, mimeType: photo.mimeType });
      }
      const res = await fetch("/api/ai/homework-page-scan", {
        method: "POST",
        credentials: "same-origin",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          classId: props.classId,
          sectionId: props.sectionId,
          subjectId: props.subjectId,
          language,
          images,
        }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok?: boolean; data?: ScanResponse; error?: { message?: string } | string }
        | null;
      if (!res.ok || !json?.ok || !json.data) {
        const err = json?.error;
        setError((typeof err === "string" ? err : err?.message) || `Could not read the page (${res.status})`);
        return;
      }
      const data = json.data;
      if (!data.reading.readable) {
        // Unread is said as unread. Nothing is offered for the form — and no
        // outcome is reported: nobody rejected a draft, there was none.
        setUnreadable(data.reading.reason);
        return;
      }
      setResult({ ...data, reading: data.reading });
      setSelected(new Set(data.reading.questions.map((_, i) => i)));
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not reach the server");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function use() {
    if (!result) return;
    const draft = renderHomeworkFromPage({
      reading: result.reading,
      selected: [...selected],
      language: result.language,
      subjectLabel: props.subjectLabel,
    });
    props.onUse({
      ...draft,
      language: result.language,
      chapterHint: result.chapterHint,
      generationId: result.generationId,
    });
    clear();
  }

  function discard() {
    if (result) {
      reportAiOutcome({ ids: [result.generationId], outcome: "rejected", targetType: "homework_page_scan" });
    }
    clear();
  }

  const reading = result?.reading;
  const note = reading ? droppedNote(reading.dropped) : "";

  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] px-3 py-3">
      <div className="flex flex-wrap items-center gap-2">
        <div className="min-w-[14rem] flex-1">
          <p className="text-sm font-semibold text-[var(--brand-deep)]">Scan book page</p>
          <p className="text-xs text-[var(--muted)]">
            Photograph the exercise — the questions are read for you to tick. Nothing is posted until you press
            Publish.
          </p>
        </div>
        <select
          className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1.5 text-xs"
          value={language}
          onChange={(e) => setLanguage(e.target.value === "hi" ? "hi" : "en")}
          aria-label="Homework language"
          disabled={busy}
        >
          <option value="en">English</option>
          <option value="hi">हिंदी</option>
        </select>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          // Opens the back camera on a phone; a laptop shows the file picker.
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <button
          type="button"
          disabled={props.disabled || busy || !ready}
          onClick={() => fileRef.current?.click()}
          className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          title={ready ? undefined : "Pick the class, section and subject first"}
        >
          {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : <Camera className="h-4 w-4" />}
          {busy ? "Reading…" : "Scan page"}
        </button>
      </div>

      {error ? <p className="mt-2 text-xs text-[var(--danger)]">{error}</p> : null}

      {unreadable ? (
        <div className="mt-3 rounded-lg border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3 py-2">
          <p className="text-sm font-semibold text-[var(--brand-deep)]">Could not read that page</p>
          <p className="mt-0.5 text-xs text-[var(--muted)]">
            {unreadable}. Try a straighter, brighter photo of just the exercise — or type the homework below.
          </p>
        </div>
      ) : null}

      {reading ? (
        <div className="mt-3 space-y-2 border-t border-[var(--border)] pt-3 text-xs">
          <p className="text-[var(--muted)]">
            {[
              reading.chapterHeading ? `Chapter: ${reading.chapterHeading}` : "",
              reading.exercise ? `Exercise ${reading.exercise}` : "",
              reading.pageNumber ? `page ${reading.pageNumber}` : "",
            ]
              .filter(Boolean)
              .join(" · ") || "No exercise heading printed on the page"}
            {result?.chapterHint ? ` · tutor hint: ${result.chapterHint}` : ""}
          </p>
          {note ? <p className="text-[var(--warning)]">{note}</p> : null}
          {reading.questions.length ? (
            <ul className="max-h-64 space-y-1 overflow-y-auto">
              {reading.questions.map((q, i) => (
                <li key={i}>
                  <label className="flex items-start gap-2">
                    <input
                      type="checkbox"
                      className="mt-0.5"
                      checked={selected.has(i)}
                      onChange={(e) =>
                        setSelected((prev) => {
                          const next = new Set(prev);
                          if (e.target.checked) next.add(i);
                          else next.delete(i);
                          return next;
                        })
                      }
                    />
                    <span className="text-[var(--ink)]">
                      {q.number ? <strong>{q.number}. </strong> : null}
                      {q.text}
                    </span>
                  </label>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-[var(--muted)]">No questions were read — only the heading.</p>
          )}
          <div className="flex flex-wrap gap-2">
            <button
              type="button"
              onClick={use}
              disabled={reading.questions.length > 0 && selected.size === 0}
              className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              Put in the homework form
            </button>
            <button
              type="button"
              onClick={discard}
              className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--muted)]"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
