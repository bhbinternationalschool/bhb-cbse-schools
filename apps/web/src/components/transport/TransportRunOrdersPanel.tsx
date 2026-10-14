"use client";

import { useCallback, useEffect, useState } from "react";
import { minuteToHhmm, type FairDropSuggestion } from "@/lib/runStopOrder";

/**
 * "Stop order & ride times" — each run's stops in the order the bus really
 * reaches them (from GPS, refreshed every night), and for each drop run the
 * "first picked, first dropped" suggestion with its trade-off spelled out.
 * The choice only changes the order on the driver's list; it never changes a
 * fee, a stop or which run a child is on.
 */

type RunStopRow = { stopId: string; name: string; minute: number; rideMinutes: number | null; days: number; riders: number | null };
type Run = {
  id: string;
  direction: "pickup" | "drop";
  shiftId: string;
  shiftName: string;
  departTime: string;
  chosen: "gps" | "fair";
  chosenBy: string;
  chosenAt: string | null;
  legs: number;
  computedAt: string;
  stops: RunStopRow[];
  unseen: { stopId: string; name: string; riders: number | null }[];
  suggestion: FairDropSuggestion | { suggested: false; reason: string } | null;
};
type RouteRuns = { routeId: string; name: string; vehicle: string; runs: Run[] };

const fmtRide = (m: number | null) => (m == null ? "—" : `${m} min`);

export function TransportRunOrdersPanel({ canEdit }: { canEdit: boolean }) {
  const [routes, setRoutes] = useState<RouteRuns[] | null>(null);
  const [countsKnown, setCountsKnown] = useState(true);
  const [error, setError] = useState("");
  const [busy, setBusy] = useState("");
  const [open, setOpen] = useState<string>("");

  const load = useCallback(async () => {
    setError("");
    try {
      const res = await fetch("/api/transport/run-orders", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok) setError(body?.error || "Could not load stop orders");
      else {
        setRoutes(body.routes as RouteRuns[]);
        setCountsKnown(Boolean(body.countsKnown));
      }
    } catch {
      setError("Could not reach the stop orders");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const choose = useCallback(
    async (id: string, chosen: "gps" | "fair") => {
      setBusy(id);
      setError("");
      try {
        const res = await fetch("/api/transport/run-orders", {
          method: "POST",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify({ id, chosen }),
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
    [load],
  );

  return (
    <section className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="text-sm font-bold text-[var(--brand-deep)]">Stop order &amp; ride times</h2>
      <p className="mt-0.5 max-w-3xl text-xs text-[var(--muted)]">
        Every run — the morning pick-up and each drop — with its stops in the order the bus really
        reaches them, from the bus&apos;s GPS over the last four weeks, updated every night. The
        driver&apos;s list follows this order. Buses without a tracker are not shown.
      </p>
      {error ? <p className="mt-3 text-[11px] text-[var(--danger)]">{error}</p> : null}
      {!countsKnown ? (
        <p className="mt-2 text-[11px] text-[var(--warning)]">
          Classes could not be read, so the number of children per run is not shown.
        </p>
      ) : null}
      {routes == null && !error ? <p className="mt-3 text-[11px] text-[var(--muted)]">Loading…</p> : null}
      {routes && routes.length === 0 ? (
        <p className="mt-3 text-[11px] text-[var(--muted)]">
          No run orders yet — they are worked out from the GPS every night at 21:30.
        </p>
      ) : null}

      <div className="mt-3 space-y-3">
        {(routes ?? []).map((r) => (
          <div key={r.routeId} className="rounded-lg border border-[var(--border)]">
            <button
              type="button"
              onClick={() => setOpen(open === r.routeId ? "" : r.routeId)}
              className="flex w-full items-center justify-between px-3 py-2 text-left text-[12px] font-semibold text-[var(--ink)]"
              aria-expanded={open === r.routeId}
            >
              <span>
                {r.name}
                {r.vehicle && r.vehicle !== r.name ? <span className="font-normal text-[var(--muted)]"> · {r.vehicle}</span> : null}
              </span>
              <span className="text-[11px] font-normal text-[var(--muted)]">
                {r.runs.length} run{r.runs.length === 1 ? "" : "s"}
                {r.runs.some((x) => x.suggestion && "suggested" in x.suggestion && x.suggestion.suggested && x.chosen !== "fair")
                  ? " · suggestion"
                  : ""}
              </span>
            </button>
            {open === r.routeId ? (
              <div className="space-y-3 border-t border-[var(--border)] px-3 py-3">
                {r.runs.map((run) => (
                  <div key={run.id}>
                    <div className="flex flex-wrap items-center gap-2 text-[11px]">
                      <span className="font-semibold text-[var(--ink)]">
                        {run.direction === "pickup" ? "Pick-up" : "Drop"} · {run.shiftName}
                        {run.departTime ? ` · ${run.departTime}` : ""}
                      </span>
                      <span className="text-[var(--muted)]">{run.legs} journeys seen</span>
                      {run.direction === "drop" ? (
                        <span
                          className={`rounded-full px-2 py-0.5 text-[10px] font-semibold ${
                            run.chosen === "fair"
                              ? "bg-[color-mix(in_srgb,var(--success)_14%,transparent)] text-[var(--success)]"
                              : "bg-[rgba(32,48,80,0.06)] text-[var(--muted)]"
                          }`}
                        >
                          {run.chosen === "fair" ? "Driver list: first picked, first dropped" : "Driver list: order driven"}
                        </span>
                      ) : null}
                    </div>
                    <div className="mt-1 overflow-x-auto">
                      <table className="text-[11px] tabular-nums">
                        <thead>
                          <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
                            <th className="pr-3 font-semibold">#</th>
                            <th className="pr-3 font-semibold">Usual time</th>
                            <th className="pr-3 font-semibold">Stop</th>
                            <th className="pr-3 font-semibold">Children</th>
                            <th className="font-semibold">{run.direction === "pickup" ? "Ride to school" : "Ride home"}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {run.stops.map((s, i) => (
                            <tr key={s.stopId} className={s.riders === 0 ? "text-[var(--muted)]" : "text-[var(--ink)]"}>
                              <td className="pr-3">{i + 1}</td>
                              <td className="pr-3">{minuteToHhmm(s.minute)}</td>
                              <td className="pr-3">{s.name}</td>
                              <td className="pr-3">{s.riders ?? "—"}</td>
                              <td>{fmtRide(s.rideMinutes)}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                    </div>
                    {run.unseen.length ? (
                      <p className="mt-1 text-[10px] text-[var(--muted)]">
                        Not reached on this run:{" "}
                        {run.unseen.map((u) => `${u.name}${u.riders ? ` (${u.riders} children)` : ""}`).join(", ")}
                      </p>
                    ) : null}
                    {run.suggestion ? <Suggestion run={run} canEdit={canEdit} busy={busy === run.id} onChoose={choose} /> : null}
                  </div>
                ))}
              </div>
            ) : null}
          </div>
        ))}
      </div>
    </section>
  );
}

function Suggestion({
  run,
  canEdit,
  busy,
  onChoose,
}: {
  run: Run;
  canEdit: boolean;
  busy: boolean;
  onChoose: (id: string, chosen: "gps" | "fair") => void;
}) {
  const s = run.suggestion;
  if (!s) return null;
  if (!s.suggested) {
    return <p className="mt-1.5 text-[10px] text-[var(--muted)]">First picked, first dropped: not suggested — {s.reason}</p>;
  }
  const nameOf = new Map(run.stops.map((x) => [x.stopId, x.name]));
  return (
    <div className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--warning)_45%,transparent)] bg-[color-mix(in_srgb,var(--warning)_8%,transparent)] p-2.5 text-[11px]">
      <p className="font-semibold text-[var(--ink)]">
        Suggestion: first picked, first dropped — the longest day on the bus goes from {s.longestNow} to about{" "}
        {s.longestSuggested} minutes.
      </p>
      <p className="mt-0.5 text-[var(--muted)]">
        The children collected first in the morning are dropped last today, so they ride longest twice. Driving this run
        straight out to them first and dropping back towards school uses the same roads, the other way round.{" "}
        {s.childrenBetter} children would ride less and {s.childrenWorse} more. New times are estimates.
      </p>
      <div className="mt-1.5 overflow-x-auto">
        <table className="tabular-nums">
          <thead>
            <tr className="text-left text-[10px] uppercase tracking-wide text-[var(--muted)]">
              <th className="pr-3 font-semibold">Stop (pick-up order)</th>
              <th className="pr-3 font-semibold">Children</th>
              <th className="pr-3 font-semibold">Morning ride</th>
              <th className="pr-3 font-semibold">Ride home now</th>
              <th className="font-semibold">Ride home, suggested</th>
            </tr>
          </thead>
          <tbody>
            {s.rows.map((r) => (
              <tr key={r.stopId} className="text-[var(--ink)]">
                <td className="pr-3">{nameOf.get(r.stopId) ?? r.stopId}</td>
                <td className="pr-3">{r.riders}</td>
                <td className="pr-3">{fmtRide(r.pickupRide)}</td>
                <td className="pr-3">{fmtRide(r.dropRideNow)}</td>
                <td>~{r.dropRideSuggested} min</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
      {canEdit ? (
        <div className="mt-2 flex flex-wrap gap-2">
          {run.chosen === "fair" ? (
            <button
              type="button"
              disabled={busy}
              onClick={() => onChoose(run.id, "gps")}
              className="rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--ink)] disabled:opacity-50"
            >
              Go back to the order driven
            </button>
          ) : (
            <button
              type="button"
              disabled={busy}
              onClick={() => onChoose(run.id, "fair")}
              className="rounded-lg border border-[var(--border)] px-2 py-1 text-[10px] font-semibold text-[var(--ink)] disabled:opacity-50"
            >
              Use first picked, first dropped on the driver&apos;s list
            </button>
          )}
          <span className="self-center text-[10px] text-[var(--muted)]">Tell the driver before switching.</span>
        </div>
      ) : null}
    </div>
  );
}
