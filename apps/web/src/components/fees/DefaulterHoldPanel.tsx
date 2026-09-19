"use client";
// ratchet-allow: grids_without_row_menu — the gate table is a settings editor — each row is one hold's policy with its own selects, not a record to act on

/**
 * The defaulter policy, and the round the office approves before anybody
 * loses anything.
 *
 * Two halves, deliberately on one screen. A head teacher setting a money
 * floor wants to see immediately how many children it catches, and a clerk
 * looking at a list of forty names wants to see the rule that produced it.
 * Splitting them across tabs is how a school ends up with a policy nobody has
 * ever seen the consequences of.
 *
 * NOTHING HERE BLOCKS ANYBODY UNTIL "Apply" IS PRESSED.
 * Building a round is a read. Ticking names is a note. Applying is the act,
 * it needs the same right as writing off a bill, and it says so on the button.
 */

import { ErpPanel, ErpTable, ErpTableBody, ErpTableHead, ErpTableShell } from "@/components/ui/erp-roster";
import { useCallback, useEffect, useMemo, useState } from "react";
import {
  BulkActionBar,
  RowCheckbox,
  useRowSelection,
} from "@/components/ui/erp-grid";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";
import { loadSis, type SisState } from "@/lib/sis";
import { formatInrFromPaise, stageLabel } from "@/lib/playbook";
import { HOLD_LABELS } from "@/lib/holds";
import {
  BLOCKABLE_HOLD_CODES,
  type DefaulterPolicy,
  type HoldGate,
  type HoldGateMode,
} from "@/lib/defaulterHoldPolicy";
import type { HoldRound, RoundBlocker, RoundCounts } from "@/lib/defaulterHoldRound";
import type { HoldCode, OverdueStage } from "@/lib/types";
import {
  ensureHoldDecisionsHydrated,
  invalidateHoldDecisions,
} from "@/lib/holdDecisionsCache";
import type { StandingDecision } from "@/lib/holdResolve";

const STAGES: OverdueStage[] = ["S0", "S1", "S2", "S3", "S4"];

// Short, because they sit in a narrow table cell and were cut off to
// "Propose…" on a phone. The full meaning is spelt out once, under the table.
const MODE_LABEL: Record<HoldGateMode, string> = {
  off: "Off",
  propose: "Propose",
  auto: "Automatic",
};

/** The two the school runs by approval, shown first because they are used. */
const GATE_ORDER: HoldCode[] = [
  "HOLD_TRANSPORT",
  "HOLD_ADMIT_CARD",
  ...BLOCKABLE_HOLD_CODES.filter(
    (c) => c !== "HOLD_TRANSPORT" && c !== "HOLD_ADMIT_CARD",
  ),
];

type StaleRow = { studentId: string; was: number; now: number; cleared: boolean };

export function DefaulterHoldPanel() {
  const [sis, setSis] = useState<SisState | null>(null);
  const [policy, setPolicy] = useState<DefaulterPolicy | null>(null);
  const [round, setRound] = useState<HoldRound | null>(null);
  const [counts, setCounts] = useState<RoundCounts | null>(null);
  const [blockers, setBlockers] = useState<RoundBlocker[]>([]);
  const [stale, setStale] = useState<StaleRow[]>([]);
  const [staleKnown, setStaleKnown] = useState(true);
  const [gateCode, setGateCode] = useState<HoldCode>("HOLD_TRANSPORT");
  const [busy, setBusy] = useState("");
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");
  const [allowReason, setAllowReason] = useState("");
  const [duesCacheAt, setDuesCacheAt] = useState<string | null>(null);
  const [standing, setStanding] = useState<StandingDecision[] | null>(null);
  const [liftReason, setLiftReason] = useState("");

  useEffect(() => {
    setSis(loadSis());
  }, []);

  const loadPolicy = useCallback(async () => {
    setError("");
    try {
      const r = await fetch("/api/fees/defaulter-policy", { cache: "no-store" });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setPolicy(j.policy as DefaulterPolicy);
    } catch (e) {
      // A failed read leaves the editor empty rather than showing a policy
      // that is not the school's. Guessing here would let somebody "save"
      // defaults over settings they never saw.
      setPolicy(null);
      setError(
        `Could not read the policy: ${e instanceof Error ? e.message : String(e)}`,
      );
    }
  }, []);

  useEffect(() => {
    void loadPolicy();
  }, [loadPolicy]);

  const gate = useMemo(
    () => policy?.gates.find((g) => g.holdCode === gateCode) ?? null,
    [policy, gateCode],
  );

  const nameOf = useCallback(
    (studentId: string) =>
      sis?.students.find((s) => s.id === studentId)?.fullName || studentId,
    [sis],
  );

  function patchGate(holdCode: HoldCode, patch: Partial<HoldGate>) {
    setPolicy((prev) =>
      prev
        ? {
            ...prev,
            gates: prev.gates.map((g) =>
              g.holdCode === holdCode ? { ...g, ...patch } : g,
            ),
          }
        : prev,
    );
  }

  async function savePolicy() {
    if (!policy) return;
    setBusy("policy");
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/fees/defaulter-policy", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ policy }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setPolicy(j.policy as DefaulterPolicy);
      setNotice("Policy saved. It applies to the next round you build.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function buildRound() {
    setBusy("build");
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/fees/hold-rounds", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ holdCode: gateCode }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setRound(j.round as HoldRound);
      setCounts(j.counts as RoundCounts);
      setBlockers([]);
      setStale([]);
      setDuesCacheAt(j.duesCacheUpdatedAt ?? null);
      setNotice(
        `${(j.counts as RoundCounts).total} of ${j.populationSize} children with an open bill qualify. Nothing is withheld yet.`,
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const refreshRound = useCallback(async (roundId: string) => {
    const r = await fetch(
      `/api/fees/hold-rounds?id=${encodeURIComponent(roundId)}`,
      { cache: "no-store" },
    );
    const j = await r.json();
    if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
    setRound(j.round as HoldRound);
    setCounts(j.counts as RoundCounts);
    setBlockers((j.blockers ?? []) as RoundBlocker[]);
    setStale((j.stale ?? []) as StaleRow[]);
    setStaleKnown(!!j.staleKnown);
  }, []);

  async function decide(
    studentIds: string[],
    decision: "disallow" | "allow" | "undecided",
  ) {
    if (!round || studentIds.length === 0) return;
    if (decision === "allow" && !allowReason.trim()) {
      setError(
        "Type the reason for letting these families through first — it is what next month's round reads.",
      );
      return;
    }
    setBusy("decide");
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/fees/hold-rounds", {
        method: "PATCH",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          roundId: round.id,
          studentIds,
          decision,
          reason: allowReason,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      await refreshRound(round.id);
      selection.clear();
      const missed = (j.requested ?? 0) - (j.changed ?? 0);
      setNotice(
        `${j.changed} marked ${decision}.` +
          (missed > 0 ? ` ${missed} were not in this round and were skipped.` : ""),
      );
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  async function applyRoundNow() {
    if (!round) return;
    setBusy("apply");
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/fees/hold-rounds", {
        method: "PUT",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ roundId: round.id }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      setRound(j.round as HoldRound);
      setCounts(j.counts as RoundCounts);
      setBlockers([]);
      // The gates read a cached snapshot. Applying just changed what they
      // should enforce, so drop it and read again rather than leaving this
      // browser showing the state from before the press.
      invalidateHoldDecisions();
      await loadStanding();
      setNotice(j.message || "Round applied.");
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const loadStanding = useCallback(async () => {
    const snap = await ensureHoldDecisionsHydrated({ force: true });
    if (!snap.known) {
      // Never render an empty list as "nobody is blocked".
      setStanding(null);
      setError(
        snap.error
          ? `Could not read who is currently blocked: ${snap.error}`
          : "Could not read who is currently blocked.",
      );
      return;
    }
    setStanding(snap.decisions);
  }, []);

  useEffect(() => {
    void loadStanding();
  }, [loadStanding]);

  async function liftBlocks(studentIds: string[]) {
    if (studentIds.length === 0) return;
    if (!liftReason.trim()) {
      setError("Lifting a block needs a reason — say why, for next month.");
      return;
    }
    setBusy("lift");
    setError("");
    setNotice("");
    try {
      const r = await fetch("/api/fees/hold-decisions", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          holdCode: gateCode,
          studentIds,
          reason: liftReason,
        }),
      });
      const j = await r.json();
      if (!r.ok || !j.ok) throw new Error(j.error || `HTTP ${r.status}`);
      invalidateHoldDecisions();
      await loadStanding();
      liftSelection.clear();
      setNotice(`${j.released} block${j.released === 1 ? "" : "s"} lifted.`);
    } catch (e) {
      setError(e instanceof Error ? e.message : String(e));
    } finally {
      setBusy("");
    }
  }

  const rows = useMemo(
    () =>
      (round?.items ?? []).map((i) => ({
        ...i,
        name: nameOf(i.studentId),
        stageText: stageLabel(i.stage),
      })),
    [round, nameOf],
  );

  const sort = useTableSort(
    rows,
    {
      name: (r) => r.name,
      stageText: (r) => r.stage,
      overdueDays: (r) => r.overdueDays,
      overdueAmountPaise: (r) => r.overdueAmountPaise,
      decision: (r) => r.decision,
    },
    "overdueAmountPaise",
    "desc",
  );
  const sorted = sort.rows;
  const visibleKeys = sorted.map((r) => r.studentId);
  const selection = useRowSelection(visibleKeys);

  // Everyone currently withheld from THIS service. Allows are kept in the
  // table too — the office needs to see who was looked at and spared, not
  // only who was stopped.
  const standingHere = useMemo(
    () => (standing ?? []).filter((d) => d.holdCode === gateCode),
    [standing, gateCode],
  );
  const liftKeys = standingHere
    .filter((d) => d.decision === "disallow")
    .map((d) => d.studentId);
  const liftSelection = useRowSelection(liftKeys);

  const isDraft = round?.status === "draft";
  const staleIds = new Set(stale.map((s) => s.studentId));

  return (
    <div className="space-y-4">
      {error ? (
        <div className="rounded-xl border border-red-300 bg-red-50 p-3 text-sm text-red-800 dark:border-red-900 dark:bg-red-950/40 dark:text-red-200">
          {error}
        </div>
      ) : null}
      {notice ? (
        <div className="rounded-xl border border-[var(--border)] bg-[var(--muted)] p-3 text-sm">
          {notice}
        </div>
      ) : null}

      {/* ── the policy ───────────────────────────────────────── */}
      <ErpPanel
        title="What a defaulting family loses"
        description="Class attendance, homework, emergency medical care and pickup safety are never withheld, and cannot be added here."
      >
        {!policy ? (
          <p className="text-sm text-muted-foreground">Reading the policy…</p>
        ) : (
          <>
            <ErpTableShell density="compact">
              <ErpTableShell><ErpTable minWidth="min-w-[640px]">
                <ErpTableHead>
                  <tr>
                    <th className="px-2 py-2 text-left">Service</th>
                    <th className="px-2 py-2 text-left">How it runs</th>
                    <th className="px-2 py-2 text-left">From stage</th>
                    <th className="px-2 py-2 text-right">Least owed (₹)</th>
                    <th className="px-2 py-2 text-right">Least days late</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {GATE_ORDER.map((code) => {
                    const g = policy.gates.find((x) => x.holdCode === code);
                    if (!g) return null;
                    return (
                      <tr key={code} className="border-t border-[var(--border)]">
                        <td className="px-2 py-2">{HOLD_LABELS[code]}</td>
                        <td className="px-2 py-2">
                          <select
                            className="erp-input w-full min-w-[7.5rem]"
                            value={g.mode}
                            onChange={(e) =>
                              patchGate(code, {
                                mode: e.target.value as HoldGateMode,
                              })
                            }
                          >
                            {(["off", "propose", "auto"] as HoldGateMode[]).map(
                              (m) => (
                                <option key={m} value={m}>
                                  {MODE_LABEL[m]}
                                </option>
                              ),
                            )}
                          </select>
                        </td>
                        <td className="px-2 py-2">
                          <select
                            className="erp-input min-w-[8.5rem]"
                            value={g.fromStage}
                            disabled={g.mode === "off"}
                            onChange={(e) =>
                              patchGate(code, {
                                fromStage: e.target.value as OverdueStage,
                              })
                            }
                          >
                            {STAGES.map((s) => (
                              <option key={s} value={s}>
                                {stageLabel(s)}
                              </option>
                            ))}
                          </select>
                        </td>
                        <td className="px-2 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            className="erp-input w-28 text-right"
                            value={Math.round(g.minAmountPaise / 100)}
                            disabled={g.mode === "off"}
                            onChange={(e) =>
                              patchGate(code, {
                                minAmountPaise:
                                  Math.max(0, Number(e.target.value) || 0) * 100,
                              })
                            }
                          />
                        </td>
                        <td className="px-2 py-2 text-right">
                          <input
                            type="number"
                            min={0}
                            className="erp-input w-20 text-right"
                            value={g.minOverdueDays}
                            disabled={g.mode === "off"}
                            onChange={(e) =>
                              patchGate(code, {
                                minOverdueDays: Math.max(
                                  0,
                                  Number(e.target.value) || 0,
                                ),
                              })
                            }
                          />
                        </td>
                      </tr>
                    );
                  })}
                </ErpTableBody>
              </ErpTable></ErpTableShell>
            </ErpTableShell>

            <p className="mt-3 text-xs text-muted-foreground">
              <strong>Off</strong> — not used. <strong>Propose</strong> — the
              office builds a list and approves it; nobody is withheld until
              then. <strong>Automatic</strong> — withheld the moment a child
              qualifies, with no list.
            </p>
            <p className="mt-2 text-xs text-muted-foreground">
              The stage counts days late only. A child fifty rupees short for a
              fortnight reaches S3 Serious beside one owing forty thousand, so
              the money floor is what separates them — leave it at zero and it
              does not.
            </p>

            <button
              type="button"
              className="erp-btn erp-btn-primary mt-3"
              disabled={busy === "policy"}
              onClick={() => void savePolicy()}
            >
              {busy === "policy" ? "Saving…" : "Save policy"}
            </button>
          </>
        )}
      </ErpPanel>

      {/* ── the round ────────────────────────────────────────── */}
      <ErpPanel
        title="This round"
        description="Build the list, decide each child, then apply. Nothing is withheld until you apply, and applying tells no family anything — that is still your job."
      >
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="mb-1 block text-muted-foreground">Service</span>
            <select
              className="erp-input"
              value={gateCode}
              onChange={(e) => {
                setGateCode(e.target.value as HoldCode);
                setRound(null);
                setCounts(null);
                selection.clear();
              }}
            >
              {GATE_ORDER.map((c) => (
                <option key={c} value={c}>
                  {HOLD_LABELS[c]}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className="erp-btn"
            disabled={busy === "build" || !gate || gate.mode === "off"}
            onClick={() => void buildRound()}
            title={
              gate && gate.mode === "off"
                ? "This gate is switched off in the policy above"
                : undefined
            }
          >
            {busy === "build" ? "Building…" : "Build the list"}
          </button>
          {duesCacheAt ? (
            <span className="text-xs text-muted-foreground">
              Dues last recalculated {new Date(duesCacheAt).toLocaleString()}
            </span>
          ) : null}
        </div>

        {counts ? (
          <p className="mt-3 text-sm">
            {counts.total} caught · {counts.disallow} to withhold ·{" "}
            {counts.allow} let through · {counts.undecided} undecided
          </p>
        ) : null}

        {blockers.length > 0 && isDraft ? (
          <ul className="mt-2 list-disc pl-5 text-xs text-amber-700 dark:text-amber-300">
            {blockers.map((b) => (
              <li key={b.code}>{b.message}</li>
            ))}
          </ul>
        ) : null}

        {stale.length > 0 ? (
          <div className="mt-2 rounded-xl border border-amber-300 bg-amber-50 p-3 text-xs text-amber-900 dark:border-amber-900 dark:bg-amber-950/40 dark:text-amber-200">
            {stale.length}{" "}
            {stale.length === 1 ? "family has" : "families have"} paid since this
            list was built. They are still on it — let them through rather than
            withholding something they no longer owe for.
          </div>
        ) : null}
        {!staleKnown ? (
          <p className="mt-2 text-xs text-amber-700 dark:text-amber-300">
            Could not check who has paid since the list was built. Treat the
            amounts below as of {round?.asOf}.
          </p>
        ) : null}

        {round && rows.length > 0 ? (
          <>
            {isDraft ? (
              <label className="mt-3 block text-xs">
                <span className="mb-1 block text-muted-foreground">
                  Reason, used when you let families through
                </span>
                <input
                  className="erp-input w-full"
                  value={allowReason}
                  placeholder="Father in hospital — agreed to pay by 15 Oct"
                  onChange={(e) => setAllowReason(e.target.value)}
                />
              </label>
            ) : null}

            <ErpTableShell className="mt-3" exportAs="defaulter-round">
              <ErpTableShell><ErpTable minWidth="min-w-[640px]">
                <ErpTableHead>
                  <tr>
                    {isDraft ? (
                      <th className="w-8 px-2 py-2">
                        <RowCheckbox
                          checked={selection.allSelected(visibleKeys)}
                          indeterminate={selection.someSelected(visibleKeys)}
                          onChange={() => selection.toggleAll(visibleKeys)}
                          label="Select every child in this round"
                        />
                      </th>
                    ) : null}
                    <ErpSortTh sort={sort} field="name">
                      Child
                    </ErpSortTh>
                    <ErpSortTh sort={sort} field="stageText">
                      Stage
                    </ErpSortTh>
                    <ErpSortTh sort={sort} field="overdueDays" align="right">
                      Days late
                    </ErpSortTh>
                    <ErpSortTh
                      sort={sort}
                      field="overdueAmountPaise"
                      align="right"
                    >
                      Overdue
                    </ErpSortTh>
                    <ErpSortTh sort={sort} field="decision">
                      Decision
                    </ErpSortTh>
                    <th className="px-2 py-2 text-left">Reason</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {sorted.map((r) => (
                    <tr
                      key={r.studentId}
                      className="border-t border-[var(--border)]"
                    >
                      {isDraft ? (
                        <td className="px-2 py-2">
                          <RowCheckbox
                            checked={selection.isSelected(r.studentId)}
                            onChange={() => selection.toggle(r.studentId)}
                            label={`Select ${r.name}`}
                          />
                        </td>
                      ) : null}
                      <td className="px-2 py-2">
                        {r.name}
                        {staleIds.has(r.studentId) ? (
                          <span className="ml-2 rounded bg-amber-100 px-1 text-[11px] text-amber-900 dark:bg-amber-900/50 dark:text-amber-200">
                            has paid since
                          </span>
                        ) : null}
                      </td>
                      <td className="px-2 py-2">{r.stageText}</td>
                      <td className="px-2 py-2 text-right">{r.overdueDays}</td>
                      <td className="px-2 py-2 text-right">
                        {formatInrFromPaise(r.overdueAmountPaise)}
                      </td>
                      <td className="px-2 py-2">
                        {r.decision === "disallow"
                          ? "Withhold"
                          : r.decision === "allow"
                            ? "Let through"
                            : "—"}
                      </td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {r.reason}
                      </td>
                    </tr>
                  ))}
                </ErpTableBody>
              </ErpTable></ErpTableShell>
            </ErpTableShell>

            {isDraft ? (
              <div className="mt-3 flex flex-wrap gap-2">
                <button
                  type="button"
                  className="erp-btn erp-btn-primary"
                  disabled={busy === "apply" || blockers.length > 0}
                  onClick={() => void applyRoundNow()}
                  title={
                    blockers.length > 0
                      ? blockers.map((b) => b.message).join("; ")
                      : undefined
                  }
                >
                  {busy === "apply"
                    ? "Applying…"
                    : `Apply — withhold ${counts?.disallow ?? 0}`}
                </button>
                <span className="self-center text-xs text-muted-foreground">
                  Applying needs the right to edit fees.
                </span>
              </div>
            ) : (
              <p className="mt-3 text-sm text-muted-foreground">
                Applied {round.appliedAt ? new Date(round.appliedAt).toLocaleString() : ""}
                {round.appliedBy ? ` by ${round.appliedBy}` : ""}. Build a new
                round to change anything.
              </p>
            )}
          </>
        ) : round ? (
          <p className="mt-3 text-sm text-muted-foreground">
            Nobody qualifies under the current policy. Lower the floor or the
            stage above if that is not what you expected.
          </p>
        ) : null}
      </ErpPanel>

      {/* ── who is withheld right now ────────────────────────── */}
      <ErpPanel
        title="Withheld right now"
        description="What the gates are actually enforcing for this service today. Lifting a block takes effect immediately."
      >
        {standing === null ? (
          <p className="text-sm text-amber-700 dark:text-amber-300">
            Could not read the current blocks, so this list is not shown. It is
            not a list of nobody.
          </p>
        ) : standingHere.length === 0 ? (
          <p className="text-sm text-muted-foreground">
            Nobody is withheld from {HOLD_LABELS[gateCode]}.
          </p>
        ) : (
          <>
            <label className="mb-2 block text-xs">
              <span className="mb-1 block text-muted-foreground">
                Reason, used when you lift a block
              </span>
              <input
                className="erp-input w-full"
                value={liftReason}
                placeholder="Paid in full on 20 Sep"
                onChange={(e) => setLiftReason(e.target.value)}
              />
            </label>
            <ErpTableShell density="compact" exportAs="withheld-now">
              <ErpTableShell><ErpTable minWidth="min-w-[640px]">
                <ErpTableHead>
                  <tr>
                    <th className="w-8 px-2 py-2" />
                    <th className="px-2 py-2 text-left">Child</th>
                    <th className="px-2 py-2 text-left">Decision</th>
                    <th className="px-2 py-2 text-left">Decided</th>
                    <th className="px-2 py-2 text-left">By</th>
                    <th className="px-2 py-2 text-left">Reason</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {standingHere.map((d) => (
                    <tr
                      key={`${d.studentId}-${d.holdCode}`}
                      className="border-t border-[var(--border)]"
                    >
                      <td className="px-2 py-2">
                        {d.decision === "disallow" ? (
                          <RowCheckbox
                            checked={liftSelection.isSelected(d.studentId)}
                            onChange={() => liftSelection.toggle(d.studentId)}
                            label={`Select ${nameOf(d.studentId)}`}
                          />
                        ) : null}
                      </td>
                      <td className="px-2 py-2">{nameOf(d.studentId)}</td>
                      <td className="px-2 py-2">
                        {d.decision === "disallow" ? "Withheld" : "Let through"}
                      </td>
                      <td className="px-2 py-2">
                        {new Date(d.decidedAt).toLocaleDateString()}
                      </td>
                      <td className="px-2 py-2">{d.decidedBy}</td>
                      <td className="px-2 py-2 text-xs text-muted-foreground">
                        {d.reason}
                      </td>
                    </tr>
                  ))}
                </ErpTableBody>
              </ErpTable></ErpTableShell>
            </ErpTableShell>
          </>
        )}
      </ErpPanel>

      {liftSelection.count > 0 && selection.count === 0 ? (
        <BulkActionBar
          selection={liftSelection}
          noun="block"
          actions={[
            {
              id: "lift",
              label: "Lift the block",
              disabled: busy === "lift",
              title: "Needs the reason typed above",
              onRun: (keys) => liftBlocks(keys),
            },
          ]}
        />
      ) : null}

      {isDraft && selection.count > 0 ? (
        <BulkActionBar
          selection={selection}
          noun="child"
          actions={[
            {
              id: "disallow",
              label: "Withhold",
              tone: "danger",
              disabled: busy === "decide",
              onRun: (keys) => decide(keys, "disallow"),
            },
            {
              id: "allow",
              label: "Let through",
              disabled: busy === "decide",
              title: "Needs the reason typed above",
              onRun: (keys) => decide(keys, "allow"),
            },
            {
              id: "undecided",
              label: "Clear decision",
              disabled: busy === "decide",
              onRun: (keys) => decide(keys, "undecided"),
            },
          ]}
        />
      ) : null}
    </div>
  );
}
