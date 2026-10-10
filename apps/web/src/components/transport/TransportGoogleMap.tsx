"use client";

import { useEffect, useMemo, useRef, useState } from "react";
import type { MastersState } from "@/lib/masters";
import { loadGoogleMaps } from "@/lib/googleMapsLoader";
import type { SisState } from "@/lib/sis";
import {
  buildTransportMapMarkers,
  DEFAULT_MAP_LAYERS,
  fitMapBounds,
  type TransportMapLayers,
  type TransportMapMarker,
} from "@/lib/transportMapMarkers";
import type { TransportState } from "@/lib/transport";
import {
  ANIMATE_MS,
  BUS_ICON_PATH,
  BUS_STOPPED_PATH,
  appliedRotation,
  decideAnimation,
  easeInOut,
  interpolate,
  liveBusStyle,
  type LiveBusPositionInput,
} from "@/lib/liveBusMarker";

const MARKER_COLORS: Record<TransportMapMarker["kind"], string> = {
  school: "#C5A028",
  stop: "#203050",
  unassigned: "#ea580c",
  rider: "#15803d",
  bus: "#2563eb",
};

type GMap = {
  fitBounds: (b: unknown) => void;
  setCenter: (c: { lat: number; lng: number }) => void;
  setZoom: (z: number) => void;
};

type GMarker = {
  setMap: (m: unknown) => void;
  setPosition?: (p: { lat: number; lng: number }) => void;
  setIcon?: (i: unknown) => void;
  setTitle?: (t: string) => void;
};

/**
 * One vehicle on the live feed. `courseDeg`, `speedKmh` and `freshness` come
 * straight from Fleet Edge via /api/transport/live and decide the icon — see
 * lib/liveBusMarker.ts for what each is allowed to imply.
 */
export type LiveVehicleMarker = LiveBusPositionInput & {
  id: string;
  label: string;
  /** Shown under the label: "2 min ago", "Moving · 34 km/h". */
  detail: string;
  /** The fix's own timestamp, so a re-delivered ping is not re-animated. */
  at: string;
};

/** What a marker is currently showing, so the next fix knows where to start. */
type LiveMarkerState = {
  marker: GMarker;
  lat: number;
  lng: number;
  rotation: number;
  at: string;
  raf: number | null;
};

type Props = {
  transport: TransportState;
  sis: SisState | null;
  masters: MastersState | null;
  academicYearCode?: string;
  layers: TransportMapLayers;
  /**
   * Vehicles from the Fleet Edge feed, re-polled by the caller.
   *
   * Kept out of `markers` on purpose. Everything in `markers` is destroyed
   * and rebuilt whenever it changes, which is why the map has never shown a
   * bus travel — it vanished and reappeared every thirty seconds. These are
   * held in their own map, keyed by vehicle, and updated in place.
   */
  liveVehicles?: LiveVehicleMarker[];
  className?: string;
};

export function TransportGoogleMap({
  transport,
  sis,
  masters,
  academicYearCode,
  layers,
  liveVehicles,
  className = "",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GMap | null>(null);
  const markersRef = useRef<GMarker[]>([]);
  const liveRef = useRef<Map<string, LiveMarkerState>>(new Map());
  const mapsApiRef = useRef<Awaited<ReturnType<typeof loadGoogleMaps>> | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "error" | "no-key">(
    "loading",
  );
  const [error, setError] = useState("");
  const [apiKey, setApiKey] = useState<string | null>(null);

  const markers = useMemo(
    () =>
      buildTransportMapMarkers({
        transport,
        sis,
        masters,
        academicYearCode,
        layers,
      }),
    [transport, sis, masters, academicYearCode, layers],
  );

  const bounds = useMemo(() => fitMapBounds(markers), [markers]);

  useEffect(() => {
    let cancelled = false;
    void fetch("/api/maps/config")
      .then((r) => r.json())
      .then((cfg: { mapsJsKey?: string | null }) => {
        if (cancelled) return;
        if (!cfg.mapsJsKey) {
          setStatus("no-key");
          return;
        }
        setApiKey(cfg.mapsJsKey);
      })
      .catch(() => {
        if (!cancelled) {
          setStatus("error");
          setError("Could not load map config");
        }
      });
    return () => {
      cancelled = true;
    };
  }, []);

  useEffect(() => {
    if (!apiKey || !containerRef.current) return;
    let cancelled = false;

    void loadGoogleMaps(apiKey)
      .then((maps) => {
        if (cancelled || !containerRef.current) return;
        mapsApiRef.current = maps;

        if (!mapRef.current) {
          mapRef.current = new maps.Map(containerRef.current, {
            center: bounds.center,
            zoom: bounds.zoom,
            mapTypeControl: false,
            streetViewControl: false,
            fullscreenControl: true,
          }) as unknown as GMap;
        }

        for (const m of markersRef.current) m.setMap(null);
        markersRef.current = [];

        const map = mapRef.current;
        const boundsObj = new maps.LatLngBounds();
        for (const m of markers) {
          boundsObj.extend({ lat: m.lat, lng: m.lng });
          const marker = new maps.Marker({
            map,
            position: { lat: m.lat, lng: m.lng },
            title: m.subtitle ? `${m.title} — ${m.subtitle}` : m.title,
            icon: {
              path: maps.SymbolPath.CIRCLE,
              scale: m.kind === "school" ? 12 : 9,
              fillColor: MARKER_COLORS[m.kind],
              fillOpacity: 1,
              strokeColor: "#ffffff",
              strokeWeight: 2,
            },
            zIndex: m.kind === "school" ? 1000 : m.kind === "bus" ? 900 : 100,
          }) as unknown as GMarker;
          markersRef.current.push(marker);
        }

        if (markers.length > 1) map.fitBounds(boundsObj);
        else {
          map.setCenter(bounds.center);
          map.setZoom(bounds.zoom);
        }

        setStatus("ready");
      })
      .catch((e) => {
        if (!cancelled) {
          setStatus("error");
          setError(e instanceof Error ? e.message : "Map failed to load");
        }
      });

    return () => {
      cancelled = true;
    };
  }, [apiKey, markers, bounds]);

  /**
   * The live layer.
   *
   * Separate from the effect above because that one tears every marker down
   * and builds it again — fine for stops, fatal for a vehicle that is meant
   * to be seen travelling. Here each bus keeps its marker for as long as it
   * keeps reporting, and only its position and heading change.
   */
  useEffect(() => {
    const maps = mapsApiRef.current;
    const map = mapRef.current;
    if (!maps || !map) return;

    const wanted = layers.buses ? (liveVehicles ?? []) : [];
    const seen = new Set<string>();

    for (const v of wanted) {
      seen.add(v.id);
      const style = liveBusStyle(v);
      const icon = {
        path: style.directional ? BUS_ICON_PATH : BUS_STOPPED_PATH,
        scale: 1.25,
        fillColor: style.fill,
        fillOpacity: style.opacity,
        strokeColor: "#ffffff",
        strokeWeight: 1.5,
        rotation: appliedRotation(style, 0),
        anchor: new maps.Point(0, 0),
      };
      const title = `${v.label} — ${v.detail}`;
      const existing = liveRef.current.get(v.id);

      if (!existing) {
        const marker = new maps.Marker({
          map,
          position: { lat: v.lat, lng: v.lng },
          title,
          icon,
          // Above every static marker: a moving vehicle is what the screen is
          // for, and it must not end up under a stop pin.
          zIndex: 2000,
        }) as unknown as GMarker;
        liveRef.current.set(v.id, {
          marker,
          lat: v.lat,
          lng: v.lng,
          rotation: style.rotation ?? 0,
          at: v.at,
          raf: null,
        });
        continue;
      }

      existing.marker.setTitle?.(title);

      // The same ping delivered twice is not movement. Repaint the icon (the
      // fix has aged, so its colour may have changed) and leave it be.
      if (existing.at === v.at) {
        existing.marker.setIcon?.({ ...icon, rotation: existing.rotation });
        continue;
      }

      const decision = decideAnimation({
        from: { lat: existing.lat, lng: existing.lng },
        to: { lat: v.lat, lng: v.lng },
        elapsedMs: Date.parse(v.at) - Date.parse(existing.at),
        freshness: v.freshness,
      });

      if (existing.raf != null) cancelAnimationFrame(existing.raf);

      const targetRotation = appliedRotation(style, existing.rotation);

      if (!decision.animate) {
        existing.marker.setPosition?.({ lat: v.lat, lng: v.lng });
        existing.marker.setIcon?.({ ...icon, rotation: targetRotation });
        liveRef.current.set(v.id, {
          ...existing,
          lat: v.lat,
          lng: v.lng,
          rotation: targetRotation,
          at: v.at,
          raf: null,
        });
        continue;
      }

      const from = { lat: existing.lat, lng: existing.lng };
      const to = { lat: v.lat, lng: v.lng };
      const fromRotation = existing.rotation;
      const started = performance.now();
      const step = (now: number) => {
        const t = easeInOut((now - started) / (decision.durationMs || ANIMATE_MS));
        const at = interpolate(from, to, t);
        existing.marker.setPosition?.(at);
        existing.marker.setIcon?.({
          ...icon,
          rotation: fromRotation + (targetRotation - fromRotation) * t,
        });
        const state = liveRef.current.get(v.id);
        if (!state) return;
        if (t < 1) {
          state.raf = requestAnimationFrame(step);
        } else {
          state.raf = null;
          state.lat = to.lat;
          state.lng = to.lng;
          state.rotation = targetRotation;
        }
      };
      liveRef.current.set(v.id, { ...existing, at: v.at, raf: requestAnimationFrame(step) });
    }

    // A vehicle that stopped reporting leaves the map rather than freezing
    // mid-road — the panel beside this names it as untracked, which is the
    // honest place for it.
    for (const [id, state] of liveRef.current) {
      if (seen.has(id)) continue;
      if (state.raf != null) cancelAnimationFrame(state.raf);
      state.marker.setMap(null);
      liveRef.current.delete(id);
    }
  }, [liveVehicles, layers.buses, status]);

  // Stop every animation when the map goes away, or a frame callback fires
  // against a marker whose map has been torn down.
  useEffect(() => {
    const live = liveRef.current;
    return () => {
      for (const state of live.values()) {
        if (state.raf != null) cancelAnimationFrame(state.raf);
        state.marker.setMap(null);
      }
      live.clear();
    };
  }, []);

  return (
    <div className={`relative ${className}`}>
      <div
        ref={containerRef}
        className="h-[28rem] w-full overflow-hidden rounded-lg border border-[rgba(32,48,80,0.12)] bg-[#e8eef5]"
      />
      {status === "loading" ? (
        <div className="pointer-events-none absolute inset-0 flex items-center justify-center rounded-lg bg-white/70 text-sm text-[var(--muted)]">
          Loading map…
        </div>
      ) : null}
      {status === "no-key" ? (
        <div className="absolute inset-0 flex flex-col items-center justify-center rounded-lg bg-white/95 p-6 text-center text-sm text-[var(--muted)]">
          <p className="font-semibold text-[var(--brand-deep)]">
            Maps JavaScript API key needed
          </p>
          <p className="mt-2 max-w-md text-xs leading-relaxed">
            Google Maps is not enabled for this site yet. Your school
            administrator can turn on the Maps JavaScript API and add the key to
            server settings.
          </p>
        </div>
      ) : null}
      {status === "error" ? (
        <div className="absolute inset-0 flex items-center justify-center rounded-lg bg-white/95 p-4 text-center text-sm text-[var(--danger)]">
          {error || "Could not load Google Maps"}
        </div>
      ) : null}
    </div>
  );
}

export function TransportMapLegend({
  layers,
  onToggle,
  counts,
}: {
  layers: TransportMapLayers;
  onToggle: (key: keyof TransportMapLayers) => void;
  counts: Record<keyof TransportMapLayers, number>;
}) {
  const items: { key: keyof TransportMapLayers; label: string; color: string }[] =
    [
      { key: "school", label: "School", color: MARKER_COLORS.school },
      { key: "stops", label: "Route stops (zone)", color: MARKER_COLORS.stop },
      { key: "unassigned", label: "Unassigned homes", color: MARKER_COLORS.unassigned },
      { key: "riders", label: "Assigned riders", color: MARKER_COLORS.rider },
      // Not "Bus GPS" any more: this toggles the Fleet Edge live layer, and
      // the count beside it is vehicles actually reporting, not hand-typed
      // pings.
      { key: "buses", label: "Live buses", color: MARKER_COLORS.bus },
    ];

  return (
    <div className="flex flex-wrap gap-2">
      {items.map((item) => (
        <button
          key={item.key}
          type="button"
          onClick={() => onToggle(item.key)}
          className={`inline-flex items-center gap-1.5 rounded-full border px-2.5 py-1 text-[11px] font-semibold transition ${
            layers[item.key]
              ? "border-[var(--brand-deep)] bg-white text-[var(--brand-deep)]"
              : "border-[rgba(32,48,80,0.12)] bg-[rgba(32,48,80,0.04)] text-[var(--muted)]"
          }`}
        >
          <span
            className="inline-block h-2.5 w-2.5 rounded-full"
            style={{ backgroundColor: item.color }}
          />
          {item.label}
          <span className="tabular-nums opacity-70">({counts[item.key]})</span>
        </button>
      ))}
    </div>
  );
}

export { DEFAULT_MAP_LAYERS };
