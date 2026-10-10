"use client";

import { useState } from "react";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import { AGEING_BAND_LABEL, type CollectionsWeeklyDraft, type CollectionsWeeklyFacts } from "@/lib/collectionsWeeklyAi";
import { formatInr } from "@/lib/masters";

/**
 * The Monday note, on demand. The same route the scheduler calls at 08:15
 * Monday to WhatsApp the owners; here it is read on the defaulters desk.
 * Figures are the report; the note is the reading aid and carries no digits.
 */
export function CollectionsWeeklyNoteCard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facts, setFacts] = useState<CollectionsWeeklyFacts | null>(null);
  const [draft, setDraft] = useState<CollectionsWeeklyDraft | null>(null);
  const [generationId, setGenerationId] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/ai/collections-weekly-note", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "en" }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; facts?: CollectionsWeeklyFacts; draft?: CollectionsWeeklyDraft | null; figures?: string; generationId?: string };
      if (json.facts) setFacts(json.facts);
      setDraft(json.draft ?? null);
      setGenerationId(json.generationId);
      if (!json.ok) setError(json.error || "The figures are shown; the note could not be written.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not build the weekly note");
    } finally {
      setLoading(false);
    }
  }

  async function copy() {
    if (!facts) return;
    const text = [
      `Fee collections · ${facts.weekFrom} to ${facts.weekTo}`,
      `Collected ${formatInr(facts.receipts.thisWeek.amountPaise)} (${facts.receipts.thisWeek.count} receipts) vs ${formatInr(facts.receipts.lastWeek.amountPaise)} the week before`,
      `Still owed ${formatInr(facts.totalOpenPaise)} across ${facts.childrenOwing} children`,
      ...facts.ageing.filter((b) => b.amountPaise > 0).map((b) => `  ${AGEING_BAND_LABEL[b.band]}: ${formatInr(b.amountPaise)} · ${b.children} children`),
      "",
      draft ? `${draft.headline}\n${draft.note}` : "",
    ].join("\n");
    try {
      await navigator.clipboard.writeText(text.trim());
      setCopied(true);
      if (generationId) reportAiOutcome({ ids: [generationId], outcome: "accepted", targetType: "collections_weekly_note", targetId: facts.weekTo });
      setGenerationId(undefined);
    } catch {
      setError("Could not copy");
    }
  }

  const delta = facts ? facts.receipts.thisWeek.amountPaise - facts.receipts.lastWeek.amountPaise : 0;

  return (
    <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">This week in collections</h3>
          <p className="mt-1 max-w-2xl text-[12px] text-[var(--muted)]">
            Last complete week against the one before, and how what is still owed is aged. The owners receive this on WhatsApp every Monday morning.
          </p>
        </div>
        <button type="button" disabled={loading} onClick={() => void run()} className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
          {loading ? "Working…" : facts ? "Refresh" : "Build the note"}
        </button>
      </div>
      {error ? <p className="mt-3 rounded-lg bg-[rgba(197,160,40,0.14)] px-3 py-2 text-[12px] text-[var(--brand-deep)]">{error}</p> : null}
      {facts ? (
        <div className="mt-4 grid gap-4 md:grid-cols-[minmax(0,1fr)_minmax(0,1.2fr)]">
          <div className="space-y-2 text-[12px] tabular-nums">
            <div className="text-[11px] text-[var(--muted)]">
              {facts.weekFrom} → {facts.weekTo}
            </div>
            <div>
              <span className="text-[var(--muted)]">Collected </span>
              <span className="text-base font-bold text-[var(--brand-deep)]">{formatInr(facts.receipts.thisWeek.amountPaise)}</span>
              <span className="text-[var(--muted)]"> · {facts.receipts.thisWeek.count} receipts · </span>
              <span className={delta >= 0 ? "text-[var(--success,#1f7a4d)]" : "text-[var(--danger,#b42318)]"}>
                {delta >= 0 ? "+" : "−"}
                {formatInr(Math.abs(delta))} vs week before
              </span>
            </div>
            <div>
              <span className="text-[var(--muted)]">Still owed </span>
              <span className="font-bold text-[var(--danger,#b42318)]">{formatInr(facts.totalOpenPaise)}</span>
              <span className="text-[var(--muted)]"> · {facts.childrenOwing} children</span>
            </div>
            <ul className="space-y-1">
              {facts.ageing.map((b) => {
                const share = facts.totalOpenPaise ? Math.round((b.amountPaise / facts.totalOpenPaise) * 100) : 0;
                return (
                  <li key={b.band} className="grid grid-cols-[6.5rem_1fr_auto] items-center gap-2">
                    <span className="text-[var(--muted)]">{AGEING_BAND_LABEL[b.band]}</span>
                    <span className="h-2 overflow-hidden rounded bg-[rgba(32,48,80,0.08)]">
                      <span className={`block h-full ${b.band === "over90" ? "bg-[var(--danger,#b42318)]" : b.band === "d31to90" ? "bg-[rgba(197,160,40,0.9)]" : "bg-[var(--primary)]"}`} style={{ width: `${share}%` }} />
                    </span>
                    <span>
                      {formatInr(b.amountPaise)} <span className="text-[var(--muted)]">· {b.children}</span>
                    </span>
                  </li>
                );
              })}
            </ul>
            {facts.meetings ? (
              <div className="text-[var(--muted)]">
                Parent meetings: {facts.meetings.scheduled} scheduled · {facts.meetings.done} held · {facts.meetings.noShow} no-show
              </div>
            ) : null}
          </div>
          <div>
            {draft ? (
              <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken,rgba(32,48,80,0.04))] px-3 py-2 text-[13px]">
                <div className="font-semibold text-[var(--brand-deep)]">{draft.headline}</div>
                <p className="mt-1 text-[var(--foreground)]">{draft.note}</p>
              </div>
            ) : (
              <p className="text-[12px] text-[var(--muted)]">No note this time; the figures above stand on their own.</p>
            )}
            <div className="mt-2 flex flex-wrap items-center gap-2">
              <button type="button" onClick={() => void copy()} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]">
                {copied ? "Copied" : "Copy"}
              </button>
              <span className="text-[11px] text-[var(--muted)]">Numbers computed from receipts and the dues book; the note names none of them.</span>
            </div>
          </div>
        </div>
      ) : null}
    </section>
  );
}
