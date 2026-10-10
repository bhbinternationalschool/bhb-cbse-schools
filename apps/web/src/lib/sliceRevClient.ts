/**
 * Browser half of per-row versions on merged lists (server: sliceRevMerge).
 *
 * The server keeps a `_rev` on every row of a merged list and will only let
 * a save overwrite a row that is still at the version the browser changed it
 * from. The browser therefore has to say, for each row it CHANGED, which
 * `_rev` it changed it from — and say nothing about rows it didn't touch, so
 * a stale untouched copy can't overwrite a newer one.
 *
 * Normalizers rebuild rows and would drop `_rev`, so instead of carrying it
 * in the rows this keeps, per module and list, an in-memory map of
 *   key → { rev the server had, fingerprint of the row as this browser held it }
 * captured when the desk is loaded and refreshed after every accepted save.
 * At save time a row whose fingerprint changed is "changed from rev"; a row
 * not in the map is new (rev 0); an unchanged row is left out.
 *
 * Memory only, like the known-ids of named deletes: after a reload nothing
 * is known until the desk is loaded again, and a save before that sends
 * every row as new — rows the server already holds at a later version are
 * then refused and the desk is reloaded, rather than a stale copy winning.
 */

type Base = Map<string, { rev: number; hash: number }>;
const bases = new Map<string, Map<string, Base>>();

/** FNV-1a over the row's content (keys sorted, `_rev` left out). */
export function rowFingerprint(row: unknown): number {
  const s = stableContent(row);
  let h = 0x811c9dc5;
  for (let i = 0; i < s.length; i++) {
    h ^= s.charCodeAt(i);
    h = Math.imul(h, 0x01000193);
  }
  return h >>> 0;
}

function stableContent(row: unknown): string {
  const norm = (v: unknown): unknown => {
    if (Array.isArray(v)) return v.map(norm);
    if (v && typeof v === "object") {
      const out: Record<string, unknown> = {};
      for (const k of Object.keys(v as Record<string, unknown>).sort()) {
        if (k === "_rev") continue;
        out[k] = norm((v as Record<string, unknown>)[k]);
      }
      return out;
    }
    return v;
  };
  return JSON.stringify(norm(row)) ?? "";
}

const keyOf = (row: unknown, field: string) =>
  row && typeof row === "object" && typeof (row as Record<string, unknown>)[field] === "string"
    ? String((row as Record<string, unknown>)[field])
    : "";

const revOf = (row: unknown) => {
  const n = Number(row && typeof row === "object" ? (row as Record<string, unknown>)._rev : 0);
  return Number.isFinite(n) && n > 0 ? Math.floor(n) : 0;
};

export type RevSlices = { slices: readonly string[]; keyField?: (slice: string) => string };

/**
 * After a load: what the server holds (`server`, raw rows with `_rev`) and
 * how this browser now holds those rows (`local`, after its normalizers).
 */
export function captureRevBase(
  module: string,
  server: Record<string, unknown>,
  local: Record<string, unknown>,
  cfg: RevSlices,
) {
  const perSlice = new Map<string, Base>();
  for (const slice of cfg.slices) {
    const field = cfg.keyField?.(slice) ?? "id";
    const serverRows = Array.isArray(server[slice]) ? (server[slice] as unknown[]) : null;
    if (!serverRows) continue;
    const rev = new Map<string, number>();
    for (const r of serverRows) {
      const k = keyOf(r, field);
      if (k) rev.set(k, revOf(r));
    }
    const base: Base = new Map();
    for (const r of Array.isArray(local[slice]) ? (local[slice] as unknown[]) : []) {
      const k = keyOf(r, field);
      if (k && rev.has(k)) base.set(k, { rev: rev.get(k)!, hash: rowFingerprint(r) });
    }
    perSlice.set(slice, base);
  }
  bases.set(module, perSlice);
}

/** Has this browser loaded the module this session (so it knows versions)? */
export function hasRevBase(module: string): boolean {
  return bases.has(module);
}

/**
 * For a save: slice → key → the rev each CHANGED row was changed from (0 for
 * rows the server never sent this browser). Unchanged rows are left out.
 */
export function buildSaveRevs(
  module: string,
  state: Record<string, unknown>,
  cfg: RevSlices,
): Record<string, Record<string, number>> {
  const per = bases.get(module);
  const out: Record<string, Record<string, number>> = {};
  for (const slice of cfg.slices) {
    if (!Array.isArray(state[slice])) continue;
    const field = cfg.keyField?.(slice) ?? "id";
    const base = per?.get(slice);
    const m: Record<string, number> = {};
    for (const r of state[slice] as unknown[]) {
      const k = keyOf(r, field);
      if (!k) continue;
      const b = base?.get(k);
      if (!b) m[k] = 0;
      else if (rowFingerprint(r) !== b.hash) m[k] = b.rev;
    }
    out[slice] = m;
  }
  return out;
}

/**
 * After an accepted save: rows the server wrote take their new `_rev`; every
 * row sent with an unchanged version keeps its rev but its fingerprint moves
 * to what was just saved. Conflicted rows are left alone (the caller reloads).
 */
export function applySaveRevs(
  module: string,
  state: Record<string, unknown>,
  sent: Record<string, Record<string, number>>,
  result: { revs?: Record<string, Record<string, number>>; conflicts?: Record<string, string[]> },
  cfg: RevSlices,
) {
  let per = bases.get(module);
  if (!per) {
    per = new Map();
    bases.set(module, per);
  }
  for (const slice of cfg.slices) {
    const sentSlice = sent[slice];
    if (!sentSlice || !Array.isArray(state[slice])) continue;
    const field = cfg.keyField?.(slice) ?? "id";
    let base = per.get(slice);
    if (!base) {
      base = new Map();
      per.set(slice, base);
    }
    const conflicted = new Set(result.conflicts?.[slice] ?? []);
    const newRevs = result.revs?.[slice] ?? {};
    for (const r of state[slice] as unknown[]) {
      const k = keyOf(r, field);
      if (!k || !(k in sentSlice) || conflicted.has(k)) continue;
      const rev = k in newRevs ? newRevs[k] : base.get(k)?.rev ?? sentSlice[k];
      base.set(k, { rev, hash: rowFingerprint(r) });
    }
  }
}

/** Forget a module's versions (a reload follows). */
export function forgetRevBase(module: string) {
  bases.delete(module);
}

/** Count of rows a save was refused for. */
export function conflictCount(conflicts: Record<string, string[]> | undefined): number {
  return Object.values(conflicts ?? {}).reduce((n, ids) => n + ids.length, 0);
}

/**
 * Some rows of a save were refused because they changed elsewhere first:
 * forget this module's versions, reload its desk (the newer copy replaces
 * the stale one), and tell the person.
 */
export function onSaveConflicts(
  module: string,
  hydrateModule: string,
  conflicts: Record<string, string[]> | undefined,
) {
  const count = conflictCount(conflicts);
  if (!count || typeof window === "undefined") return;
  forgetRevBase(module);
  window.dispatchEvent(new CustomEvent("bhb-desk-conflict", { detail: { id: hydrateModule, count } }));
  void Promise.all([import("@/lib/deskHydrateGuard"), import("@/lib/deskHydrationSchedule")]).then(
    ([guard, sched]) => {
      guard.resetDeskHydrated(hydrateModule);
      return sched.ensureAllDeskHydrated();
    },
  );
}
