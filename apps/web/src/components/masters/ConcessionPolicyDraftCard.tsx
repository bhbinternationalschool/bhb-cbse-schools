"use client";

import { useState } from "react";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import type { ConcessionPolicyDraft, ConcessionPolicyFacts } from "@/lib/concessionReviewAi";
import { concessionGroundLabel } from "@/lib/masters";

/**
 * "171 definitions for 149 grants" — said out loud, grouped, and named.
 *
 * The groups are code's finding (same amount, same heads under different
 * names). The model only proposes a name and says which ground each group
 * LOOKS LIKE. Nothing here changes a policy: the office copies the draft into
 * a meeting, decides, and then edits the policies by hand as it always has.
 */
export function ConcessionPolicyDraftCard() {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [facts, setFacts] = useState<ConcessionPolicyFacts | null>(null);
  const [draft, setDraft] = useState<ConcessionPolicyDraft | null>(null);
  const [generationId, setGenerationId] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);

  async function run() {
    setLoading(true);
    setError(null);
    setCopied(false);
    try {
      const res = await fetch("/api/ai/concession-policy-draft", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ language: "en" }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        error?: string;
        facts?: ConcessionPolicyFacts;
        draft?: ConcessionPolicyDraft | null;
        generationId?: string;
        note?: string;
      };
      if (json.facts) setFacts(json.facts);
      setDraft(json.draft ?? null);
      setGenerationId(json.generationId);
      if (!json.ok) setError(json.error || json.note || "The grouping is shown; the note could not be written.");
      else if (!json.draft && json.note) setError(json.note);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not draft the policy list");
    } finally {
      setLoading(false);
    }
  }

  function proposalFor(clusterId: string) {
    return draft?.proposals.find((p) => p.clusterId === clusterId);
  }

  function asText(): string {
    if (!facts) return "";
    const lines: string[] = [`Concession policy draft · ${facts.asOf}`, `${facts.totalDefinitions} definitions · ${facts.totalGrants} grants · ${facts.totalStudents} children`, ""];
    if (draft) lines.push(draft.summary, "");
    for (const c of facts.clusters) {
      const p = proposalFor(c.id);
      lines.push(
        `${p?.name ?? "(unnamed)"} — ${c.valueLabel} on ${c.headsLabel} · ${c.grants} grants · ${c.students} children · looks like: ${p ? (p.looksLike === "unknown" ? "unclear" : concessionGroundLabel(p.looksLike)) : "—"}`,
        `  names in use: ${c.names.join(" | ")}`,
      );
      if (p?.note) lines.push(`  ${p.note}`);
    }
    if (facts.unusedDefinitions.length) lines.push("", `Definitions with no grant: ${facts.unusedDefinitions.join(", ")}`);
    return lines.join("\n");
  }

  async function copy() {
    try {
      await navigator.clipboard.writeText(asText());
      setCopied(true);
      if (generationId) reportAiOutcome({ ids: [generationId], outcome: "accepted", targetType: "concession_policy_draft" });
      setGenerationId(undefined);
    } catch {
      setError("Could not copy");
    }
  }

  function discard() {
    if (generationId) reportAiOutcome({ ids: [generationId], outcome: "rejected", targetType: "concession_policy_draft" });
    setGenerationId(undefined);
    setDraft(null);
    setFacts(null);
  }

  return (
    <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Policy draft · are these the same discount?</h3>
          <p className="mt-1 max-w-2xl text-[12px] text-[var(--muted)]">
            Groups every definition that gives the same amount on the same heads, however it was named, and proposes one policy per group. A draft to discuss — nothing is merged or renamed here.
          </p>
        </div>
        <button type="button" disabled={loading} onClick={() => void run()} className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50">
          {loading ? "Grouping…" : facts ? "Redraft" : "Draft a policy list"}
        </button>
      </div>

      {error ? <p className="mt-3 rounded-lg bg-[rgba(197,160,40,0.14)] px-3 py-2 text-[12px] text-[var(--brand-deep)]">{error}</p> : null}

      {facts ? (
        <div className="mt-4 space-y-3">
          <p className="text-[12px] text-[var(--muted)]">
            <span className="font-semibold text-[var(--brand-deep)]">{facts.totalDefinitions}</span> definitions ·{" "}
            <span className="font-semibold text-[var(--brand-deep)]">{facts.totalGrants}</span> approved grants ·{" "}
            <span className="font-semibold text-[var(--brand-deep)]">{facts.totalStudents}</span> children ·{" "}
            <span className="font-semibold text-[var(--brand-deep)]">{facts.clusters.length}</span> distinct discounts
          </p>
          {draft ? <p className="text-sm text-[var(--foreground)]">{draft.summary}</p> : null}
          <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {facts.clusters.map((c) => {
              const p = proposalFor(c.id);
              return (
                <li key={c.id} className="grid gap-1 px-3 py-2 text-[12px] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]">
                  <div>
                    <div className="font-semibold text-[var(--brand-deep)]">{p?.name ?? <span className="text-[var(--muted)]">Unnamed group</span>}</div>
                    <div className="text-[var(--muted)]">
                      {c.valueLabel} · {c.headsLabel} · {c.definitions} definition{c.definitions === 1 ? "" : "s"} named {c.names.slice(0, 4).join(", ")}
                      {c.names.length > 4 ? ` +${c.names.length - 4} more` : ""}
                    </div>
                    {p?.note ? <div className="mt-0.5 text-[var(--foreground)]">{p.note}</div> : null}
                  </div>
                  <div className="text-[var(--muted)]">
                    Looks like: <span className="font-semibold text-[var(--brand-deep)]">{p ? (p.looksLike === "unknown" ? "unclear from the records" : concessionGroundLabel(p.looksLike)) : "—"}</span>
                    <div>
                      Grounds recorded: {c.grounds.length ? c.grounds.map((g) => `${concessionGroundLabel(g.ground)} ×${g.count}`).join(", ") : "none"}
                      {c.ungroundedGrants ? ` · ${c.ungroundedGrants} without a ground` : ""}
                    </div>
                  </div>
                  <div className="text-right font-variant-numeric tabular-nums">
                    <div className="font-semibold text-[var(--brand-deep)]">{c.students} children</div>
                    <div className="text-[var(--muted)]">{c.grants} grants</div>
                  </div>
                </li>
              );
            })}
          </ul>
          {facts.unusedDefinitions.length ? (
            <p className="text-[12px] text-[var(--muted)]">
              {facts.unusedDefinitions.length} definition{facts.unusedDefinitions.length === 1 ? "" : "s"} with no grant: {facts.unusedDefinitions.join(", ")}
            </p>
          ) : null}
          <div className="flex flex-wrap gap-2">
            <button type="button" onClick={() => void copy()} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]">
              {copied ? "Copied" : "Copy draft"}
            </button>
            <button type="button" onClick={discard} className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted)]">
              Discard
            </button>
            <span className="self-center text-[11px] text-[var(--muted)]">AI-drafted names; the grouping itself is arithmetic. Approve by editing the policies, as always.</span>
          </div>
        </div>
      ) : null}
    </section>
  );
}
