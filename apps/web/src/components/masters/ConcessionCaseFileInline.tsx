"use client";

import { useState } from "react";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import type { ConcessionCaseDraft, ConcessionCaseFacts } from "@/lib/concessionReviewAi";

/**
 * One child's concession case file, opened from the grants list.
 *
 * Everything shown in the table is what the school recorded; the flags are
 * rule-raised; only the question at the top is the model's, and it names no
 * number and no ground. A grant with "Not recorded" as its ground stays
 * exactly that — the fix for it is the ground picker beside it, not a guess.
 */
export function ConcessionCaseFileInline({ studentId, studentName }: { studentId: string; studentName: string }) {
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facts, setFacts] = useState<ConcessionCaseFacts | null>(null);
  const [draft, setDraft] = useState<ConcessionCaseDraft | null>(null);
  const [generationId, setGenerationId] = useState<string | undefined>(undefined);
  const [settled, setSettled] = useState<"noted" | "dismissed" | null>(null);

  async function load() {
    setOpen(true);
    if (facts || loading) return;
    setLoading(true);
    setError(null);
    try {
      const res = await fetch("/api/ai/concession-case-file", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, language: "en" }),
      });
      const json = (await res.json()) as { ok?: boolean; error?: string; facts?: ConcessionCaseFacts; draft?: ConcessionCaseDraft; generationId?: string };
      if (json.facts) setFacts(json.facts);
      if (json.draft) setDraft(json.draft);
      setGenerationId(json.generationId);
      if (!json.ok) setError(json.error || "The case file is shown; the question could not be written.");
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not open the case file");
    } finally {
      setLoading(false);
    }
  }

  function settle(outcome: "accepted" | "rejected") {
    if (generationId) reportAiOutcome({ ids: [generationId], outcome, targetType: "concession_case_file", targetId: studentId });
    setGenerationId(undefined);
    setSettled(outcome === "accepted" ? "noted" : "dismissed");
  }

  if (!open) {
    return (
      <button type="button" onClick={() => void load()} className="rounded-md border border-[var(--border)] px-2 py-1 text-[11px] font-semibold text-[var(--brand-deep)]" title={`Review ${studentName}'s concessions`}>
        Review
      </button>
    );
  }

  return (
    <div className="mt-2 w-full rounded-lg border border-[var(--border)] bg-[var(--surface-sunken,rgba(32,48,80,0.04))] p-3 text-[12px]">
      <div className="flex items-start justify-between gap-2">
        <div className="font-semibold text-[var(--brand-deep)]">Case file · {studentName}</div>
        <button type="button" onClick={() => setOpen(false)} className="text-[11px] text-[var(--muted)]">
          Close
        </button>
      </div>
      {loading ? <p className="mt-2 text-[var(--muted)]">Assembling what the school knows…</p> : null}
      {error ? <p className="mt-2 rounded bg-[rgba(197,160,40,0.14)] px-2 py-1 text-[var(--brand-deep)]">{error}</p> : null}
      {draft ? (
        <div className="mt-2 rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2">
          <div className="text-[13px] font-semibold text-[var(--brand-deep)]">{draft.question}</div>
          {draft.note ? <div className="mt-1 text-[var(--foreground)]">{draft.note}</div> : null}
          <div className="mt-2 flex flex-wrap items-center gap-2">
            {settled ? (
              <span className="text-[11px] text-[var(--muted)]">{settled === "noted" ? "Noted for review." : "Dismissed."}</span>
            ) : (
              <>
                <button type="button" onClick={() => settle("accepted")} className="rounded-md bg-[var(--primary)] px-2 py-1 text-[11px] font-semibold text-[var(--primary-foreground)]">
                  Good question, note it
                </button>
                <button type="button" onClick={() => settle("rejected")} className="rounded-md px-2 py-1 text-[11px] text-[var(--muted)]">
                  Not useful
                </button>
              </>
            )}
            <span className="text-[11px] text-[var(--muted)]">AI wrote the question only; every fact below is the school&apos;s own record.</span>
          </div>
        </div>
      ) : null}
      {facts ? (
        <div className="mt-3 grid gap-3 md:grid-cols-2">
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Concessions held</div>
            {facts.grants.length ? (
              <ul className="mt-1 space-y-1">
                {facts.grants.map((g, i) => (
                  <li key={i}>
                    <span className="font-semibold text-[var(--brand-deep)]">{g.policyName}</span> · {g.valueLabel} on {g.headsLabel}
                    <div className="text-[var(--muted)]">
                      Ground: <span className={g.groundLabel === "Not recorded" ? "font-semibold text-[var(--danger,#b42318)]" : ""}>{g.groundLabel}</span> · via {g.route} · {g.effectiveFrom}
                      {g.effectiveTo ? ` → ${g.effectiveTo}` : ""} · {g.status}
                    </div>
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[var(--muted)]">None on record.</p>
            )}
            <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">This session</div>
            {facts.money ? (
              <p className="mt-1 tabular-nums">
                Billed {facts.money.billed} · concession {facts.money.concession} · paid {facts.money.paid} · balance <span className="font-semibold">{facts.money.balance}</span>
              </p>
            ) : (
              <p className="mt-1 text-[var(--muted)]">Not available.</p>
            )}
          </div>
          <div>
            <div className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Household</div>
            {facts.siblings.length ? (
              <ul className="mt-1 space-y-1">
                {facts.siblings.map((s, i) => (
                  <li key={i}>
                    <span className="font-semibold text-[var(--brand-deep)]">{s.name}</span> ({s.classLabel}): {s.discounts}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[var(--muted)]">No other child of this household is enrolled.</p>
            )}
            <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Staff roster</div>
            <p className="mt-1">{facts.staffMatches.length ? facts.staffMatches.map((m) => `${m.staffName} — ${m.via}`).join("; ") : "No guardian mobile matches a staff member."}</p>
            <div className="mt-3 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">Flags</div>
            {facts.flags.length ? (
              <ul className="mt-1 space-y-1">
                {facts.flags.map((f) => (
                  <li key={f.code}>
                    <span className="rounded bg-[rgba(32,48,80,0.08)] px-1 font-mono text-[10px]">{f.code}</span> {f.detail}
                  </li>
                ))}
              </ul>
            ) : (
              <p className="mt-1 text-[var(--muted)]">Nothing raised.</p>
            )}
          </div>
        </div>
      ) : null}
    </div>
  );
}
