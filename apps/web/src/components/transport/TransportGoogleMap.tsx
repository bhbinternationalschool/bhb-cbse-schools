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

type GMarker = { setMap: (m: unknown) => void };

type Props = {
  transport: TransportState;
  sis: SisState | null;
  masters: MastersState | null;
  academicYearCode?: string;
  layers: TransportMapLayers;
  className?: string;
};

export function TransportGoogleMap({
  transport,
  sis,
  masters,
  academicYearCode,
  layers,
  className = "",
}: Props) {
  const containerRef = useRef<HTMLDivElement>(null);
  const mapRef = useRef<GMap | null>(null);
  const markersRef = useRef<GMarker[]>([]);
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
      { key: "buses", label: "Bus GPS", color: MARKER_COLORS.bus },
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
