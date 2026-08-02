/**
 * Document vault remote sync — jsonb blob on vault_state + normalized vault_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadVault,
  vaultStateIsEmpty,
  writeVaultLocalRaw,
  type VaultState,
} from "@/lib/vault";
import {
  hydrateVaultDeskFromDb,
  scheduleVaultDeskSync,
} from "@/lib/vaultNormalizedClient";
import { mergeDbDeskIntoVaultState } from "@/lib/vaultNormalizedMerge";
import { vaultReadFromDbEnabled } from "@/lib/vaultDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";

const blob = createDomainBlobPersistence<VaultState>({
  table: "vault_state",
  metaKey: "bhb_vault_v1_remote_meta",
  label: "vault",
  isEmpty: vaultStateIsEmpty,
  loadLocal: loadVault,
  writeLocalRaw: writeVaultLocalRaw,
});

export const vaultRemoteEnabled = blob.remoteEnabled;
export const resetVaultPersistenceCache = blob.resetCache;

export function scheduleVaultSync(state: VaultState) {
  if (typeof window === "undefined") {
    void pushVaultRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("vault")) {
    blob.scheduleSync(state);
  }
  scheduleVaultDeskSync(state);
}

export async function pushVaultRemoteServer(
  state: VaultState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushVaultDeskToDb } = await import("@/lib/vaultNormalized.server");
  const desk = await pushVaultDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("vault")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<VaultState>("vault_state");
  const remoteDocs = remote.state?.documents?.length ?? 0;
  const nextDocs = state.documents?.length ?? 0;
  if (nextDocs < remoteDocs && remote.state) {
    return { ok: true };
  }

  return pushServerBlob("vault_state", state);
}

export async function ensureVaultHydrated(): Promise<boolean> {
  const readFromDb = vaultReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("vault")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed } = await hydrateVaultDeskFromDb(readFromDb);
  if (changed && (bundle.documents.length > 0 || readFromDb)) {
    const merged = mergeDbDeskIntoVaultState(loadVault(), bundle, {
      preferDb: readFromDb,
    });
    writeVaultLocalRaw(merged);
    normChanged = true;
  }

  if (normChanged) {
    scheduleVaultSync(loadVault());
  }

  return blobChanged || normChanged;
}

export async function ensureVaultHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchVaultDeskFromDb } = await import("@/lib/vaultNormalized.server");
  const { vaultReadFromDbEnabled } = await import("@/lib/vaultDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadVault();
  let changed = false;

  if (!deskSkipBlobPush("vault")) {
    const remoteBlob = await fetchServerBlob<VaultState>("vault_state");
    if (
      remoteBlob.state &&
      !vaultReadFromDbEnabled() &&
      !vaultStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchVaultDeskFromDb();
  if (dbDesk.bundle.documents.length > 0 || vaultReadFromDbEnabled()) {
    state = mergeDbDeskIntoVaultState(state, dbDesk.bundle, {
      preferDb: vaultReadFromDbEnabled() || (state.documents?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) {
    writeVaultLocalRaw(state);
  }

  return changed;
}
