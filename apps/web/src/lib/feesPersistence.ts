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

const blob = createDomainBlobPersistence<FeesState>({
  table: "fees_state",
  metaKey: "bhb_fees_v1_remote_meta",
  label: "fees",
  isEmpty: feesStateIsEmpty,
  loadLocal: loadFees,
  writeLocalRaw: writeFeesLocalRaw,
});

export const feesRemoteEnabled = blob.remoteEnabled;
export const resetFeesPersistenceCache = blob.resetCache;

export function scheduleFeesSync(state: FeesState) {
  if (typeof window === "undefined") {
    void pushFeesRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("fees")) {
    blob.scheduleSync(state);
  }
  scheduleFeesDeskSync(state);
}

/** Server + client push — desk first, optional fees_state blob. */
export async function pushFeesRemoteServer(
  state: FeesState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushFeeDeskToDb } = await import("@/lib/feesNormalized.server");
  const { currentAcademicYearCode, loadMasters } = await import("@/lib/masters");
  const desk = await pushFeeDeskToDb(state, {
    academicYearCode:
      state.vouchers?.[0]?.academicYearCode ||
      currentAcademicYearCode(loadMasters()),
  });
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("fees")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<FeesState>("fees_state");
  const remoteVouchers = remote.state?.vouchers?.length ?? 0;
  const nextVouchers = state.vouchers?.length ?? 0;
  if (nextVouchers < remoteVouchers && remote.state) {
    return { ok: true };
  }

  return pushServerBlob("fees_state", state);
}

/** Server-side hydrate from blob + normalized DB into school mirror fees slice. */
export async function ensureFeesHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchFeeDeskFromDb } = await import("@/lib/feesNormalized.server");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  const { setMirrorSlice } = await import("@/lib/schoolDataMirror");

  let state = loadFees();
  let changed = false;

  if (!deskSkipBlobPush("fees")) {
    const remoteBlob = await fetchServerBlob<FeesState>("fees_state");
    if (remoteBlob.state && !feesStateIsEmpty(remoteBlob.state)) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchFeeDeskFromDb();
  const hasAncillary =
    dbDesk.ancillary.cheques.length > 0 ||
    dbDesk.ancillary.manualBooks.length > 0 ||
    dbDesk.ancillary.dayCloses.length > 0 ||
    dbDesk.ancillary.chargeVouchers.length > 0 ||
    dbDesk.ancillary.installmentPlans.length > 0 ||
    dbDesk.ancillary.planAllocations.length > 0 ||
    dbDesk.ancillary.carriedForwardDues.length > 0;
  if (
    dbDesk.vouchers.length > 0 ||
    hasAncillary ||
    feesReadFromDbEnabled()
  ) {
    state = mergeDbDeskIntoFeesState(
      state,
      { vouchers: dbDesk.vouchers, ancillary: dbDesk.ancillary },
      {
        preferDb:
          feesReadFromDbEnabled() || (state.vouchers?.length ?? 0) === 0,
      },
    );
    changed = true;
  }

  if (changed) {
    writeFeesLocalRaw(state);
    setMirrorSlice("fees", state);
  }

  return changed;
}

/**
 * Pull fees blob + normalized desk (vouchers + ancillary).
 * DB wins when NEXT_PUBLIC_FEES_READ_FROM_DB=true or local is empty.
 */
export async function ensureFeesHydrated(): Promise<boolean> {
  const readFromDb = feesReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("fees")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { vouchers, ancillary, changed } = await hydrateFeesDeskFromDb(readFromDb);
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

  if (normChanged) {
    scheduleFeesSync(loadFees());
  }

  return blobChanged || normChanged;
}
