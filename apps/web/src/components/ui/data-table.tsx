"use client";

import { ArrowUpDown, ChevronDownIcon, ChevronUpIcon, DownloadIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import { SkeletonTable } from "@/components/ui/skeleton";
import { downloadExcelCsv } from "@/lib/reportExport";
import { cn } from "@/lib/utils";

export type DataTableColumn<T> = {
  key: string;
  header: ReactNode;
  align?: "left" | "right";
  className?: string;
  /** Visible cell content. Defaults to String(value(row)) when omitted. */
  render?: (row: T) => ReactNode;
  /** Backing value for sort and CSV export. Required to enable either. */
  value?: (row: T) => string | number | null | undefined;
  sortable?: boolean;
};

/**
 * Shared table: sorting, client pagination, empty/loading states, optional
 * CSV export — the pieces ErpTable/ErpTableShell left to each of the 53 raw
 * `<table>` call sites to reimplement (or skip) individually.
 */
export function DataTable<T>({
  columns,
  rows,
  rowKey,
  loading = false,
  emptyTitle = "Nothing here yet",
  emptyDescription,
  pageSize = 50,
  minWidth = "min-w-[720px]",
  exportFileBaseName,
  exportTitle,
  className,
}: {
  columns: DataTableColumn<T>[];
  rows: T[];
  rowKey: (row: T) => string;
  loading?: boolean;
  emptyTitle?: string;
  emptyDescription?: string;
  pageSize?: number;
  minWidth?: string;
  /** Set to enable the CSV export button; used as the downloaded filename base. */
  exportFileBaseName?: string;
  exportTitle?: string;
  className?: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);

  const sorted = useMemo(() => {
    if (!sortKey) return rows;
    const col = columns.find((c) => c.key === sortKey);
    if (!col?.value) return rows;
    const dir = sortDir === "asc" ? 1 : -1;
    return [...rows].sort((a, b) => {
      const av = col.value!(a);
      const bv = col.value!(b);
      if (av == null && bv == null) return 0;
      if (av == null) return 1;
      if (bv == null) return -1;
      if (typeof av === "number" && typeof bv === "number") {
        return (av - bv) * dir;
      }
      return String(av).localeCompare(String(bv)) * dir;
    });
  }, [rows, sortKey, sortDir, columns]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / pageSize));
  const safePage = Math.min(page, pageCount);
  const pageRows = sorted.slice((safePage - 1) * pageSize, safePage * pageSize);

  function toggleSort(col: DataTableColumn<T>) {
    if (!col.sortable || !col.value) return;
    if (sortKey === col.key) {
      setSortDir((d) => (d === "asc" ? "desc" : "asc"));
    } else {
      setSortKey(col.key);
      setSortDir("asc");
    }
    setPage(1);
  }

  function handleExport() {
    if (!exportFileBaseName) return;
    downloadExcelCsv({
      title: exportTitle || exportFileBaseName,
      columns: columns
        .filter((c) => c.value)
        .map((c) => ({
          key: c.key,
          header: typeof c.header === "string" ? c.header : c.key,
          align: c.align,
        })),
      rows: sorted.map((row) => {
        const out: Record<string, string | number | null> = {};
        for (const c of columns) {
          if (!c.value) continue;
          const v = c.value(row);
          out[c.key] = v ?? "";
        }
        return out;
      }),
      fileBaseName: exportFileBaseName,
    });
  }

  if (loading) return <SkeletonTable />;

  if (rows.length === 0) {
    return <EmptyState title={emptyTitle} description={emptyDescription} />;
  }

  return (
    <div className={cn("space-y-2", className)}>
      {exportFileBaseName ? (
        <div className="flex justify-end">
          <Button type="button" variant="outline" size="sm" onClick={handleExport}>
            <DownloadIcon className="size-3.5" />
            Export CSV
          </Button>
        </div>
      ) : null}

      <div className="erp-data-table-wrap overflow-x-auto">
        <table className={cn("w-full text-left text-sm", minWidth)}>
          <thead className="border-b border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              {columns.map((col) => {
                const active = sortKey === col.key;
                return (
                  <th
                    key={col.key}
                    className={cn(
                      "px-4 py-3 font-bold",
                      col.align === "right" && "text-right",
                      col.className,
                    )}
                  >
                    {col.sortable && col.value ? (
                      <button
                        type="button"
                        onClick={() => toggleSort(col)}
                        className={cn(
                          "inline-flex items-center gap-1 hover:text-[var(--brand-deep)]",
                          col.align === "right" && "flex-row-reverse",
                        )}
                      >
                        {col.header}
                        {active ? (
                          sortDir === "asc" ? (
                            <ChevronUpIcon className="size-3.5" />
                          ) : (
                            <ChevronDownIcon className="size-3.5" />
                          )
                        ) : (
                          <ArrowUpDown className="size-3 opacity-40" />
                        )}
                      </button>
                    ) : (
                      col.header
                    )}
                  </th>
                );
              })}
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(32,48,80,0.08)]">
            {pageRows.map((row) => (
              <tr key={rowKey(row)} className="hover:bg-[rgba(32,48,80,0.02)]">
                {columns.map((col) => (
                  <td
                    key={col.key}
                    className={cn(
                      "px-4 py-2.5",
                      col.align === "right" && "text-right",
                      col.className,
                    )}
                  >
                    {col.render ? col.render(row) : String(col.value?.(row) ?? "")}
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>

      {pageCount > 1 ? (
        <div className="flex items-center justify-between text-xs text-muted-foreground">
          <span>
            {(safePage - 1) * pageSize + 1}
            {"–"}
            {Math.min(safePage * pageSize, sorted.length)} of {sorted.length}
          </span>
          <div className="flex items-center gap-2">
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={safePage <= 1}
              onClick={() => setPage((p) => Math.max(1, p - 1))}
            >
              Previous
            </Button>
            <span>
              Page {safePage} of {pageCount}
            </span>
            <Button
              type="button"
              variant="outline"
              size="xs"
              disabled={safePage >= pageCount}
              onClick={() => setPage((p) => Math.min(pageCount, p + 1))}
            >
              Next
            </Button>
          </div>
        </div>
      ) : null}
    </div>
  );
}
