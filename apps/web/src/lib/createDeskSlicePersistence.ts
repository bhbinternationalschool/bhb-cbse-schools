/**
 * Factory: jsonb blob + desk slices for secondary modules.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import type { DomainBlobTable } from "@/lib/domainBlobPersistence";
import type { DeskModuleId } from "@/lib/deskCutover";
import {
  deskSkipBlobHydrateClient,
  deskSkipBlobPushClient,
} from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";
import { deskSliceDef, deskSliceEnvReadFromDb } from "@/lib/deskSliceRegistry";
import {
  hydrateDeskSliceFromDb,
  scheduleDeskSliceSync,
} from "@/lib/deskSliceNormalizedClient";
import { mergeDeskSliceBundle } from "@/lib/deskSliceMerge";
import { pushDeskSliceToDb } from "@/lib/deskSliceNormalized.server";

export function createDeskSlicePersistence<T extends { version: number }>(opts: {
  moduleId: DeskModuleId;
  blobMetaKey: string;
  label: string;
  isEmpty: (state: T) => boolean;
  loadLocal: () => T;
  writeLocalRaw: (state: T) => void;
  /** Optional merge path when hydrating from jsonb blob */
  blobWriteLocalRaw?: (state: T) => void;
  hasRemoteData: (bundle: Record<string, unknown>) => boolean;
}) {
  const def = deskSliceDef(opts.moduleId);
  if (!def) {
    throw new Error(`Unknown desk slice module: ${opts.moduleId}`);
  }

  const blobTable = def.blobTable as DomainBlobTable;
  const serverBlobTable = def.blobTable as import("@/lib/serverBlob").ServerBlobTable;

  const blob = createDomainBlobPersistence<T>({
    table: blobTable,
    metaKey: opts.blobMetaKey,
    label: opts.label,
    isEmpty: opts.isEmpty,
    loadLocal: opts.loadLocal,
    writeLocalRaw: opts.blobWriteLocalRaw ?? opts.writeLocalRaw,
  });

  function readFromDbEnabled() {
    return deskSliceEnvReadFromDb(def!.envPrefix);
  }

  function scheduleSync(state: T) {
    if (typeof window === "undefined") {
      void pushRemoteServer(state);
      return;
    }
    if (!deskSkipBlobPushClient(opts.moduleId)) blob.scheduleSync(state);
    scheduleDeskSliceSync(
      opts.moduleId,
      state as T & Record<string, unknown>,
    );
  }

  async function pushRemoteServer(
    state: T,
  ): Promise<{ ok: boolean; error?: string }> {
    const desk = await pushDeskSliceToDb(
      opts.moduleId,
      state as T & Record<string, unknown>,
    );
    if (!desk.ok) return { ok: false, error: desk.error };

    const { deskSkipBlobPush } = await import("@/lib/deskCutover");
    if (deskSkipBlobPush(opts.moduleId)) return { ok: true };

    const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
    const remote = await fetchServerBlob<T>(serverBlobTable);
    if (remote.state && opts.isEmpty(state) && !opts.isEmpty(remote.state)) {
      return { ok: true };
    }
    return pushServerBlob(serverBlobTable, state);
  }

  async function ensureHydrated(): Promise<boolean> {
    if (isDeskHydrated(opts.moduleId)) return false;
    markDeskHydrated(opts.moduleId);

    const readFromDb = readFromDbEnabled();
    const blobChanged = deskSkipBlobHydrateClient(opts.moduleId)
      ? false
      : await blob.ensureHydrated();

    let normChanged = false;
    const { bundle, changed } = await hydrateDeskSliceFromDb(
      opts.moduleId,
      readFromDb,
    );
    if (changed && (opts.hasRemoteData(bundle) || readFromDb)) {
      opts.writeLocalRaw(
        mergeDeskSliceBundle(opts.loadLocal(), bundle, { preferDb: readFromDb }),
      );
      normChanged = true;
    }

    if (normChanged) scheduleSync(opts.loadLocal());
    return blobChanged || normChanged;
  }

  return {
    remoteEnabled: blob.remoteEnabled,
    resetCache: () => {
      resetDeskHydrated(opts.moduleId);
      blob.resetCache();
    },
    scheduleSync,
    ensureHydrated,
    pushRemoteServer,
  };
}
