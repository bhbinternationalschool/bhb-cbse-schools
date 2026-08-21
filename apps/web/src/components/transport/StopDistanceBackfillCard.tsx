"use client";

import { useMemo, useState } from "react";
import {
  listActiveRoutes,
  setRouteStops,
  stopHasGeo,
  type TransportState,
} from "@/lib/transport";
import { fetchStopRoadDistanceKm } from "@/lib/transportPlanner";

type StopRef = {
  routeId: string;
  routeLabel: string;
  stopId: string;
  stopName: string;
};

/**
 * Backfill road distances for stops that already exist.
 *
 * Only pinned stops are measured. A bare stop name like "Lanka" would send
 * Distance Matrix off to geocode a guess, and a wrong guess here becomes a
 * wrong monthly bill for every family at that stop — so unpinned stops are
 * listed for a human to place on the map instead of being measured blind.
 */
export function StopDistanceBackfillCard({
  state,
  onRefresh,
  onFlash,
  onError,
}: {
  state: TransportState;
  onRefresh: () => void;
  onFlash: (m: string) => void;
  onError: (m: string) => void;
}) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState<string | null>(null);
  const [failures, setFailures] = useState<string[]>([]);

  const { measured, needsMeasuring, needsPinning } = useMemo(() => {
    const done: StopRef[] = [];
    const measurable: StopRef[] = [];
    const unpinned: StopRef[] = [];
    for (const route of listActiveRoutes(state)) {
      const routeLabel = route.busNo || route.code;
      for (const stop of route.stops) {
        const ref: StopRef = {
          routeId: route.id,
          routeLabel,
          stopId: stop.id,
          stopName: stop.name,
        };
        if (stop.distanceSource === "google") done.push(ref);
        else if (stopHasGeo(stop)) measurable.push(ref);
        else unpinned.push(ref);
      }
    }
    return {
      measured: done,
      needsMeasuring: measurable,
      needsPinning: unpinned,
    };
  }, [state]);

  const total = measured.length + needsMeasuring.length + needsPinning.length;
  if (total === 0) return null;

  async function measureAll() {
    setRunning(true);
    setFailures([]);
    const failed: string[] = [];
    let ok = 0;

    // Group by route: setRouteStops rewrites a whole route's stop list, so
    // measuring stop-by-stop across routes would clobber earlier writes.
    const byRoute = new Map<string, StopRef[]>();
    for (const ref of needsMeasuring) {
      const list = byRoute.get(ref.routeId);
      if (list) list.push(ref);
      else byRoute.set(ref.routeId, [ref]);
    }

    let done = 0;
    for (const [routeId, refs] of byRoute) {
      const route = state.routes.find((r) => r.id === routeId);
      if (!route) continue;
      const kmByStop = new Map<string, number>();

      for (const ref of refs) {
        const stop = route.stops.find((s) => s.id === ref.stopId);
        if (!stop) continue;
        done += 1;
        setProgress(`Measuring ${done}/${needsMeasuring.length} — ${ref.stopName}`);
        const res = await fetchStopRoadDistanceKm({
          placeId: stop.placeId,
          lat: stop.geoLat,
          lng: stop.geoLng,
          address: stop.geoAddress || stop.name,
        });
        if (res.ok) {
          kmByStop.set(stop.id, res.km);
          ok += 1;
        } else {
          failed.push(`${ref.routeLabel} · ${ref.stopName}: ${res.error}`);
        }
      }

      if (kmByStop.size === 0) continue;
      const next = route.stops.map((s) => {
        const km = kmByStop.get(s.id);
        return km == null
          ? s
          : { ...s, distanceKm: km, distanceSource: "google" as const };
      });
      const write = setRouteStops(routeId, next);
      if (!write.ok) failed.push(`${route.code}: ${write.error}`);
    }

    setProgress(null);
    setRunning(false);
    setFailures(failed);
    onRefresh();
    if (ok > 0) {
      onFlash(
        `Measured ${ok} stop${ok === 1 ? "" : "s"} by road${
          failed.length ? ` · ${failed.length} could not be measured` : ""
        }`,
      );
    } else if (failed.length) {
      onError("No stop could be measured — see the list below");
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-4">
      <h2 className="text-sm font-bold text-[var(--brand-deep)]">
        Stop distances
      </h2>
      <p className="mt-0.5 text-[11px] text-[var(--muted)]">
        What every rider at a stop is billed on, when the route charges by
        distance.
      </p>

      <dl className="mt-3 grid grid-cols-3 gap-2 text-center">
        <Stat label="By road" value={measured.length} tone="good" />
        <Stat label="Pinned, unmeasured" value={needsMeasuring.length} tone="warn" />
        <Stat label="Not pinned" value={needsPinning.length} tone="bad" />
      </dl>

      {needsMeasuring.length > 0 ? (
        <button
          type="button"
          className="mt-3 rounded-lg bg-[var(--primary)] px-3 py-2 text-sm font-bold text-[var(--primary-foreground)] disabled:opacity-60"
          onClick={measureAll}
          disabled={running}
        >
          {running
            ? "Measuring…"
            : `Measure ${needsMeasuring.length} pinned stop${
                needsMeasuring.length === 1 ? "" : "s"
              }`}
        </button>
      ) : null}
      {progress ? (
        <p className="mt-2 text-[11px] text-[var(--muted)]">{progress}</p>
      ) : null}

      {needsPinning.length > 0 ? (
        <div className="mt-3">
          <p className="text-[11px] font-semibold text-[var(--danger)]">
            Pin these on the map before they can be measured
          </p>
          <p className="mt-1 text-[11px] text-[var(--muted)]">
            Open the route above and pick each stop from the Google search — a
            name on its own is not enough to measure a distance you can bill on.
          </p>
          <ul className="mt-1 max-h-32 space-y-0.5 overflow-y-auto text-[11px] text-[var(--muted)]">
            {needsPinning.map((s) => (
              <li key={`${s.routeId}:${s.stopId}`}>
                {s.routeLabel} · {s.stopName}
              </li>
            ))}
          </ul>
        </div>
      ) : null}

      {failures.length > 0 ? (
        <ul className="mt-3 max-h-32 space-y-0.5 overflow-y-auto text-[11px] text-[var(--danger)]">
          {failures.map((f) => (
            <li key={f}>{f}</li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

function Stat({
  label,
  value,
  tone,
}: {
  label: string;
  value: number;
  tone: "good" | "warn" | "bad";
}) {
  const color =
    tone === "good"
      ? "text-[var(--success)]"
      : tone === "warn"
        ? "text-[var(--brand-mid)]"
        : "text-[var(--danger)]";
  return (
    <div className="rounded-lg bg-[var(--surface-sunken)] px-2 py-2">
      <dd className={`text-lg font-bold tabular-nums ${color}`}>{value}</dd>
      <dt className="text-[10px] leading-tight text-[var(--muted)]">{label}</dt>
    </div>
  );
}
