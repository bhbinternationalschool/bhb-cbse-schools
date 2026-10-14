"use client";

import { useCallback, useEffect, useMemo, useState } from "react";
import {
  TRANSPORT_GAP_KIND_LABEL,
  feeGapPaise,
  rupees,
  type TransportGap,
  type TransportGapKind,
} from "@/lib/transportGaps";

/**
 * "Gaps to settle" — where the transport records and the road disagree.
 *
 * Reads /api/transport/gaps. Nothing here changes a fee, stop or assignment:
 * a fee gap shows the billed and the measured figures side by side, and
 * settling a row only records what the office decided.
 */

type Payload = { gaps: TransportGap[]; deskRead: boolean };

const chip = (tone: "warning" | "muted" | "info" | "success", text: string) => (
  <span
    className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
      tone === "warning"
        ? "bg-[color-mix(in_srgb,var(--warning)_16%,transparent)] text-[var(--ink)]"
        : tone === "info"
          ? "bg-[color-mix(in_srgb,var(--brand-deep)_12%,transparent)] text-[var(--brand-deep)]"
          : tone === "success"
            ? "bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]"
            : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
    }`}
  >
    {text}
  </span>
);

const km = (v: number | null) => (v == null ? "—" : `${v} km`);

export function TransportGapsPanel({ canEdit }: { canEdit: boolean }) {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [kind, setKind] = useState<TransportGapKind | "all">("all");
  const [showClosed, setShowClosed] = useState(false);
  const [busy, setBusy] = useState("");
  const [notes, setNotes] = useState<Record<string, string>>({});

  const load = useCallback(async () => {
    setLoading(true);
    setError("");
    try {
      const res = await fetch("/api/transport/gaps", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) setError(body?.error || "Could not load transport gaps");
      else setData(body as Payload);
    } catch {
      setError("Could not reach the transport gaps list");
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const act = useCallback(
    async (id: string) => {
      setBusy(id);
      setError("");
      try {
        const res = await fetch("/api/transport/gaps/act", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id }),
        });
        const body = await res.json();
        if (!res.ok) setError(body?.error || "Could not do that");
        else await load();
      } catch {
        setError("Could not do that");
      } finally {
        setBusy("");
      }
    },
    [load],
  );

  const decide = useCallback(
    async (id: string, status: "settled" | "dismissed" | "open") => {
      setBusy(id);
      setError("");
      try {
        const res = await fetch("/api/transport/gaps", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, status, note: notes[id] ?? "" }),
        });
        const body = await res.json();
        if (!res.ok) setError(body?.error || "Could not save");
        else await load();
      } catch {
        setError("Could not save");
      } finally {
        setBusy("");
      }
    },
    [load, notes],
  );

  const gaps = useMemo(() => data?.gaps ?? [], [data]);
  const counts = useMemo(() => {
    const c = new Map<TransportGapKind, number>();
    for (const g of gaps) if (g.status === "open") c.set(g.kind, (c.get(g.kind) ?? 0) + 1);
    return c;
  }, [gaps]);
  const openCount = gaps.filter((g) => g.status === "open").length;
  const shown = gaps.filter(
    (g) => (kind === "all" || g.kind === kind) && (showClosed || g.status === "open"),
  );

  return (
    <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">Gaps to settle</h2>
          <p className="mt-0.5 max-w-3xl text-xs text-[var(--muted)]">
            Where the transport records and the buses&apos; GPS disagree. No fee has been changed:
            each fee gap shows what the child is billed and what the measured distance would give,
            and the office decides.
          </p>
        </div>
        <label className="flex items-center gap-2 text-[11px] text-[var(--muted)]">
          <input
            id="transport-gaps-show-closed"
            type="checkbox"
            checked={showClosed}
            onChange={(e) => setShowClosed(e.target.checked)}
          />
          Show settled
        </label>
      </div>

      {loading && !data ? (
        <p className="mt-3 text-[11px] text-[var(--muted)]">Loading…</p>
      ) : null}
      {error ? (
        <p className="mt-3 rounded-lg border border-[color-mix(in_srgb,var(--danger)_45%,transparent)] px-3 py-2 text-[11px] text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {data && !data.deskRead ? (
        <p className="mt-3 text-[11px] text-[var(--warning)]">
          The transport desk could not be read, so missing seat counts and drivers are not listed
          below. That does not mean there are none.
        </p>
      ) : null}

      {data ? (
        <>
          <div className="mt-3 flex flex-wrap gap-1.5">
            <button
              type="button"
              onClick={() => setKind("all")}
              className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${kind === "all" ? "border-[var(--brand-deep)] text-[var(--brand-deep)]" : "border-[var(--border)] text-[var(--muted)]"}`}
            >
              All open · {openCount}
            </button>
            {(Object.keys(TRANSPORT_GAP_KIND_LABEL) as TransportGapKind[])
              .filter((k) => (counts.get(k) ?? 0) > 0)
              .map((k) => (
                <button
                  key={k}
                  type="button"
                  onClick={() => setKind(k)}
                  className={`rounded-full border px-2.5 py-1 text-[11px] font-semibold ${kind === k ? "border-[var(--brand-deep)] text-[var(--brand-deep)]" : "border-[var(--border)] text-[var(--muted)]"}`}
                >
                  {TRANSPORT_GAP_KIND_LABEL[k]} · {counts.get(k)}
                </button>
              ))}
          </div>

          {shown.length === 0 ? (
            <p className="mt-3 text-[11px] text-[var(--success)]">Nothing open here.</p>
          ) : (
            <ul className="mt-3 space-y-2">
              {shown.map((g) => {
                const diff = feeGapPaise(g);
                const isFee = g.kind === "fee_distance";
                return (
                  <li key={g.id} className="rounded-lg border border-[var(--border)] px-3 py-2 text-[11px]">
                    <div className="flex flex-wrap items-center gap-2">
                      <span className="font-semibold text-[var(--ink)]">{g.title}</span>
                      {g.vehicle ? chip("muted", g.vehicle) : null}
                      {chip(isFee ? "warning" : "info", TRANSPORT_GAP_KIND_LABEL[g.kind])}
                      {g.live ? chip("muted", "closes when the record is filled in") : null}
                      {g.status !== "open" ? chip("success", g.status === "settled" ? "Settled" : "Dismissed") : null}
                    </div>
                    {g.detail ? <p className="mt-1 max-w-4xl text-[var(--muted)]">{g.detail}</p> : null}
                    {isFee ? (
                      <div className="mt-1.5 overflow-x-auto">
                        <table className="text-[11px] tabular-nums">
                          <thead>
                            <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
                              <th className="pr-4 font-semibold">Billed distance</th>
                              <th className="pr-4 font-semibold">Road distance</th>
                              <th className="pr-4 font-semibold">Straight line</th>
                              <th className="pr-4 font-semibold">Billed / month</th>
                              <th className="pr-4 font-semibold">Policy at road distance</th>
                              <th className="font-semibold">Difference</th>
                            </tr>
                          </thead>
                          <tbody>
                            <tr className="text-[var(--ink)]">
                              <td className="pr-4">{km(g.billedKm)}</td>
                              <td className="pr-4">{km(g.roadKm)}</td>
                              <td className="pr-4">{km(g.straightKm)}</td>
                              <td className="pr-4">{rupees(g.billedFeePaise)}</td>
                              <td className="pr-4">
                                {g.policyFeePaise != null ? rupees(g.policyFeePaise) : g.policyFeeNote || "—"}
                              </td>
                              <td>{diff == null ? "—" : diff === 0 ? "none" : `${rupees(diff)} / month`}</td>
                            </tr>
                          </tbody>
                        </table>
                      </div>
                    ) : null}
                    {g.status !== "open" ? (
                      <p className="mt-1 text-[var(--muted)]">
                        {g.settledBy ? `${g.settledBy}: ` : ""}
                        {g.settleNote}
                      </p>
                    ) : null}
                    {g.actionResult ? (
                      <p className="mt-1 font-semibold text-[var(--success)]">{g.actionResult}</p>
                    ) : null}
                    {canEdit && !g.live && g.status === "open" && g.action && !g.actionDoneAt ? (
                      <button
                        type="button"
                        disabled={busy === g.id}
                        onClick={() => void act(g.id)}
                        className="mt-1.5 rounded-lg bg-[var(--brand-deep)] px-2.5 py-1 text-[11px] font-semibold text-white disabled:opacity-50"
                      >
                        {busy === g.id ? "Working…" : g.action.label}
                      </button>
                    ) : null}
                    {canEdit && !g.live ? (
                      g.status === "open" ? (
                        <div className="mt-1.5 flex flex-wrap items-center gap-2">
                          <input
                            id={`transport-gap-note-${g.id}`}
                            aria-label="What was decided"
                            value={notes[g.id] ?? ""}
                            onChange={(e) => setNotes((n) => ({ ...n, [g.id]: e.target.value }))}
                            placeholder="What was decided"
                            className="min-w-0 flex-1 rounded-lg border border-[var(--border)] bg-[var(--card)] px-2 py-1 text-[11px] text-[var(--ink)]"
                          />
                          <button
                            type="button"
                            disabled={busy === g.id || !(notes[g.id] ?? "").trim()}
                            onClick={() => void decide(g.id, "settled")}
                            className="rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--ink)] disabled:opacity-50"
                          >
                            Mark settled
                          </button>
                          <button
                            type="button"
                            disabled={busy === g.id || !(notes[g.id] ?? "").trim()}
                            onClick={() => void decide(g.id, "dismissed")}
                            className="rounded-lg px-2 py-1 text-[10px] font-semibold text-[var(--muted)] disabled:opacity-50"
                          >
                            Not a problem
                          </button>
                        </div>
                      ) : (
                        <button
                          type="button"
                          disabled={busy === g.id}
                          onClick={() => void decide(g.id, "open")}
                          className="mt-1.5 rounded-lg px-2 py-1 text-[10px] font-semibold text-[var(--muted)] disabled:opacity-50"
                        >
                          Reopen
                        </button>
                      )
                    ) : null}
                  </li>
                );
              })}
            </ul>
          )}
          <p className="mt-3 text-[10px] text-[var(--muted)]">
            Fee gaps come from the child&apos;s home pin or the place the bus actually halts, measured
            by road from school. Google&apos;s road route can be longer than the bus&apos;s own path,
            so the straight-line distance is shown too. Settling a gap records the decision only: to
            change a fee, stop or bus, edit it on the Riders or Routes tab.
          </p>
        </>
      ) : null}
    </section>
  );
}
