/**
 * Merging a browser's whole-module save with the copy already in
 * module_local_state — complaints, discipline, health (2026-09-29).
 *
 * WHY: those books are saved whole by the office desk, and since #336 a
 * teacher's phone adds to the same row one entry at a time through
 * /api/v1/staff/*. A plain upsert of the office's copy — loaded this
 * morning, saved this afternoon — erased every entry a teacher logged in
 * between (the fee_adjustments failure of 13 Sep, same shape).
 *
 * Rules:
 *  - Union by id: a row only one side holds is kept.
 *  - A deleted row is remembered in `deletedIds` (tombstones), so union
 *    never brings back what the office deleted.
 *  - Same id on both sides: the browser's copy wins, as before — except
 *    for facts that only ever move forward (a parent notice sent, a
 *    complaint moved on by its teacher), kept from whichever side has them.
 *
 * `updatedAt` cannot decide conflicts: every normalize restamps it.
 */

type Row = { id: string };

export const TOMBSTONE_CAP = 5000;

export function tombstonesOf(state: unknown): string[] {
  const t = (state as { deletedIds?: unknown } | null)?.deletedIds;
  return Array.isArray(t) ? t.filter((x): x is string => typeof x === "string" && !!x) : [];
}

export function withTombstone(existing: string[] | undefined, id: string): string[] {
  const out = (existing ?? []).filter((x) => x !== id);
  out.push(id);
  return out.slice(-TOMBSTONE_CAP);
}

export function mergeRowsById<T extends Row>(
  server: T[],
  incoming: T[],
  dead: Set<string>,
  combine: (browser: T, server: T) => T = (b) => b,
): T[] {
  const serverById = new Map<string, T>();
  for (const r of server) if (r?.id) serverById.set(r.id, r);
  const seen = new Set<string>();
  const merged: T[] = [];
  for (const r of incoming) {
    if (!r?.id || dead.has(r.id) || seen.has(r.id)) continue;
    seen.add(r.id);
    const had = serverById.get(r.id);
    merged.push(had ? combine(r, had) : r);
  }
  // Rows the browser has not seen yet — newest-first books put them on top.
  const onlyServer = server.filter((r) => r?.id && !seen.has(r.id) && !dead.has(r.id));
  return [...onlyServer, ...merged];
}

const COMPLAINT_RANK: Record<string, number> = {
  open: 0,
  assigned: 1,
  in_progress: 2,
  resolved: 3,
  closed: 4,
};

type ComplaintRow = Row & {
  status?: string;
  assignedToStaffId?: string | null;
  resolutionNote?: string;
  resolvedAt?: string | null;
};

function combineComplaint<T extends ComplaintRow>(b: T, s: T): T {
  const further = (COMPLAINT_RANK[s.status ?? ""] ?? 0) > (COMPLAINT_RANK[b.status ?? ""] ?? 0);
  if (!further) return b;
  return {
    ...b,
    status: s.status,
    resolutionNote: s.resolutionNote || b.resolutionNote,
    resolvedAt: s.resolvedAt || b.resolvedAt,
    assignedToStaffId: b.assignedToStaffId || s.assignedToStaffId,
  };
}

function keepNotified<T extends Row & { notifiedParentAt?: string | null }>(b: T, s: T): T {
  return !b.notifiedParentAt && s.notifiedParentAt ? { ...b, notifiedParentAt: s.notifiedParentAt } : b;
}

const LISTS: Record<string, { key: string; combine?: (b: never, s: never) => never }[]> = {
  complaints: [{ key: "tickets", combine: combineComplaint as never }],
  discipline: [{ key: "incidents", combine: keepNotified as never }],
  health: [
    { key: "visits", combine: keepNotified as never },
    { key: "medications" },
    { key: "vaccinations" },
  ],
};

export function isMergedModuleState(module: string): boolean {
  return module in LISTS;
}

/** The browser's save, merged over the stored copy. `current` null = none stored. */
export function mergeModuleState(
  module: string,
  current: unknown,
  incoming: Record<string, unknown>,
): Record<string, unknown> {
  const lists = LISTS[module];
  if (!lists || !current || typeof current !== "object") return incoming;
  const cur = current as Record<string, unknown>;
  const deadList = [...new Set([...tombstonesOf(cur), ...tombstonesOf(incoming)])].slice(-TOMBSTONE_CAP);
  const dead = new Set(deadList);
  const out: Record<string, unknown> = { ...incoming };
  for (const { key, combine } of lists) {
    const rowsOf = (v: Record<string, unknown>) => (Array.isArray(v[key]) ? (v[key] as Row[]) : []);
    out[key] = mergeRowsById(rowsOf(cur), rowsOf(incoming), dead, combine as never);
  }
  if (deadList.length) out.deletedIds = deadList;
  return out;
}
