/**
 * RTE remote sync — jsonb blob on rte_state + normalized rte_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadRte,
  rteStateIsEmpty,
  writeRteLocalRaw,
  type RteState,
} from "@/lib/rteEws";
import {
  hydrateRteDeskFromDb,
  scheduleRteDeskSync,
} from "@/lib/rteNormalizedClient";
import { mergeDbDeskIntoRteState } from "@/lib/rteNormalizedMerge";
import { rteReadFromDbEnabled } from "@/lib/rteDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "rte";

const blob = createDomainBlobPersistence<RteState>({
  table: "rte_state",
  metaKey: "bhb_rte_ews_v1_remote_meta",
  label: "rte",
  isEmpty: rteStateIsEmpty,
  loadLocal: loadRte,
  writeLocalRaw: writeRteLocalRaw,
});

export const rteRemoteEnabled = blob.remoteEnabled;
export function resetRtePersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}

export function scheduleRteSync(state: RteState) {
  if (typeof window === "undefined") {
    void pushRteRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("rte")) blob.scheduleSync(state);
  scheduleRteDeskSync(state);
}

export async function pushRteRemoteServer(
  state: RteState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushRteDeskToDb } = await import("@/lib/rteNormalized.server");
  const desk = await pushRteDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("rte")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<RteState>("rte_state");
  const remoteApps = remote.state?.applications?.length ?? 0;
  const nextApps = state.applications?.length ?? 0;
  if (nextApps < remoteApps && remote.state) return { ok: true };

  return pushServerBlob("rte_state", state);
}

export async function ensureRteHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;
  markDeskHydrated(MODULE);

  const readFromDb = rteReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("rte")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed } = await hydrateRteDeskFromDb(readFromDb);
  if (
    changed &&
    (bundle.seats.length > 0 ||
      bundle.applications.length > 0 ||
      readFromDb)
  ) {
    writeRteLocalRaw(
      mergeDbDeskIntoRteState(loadRte(), bundle, { preferDb: readFromDb }),
    );
    normChanged = true;
  }

  if (normChanged) scheduleRteSync(loadRte());
  return blobChanged || normChanged;
}

export async function ensureRteHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchRteDeskFromDb } = await import("@/lib/rteNormalized.server");
  const { rteReadFromDbEnabled } = await import("@/lib/rteDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadRte();
  let changed = false;

  if (!deskSkipBlobPush("rte")) {
    const remoteBlob = await fetchServerBlob<RteState>("rte_state");
    if (
      remoteBlob.state &&
      !rteReadFromDbEnabled() &&
      !rteStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchRteDeskFromDb();
  if (
    dbDesk.bundle.seats.length > 0 ||
    dbDesk.bundle.applications.length > 0 ||
    rteReadFromDbEnabled()
  ) {
    state = mergeDbDeskIntoRteState(state, dbDesk.bundle, {
      preferDb:
        rteReadFromDbEnabled() || (state.applications?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) writeRteLocalRaw(state);
  return changed;
}
