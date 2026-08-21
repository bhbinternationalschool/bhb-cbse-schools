"use client";

import { useMemo, useState } from "react";
import { cn } from "@/lib/utils";
import {
  nextSortDir,
  sortRowsBy,
  type SortDir,
  type SortValue,
} from "@/lib/tableSort";

/**
 * Sorting for any ERP table, in three lines.
 *
 *   const sort = useTableSort(riders, {
 *     name: (r) => r.fullName,
 *     fee: (r) => r.monthlyFeePaise,
 *   }, "name");
 *
 *   <ErpSortTh sort={sort} field="name">Student</ErpSortTh>
 *   {sort.rows.map(...)}
 *
 * Columns are described by what they yield, not by which cell they render, so
 * a column showing "₹2,500" sorts by the paise behind it rather than by the
 * string. Getting that wrong is the usual reason table sorting feels broken.
 */

export type TableSort<T, K extends string> = {
  rows: T[];
  field: K;
  dir: SortDir;
  toggle: (field: K) => void;
};

export function useTableSort<
  T,
  C extends Record<string, (row: T) => SortValue>,
>(
  rows: T[],
  columns: C,
  initialField: Extract<keyof C, string>,
  initialDir: SortDir = "asc",
): TableSort<T, Extract<keyof C, string>> {
  type K = Extract<keyof C, string>;
  const [field, setField] = useState<K>(initialField);
  const [dir, setDir] = useState<SortDir>(initialDir);

  const sorted = useMemo(() => {
    const get = columns[field];
    if (!get) return rows;
    return sortRowsBy(rows, get, dir);
    // `columns` is rebuilt each render by callers; keying on the field is
    // what actually matters and avoids re-sorting on every parent render.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [rows, field, dir]);

  return {
    rows: sorted,
    field,
    dir,
    toggle: (next: K) =>
      setField((cur) => {
        // Same column flips direction; a new column starts ascending, which is
        // what people expect when they first click a heading.
        if (cur === next) {
          setDir((d) => nextSortDir(d));
          return cur;
        }
        setDir("asc");
        return next;
      }),
  };
}

/**
 * A sortable `<th>`. Renders a real button so it is keyboard reachable, and
 * sets `aria-sort` so a screen reader announces the current order.
 */
export function ErpSortTh<T, K extends string>({
  sort,
  field,
  children,
  align = "left",
  className,
}: {
  sort: TableSort<T, K>;
  field: K;
  children: React.ReactNode;
  align?: "left" | "right";
  className?: string;
}) {
  const active = sort.field === field;
  return (
    <th
      scope="col"
      aria-sort={active ? (sort.dir === "asc" ? "ascending" : "descending") : "none"}
      className={cn("px-3 py-2 font-bold", align === "right" && "text-right", className)}
    >
      <button
        type="button"
        onClick={() => sort.toggle(field)}
        className={cn(
          "inline-flex items-center gap-1 uppercase tracking-wide hover:text-[var(--brand-deep)]",
          align === "right" && "flex-row-reverse",
          active && "text-[var(--brand-deep)]",
        )}
        title={`Sort by ${typeof children === "string" ? children : field}`}
      >
        <span>{children}</span>
        <span aria-hidden className={cn("text-[9px]", !active && "opacity-35")}>
          {active ? (sort.dir === "asc" ? "▲" : "▼") : "▲"}
        </span>
      </button>
    </th>
  );
}
