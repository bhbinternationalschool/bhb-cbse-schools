/**
 * Type-to-search for long pick lists — staff, expense heads, ledger accounts.
 *
 * Director, 14 Oct 2026: "build in search heads, staff in advance by alphabet
 * or make easier to pick name". A plain <select> of 100 staff ordered by
 * employee code, or 200 accounts ordered by code, made the office scroll and
 * read every line. These helpers are the pure part of the answer: every word
 * typed must appear somewhere in the row (name, code, designation…), the list
 * reads A→Z by name, and whatever this browser picked last sits on top.
 *
 * Pure apart from the two storage helpers at the bottom, which never throw.
 * Run the selftest: npx tsx src/lib/pickerSearch.selftest.ts
 */

export type PickItem = {
  /** What onChange receives — staff id, account code. */
  id: string;
  label: string;
  /** Second line: emp code · designation, or the account code. */
  sub?: string;
  /** Extra words that match a search but are not necessarily shown. */
  keywords?: string[];
  /** Heading the row sits under ("Recent", "Expenses"…). */
  group?: string;
  /** Indent level — a sub-head under its head is depth 1. */
  depth?: number;
  /**
   * Shown but not pickable: a category whose sub-heads are the real choices
   * stays on screen as the row the sub-heads hang from.
   */
  disabled?: boolean;
};

export const RECENT_GROUP = "Recent";
const MAX_RECENT_SHOWN = 5;

/** Locale-aware A→Z: "a" == "A", "Item 2" before "Item 10". */
export function compareLabels(a: string, b: string): number {
  return a.localeCompare(b, "en", { sensitivity: "base", numeric: true });
}

/** Lower-cased, whitespace-separated words of a query; [] for blank. */
export function queryTokens(query: string): string[] {
  return query
    .toLowerCase()
    .split(/\s+/)
    .map((t) => t.trim())
    .filter(Boolean);
}

function haystackOf(item: Pick<PickItem, "label" | "sub" | "keywords">): string {
  return [item.label, item.sub ?? "", ...(item.keywords ?? [])].join(" ").toLowerCase();
}

/** True when every query word appears somewhere in the row. */
export function pickItemMatches(
  item: Pick<PickItem, "label" | "sub" | "keywords">,
  tokens: string[],
): boolean {
  if (tokens.length === 0) return true;
  const hay = haystackOf(item);
  return tokens.every((t) => hay.includes(t));
}

/**
 * Filter a flat list. Matches come back A→Z by label; the recent picks that
 * still match (in recentIds order, at most five) come first under "Recent"
 * and are not repeated below — each id appears once, so keyboard focus and
 * option ids stay unambiguous. A blank query returns everything.
 */
export function filterPickItems(
  items: PickItem[],
  query: string,
  recentIds: string[] = [],
  opts: { maxRecent?: number; restGroup?: string } = {},
): PickItem[] {
  const tokens = queryTokens(query);
  const maxRecent = opts.maxRecent ?? MAX_RECENT_SHOWN;
  const matched = items.filter((it) => pickItemMatches(it, tokens));
  const byId = new Map(matched.map((it) => [it.id, it]));

  const recent: PickItem[] = [];
  const seen = new Set<string>();
  for (const id of recentIds) {
    if (recent.length >= maxRecent) break;
    if (seen.has(id)) continue;
    const it = byId.get(id);
    if (!it || it.disabled) continue;
    seen.add(id);
    recent.push({ ...it, group: RECENT_GROUP, depth: 0 });
  }

  const rest = matched
    .filter((it) => !seen.has(it.id))
    .sort((a, b) => compareLabels(a.label, b.label) || compareLabels(a.sub ?? "", b.sub ?? ""));
  // Under a "Recent" heading the remaining rows need a heading of their own,
  // or they read as more recent picks.
  const restGroup = opts.restGroup ?? "All";
  const restRows = recent.length > 0 ? rest.map((it) => ({ ...it, group: it.group ?? restGroup })) : rest;
  return [...recent, ...restRows];
}

export type PickerAccount = {
  code: string;
  name: string;
  parentCode?: string;
};

/**
 * Accounts as a tree: each head, then its sub-heads indented beneath it,
 * every level A→Z by name. A search matches by name or code, and a sub-head
 * also matches its heads' names ("utilities" shows Utilities and everything
 * under it); a head stays on screen whenever something under it matches, so
 * a found sub-head is never shown without the head it belongs to. Recent
 * picks lead under "Recent" (they also keep their place in the tree — moving
 * a head out of its own tree would orphan its sub-heads).
 */
export function groupAccountsForPicker<A extends PickerAccount>(
  accounts: A[],
  query: string,
  recentCodes: string[] = [],
  opts: {
    /** Top-level heading for a root account (children inherit it). */
    groupOf?: (a: A) => string | undefined;
    /** Heading order; unlisted headings follow A→Z. */
    groupOrder?: string[];
    /** False → the row is shown (as a parent) but cannot be picked. */
    isSelectable?: (a: A) => boolean;
    maxRecent?: number;
  } = {},
): PickItem[] {
  const tokens = queryTokens(query);
  const byCode = new Map(accounts.map((a) => [a.code, a]));
  const childrenOf = new Map<string, A[]>();
  const roots: A[] = [];
  for (const a of accounts) {
    if (a.parentCode && a.parentCode !== a.code && byCode.has(a.parentCode)) {
      const list = childrenOf.get(a.parentCode) ?? [];
      list.push(a);
      childrenOf.set(a.parentCode, list);
    } else {
      roots.push(a);
    }
  }
  const byName = (x: A, y: A) => compareLabels(x.name, y.name) || compareLabels(x.code, y.code);

  // Names of the heads above an account, nearest first (cycle-safe).
  const ancestorNames = (a: A): string[] => {
    const names: string[] = [];
    const seen = new Set<string>([a.code]);
    let p = a.parentCode ? byCode.get(a.parentCode) : undefined;
    while (p && !seen.has(p.code)) {
      seen.add(p.code);
      names.push(p.name);
      p = p.parentCode ? byCode.get(p.parentCode) : undefined;
    }
    return names;
  };
  const selectable = (a: A) => (opts.isSelectable ? opts.isSelectable(a) : true);
  const toItem = (a: A, depth: number, group: string | undefined): PickItem => ({
    id: a.code,
    label: a.name,
    sub: a.code,
    keywords: ancestorNames(a),
    group,
    depth,
    disabled: !selectable(a) || undefined,
  });

  // Depth-first: a row is kept when it matches or any descendant does.
  const visit = (a: A, depth: number, group: string | undefined, path: Set<string>): PickItem[] => {
    if (path.has(a.code)) return [];
    const nextPath = new Set(path).add(a.code);
    const kids = [...(childrenOf.get(a.code) ?? [])].sort(byName);
    const below = kids.flatMap((k) => visit(k, depth + 1, group, nextPath));
    const self = toItem(a, depth, group);
    if (below.length > 0 || pickItemMatches(self, tokens)) return [self, ...below];
    return [];
  };

  const order = opts.groupOrder ?? [];
  const groupRank = (g: string | undefined) => {
    const i = g === undefined ? -1 : order.indexOf(g);
    return i === -1 ? order.length : i;
  };
  const sortedRoots = [...roots].sort((x, y) => {
    const gx = opts.groupOf?.(x);
    const gy = opts.groupOf?.(y);
    return (
      groupRank(gx) - groupRank(gy) ||
      compareLabels(gx ?? "", gy ?? "") ||
      byName(x, y)
    );
  });
  const tree = sortedRoots.flatMap((r) => visit(r, 0, opts.groupOf?.(r), new Set()));

  const recent: PickItem[] = [];
  const seen = new Set<string>();
  for (const code of recentCodes) {
    if (recent.length >= (opts.maxRecent ?? MAX_RECENT_SHOWN)) break;
    const a = byCode.get(code);
    if (!a || seen.has(code) || !selectable(a)) continue;
    const item = toItem(a, 0, RECENT_GROUP);
    if (!pickItemMatches(item, tokens)) continue;
    seen.add(code);
    // Out of the tree the head it belongs to has to be said in words.
    const parent = ancestorNames(a)[0];
    recent.push({ ...item, sub: parent ? `${parent} · ${a.code}` : a.code });
  }
  if (recent.length === 0) return tree;
  return [...recent, ...tree.map((it) => ({ ...it, group: it.group ?? "All" }))];
}

/* ── Recent picks, per browser ─────────────────────────────────────── */

const RECENT_PREFIX = "bhb.recentPicks.";

function storage(): Storage | null {
  try {
    const s = (globalThis as { localStorage?: Storage }).localStorage;
    return s ?? null;
  } catch {
    return null;
  }
}

/**
 * The ids this browser picked last under `key`, newest first. Never throws:
 * a private window, blocked storage or server render simply has no recents.
 */
export function readRecentPicks(key: string): string[] {
  try {
    const raw = storage()?.getItem(RECENT_PREFIX + key);
    if (!raw) return [];
    const parsed: unknown = JSON.parse(raw);
    return Array.isArray(parsed) ? parsed.filter((x): x is string => typeof x === "string" && x !== "") : [];
  } catch {
    return [];
  }
}

/**
 * Put `id` first in the recent list (no duplicates, at most `max`) and return
 * the new list. A failed write — full or blocked storage — still returns the
 * list so the open picker can use it; it is a convenience, never data.
 */
export function pushRecentPick(key: string, id: string, max = 8): string[] {
  if (!id) return readRecentPicks(key);
  const next = [id, ...readRecentPicks(key).filter((x) => x !== id)].slice(0, Math.max(1, max));
  try {
    storage()?.setItem(RECENT_PREFIX + key, JSON.stringify(next));
  } catch {
    /* storage full or blocked — the recent list is a nicety */
  }
  return next;
}
