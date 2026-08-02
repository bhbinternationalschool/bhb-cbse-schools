import type { PurchaseState } from "@/lib/purchase";
import { purchaseReadFromDbEnabled } from "@/lib/purchaseDbConfig";
import type { PurchaseDeskBundle } from "@/lib/purchaseNormalized.server";

export function mergeDbDeskIntoPurchaseState(
  state: PurchaseState,
  bundle: PurchaseDeskBundle,
  opts?: { preferDb?: boolean },
): PurchaseState {
  const hasRemote =
    bundle.indents.length > 0 ||
    bundle.orders.length > 0 ||
    bundle.grns.length > 0 ||
    bundle.returns.length > 0;
  if (!hasRemote && !opts?.preferDb && !purchaseReadFromDbEnabled()) return state;

  const preferDb = !!opts?.preferDb || purchaseReadFromDbEnabled();

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
    indents: mergeById(
      state.indents ?? [],
      bundle.indents,
      preferDb || bundle.indents.length >= (state.indents?.length ?? 0),
    ),
    orders: mergeById(
      state.orders ?? [],
      bundle.orders,
      preferDb || bundle.orders.length >= (state.orders?.length ?? 0),
    ),
    grns: mergeById(
      state.grns ?? [],
      bundle.grns,
      preferDb || bundle.grns.length >= (state.grns?.length ?? 0),
    ),
    returns: mergeById(
      state.returns ?? [],
      bundle.returns,
      preferDb || bundle.returns.length >= (state.returns?.length ?? 0),
    ),
    settings: bundle.settings ?? state.settings,
  };
}
