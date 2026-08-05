/**
 * Purchase state — jsonb blob on purchase_state + normalized purchase_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadPurchase,
  purchaseStateIsEmpty,
  writePurchaseLocalRaw,
  type PurchaseState,
} from "@/lib/purchase";
import {
  hydratePurchaseDeskFromDb,
  schedulePurchaseDeskSync,
} from "@/lib/purchaseNormalizedClient";
import { mergeDbDeskIntoPurchaseState } from "@/lib/purchaseNormalizedMerge";
import { purchaseReadFromDbEnabled } from "@/lib/purchaseDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "purchase";

const blob = createDomainBlobPersistence<PurchaseState>({
  table: "purchase_state",
  metaKey: "bhb_purchase_v1_remote_meta",
  label: "purchase",
  isEmpty: purchaseStateIsEmpty,
  loadLocal: loadPurchase,
  writeLocalRaw: writePurchaseLocalRaw,
});

export const purchaseRemoteEnabled = blob.remoteEnabled;
export const schedulePurchaseSync = (state: PurchaseState) => {
  if (typeof window === "undefined") {
    void pushPurchaseRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("purchase")) blob.scheduleSync(state);
  schedulePurchaseDeskSync(state);
};
export const ensurePurchaseHydrated = async () => {
  if (isDeskHydrated(MODULE)) return false;
  markDeskHydrated(MODULE);

  const readFromDb = purchaseReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("purchase")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed } = await hydratePurchaseDeskFromDb(readFromDb);
  if (changed && (bundle.indents.length > 0 || readFromDb)) {
    writePurchaseLocalRaw(
      mergeDbDeskIntoPurchaseState(loadPurchase(), bundle, { preferDb: readFromDb }),
    );
    normChanged = true;
  }
  if (normChanged) schedulePurchaseSync(loadPurchase());
  return blobChanged || normChanged;
};

export async function pushPurchaseRemoteServer(
  state: PurchaseState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushPurchaseDeskToDb } = await import("@/lib/purchaseNormalized.server");
  const desk = await pushPurchaseDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("purchase")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<PurchaseState>("purchase_state");
  const remoteIndents = remote.state?.indents?.length ?? 0;
  const nextIndents = state.indents?.length ?? 0;
  if (nextIndents < remoteIndents && remote.state) return { ok: true };

  return pushServerBlob("purchase_state", state);
}

export async function ensurePurchaseHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchPurchaseDeskFromDb } = await import("@/lib/purchaseNormalized.server");
  const { purchaseReadFromDbEnabled } = await import("@/lib/purchaseDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadPurchase();
  let changed = false;

  if (!deskSkipBlobPush("purchase")) {
    const remoteBlob = await fetchServerBlob<PurchaseState>("purchase_state");
    if (
      remoteBlob.state &&
      !purchaseReadFromDbEnabled() &&
      !purchaseStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchPurchaseDeskFromDb();
  if (dbDesk.bundle.indents.length > 0 || purchaseReadFromDbEnabled()) {
    state = mergeDbDeskIntoPurchaseState(state, dbDesk.bundle, {
      preferDb: purchaseReadFromDbEnabled() || (state.indents?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) writePurchaseLocalRaw(state);
  return changed;
}

export function resetPurchasePersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}
