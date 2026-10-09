/**
 * Merging a list with per-row server versions (`_rev`).
 *
 * Merged lists keep every stored row a save lacks, and the save's rows win
 * for their ids — so a browser holding an OLDER copy of a row wrote that old
 * copy back (a leave request returned to "pending" after it was approved on
 * WhatsApp). Each row now carries `_rev`, set by the server and bumped
 * whenever the row's content changes.
 *
 * Two modes:
 *  - With `base` (a browser that says which rows it changed, and from which
 *    `_rev`): a changed row replaces the stored one only if the stored row is
 *    still at that `_rev`; otherwise the row is refused and reported as a
 *    conflict. Rows not in `base` were not touched by this save and keep
 *    their stored version — a stale untouched copy can't overwrite anything.
 *  - Without `base` (server writers, and browsers on an older build): the
 *    save's rows win as before, but a row whose content changed gets a new
 *    `_rev`, so every browser holding the old one is now behind.
 *
 * Rows without a key are kept as sent (they can't be versioned).
 */

type Row = Record<string, unknown>;

export function rowRev(row: unknown): number {
  const n = Number(row && typeof row === "object" ? (row as Row)._rev : 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
}

/** JSON with sorted keys and without `_rev`: content equality, order-proof. */
export function rowContent(row: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const out: Row = {};
      for (const k of Object.keys(v as Row).sort()) {
        if (k === "_rev") continue;
        out[k] = norm((v as Row)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(row));
}

export type RevMergeResult = {
  rows: unknown[];
  /** Rows this save wrote, with their new `_rev`. */
  revs: Record<string, number>;
  /** Rows this save changed from a version that is no longer current. */
  conflicts: string[];
};

export function mergeWithRevs(
  stored: unknown,
  incoming: unknown[],
  opts: {
    /** The row's key field (default `id`). */
    key?: string;
    /** key → the `_rev` the save changed it from (0 = a new row). */
    base?: Record<string, number>;
    /** Fields combined, not replaced, when a changed row arrives late (chat `readBy`). */
    union?: string[];
  } = {},
): RevMergeResult {
  const field = opts.key ?? "id";
  const keyOf = (r: unknown) =>
    r && typeof r === "object" && typeof (r as Row)[field] === "string" ? String((r as Row)[field]) : "";
  const storedRows = Array.isArray(stored) ? stored : [];
  const byKey = new Map<string, unknown>();
  for (const r of storedRows) {
    const k = keyOf(r);
    if (k) byKey.set(k, r);
  }

  const out: unknown[] = [];
  const seen = new Set<string>();
  const revs: Record<string, number> = {};
  const conflicts: string[] = [];

  for (const inc of incoming) {
    const k = keyOf(inc);
    if (!k) {
      out.push(inc);
      continue;
    }
    if (seen.has(k)) continue;
    seen.add(k);
    const cur = byKey.get(k);
    const curRev = rowRev(cur);

    if (opts.base) {
      if (!(k in opts.base)) {
        // Untouched by this save: the stored version stands (or nothing, if
        // it was deleted elsewhere — never resurrected by a stale copy).
        if (cur !== undefined) out.push(cur);
        continue;
      }
      const from = opts.base[k];
      if (cur === undefined) {
        if (from === 0) {
          out.push({ ...(inc as Row), _rev: 1 });
          revs[k] = 1;
        } else {
          conflicts.push(k); // changed a row that was deleted meanwhile
        }
        continue;
      }
      if (from === curRev) {
        if (rowContent(inc) === rowContent(cur)) {
          out.push(cur);
        } else {
          out.push({ ...(inc as Row), _rev: curRev + 1 });
          revs[k] = curRev + 1;
        }
        continue;
      }
      conflicts.push(k);
      out.push(unionInto(cur as Row, inc as Row, opts.union, curRev));
      continue;
    }

    // No base: the save's row wins; a real change gets a new version.
    if (cur === undefined) {
      const r = Math.max(rowRev(inc), 1);
      out.push({ ...(inc as Row), _rev: r });
      revs[k] = r;
    } else if (rowContent(inc) === rowContent(cur)) {
      out.push(cur);
    } else {
      out.push({ ...(inc as Row), _rev: curRev + 1 });
      revs[k] = curRev + 1;
    }
  }

  for (const r of storedRows) {
    const k = keyOf(r);
    if (k && !seen.has(k)) out.push(r);
  }
  return { rows: out, revs, conflicts };
}

/** The stored row with `union` fields combined from a late copy (bumped if that changed it). */
function unionInto(cur: Row, inc: Row, fields: string[] | undefined, curRev: number): Row {
  if (!fields?.length) return cur;
  let changed = false;
  const next: Row = { ...cur };
  for (const f of fields) {
    const a = Array.isArray(cur[f]) ? (cur[f] as unknown[]) : [];
    const b = Array.isArray(inc[f]) ? (inc[f] as unknown[]) : [];
    const merged = [...new Set([...a, ...b].map((x) => JSON.stringify(x)))].map((x) => JSON.parse(x));
    if (merged.length !== a.length) {
      next[f] = merged;
      changed = true;
    }
  }
  return changed ? { ...next, _rev: curRev + 1 } : cur;
}

/**
 * `revs: { slice: { key: rev } }` from a browser's push, kept for the given
 * slices only. Undefined when the push carries none (an older browser).
 */
export function readRevsParam(
  raw: unknown,
  allowed: readonly string[],
): Record<string, Record<string, number>> | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: Record<string, Record<string, number>> = {};
  for (const slice of allowed) {
    const v = (raw as Record<string, unknown>)[slice];
    if (!v || typeof v !== "object" || Array.isArray(v)) continue;
    const m: Record<string, number> = {};
    for (const [k, n] of Object.entries(v as Record<string, unknown>)) {
      const r = Number(n);
      if (k && Number.isFinite(r) && r >= 0) m[k] = Math.floor(r);
    }
    out[slice] = m;
  }
  return out;
}
