"use client";

import { useRef, useState } from "react";
import { Camera, ClipboardList, Loader2, ScanLine } from "lucide-react";
import { photoForOcr, type OcrPhoto } from "@/lib/ocrClient";
import { ocrFirstPassUsable, puterEnabled, puterPathNote } from "@/lib/puterAi";
import { puterReadImageText } from "@/lib/puterAi.client";
import type { SyllabusImportChapter } from "@/lib/teaching";
import { postSyllabusScan, type SyllabusScanResult } from "@/components/teaching/teachingApi";

type ReviewTopic = { code: string; title: string; include: boolean };
type ReviewChapter = {
  code: string;
  title: string;
  include: boolean;
  confidence: "high" | "low";
  topics: ReviewTopic[];
};

/** Same cap as the scan route: a contents list rarely runs past two pages. */
const MAX_PAGES = 4;

/**
 * Photograph a textbook contents page and turn it into chapters.
 *
 * The scan never writes anything: it fills an editable review list, and
 * only the teacher's "Add to plan" press saves. Low-confidence rows are
 * marked and the lines the parser could not place are shown, so a
 * half-read page looks half-read rather than complete.
 *
 * Reads go through /api/v1/teaching/syllabus-scan with the class and
 * subject (2026-09-30), so a teacher is refused a class they do not teach
 * before any paid reading is made — the old /api/ocr/syllabus asked only
 * "is this staff". Several pages can be photographed at once; they are
 * shrunk on the phone to ~1600 px JPEG before upload.
 */
export function SyllabusOcrImport(props: {
  classId: string;
  subjectId: string;
  disabled?: boolean;
  /** Resolve true when saved — the review list closes; false keeps it open to retry. */
  onImport: (chapters: SyllabusImportChapter[]) => boolean | Promise<boolean>;
  onError: (msg: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [saving, setSaving] = useState(false);
  const [open, setOpen] = useState(false);
  const [pasteText, setPasteText] = useState("");
  const [showPaste, setShowPaste] = useState(false);
  const [rows, setRows] = useState<ReviewChapter[] | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [rawText, setRawText] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [verdict, setVerdict] = useState<"good" | "partial" | "poor" | null>(
    null,
  );
  /** Which engine actually read the page — shown so a teacher knows how hard to check. */
  const [path, setPath] = useState<"puter" | "paid" | null>(null);
  /** Only set when the free allowance ran out, which is the one failure worth a word. */
  const [freeNote, setFreeNote] = useState<string | null>(null);

  /**
   * One review list, whichever engine produced it. Both the free pass and
   * the paid scan end here, so there is exactly one place that decides what
   * a teacher sees — and no way for the cheap path to skip a check.
   */
  function applyResult(result: SyllabusScanResult) {
    setRows(
      (result.chapters ?? []).map((c) => ({
        code: c.code,
        title: c.title,
        include: true,
        confidence: c.confidence,
        topics: (c.topics ?? []).map((t) => ({
          code: t.code,
          title: t.title,
          include: true,
        })),
      })),
    );
    setIgnored(result.ignored ?? []);
    setRawText(result.rawText ?? "");
    setVerdict(result.quality?.verdict ?? null);
    setOpen(true);
  }

  async function onFiles(list: FileList | null) {
    const files = Array.from(list ?? []);
    if (!files.length) return;
    props.onError(null);
    if (files.length > MAX_PAGES) {
      props.onError(`At most ${MAX_PAGES} pages at a time — scan the rest separately`);
      if (fileRef.current) fileRef.current.value = "";
      return;
    }
    setBusy(true);
    setRows(null);
    setVerdict(null);
    setPath(null);
    setFreeNote(null);
    try {
      const photos: OcrPhoto[] = [];
      for (const [i, file] of files.entries()) {
        const read = await photoForOcr(file);
        if (!read.ok) {
          props.onError(files.length > 1 ? `Page ${i + 1}: ${read.error}` : read.error);
          return;
        }
        photos.push(read);
      }

      // Free first pass (puterAi.ts). It reads the photos in the browser at
      // no cost to the school, then hands the text to the SAME parser the
      // pasted-list path uses — so the review list, the confidence marks
      // and the "nothing is saved until you confirm" promise are identical.
      //
      // It is a first pass, not a cheaper scan: if ANY page reads thin or
      // garbled, the whole set goes to Vision instead, because half a
      // contents list presented as a whole one is worse than no scan at
      // all. A printed textbook page carries no student data, which is why
      // this surface is cleared and no other OCR is.
      if (puterEnabled()) {
        const texts: string[] = [];
        for (const photo of photos) {
          const free = await puterReadImageText(photo.dataUrl);
          if (free.ok && ocrFirstPassUsable(free.text)) {
            texts.push(free.text);
            continue;
          }
          if (!free.ok && free.kind === "quota") setFreeNote(free.message);
          break;
        }
        if (texts.length === photos.length) {
          const parsed = await postSyllabusScan({
            classId: props.classId,
            subjectId: props.subjectId,
            text: texts.join("\n"),
          });
          if (parsed.ok) {
            applyResult(parsed.data);
            setPath("puter");
            return;
          }
          // A refusal (not your class) is the answer, not a reason to pay
          // for a second reading.
          props.onError(parsed.error);
          return;
        }
      }

      const result = await postSyllabusScan({
        classId: props.classId,
        subjectId: props.subjectId,
        images: photos.map((p) => ({ imageBase64: p.base64, mimeType: p.mimeType })),
      });
      if (!result.ok) {
        props.onError(result.error || "Could not read that page");
        return;
      }
      applyResult(result.data);
      setPath("paid");
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  async function onPaste() {
    props.onError(null);
    const text = pasteText.trim();
    if (!text) return props.onError("Paste the contents list first");
    setBusy(true);
    setRows(null);
    setVerdict(null);
    setPath(null);
    setFreeNote(null);
    try {
      // Same parser, same review, same no-invention rule as a scan — the only
      // difference is the text arrived clean instead of through a camera.
      const result = await postSyllabusScan({
        classId: props.classId,
        subjectId: props.subjectId,
        text,
      });
      if (!result.ok) {
        props.onError(result.error || "Could not read that list");
        return;
      }
      applyResult(result.data);
      setShowPaste(false);
    } finally {
      setBusy(false);
    }
  }

  async function save() {
    if (!rows || saving) return;
    const chapters: SyllabusImportChapter[] = rows
      .filter((c) => c.include && c.title.trim())
      .map((c) => ({
        code: c.code,
        title: c.title,
        topics: c.topics
          .filter((t) => t.include && t.title.trim())
          .map((t) => ({ code: t.code, title: t.title })),
      }));
    if (chapters.length === 0) {
      props.onError("Nothing ticked to import");
      return;
    }
    setSaving(true);
    try {
      // The list stays on screen until the save is confirmed: a failed
      // import that also threw away the teacher's corrections would make
      // them scan and edit the page all over again.
      const saved = await props.onImport(chapters);
      if (!saved) return;
      setRows(null);
      setOpen(false);
    } finally {
      setSaving(false);
    }
  }

  const selected = rows?.filter((c) => c.include).length ?? 0;

  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <ScanLine className="h-4 w-4 text-[var(--muted)]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            Scan syllabus / contents page
          </p>
          <p className="text-xs text-[var(--muted)]">
            Photograph the printed contents page (two pages is fine), or paste
            the list from an e-book — chapters and topics are detected for you
            to check before saving. Nothing is added to the plan until you
            press Add.
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*"
          // `capture` makes a phone open the camera straight away; a
          // laptop ignores it and shows the normal file picker. `multiple`
          // lets a contents list that runs over two pages go as one scan.
          capture="environment"
          multiple
          className="hidden"
          onChange={(e) => void onFiles(e.target.files)}
        />
        <div className="flex shrink-0 gap-2">
          <button
            type="button"
            disabled={props.disabled || busy}
            onClick={() => {
              setShowPaste((v) => !v);
              props.onError(null);
            }}
            className="inline-flex items-center gap-2 rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--ink)] disabled:opacity-50"
          >
            <ClipboardList className="h-4 w-4" />
            Paste list
          </button>
          <button
            type="button"
            disabled={props.disabled || busy}
            onClick={() => fileRef.current?.click()}
            className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            {busy ? (
              <Loader2 className="h-4 w-4 animate-spin" />
            ) : (
              <Camera className="h-4 w-4" />
            )}
            {busy ? "Reading…" : "Scan pages"}
          </button>
        </div>
      </div>

      {showPaste ? (
        <div className="mt-3 border-t border-[var(--border)] pt-3">
          <label className="text-xs font-semibold text-[var(--muted)]">
            Contents list from the book
          </label>
          <textarea
            className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 text-sm"
            rows={8}
            value={pasteText}
            onChange={(e) => setPasteText(e.target.value)}
            placeholder={"Chapter 1  Knowing Our Numbers\n1.1 Introduction\n1.2 Comparing Numbers\nChapter 2  Whole Numbers\n…"}
          />
          <div className="mt-2 flex items-center gap-2">
            <button
              type="button"
              disabled={busy || !pasteText.trim()}
              onClick={() => void onPaste()}
              className="inline-flex items-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {busy ? <Loader2 className="h-4 w-4 animate-spin" /> : null}
              {busy ? "Reading…" : "Detect chapters"}
            </button>
            <span className="text-[11px] text-[var(--muted)]">
              Open the shelf, copy the contents page, paste it here.
            </span>
          </div>
        </div>
      ) : null}

      {freeNote ? (
        <p className="mt-2 text-[11px] text-[var(--muted)]">{freeNote}</p>
      ) : null}

      {open && rows ? (
        <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
          {path ? (
            <p className="text-[11px] text-[var(--muted)]">{puterPathNote(path)}</p>
          ) : null}
          {verdict === "poor" ? (
            <div className="rounded-lg border border-[var(--danger)]/25 bg-[var(--danger-soft)] px-3 py-2">
              <p className="text-sm font-semibold text-[var(--brand-deep)]">
                Nothing recognisable on that page
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                Try a straighter, brighter photo of just the contents page —
                or add the chapters by hand below.
              </p>
            </div>
          ) : verdict === "partial" ? (
            <div className="rounded-lg border border-[var(--warning)]/25 bg-[var(--warning-soft)] px-3 py-2">
              <p className="text-sm font-semibold text-[var(--brand-deep)]">
                Read only partly — please check every row
              </p>
              <p className="mt-0.5 text-xs text-[var(--muted)]">
                Rows marked <em>guess</em> had no chapter number printed.
              </p>
            </div>
          ) : (
            <p className="text-sm text-[var(--success)]">
              Found {rows.length} chapter{rows.length === 1 ? "" : "s"}. Check
              and edit before saving.
            </p>
          )}

          <ul className="max-h-80 space-y-2 overflow-y-auto">
            {rows.map((c, ci) => (
              <li
                key={ci}
                className="rounded-lg border border-[var(--border)] px-3 py-2"
              >
                <div className="flex items-center gap-2">
                  <input
                    type="checkbox"
                    checked={c.include}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev!.map((x, i) =>
                          i === ci ? { ...x, include: e.target.checked } : x,
                        ),
                      )
                    }
                  />
                  <input
                    value={c.code}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev!.map((x, i) =>
                          i === ci ? { ...x, code: e.target.value } : x,
                        ),
                      )
                    }
                    placeholder="No."
                    className="w-16 rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
                  />
                  <input
                    value={c.title}
                    onChange={(e) =>
                      setRows((prev) =>
                        prev!.map((x, i) =>
                          i === ci ? { ...x, title: e.target.value } : x,
                        ),
                      )
                    }
                    className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-sm"
                  />
                  {c.confidence === "low" ? (
                    <span className="shrink-0 rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-[10px] font-semibold text-[var(--warning)]">
                      guess
                    </span>
                  ) : null}
                </div>

                {c.topics.length > 0 ? (
                  <ul className="mt-1.5 space-y-1 pl-7">
                    {c.topics.map((t, ti) => (
                      <li key={ti} className="flex items-center gap-2">
                        <input
                          type="checkbox"
                          checked={t.include}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev!.map((x, i) =>
                                i === ci
                                  ? {
                                      ...x,
                                      topics: x.topics.map((y, j) =>
                                        j === ti
                                          ? { ...y, include: e.target.checked }
                                          : y,
                                      ),
                                    }
                                  : x,
                              ),
                            )
                          }
                        />
                        <input
                          value={t.title}
                          onChange={(e) =>
                            setRows((prev) =>
                              prev!.map((x, i) =>
                                i === ci
                                  ? {
                                      ...x,
                                      topics: x.topics.map((y, j) =>
                                        j === ti
                                          ? { ...y, title: e.target.value }
                                          : y,
                                      ),
                                    }
                                  : x,
                              ),
                            )
                          }
                          className="min-w-0 flex-1 rounded border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-xs"
                        />
                      </li>
                    ))}
                  </ul>
                ) : null}
              </li>
            ))}
          </ul>

          {ignored.length > 0 ? (
            <details className="text-xs text-[var(--muted)]">
              <summary className="cursor-pointer font-semibold">
                {ignored.length} line{ignored.length === 1 ? "" : "s"} not used
              </summary>
              <ul className="mt-1 space-y-0.5 pl-4">
                {ignored.slice(0, 40).map((l, i) => (
                  <li key={i} className="truncate">
                    {l}
                  </li>
                ))}
              </ul>
            </details>
          ) : null}

          {rawText ? (
            <details
              open={showRaw}
              onToggle={(e) => setShowRaw((e.target as HTMLDetailsElement).open)}
              className="text-xs text-[var(--muted)]"
            >
              <summary className="cursor-pointer font-semibold">
                Show the raw text that was read
              </summary>
              <pre className="mt-1 max-h-40 overflow-auto whitespace-pre-wrap rounded bg-[var(--surface-sunken)] p-2">
                {rawText}
              </pre>
            </details>
          ) : null}

          <div className="flex gap-2">
            <button
              type="button"
              onClick={() => void save()}
              disabled={selected === 0 || saving}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              {saving
                ? "Adding…"
                : `Add ${selected} chapter${selected === 1 ? "" : "s"} to plan`}
            </button>
            <button
              type="button"
              onClick={() => {
                setRows(null);
                setOpen(false);
              }}
              className="rounded-lg border border-[var(--border)] px-4 py-2 text-sm font-semibold text-[var(--muted)]"
            >
              Discard
            </button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
