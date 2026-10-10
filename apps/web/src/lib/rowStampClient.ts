/**
 * Browser half of stamped saves on per-row desks (PTM first).
 *
 * Per-row desks keep each row in its own table with a server `updated_at`.
 * A save used to upsert every row the browser held, so a tab that loaded a
 * booking before a parent cancelled it wrote "booked" back. Now the load
 * hands over each row's `updated_at` (its stamp); a save sends only the rows
 * this browser CHANGED, each with the stamp it changed it from ("" = a new
 * row), and the server writes a row only while it is still at that stamp.
 *
 * Same shape as sliceRevClient (merged lists, numeric `_rev`), with string
 * stamps: an in-memory map per module and table of
 *   id → { stamp the server had, fingerprint of the row as this browser held it }
 * captured on load and moved on after every accepted save. Memory only: a
 * browser that has not loaded this session sends every row as new, and rows
 * the server already holds are refused and the desk reloaded.
 */

import { rowFingerprint } from "@/lib/sliceRevClient";

type Base = Map<string, { stamp: string; hash: number }>;
const bases = new Map<string, Map<string, Base>>();

export type RowStamps = Record<string, Record<string, string>>;
export type RowConflicts = Record<string, string[]>;

const idOf = (row: unknown) =>
  row && typeof row === "object" && typeof (row as { id?: unknown }).id === "string"
    ? (row as { id: string }).id
    : "";

/** After a load: the server's stamps, and this browser's rows as it now holds them. */
export function captureRowStamps(
  module: string,
  stamps: RowStamps,
  local: Record<string, unknown>,
  slices: readonly string[],
) {
  const per = new Map<string, Base>();
  for (const slice of slices) {
    const server = stamps[slice] ?? {};
    const base: Base = new Map();
    for (const r of Array.isArray(local[slice]) ? (local[slice] as unknown[]) : []) {
      const id = idOf(r);
      if (id && typeof server[id] === "string" && server[id]) {
        base.set(id, { stamp: server[id], hash: rowFingerprint(r) });
      }
    }
    per.set(slice, base);
  }
  bases.set(module, per);
}

export function hasRowStamps(module: string): boolean {
  return bases.has(module);
}

export function forgetRowStamps(module: string) {
  bases.delete(module);
}

/** For a save: per table, the stamp each CHANGED row was changed from ("" = new). */
export function buildStampedSave(
  module: string,
  state: Record<string, unknown>,
  slices: readonly string[],
): RowStamps {
  const per = bases.get(module);
  const out: RowStamps = {};
  for (const slice of slices) {
    const base = per?.get(slice);
    const m: Record<string, string> = {};
    for (const r of Array.isArray(state[slice]) ? (state[slice] as unknown[]) : []) {
      const id = idOf(r);
      if (!id) continue;
      const b = base?.get(id);
      if (!b) m[id] = "";
      else if (rowFingerprint(r) !== b.hash) m[id] = b.stamp;
    }
    out[slice] = m;
  }
  return out;
}

/** After an accepted save: written rows take their new stamp and fingerprint. */
export function applyStampedSave(
  module: string,
  state: Record<string, unknown>,
  sent: RowStamps,
  result: { stamps?: RowStamps; conflicts?: RowConflicts },
  slices: readonly string[],
) {
  let per = bases.get(module);
  if (!per) {
    per = new Map();
    bases.set(module, per);
  }
  for (const slice of slices) {
    const sentSlice = sent[slice];
    if (!sentSlice) continue;
    let base = per.get(slice);
    if (!base) {
      base = new Map();
      per.set(slice, base);
    }
    const written = result.stamps?.[slice] ?? {};
    const conflicted = new Set(result.conflicts?.[slice] ?? []);
    for (const r of Array.isArray(state[slice]) ? (state[slice] as unknown[]) : []) {
      const id = idOf(r);
      if (!id || !(id in sentSlice) || conflicted.has(id) || !written[id]) continue;
      base.set(id, { stamp: written[id], hash: rowFingerprint(r) });
    }
  }
}

export function stampConflictCount(conflicts: RowConflicts | undefined): number {
  return Object.values(conflicts ?? {}).reduce((n, ids) => n + ids.length, 0);
}

/**
 * Some rows were refused because they changed elsewhere first: forget the
 * stamps, reload the desk (the newer copy replaces this one) and say so.
 */
export function onStampConflicts(module: string, conflicts: RowConflicts | undefined) {
  const count = stampConflictCount(conflicts);
  if (!count || typeof window === "undefined") return;
  forgetRowStamps(module);
  window.dispatchEvent(new CustomEvent("bhb-desk-conflict", { detail: { id: module, count } }));
  void Promise.all([import("@/lib/deskHydrateGuard"), import("@/lib/deskHydrationSchedule")]).then(
    ([guard, sched]) => {
      guard.resetDeskHydrated(module);
      return sched.ensureAllDeskHydrated();
    },
  );
}

/** `stamps: { table: { id: stamp } }` from a push, for the given tables only. */
export function readStampsParam(raw: unknown, allowed: readonly string[]): RowStamps | undefined {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return undefined;
  const out: RowStamps = {};
  for (const slice of allowed) {
    const v = (raw as Record<string, unknown>)[slice];
    if (!v || typeof v !== "object" || Array.isArray(v)) {
      out[slice] = {};
      continue;
    }
    const m: Record<string, string> = {};
    for (const [k, s] of Object.entries(v as Record<string, unknown>)) {
      if (k && typeof s === "string") m[k] = s;
    }
    out[slice] = m;
  }
  return out;
}
