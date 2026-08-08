/**
 * Store state — jsonb blob on store_state + normalized store_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadStore,
  storeStateIsEmpty,
  writeStoreLocalRaw,
  type StoreState,
} from "@/lib/store";
import {
  hydrateStoreDeskFromDb,
  scheduleStoreDeskSync,
} from "@/lib/storeNormalizedClient";
import { mergeDbDeskIntoStoreState } from "@/lib/storeNormalizedMerge";
import { storeReadFromDbEnabled } from "@/lib/storeDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "store";

const blob = createDomainBlobPersistence<StoreState>({
  table: "store_state",
  metaKey: "bhb_store_v1_remote_meta",
  label: "store",
  isEmpty: storeStateIsEmpty,
  loadLocal: loadStore,
  writeLocalRaw: writeStoreLocalRaw,
});

export const storeRemoteEnabled = blob.remoteEnabled;
export const scheduleStoreSync = (state: StoreState) => {
  if (typeof window === "undefined") {
    void pushStoreRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("store")) blob.scheduleSync(state);
  scheduleStoreDeskSync(state);
};
export const ensureStoreHydrated = async () => {
  if (isDeskHydrated(MODULE)) return false;

  const readFromDb = storeReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("store")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed, ok } = await hydrateStoreDeskFromDb(readFromDb);
  if (!ok) {
    // Fetch failed — do not lock hydration flag; caller can retry later.
    return blobChanged;
  }
  markDeskHydrated(MODULE);
  if (changed && (bundle.items.length > 0 || readFromDb)) {
    writeStoreLocalRaw(
      mergeDbDeskIntoStoreState(loadStore(), bundle, { preferDb: readFromDb }),
    );
    normChanged = true;
  }
  if (normChanged) scheduleStoreSync(loadStore());
  return blobChanged || normChanged;
};

export async function pushStoreRemoteServer(
  state: StoreState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushStoreDeskToDb } = await import("@/lib/storeNormalized.server");
  const desk = await pushStoreDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("store")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<StoreState>("store_state");
  const remoteItems = remote.state?.items?.length ?? 0;
  const nextItems = state.items?.length ?? 0;
  if (nextItems < remoteItems && remote.state) return { ok: true };

  return pushServerBlob("store_state", state);
}

export async function ensureStoreHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchStoreDeskFromDb } = await import("@/lib/storeNormalized.server");
  const { storeReadFromDbEnabled } = await import("@/lib/storeDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadStore();
  let changed = false;

  if (!deskSkipBlobPush("store")) {
    const remoteBlob = await fetchServerBlob<StoreState>("store_state");
    if (
      remoteBlob.state &&
      !storeReadFromDbEnabled() &&
      !storeStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchStoreDeskFromDb();
  if (dbDesk.bundle.items.length > 0 || storeReadFromDbEnabled()) {
    state = mergeDbDeskIntoStoreState(state, dbDesk.bundle, {
      preferDb: storeReadFromDbEnabled() || (state.items?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) writeStoreLocalRaw(state);
  return changed;
}

export function resetStorePersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}
