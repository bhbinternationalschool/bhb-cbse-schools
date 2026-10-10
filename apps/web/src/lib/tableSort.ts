/**
 * Comparison rules shared by every sortable table in the ERP.
 *
 * Pure and React-free so the ordering can be tested without rendering
 * anything — the React binding lives in `components/ui/erp-table-sort.tsx`.
 */

export type SortDir = "asc" | "desc";

/** What a column yields for ordering. `null` means the cell has no value. */
export type SortValue = string | number | boolean | null;

/**
 * Blank cells sink to the bottom in BOTH directions.
 *
 * A student with no roll number is not "roll number zero", and a stop with no
 * measured distance is not "nearest". Sorting them as if they were the
 * smallest value silently turns an unknown into a fact — the class of defect
 * this codebase keeps having to fix. They are unknown, so they go last, and
 * reversing the sort does not promote them to the top.
 */
function rank(v: SortValue): 0 | 1 {
  if (v === null || v === undefined) return 1;
  if (typeof v === "string" && v.trim() === "") return 1;
  return 0;
}

const collator = new Intl.Collator("en-IN", {
  numeric: true, // "Class 10" after "Class 9", and roll 2 before roll 10
  sensitivity: "base",
});

export function compareSortValues(
  a: SortValue,
  b: SortValue,
  dir: SortDir = "asc",
): number {
  const ra = rank(a);
  const rb = rank(b);
  // Blanks last regardless of direction — deliberately outside the flip below.
  if (ra !== rb) return ra - rb;
  if (ra === 1) return 0;

  let cmp: number;
  if (typeof a === "number" && typeof b === "number") {
    cmp = a - b;
  } else if (typeof a === "boolean" || typeof b === "boolean") {
    cmp = Number(a) - Number(b);
  } else {
    cmp = collator.compare(String(a), String(b));
  }
  return dir === "desc" ? -cmp : cmp;
}

/**
 * Sort a copy of `rows` by `get`, stably.
 *
 * Array.prototype.sort is stable in every engine this ships to, but ties are
 * decorated with the original index anyway so the guarantee is explicit: a
 * clerk re-sorting a roster should never see equal rows shuffle.
 */
export function sortRowsBy<T>(
  rows: T[],
  get: (row: T) => SortValue,
  dir: SortDir = "asc",
): T[] {
  return rows
    .map((row, i) => ({ row, i, v: get(row) }))
    .sort((x, y) => compareSortValues(x.v, y.v, dir) || x.i - y.i)
    .map((d) => d.row);
}

/** asc → desc → asc. Sorting never returns to "no order". */
export function nextSortDir(current: SortDir): SortDir {
  return current === "asc" ? "desc" : "asc";
}
