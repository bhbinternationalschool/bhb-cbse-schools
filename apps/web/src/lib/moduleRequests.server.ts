import { readModuleLocalState, writeModuleLocalState } from "@/lib/moduleLocalState.server";
import { normalizeModuleRequestsState, type ModuleRequestsState } from "@/lib/moduleRequests";

/**
 * Read → change → write for the module-requests store (lib/moduleRequests).
 * A failed read changes nothing: an unreadable store is not an empty one,
 * and writing a fresh list over it would lose every request in it.
 */
export async function updateModuleRequests(
  change: (s: ModuleRequestsState) => ModuleRequestsState | { ok: false; error: string },
): Promise<{ ok: true; state: ModuleRequestsState } | { ok: false; error: string }> {
  const row = await readModuleLocalState<unknown>("module_requests");
  if (!row) return { ok: false, error: "Could not read the requests store — nothing was saved. Try again." };
  const next = change(normalizeModuleRequestsState(row.state));
  if ("ok" in next) return next;
  const w = await writeModuleLocalState("module_requests", next);
  if (!w.ok) return { ok: false, error: w.error };
  return { ok: true, state: next };
}

export async function readModuleRequests(): Promise<ModuleRequestsState | null> {
  const row = await readModuleLocalState<unknown>("module_requests");
  return row ? normalizeModuleRequestsState(row.state) : null;
}
