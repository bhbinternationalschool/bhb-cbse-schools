"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import { Check, CircleSlash, Info, RotateCcw } from "lucide-react";
import {
  applyDecision,
  isSettled,
  nextPending,
  progressLine,
  reviewCounts,
  unmappedReason,
  type ChapterOutcomes,
  type ProposedOutcome,
  type ReviewVerdict,
} from "@/lib/chapterStandards";

type Book = {
  textbookId: string;
  bookName: string;
  grade: number;
  chapters: ChapterOutcomes[];
};

/** Classes whose own books this school holds chapter by chapter. */
const GRADES = [1, 2, 3, 4, 5, 6, 7, 8];

/**
 * Only the subjects whose outcomes have been prepared. Offering Hindi here
 * would promise a list that does not exist — the standards this draws on cover
 * mathematics, science and English and nothing else.
 */
const SUBJECTS: { key: string; label: string }[] = [
  { key: "maths", label: "Mathematics" },
  { key: "science", label: "Science" },
  { key: "english", label: "English" },
];

function VerdictPill({ verdict }: { verdict: ReviewVerdict }) {
  if (verdict === "approved") {
    return (
      <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--success)]">
        In use
      </span>
    );
  }
  if (verdict === "rejected") {
    return (
      <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]">
        Not used
      </span>
    );
  }
  return (
    <span className="rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--warning)]">
      Needs a decision
    </span>
  );
}

/**
 * The outcomes proposed for each chapter of the school's own book, and the
 * screen where somebody who teaches the subject agrees with them or does not.
 *
 * Nothing here is live until it is agreed with. Every other screen reads
 * `learning_chapter_outcomes`, which cannot see a row that has not been
 * approved — so until a head of subject works through this list, lesson plans
 * and drills behave exactly as they did before any of this existed.
 *
 * The screen never shows the standard's own code. What it shows is the
 * sentence, which is the part a teacher can actually judge.
 */
export function ChapterOutcomesPanel({ canApprove }: { canApprove: boolean }) {
  const [grade, setGrade] = useState(5);
  const [subjectKey, setSubjectKey] = useState("maths");
  const [book, setBook] = useState<Book | null>(null);
  const [loading, setLoading] = useState(true);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [openAt, setOpenAt] = useState<number | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const res = await fetch(
        `/api/v1/teaching/chapter-standards?grade=${grade}&subjectKey=${encodeURIComponent(subjectKey)}`,
        { cache: "no-store" },
      );
      const body = (await res.json().catch(() => ({}))) as { data?: { book?: Book | null } };
      setBook(body.data?.book ?? null);
    } catch {
      setError("Could not read the proposed outcomes. Try again.");
      setBook(null);
    } finally {
      setLoading(false);
    }
  }, [grade, subjectKey]);

  useEffect(() => {
    void load();
  }, [load]);

  // Memoised, not `book?.chapters ?? []`: that allocates a fresh array on every
  // render while the book is still loading, which would make the count below
  // recompute for ever and never actually memoise anything.
  const chapters = useMemo(() => book?.chapters ?? [], [book]);
  const counts = useMemo(() => reviewCounts(chapters), [chapters]);

  async function decide(
    chapter: ChapterOutcomes,
    outcome: ProposedOutcome,
    decision: "approve" | "reject" | "undo",
  ) {
    if (!canApprove || !book) return;
    const key = `${chapter.position}:${outcome.caseUuid}`;
    setBusy(key);
    setError(null);
    try {
      const res = await fetch("/api/v1/teaching/chapter-standards", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          textbookId: chapter.textbookId,
          position: chapter.position,
          caseUuid: outcome.caseUuid,
          decision,
        }),
      });
      const body = (await res.json().catch(() => ({}))) as {
        data?: { ok?: boolean; error?: string; decision?: Parameters<typeof applyDecision>[1] };
      };
      const saved = body.data?.ok ? body.data.decision : null;
      if (!saved) {
        setError(body.data?.error || "That decision did not save.");
        return;
      }
      // Fold the server's answer in rather than refetching: the list is long
      // and a reload would throw the reviewer back to the top of it.
      setBook((b) => (b ? { ...b, chapters: applyDecision(b.chapters, saved) } : b));
    } catch {
      setError("That decision did not save.");
    } finally {
      setBusy(null);
    }
  }

  const goNext = () => {
    const next = nextPending(chapters, openAt ?? 0);
    if (next) setOpenAt(next.position);
  };

  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-end gap-3">
        <label className="text-xs font-semibold text-[var(--muted)]">
          Class
          <select
            value={grade}
            onChange={(e) => {
              setGrade(Number(e.target.value));
              setOpenAt(null);
            }}
            className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
          >
            {GRADES.map((g) => (
              <option key={g} value={g}>
                Class {g}
              </option>
            ))}
          </select>
        </label>
        <label className="text-xs font-semibold text-[var(--muted)]">
          Subject
          <select
            value={subjectKey}
            onChange={(e) => {
              setSubjectKey(e.target.value);
              setOpenAt(null);
            }}
            className="mt-1 block rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
          >
            {SUBJECTS.map((s) => (
              <option key={s.key} value={s.key}>
                {s.label}
              </option>
            ))}
          </select>
        </label>
        {counts.pending > 0 ? (
          <button
            type="button"
            onClick={goNext}
            className="rounded-lg border border-[var(--border)] px-3 py-2 text-sm font-semibold text-[var(--brand-deep)]"
          >
            Next chapter needing a decision
          </button>
        ) : null}
      </div>

      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] px-3 py-2.5 text-sm">
        <p className="flex items-start gap-2 text-[var(--muted)]">
          <Info className="mt-0.5 size-4 shrink-0" aria-hidden />
          <span>
            These are suggested learning outcomes for each chapter of{" "}
            <strong className="text-[var(--brand-deep)]">{book?.bookName || "the book"}</strong>.
            Nothing here is used anywhere until you agree with it — lesson plans and revision
            drills carry on exactly as they do today until then.
          </span>
        </p>
      </div>

      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {loading ? (
        <p className="text-sm text-[var(--muted)]">Reading…</p>
      ) : !book ? (
        <p className="text-sm text-[var(--muted)]">
          No book on record for Class {grade} in this subject, so there is nothing to agree with.
        </p>
      ) : (
        <>
          <p className="text-sm text-[var(--muted)]">
            {progressLine(chapters)}
            {counts.pending > 0 ? ` · ${counts.pending} still to decide` : ""}
          </p>

          {!canApprove ? (
            <p className="text-sm text-[var(--muted)]">
              You can read what is proposed. Agreeing with an outcome is the academic head&apos;s
              decision, because it changes every lesson plan for that chapter.
            </p>
          ) : null}

          <ul className="space-y-2">
            {chapters.map((chapter) => {
              const reason = unmappedReason(subjectKey, book.grade, chapter.position);
              const open = openAt === chapter.position;
              return (
                <li
                  key={chapter.position}
                  className="rounded-xl border border-[var(--border)] bg-[var(--card)]"
                >
                  <button
                    type="button"
                    onClick={() => setOpenAt(open ? null : chapter.position)}
                    className="flex w-full items-start gap-2 px-3 py-2.5 text-left"
                    aria-expanded={open}
                  >
                    <span className="mt-0.5 shrink-0 text-xs text-[var(--muted)]">
                      {chapter.position}
                    </span>
                    <span className="min-w-0 flex-1">
                      <span className="flex flex-wrap items-center gap-2">
                        <span className="font-semibold text-[var(--brand-deep)]">
                          {chapter.chapterName}
                        </span>
                        {chapter.outcomes.length === 0 ? (
                          <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-xs font-semibold text-[var(--muted)]">
                            Nothing proposed
                          </span>
                        ) : isSettled(chapter) ? (
                          <span className="rounded-full bg-[var(--success-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--success)]">
                            Agreed
                          </span>
                        ) : (
                          <span className="rounded-full bg-[var(--warning-soft)] px-2 py-0.5 text-xs font-semibold text-[var(--warning)]">
                            {chapter.outcomes.filter((o) => o.verdict === "pending").length} to decide
                          </span>
                        )}
                      </span>
                      {chapter.topics.length > 0 ? (
                        <span className="mt-0.5 block text-xs text-[var(--muted)]">
                          {chapter.topics.join(" · ")}
                        </span>
                      ) : null}
                    </span>
                  </button>

                  {open ? (
                    <div className="border-t border-[var(--border)] px-3 py-3">
                      {reason ? (
                        <p className="text-sm text-[var(--muted)]">{reason}</p>
                      ) : chapter.outcomes.length === 0 ? (
                        <p className="text-sm text-[var(--muted)]">
                          Nothing was proposed for this chapter.
                        </p>
                      ) : (
                        <ul className="space-y-3">
                          {chapter.outcomes.map((o) => {
                            const key = `${chapter.position}:${o.caseUuid}`;
                            const working = busy === key;
                            return (
                              <li key={o.caseUuid} className="space-y-1.5">
                                <div className="flex flex-wrap items-center gap-2">
                                  <VerdictPill verdict={o.verdict} />
                                  {o.confidence === "medium" ? (
                                    <span className="text-xs text-[var(--muted)]">
                                      Worth a closer look — only part of the chapter
                                    </span>
                                  ) : null}
                                </div>
                                <p className="text-sm text-[var(--fg)]">{o.statement}</p>
                                {o.rationale ? (
                                  <p className="text-xs text-[var(--muted)]">{o.rationale}</p>
                                ) : null}
                                {o.verdict !== "pending" && o.reviewedBy ? (
                                  <p className="text-xs text-[var(--muted)]">
                                    {o.verdict === "approved" ? "Agreed by" : "Set aside by"}{" "}
                                    {o.reviewedBy}
                                  </p>
                                ) : null}

                                {canApprove ? (
                                  <div className="flex flex-wrap gap-2 pt-0.5">
                                    {o.verdict === "pending" ? (
                                      <>
                                        <button
                                          type="button"
                                          disabled={working}
                                          onClick={() => void decide(chapter, o, "approve")}
                                          className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--success-soft)] px-3 py-1.5 text-sm font-semibold text-[var(--success)] disabled:opacity-50"
                                        >
                                          <Check className="size-4" aria-hidden />
                                          Yes, this is what we teach
                                        </button>
                                        <button
                                          type="button"
                                          disabled={working}
                                          onClick={() => void decide(chapter, o, "reject")}
                                          className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--muted)] disabled:opacity-50"
                                        >
                                          <CircleSlash className="size-4" aria-hidden />
                                          Not this one
                                        </button>
                                      </>
                                    ) : (
                                      <button
                                        type="button"
                                        disabled={working}
                                        onClick={() => void decide(chapter, o, "undo")}
                                        className="inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] px-3 py-1.5 text-sm font-semibold text-[var(--muted)] disabled:opacity-50"
                                      >
                                        <RotateCcw className="size-4" aria-hidden />
                                        Undo
                                      </button>
                                    )}
                                  </div>
                                ) : null}
                              </li>
                            );
                          })}
                        </ul>
                      )}
                    </div>
                  ) : null}
                </li>
              );
            })}
          </ul>
        </>
      )}
    </section>
  );
}
