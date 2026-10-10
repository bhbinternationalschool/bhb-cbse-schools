"use client";

import { type ReactNode } from "react";
import { field } from "@/components/ui/erp-ui";

export type FilterFacetOption = { value: string; label: string };

export type FilterFacet = {
  key: string;
  label: string;
  value: string;
  onChange: (v: string) => void;
  options: FilterFacetOption[];
  /** Label for the empty/"no filter" option. Default "All". */
  allLabel?: string;
  disabled?: boolean;
  className?: string;
};

export type FilterBarSavedView = { id: string; name: string; builtIn?: boolean };

export type FilterBarProps = {
  query: string;
  onQueryChange: (v: string) => void;
  queryPlaceholder?: string;
  facets?: FilterFacet[];
  activeCount: number;
  onReset: () => void;
  matchMode?: "all" | "any";
  onMatchModeChange?: (m: "all" | "any") => void;
  matchModeHint?: { all: string; any: string };
  savedViews?: FilterBarSavedView[];
  onApplyView?: (id: string) => void;
  onSaveView?: () => void;
  onDeleteView?: (id: string) => void;
  /** Extra bespoke controls (date ranges, etc.) that don't fit the facet shape. */
  children?: ReactNode;
};

/**
 * Config-driven filter bar — search + facet selects + optional match-mode
 * toggle, active-count badge, and saved views. Styled to match the Students
 * roster's filter UI (components/students/StudentsWorkspace.tsx), the
 * benchmark every other module's filtering fell short of. Pair with
 * lib/moduleFilters.ts's useModuleFilters for the persistence side.
 */
export function FilterBar({
  query,
  onQueryChange,
  queryPlaceholder = "Search…",
  facets = [],
  activeCount,
  onReset,
  matchMode,
  onMatchModeChange,
  matchModeHint,
  savedViews,
  onApplyView,
  onSaveView,
  onDeleteView,
  children,
}: FilterBarProps) {
  return (
    <div className="space-y-2.5">
      {savedViews && savedViews.length > 0 ? (
        <div className="flex flex-wrap items-center gap-1.5">
          {savedViews.map((v) => (
            <span key={v.id} className="inline-flex items-center">
              <button
                type="button"
                onClick={() => onApplyView?.(v.id)}
                className="rounded-lg border border-[rgba(32,48,80,0.15)] bg-white px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.04)]"
              >
                {v.name}
              </button>
              {!v.builtIn && onDeleteView ? (
                <button
                  type="button"
                  onClick={() => onDeleteView(v.id)}
                  className="-ml-1.5 rounded-r-lg border border-l-0 border-[rgba(32,48,80,0.15)] bg-white px-1.5 py-1 text-[11px] text-[var(--muted)] hover:text-[var(--danger)]"
                  aria-label={`Delete view ${v.name}`}
                  title="Delete view"
                >
                  ×
                </button>
              ) : null}
            </span>
          ))}
          {onSaveView ? (
            <button
              type="button"
              onClick={onSaveView}
              disabled={activeCount === 0}
              className="rounded-lg border border-dashed border-[rgba(32,48,80,0.28)] px-2.5 py-1 text-[11px] font-medium text-[var(--brand-mid)] disabled:opacity-40"
              title={
                activeCount === 0
                  ? "Set some filters first"
                  : "Save the current filters as a view"
              }
            >
              + Save current
            </button>
          ) : null}
          {activeCount > 0 ? (
            <span className="ml-auto flex items-center gap-2">
              <span
                className="rounded-full bg-[rgba(32,48,80,0.08)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-deep)]"
                aria-live="polite"
              >
                {activeCount} filter{activeCount === 1 ? "" : "s"} active
              </span>
              <button
                type="button"
                onClick={onReset}
                className="text-[11px] font-semibold text-[var(--brand-mid)] underline"
              >
                Clear all
              </button>
            </span>
          ) : null}
        </div>
      ) : activeCount > 0 ? (
        <div className="flex items-center gap-2">
          <span className="rounded-full bg-[rgba(32,48,80,0.08)] px-2 py-0.5 text-[11px] font-semibold text-[var(--brand-deep)]">
            {activeCount} filter{activeCount === 1 ? "" : "s"} active
          </span>
          <button
            type="button"
            onClick={onReset}
            className="text-[11px] font-semibold text-[var(--brand-mid)] underline"
          >
            Clear all
          </button>
        </div>
      ) : null}

      {matchMode && onMatchModeChange ? (
        <div className="flex flex-wrap items-center gap-2">
          <div
            className="inline-flex rounded-lg border border-[rgba(32,48,80,0.12)] bg-white p-0.5"
            role="group"
            aria-label="Filter match mode"
          >
            <button
              type="button"
              onClick={() => onMatchModeChange("all")}
              className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${
                matchMode === "all"
                  ? "bg-[var(--brand-deep)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--brand-deep)]"
              }`}
            >
              Match all
            </button>
            <button
              type="button"
              onClick={() => onMatchModeChange("any")}
              className={`rounded-md px-2.5 py-1.5 text-[11px] font-semibold ${
                matchMode === "any"
                  ? "bg-[var(--brand-deep)] text-white"
                  : "text-[var(--muted)] hover:text-[var(--brand-deep)]"
              }`}
            >
              Match any
            </button>
          </div>
          {matchModeHint ? (
            <span className="text-[11px] text-[var(--muted)]">
              {matchMode === "all" ? matchModeHint.all : matchModeHint.any}
            </span>
          ) : null}
        </div>
      ) : null}

      <div className="flex flex-wrap gap-2">
        <input
          className={`${field} min-w-[12rem] flex-1`}
          placeholder={queryPlaceholder}
          value={query}
          onChange={(e) => onQueryChange(e.target.value)}
          aria-label={queryPlaceholder}
        />
        {facets.map((f) => (
          <select
            key={f.key}
            className={`${field} max-w-[11rem] ${f.className ?? ""}`}
            value={f.value}
            onChange={(e) => f.onChange(e.target.value)}
            disabled={f.disabled}
            aria-label={f.label}
          >
            <option value="">{f.allLabel ?? `All ${f.label.toLowerCase()}`}</option>
            {f.options.map((o) => (
              <option key={o.value} value={o.value}>
                {o.label}
              </option>
            ))}
          </select>
        ))}
        {children}
      </div>
    </div>
  );
}
