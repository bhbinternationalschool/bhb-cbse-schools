"use client";

import { ArrowUpDown, ChevronDownIcon, ChevronUpIcon } from "lucide-react";
import { useMemo, useState, type ReactNode } from "react";

import { Button } from "@/components/ui/button";
import { EmptyState } from "@/components/ui/empty-state";
import {
  BulkActionBar,
  ExportMenu,
  RowActionMenu,
  RowCheckbox,
  useRowSelection,
  type BulkAction,
  type ExportFormat,
  type RowAction,
  type RowSelection,
} from "@/components/ui/erp-grid";
import { SkeletonTable } from "@/components/ui/skeleton";
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
 * Shared table: sorting, client pagination, empty/loading states, and the
 * premium-grid standard — a checkbox on every row with a slide-up bulk bar,
 * a "…" action menu on every row, and an Export data menu (Excel / CSV /
 * PDF) of the filtered, sorted rows. The pieces ErpTable/ErpTableShell left
 * to each of the 53 raw `<table>` call sites to reimplement (or skip).
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
  exportSubtitle,
  exportFilterNote,
  exportFormats,
  onExportMessage,
  toolbar,
  rowActions,
  rowActionsLabel,
  selectable = false,
  selection: selectionProp,
  bulkActions,
  selectionNoun,
  onRowClick,
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
  /** Set to enable the Export data menu; used as the downloaded filename base. */
  exportFileBaseName?: string;
  exportTitle?: string;
  exportSubtitle?: string;
  exportFilterNote?: string;
  /** Default: Excel, CSV and PDF. */
  exportFormats?: ExportFormat[];
  onExportMessage?: (msg: string) => void;
  /** Search / filters / contextual actions, rendered in the control row beside Export. */
  toolbar?: ReactNode;
  /** The "…" menu every row carries. */
  rowActions?: RowAction<T>[];
  rowActionsLabel?: string;
  /** Checkbox on every row plus a select-all in the header. */
  selectable?: boolean;
  /** Bring your own selection (useRowSelection) when the bulk bar lives elsewhere. */
  selection?: RowSelection;
  /** Rendered in the slide-up bar whenever rows are ticked. Implies `selectable`. */
  bulkActions?: BulkAction[];
  selectionNoun?: string;
  onRowClick?: (row: T) => void;
  className?: string;
}) {
  const [sortKey, setSortKey] = useState<string | null>(null);
  const [sortDir, setSortDir] = useState<"asc" | "desc">("asc");
  const [page, setPage] = useState(1);
  const allKeys = useMemo(() => rows.map(rowKey), [rows, rowKey]);
  const ownSelection = useRowSelection(allKeys);
  const selection = selectionProp ?? ownSelection;
  const withSelection = selectable || !!bulkActions || !!selectionProp;

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

  const exportColumns = columns
    .filter((c) => c.value)
    .map((c) => ({
      key: c.key,
      header: typeof c.header === "string" ? c.header : c.key,
      align: c.align,
    }));
  const exportRows = () =>
    sorted.map((row) => {
      const out: Record<string, string | number | null> = {};
      for (const c of columns) {
        if (!c.value) continue;
        const v = c.value(row);
        out[c.key] = v ?? "";
      }
      return out;
    });

  const exportMenu = exportFileBaseName ? (
    <ExportMenu
      title={exportTitle || exportFileBaseName}
      subtitle={exportSubtitle}
      filterNote={exportFilterNote}
      columns={exportColumns}
      rows={exportRows}
      fileBaseName={exportFileBaseName}
      formats={exportFormats}
      onMessage={onExportMessage}
      compact
    />
  ) : null;

  if (loading) return <SkeletonTable />;

  if (rows.length === 0) {
    return (
      <div className={cn("space-y-2", className)}>
        {toolbar ? <div className="flex flex-wrap items-center gap-2">{toolbar}</div> : null}
        <EmptyState title={emptyTitle} description={emptyDescription} />
      </div>
    );
  }

  const pageKeys = pageRows.map(rowKey);

  return (
    <div className={cn("space-y-2", className)}>
      {toolbar || exportMenu ? (
        <div className="flex flex-wrap items-center gap-2">
          {toolbar}
          {exportMenu ? <div className="ml-auto">{exportMenu}</div> : null}
        </div>
      ) : null}

      <div className="erp-data-table-wrap overflow-x-auto">
        <table className={cn("w-full text-left text-sm", minWidth)}>
          <thead className="border-b border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] text-[11px] uppercase tracking-wide text-muted-foreground">
            <tr>
              {withSelection ? (
                <th className="w-10 px-3 py-3">
                  <RowCheckbox
                    checked={selection.allSelected(pageKeys)}
                    indeterminate={selection.someSelected(pageKeys)}
                    onChange={() => selection.toggleAll(pageKeys)}
                    label="Select all rows on this page"
                  />
                </th>
              ) : null}
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
              {rowActions?.length ? <th className="w-12 px-2 py-3" aria-label="Actions" /> : null}
            </tr>
          </thead>
          <tbody className="divide-y divide-[rgba(32,48,80,0.08)]">
            {pageRows.map((row) => {
              const key = rowKey(row);
              const picked = withSelection && selection.isSelected(key);
              return (
                <tr
                  key={key}
                  onClick={onRowClick ? () => onRowClick(row) : undefined}
                  className={cn(
                    "hover:bg-[rgba(32,48,80,0.02)]",
                    picked && "bg-[var(--accent)]",
                    onRowClick && "cursor-pointer",
                  )}
                >
                  {withSelection ? (
                    <td className="w-10 px-3 py-2.5">
                      <RowCheckbox
                        checked={picked}
                        onChange={() => selection.toggle(key)}
                        label={`Select row ${key}`}
                      />
                    </td>
                  ) : null}
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
                  {rowActions?.length ? (
                    <td className="w-12 px-2 py-1.5 text-right">
                      <RowActionMenu row={row} actions={rowActions} label={rowActionsLabel} />
                    </td>
                  ) : null}
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>

      {bulkActions?.length ? (
        <BulkActionBar selection={selection} actions={bulkActions} noun={selectionNoun} />
      ) : null}

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
