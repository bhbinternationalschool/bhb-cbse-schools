"use client";

import { useCallback, useEffect, useState } from "react";
import type { PinReceivedRow } from "@/lib/pinReview";

/**
 * Pins families sent on WhatsApp: where each landed, who it was saved to,
 * and whether it agrees with the child's stop and recorded home.
 *
 * Every figure has a map link beside it, because "2.4 km from the stop" is a
 * reason to look, not a conclusion — the stop itself may be the thing that is
 * wrong. Nothing here moves a child; the planner does that.
 */

type Payload = {
  rows: PinReceivedRow[];
  pinnedNoPoint: { householdId: string; guardianName: string; respondedAt: string; note: string }[];
  counts: { families: number; children: number; toCheck: number };
};

function when(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? iso : d.toLocaleString("en-IN", { dateStyle: "medium", timeStyle: "short" });
}

export function PinsReceivedPanel() {
  const [data, setData] = useState<Payload | null>(null);
  const [error, setError] = useState("");
  const [onlyCheck, setOnlyCheck] = useState(false);

  const load = useCallback(async () => {
    try {
      const res = await fetch("/api/transport/pins-received", { cache: "no-store" });
      const body = await res.json();
      if (!res.ok || !body.ok) {
        setError(body?.error || "Could not read the pins");
        return;
      }
      setData(body);
      setError("");
    } catch {
      setError("Could not reach the server");
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const rows = data ? (onlyCheck ? data.rows.filter((r) => r.verdict === "check") : data.rows) : [];

  return (
    <div className="mt-4 rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <div className="flex flex-wrap items-center justify-between gap-2">
        <div>
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">Pins received from families</h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Where each pin landed, which children it was saved to, and how it compares with their stop and
            recorded home. Open the map before changing anything — the stop can be the thing that is wrong.
          </p>
        </div>
        <div className="flex items-center gap-2">
          <label className="flex items-center gap-1 text-[11px]">
            <input type="checkbox" checked={onlyCheck} onChange={(e) => setOnlyCheck(e.target.checked)} />
            Only those to check
          </label>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-2 py-1 text-[11px] font-semibold"
            onClick={() => void load()}
          >
            Refresh
          </button>
        </div>
      </div>

      {error ? (
        <p className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-[11px] font-semibold text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {data ? (
        <>
          <p className="mt-2 text-[11px] text-[var(--muted)]">
            {data.counts.families} famil{data.counts.families === 1 ? "y" : "ies"} · {data.counts.children} child
            {data.counts.children === 1 ? "" : "ren"} pinned ·{" "}
            <span className={data.counts.toCheck ? "font-semibold text-[var(--danger)]" : ""}>
              {data.counts.toCheck} to check
            </span>
          </p>

          {data.pinnedNoPoint.length ? (
            <p className="mt-2 text-[11px] text-[var(--danger)]">
              Marked as answered but no pin was saved to any child:{" "}
              {data.pinnedNoPoint.map((p) => `${p.guardianName}${p.note ? ` (${p.note})` : ""}`).join(", ")}
            </p>
          ) : null}

          {rows.length === 0 ? (
            <p className="mt-3 text-[11px] text-[var(--muted)]">
              {data.rows.length === 0 ? "No family has sent a pin yet." : "Nothing to check."}
            </p>
          ) : (
            <div className="mt-3 space-y-2">
              {rows.map((r) => (
                <div
                  key={r.householdId}
                  className={`rounded-lg border p-3 ${
                    r.verdict === "check"
                      ? "border-[color-mix(in_srgb,var(--danger)_45%,transparent)]"
                      : "border-[var(--border)]"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <div className="text-[12px] font-semibold text-[var(--brand-deep)]">
                      {r.guardianName} <span className="font-normal text-[var(--muted)]">· {r.mobileMasked}</span>
                    </div>
                    <span
                      className={`rounded-full px-2 py-0.5 text-[10px] font-bold ${
                        r.verdict === "check"
                          ? "bg-[color-mix(in_srgb,var(--danger)_12%,transparent)] text-[var(--danger)]"
                          : "bg-[color-mix(in_srgb,var(--success)_12%,transparent)] text-[var(--success)]"
                      }`}
                    >
                      {r.verdict === "check" ? "Check on the map" : "Looks right"}
                    </span>
                  </div>
                  <div className="mt-1 text-[11px] text-[var(--muted)]">
                    Sent {when(r.sentAt)} · {r.kmFromSchool} km from school ·{" "}
                    <a className="font-semibold text-[var(--brand-mid)] underline" href={r.mapUrl} target="_blank" rel="noreferrer">
                      Open pin on map
                    </a>
                    {r.placeName || r.address ? ` · ${[r.placeName, r.address].filter(Boolean).join(", ")}` : ""}
                  </div>
                  <ul className="mt-2 space-y-1">
                    {r.children.map((c) => (
                      <li key={c.studentId} className="text-[11px]">
                        <span className="font-semibold">Saved to {c.name}</span>
                        {c.busNo || c.routeName ? ` · bus ${c.busNo || c.routeName}` : ""}
                        {c.stopName ? (
                          <>
                            {" · stop "}
                            {c.stopMapUrl ? (
                              <a className="text-[var(--brand-mid)] underline" href={c.stopMapUrl} target="_blank" rel="noreferrer">
                                {c.stopName}
                              </a>
                            ) : (
                              c.stopName
                            )}
                          </>
                        ) : null}
                        <div className={c.review.verdict === "check" ? "text-[var(--danger)]" : "text-[var(--muted)]"}>
                          {c.review.summary}
                        </div>
                      </li>
                    ))}
                  </ul>
                  {r.ridersWithoutPin.length ? (
                    <p className="mt-1 text-[11px] text-[var(--danger)]">
                      Also rides the bus but the pin was not saved to: {r.ridersWithoutPin.join(", ")}
                    </p>
                  ) : null}
                </div>
              ))}
            </div>
          )}
        </>
      ) : !error ? (
        <p className="mt-2 text-[11px] text-[var(--muted)]">Loading…</p>
      ) : null}
    </div>
  );
}
