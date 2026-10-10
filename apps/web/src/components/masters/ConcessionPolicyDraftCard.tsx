"use client";

import { useEffect, useMemo, useState } from "react";
import { Dialog, DialogPopup } from "@/components/ui/dialog";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import {
  applyConcessionMerge,
  buildConcessionClusters,
  matchClusterProposals,
  type ConcessionCluster,
  type ConcessionPolicyDraft,
  type ConcessionPolicyFacts,
  type ConcessionPolicyProposal,
} from "@/lib/concessionReviewAi";
import { bundledSeedConcessionCodes } from "@/lib/feeDiscountRuntime";
import {
  CONCESSION_GROUNDS,
  concessionGroundLabel,
  type ConcessionGround,
  type ConcessionRule,
  type MastersState,
} from "@/lib/masters";
import { loadSis, type SisState } from "@/lib/sis";

type Commit = (s: MastersState, msg?: string) => void;

/**
 * "171 definitions for 149 grants" — said out loud, grouped, named, and then
 * actually made into one discount.
 *
 * The card used to stop at the finding: it printed the groups and told the
 * office to go and edit a hundred and seventy-one policies by hand, which is
 * not work anybody was ever going to do. The grouping is still arithmetic and
 * the AI still only proposes a NAME — but a group now opens, shows the
 * children under it, takes the name the office decides on, and merges them.
 *
 * What the merge may not do is change what a family is charged; every
 * definition in a group takes the same amount off the same heads, and the
 * merge is refused outright if that is not true (applyConcessionMerge).
 */
export function ConcessionPolicyDraftCard({
  state,
  commit,
}: {
  state: MastersState;
  commit: Commit;
}) {
  const [loading, setLoading] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [sourceClusters, setSourceClusters] = useState<ConcessionCluster[]>([]);
  const [draft, setDraft] = useState<ConcessionPolicyDraft | null>(null);
  const [generationId, setGenerationId] = useState<string | undefined>(undefined);
  const [copied, setCopied] = useState(false);
  const [openClusterId, setOpenClusterId] = useState<string | null>(null);
  const [mergeNotice, setMergeNotice] = useState<string | null>(null);

  const headName = useMemo(() => {
    const byId = new Map((state.feeHeads ?? []).map((h) => [h.id, h.nameEn]));
    return (id: string) => byId.get(id) || id;
  }, [state.feeHeads]);

  /**
   * The groups are recomputed from the browser's own masters after every
   * merge, so the list a person is working through is the list as it now
   * stands — not the snapshot the AI call happened to see.
   */
  const { clusters, unusedDefinitions } = useMemo(
    () =>
      buildConcessionClusters({
        rules: state.concessions ?? [],
        grants: state.concessionGrants ?? [],
        feeHeadName: headName,
      }),
    [state.concessions, state.concessionGrants, headName],
  );

  const totals = useMemo(() => {
    const approved = (state.concessionGrants ?? []).filter(
      (g) => g.status === "approved",
    );
    return {
      definitions: (state.concessions ?? []).length,
      grants: approved.length,
      students: new Set(approved.map((g) => g.studentId)).size,
    };
  }, [state.concessions, state.concessionGrants]);

  const proposals = useMemo(
    () =>
      draft
        ? matchClusterProposals<ConcessionPolicyProposal>(
            clusters,
            sourceClusters,
            draft.proposals,
          )
        : new Map<string, ConcessionPolicyProposal>(),
    [draft, sourceClusters, clusters],
  );

  const openCluster = clusters.find((c) => c.id === openClusterId) ?? null;

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
      if (json.facts) setSourceClusters(json.facts.clusters);
      setDraft(json.draft ?? null);
      setGenerationId(json.generationId);
      if (!json.ok) setError(json.error || json.note || "The grouping stands; the names could not be written.");
      else if (!json.draft && json.note) setError(json.note);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Could not name the groups");
    } finally {
      setLoading(false);
    }
  }

  function asText(): string {
    const lines: string[] = [
      "Concession policy draft",
      `${totals.definitions} definitions · ${totals.grants} grants · ${totals.students} children`,
      "",
    ];
    if (draft) lines.push(draft.summary, "");
    for (const c of clusters) {
      const p = proposals.get(c.id);
      lines.push(
        `${p?.name ?? "(unnamed)"} — ${c.valueLabel} on ${c.headsLabel} · ${c.grants} grants · ${c.students} children · looks like: ${p ? (p.looksLike === "unknown" ? "unclear" : concessionGroundLabel(p.looksLike)) : "—"}`,
        `  names in use: ${c.names.join(" | ")}`,
      );
      if (p?.note) lines.push(`  ${p.note}`);
    }
    if (unusedDefinitions.length) lines.push("", `Definitions with no grant: ${unusedDefinitions.join(", ")}`);
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

  function discardNames() {
    if (generationId) reportAiOutcome({ ids: [generationId], outcome: "rejected", targetType: "concession_policy_draft" });
    setGenerationId(undefined);
    setDraft(null);
    setSourceClusters([]);
  }

  return (
    <section className="mt-6 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-[var(--brand-deep)]">Same discount, many names</h3>
          <p className="mt-1 max-w-2xl text-[12px] text-[var(--muted)]">
            Every definition that takes the same amount off the same fee heads, grouped however it was named. Open a group to name it and merge its children into one discount — the amount each family pays does not change.
          </p>
        </div>
        <button
          type="button"
          disabled={loading || clusters.length === 0}
          onClick={() => void run()}
          className="rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
        >
          {loading ? "Naming…" : draft ? "Name them again" : "Suggest names with AI"}
        </button>
      </div>

      {error ? <p className="mt-3 rounded-lg bg-[rgba(197,160,40,0.14)] px-3 py-2 text-[12px] text-[var(--brand-deep)]">{error}</p> : null}
      {mergeNotice ? <p className="mt-3 rounded-lg bg-[rgba(45,138,90,0.14)] px-3 py-2 text-[12px] text-[var(--brand-deep)]">{mergeNotice}</p> : null}

      <div className="mt-4 space-y-3">
        <p className="text-[12px] text-[var(--muted)]">
          <span className="font-semibold text-[var(--brand-deep)]">{totals.definitions}</span> definitions ·{" "}
          <span className="font-semibold text-[var(--brand-deep)]">{totals.grants}</span> approved grants ·{" "}
          <span className="font-semibold text-[var(--brand-deep)]">{totals.students}</span> children ·{" "}
          <span className="font-semibold text-[var(--brand-deep)]">{clusters.length}</span> distinct discounts
        </p>
        {draft ? <p className="text-sm text-[var(--foreground)]">{draft.summary}</p> : null}

        {clusters.length === 0 ? (
          <p className="rounded-lg border border-dashed border-[var(--border)] px-3 py-8 text-center text-[12px] text-[var(--muted)]">
            No approved grants to group yet.
          </p>
        ) : (
          <ul className="divide-y divide-[var(--border)] rounded-lg border border-[var(--border)]">
            {clusters.map((c) => {
              const p = proposals.get(c.id);
              return (
                <li key={c.id}>
                  <button
                    type="button"
                    onClick={() => {
                      setMergeNotice(null);
                      setOpenClusterId(c.id);
                    }}
                    className="grid w-full gap-1 px-3 py-2 text-left text-[12px] hover:bg-[var(--surface-sunken)] sm:grid-cols-[minmax(0,1.4fr)_minmax(0,1fr)_auto]"
                  >
                    <div>
                      <div className="font-semibold text-[var(--brand-deep)]">
                        {p?.name ?? <span className="text-[var(--muted)]">Unnamed group</span>}
                      </div>
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
                      <div className="mt-0.5 text-[11px] font-semibold text-[var(--brand-mid)]">
                        {c.definitions > 1 ? "Open list · merge" : "Open list"}
                      </div>
                    </div>
                  </button>
                </li>
              );
            })}
          </ul>
        )}

        {unusedDefinitions.length ? (
          <p className="text-[12px] text-[var(--muted)]">
            {unusedDefinitions.length} definition{unusedDefinitions.length === 1 ? "" : "s"} with no grant: {unusedDefinitions.slice(0, 12).join(", ")}
            {unusedDefinitions.length > 12 ? ` +${unusedDefinitions.length - 12} more` : ""}
          </p>
        ) : null}

        <div className="flex flex-wrap gap-2">
          <button type="button" onClick={() => void copy()} className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]">
            {copied ? "Copied" : "Copy list"}
          </button>
          {draft ? (
            <button type="button" onClick={discardNames} className="rounded-lg px-3 py-1.5 text-xs text-[var(--muted)]">
              Drop the AI names
            </button>
          ) : null}
          <span className="self-center text-[11px] text-[var(--muted)]">
            The grouping is arithmetic; only the proposed names are AI-drafted. Nothing changes until you merge a group.
          </span>
        </div>
      </div>

      {openCluster ? (
        <ConcessionMergeDialog
          cluster={openCluster}
          proposal={proposals.get(openCluster.id) ?? null}
          state={state}
          commit={commit}
          onClose={() => setOpenClusterId(null)}
          onMerged={(msg, usedAiName) => {
            setOpenClusterId(null);
            setMergeNotice(msg);
            if (generationId) {
              reportAiOutcome({
                ids: [generationId],
                outcome: usedAiName ? "accepted" : "edited",
                targetType: "concession_policy_draft",
              });
              setGenerationId(undefined);
            }
          }}
        />
      ) : null}
    </section>
  );
}

type MergeRow = {
  grantId: string;
  studentName: string;
  admissionNo: string;
  classLabel: string;
  fatherName: string;
  status: string;
  ground: string;
  ruleId: string;
  ruleLabel: string;
};

/**
 * The group opened up: which definitions it is made of, which children hold
 * it, and the one name they should all sit under.
 *
 * Children are listed per grant rather than per child on purpose — a child
 * holding the same discount twice is one of the things this screen exists to
 * make visible, and hiding the second row would hide it.
 */
function ConcessionMergeDialog({
  cluster,
  proposal,
  state,
  commit,
  onClose,
  onMerged,
}: {
  cluster: ConcessionCluster;
  proposal: ConcessionPolicyProposal | null;
  state: MastersState;
  commit: Commit;
  onClose: () => void;
  onMerged: (message: string, usedAiName: boolean) => void;
}) {
  const [sis, setSis] = useState<SisState | null>(null);
  useEffect(() => {
    setSis(loadSis());
  }, []);

  const rules = useMemo(
    () =>
      cluster.ruleIds
        .map((id) => (state.concessions ?? []).find((r) => r.id === id))
        .filter((r): r is ConcessionRule => !!r),
    [cluster.ruleIds, state.concessions],
  );

  const grants = useMemo(() => {
    const ids = new Set(cluster.ruleIds);
    return (state.concessionGrants ?? []).filter((g) => ids.has(g.concessionId));
  }, [cluster.ruleIds, state.concessionGrants]);

  const rows: MergeRow[] = useMemo(() => {
    const students = new Map((sis?.students ?? []).map((s) => [s.id, s]));
    const classById = new Map((state.classes ?? []).map((c) => [c.id, c.name]));
    const sectionById = new Map((state.sections ?? []).map((s) => [s.id, s.name]));
    const ruleById = new Map(rules.map((r) => [r.id, r]));
    return grants
      .map((g) => {
        const s = students.get(g.studentId);
        const rule = ruleById.get(g.concessionId);
        const cls = s ? classById.get(s.classId) ?? "—" : "—";
        const sec = s ? sectionById.get(s.sectionId) ?? "" : "";
        return {
          grantId: g.id,
          studentName: s?.fullName ?? "Unknown student",
          admissionNo: s?.admissionNo ?? g.studentId,
          classLabel: sec ? `${cls}-${sec}` : cls,
          fatherName: s?.fatherName || "—",
          status: g.status,
          ground: g.ground,
          ruleId: g.concessionId,
          ruleLabel: rule ? rule.name || rule.code : "—",
        };
      })
      .sort((a, b) => a.studentName.localeCompare(b.studentName));
  }, [grants, rules, sis, state.classes, state.sections]);

  const [keeperId, setKeeperId] = useState(cluster.ruleIds[0] ?? "");
  const keeper = rules.find((r) => r.id === keeperId) ?? rules[0];
  const aiName = proposal?.name ?? "";
  const [name, setName] = useState(aiName || cluster.names[0] || "");
  const [code, setCode] = useState(keeper?.code ?? "");
  const [ground, setGround] = useState<ConcessionGround | "">("");
  const [checked, setChecked] = useState<Set<string>>(() => new Set(rows.map((r) => r.grantId)));
  const [query, setQuery] = useState("");
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);

  // Rows arrive once SIS has loaded; everything stays ticked until a person
  // unticks it.
  useEffect(() => {
    setChecked(new Set(grants.map((g) => g.id)));
  }, [grants]);

  useEffect(() => {
    const k = rules.find((r) => r.id === keeperId);
    if (k) setCode(k.code);
  }, [keeperId, rules]);

  const protectedCodes = useMemo(() => bundledSeedConcessionCodes(), []);
  const keeperIsFromImport = !!keeper && protectedCodes.includes(keeper.code.trim().toUpperCase());

  const visible = useMemo(() => {
    const q = query.trim().toLowerCase();
    if (!q) return rows;
    return rows.filter((r) =>
      q
        .split(/\s+/)
        .every((w) =>
          [r.studentName, r.admissionNo, r.classLabel, r.fatherName, r.ruleLabel].some((f) =>
            f.toLowerCase().includes(w),
          ),
        ),
    );
  }, [rows, query]);

  const selectedRows = rows.filter((r) => checked.has(r.grantId));
  const ungroundedSelected = selectedRows.filter((r) => !r.ground).length;
  const childrenSelected = new Set(selectedRows.map((r) => r.admissionNo)).size;

  function toggle(id: string) {
    setChecked((prev) => {
      const next = new Set(prev);
      if (next.has(id)) next.delete(id);
      else next.add(id);
      return next;
    });
  }

  function merge() {
    if (!keeper) return;
    setBusy(true);
    setError(null);
    const result = applyConcessionMerge(state, {
      keeperRuleId: keeper.id,
      name,
      code,
      ruleIds: cluster.ruleIds,
      grantIds: [...checked],
      ground,
      protectedCodes,
      today: new Date().toISOString().slice(0, 10),
    });
    if (!result.ok) {
      setError(result.reason);
      setBusy(false);
      return;
    }
    const o = result.outcome;
    const parts = [
      `“${o.keeperName}” now holds ${childrenSelected} child${childrenSelected === 1 ? "" : "ren"}`,
    ];
    if (o.removedDefinitions.length) parts.push(`${o.removedDefinitions.length} duplicate definition(s) removed`);
    if (o.groundsRecorded) parts.push(`${o.groundsRecorded} ground(s) recorded`);
    const kept = o.keptDefinitions.filter((k) => k.why === "used by the import").length;
    if (kept) parts.push(`${kept} kept — the discount import still points at them`);
    const stillGranted = o.keptDefinitions.filter((k) => k.why === "still granted").length;
    if (stillGranted) parts.push(`${stillGranted} kept — children you left unticked are still on them`);
    commit(o.state, `Merged into “${o.keeperName}”`);
    onMerged(parts.join(" · "), !!aiName && name.trim() === aiName.trim());
  }

  return (
    <Dialog open onOpenChange={(open) => (!open ? onClose() : undefined)}>
      <DialogPopup size="lg" className="max-w-3xl">
        <div className="flex items-start justify-between gap-3">
          <div>
            <h4 className="text-sm font-semibold text-[var(--brand-deep)]">
              One discount out of {cluster.definitions} definition{cluster.definitions === 1 ? "" : "s"}
            </h4>
            <p className="mt-1 text-[12px] text-[var(--muted)]">
              {cluster.valueLabel} on {cluster.headsLabel} · {cluster.students} children. Every definition here takes the
              same amount off the same heads, so merging them changes no bill — only how many policies the office keeps.
            </p>
          </div>
          <button type="button" onClick={onClose} className="rounded-lg px-2 py-1 text-xs text-[var(--muted)]">
            Close
          </button>
        </div>

        {error ? (
          <p className="mt-3 rounded-lg bg-[rgba(190,60,60,0.12)] px-3 py-2 text-[12px] text-[var(--brand-deep)]">{error}</p>
        ) : null}

        <div className="mt-4 grid gap-3 sm:grid-cols-2">
          <label className="text-[12px] font-medium text-[var(--brand-deep)]">
            Name this discount
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              value={name}
              onChange={(e) => setName(e.target.value)}
              placeholder="Sibling tuition discount"
            />
            {aiName ? <span className="mt-0.5 block text-[11px] font-normal text-[var(--muted)]">AI proposed “{aiName}” — change it to whatever the office calls it.</span> : null}
          </label>
          <label className="text-[12px] font-medium text-[var(--brand-deep)]">
            Code
            <input
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm uppercase disabled:opacity-60"
              value={code}
              disabled={keeperIsFromImport}
              onChange={(e) => setCode(e.target.value.toUpperCase())}
            />
            <span className="mt-0.5 block text-[11px] font-normal text-[var(--muted)]">
              {keeperIsFromImport
                ? "This definition comes from the discount import — its code cannot change."
                : "A CTR- code is one the fee counter minted. Give it a real one and it appears in the policy picker."}
            </span>
          </label>
        </div>

        {cluster.ungroundedGrants > 0 ? (
          <label className="mt-3 block text-[12px] font-medium text-[var(--brand-deep)]">
            Record a ground on the {ungroundedSelected} selected grant(s) that have none — optional
            <select
              className="mt-1 w-full rounded-lg border border-[var(--border)] bg-[var(--card)] px-3 py-2 text-sm"
              value={ground}
              onChange={(e) => setGround(e.target.value as ConcessionGround | "")}
            >
              <option value="">Leave them as they are</option>
              {CONCESSION_GROUNDS.map((g) => (
                <option key={g.id} value={g.id}>
                  {g.label}
                </option>
              ))}
            </select>
            <span className="mt-0.5 block text-[11px] font-normal text-[var(--muted)]">
              Your decision, not the AI&apos;s. A ground already recorded is never overwritten.
            </span>
          </label>
        ) : null}

        <div className="mt-4">
          <div className="text-[12px] font-semibold text-[var(--brand-deep)]">Definitions in this group — which one survives</div>
          <ul className="mt-1 max-h-40 divide-y divide-[var(--border)] overflow-y-auto rounded-lg border border-[var(--border)]">
            {rules.map((r) => {
              const held = grants.filter((g) => g.concessionId === r.id).length;
              return (
                <li key={r.id} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
                  <input
                    type="radio"
                    name="keeper"
                    checked={r.id === keeperId}
                    onChange={() => setKeeperId(r.id)}
                  />
                  <span className="min-w-0 flex-1 truncate text-[var(--brand-deep)]">
                    {r.name || r.code} <span className="text-[var(--muted)]">{r.code}</span>
                  </span>
                  <span className="shrink-0 tabular-nums text-[var(--muted)]">{held} grant{held === 1 ? "" : "s"}</span>
                </li>
              );
            })}
          </ul>
        </div>

        <div className="mt-4">
          <div className="flex flex-wrap items-center justify-between gap-2">
            <div className="text-[12px] font-semibold text-[var(--brand-deep)]">
              Children under this discount — {selectedRows.length} of {rows.length} ticked
            </div>
            <div className="flex gap-2">
              <input
                className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[12px]"
                placeholder="Find a child"
                value={query}
                onChange={(e) => setQuery(e.target.value)}
              />
              <button type="button" className="text-[11px] font-semibold text-[var(--brand-mid)]" onClick={() => setChecked(new Set(rows.map((r) => r.grantId)))}>
                All
              </button>
              <button type="button" className="text-[11px] font-semibold text-[var(--brand-mid)]" onClick={() => setChecked(new Set())}>
                None
              </button>
            </div>
          </div>
          <ul className="mt-1 max-h-64 divide-y divide-[var(--border)] overflow-y-auto rounded-lg border border-[var(--border)]">
            {visible.map((r) => (
              <li key={r.grantId} className="flex items-center gap-2 px-3 py-1.5 text-[12px]">
                <input type="checkbox" checked={checked.has(r.grantId)} onChange={() => toggle(r.grantId)} />
                <span className="min-w-0 flex-1">
                  <span className="font-medium text-[var(--brand-deep)]">{r.studentName}</span>{" "}
                  <span className="text-[var(--muted)]">{r.classLabel} · {r.admissionNo} · {r.fatherName}</span>
                  <span className="block text-[11px] text-[var(--muted)]">
                    now on “{r.ruleLabel}” · {r.status}
                    {r.ground ? ` · ${concessionGroundLabel(r.ground)}` : " · no ground recorded"}
                  </span>
                </span>
              </li>
            ))}
            {visible.length === 0 ? (
              <li className="px-3 py-6 text-center text-[12px] text-[var(--muted)]">
                {sis ? "No child matches" : "Loading students…"}
              </li>
            ) : null}
          </ul>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Untick a child to leave them where they are — the definition they are on then stays too.
          </p>
        </div>

        <div className="mt-4 flex flex-wrap items-center gap-2">
          <button
            type="button"
            disabled={busy || !name.trim() || !keeper}
            onClick={merge}
            className="rounded-lg bg-[var(--primary)] px-3 py-2 text-xs font-semibold text-[var(--primary-foreground)] disabled:opacity-50"
          >
            Merge {childrenSelected} child{childrenSelected === 1 ? "" : "ren"} into “{name.trim() || "…"}”
          </button>
          <button type="button" onClick={onClose} className="rounded-lg px-3 py-2 text-xs text-[var(--muted)]">
            Cancel
          </button>
        </div>
      </DialogPopup>
    </Dialog>
  );
}
