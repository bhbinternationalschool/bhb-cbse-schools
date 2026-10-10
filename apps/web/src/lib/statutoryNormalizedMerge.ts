import type { StatutoryRemitState } from "@/lib/statutoryRemit";
import { statutoryReadFromDbEnabled } from "@/lib/statutoryDbConfig";
import type { StatutoryDeskBundle } from "@/lib/statutoryNormalized.server";

/** Union-by-id merge, same strategy as payrollNormalizedMerge.ts's mergeDbDeskIntoPayrollState:
 * the "losing" side's ids are still kept if absent from the winning side, so neither
 * a stale client nor a stale server pull can silently drop records. */
export function mergeDbDeskIntoStatutoryState(
  state: StatutoryRemitState,
  bundle: StatutoryDeskBundle,
  opts?: { preferDb?: boolean },
): StatutoryRemitState {
  const hasRemote = bundle.batches.length > 0;
  if (!hasRemote && !opts?.preferDb && !statutoryReadFromDbEnabled()) return state;

  const preferDb = !!opts?.preferDb || statutoryReadFromDbEnabled();
  const takeRemote = preferDb || bundle.batches.length >= (state.batches?.length ?? 0);

  const byId = new Map<string, StatutoryRemitState["batches"][number]>();
  if (!takeRemote) {
    for (const row of state.batches ?? []) byId.set(row.id, row);
  }
  for (const row of bundle.batches) byId.set(row.id, row);
  if (!takeRemote) {
    for (const row of state.batches ?? []) {
      if (!byId.has(row.id)) byId.set(row.id, row);
    }
  }

  return { version: 1, batches: [...byId.values()] };
}
