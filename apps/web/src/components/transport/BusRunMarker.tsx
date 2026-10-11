"use client";

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import {
  STATUS_LABEL,
  type RegisterStatus,
  type RegisterTrip,
  type RunCounts,
  type RunRider,
  type StoredRegisterStatus,
} from "@/lib/transportBoardingLog";
import {
  clientId,
  RegisterCallError,
  registerGet,
  registerPost,
  regBtnOutline,
  timeIst,
} from "@/lib/transportRegisterClient";

type Rider = RunRider & { status: RegisterStatus | null; tappedAt: string | null; markedByName: string };

type RunView = {
  date: string;
  today: string;
  editable: boolean;
  route: { id: string; name: string; busNo: string; vehicleId: string; vehicleName: string };
  run: { shiftId: string; name: string; departTime: string; trip: RegisterTrip };
  runs: { shiftId: string; name: string; departTime: string }[];
  statuses: RegisterStatus[];
  classesKnown: boolean;
  riders: Rider[];
  counts: RunCounts;
};

/** A tap the server has not confirmed yet. Lives in page memory only. */
type Pending = {
  status: StoredRegisterStatus;
  tappedAt: string;
  clientRef: string;
  state: "saving" | "failed";
  /** False for a refusal (not on this route, not your bus) — retrying won't help. */
  retryable: boolean;
  error?: string;
};

const STATUS_TONE: Record<RegisterStatus, { on: string; off: string }> = {
  boarded: {
    on: "border-[var(--success)] bg-[var(--success)] text-[var(--primary-foreground)]",
    off: "border-[var(--border)] bg-[var(--card)] text-[var(--success)]",
  },
  dropped: {
    on: "border-[var(--info)] bg-[var(--info)] text-[var(--primary-foreground)]",
    off: "border-[var(--border)] bg-[var(--card)] text-[var(--info)]",
  },
  not_boarded: {
    on: "border-[var(--danger)] bg-[var(--danger)] text-[var(--primary-foreground)]",
    off: "border-[var(--border)] bg-[var(--card)] text-[var(--danger)]",
  },
};

const RETRY_MS = 6000;

/**
 * The attendant's list for one run: children in the order the bus reaches
 * them, one tap per child. Each tap is its own request, so a weak signal
 * loses only the tap in flight — it shows "not saved" and is retried every
 * few seconds while the page is open. Tapping the lit button again undoes
 * the mark (saved as an undo, so a late retry of the old tap cannot win).
 */
export function BusRunMarker({
  date,
  routeId,
  trip,
  shiftId,
  onBack,
}: {
  date: string;
  routeId: string;
  trip: RegisterTrip;
  shiftId: string;
  onBack: () => void;
}) {
  const [currentShift, setCurrentShift] = useState(shiftId);
  const [view, setView] = useState<RunView | null>(null);
  const [loadError, setLoadError] = useState("");
  const [pending, setPending] = useState<Record<string, Pending>>({});
  const [onlyUnmarked, setOnlyUnmarked] = useState(false);
  const [note, setNote] = useState("");
  const inFlight = useRef(new Set<string>());

  const load = useCallback(async () => {
    setLoadError("");
    try {
      const q = new URLSearchParams({ date, routeId, trip, shiftId: currentShift });
      setView(await registerGet<RunView>(`/api/v1/transport/register/run?${q}`));
    } catch (e) {
      setView(null);
      setLoadError(e instanceof Error ? e.message : "Could not load the list");
    }
  }, [date, routeId, trip, currentShift]);

  useEffect(() => {
    void load();
  }, [load]);

  const send = useCallback(
    async (studentId: string, p: Pending) => {
      if (inFlight.current.has(p.clientRef)) return;
      inFlight.current.add(p.clientRef);
      setPending((prev) =>
        prev[studentId]?.clientRef === p.clientRef ? { ...prev, [studentId]: { ...p, state: "saving" } } : prev,
      );
      try {
        const r = await registerPost<{
          applied: boolean;
          status: RegisterStatus | null;
          tappedAt: string;
          markedByName: string;
        }>("/api/v1/transport/register/mark", {
          date,
          routeId,
          trip,
          shiftId: currentShift,
          studentId,
          status: p.status,
          tappedAt: p.tappedAt,
          clientRef: p.clientRef,
        });
        setPending((prev) => {
          if (prev[studentId]?.clientRef !== p.clientRef) return prev; // a newer tap is queued
          const next = { ...prev };
          delete next[studentId];
          return next;
        });
        setView((v) =>
          v
            ? {
                ...v,
                riders: v.riders.map((x) =>
                  x.studentId === studentId
                    ? { ...x, status: r.status, tappedAt: r.status ? r.tappedAt : null, markedByName: r.status ? r.markedByName : "" }
                    : x,
                ),
              }
            : v,
        );
        if (!r.applied) setNote("A newer mark from another phone was already saved for one child — showing that one.");
      } catch (e) {
        const status = e instanceof RegisterCallError ? e.status : 0;
        // 4xx other than timeout / rate-limit is a refusal: retrying the same tap won't change the answer.
        const retryable = status === 0 || status >= 500 || status === 408 || status === 429;
        setPending((prev) =>
          prev[studentId]?.clientRef === p.clientRef
            ? {
                ...prev,
                [studentId]: { ...p, state: "failed", retryable, error: e instanceof Error ? e.message : "Not saved" },
              }
            : prev,
        );
      } finally {
        inFlight.current.delete(p.clientRef);
      }
    },
    [date, routeId, trip, currentShift],
  );

  // Retry unsaved taps while the page is open.
  useEffect(() => {
    const t = setInterval(() => {
      for (const [studentId, p] of Object.entries(pending)) {
        if (p.state === "failed" && p.retryable) void send(studentId, p);
      }
    }, RETRY_MS);
    return () => clearInterval(t);
  }, [pending, send]);

  // Warn before leaving with taps not yet saved — they live in this page only.
  const unsaved = Object.keys(pending).length;
  useEffect(() => {
    if (!unsaved) return;
    const h = (e: BeforeUnloadEvent) => {
      e.preventDefault();
      e.returnValue = "";
    };
    window.addEventListener("beforeunload", h);
    return () => window.removeEventListener("beforeunload", h);
  }, [unsaved]);

  const shown = useCallback(
    (r: Rider): RegisterStatus | null => {
      const p = pending[r.studentId];
      if (p) return p.status === "unmarked" ? null : p.status;
      return r.status;
    },
    [pending],
  );

  const tap = (r: Rider, status: RegisterStatus) => {
    if (!view?.editable) return;
    const next: StoredRegisterStatus = shown(r) === status ? "unmarked" : status;
    const p: Pending = {
      status: next,
      tappedAt: new Date().toISOString(),
      clientRef: clientId("tap"),
      state: "saving",
      retryable: true,
    };
    setPending((prev) => ({ ...prev, [r.studentId]: p }));
    void send(r.studentId, p);
  };

  const counts = useMemo(() => {
    const c = { boarded: 0, dropped: 0, notBoarded: 0, unmarked: 0 };
    for (const r of view?.riders ?? []) {
      const s = shown(r);
      if (s === "boarded") c.boarded += 1;
      else if (s === "dropped") c.dropped += 1;
      else if (s === "not_boarded") c.notBoarded += 1;
      else c.unmarked += 1;
    }
    return c;
  }, [view, shown]);

  const groups = useMemo(() => {
    const out: { key: string; label: string; riders: Rider[] }[] = [];
    for (const r of view?.riders ?? []) {
      if (onlyUnmarked && shown(r) != null) continue;
      const key = r.stopName ? r.stopId : "__nostop";
      const label = r.stopName ? `${r.stopSequence ?? ""} · ${r.stopName}` : "Stop not found — check this child's stop in Riders";
      const last = out[out.length - 1];
      if (last && last.key === key) last.riders.push(r);
      else out.push({ key, label, riders: [r] });
    }
    return out;
  }, [view, onlyUnmarked, shown]);

  const failed = Object.values(pending).filter((p) => p.state === "failed");

  return (
    <section className="space-y-3">
      <div className="flex flex-wrap items-center gap-2">
        <button type="button" className={regBtnOutline} onClick={onBack}>
          ← Runs
        </button>
        <div className="min-w-0 flex-1">
          <p className="truncate text-base font-bold text-[var(--brand-deep)]">
            {view ? `${view.route.name} · ${view.run.name}` : "Loading…"}
          </p>
          <p className="text-xs text-[var(--muted)]">
            {trip === "AM" ? "Morning pick-up" : "Afternoon drop"} · {date}
            {view?.run.departTime ? ` · leaves ${view.run.departTime}` : ""}
            {view?.route.vehicleName ? ` · ${view.route.vehicleName}` : ""}
          </p>
        </div>
      </div>

      {view && view.runs.length > 1 ? (
        <div className="flex flex-wrap gap-1.5" role="group" aria-label="Runs on this route">
          {view.runs.map((r) => (
            <button
              key={r.shiftId}
              type="button"
              onClick={() => setCurrentShift(r.shiftId)}
              className={`rounded-full border px-3 py-1 text-xs font-semibold ${
                r.shiftId === currentShift
                  ? "border-[var(--primary)] bg-[var(--primary)] text-[var(--primary-foreground)]"
                  : "border-[var(--border)] bg-[var(--card)] text-[var(--foreground)]"
              }`}
            >
              {r.name}
              {r.departTime ? ` ${r.departTime}` : ""}
            </button>
          ))}
        </div>
      ) : null}

      {loadError ? (
        <div className="rounded-xl border border-[var(--danger)] bg-[var(--danger-soft)] p-3 text-sm text-[var(--danger)]">
          Could not load this run: {loadError}{" "}
          <button type="button" className="font-semibold underline" onClick={() => void load()}>
            Try again
          </button>
        </div>
      ) : null}

      {view ? (
        <>
          <div className="sticky top-0 z-10 -mx-1 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 shadow-[var(--shadow-1)]">
            <div className="flex flex-wrap items-center gap-x-3 gap-y-1 text-sm">
              <span className="font-bold text-[var(--success)]">{counts.boarded} boarded</span>
              {trip === "PM" ? <span className="font-bold text-[var(--info)]">{counts.dropped} dropped</span> : null}
              <span className="font-bold text-[var(--danger)]">{counts.notBoarded} not boarded</span>
              <span className="text-[var(--muted)]">
                {counts.unmarked} not marked · {view.riders.length} riders
              </span>
              <label className="ml-auto flex items-center gap-1.5 text-xs text-[var(--muted)]">
                <input type="checkbox" checked={onlyUnmarked} onChange={(e) => setOnlyUnmarked(e.target.checked)} />
                Not marked only
              </label>
            </div>
            {unsaved ? (
              <p className="mt-1 text-xs font-semibold text-[var(--warning)]">
                {unsaved} tap{unsaved === 1 ? "" : "s"} saving… keep this page open until it clears.
              </p>
            ) : null}
          </div>

          {!view.editable ? (
            <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-xs text-[var(--muted)]">
              This day is closed for changes from your login — the marks are shown as saved.
            </p>
          ) : null}
          {!view.classesKnown ? (
            <p className="rounded-lg bg-[var(--warning-soft)] px-3 py-2 text-xs text-[var(--warning)]">
              The class list could not be read, so this shows every rider on the route, not just this run.
            </p>
          ) : null}
          {note ? <p className="text-xs text-[var(--muted)]">{note}</p> : null}
          {failed.some((p) => !p.retryable) ? (
            <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
              Some taps were refused: {failed.find((p) => !p.retryable)?.error}
            </p>
          ) : null}

          {view.riders.length === 0 ? (
            <p className="text-sm text-[var(--muted)]">No riders on this run today.</p>
          ) : null}

          {groups.map((g) => (
            <div key={g.key} className="space-y-2">
              <p className="pt-1 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
                {g.label} ({g.riders.length})
              </p>
              {g.riders.map((r) => {
                const s = shown(r);
                const p = pending[r.studentId];
                return (
                  <div key={r.studentId} className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
                    <div className="flex flex-wrap items-baseline gap-x-2">
                      <span className="text-[15px] font-semibold text-[var(--foreground)]">{r.fullName || r.studentId}</span>
                      <span className="text-xs text-[var(--muted)]">
                        {r.className}
                        {r.admissionNo ? ` · ${r.admissionNo}` : ""}
                      </span>
                    </div>
                    {r.shiftUnresolved ? (
                      <p className="mt-0.5 text-xs text-[var(--warning)]">Run not worked out — {r.shiftNote}</p>
                    ) : null}
                    <div className="mt-2 grid gap-2" style={{ gridTemplateColumns: `repeat(${view.statuses.length}, minmax(0, 1fr))` }}>
                      {view.statuses.map((st) => (
                        <button
                          key={st}
                          type="button"
                          disabled={!view.editable}
                          aria-pressed={s === st}
                          onClick={() => tap(r, st)}
                          className={`min-h-11 rounded-lg border-2 px-2 text-sm font-bold disabled:opacity-60 ${
                            s === st ? STATUS_TONE[st].on : STATUS_TONE[st].off
                          }`}
                        >
                          {STATUS_LABEL[st]}
                        </button>
                      ))}
                    </div>
                    <p className="mt-1 min-h-4 text-[11px] text-[var(--muted)]">
                      {p?.state === "saving" ? "Saving…" : null}
                      {p?.state === "failed" ? (
                        <span className="text-[var(--danger)]">
                          Not saved{p.retryable ? " — retrying" : ""}: {p.error}{" "}
                          {p.retryable ? (
                            <button type="button" className="font-semibold underline" onClick={() => void send(r.studentId, p)}>
                              Retry now
                            </button>
                          ) : null}
                        </span>
                      ) : null}
                      {!p && r.status && r.tappedAt
                        ? `Saved ${timeIst(r.tappedAt)}${r.markedByName ? ` · ${r.markedByName}` : ""}`
                        : null}
                    </p>
                  </div>
                );
              })}
            </div>
          ))}
        </>
      ) : null}
    </section>
  );
}
