import type { StoreState } from "@/lib/store";
import { storeReadFromDbEnabled } from "@/lib/storeDbConfig";
import type { StoreDeskBundle } from "@/lib/storeNormalized.server";

export function mergeDbDeskIntoStoreState(
  state: StoreState,
  bundle: StoreDeskBundle,
  opts?: { preferDb?: boolean },
): StoreState {
  const hasRemote =
    bundle.items.length > 0 ||
    bundle.issues.length > 0 ||
    bundle.categories.length > 0;
  if (!hasRemote && !opts?.preferDb && !storeReadFromDbEnabled()) return state;

  const preferDb = !!opts?.preferDb || storeReadFromDbEnabled();

  function mergeById<T extends { id: string }>(
    local: T[],
    remote: T[],
    takeRemote: boolean,
  ): T[] {
    const byId = new Map<string, T>();
    if (!takeRemote) {
      for (const row of local) byId.set(row.id, row);
    }
    for (const row of remote) byId.set(row.id, row);
    if (!takeRemote) {
      for (const row of local) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    }
    return [...byId.values()];
  }

  return {
    ...state,
    version: 1,
    categories: mergeById(
      state.categories ?? [],
      bundle.categories,
      preferDb || bundle.categories.length >= (state.categories?.length ?? 0),
    ),
    saleGroups: mergeById(
      state.saleGroups ?? [],
      bundle.saleGroups,
      preferDb || bundle.saleGroups.length >= (state.saleGroups?.length ?? 0),
    ),
    uoms: mergeById(
      state.uoms ?? [],
      bundle.uoms,
      preferDb || bundle.uoms.length >= (state.uoms?.length ?? 0),
    ),
    infraLevels: mergeById(
      state.infraLevels ?? [],
      bundle.infraLevels,
      preferDb || bundle.infraLevels.length >= (state.infraLevels?.length ?? 0),
    ),
    sources: mergeById(
      state.sources ?? [],
      bundle.sources,
      preferDb || bundle.sources.length >= (state.sources?.length ?? 0),
    ),
    items: mergeById(
      state.items ?? [],
      bundle.items,
      preferDb || bundle.items.length >= (state.items?.length ?? 0),
    ),
    issues: mergeById(
      state.issues ?? [],
      bundle.issues,
      preferDb || bundle.issues.length >= (state.issues?.length ?? 0),
    ),
    movements: mergeById(
      state.movements ?? [],
      bundle.movements,
      preferDb || bundle.movements.length >= (state.movements?.length ?? 0),
    ),
    inventoryAllocations: mergeById(
      state.inventoryAllocations ?? [],
      bundle.inventoryAllocations,
      preferDb ||
        bundle.inventoryAllocations.length >=
          (state.inventoryAllocations?.length ?? 0),
    ),
    assetAllocations: mergeById(
      state.assetAllocations ?? [],
      bundle.assetAllocations,
      preferDb ||
        bundle.assetAllocations.length >= (state.assetAllocations?.length ?? 0),
    ),
    sellReturns: mergeById(
      state.sellReturns ?? [],
      bundle.sellReturns,
      preferDb || bundle.sellReturns.length >= (state.sellReturns?.length ?? 0),
    ),
  };
}
