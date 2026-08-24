"use client";

/**
 * Admissions → Village market → "Fix spellings".
 *
 * The queue that turns unplaced leads into placed ones. Each row is a
 * locality a field agent typed that matches no census village, with the
 * nearest candidates and their match scores. A person picks one, or says
 * "not a village". Both are decisions; both stick; both outrank the fuzzy
 * guess forever after.
 *
 * Why a person and not a looser threshold: similarity('Ayar','Aayr') is
 * 0.111, and any cutoff low enough to catch it also matches Akla to Koila.
 * Crediting leads to a village nobody visited is worse than leaving them
 * unplaced, because it reads as coverage. So the machine proposes, ranked
 * and scored, and a human disposes.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { AlertTriangle, Check, RefreshCw, Undo2, X } from "lucide-react";
import { Skeleton } from "@/components/ui/skeleton";
import { erpBtn, erpBtnOutline, erpField } from "@/components/ui/erp-ui";
import {
  formatIndianNumber,
  formatPct,
  leadsPlacedBy,
  type VillageAliasCandidate,
  type VillageAliasRow,
  type VillageAliasesResponse,
  type VillageAliasesResult,
  type VillageAliasSuggestion,
  type VillageSearchResponse,
} from "@/lib/villageMarket";

type State =
  | { status: "loading" }
  | { status: "ready"; data: VillageAliasesResponse }
  | { status: "error"; message: string };

/** A suggestion this weak is shown but never preselected. */
const WEAK_SCORE = 0.3;

function CandidateRow({
  row,
  busy,
  onConfirm,
  onIgnore,
}: {
  row: VillageAliasCandidate;
  busy: boolean;
  onConfirm: (villageId: string) => void;
  onIgnore: () => void;
}) {
  const best = row.suggestions[0];
  // Preselect only a suggestion strong enough to be worth defaulting to — or
  // one the consonant skeleton picked out, which is reliable precisely where
  // the trigram score is not (Aayr/Ayar scores 0.111 and is still correct).
  const [choice, setChoice] = useState(
    best && (best.skeletonMatch || best.score >= WEAK_SCORE) ? best.villageId : "",
  );

  // Some spellings have no convincing neighbour at all. Without a search the
  // only available action would be "not a village", which discards real leads.
  const [query, setQuery] = useState("");
  const [found, setFound] = useState<VillageAliasSuggestion[]>([]);
  const [searching, setSearching] = useState(false);
  const debounce = useRef<number | null>(null);

  useEffect(
    () => () => {
      if (debounce.current) window.clearTimeout(debounce.current);
    },
    [],
  );

  const runSearch = useCallback((q: string) => {
    if (debounce.current) window.clearTimeout(debounce.current);
    if (q.trim().length < 2) {
      setFound([]);
      return;
    }
    debounce.current = window.setTimeout(async () => {
      setSearching(true);
      try {
        const res = await fetch(
          `/api/admissions/village-aliases?villageSearch=${encodeURIComponent(q.trim())}`,
          { cache: "no-store" },
        );
        const body = (await res.json()) as VillageSearchResponse | { ok: false };
        setFound(res.ok && body.ok ? body.results : []);
      } catch {
        setFound([]);
      } finally {
        setSearching(false);
      }
    }, 300);
  }, []);

  // Search hits first, then the ranked suggestions, de-duplicated.
  const options = useMemo(() => {
    const seen = new Set<string>();
    return [...found, ...row.suggestions].filter((o) => {
      if (seen.has(o.villageId)) return false;
      seen.add(o.villageId);
      return true;
    });
  }, [found, row.suggestions]);

  return (
    <li className="erp-surface-sm space-y-2">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <span className="text-sm font-semibold text-[var(--brand-deep)]">
          &ldquo;{row.locality}&rdquo;
        </span>
        <span className="text-micro text-[var(--muted)]">
          {formatIndianNumber(row.leadCount)} lead{row.leadCount === 1 ? "" : "s"}
          {row.enrolledCount > 0
            ? ` · ${formatIndianNumber(row.enrolledCount)} enrolled`
            : ""}
        </span>
      </div>

      {options.length ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="min-w-[14rem] flex-1 text-micro text-[var(--muted)]">
            This spelling means
            <select
              className={erpField}
              value={choice}
              disabled={busy}
              onChange={(e) => setChoice(e.target.value)}
            >
              <option value="">Choose a village…</option>
              {options.map((s) => (
                <option key={s.villageId} value={s.villageId}>
                  {s.villageName}
                  {s.blockName ? ` · ${s.blockName}` : ""}
                  {s.settlementType === "town" ? " (town)" : ""}
                  {s.skeletonMatch
                    ? " — same consonants"
                    : ` — ${Math.round(s.score * 100)}% match`}
                  {`, ${formatIndianNumber(s.childPool)} children`}
                </option>
              ))}
            </select>
          </label>
          <button
            type="button"
            className={erpBtn}
            disabled={busy || !choice}
            onClick={() => choice && onConfirm(choice)}
          >
            <Check className="size-3.5" aria-hidden />
            Confirm
          </button>
          <button
            type="button"
            className={erpBtnOutline}
            disabled={busy}
            onClick={onIgnore}
          >
            <X className="size-3.5" aria-hidden />
            Not a village
          </button>
        </div>
      ) : (
        <div className="flex flex-wrap items-center gap-2">
          <p className="flex-1 text-micro text-[var(--muted)]">
            No census village resembles this at all.
          </p>
          <button type="button" className={erpBtnOutline} disabled={busy} onClick={onIgnore}>
            <X className="size-3.5" aria-hidden />
            Not a village
          </button>
        </div>
      )}

      <label className="block text-micro text-[var(--muted)]">
        Not in the list? Search all 1,292 settlements
        <input
          type="search"
          className={erpField}
          placeholder="type a village or town name"
          value={query}
          disabled={busy}
          onChange={(e) => {
            setQuery(e.target.value);
            runSearch(e.target.value);
          }}
        />
        {searching ? <span className="text-micro">searching…</span> : null}
        {query.trim().length >= 2 && !searching && !found.length ? (
          <span className="text-micro text-[var(--warning)]">
            No settlement matches &ldquo;{query.trim()}&rdquo;.
          </span>
        ) : null}
      </label>

      {best && !best.skeletonMatch && best.score < WEAK_SCORE ? (
        <p className="text-micro text-[var(--warning)]">
          Closest match is only {Math.round(best.score * 100)}% — check this one
          against the agent&rsquo;s notes before confirming.
        </p>
      ) : null}
    </li>
  );
}

function DecidedRow({
  row,
  busy,
  onUndo,
}: {
  row: VillageAliasRow;
  busy: boolean;
  onUndo: () => void;
}) {
  return (
    <li className="flex flex-wrap items-center justify-between gap-2 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] px-2.5 py-1.5">
      <span className="text-micro text-[var(--muted)]">
        <strong className="text-[var(--brand-deep)]">&ldquo;{row.alias}&rdquo;</strong>
        {row.status === "confirmed" ? (
          <>
            {" → "}
            <span className="text-[var(--brand-deep)]">{row.villageName || "…"}</span>
            {row.blockName ? ` · ${row.blockName}` : ""}
            {row.leadCountAtConfirm > 0
              ? ` · ${formatIndianNumber(row.leadCountAtConfirm)} leads placed`
              : ""}
          </>
        ) : (
          " → not a village"
        )}
        {row.confirmedBy ? ` · ${row.confirmedBy}` : ""}
      </span>
      <button
        type="button"
        className="inline-flex items-center gap-1 text-micro font-semibold text-[var(--info)] underline"
        disabled={busy}
        onClick={onUndo}
      >
        <Undo2 className="size-3" aria-hidden />
        Undo
      </button>
    </li>
  );
}

export function VillageAliasPanel({
  academicYearCode = "",
  canEdit,
  onChanged,
}: {
  academicYearCode?: string;
  canEdit: boolean;
  /** Fired after a decision so the village cards can refetch. */
  onChanged?: () => void;
}) {
  const [state, setState] = useState<State>({ status: "loading" });
  const [busy, setBusy] = useState(false);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    setState({ status: "loading" });
    const params = new URLSearchParams();
    if (academicYearCode) params.set("academicYearCode", academicYearCode);
    try {
      const res = await fetch(`/api/admissions/village-aliases?${params}`, {
        cache: "no-store",
      });
      const body = (await res.json()) as VillageAliasesResult;
      if (!res.ok || !body.ok) {
        const message =
          "error" in body && body.error ? body.error : `Request failed (${res.status})`;
        console.warn("[VillageAliasPanel] load failed:", message);
        setState({ status: "error", message });
        return;
      }
      setState({ status: "ready", data: body });
    } catch (e) {
      const message = e instanceof Error ? e.message : "Network error";
      console.error("[VillageAliasPanel] network failure:", message);
      setState({ status: "error", message: `Could not reach the server (${message}).` });
    }
  }, [academicYearCode]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    const t = notice ? window.setTimeout(() => setNotice(null), 3500) : null;
    return () => {
      if (t) window.clearTimeout(t);
    };
  }, [notice]);

  const mutate = useCallback(
    async (fn: () => Promise<Response>, okMessage: string) => {
      if (busy) return;
      setBusy(true);
      try {
        const res = await fn();
        const body = (await res.json()) as { ok?: boolean; error?: string };
        if (!res.ok || !body.ok) {
          setNotice(body.error || `Failed (${res.status})`);
          return;
        }
        setNotice(okMessage);
        await load();
        onChanged?.();
      } catch (e) {
        setNotice(e instanceof Error ? e.message : "Network error");
      } finally {
        setBusy(false);
      }
    },
    [busy, load, onChanged],
  );

  const data = state.status === "ready" ? state.data : null;

  const placed = useMemo(
    () => (data ? leadsPlacedBy(data.aliases) : 0),
    [data],
  );

  const unplaced = data?.coverage?.unmatchedLeads ?? 0;
  const total = data?.coverage?.totalLeads ?? 0;

  return (
    <section className="space-y-3">
      <header className="erp-surface space-y-1">
        <div className="flex flex-wrap items-start justify-between gap-2">
          <div>
            <h3 className="erp-section-title">Fix spellings</h3>
            <p className="mt-0.5 text-xs text-[var(--muted)]">
              Leads whose village name matches no census record. Confirm what each
              one means and it counts from then on — everywhere, permanently.
            </p>
          </div>
          <button
            type="button"
            className={erpBtnOutline}
            disabled={busy || state.status === "loading"}
            onClick={() => void load()}
          >
            <RefreshCw
              className={`size-3.5 ${state.status === "loading" ? "animate-spin" : ""}`}
              aria-hidden
            />
            Refresh
          </button>
        </div>
        {data ? (
          <p className="text-micro text-[var(--muted)]">
            {formatIndianNumber(unplaced)} of {formatIndianNumber(total)} leads still
            unplaced ({formatPct(total ? (unplaced / total) * 100 : null)})
            {placed > 0
              ? ` · ${formatIndianNumber(placed)} placed by spellings you already fixed`
              : ""}
          </p>
        ) : null}
      </header>

      {notice ? (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--accent)] px-3 py-1.5 text-xs text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      {!canEdit ? (
        <p className="rounded-lg border border-[var(--border)] bg-[var(--muted-surface)] px-3 py-2 text-xs text-[var(--muted)]">
          You can see the queue but not change spellings — that needs admissions
          edit rights, because a mapping changes every penetration figure on this
          page.
        </p>
      ) : null}

      {state.status === "loading" ? (
        <div className="space-y-2" role="status" aria-label="Loading spellings">
          {Array.from({ length: 3 }).map((_, i) => (
            <div key={i} className="erp-surface-sm space-y-2">
              <Skeleton className="h-4 w-40" />
              <Skeleton className="h-9 w-full" />
            </div>
          ))}
        </div>
      ) : null}

      {state.status === "error" ? (
        <div className="erp-surface space-y-2">
          <p className="flex items-center gap-2 text-sm font-semibold text-[var(--danger)]">
            <AlertTriangle className="size-4" aria-hidden />
            Could not load the spelling queue
          </p>
          <p className="text-xs text-[var(--muted)]">{state.message}</p>
          <button type="button" className={erpBtnOutline} onClick={() => void load()}>
            <RefreshCw className="size-3.5" aria-hidden />
            Retry
          </button>
        </div>
      ) : null}

      {data ? (
        <>
          {data.candidates.length ? (
            <ul className="space-y-2">
              {data.candidates.map((c) => (
                <CandidateRow
                  key={c.locality}
                  row={c}
                  busy={busy || !canEdit}
                  onConfirm={(villageId) =>
                    void mutate(
                      () =>
                        fetch("/api/admissions/village-aliases", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            alias: c.locality,
                            status: "confirmed",
                            villageId,
                            leadCount: c.leadCount,
                          }),
                        }),
                      `"${c.locality}" confirmed — ${c.leadCount} lead${c.leadCount === 1 ? "" : "s"} placed`,
                    )
                  }
                  onIgnore={() =>
                    void mutate(
                      () =>
                        fetch("/api/admissions/village-aliases", {
                          method: "POST",
                          headers: { "Content-Type": "application/json" },
                          body: JSON.stringify({
                            alias: c.locality,
                            status: "ignored",
                            leadCount: c.leadCount,
                          }),
                        }),
                      `"${c.locality}" marked as not a village`,
                    )
                  }
                />
              ))}
            </ul>
          ) : (
            <div className="erp-surface text-center">
              <p className="text-sm font-medium text-[var(--brand-deep)]">
                Every spelling has been decided
              </p>
              <p className="mt-1 text-xs text-[var(--muted)]">
                Nothing is waiting. New spellings appear here as agents capture
                more leads.
              </p>
            </div>
          )}

          {data.truncated ? (
            <p className="text-micro text-[var(--muted)]">
              Showing the {data.candidates.length} spellings with the most leads.
              More appear as you clear these.
            </p>
          ) : null}

          {data.aliases.length ? (
            <details className="erp-surface-sm">
              <summary className="cursor-pointer text-xs font-semibold text-[var(--brand-deep)]">
                {formatIndianNumber(data.aliases.length)} spelling
                {data.aliases.length === 1 ? "" : "s"} already decided
              </summary>
              <ul className="mt-2 space-y-1">
                {data.aliases.map((a) => (
                  <DecidedRow
                    key={a.id}
                    row={a}
                    busy={busy || !canEdit}
                    onUndo={() =>
                      void mutate(
                        () =>
                          fetch(
                            `/api/admissions/village-aliases?id=${encodeURIComponent(a.id)}`,
                            { method: "DELETE" },
                          ),
                        `"${a.alias}" returned to the queue`,
                      )
                    }
                  />
                ))}
              </ul>
            </details>
          ) : null}
        </>
      ) : null}
    </section>
  );
}

export default VillageAliasPanel;
