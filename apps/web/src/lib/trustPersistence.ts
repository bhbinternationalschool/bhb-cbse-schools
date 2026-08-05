/**
 * Trust remote sync — jsonb blob on trust_state + normalized trust_desk_slices.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadTrust,
  trustStateIsEmpty,
  writeTrustLocalRaw,
  type TrustState,
} from "@/lib/trust";
import {
  hydrateTrustDeskFromDb,
  scheduleTrustDeskSync,
} from "@/lib/trustNormalizedClient";
import { mergeDbDeskIntoTrustState } from "@/lib/trustNormalizedMerge";
import { trustReadFromDbEnabled } from "@/lib/trustDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "trust";

const blob = createDomainBlobPersistence<TrustState>({
  table: "trust_state",
  metaKey: "bhb_trust_v1_remote_meta",
  label: "trust",
  isEmpty: trustStateIsEmpty,
  loadLocal: loadTrust,
  writeLocalRaw: writeTrustLocalRaw,
});

export const trustRemoteEnabled = blob.remoteEnabled;
export function resetTrustPersistenceCache() {
  resetDeskHydrated(MODULE);
  blob.resetCache();
}

export function scheduleTrustSync(state: TrustState) {
  if (typeof window === "undefined") {
    void pushTrustRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("trust")) blob.scheduleSync(state);
  scheduleTrustDeskSync(state);
}

export async function pushTrustRemoteServer(
  state: TrustState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushTrustDeskToDb } = await import("@/lib/trustNormalized.server");
  const desk = await pushTrustDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("trust")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<TrustState>("trust_state");
  const remoteProjects = remote.state?.projects?.length ?? 0;
  const nextProjects = state.projects?.length ?? 0;
  if (nextProjects < remoteProjects && remote.state) return { ok: true };

  return pushServerBlob("trust_state", state);
}

export async function ensureTrustHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;
  markDeskHydrated(MODULE);

  const readFromDb = trustReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("trust")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed } = await hydrateTrustDeskFromDb(readFromDb);
  if (
    changed &&
    (bundle.projects.length > 0 || bundle.workItems.length > 0 || readFromDb)
  ) {
    writeTrustLocalRaw(
      mergeDbDeskIntoTrustState(loadTrust(), bundle, { preferDb: readFromDb }),
    );
    normChanged = true;
  }

  if (normChanged) scheduleTrustSync(loadTrust());
  return blobChanged || normChanged;
}

export async function ensureTrustHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchTrustDeskFromDb } = await import("@/lib/trustNormalized.server");
  const { trustReadFromDbEnabled } = await import("@/lib/trustDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadTrust();
  let changed = false;

  if (!deskSkipBlobPush("trust")) {
    const remoteBlob = await fetchServerBlob<TrustState>("trust_state");
    if (
      remoteBlob.state &&
      !trustReadFromDbEnabled() &&
      !trustStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchTrustDeskFromDb();
  if (
    dbDesk.bundle.projects.length > 0 ||
    dbDesk.bundle.workItems.length > 0 ||
    trustReadFromDbEnabled()
  ) {
    state = mergeDbDeskIntoTrustState(state, dbDesk.bundle, {
      preferDb:
        trustReadFromDbEnabled() || (state.projects?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) writeTrustLocalRaw(state);
  return changed;
}
