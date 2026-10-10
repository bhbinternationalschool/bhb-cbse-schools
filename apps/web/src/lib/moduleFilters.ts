"use client";

/**
 * Generic module-filter state: URL + localStorage persistence, saved views,
 * active-filter counting — extracted from the Students module's filter
 * pattern (lib/studentFilters.ts), which was the only module where filters
 * survived navigation or could be shared as a link. Every other module
 * hand-rolls one useState per facet and loses it the moment you open a
 * record and come back. This lets a module get the same behavior from one
 * `useModuleFilters(...)` call instead of re-deriving the two persistence
 * effects each time.
 *
 * Filter shapes are plain `Record<string, string>` — every facet value is a
 * string (matching how `<select>`/`<input>` values work), including things
 * like `matchMode` ("all"/"any") or `sortOrder` ("asc"/"desc"); callers cast
 * at the read site the same way lib/studentFilters.ts already does.
 */

import { useCallback, useEffect, useRef, useState } from "react";

export type FilterDefaults<F> = Partial<Record<keyof F, string>>;

export type SavedFilterView<F> = {
  id: string;
  name: string;
  filters: F;
  builtIn?: boolean;
};

function coerceFilters<F extends Record<string, string>>(
  raw: unknown,
  empty: F,
): F {
  const src = (raw && typeof raw === "object" ? raw : {}) as Record<
    string,
    unknown
  >;
  const out = { ...empty };
  for (const key of Object.keys(empty) as (keyof F)[]) {
    const v = src[key as string];
    if (typeof v === "string") (out as Record<string, string>)[key as string] = v;
  }
  return out;
}

/** Facets the user has actually set — drives the "N active" badge. */
export function countActiveModuleFilters<F extends Record<string, string>>(
  f: F,
  empty: F,
  defaults: FilterDefaults<F> = {},
  ignoreKeys: (keyof F)[] = [],
): number {
  let n = 0;
  for (const key of Object.keys(f) as (keyof F)[]) {
    if (ignoreKeys.includes(key)) continue;
    const dflt = String(defaults[key] ?? empty[key] ?? "");
    if (String(f[key] ?? "") !== dflt) n += 1;
  }
  return n;
}

/** Only non-default values go into the URL, so shared links stay short. */
export function filtersToParams<F extends Record<string, string>>(
  f: F,
  defaults: FilterDefaults<F> = {},
): URLSearchParams {
  const p = new URLSearchParams();
  for (const [key, value] of Object.entries(f)) {
    const dflt = String((defaults as Record<string, string>)[key] ?? "");
    const v = String(value ?? "");
    if (v && v !== dflt) p.set(key, v);
  }
  return p;
}

export function filtersFromParams<F extends Record<string, string>>(
  p: URLSearchParams | null,
  empty: F,
): Partial<F> {
  if (!p) return {};
  const out: Record<string, string> = {};
  for (const key of Object.keys(empty)) {
    const v = p.get(key);
    if (v !== null) out[key] = v;
  }
  return out as Partial<F>;
}

export type UseModuleFiltersOpts<F extends Record<string, string>> = {
  empty: F;
  /** localStorage key for the last-used filter state, e.g. "bhb_fee_filters_v1". */
  storageKey: string;
  /** localStorage key for saved views. Omit to disable saved views. */
  viewsKey?: string;
  /** Values that mean "not filtering" when they differ from `empty`'s own value. */
  defaults?: FilterDefaults<F>;
  builtInViews?: SavedFilterView<F>[];
};

export type UseModuleFiltersResult<F extends Record<string, string>> = {
  filters: F;
  /** True once the mount-time restore (URL/localStorage) has run. */
  ready: boolean;
  activeCount: number;
  savedViews: SavedFilterView<F>[];
  patch: (p: Partial<F>) => void;
  setFilters: (f: F) => void;
  reset: () => void;
  saveView: (name: string) => void;
  deleteView: (id: string) => void;
  applyView: (v: SavedFilterView<F>) => void;
};

/**
 * One object of filter state instead of one useState per facet, persisted
 * to localStorage and reflected in the URL (query string, minus any `tab`
 * param, which is left untouched), with optional saved views. Mirrors
 * lib/studentFilters.ts's restore-on-mount rule: an explicit URL wins (a
 * shared link), otherwise the last state this browser was left in.
 */
export function useModuleFilters<F extends Record<string, string>>(
  opts: UseModuleFiltersOpts<F>,
): UseModuleFiltersResult<F> {
  const { empty, storageKey, viewsKey, defaults = {}, builtInViews = [] } = opts;
  const emptyRef = useRef(empty);
  emptyRef.current = empty;

  const [filters, setFiltersState] = useState<F>(empty);
  const [ready, setReady] = useState(false);
  const [savedViews, setSavedViews] = useState<SavedFilterView<F>[]>(builtInViews);

  const loadLocal = useCallback((): F => {
    if (typeof window === "undefined") return emptyRef.current;
    try {
      const raw = localStorage.getItem(storageKey);
      if (!raw) return emptyRef.current;
      return coerceFilters(JSON.parse(raw), emptyRef.current);
    } catch {
      return emptyRef.current;
    }
  }, [storageKey]);

  const loadViews = useCallback((): SavedFilterView<F>[] => {
    if (typeof window === "undefined" || !viewsKey) return [];
    try {
      const raw = localStorage.getItem(viewsKey);
      if (!raw) return [];
      const parsed = JSON.parse(raw) as unknown;
      if (!Array.isArray(parsed)) return [];
      return parsed
        .filter(
          (v): v is { id: unknown; name: unknown; filters: unknown } =>
            !!v && typeof v === "object" && "id" in v,
        )
        .map((v) => ({
          id: String(v.id),
          name: String(v.name || "Untitled view"),
          filters: coerceFilters(v.filters, emptyRef.current),
        }));
    } catch {
      return [];
    }
  }, [viewsKey]);

  useEffect(() => {
    try {
      const fromUrl = filtersFromParams(
        new URLSearchParams(window.location.search),
        emptyRef.current,
      );
      const restored =
        Object.keys(fromUrl).length > 0
          ? { ...loadLocal(), ...fromUrl }
          : loadLocal();
      setFiltersState(restored);
      setSavedViews([...builtInViews, ...loadViews()]);
    } catch {
      /* ignore */
    } finally {
      setReady(true);
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  useEffect(() => {
    if (!ready) return;
    try {
      localStorage.setItem(storageKey, JSON.stringify(filters));
    } catch {
      /* quota / private mode — filters simply won't persist */
    }
    try {
      const url = new URL(window.location.href);
      const next = filtersToParams(filters, defaults);
      const tab = url.searchParams.get("tab");
      url.search = next.toString();
      if (tab) url.searchParams.set("tab", tab);
      window.history.replaceState({}, "", url.toString());
    } catch {
      /* ignore */
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [ready, filters, storageKey]);

  const patch = useCallback((p: Partial<F>) => {
    setFiltersState((cur) => ({ ...cur, ...p }));
  }, []);

  const reset = useCallback(() => {
    setFiltersState(emptyRef.current);
  }, []);

  const activeCount = countActiveModuleFilters(filters, empty, defaults);

  function persistViews(next: SavedFilterView<F>[]) {
    setSavedViews([...builtInViews, ...next]);
    if (!viewsKey) return;
    try {
      localStorage.setItem(viewsKey, JSON.stringify(next));
    } catch {
      /* ignore */
    }
  }

  function saveView(name: string) {
    if (!viewsKey) return;
    const view: SavedFilterView<F> = {
      id: `view_${Math.random().toString(36).slice(2, 10)}`,
      name,
      filters,
    };
    persistViews([...savedViews.filter((v) => !v.builtIn), view]);
  }

  function deleteView(id: string) {
    persistViews(savedViews.filter((v) => !v.builtIn && v.id !== id));
  }

  function applyView(v: SavedFilterView<F>) {
    setFiltersState(v.filters);
  }

  return {
    filters,
    ready,
    activeCount,
    savedViews,
    patch,
    setFilters: setFiltersState,
    reset,
    saveView,
    deleteView,
    applyView,
  };
}
