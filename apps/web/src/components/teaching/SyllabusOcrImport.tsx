"use client";

import { useRef, useState } from "react";
import { Camera, Loader2, ScanLine } from "lucide-react";
import { readFileAsDataUrlForOcr, runSyllabusOcrApi } from "@/lib/ocrClient";
import type { SyllabusImportChapter } from "@/lib/teaching";

type ReviewTopic = { code: string; title: string; include: boolean };
type ReviewChapter = {
  code: string;
  title: string;
  include: boolean;
  confidence: "high" | "low";
  topics: ReviewTopic[];
};

/**
 * Photograph a textbook contents page and turn it into chapters.
 *
 * The scan never writes anything: it fills an editable review list, and
 * only the teacher's "Add to plan" press saves. Low-confidence rows are
 * marked and the lines the parser could not place are shown, so a
 * half-read page looks half-read rather than complete.
 */
export function SyllabusOcrImport(props: {
  disabled?: boolean;
  onImport: (chapters: SyllabusImportChapter[]) => void;
  onError: (msg: string | null) => void;
}) {
  const fileRef = useRef<HTMLInputElement | null>(null);
  const [busy, setBusy] = useState(false);
  const [open, setOpen] = useState(false);
  const [rows, setRows] = useState<ReviewChapter[] | null>(null);
  const [ignored, setIgnored] = useState<string[]>([]);
  const [rawText, setRawText] = useState("");
  const [showRaw, setShowRaw] = useState(false);
  const [verdict, setVerdict] = useState<"good" | "partial" | "poor" | null>(
    null,
  );

  async function onFile(file: File | undefined) {
    if (!file) return;
    props.onError(null);
    setBusy(true);
    setRows(null);
    setVerdict(null);
    try {
      const read = await readFileAsDataUrlForOcr(file);
      if (!read.ok) {
        props.onError(read.error);
        return;
      }
      const result = await runSyllabusOcrApi({
        dataUrl: read.url,
        mimeType: read.mimeType,
      });
      if (!result.ok) {
        props.onError(
          result.visionConfigured === false
            ? "Text recognition is not switched on for this school yet — ask your administrator to enable the Vision API."
            : result.error || "Could not read that page",
        );
        return;
      }
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
    } finally {
      setBusy(false);
      if (fileRef.current) fileRef.current.value = "";
    }
  }

  function save() {
    if (!rows) return;
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
    props.onImport(chapters);
    setRows(null);
    setOpen(false);
  }

  const selected = rows?.filter((c) => c.include).length ?? 0;

  return (
    <div className="rounded-xl border border-dashed border-[var(--border)] px-4 py-3">
      <div className="flex flex-wrap items-center gap-3">
        <ScanLine className="h-4 w-4 text-[var(--muted)]" />
        <div className="min-w-0 flex-1">
          <p className="text-sm font-semibold text-[var(--brand-deep)]">
            Import from the book
          </p>
          <p className="text-xs text-[var(--muted)]">
            Photograph the contents page — chapters and topics are detected
            for you to check before saving.
          </p>
        </div>
        <input
          ref={fileRef}
          type="file"
          accept="image/*,application/pdf"
          // `capture` makes a phone open the camera straight away; a
          // laptop ignores it and shows the normal file picker.
          capture="environment"
          className="hidden"
          onChange={(e) => void onFile(e.target.files?.[0])}
        />
        <button
          type="button"
          disabled={props.disabled || busy}
          onClick={() => fileRef.current?.click()}
          className="inline-flex shrink-0 items-center gap-2 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
        >
          {busy ? (
            <Loader2 className="h-4 w-4 animate-spin" />
          ) : (
            <Camera className="h-4 w-4" />
          )}
          {busy ? "Reading…" : "Scan page"}
        </button>
      </div>

      {open && rows ? (
        <div className="mt-3 space-y-3 border-t border-[var(--border)] pt-3">
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
              onClick={save}
              disabled={selected === 0}
              className="rounded-lg bg-[var(--primary)] px-4 py-2 text-sm font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              Add {selected} chapter{selected === 1 ? "" : "s"} to plan
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
