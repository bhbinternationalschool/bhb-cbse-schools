"use client";

/**
 * The premium grid kit — the pieces every data-heavy screen shares.
 *
 *   ErpControlBar   one row: search · filter toggles · actions · Export data
 *   RowActionMenu   the "…" trigger on every row, with a proper menu
 *   BulkActionBar   slides up when rows are ticked; bulk status / WhatsApp / PDF
 *   ExportMenu      Excel (.xlsx) · CSV · print-ready PDF of the filtered rows
 *   useRowSelection the checkbox state a bulk bar needs
 *
 * These exist so a screen can carry the full standard — metric cards, a
 * unified control bar, a grid whose every row has actions and a checkbox,
 * and a three-format export of exactly what is on screen — without each of
 * the 40 modules re-inventing a dropdown or a CSV writer. DataTable (ui/
 * data-table.tsx) composes them; screens with a bespoke list use them
 * directly.
 */

import {
  CheckSquare,
  Download,
  FileSpreadsheet,
  FileText,
  MoreHorizontal,
  Table2,
  X,
} from "lucide-react";
import {
  useCallback,
  useEffect,
  useId,
  useMemo,
  useRef,
  useState,
  type ReactNode,
} from "react";

import {
  downloadExcelCsv,
  downloadPdfReport,
  downloadXlsxReport,
  type ReportColumn,
} from "@/lib/reportExport";
import { cn } from "@/lib/utils";

/* ─── Selection ─────────────────────────────────────────────── */

export type RowSelection = {
  selected: Set<string>;
  count: number;
  isSelected: (key: string) => boolean;
  toggle: (key: string) => void;
  /** Tick every key in `visible` (or clear them all when they already are). */
  toggleAll: (visible: string[]) => void;
  setMany: (keys: string[], on: boolean) => void;
  clear: () => void;
  allSelected: (visible: string[]) => boolean;
  someSelected: (visible: string[]) => boolean;
};

/**
 * Checkbox state for a list. Keys that leave the list (a filter narrowed it)
 * stay selected on purpose — an office ticks ten pupils, refines the search,
 * ticks two more, and expects twelve — but `prune` drops keys no longer known
 * so a deleted row cannot be acted on.
 */
export function useRowSelection(knownKeys?: string[]): RowSelection {
  const [selected, setSelected] = useState<Set<string>>(() => new Set());

  useEffect(() => {
    if (!knownKeys) return;
    const known = new Set(knownKeys);
    setSelected((prev) => {
      let changed = false;
      const next = new Set<string>();
      for (const k of prev) {
        if (known.has(k)) next.add(k);
        else changed = true;
      }
      return changed ? next : prev;
    });
  }, [knownKeys]);

  const toggle = useCallback((key: string) => {
    setSelected((prev) => {
      const next = new Set(prev);
      if (next.has(key)) next.delete(key);
      else next.add(key);
      return next;
    });
  }, []);
  const setMany = useCallback((keys: string[], on: boolean) => {
    setSelected((prev) => {
      const next = new Set(prev);
      for (const k of keys) {
        if (on) next.add(k);
        else next.delete(k);
      }
      return next;
    });
  }, []);
  const toggleAll = useCallback(
    (visible: string[]) => {
      const every = visible.length > 0 && visible.every((k) => selected.has(k));
      setMany(visible, !every);
    },
    [selected, setMany],
  );
  const clear = useCallback(() => setSelected(new Set()), []);

  return useMemo(
    () => ({
      selected,
      count: selected.size,
      isSelected: (key: string) => selected.has(key),
      toggle,
      toggleAll,
      setMany,
      clear,
      allSelected: (visible: string[]) =>
        visible.length > 0 && visible.every((k) => selected.has(k)),
      someSelected: (visible: string[]) => visible.some((k) => selected.has(k)),
    }),
    [selected, toggle, toggleAll, setMany, clear],
  );
}

export function RowCheckbox({
  checked,
  indeterminate = false,
  onChange,
  label,
  className,
}: {
  checked: boolean;
  indeterminate?: boolean;
  onChange: () => void;
  label: string;
  className?: string;
}) {
  const ref = useRef<HTMLInputElement>(null);
  useEffect(() => {
    if (ref.current) ref.current.indeterminate = indeterminate && !checked;
  }, [indeterminate, checked]);
  return (
    <input
      ref={ref}
      type="checkbox"
      checked={checked}
      onChange={onChange}
      onClick={(e) => e.stopPropagation()}
      aria-label={label}
      className={cn(
        "size-4 shrink-0 cursor-pointer rounded border-[var(--border)] accent-[var(--brand-deep)]",
        className,
      )}
    />
  );
}

/* ─── Popover plumbing shared by the menus ──────────────────── */

function useDismissable(open: boolean, close: () => void) {
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    const onDown = (e: MouseEvent | TouchEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) close();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") close();
    };
    document.addEventListener("mousedown", onDown);
    document.addEventListener("touchstart", onDown);
    document.addEventListener("keydown", onKey);
    return () => {
      document.removeEventListener("mousedown", onDown);
      document.removeEventListener("touchstart", onDown);
      document.removeEventListener("keydown", onKey);
    };
  }, [open, close]);
  return ref;
}

const MENU_PANEL =
  "absolute right-0 z-40 mt-1 min-w-[12rem] overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)] py-1 text-sm shadow-[var(--shadow-2,0_12px_32px_rgba(0,0,0,0.18))]";
const MENU_ITEM =
  "flex w-full items-center gap-2 px-3 py-2 text-left text-[13px] text-[var(--foreground)] hover:bg-[var(--surface-sunken)] disabled:cursor-not-allowed disabled:opacity-40";

/* ─── Row actions ───────────────────────────────────────────── */

export type RowAction<T> = {
  id: string;
  label: string;
  icon?: ReactNode;
  onSelect: (row: T) => void;
  tone?: "default" | "danger";
  disabled?: (row: T) => boolean;
  hidden?: (row: T) => boolean;
  /** A thin rule above this item — groups "danger" actions away from the rest. */
  separatorAbove?: boolean;
};

/** The "…" trigger every row carries, and the menu behind it. */
export function RowActionMenu<T>({
  row,
  actions,
  label = "Row actions",
  className,
}: {
  row: T;
  actions: RowAction<T>[];
  label?: string;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismissable(open, close);
  const id = useId();
  const visible = actions.filter((a) => !a.hidden?.(row));
  if (visible.length === 0) return null;

  return (
    <div ref={ref} className={cn("relative inline-block text-left", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        aria-label={label}
        title={label}
        onClick={(e) => {
          e.stopPropagation();
          setOpen((o) => !o);
        }}
        className="inline-flex size-8 items-center justify-center rounded-lg border border-transparent text-[var(--muted)] hover:border-[var(--border)] hover:bg-[var(--surface-sunken)] hover:text-[var(--brand-deep)]"
      >
        <MoreHorizontal className="size-4" />
      </button>
      {open ? (
        <div id={id} role="menu" className={MENU_PANEL} onClick={(e) => e.stopPropagation()}>
          {visible.map((a) => (
            <div key={a.id}>
              {a.separatorAbove ? <div className="my-1 border-t border-[var(--border)]" /> : null}
              <button
                type="button"
                role="menuitem"
                disabled={a.disabled?.(row) ?? false}
                onClick={() => {
                  close();
                  a.onSelect(row);
                }}
                className={cn(MENU_ITEM, a.tone === "danger" && "text-[var(--danger)]")}
              >
                {a.icon ? <span className="shrink-0 opacity-80 [&>svg]:size-4">{a.icon}</span> : null}
                {a.label}
              </button>
            </div>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ─── Bulk actions ──────────────────────────────────────────── */

export type BulkAction = {
  id: string;
  label: string;
  icon?: ReactNode;
  onRun: (keys: string[]) => void | Promise<void>;
  tone?: "default" | "danger";
  disabled?: boolean;
  title?: string;
};

/**
 * Slides up from the bottom of the viewport the moment a row is ticked.
 * Stays out of the way of the sidebar and bottom nav; the actions are the
 * screen's own (bulk status, bulk WhatsApp, mass PDFs, UDISE+ export …).
 */
export function BulkActionBar({
  selection,
  actions,
  noun = "row",
  className,
}: {
  selection: RowSelection;
  actions: BulkAction[];
  noun?: string;
  className?: string;
}) {
  const [busy, setBusy] = useState("");
  const shown = selection.count > 0;
  return (
    <div
      aria-live="polite"
      aria-hidden={!shown}
      className={cn(
        "pointer-events-none fixed inset-x-0 bottom-3 z-30 flex justify-center px-3 transition-all duration-200 md:bottom-4 md:pl-[calc(var(--erp-sidebar-w,16rem)+1rem)]",
        shown ? "translate-y-0 opacity-100" : "invisible translate-y-6 opacity-0",
        className,
      )}
    >
      <div
        className={cn(
          "pointer-events-auto flex max-w-full flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 shadow-[var(--shadow-2,0_16px_40px_rgba(0,0,0,0.22))]",
          !shown && "pointer-events-none",
        )}
      >
        <span className="inline-flex items-center gap-1.5 rounded-lg bg-[var(--brand-deep)] px-2.5 py-1 text-xs font-bold text-white">
          <CheckSquare className="size-3.5" />
          {selection.count} {noun}
          {selection.count === 1 ? "" : "s"} selected
        </span>
        {actions.map((a) => (
          <button
            key={a.id}
            type="button"
            title={a.title}
            disabled={a.disabled || busy === a.id}
            onClick={async () => {
              setBusy(a.id);
              try {
                await a.onRun([...selection.selected]);
              } finally {
                setBusy("");
              }
            }}
            className={cn(
              "inline-flex items-center gap-1.5 rounded-lg border px-2.5 py-1.5 text-xs font-semibold disabled:opacity-50",
              a.tone === "danger"
                ? "border-[var(--danger)] text-[var(--danger)] hover:bg-[var(--danger-soft)]"
                : "border-[var(--border)] bg-[var(--surface)] text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]",
            )}
          >
            {a.icon ? <span className="[&>svg]:size-3.5">{a.icon}</span> : null}
            {busy === a.id ? "Working…" : a.label}
          </button>
        ))}
        <button
          type="button"
          onClick={selection.clear}
          aria-label="Clear selection"
          className="ml-1 inline-flex size-7 items-center justify-center rounded-lg text-[var(--muted)] hover:bg-[var(--surface-sunken)] hover:text-[var(--brand-deep)]"
        >
          <X className="size-4" />
        </button>
      </div>
    </div>
  );
}

/* ─── Export ────────────────────────────────────────────────── */

export type ExportFormat = "xlsx" | "csv" | "pdf";
export type ExportRow = Record<string, string | number | null | undefined>;

/**
 * "Export data" for the top-right corner of a data container. Exports the
 * rows the screen is showing — filtered, sorted — as a real workbook (auto
 * widths, frozen header, autofilter), a clean CSV, or a print-ready PDF.
 * `rows` is a function so the export reads the live filtered set.
 */
export function ExportMenu({
  title,
  subtitle,
  filterNote,
  columns,
  rows,
  fileBaseName,
  formats = ["xlsx", "csv", "pdf"],
  onMessage,
  compact = false,
  className,
}: {
  title: string;
  subtitle?: string;
  filterNote?: string;
  columns: ReportColumn[];
  rows: () => ExportRow[];
  fileBaseName: string;
  formats?: ExportFormat[];
  onMessage?: (msg: string) => void;
  compact?: boolean;
  className?: string;
}) {
  const [open, setOpen] = useState(false);
  const [busy, setBusy] = useState<ExportFormat | "">("");
  const close = useCallback(() => setOpen(false), []);
  const ref = useDismissable(open, close);
  const id = useId();

  async function run(format: ExportFormat) {
    close();
    const data = rows();
    if (data.length === 0) {
      onMessage?.("Nothing to export — no rows match");
      return;
    }
    setBusy(format);
    try {
      const input = { title, subtitle, filterNote, columns, rows: data, fileBaseName };
      if (format === "xlsx") await downloadXlsxReport(input);
      else if (format === "csv") downloadExcelCsv(input);
      else await downloadPdfReport(input);
      onMessage?.(
        `${format === "xlsx" ? "Excel" : format === "csv" ? "CSV" : "PDF"} · ${data.length} row${data.length === 1 ? "" : "s"}`,
      );
    } catch (e) {
      onMessage?.(e instanceof Error ? e.message : "Export failed");
    } finally {
      setBusy("");
    }
  }

  const ITEMS: { f: ExportFormat; label: string; icon: ReactNode; hint: string }[] = [
    { f: "xlsx", label: "Excel (.xlsx)", icon: <FileSpreadsheet />, hint: "auto widths, frozen header, filters" },
    { f: "csv", label: "CSV (.csv)", icon: <Table2 />, hint: "plain rows for other systems" },
    { f: "pdf", label: "PDF (print)", icon: <FileText />, hint: "landscape, banded, page numbers" },
  ];

  return (
    <div ref={ref} className={cn("relative inline-block text-left", className)}>
      <button
        type="button"
        aria-haspopup="menu"
        aria-expanded={open}
        aria-controls={id}
        disabled={busy !== ""}
        onClick={() => setOpen((o) => !o)}
        className={cn(
          "inline-flex items-center gap-1.5 rounded-lg border border-[var(--border)] bg-[var(--card)] font-semibold text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)] disabled:opacity-60",
          compact ? "px-2 py-1 text-[11px]" : "px-3 py-1.5 text-xs",
        )}
      >
        <Download className={compact ? "size-3.5" : "size-4"} />
        {busy ? "Exporting…" : "Export data"}
      </button>
      {open ? (
        <div id={id} role="menu" className={MENU_PANEL}>
          {ITEMS.filter((i) => formats.includes(i.f)).map((i) => (
            <button key={i.f} type="button" role="menuitem" onClick={() => void run(i.f)} className={MENU_ITEM}>
              <span className="shrink-0 opacity-80 [&>svg]:size-4">{i.icon}</span>
              <span className="flex flex-col">
                <span className="font-semibold">{i.label}</span>
                <span className="text-[11px] text-[var(--muted)]">{i.hint}</span>
              </span>
            </button>
          ))}
        </div>
      ) : null}
    </div>
  );
}

/* ─── Control bar ───────────────────────────────────────────── */

/**
 * The unified middle row: search on the left, filter toggles beside it,
 * contextual actions and the export menu on the right. One row on a wide
 * screen, wraps cleanly on a phone.
 */
export function ErpControlBar({
  search,
  filters,
  actions,
  exportMenu,
  summary,
  children,
  className,
}: {
  search?: {
    value: string;
    onChange: (v: string) => void;
    placeholder?: string;
    label?: string;
  };
  /** Filter toggles / facet selects / a "Filters" disclosure button. */
  filters?: ReactNode;
  /** Add · Edit · Delete · Bulk … — the screen's contextual actions. */
  actions?: ReactNode;
  exportMenu?: ReactNode;
  /** "237 of 249 shown" — sits with the search so the count is never far from what produced it. */
  summary?: ReactNode;
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "erp-control-bar flex flex-wrap items-center gap-2 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-3 py-2 shadow-[var(--shadow-1)]",
        className,
      )}
    >
      {search ? (
        <input
          className="field min-w-[12rem] flex-1"
          placeholder={search.placeholder ?? "Search…"}
          value={search.value}
          onChange={(e) => search.onChange(e.target.value)}
          aria-label={search.label ?? search.placeholder ?? "Search"}
        />
      ) : null}
      {summary ? <span className="text-[11px] text-[var(--muted)]">{summary}</span> : null}
      {filters ? <div className="flex flex-wrap items-center gap-2">{filters}</div> : null}
      {children}
      {actions || exportMenu ? (
        <div className="ml-auto flex flex-wrap items-center gap-2">
          {actions}
          {exportMenu}
        </div>
      ) : null}
    </div>
  );
}
