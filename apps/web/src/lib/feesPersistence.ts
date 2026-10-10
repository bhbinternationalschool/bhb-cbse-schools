/**
 * Fees remote sync — jsonb blob on fees_state + normalized fee_desk_* tables.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  feesStateIsEmpty,
  loadFees,
  writeFeesLocalRaw,
  type FeesState,
} from "@/lib/fees";
import {
  hydrateFeesDeskFromDb,
  scheduleFeesDeskSync,
} from "@/lib/feesNormalizedClient";
import { mergeDbDeskIntoFeesState } from "@/lib/feesNormalizedMerge";
import { feesReadFromDbEnabled } from "@/lib/feesDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import { dedupeHydration, isDeskHydrated, markDeskHydrated, resetDeskHydrated } from "@/lib/deskHydrateGuard";

const MODULE = "fees";

const blob = createDomainBlobPersistence<FeesState>({
  table: "fees_state",
  metaKey: "bhb_fees_v1_remote_meta",
  label: "fees",
  isEmpty: feesStateIsEmpty,
  loadLocal: loadFees,
  writeLocalRaw: writeFeesLocalRaw,
});

export const feesRemoteEnabled = blob.remoteEnabled;

export function resetFeesPersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}

export function scheduleFeesSync(state: FeesState) {
  if (typeof window === "undefined") return;
  if (!deskSkipBlobPushClient("fees")) {
    blob.scheduleSync(state);
  }
  scheduleFeesDeskSync(state);
}

/**
 * Pull fees blob + normalized desk (vouchers + ancillary).
 * DB wins when NEXT_PUBLIC_FEES_READ_FROM_DB=true or local is empty.
 */
export async function ensureFeesHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;
  // Collapse concurrent callers onto one fetch. The fee counter mounts
  // several components that each ask for this in the same tick.
  return dedupeHydration(MODULE, hydrateFeesOnce);
}

async function hydrateFeesOnce(): Promise<boolean> {

  const readFromDb = feesReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("fees")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { vouchers, ancillary, changed, ok } = await hydrateFeesDeskFromDb(readFromDb);
  if (!ok) {
    if (typeof window !== "undefined" && feesRemoteEnabled()) {
      const { reportLoadFailure } = await import("@/components/shell/Toast");
      reportLoadFailure("fee records");
    }
    return false;
  }

  markDeskHydrated(MODULE);
  const hasAncillary =
    ancillary.cheques.length > 0 ||
    ancillary.manualBooks.length > 0 ||
    ancillary.dayCloses.length > 0 ||
    ancillary.chargeVouchers.length > 0 ||
    ancillary.installmentPlans.length > 0 ||
    ancillary.planAllocations.length > 0 ||
    ancillary.carriedForwardDues.length > 0;
  if (changed && (vouchers.length > 0 || hasAncillary || readFromDb)) {
    const merged = mergeDbDeskIntoFeesState(
      loadFees(),
      { vouchers, ancillary },
      { preferDb: readFromDb },
    );
    writeFeesLocalRaw(merged);
    normChanged = true;
  }

  // Hydration is pull-only. Re-pushing here re-ran the open-dues
  // delete-all-then-insert (~2 000 rows) and the full voucher upsert on every
  // fees hydrate — 107 POST /fees-vouchers a day at a 20.8 s median, with
  // deadlocks on fee_desk_open_dues when two browsers overlapped (audit
  // 2026-08-18). Edits reach the DB through saveFees() only. When the desk
  // is not the source of truth (legacy blob mode) the local merge still has
  // to be published, so keep that one path.
  if (normChanged && !readFromDb) {
    scheduleFeesSync(loadFees());
  }

  return blobChanged || normChanged;
}
