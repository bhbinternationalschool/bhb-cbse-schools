"use client";

/**
 * Month-grouped rows — the kit for lists that grow by one row per event.
 *
 *   const month = useMonthGroups({ rows, dateOf: (r) => r.createdAt,
 *                                  filterActive: q !== "", filterKey: q });
 *   <ErpTable>
 *     <ErpTableHead>…</ErpTableHead>
 *     <MonthGroupedTbody month={month} colSpan={6} renderRow={(r) => <tr …/>}
 *        rowKey={(r) => r.id}
 *        summary={(rows) => formatInr(sum(rows))} empty={<tr>…</tr>} />
 *   </ErpTable>
 *
 * Each month is a full-width header row (a real <button> with
 * aria-expanded, so Enter / Space / click all toggle) followed by its own
 * <tbody> of rows. The newest month is open, older months are folded.
 * Grouping rules (IST months, "No date" never dropped) live in
 * lib/monthGroups.ts with a self-test.
 *
 * What folding must never do, and how each is prevented:
 *
 *   - Export. ErpTableShell's `exportAs` reads the rendered table. Folded
 *     months stay MOUNTED (their <tbody> is `hidden`, not removed), and the
 *     shell's reader un-hides them for the instant it reads, so an export
 *     always carries every month — exactly as an expanded table would read.
 *     Group header rows carry `data-month-group` and are skipped.
 *   - Search. Pass `filterActive` while a search or filter narrows the
 *     rows: every month that still has rows opens, so a match is never
 *     inside a folded group.
 *   - Selection. "Select all" in a screen means the filtered set, folded
 *     months included — the same rows an export would carry. Each header
 *     shows how many of its rows are ticked, and `selectedHidden()` gives
 *     the count inside folded months for the bulk bar to say out loud.
 *   - Totals. `summary(rows)` is called with the very rows of that group.
 */

import { ChevronRight } from "lucide-react";
import {
  Fragment,
  useCallback,
  useEffect,
  useId,
  useMemo,
  useState,
  type ReactNode,
} from "react";

import {
  groupRowsByMonth,
  openMonthKeys,
  selectedInClosedGroups,
  type MonthGroup,
} from "@/lib/monthGroups";
import { cn } from "@/lib/utils";

const STORAGE_PREFIX = "erp.monthGroups.";

function readRemembered(storageKey: string | undefined): Record<string, boolean> {
  if (!storageKey || typeof window === "undefined") return {};
  try {
    const raw = window.localStorage.getItem(STORAGE_PREFIX + storageKey);
    if (!raw) return {};
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return {};
    const out: Record<string, boolean> = {};
    for (const [k, v] of Object.entries(parsed as Record<string, unknown>)) {
      if (typeof v === "boolean") out[k] = v;
    }
    return out;
  } catch {
    return {};
  }
}

function writeRemembered(storageKey: string | undefined, value: Record<string, boolean>) {
  if (!storageKey || typeof window === "undefined") return;
  try {
    window.localStorage.setItem(STORAGE_PREFIX + storageKey, JSON.stringify(value));
  } catch {
    /* A full or blocked store only costs the remembered fold state. */
  }
}

export type MonthGroupsState<T> = {
  groups: MonthGroup<T>[];
  open: Set<string>;
  isOpen: (key: string) => boolean;
  toggle: (key: string) => void;
  /** Open (true) or fold (false) every month. */
  setAll: (open: boolean) => void;
  /** Rows ticked by `isSelected` that sit inside folded months. */
  selectedHidden: (isSelected: (row: T) => boolean) => number;
  /** Total rows across all groups (equals the rows passed in). */
  total: number;
};

export function useMonthGroups<T>({
  rows,
  dateOf,
  filterActive = false,
  filterKey = "",
  storageKey,
}: {
  rows: readonly T[];
  /** The row's date: Date, epoch ms, "YYYY-MM", "YYYY-MM-DD" or ISO stamp. */
  dateOf: (row: T) => unknown;
  /** True while a search or filter narrows `rows`: every month opens. */
  filterActive?: boolean;
  /** Anything that changes when the filter changes (e.g. the query). */
  filterKey?: string;
  /** Remember this viewer's folds per screen (localStorage, optional). */
  storageKey?: string;
}): MonthGroupsState<T> {
  // dateOf is usually an inline arrow; the rows are what matter.
  // eslint-disable-next-line react-hooks/exhaustive-deps
  const groups = useMemo(() => groupRowsByMonth(rows, dateOf), [rows]);

  const [overrides, setOverrides] = useState<Record<string, boolean>>({});
  useEffect(() => {
    // After mount, so the server render and the first client render agree.
    setOverrides(readRemembered(storageKey));
  }, [storageKey]);

  // Folds made while searching belong to that search only.
  const [filterFolds, setFilterFolds] = useState<{
    key: string;
    map: Record<string, boolean>;
  }>({ key: "", map: {} });
  const filterOverrides = filterFolds.key === filterKey ? filterFolds.map : {};

  const open = useMemo(
    () => openMonthKeys(groups, { filterActive, overrides, filterOverrides }),
    [groups, filterActive, overrides, filterOverrides],
  );

  const toggle = useCallback(
    (key: string) => {
      const next = !open.has(key);
      if (filterActive) {
        setFilterFolds((prev) => ({
          key: filterKey,
          map: { ...(prev.key === filterKey ? prev.map : {}), [key]: next },
        }));
        return;
      }
      setOverrides((prev) => {
        const merged = { ...prev, [key]: next };
        writeRemembered(storageKey, merged);
        return merged;
      });
    },
    [open, filterActive, filterKey, storageKey],
  );

  const setAll = useCallback(
    (to: boolean) => {
      const map: Record<string, boolean> = {};
      for (const g of groups) map[g.key] = to;
      if (filterActive) {
        setFilterFolds({ key: filterKey, map });
        return;
      }
      setOverrides((prev) => {
        const merged = { ...prev, ...map };
        writeRemembered(storageKey, merged);
        return merged;
      });
    },
    [groups, filterActive, filterKey, storageKey],
  );

  return useMemo(
    () => ({
      groups,
      open,
      isOpen: (key: string) => open.has(key),
      toggle,
      setAll,
      selectedHidden: (isSelected: (row: T) => boolean) =>
        selectedInClosedGroups(groups, open, isSelected),
      total: rows.length,
    }),
    [groups, open, toggle, setAll, rows.length],
  );
}

function defaultCount(n: number) {
  return `${n} ${n === 1 ? "row" : "rows"}`;
}

/** The clickable month header — shared by the table and list variants. */
function MonthGroupToggle({
  label,
  open,
  controls,
  countText,
  summary,
  selected,
  onToggle,
  stickyLabel,
}: {
  label: string;
  open: boolean;
  controls: string;
  countText: string;
  summary?: ReactNode;
  selected?: number;
  onToggle: () => void;
  stickyLabel?: boolean;
}) {
  return (
    <button
      type="button"
      aria-expanded={open}
      aria-controls={controls}
      onClick={onToggle}
      className="block w-full px-0 text-left transition-colors duration-[var(--motion-fast)] hover:bg-[var(--surface-sunken)] focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--ring)] focus-visible:ring-inset"
    >
      <span
        className={cn(
          "flex max-w-[calc(100vw-2rem)] flex-wrap items-center gap-x-2 gap-y-0.5 px-4 py-2",
          stickyLabel && "sticky left-0",
        )}
      >
        <ChevronRight
          aria-hidden
          className={cn(
            "size-4 shrink-0 text-[var(--muted)] transition-transform duration-[var(--motion-fast)]",
            open && "rotate-90",
          )}
        />
        <span className="text-[13px] font-semibold text-[var(--brand-deep)]">{label}</span>
        <span className="rounded-full bg-[var(--surface-sunken)] px-2 py-0.5 text-[11px] font-medium text-[var(--muted)]">
          {countText}
        </span>
        {summary != null && summary !== "" ? (
          <span className="text-[12px] font-medium text-[var(--foreground)]">{summary}</span>
        ) : null}
        {selected ? (
          <span className="text-[11px] font-semibold text-[var(--chart-1)]">
            {selected} ticked
          </span>
        ) : null}
      </span>
    </button>
  );
}

/**
 * The body of a month-grouped table: one header row and one <tbody> per
 * month. Put it inside <ErpTable> in place of <ErpTableBody>.
 */
export function MonthGroupedTbody<T>({
  month,
  colSpan,
  rowKey,
  renderRow,
  summary,
  countLabel = defaultCount,
  isRowSelected,
  empty,
  zebra = false,
}: {
  month: MonthGroupsState<T>;
  /** Number of columns in the table, so the month header spans them all. */
  colSpan: number;
  rowKey: (row: T) => string;
  renderRow: (row: T, indexInGroup: number) => ReactNode;
  /** Optional summary for the header (e.g. a total), from that month's rows. */
  summary?: (rows: T[]) => ReactNode;
  countLabel?: (n: number) => string;
  /** When the screen has row ticks: shows "N ticked" on each month header. */
  isRowSelected?: (row: T) => boolean;
  /** Rendered (inside a <tbody>) when there are no rows at all. */
  empty?: ReactNode;
  zebra?: boolean;
}) {
  const baseId = useId();
  if (month.groups.length === 0) {
    return empty ? <tbody>{empty}</tbody> : null;
  }
  return (
    <>
      {month.groups.map((g) => {
        const open = month.isOpen(g.key);
        const bodyId = `${baseId}-m-${g.key}`;
        const selected = isRowSelected ? g.rows.filter(isRowSelected).length : 0;
        return (
          <Fragment key={g.key}>
            <tbody className="border-t border-[var(--border)]">
              <tr data-month-group={g.key} className="bg-[var(--card)]">
                <td colSpan={colSpan} className="p-0">
                  <MonthGroupToggle
                    label={g.label}
                    open={open}
                    controls={bodyId}
                    countText={countLabel(g.rows.length)}
                    summary={summary ? summary(g.rows) : undefined}
                    selected={selected}
                    onToggle={() => month.toggle(g.key)}
                    stickyLabel
                  />
                </td>
              </tr>
            </tbody>
            <tbody
              id={bodyId}
              data-month-rows={g.key}
              hidden={!open}
              className={cn(
                "divide-y divide-[var(--border)] border-t border-[var(--border)]",
                zebra && "[&>tr:nth-child(even)]:bg-[var(--surface-sunken)]",
              )}
            >
              {g.rows.map((row, i) => (
                <Fragment key={rowKey(row)}>{renderRow(row, i)}</Fragment>
              ))}
            </tbody>
          </Fragment>
        );
      })}
    </>
  );
}

/**
 * The same grouping for a plain list (<ul>) rather than a table. Folded
 * months stay mounted but hidden, like the table variant.
 */
export function MonthGroupedList<T>({
  month,
  rowKey,
  renderItem,
  summary,
  countLabel = defaultCount,
  isRowSelected,
  listClassName = "divide-y divide-[var(--border)]",
  empty,
}: {
  month: MonthGroupsState<T>;
  rowKey: (row: T) => string;
  renderItem: (row: T, indexInGroup: number) => ReactNode;
  summary?: (rows: T[]) => ReactNode;
  countLabel?: (n: number) => string;
  isRowSelected?: (row: T) => boolean;
  listClassName?: string;
  empty?: ReactNode;
}) {
  const baseId = useId();
  if (month.groups.length === 0) return empty ? <>{empty}</> : null;
  return (
    <div className="divide-y divide-[var(--border)]">
      {month.groups.map((g) => {
        const open = month.isOpen(g.key);
        const listId = `${baseId}-m-${g.key}`;
        const selected = isRowSelected ? g.rows.filter(isRowSelected).length : 0;
        return (
          <section key={g.key} data-month-group={g.key}>
            <MonthGroupToggle
              label={g.label}
              open={open}
              controls={listId}
              countText={countLabel(g.rows.length)}
              summary={summary ? summary(g.rows) : undefined}
              selected={selected}
              onToggle={() => month.toggle(g.key)}
            />
            <ul
              id={listId}
              data-month-rows={g.key}
              hidden={!open}
              className={cn("border-t border-[var(--border)]", listClassName)}
            >
              {g.rows.map((row, i) => (
                <Fragment key={rowKey(row)}>{renderItem(row, i)}</Fragment>
              ))}
            </ul>
          </section>
        );
      })}
    </div>
  );
}
