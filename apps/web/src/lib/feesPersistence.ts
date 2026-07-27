/**
 * Fees remote sync — jsonb blob on fees_state.
 * localStorage remains the working copy; Supabase overlays when configured.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  feesStateIsEmpty,
  loadFees,
  writeFeesLocalRaw,
  type FeesState,
} from "@/lib/fees";

const blob = createDomainBlobPersistence<FeesState>({
  table: "fees_state",
  metaKey: "bhb_fees_v1_remote_meta",
  label: "fees",
  isEmpty: feesStateIsEmpty,
  loadLocal: loadFees,
  writeLocalRaw: writeFeesLocalRaw,
});

export const feesRemoteEnabled = blob.remoteEnabled;
export const scheduleFeesSync = blob.scheduleSync;
export const ensureFeesHydrated = blob.ensureHydrated;
export const resetFeesPersistenceCache = blob.resetCache;
