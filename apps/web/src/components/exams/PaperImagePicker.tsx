"use client";

/**
 * Pick a picture the school already has.
 *
 * Every diagram that arrived inside an imported paper is a stored file with a
 * stable URL, and any question may point at it. So reusing one costs nothing
 * — no upload, no second copy, no extra megabyte in the desk. This is the
 * screen that makes that reachable: search the school's own pictures, click
 * one, and the question points at the same file the original paper does.
 *
 * It searches by the text of the question a picture illustrates, because that
 * is how a teacher remembers it — "the clock one", "the angles diagram" — not
 * by file name, which the publisher chose and nobody has read.
 */

import { useMemo, useState } from "react";
import {
  listPaperImages,
  loadExamPapers,
  type PaperImageRef,
} from "@/lib/examPapers";

export function PaperImagePicker(props: {
  classId: string;
  subjectId: string;
  /** URLs already on this question — shown as "on this question". */
  usedUrls: string[];
  onPick: (image: PaperImageRef) => void;
  onClose: () => void;
}) {
  const [search, setSearch] = useState("");
  /** Off by default: a Class VI Maths question wants Class VI Maths diagrams. */
  const [everywhere, setEverywhere] = useState(false);

  const used = useMemo(() => new Set(props.usedUrls), [props.usedUrls]);

  const images = useMemo(() => {
    const state = loadExamPapers();
    const scoped = listPaperImages(state, {
      classId: everywhere ? undefined : props.classId,
      subjectId: everywhere ? undefined : props.subjectId,
      search,
    });
    // Looking only in this subject and finding nothing is a dead end the
    // teacher cannot see the way out of — say how many are elsewhere.
    return { scoped, all: listPaperImages(state, { search }).length };
  }, [props.classId, props.subjectId, search, everywhere]);

  return (
    <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2 text-xs">
      <div className="flex flex-wrap items-center gap-2">
        <span className="font-semibold">
          School pictures · {images.scoped.length}
        </span>
        <input
          className="field !w-56 !py-1 text-xs"
          placeholder="Search the question it illustrates…"
          value={search}
          onChange={(e) => setSearch(e.target.value)}
        />
        <label className="flex items-center gap-1">
          <input
            type="checkbox"
            checked={everywhere}
            onChange={(e) => setEverywhere(e.target.checked)}
          />
          Every class &amp; subject
        </label>
        <button type="button" className="ml-auto text-[11px] underline" onClick={props.onClose}>
          Close
        </button>
      </div>

      {images.scoped.length === 0 ? (
        <p className="mt-2 text-[11px] text-[var(--muted)]">
          {images.all > 0 && !everywhere ? (
            <>
              None for this class and subject. {images.all} elsewhere — tick
              &ldquo;every class &amp; subject&rdquo;.
            </>
          ) : (
            <>
              No stored pictures yet. They arrive with imported papers, or when
              a picture is added to a question here.
            </>
          )}
        </p>
      ) : (
        <div className="mt-2 grid max-h-72 grid-cols-2 gap-2 overflow-y-auto sm:grid-cols-4">
          {images.scoped.map((img) => {
            const already = used.has(img.url);
            return (
              <button
                key={img.url}
                type="button"
                disabled={already}
                className="rounded border border-[var(--border)] p-1 text-left disabled:opacity-50"
                onClick={() => props.onPick(img)}
                title={img.questionText || img.caption}
              >
                {/* eslint-disable-next-line @next/next/no-img-element */}
                <img
                  src={img.url}
                  alt={img.caption || img.questionText.slice(0, 80)}
                  className="h-20 w-full rounded object-contain"
                  loading="lazy"
                />
                <span className="mt-1 block truncate text-[10px] text-[var(--muted)]">
                  {already
                    ? "on this question"
                    : img.caption || img.questionText || img.paperCode || "picture"}
                </span>
                {img.uses > 1 ? (
                  <span className="block text-[10px] text-[var(--muted)]">
                    used on {img.uses} questions
                  </span>
                ) : null}
              </button>
            );
          })}
        </div>
      )}
    </div>
  );
}
