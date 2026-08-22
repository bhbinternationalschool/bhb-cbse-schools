"use client";

import { useEffect, useRef, useState } from "react";
import type { PlacePrediction, ResolvedPlaceAddress } from "@/lib/mapsPlaces";
import { fetchStopRoadDistanceKm } from "@/lib/transportPlanner";
import type { StopDistanceSource } from "@/lib/transport";

export type StopDraft = {
  key: string;
  name: string;
  distanceKm: number;
  distanceSource: StopDistanceSource;
  /** This stop's own monthly fee, in paise. 0 = not priced yet, not free. */
  monthlyFeePaise?: number;
  geoLat?: number;
  geoLng?: number;
  placeId?: string;
  geoAddress?: string;
};

export function newStopDraft(): StopDraft {
  return {
    key: `sd_${Math.random().toString(36).slice(2, 9)}`,
    name: "",
    distanceKm: 0,
    distanceSource: "",
  };
}

/**
 * Per-stop editor with Google Places lookup and road distance from campus.
 *
 * Stops used to be a textarea of `Name:km` lines, so the distance every family
 * at that stop is billed on was whatever somebody typed. Picking the stop from
 * Places pins it, and the kilometres come from Distance Matrix by road —
 * straight-line badly under-reads around Varanasi, where the river and the rail
 * lines force long detours.
 *
 * A distance is only ever written from Google or from a person; when Google
 * cannot answer, the row says so and stays blank rather than guessing.
 */
export function StopRowsEditor({
  rows,
  onChange,
  showDistance,
  bands,
}: {
  rows: StopDraft[];
  onChange: (next: StopDraft[]) => void;
  /** Distances only bill under per-km / slab policies; still shown, but calmer. */
  showDistance: boolean;
  /**
   * Stop-priced bands, when the policy uses them. A stop inside a band needs
   * its own fee; a stop past the last band is priced by distance instead.
   */
  bands?: { upToKm: number; minPaise: number; maxPaise: number }[];
}) {
  function patch(key: string, next: Partial<StopDraft>) {
    onChange(rows.map((r) => (r.key === key ? { ...r, ...next } : r)));
  }

  return (
    <div className="space-y-2">
      {rows.length === 0 ? (
        <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-3 text-xs text-[var(--muted)]">
          No stops yet. Add the first boarding point.
        </p>
      ) : null}

      {rows.map((row, i) => (
        <StopRow
          key={row.key}
          row={row}
          index={i}
          showDistance={showDistance}
          bands={bands}
          onPatch={(next) => patch(row.key, next)}
          onRemove={() => onChange(rows.filter((r) => r.key !== row.key))}
          onMove={(dir) => {
            const to = i + dir;
            if (to < 0 || to >= rows.length) return;
            const next = [...rows];
            [next[i], next[to]] = [next[to], next[i]];
            onChange(next);
          }}
        />
      ))}

      <div className="flex flex-wrap items-center gap-2">
        <button
          type="button"
          className="rounded-lg border border-dashed border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-mid)]"
          onClick={() => onChange([...rows, newStopDraft()])}
        >
          + Add stop
        </button>
        <SuggestOrderButton rows={rows} onChange={onChange} />
      </div>
    </div>
  );
}

/**
 * Ask Google Directions for the best driving order of the pinned stops.
 *
 * The suggestion is shown before anything moves. A route order is a decision
 * about children waiting at the roadside — the fastest loop is not always the
 * right one, and the person who knows the road decides.
 */
function SuggestOrderButton({
  rows,
  onChange,
}: {
  rows: StopDraft[];
  onChange: (next: StopDraft[]) => void;
}) {
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  const [proposal, setProposal] = useState<{
    order: StopDraft[];
    totalKm: number;
    totalMinutes: number;
  } | null>(null);

  const pinned = rows.filter(
    (r) => r.name.trim() && r.geoLat != null && r.geoLng != null,
  );
  const unpinnedCount = rows.filter((r) => r.name.trim()).length - pinned.length;

  async function suggest() {
    setBusy(true);
    setNote(null);
    setProposal(null);
    try {
      const res = await fetch("/api/maps/optimize-stops", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          stops: pinned.map((r) => ({
            id: r.key,
            name: r.name,
            lat: r.geoLat,
            lng: r.geoLng,
          })),
        }),
      });
      const data = (await res.json()) as {
        ok?: boolean;
        error?: string;
        orderedStopIds?: string[];
        totalKm?: number;
        totalMinutes?: number;
      };
      if (!data.ok || !data.orderedStopIds) {
        setNote(data.error || "Could not work out an order");
        return;
      }
      const byKey = new Map(rows.map((r) => [r.key, r]));
      const reordered = data.orderedStopIds
        .map((k) => byKey.get(k))
        .filter((r): r is StopDraft => !!r);
      // Unpinned stops keep their existing places at the end rather than being
      // dropped — they were never part of the calculation.
      const rest = rows.filter((r) => !data.orderedStopIds!.includes(r.key));
      setProposal({
        order: [...reordered, ...rest],
        totalKm: data.totalKm ?? 0,
        totalMinutes: data.totalMinutes ?? 0,
      });
    } catch {
      setNote("Could not reach the Directions service");
    } finally {
      setBusy(false);
    }
  }

  if (proposal) {
    return (
      <div className="w-full rounded-lg border border-[color-mix(in_srgb,var(--success)_35%,transparent)] bg-[var(--success-soft)] px-3 py-2">
        <p className="text-[11px] font-bold text-[var(--success)]">
          Suggested pickup order — {proposal.totalKm} km round trip, about{" "}
          {proposal.totalMinutes} min driving
        </p>
        <ol className="mt-1 list-decimal pl-5 text-[11px] text-[var(--ink)]">
          {proposal.order
            .filter((r) => r.name.trim())
            .map((r) => (
              <li key={r.key}>{r.name}</li>
            ))}
        </ol>
        <p className="mt-1 text-[10px] text-[var(--muted)]">
          Google’s fastest loop from campus and back. It does not know about
          school timings, safe crossings, or which side of the road a child
          waits on — check it before applying.
        </p>
        <div className="mt-2 flex gap-2">
          <button
            type="button"
            className="rounded-lg bg-[var(--primary)] px-3 py-1 text-xs font-bold text-[var(--primary-foreground)]"
            onClick={() => {
              onChange(proposal.order);
              setProposal(null);
            }}
          >
            Apply this order
          </button>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1 text-xs font-semibold"
            onClick={() => setProposal(null)}
          >
            Keep current order
          </button>
        </div>
      </div>
    );
  }

  return (
    <>
      <button
        type="button"
        className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-mid)] disabled:opacity-40"
        onClick={suggest}
        disabled={busy || pinned.length < 3}
        title={
          pinned.length < 3
            ? "Pin at least three stops on the map first"
            : "Ask Google for the best driving order"
        }
      >
        {busy ? "Working out the order…" : "Suggest order"}
      </button>
      {unpinnedCount > 0 ? (
        <span className="text-[10px] text-[var(--muted)]">
          {unpinnedCount} unpinned stop{unpinnedCount === 1 ? "" : "s"} left out
          of the calculation
        </span>
      ) : null}
      {note ? (
        <span className="text-[10px] font-semibold text-[var(--danger)]">
          {note}
        </span>
      ) : null}
    </>
  );
}

function StopRow({
  row,
  index,
  showDistance,
  bands,
  onPatch,
  onRemove,
  onMove,
}: {
  row: StopDraft;
  index: number;
  showDistance: boolean;
  bands?: { upToKm: number; minPaise: number; maxPaise: number }[];
  onPatch: (next: Partial<StopDraft>) => void;
  onRemove: () => void;
  onMove: (dir: -1 | 1) => void;
}) {
  const [predictions, setPredictions] = useState<PlacePrediction[]>([]);
  const [openList, setOpenList] = useState(false);
  const [busy, setBusy] = useState(false);
  const [note, setNote] = useState<string | null>(null);
  // One Places session token per stop keeps autocomplete + details billed as a
  // single lookup rather than one charge per keystroke.
  const sessionRef = useRef(`st_${Math.random().toString(36).slice(2, 12)}`);

  useEffect(() => {
    const term = row.name.trim();
    if (!openList || term.length < 3) {
      setPredictions([]);
      return;
    }
    let cancelled = false;
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/maps/places-autocomplete?input=${encodeURIComponent(
            term,
          )}&session=${sessionRef.current}`,
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
  }, [row.name, openList]);

  async function pickPlace(p: PlacePrediction) {
    setOpenList(false);
    setPredictions([]);
    setBusy(true);
    setNote(null);
    try {
      const res = await fetch(
        `/api/maps/place-details?placeId=${encodeURIComponent(
          p.placeId,
        )}&session=${sessionRef.current}`,
      );
      const data = (await res.json()) as {
        ok?: boolean;
        place?: ResolvedPlaceAddress;
        error?: string;
      };
      if (!data.ok || !data.place) {
        setNote(data.error || "Could not resolve that place");
        return;
      }
      const place = data.place;
      const base: Partial<StopDraft> = {
        name: p.mainText || place.address || row.name,
        geoLat: place.lat,
        geoLng: place.lng,
        placeId: place.placeId,
        geoAddress: place.formattedAddress,
      };

      const dist = await fetchStopRoadDistanceKm({
        placeId: place.placeId,
        lat: place.lat,
        lng: place.lng,
        address: place.formattedAddress,
      });
      if (dist.ok) {
        onPatch({ ...base, distanceKm: dist.km, distanceSource: "google" });
        setNote(null);
      } else {
        // Pinned, but not measured. Keep the pin, leave the distance alone and
        // say why — an unmeasured stop must not silently bill as 0 km.
        onPatch(base);
        setNote(`${dist.error} — enter the distance by hand`);
      }
    } finally {
      setBusy(false);
    }
  }

  async function remeasure() {
    setBusy(true);
    setNote(null);
    const dist = await fetchStopRoadDistanceKm({
      placeId: row.placeId,
      lat: row.geoLat,
      lng: row.geoLng,
      address: row.geoAddress || row.name,
    });
    if (dist.ok) onPatch({ distanceKm: dist.km, distanceSource: "google" });
    else setNote(dist.error);
    setBusy(false);
  }

  // Which band this stop falls in decides whether it needs its own price.
  // Past the last band, distance decides and no price field is shown.
  const sorted = [...(bands ?? [])].sort((a, b) => a.upToKm - b.upToKm);
  const band =
    row.distanceKm > 0 ? sorted.find((b) => row.distanceKm <= b.upToKm) : undefined;
  const priceOutsideBand =
    !!band &&
    !!row.monthlyFeePaise &&
    (row.monthlyFeePaise < band.minPaise || row.monthlyFeePaise > band.maxPaise);

  const sourceLabel =
    row.distanceSource === "google"
      ? "by road (Google)"
      : row.distanceSource === "manual"
        ? "typed"
        : "not set";

  return (
    <div className="rounded-lg border border-[var(--border)] bg-[var(--card)] p-2">
      <div className="flex flex-wrap items-start gap-2">
        <span className="mt-2 w-5 shrink-0 text-center text-[11px] font-bold tabular-nums text-[var(--muted)]">
          {index + 1}
        </span>

        <div className="relative min-w-[10rem] flex-1">
          <input
            className="field !py-1.5"
            value={row.name}
            placeholder="Stop name — type to search Google"
            onChange={(e) => {
              // Editing the name after pinning invalidates the pin: the clerk
              // may now mean a different place entirely.
              onPatch({
                name: e.target.value,
                ...(row.placeId
                  ? { placeId: undefined, geoLat: undefined, geoLng: undefined, geoAddress: undefined }
                  : {}),
              });
              setOpenList(true);
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

        {band ? (
          <label className="flex items-center gap-1">
            <span className="text-[11px] text-[var(--muted)]">₹</span>
            <input
              className="field !w-24 !py-1.5 text-right tabular-nums"
              inputMode="decimal"
              value={row.monthlyFeePaise ? Math.round(row.monthlyFeePaise / 100) : ""}
              placeholder={`${Math.round(band.minPaise / 100)}–${Math.round(band.maxPaise / 100)}`}
              title={`Stops up to ${band.upToKm} km carry their own fee`}
              onChange={(e) => {
                const rupees = Number(e.target.value);
                onPatch({
                  monthlyFeePaise:
                    Number.isFinite(rupees) && rupees > 0
                      ? Math.round(rupees * 100)
                      : undefined,
                });
              }}
            />
          </label>
        ) : null}

        {showDistance ? (
          <label className="flex items-center gap-1">
            <input
              className="field !w-20 !py-1.5 text-right tabular-nums"
              inputMode="decimal"
              value={row.distanceKm || ""}
              placeholder="km"
              onChange={(e) => {
                const km = Number(e.target.value);
                onPatch({
                  distanceKm: Number.isFinite(km) && km > 0 ? km : 0,
                  distanceSource: Number.isFinite(km) && km > 0 ? "manual" : "",
                });
              }}
            />
            <span className="text-[11px] text-[var(--muted)]">km</span>
          </label>
        ) : null}

        <div className="flex items-center gap-1">
          <IconBtn label="Move up" onClick={() => onMove(-1)}>
            ↑
          </IconBtn>
          <IconBtn label="Move down" onClick={() => onMove(1)}>
            ↓
          </IconBtn>
          <IconBtn label="Remove stop" onClick={onRemove}>
            ✕
          </IconBtn>
        </div>
      </div>

      <div className="mt-1 flex flex-wrap items-center gap-x-3 gap-y-1 pl-7 text-[10px]">
        <span
          className={
            row.distanceSource === "google"
              ? "font-semibold text-[var(--success)]"
              : row.distanceSource === "manual"
                ? "text-[var(--muted)]"
                : "font-semibold text-[var(--danger)]"
          }
        >
          Distance {sourceLabel}
        </span>
        {row.geoAddress ? (
          <span className="truncate text-[var(--muted)]">📍 {row.geoAddress}</span>
        ) : (
          <span className="text-[var(--muted)]">Not pinned</span>
        )}
        {row.geoLat != null || row.geoAddress ? (
          <button
            type="button"
            className="font-semibold text-[var(--brand-mid)] underline disabled:opacity-50"
            onClick={remeasure}
            disabled={busy}
          >
            {busy ? "Measuring…" : "Re-measure"}
          </button>
        ) : null}
        {band && !row.monthlyFeePaise ? (
          <span className="font-semibold text-[var(--danger)]">
            Needs a stop fee (₹{Math.round(band.minPaise / 100)}–
            {Math.round(band.maxPaise / 100)})
          </span>
        ) : null}
        {priceOutsideBand && band ? (
          <span className="font-semibold text-[var(--brand-mid)]">
            Outside the ₹{Math.round(band.minPaise / 100)}–
            {Math.round(band.maxPaise / 100)} band
          </span>
        ) : null}
        {!band && row.distanceKm > 0 && sorted.length > 0 ? (
          <span className="text-[var(--muted)]">Priced by distance</span>
        ) : null}
        {note ? <span className="text-[var(--danger)]">{note}</span> : null}
      </div>
    </div>
  );
}

function IconBtn({
  label,
  onClick,
  children,
}: {
  label: string;
  onClick: () => void;
  children: React.ReactNode;
}) {
  return (
    <button
      type="button"
      title={label}
      aria-label={label}
      onClick={onClick}
      className="h-7 w-7 rounded-md border border-[var(--border)] text-xs text-[var(--muted)] hover:bg-[var(--surface-sunken)]"
    >
      {children}
    </button>
  );
}
