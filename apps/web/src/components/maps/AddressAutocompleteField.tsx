"use client";

import { useEffect, useId, useRef, useState } from "react";
import type { ResolvedPlaceAddress } from "@/lib/mapsPlaces";

function newSessionToken() {
  return `sess_${Math.random().toString(36).slice(2)}${Date.now().toString(36)}`;
}

type Props = {
  value: string;
  onChange: (value: string) => void;
  onResolved: (place: ResolvedPlaceAddress) => void;
  disabled?: boolean;
  placeholder?: string;
  className?: string;
  inputClassName?: string;
};

export function AddressAutocompleteField({
  value,
  onChange,
  onResolved,
  disabled,
  placeholder = "Start typing house / area / landmark…",
  className = "",
  inputClassName = "field",
}: Props) {
  const listId = useId();
  const rootRef = useRef<HTMLDivElement>(null);
  const [open, setOpen] = useState(false);
  const [loading, setLoading] = useState(false);
  const [session, setSession] = useState(() => newSessionToken());
  const [predictions, setPredictions] = useState<
    {
      placeId: string;
      description: string;
      mainText: string;
      secondaryText: string;
    }[]
  >([]);
  const [activeIdx, setActiveIdx] = useState(-1);

  useEffect(() => {
    if (disabled || value.trim().length < 3) {
      setPredictions([]);
      setOpen(false);
      return;
    }

    const timer = window.setTimeout(() => {
      setLoading(true);
      const q = new URLSearchParams({ input: value, session });
      void fetch(`/api/maps/places-autocomplete?${q}`)
        .then((r) => r.json())
        .then((data: { predictions?: typeof predictions }) => {
          const list = data.predictions ?? [];
          setPredictions(list);
          setOpen(list.length > 0);
          setActiveIdx(-1);
        })
        .catch(() => {
          setPredictions([]);
          setOpen(false);
        })
        .finally(() => setLoading(false));
    }, 280);

    return () => window.clearTimeout(timer);
  }, [value, session, disabled]);

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!rootRef.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  async function pick(placeId: string) {
    setOpen(false);
    setLoading(true);
    try {
      const q = new URLSearchParams({ placeId, session });
      const res = await fetch(`/api/maps/place-details?${q}`);
      const data = (await res.json()) as {
        ok?: boolean;
        place?: ResolvedPlaceAddress;
      };
      if (data.ok && data.place) {
        onChange(data.place.address);
        onResolved(data.place);
        setSession(newSessionToken());
      }
    } finally {
      setLoading(false);
      setPredictions([]);
    }
  }

  return (
    <div ref={rootRef} className={`relative ${className}`}>
      <input
        className={inputClassName}
        value={value}
        disabled={disabled}
        placeholder={placeholder}
        autoComplete="off"
        role="combobox"
        aria-expanded={open}
        aria-controls={listId}
        aria-autocomplete="list"
        onFocus={() => {
          if (predictions.length) setOpen(true);
        }}
        onChange={(e) => {
          onChange(e.target.value);
          if (!session) setSession(newSessionToken());
        }}
        onKeyDown={(e) => {
          if (!open || !predictions.length) return;
          if (e.key === "ArrowDown") {
            e.preventDefault();
            setActiveIdx((i) => Math.min(i + 1, predictions.length - 1));
          } else if (e.key === "ArrowUp") {
            e.preventDefault();
            setActiveIdx((i) => Math.max(i - 1, 0));
          } else if (e.key === "Enter" && activeIdx >= 0) {
            e.preventDefault();
            void pick(predictions[activeIdx]!.placeId);
          } else if (e.key === "Escape") {
            setOpen(false);
          }
        }}
      />
      {loading ? (
        <span className="pointer-events-none absolute right-2 top-1/2 -translate-y-1/2 text-[10px] text-[var(--muted)]">
          …
        </span>
      ) : null}
      {open && predictions.length > 0 ? (
        <ul
          id={listId}
          role="listbox"
          className="absolute z-50 mt-1 max-h-56 w-full overflow-y-auto rounded-lg border border-[rgba(32,48,80,0.15)] bg-white py-1 shadow-lg"
        >
          {predictions.map((p, idx) => (
            <li key={p.placeId} role="option" aria-selected={idx === activeIdx}>
              <button
                type="button"
                className={`w-full px-3 py-2 text-left text-sm hover:bg-[rgba(32,48,80,0.05)] ${
                  idx === activeIdx ? "bg-[rgba(197,160,40,0.12)]" : ""
                }`}
                onMouseDown={(e) => e.preventDefault()}
                onClick={() => void pick(p.placeId)}
              >
                <span className="font-medium text-[var(--brand-deep)]">
                  {p.mainText}
                </span>
                {p.secondaryText ? (
                  <span className="block text-[11px] text-[var(--muted)]">
                    {p.secondaryText}
                  </span>
                ) : null}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
      <p className="mt-1 text-[10px] text-[var(--muted)]">
        Google address search — pick a suggestion to fill locality &amp; PIN
      </p>
    </div>
  );
}
