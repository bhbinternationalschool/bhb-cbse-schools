import "server-only";

import {
  feesStateIsEmpty,
  loadFees,
  writeFeesLocalRaw,
  type FeesState,
} from "@/lib/fees";
import { mergeDbDeskIntoFeesState } from "@/lib/feesNormalizedMerge";
import { feesReadFromDbEnabled } from "@/lib/feesDbConfig";

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
