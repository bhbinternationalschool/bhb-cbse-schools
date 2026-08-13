"use client";

import { useMemo } from "react";
import {
  STORE_REPORT_CATEGORIES,
  STORE_REPORTS,
  type StoreReportCategory,
  type StoreReportDef,
  type StoreReportFormat,
  type StoreReportId,
} from "@/lib/storeReportCatalog";
import type { StoreItem } from "@/lib/store";

export function StoreReportsPanel({
  categories,
  reportIds,
  reportDate,
  onReportDateChange,
  reportClassId,
  onReportClassIdChange,
  reportSkuId,
  onReportSkuIdChange,
  classOptions,
  items,
  reportRunning,
  onRunReport,
  showCoverageFilters = false,
}: {
  categories: StoreReportCategory[];
  reportIds?: StoreReportId[];
  reportDate: string;
  onReportDateChange: (v: string) => void;
  reportClassId: string;
  onReportClassIdChange: (v: string) => void;
  reportSkuId: string;
  onReportSkuIdChange: (v: string) => void;
  classOptions: { id: string; name: string }[];
  items: StoreItem[];
  reportRunning: string | null;
  onRunReport: (id: StoreReportId, format: StoreReportFormat) => void;
  showCoverageFilters?: boolean;
}) {
  const reportsByCat = useMemo(() => {
    const map: Record<string, StoreReportDef[]> = {};
    for (const cat of categories) map[cat] = [];
    const allowed = reportIds ? new Set(reportIds) : null;
    for (const r of STORE_REPORTS) {
      if (allowed && !allowed.has(r.id)) continue;
      if (!categories.includes(r.category)) continue;
      map[r.category] = [...(map[r.category] ?? []), r];
    }
    return map;
  }, [categories, reportIds]);

  const visibleCategories = STORE_REPORT_CATEGORIES.filter(
    (c) => (reportsByCat[c.id] ?? []).length > 0,
  );

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap items-end gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3">
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Report date
          </span>
          <input
            type="date"
            className="field !py-1.5"
            value={reportDate}
            onChange={(e) => onReportDateChange(e.target.value)}
          />
        </label>
        {showCoverageFilters ? (
          <>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Class (coverage)
              </span>
              <select
                className="field !py-1.5"
                value={reportClassId}
                onChange={(e) => onReportClassIdChange(e.target.value)}
              >
                <option value="">All classes</option>
                {classOptions.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.name}
                  </option>
                ))}
              </select>
            </label>
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                SKU (coverage)
              </span>
              <select
                className="field !py-1.5"
                value={reportSkuId}
                onChange={(e) => onReportSkuIdChange(e.target.value)}
              >
                <option value="">First active SKU</option>
                {items.map((i) => (
                  <option key={i.id} value={i.id}>
                    {i.sku} · {i.name}
                  </option>
                ))}
              </select>
            </label>
          </>
        ) : null}
      </div>

      <div className="grid gap-4 md:grid-cols-2 xl:grid-cols-3">
        {visibleCategories.map((cat) => (
          <section
            key={cat.id}
            className="overflow-hidden rounded-md border border-[var(--border)] bg-[#f3f4f6] shadow-sm"
          >
            <header className={`${cat.headerClass} px-4 py-3 text-white`}>
              <h3 className="text-lg font-semibold tracking-wide">
                {cat.title}
              </h3>
            </header>
            <ul className="divide-y divide-[var(--border)]">
              {(reportsByCat[cat.id] ?? []).map((r) => (
                <li
                  key={r.id}
                  className="flex items-start justify-between gap-2 bg-[var(--card)] px-3 py-2.5"
                >
                  <div className="min-w-0">
                    <div className="text-sm font-medium text-[var(--brand-deep)]">
                      {r.label}
                    </div>
                    {r.hint ? (
                      <div className="text-[10px] text-[var(--muted)]">
                        {r.hint}
                      </div>
                    ) : null}
                  </div>
                  <div className="flex shrink-0 gap-1">
                    {(["excel", "pdf"] as const).map((fmt) => {
                      const key = `${r.id}:${fmt}`;
                      return (
                        <button
                          key={fmt}
                          type="button"
                          disabled={reportRunning === key}
                          onClick={() => onRunReport(r.id, fmt)}
                          className="rounded bg-[var(--primary)] px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--primary-foreground)] disabled:opacity-50"
                        >
                          {fmt}
                        </button>
                      );
                    })}
                  </div>
                </li>
              ))}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
