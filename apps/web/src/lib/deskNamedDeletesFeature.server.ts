/**
 * Named deletes from a function-only writer (deskFeatureGate "feature" mode).
 *
 * The gate merges such a push onto the stored desk slice by slice, and drops
 * a stored row only when the writer's role may delete it. With the prune gone
 * that drop no longer reaches the database by itself, and absence must not
 * come back as a deletion — so a row is deleted only when the client NAMED it
 * and the gate's merge dropped it. Either alone deletes nothing.
 */

import type { NamedDeletes } from "@/lib/deskNamedDeletes.server";

function idsOf(slice: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(slice)) return out;
  for (const r of slice) {
    const id = r && typeof r === "object" ? (r as { id?: unknown }).id : undefined;
    if (typeof id === "string" && id) out.add(id);
  }
  return out;
}

/**
 * @param tableSlices table name → the desk slice key whose rows it stores
 */
export function featureAuthorizedDeletes(
  named: NamedDeletes,
  tableSlices: Record<string, string>,
  stored: object,
  merged: object,
): NamedDeletes {
  const out: NamedDeletes = {};
  for (const [table, ids] of Object.entries(named)) {
    const key = tableSlices[table];
    if (!key || !ids.length) continue;
    const before = idsOf((stored as Record<string, unknown>)[key]);
    const after = idsOf((merged as Record<string, unknown>)[key]);
    const ok = ids.filter((id) => before.has(id) && !after.has(id));
    if (ok.length) out[table] = ok;
  }
  return out;
}
