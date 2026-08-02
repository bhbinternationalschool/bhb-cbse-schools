import type { TrustState } from "@/lib/trust";
import { trustReadFromDbEnabled } from "@/lib/trustDbConfig";
import type { TrustDeskBundle } from "@/lib/trustNormalized.server";

export function mergeDbDeskIntoTrustState(
  state: TrustState,
  bundle: TrustDeskBundle,
  opts?: { preferDb?: boolean },
): TrustState {
  const hasRemote =
    bundle.projects.length > 0 ||
    bundle.workItems.length > 0 ||
    bundle.contractors.length > 0;
  if (!hasRemote && !trustReadFromDbEnabled() && !opts?.preferDb) return state;

  const preferDb = !!opts?.preferDb || trustReadFromDbEnabled();

  function mergeSlice<K extends keyof TrustDeskBundle>(key: K): TrustState[K] {
    const local = state[key] ?? [];
    const remote = bundle[key] ?? [];
    if (preferDb || local.length === 0 || remote.length >= local.length) {
      return remote as TrustState[K];
    }
    const byId = new Map<string, TrustState[K][number]>();
    for (const row of local as TrustState[K]) {
      const id = (row as { id: string }).id;
      byId.set(id, row);
    }
    for (const row of remote as TrustState[K]) {
      const id = (row as { id: string }).id;
      byId.set(id, row);
    }
    return [...byId.values()] as TrustState[K];
  }

  return {
    version: 1,
    projects: mergeSlice("projects"),
    workItems: mergeSlice("workItems"),
    materials: mergeSlice("materials"),
    labourEntries: mergeSlice("labourEntries"),
    allotments: mergeSlice("allotments"),
    contractors: mergeSlice("contractors"),
    workOrders: mergeSlice("workOrders"),
    raBills: mergeSlice("raBills"),
    costLines: mergeSlice("costLines"),
    rateCard: mergeSlice("rateCard"),
  };
}
