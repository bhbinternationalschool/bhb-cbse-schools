"use client";

import { useEffect, useRef, useState } from "react";
import {
  loadGoogleMaps,
  type GMapsMap,
  type GMapsMarker,
} from "@/lib/googleMapsLoader";

export type PickedPoint = {
  lat: number;
  lng: number;
  address: string;
  placeId?: string;
};

/**
 * Drop a pin where a stop actually is.
 *
 * Places autocomplete only finds somewhere Google has a name for. A great many
 * stops around Varanasi are a turning past a tube well, a crossing by a field,
 * a gate with no sign — real places that no search will ever return. Without
 * this the clerk has no way to pin them, so they stay unmeasured and therefore
 * unbillable under the distance rule.
 *
 * Click or drag to place the pin. The coordinates are what matter; the address
 * is a courtesy label and may legitimately come back empty, which is reported
 * rather than hidden.
 */
export function StopMapPicker({
  initial,
  stopName,
  onCancel,
  onPick,
}: {
  initial: { lat: number; lng: number } | null;
  stopName: string;
  onCancel: () => void;
  onPick: (point: PickedPoint) => void;
}) {
  const boxRef = useRef<HTMLDivElement | null>(null);
  const mapRef = useRef<GMapsMap | null>(null);
  const markerRef = useRef<GMapsMarker | null>(null);

  const [status, setStatus] = useState<"loading" | "ready" | "error">("loading");
  const [error, setError] = useState<string | null>(null);
  const [point, setPoint] = useState<{ lat: number; lng: number } | null>(initial);
  const [address, setAddress] = useState("");
  const [addressNote, setAddressNote] = useState<string | null>(null);
  const [looking, setLooking] = useState(false);

  useEffect(() => {
    function onKey(e: KeyboardEvent) {
      if (e.key === "Escape") onCancel();
    }
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, [onCancel]);

  // Boot the map once. The school is the fallback centre — a blank world map
  // centred on the Atlantic would be useless for placing a Varanasi stop.
  useEffect(() => {
    let cancelled = false;
    (async () => {
      try {
        const cfg = await fetch("/api/maps/config").then((r) => r.json());
        const key: string | null = cfg?.mapsJsKey ?? null;
        if (!key) {
          if (!cancelled) {
            setStatus("error");
            setError("Google Maps key is not configured for the browser.");
          }
          return;
        }
        const maps = await loadGoogleMaps(key);
        if (cancelled || !boxRef.current) return;

        const centre =
          initial ?? { lat: cfg?.school?.lat ?? 25.2677, lng: cfg?.school?.lng ?? 83.0362 };

        const map = new maps.Map(boxRef.current, {
          center: centre,
          zoom: initial ? 16 : 13,
          mapTypeControl: true,
          streetViewControl: false,
          fullscreenControl: false,
        });
        mapRef.current = map;

        const marker = new maps.Marker({
          position: centre,
          map,
          draggable: true,
        });
        markerRef.current = marker;

        map.addListener("click", (e) => {
          const lat = e.latLng?.lat();
          const lng = e.latLng?.lng();
          if (lat == null || lng == null) return;
          marker.setPosition({ lat, lng });
          setPoint({ lat, lng });
        });
        marker.addListener("dragend", (e) => {
          const lat = e.latLng?.lat();
          const lng = e.latLng?.lng();
          if (lat == null || lng == null) return;
          setPoint({ lat, lng });
        });

        if (!cancelled) {
          setStatus("ready");
          if (initial) setPoint(initial);
        }
      } catch (e) {
        if (!cancelled) {
          setStatus("error");
          setError(
            e instanceof Error ? e.message : "Google Maps could not be loaded",
          );
        }
      }
    })();
    return () => {
      cancelled = true;
    };
    // Mount once — re-running would rebuild the map under the user's pin.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  // Label the pin whenever it moves.
  useEffect(() => {
    if (!point) return;
    let cancelled = false;
    setLooking(true);
    setAddressNote(null);
    const t = window.setTimeout(async () => {
      try {
        const res = await fetch(
          `/api/maps/geocode?lat=${point.lat}&lng=${point.lng}`,
        );
        const data = (await res.json()) as {
          ok?: boolean;
          formattedAddress?: string;
          note?: string;
        };
        if (cancelled) return;
        setAddress(data.formattedAddress || "");
        setAddressNote(data.ok ? null : data.note || null);
      } catch {
        if (!cancelled) {
          setAddress("");
          setAddressNote("Could not look up an address — the pin is still valid.");
        }
      } finally {
        if (!cancelled) setLooking(false);
      }
    }, 400);
    return () => {
      cancelled = true;
      window.clearTimeout(t);
    };
  }, [point]);

  return (
    <div
      className="fixed inset-0 z-[90] flex items-end justify-center bg-[rgba(15,23,42,0.55)] p-4 sm:items-center"
      role="dialog"
      aria-modal="true"
      aria-labelledby="stop-map-title"
      onClick={onCancel}
    >
      <div
        className="flex max-h-[92vh] w-full max-w-2xl flex-col overflow-hidden rounded-2xl border border-[var(--border)] bg-[var(--card)] shadow-2xl"
        onClick={(e) => e.stopPropagation()}
      >
        <div className="border-b border-[var(--border)] p-4">
          <h2
            id="stop-map-title"
            className="text-lg font-bold text-[var(--brand-deep)]"
          >
            Place {stopName.trim() || "this stop"} on the map
          </h2>
          <p className="mt-0.5 text-[11px] text-[var(--muted)]">
            Click anywhere, or drag the pin. Use satellite view if the stop has
            no road name.
          </p>
        </div>

        <div className="relative min-h-[22rem] flex-1 bg-[var(--surface-sunken)]">
          <div ref={boxRef} className="absolute inset-0" />
          {status !== "ready" ? (
            <div className="absolute inset-0 flex items-center justify-center p-6 text-center">
              <p className="text-sm text-[var(--muted)]">
                {status === "loading"
                  ? "Loading the map…"
                  : error || "The map could not be loaded."}
              </p>
            </div>
          ) : null}
        </div>

        <div className="space-y-2 border-t border-[var(--border)] p-4">
          {point ? (
            <>
              <p className="text-[12px] font-semibold text-[var(--brand-deep)]">
                {point.lat.toFixed(6)}, {point.lng.toFixed(6)}
              </p>
              <p className="text-[11px] text-[var(--muted)]">
                {looking
                  ? "Looking up the address…"
                  : address || "No address on record for this spot"}
              </p>
              {addressNote ? (
                <p className="text-[11px] text-[var(--muted)]">{addressNote}</p>
              ) : null}
            </>
          ) : (
            <p className="text-[11px] text-[var(--muted)]">
              No pin placed yet.
            </p>
          )}

          <div className="flex justify-end gap-2 pt-1">
            <button
              type="button"
              onClick={onCancel}
              className="rounded-lg border border-[var(--border)] px-4 py-1.5 text-sm font-semibold text-[var(--ink)] hover:bg-[var(--surface-sunken)]"
            >
              Cancel
            </button>
            <button
              type="button"
              disabled={!point || status !== "ready"}
              onClick={() =>
                point && onPick({ lat: point.lat, lng: point.lng, address })
              }
              className="rounded-lg bg-[var(--primary)] px-4 py-1.5 text-sm font-bold text-[var(--primary-foreground)] disabled:opacity-50"
            >
              Use this location
            </button>
          </div>
        </div>
      </div>
    </div>
  );
}
