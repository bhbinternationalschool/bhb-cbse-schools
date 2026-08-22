"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import { formatInr } from "@/lib/fees";
import type { PlacePrediction, ResolvedPlaceAddress } from "@/lib/mapsPlaces";
import { rankStopsNearPoint, type RankedStop } from "@/lib/transportPlanner";
import type { TransportState } from "@/lib/transport";

/**
 * Choose a stop by how near it is, not by hunting through route dropdowns.
 *
 * Two ways in. If the child's household has been geocoded, every mapped stop
 * across every active route is listed nearest-to-their-home first. Otherwise —
 * or whenever the clerk prefers — typing a village or locality re-ranks the
 * same list around that place instead.
 *
 * Stops with no coordinates are listed apart and cannot be picked from here.
 * An unpinned stop is not "far away"; its distance is unknown, and showing it
 * anywhere in a distance-ordered list would state something untrue. The route
 * dropdowns remain for those until somebody pins them.
 */
export function NearestStopPicker({
  state,
  home,
  selectedStopId,
  onPick,
}: {
  state: TransportState;
  /** The child's household coordinates, when the school has them. */
  home: { lat: number; lng: number } | null;
  selectedStopId: string;
  onPick: (choice: { routeId: string; stopId: string }) => void;
}) {
  const [term, setTerm] = useState("");
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [openList, setOpenList] = useState(false);
  const [origin, setOrigin] = useState<
    { lat: number; lng: number; label: string } | null
  >(null);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const sessionRef = useRef(`np_${Math.random().toString(36).slice(2, 12)}`);

  const point = origin ?? (home ? { ...home, label: "the child's home" } : null);

  const { ranked, unpinned } = useMemo(() => {
    if (!point) return { ranked: [] as RankedStop[], unpinned: [] };
    return rankStopsNearPoint(state, point, { limit: 12 });
  }, [state, point]);

  useEffect(() => {
    const q = term.trim();
    if (!openList || q.length < 3) {
      setPredictions([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/maps/places-autocomplete?input=${encodeURIComponent(q)}&session=${sessionRef.current}`,
        );
        const data = (await res.json()) as { predictions?: PlacePrediction[] };
        if (!cancelled) setPredictions(data.predictions ?? []);
      } catch {
        if (!cancelled) setPredictions([]);
      }
    }, 350);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [term, openList]);

  async function pickPlace(p: PlacePrediction) {
    setOpenList(false);
    setPredictions([]);
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(
        `/api/maps/place-details?placeId=${encodeURIComponent(p.placeId)}&session=${sessionRef.current}`,
      );
      const data = (await res.json()) as {
        ok?: boolean;
        place?: ResolvedPlaceAddress;
        error?: string;
      };
      if (!data.ok || !data.place) {
        setNote(data.error || "Could not locate that place");
        return;
      }
      setOrigin({
        lat: data.place.lat,
        lng: data.place.lng,
        label: p.mainText || data.place.address || p.description,
      });
      setTerm(p.mainText || p.description);
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="rounded-xl border border-[var(--border)] bg-[var(--card)] p-3">
      <div className="flex flex-wrap items-baseline justify-between gap-2">
        <h3 className="text-[12px] font-bold text-[var(--brand-deep)]">
          Nearest stops
        </h3>
        {point ? (
          <span className="text-[10px] text-[var(--muted)]">
            measured from {origin ? origin.label : "the child’s home"}
          </span>
        ) : null}
      </div>

      <div className="relative mt-2">
        <input
          className="field !py-1.5"
          value={term}
          placeholder="Search a village or locality to rank from there…"
          onChange={(e) => {
            setTerm(e.target.value);
            setOpenList(true);
            if (!e.target.value.trim()) setOrigin(null);
          }}
          onFocus={() => setOpenList(true)}
          onBlur={() => window.setTimeout(() => setOpenList(false), 180)}
        />
        {openList && predictions.length > 0 ? (
          <ul className="absolute z-20 mt-1 max-h-52 w-full overflow-y-auto rounded-lg border border-[var(--border)] bg-[var(--card)] shadow-xl">
            {predictions.map((p) => (
              <li key={p.placeId}>
                <button
                  type="button"
                  className="w-full px-3 py-2 text-left hover:bg-[rgba(197,160,40,0.1)]"
                  onMouseDown={(e) => e.preventDefault()}
                  onClick={() => pickPlace(p)}
                >
                  <div className="text-xs font-semibold text-[var(--brand-deep)]">
                    {p.mainText}
                  </div>
                  <div className="text-[10px] text-[var(--muted)]">
                    {p.secondaryText}
                  </div>
                </button>
              </li>
            ))}
          </ul>
        ) : null}
      </div>

      {busy ? (
        <p className="mt-2 text-[11px] text-[var(--muted)]">Locating…</p>
      ) : null}
      {note ? (
        <p className="mt-2 text-[11px] font-semibold text-[var(--danger)]">
          {note}
        </p>
      ) : null}

      {!point ? (
        <p className="mt-2 rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-[11px] text-[var(--muted)]">
          This family’s address has not been placed on the map, so stops cannot
          be ranked by distance. Search a village or locality above, or pick the
          route and stop by hand below.
        </p>
      ) : ranked.length === 0 ? (
        <p className="mt-2 rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-[11px] text-[var(--muted)]">
          No stop has been pinned on the map yet. Pin them in Routes and they
          will appear here nearest first.
        </p>
      ) : (
        <ul className="mt-2 max-h-64 space-y-1 overflow-y-auto">
          {ranked.map((r, i) => {
            const chosen = r.stopId === selectedStopId;
            return (
              <li key={`${r.routeId}:${r.stopId}`}>
                <button
                  type="button"
                  onClick={() => onPick({ routeId: r.routeId, stopId: r.stopId })}
                  className={`w-full rounded-lg border px-3 py-2 text-left ${
                    chosen
                      ? "border-[var(--brand-mid)] bg-[rgba(197,160,40,0.12)]"
                      : "border-[var(--border)] hover:bg-[var(--surface-sunken)]"
                  }`}
                >
                  <div className="flex flex-wrap items-baseline justify-between gap-2">
                    <span className="text-[12px] font-semibold text-[var(--brand-deep)]">
                      {i === 0 ? "★ " : ""}
                      {r.stopName}
                    </span>
                    <span className="text-[11px] font-bold tabular-nums text-[var(--ink)]">
                      {r.fromPointKm} km away
                    </span>
                  </div>
                  <div className="text-[10px] text-[var(--muted)]">
                    {r.routeLabel} · {r.routeCode}
                    {r.distanceFromSchoolKm > 0
                      ? ` · ${r.distanceFromSchoolKm} km from school`
                      : " · school distance not measured"}
                    {r.monthlyFeePaise > 0
                      ? ` · ${formatInr(r.monthlyFeePaise)}/month`
                      : " · not priced"}
                    {r.seatsLeft <= 0 ? " · bus full" : ` · ${r.seatsLeft} seats`}
                  </div>
                </button>
              </li>
            );
          })}
        </ul>
      )}

      {unpinned.length > 0 ? (
        <p className="mt-2 text-[10px] text-[var(--muted)]">
          {unpinned.length} stop{unpinned.length === 1 ? "" : "s"} not pinned on
          the map ({unpinned.slice(0, 4).map((u) => u.stopName).join(", ")}
          {unpinned.length > 4 ? "…" : ""}) — these cannot be ranked by
          distance. Pin them in Routes, or pick them by hand below.
        </p>
      ) : null}
    </div>
  );
}
