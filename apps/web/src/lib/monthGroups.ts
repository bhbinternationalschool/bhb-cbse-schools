/**
 * Month grouping for lists that grow by one row per event — payroll runs,
 * automation runs, vouchers, receipts, logs.
 *
 * The director's complaint (15 Oct 2026): "check runs are growing in rows".
 * A list that gains a row every time something happens becomes a long page
 * in a few months. Grouping by month keeps the newest month open and folds
 * the rest behind one header row each, so the page stays short without
 * hiding anything: every row is still in exactly one group.
 *
 * Pure logic only — the React kit is components/ui/month-grouped-rows.tsx.
 *
 * Rules this module guarantees (month-groups.selftest.ts proves each):
 *
 *   - Months are IST calendar months. 2026-09-30T20:00Z is 1 Oct 01:30 in
 *     India, so it belongs to October, not September.
 *   - A date-only value ("2026-09-30") or a month value ("2026-09") is a
 *     calendar date the school wrote down; it is read as written, never
 *     shifted by a time zone.
 *   - A row whose date is missing or unreadable goes to the "No date" group.
 *     It is never dropped and never guessed into a month: "03/04/2026" could
 *     be March or April, and an unknown must not become a fact.
 *   - Newest month first; "No date" last. Rows keep the caller's order
 *     inside a group (the caller already sorts its list).
 *   - The groups partition the input: every row lands in exactly one group.
 */

export const NO_DATE_KEY = "no-date";

export const MONTH_NAMES = [
  "January",
  "February",
  "March",
  "April",
  "May",
  "June",
  "July",
  "August",
  "September",
  "October",
  "November",
  "December",
] as const;

/** IST is UTC+05:30 all year (no daylight saving). */
const IST_OFFSET_MS = (5 * 60 + 30) * 60 * 1000;

function pad2(n: number) {
  return n < 10 ? `0${n}` : String(n);
}

function plausibleYear(y: number) {
  return Number.isInteger(y) && y >= 1900 && y <= 2200;
}

function keyFromInstant(ms: number): string | null {
  if (!Number.isFinite(ms)) return null;
  const ist = new Date(ms + IST_OFFSET_MS);
  const y = ist.getUTCFullYear();
  if (!plausibleYear(y)) return null;
  return `${y}-${pad2(ist.getUTCMonth() + 1)}`;
}

function validDay(y: number, m: number, d: number) {
  if (m < 1 || m > 12 || d < 1) return false;
  const last = new Date(Date.UTC(y, m, 0)).getUTCDate();
  return d <= last;
}

/**
 * The IST month ("YYYY-MM") a value falls in, or null when it cannot be
 * read with certainty.
 *
 * Accepts: Date, epoch milliseconds, "YYYY-MM", "YYYY-MM-DD", and ISO
 * timestamps. A timestamp WITH a zone (Z, +00:00, +05:30) is converted to
 * IST; one WITHOUT a zone is a wall-clock time and its written date is used.
 * Anything else — "03/04/2026", "Sept", "" — is null.
 */
export function istMonthKey(value: unknown): string | null {
  if (value == null) return null;
  if (value instanceof Date) return keyFromInstant(value.getTime());
  if (typeof value === "number") return keyFromInstant(value);
  if (typeof value !== "string") return null;
  const s = value.trim();
  if (!s) return null;

  const month = /^(\d{4})-(\d{2})$/.exec(s);
  if (month) {
    const y = Number(month[1]);
    const m = Number(month[2]);
    return plausibleYear(y) && m >= 1 && m <= 12 ? `${y}-${pad2(m)}` : null;
  }

  // Calendar date, optionally followed by a wall-clock time with no zone.
  const wall = /^(\d{4})-(\d{2})-(\d{2})(?:[T ](\d{2}):(\d{2})(?::\d{2}(?:\.\d+)?)?)?$/.exec(s);
  if (wall) {
    const y = Number(wall[1]);
    const m = Number(wall[2]);
    const d = Number(wall[3]);
    return plausibleYear(y) && validDay(y, m, d) ? `${y}-${pad2(m)}` : null;
  }

  // A timestamp with an explicit zone: an instant, so convert to IST.
  const zoned = /^(\d{4})-(\d{2})-(\d{2})[T ]\d{2}:\d{2}(?::\d{2}(?:\.\d+)?)?(?:Z|[+-]\d{2}:?\d{2})$/i.exec(s);
  if (zoned) {
    if (!validDay(Number(zoned[1]), Number(zoned[2]), Number(zoned[3]))) return null;
    return keyFromInstant(Date.parse(s.replace(" ", "T")));
  }
  return null;
}

/** "October 2026", or "No date" for the undated group. */
export function monthKeyLabel(key: string): string {
  if (key === NO_DATE_KEY) return "No date";
  const m = /^(\d{4})-(\d{2})$/.exec(key);
  if (!m) return key;
  const name = MONTH_NAMES[Number(m[2]) - 1];
  return name ? `${name} ${m[1]}` : key;
}

export type MonthGroup<T> = {
  /** "YYYY-MM", or NO_DATE_KEY. */
  key: string;
  label: string;
  rows: T[];
  isNoDate: boolean;
};

/**
 * Split rows into IST months, newest first, undated last. Rows keep their
 * input order inside each group.
 */
export function groupRowsByMonth<T>(
  rows: readonly T[],
  dateOf: (row: T) => unknown,
): MonthGroup<T>[] {
  const byKey = new Map<string, T[]>();
  for (const row of rows) {
    let key: string | null = null;
    try {
      key = istMonthKey(dateOf(row));
    } catch {
      key = null;
    }
    const k = key ?? NO_DATE_KEY;
    const list = byKey.get(k);
    if (list) list.push(row);
    else byKey.set(k, [row]);
  }
  const keys = [...byKey.keys()].sort((a, b) => {
    if (a === NO_DATE_KEY) return 1;
    if (b === NO_DATE_KEY) return -1;
    return b.localeCompare(a);
  });
  return keys.map((key) => ({
    key,
    label: monthKeyLabel(key),
    rows: byKey.get(key)!,
    isNoDate: key === NO_DATE_KEY,
  }));
}

/**
 * Which groups are open.
 *
 *   - No filter: the newest group is open, the rest are closed, unless the
 *     viewer toggled one (`overrides`, which a screen may remember). A month
 *     in `attention` (it holds a row someone still has to act on — a pending
 *     leave, an open request) also starts open: folding must not bury work.
 *   - A search or filter is active: EVERY group is open, because the rows
 *     passed in are already the matches and a match must never sit hidden
 *     in a folded month. The viewer can still fold one while searching
 *     (`filterOverrides`, which the hook resets whenever the filter changes).
 */
export function openMonthKeys<T>(
  groups: readonly MonthGroup<T>[],
  opts: {
    filterActive?: boolean;
    overrides?: Readonly<Record<string, boolean>>;
    filterOverrides?: Readonly<Record<string, boolean>>;
    attention?: ReadonlySet<string>;
  } = {},
): Set<string> {
  const open = new Set<string>();
  const newest = groups[0]?.key;
  for (const g of groups) {
    const isOpen = opts.filterActive
      ? (opts.filterOverrides?.[g.key] ?? true)
      : (opts.overrides?.[g.key] ?? (g.key === newest || !!opts.attention?.has(g.key)));
    if (isOpen) open.add(g.key);
  }
  return open;
}

/**
 * How many selected rows sit inside folded months. A screen with a bulk bar
 * shows this so a "select all" that ticked rows the viewer cannot see says
 * so before anything is run on them.
 */
export function selectedInClosedGroups<T>(
  groups: readonly MonthGroup<T>[],
  open: ReadonlySet<string>,
  isSelected: (row: T) => boolean,
): number {
  let n = 0;
  for (const g of groups) {
    if (open.has(g.key)) continue;
    for (const r of g.rows) if (isSelected(r)) n += 1;
  }
  return n;
}

/** The months holding at least one row that still needs someone to act. */
export function attentionMonthKeys<T>(
  groups: readonly MonthGroup<T>[],
  needsAttention: (row: T) => boolean,
): Set<string> {
  const out = new Set<string>();
  for (const g of groups) if (g.rows.some(needsAttention)) out.add(g.key);
  return out;
}
