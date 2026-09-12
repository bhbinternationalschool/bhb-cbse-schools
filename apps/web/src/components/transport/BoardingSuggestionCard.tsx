"use client";

import { useState } from "react";
import { formatInr } from "@/lib/fees";
import { reportAiOutcome } from "@/lib/aiOutcomeClient";
import type {
  BoardingCandidateFact,
  BoardingSuggestDraft,
} from "@/lib/boardingSuggestAi";

/**
 * "Where should this child board?" — the shortlist, and an opinion about it.
 *
 * THE SHORTLIST IS SHOWN, NOT JUST THE ANSWER
 * Every row carries the measured walk, the bus, the seats and the sibling, so
 * a clerk can disagree with the recommendation on the evidence rather than
 * take it on trust. That is also the fallback when the model is unreachable:
 * the numbers are useful on their own and are rendered either way.
 *
 * NOTHING IS APPLIED BY ITSELF
 * "Use this stop" fills the route and stop in the dialog behind it, which the
 * clerk still has to save. A boarding point has reasons the system cannot see
 * — an aunt on the way, a sibling at another school, a road the family will
 * not let a child cross — and the model is told it knows nothing about roads
 * for exactly that reason.
 */

type Response = {
  ok?: boolean;
  error?: string;
  askedModel?: boolean;
  generationId?: string;
  candidates?: BoardingCandidateFact[];
  context?: {
    home: { label: string; precision: "village" | "household" | "pin" };
    noiseFloorKm: number;
    walkSource: "google" | "mixed" | "straight";
    haltEvidence: { daysObserved: number; usable: boolean; note?: string };
  };
  draft?: BoardingSuggestDraft;
};

const PRECISION_LABEL: Record<string, string> = {
  pin: "a pin dropped for this child",
  household: "the family's geocoded address",
  village: "their village centroid — right village, not right corner",
};

export function BoardingSuggestionCard({
  studentId,
  academicYearCode,
  stopRouteId,
  onUseStop,
}: {
  studentId: string;
  academicYearCode: string;
  /** Which route a stop belongs to, so applying one sets both. */
  stopRouteId: (stopId: string) => string;
  onUseStop: (choice: { routeId: string; stopId: string }) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [res, setRes] = useState<Response | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [used, setUsed] = useState(false);

  async function ask() {
    setBusy(true);
    setError(null);
    setRes(null);
    setUsed(false);
    try {
      const r = await fetch("/api/ai/boarding-point", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ studentId, academicYearCode }),
      });
      const data = (await r.json()) as Response;
      // A 502 still carries the measured shortlist — show it rather than
      // throwing away work the clerk can use.
      if (!data.ok && !data.candidates) {
        setError(data.error || "Could not work out a suggestion");
        return;
      }
      if (!data.ok) setError(data.error || "The model was unreachable");
      setRes(data);
    } catch (e) {
      setError(e instanceof Error ? e.message : "Request failed");
    } finally {
      setBusy(false);
    }
  }

  function use(stopId: string) {
    const routeId = stopRouteId(stopId);
    if (!routeId) return;
    onUseStop({ routeId, stopId });
    setUsed(true);
    if (res?.generationId) {
      reportAiOutcome({
        ids: [res.generationId],
        // "accepted" only when they took the stop the model named; picking a
        // different row off the shortlist is the model being overruled.
        outcome: stopId === res.draft?.stopId ? "accepted" : "edited",
        targetType: "student",
        targetId: studentId,
      });
    }
  }

  function dismiss() {
    if (res?.generationId && !used) {
      reportAiOutcome({
        ids: [res.generationId],
        outcome: "rejected",
        targetType: "student",
        targetId: studentId,
      });
    }
    setRes(null);
    setError(null);
  }

  if (!res) {
    return (
      <div className="rounded-xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <div>
            <h3 className="text-[12px] font-bold text-[var(--brand-deep)]">
              Where should this child board?
            </h3>
            <p className="text-[10px] text-[var(--muted)]">
              Measures the walk to every pinned stop and weighs seats, siblings
              and where the buses are actually seen to halt.
            </p>
          </div>
          <button
            type="button"
            onClick={ask}
            disabled={busy}
            className="rounded-lg border border-[var(--brand-mid)] px-3 py-1.5 text-xs font-bold text-[var(--brand-mid)] disabled:opacity-40"
          >
            {busy ? "Measuring…" : "Suggest a stop"}
          </button>
        </div>
        {error ? (
          <p className="mt-2 text-[11px] font-semibold text-[var(--danger)]">
            {error}
          </p>
        ) : null}
      </div>
    );
  }

  const draft = res.draft;
  const ctx = res.context;
  const candidates = res.candidates ?? [];
  const chosen = draft?.stopId
    ? candidates.find((c) => c.stopId === draft.stopId)
    : undefined;

  return (
    <div className="rounded-xl border border-[var(--brand-mid)] bg-[var(--card)] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[12px] font-bold text-[var(--brand-deep)]">
          Where should this child board?
        </h3>
        <button
          type="button"
          onClick={dismiss}
          className="text-[11px] font-semibold text-[var(--muted)]"
        >
          Dismiss
        </button>
      </div>

      {error ? (
        <p className="mt-2 rounded-lg border border-[color-mix(in_srgb,var(--danger)_35%,transparent)] bg-[color-mix(in_srgb,var(--danger)_8%,transparent)] px-3 py-2 text-[11px] font-semibold text-[var(--danger)]">
          {error} — the measured shortlist below still stands.
        </p>
      ) : null}

      {draft ? (
        <div className="mt-2 rounded-lg bg-[var(--surface-sunken)] px-3 py-2">
          <p className="text-[12px] font-semibold text-[var(--ink)]">
            {draft.recommendation}
          </p>
          {draft.reasons.length > 0 ? (
            <ul className="mt-1 list-disc space-y-0.5 pl-4">
              {draft.reasons.map((r, i) => (
                <li key={i} className="text-[11px] text-[var(--muted)]">
                  {r}
                </li>
              ))}
            </ul>
          ) : null}
          {draft.caution ? (
            <p className="mt-1 text-[11px] font-semibold text-[var(--warning)]">
              {draft.caution}
            </p>
          ) : null}
          {chosen ? (
            <button
              type="button"
              onClick={() => use(chosen.stopId)}
              className="mt-2 rounded-lg bg-[var(--primary)] px-3 py-1.5 text-xs font-bold text-[var(--primary-foreground)]"
            >
              Use {chosen.stopName} on {chosen.routeLabel}
            </button>
          ) : null}
        </div>
      ) : null}

      {ctx ? (
        <p className="mt-2 text-[10px] text-[var(--muted)]">
          Measured from {ctx.home.label} —{" "}
          {PRECISION_LABEL[ctx.home.precision] ?? ctx.home.precision}. Gaps under{" "}
          {ctx.noiseFloorKm} km cannot be told apart at that precision.
          {ctx.walkSource === "straight"
            ? " Google walking routes were unavailable, so these are straight-line distances."
            : ctx.walkSource === "mixed"
              ? " Some rows fell back to a straight line where Google had no walking route."
              : ""}
          {ctx.haltEvidence.usable ? "" : ` ${ctx.haltEvidence.note ?? ""}`}
        </p>
      ) : null}

      <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
        {candidates.map((c) => (
          <li key={c.stopId}>
            <div
              className={`rounded-lg border px-3 py-2 ${
                c.stopId === draft?.stopId
                  ? "border-[var(--brand-mid)] bg-[rgba(197,160,40,0.12)]"
                  : "border-[var(--border)]"
              }`}
            >
              <div className="flex flex-wrap items-baseline justify-between gap-2">
                <span className="text-[12px] font-semibold text-[var(--brand-deep)]">
                  {c.stopId === draft?.stopId ? "★ " : ""}
                  {c.stopName}
                  {c.isCurrent ? (
                    <span className="ml-1 text-[10px] font-normal text-[var(--muted)]">
                      (boards here now)
                    </span>
                  ) : null}
                </span>
                <span className="text-[11px] font-bold tabular-nums text-[var(--ink)]">
                  {c.walkKm} km
                  {c.walkSource === "google"
                    ? c.walkMinutes != null
                      ? ` · ${c.walkMinutes} min walk`
                      : " walk"
                    : " straight line"}
                </span>
              </div>
              <div className="text-[10px] text-[var(--muted)]">
                {c.routeLabel}
                {" · "}
                {c.seatsLeft == null
                  ? "seats not recorded"
                  : c.seatsLeft <= 0
                    ? "bus full"
                    : `${c.seatsLeft} seats`}
                {" · "}
                {c.monthlyFeePaise == null
                  ? "not priced"
                  : `${formatInr(c.monthlyFeePaise)}/month`}
                {c.siblingOnRoute ? ` · with ${c.siblingOnRoute}` : ""}
                {c.haltDays != null && c.haltDays > 0
                  ? ` · seen halting on ${c.haltDays} morning${c.haltDays === 1 ? "" : "s"}`
                  : ""}
              </div>
              {!c.isCurrent ? (
                <button
                  type="button"
                  onClick={() => use(c.stopId)}
                  className="mt-1 text-[11px] font-semibold text-[var(--brand-mid)]"
                >
                  Use this stop
                </button>
              ) : null}
            </div>
          </li>
        ))}
      </ul>

      {used ? (
        <p className="mt-2 text-[11px] font-semibold text-[var(--success)]">
          Filled in below — check the fee and the month, then apply the change.
        </p>
      ) : null}
    </div>
  );
}
