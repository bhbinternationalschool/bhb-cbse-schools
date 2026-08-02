/**
 * Fee recovery tasks — desk slices + jsonb blob.
 */

import { createDeskSlicePersistence } from "@/lib/createDeskSlicePersistence";
import {
  emptyFeeRecoveryTasks,
  loadFeeRecoveryTasks,
  writeFeeRecoveryTasksLocalRaw,
  type FeeRecoveryTasksState,
} from "@/lib/feeRecoveryTasks";

function feeRecoveryTasksIsEmpty(state: FeeRecoveryTasksState): boolean {
  return (state.meetings?.length ?? 0) === 0;
}

const desk = createDeskSlicePersistence<FeeRecoveryTasksState>({
  moduleId: "fee_recovery_tasks",
  blobMetaKey: "bhb_fee_recovery_tasks_v1_remote_meta",
  label: "feeRecoveryTasks",
  isEmpty: feeRecoveryTasksIsEmpty,
  loadLocal: loadFeeRecoveryTasks,
  writeLocalRaw: writeFeeRecoveryTasksLocalRaw,
  hasRemoteData: (b) =>
    (Array.isArray(b.meetings) ? b.meetings.length : 0) > 0,
});

export const scheduleFeeRecoveryTasksSync = desk.scheduleSync;
export const ensureFeeRecoveryTasksHydrated = desk.ensureHydrated;
export const resetFeeRecoveryTasksPersistenceCache = desk.resetCache;

export { emptyFeeRecoveryTasks };
