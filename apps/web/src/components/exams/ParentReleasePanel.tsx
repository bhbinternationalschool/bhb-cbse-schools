"use client";

/**
 * "Show to parents" — the one place an exam's results or date sheet are
 * released to families (parent app + /parent portal). Every switch starts
 * OFF and is saved on the server (/api/v1/staff/exams/parent-release, audited);
 * nothing about an exam reaches a parent because marks merely exist.
 */

import { useCallback, useEffect, useState } from "react";
import {
  isReleasedToParents,
  normalizeExamParentRelease,
  releaseSwitchFor,
  type ExamParentReleaseState,
  type ReleaseKind,
} from "@/lib/examParentRelease";
import type { ExamTerm } from "@/lib/exams";

type Props = {
  kind: ReleaseKind;
  terms: ExamTerm[];
  /** exams.edit — may switch. Without it the panel only shows the state. */
  canEdit: boolean;
};

function when(iso: string): string {
  const d = new Date(iso);
  if (!iso || Number.isNaN(d.getTime())) return "";
  return d.toLocaleString("en-IN", { day: "numeric", month: "short", hour: "2-digit", minute: "2-digit" });
}

export function ParentReleasePanel({ kind, terms, canEdit }: Props) {
  const [state, setState] = useState<ExamParentReleaseState | null>(null);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoadError(null);
    try {
      const res = await fetch("/api/v1/staff/exams/parent-release", { cache: "no-store" });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: { state: unknown } }
        | { ok: false; error?: { message?: string } }
        | null;
      if (!res.ok || !json || !json.ok) {
        setLoadError((json && !json.ok && json.error?.message) || "Could not load what is shown to parents.");
        return;
      }
      setState(normalizeExamParentRelease(json.data.state));
    } catch {
      setLoadError("Could not reach the server.");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function toggle(term: ExamTerm, on: boolean) {
    const what = kind === "results" ? "results" : "date sheet";
    if (
      on &&
      !window.confirm(
        kind === "results"
          ? `Show ${term.label} results to parents?\n\nEvery family will see their own child's marks in the parent app and portal, exactly as the report card shows them. Marks changed after this show to parents straight away — lock the mark sheets first.`
          : `Show the ${term.label} date sheet to parents?\n\nFamilies will see the upcoming papers for their child's class.`,
      )
    ) {
      return;
    }
    setBusy(term.id);
    setNotice(null);
    try {
      const res = await fetch("/api/v1/staff/exams/parent-release", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ termId: term.id, kind, on }),
      });
      const json = (await res.json().catch(() => null)) as
        | { ok: true; data: { state: unknown; auditRecorded: boolean } }
        | { ok: false; error?: { message?: string } }
        | null;
      if (!res.ok || !json || !json.ok) {
        setNotice((json && !json.ok && json.error?.message) || `Could not change the ${what} switch.`);
        return;
      }
      if (json.data.state) setState(normalizeExamParentRelease(json.data.state));
      else await load();
      setNotice(
        `${term.label} ${what} ${on ? "now shown to parents" : "hidden from parents"}.` +
          (json.data.auditRecorded ? "" : " (The audit entry could not be written — tell the office admin.)"),
      );
    } catch {
      setNotice("Could not reach the server.");
    } finally {
      setBusy(null);
    }
  }

  const active = terms.filter((t) => t.isActive);

  return (
    <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4 print-hide">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          {kind === "results" ? "Show results to parents" : "Show date sheet to parents"}
        </h3>
        <p className="text-[11px] text-[var(--muted)]">
          Off until you switch it on · parent app &amp; parent portal
        </p>
      </div>
      <p className="mt-1 text-xs text-[var(--muted)]">
        {kind === "results"
          ? "Parents see only exams switched on here: marks, totals, percentage, grade, rank and remarks exactly as this class's report card prints them. A child held for fees (report-card hold) sees “held by the office” instead."
          : "Parents see the upcoming papers of their child's class for exams switched on here. Past papers drop off by themselves."}
      </p>
      {loadError ? (
        <p className="mt-3 rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          {loadError}{" "}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Retry
          </button>
        </p>
      ) : !state ? (
        <p className="mt-3 text-xs text-[var(--muted)]">Loading…</p>
      ) : active.length === 0 ? (
        <p className="mt-3 text-xs text-[var(--muted)]">No exams this session yet.</p>
      ) : (
        <ul className="mt-3 divide-y divide-[var(--border)]">
          {active.map((t) => {
            const on = isReleasedToParents(state, t.id, kind);
            const sw = releaseSwitchFor(state, t.id, kind);
            return (
              <li key={t.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                <div className="min-w-0">
                  <p className="text-sm font-semibold text-[var(--brand-deep)]">
                    {t.label} <span className="font-normal text-[var(--muted)]">({t.code})</span>
                  </p>
                  <p className="text-[11px] text-[var(--muted)]">
                    {on ? "Shown to parents" : "Not shown to parents"}
                    {sw?.at ? ` · ${on ? "since" : "changed"} ${when(sw.at)}${sw.by ? ` by ${sw.by}` : ""}` : ""}
                  </p>
                </div>
                <button
                  type="button"
                  role="switch"
                  aria-checked={on}
                  aria-label={`${kind === "results" ? "Results" : "Date sheet"} of ${t.label} shown to parents`}
                  disabled={!canEdit || busy !== null}
                  onClick={() => void toggle(t, !on)}
                  className={`rounded-lg px-3 py-1.5 text-xs font-semibold disabled:opacity-50 ${
                    on ? "btn-accent" : "border border-[var(--border)]"
                  }`}
                  title={canEdit ? "" : "Needs edit permission on Exams"}
                >
                  {busy === t.id ? "Saving…" : on ? "Hide from parents" : "Show to parents"}
                </button>
              </li>
            );
          })}
        </ul>
      )}
      {notice ? <p className="mt-2 text-xs font-semibold text-[var(--brand-deep)]">{notice}</p> : null}
    </section>
  );
}
