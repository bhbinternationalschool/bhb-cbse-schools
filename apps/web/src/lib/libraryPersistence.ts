/**
 * Library state — jsonb blob on library_state + normalized library_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  libraryStateIsEmpty,
  loadLibrary,
  writeLibraryLocalRaw,
  type LibraryState,
} from "@/lib/library";
import {
  hydrateLibraryDeskFromDb,
  scheduleLibraryDeskSync,
} from "@/lib/libraryNormalizedClient";
import { mergeDbDeskIntoLibraryState } from "@/lib/libraryNormalizedMerge";
import { libraryReadFromDbEnabled } from "@/lib/libraryDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";

const blob = createDomainBlobPersistence<LibraryState>({
  table: "library_state",
  metaKey: "bhb_library_remote_at",
  label: "library",
  isEmpty: libraryStateIsEmpty,
  loadLocal: loadLibrary,
  writeLocalRaw: writeLibraryLocalRaw,
});

export const libraryRemoteEnabled = blob.remoteEnabled;
export const scheduleLibrarySync = (state: LibraryState) => {
  if (typeof window === "undefined") {
    void pushLibraryRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("library")) blob.scheduleSync(state);
  scheduleLibraryDeskSync(state);
};
export const ensureLibraryHydrated = async () => {
  const readFromDb = libraryReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("library")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed } = await hydrateLibraryDeskFromDb(readFromDb);
  if (changed && (bundle.titles.length > 0 || readFromDb)) {
    writeLibraryLocalRaw(
      mergeDbDeskIntoLibraryState(loadLibrary(), bundle, { preferDb: readFromDb }),
    );
    normChanged = true;
  }
  if (normChanged) scheduleLibrarySync(loadLibrary());
  return blobChanged || normChanged;
};

export async function pushLibraryRemoteServer(
  state: LibraryState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushLibraryDeskToDb } = await import("@/lib/libraryNormalized.server");
  const desk = await pushLibraryDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("library")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<LibraryState>("library_state");
  const remoteTitles = remote.state?.titles?.length ?? 0;
  const nextTitles = state.titles?.length ?? 0;
  if (nextTitles < remoteTitles && remote.state) return { ok: true };

  return pushServerBlob("library_state", state);
}

export async function ensureLibraryHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchLibraryDeskFromDb } = await import("@/lib/libraryNormalized.server");
  const { libraryReadFromDbEnabled } = await import("@/lib/libraryDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadLibrary();
  let changed = false;

  if (!deskSkipBlobPush("library")) {
    const remoteBlob = await fetchServerBlob<LibraryState>("library_state");
    if (
      remoteBlob.state &&
      !libraryReadFromDbEnabled() &&
      !libraryStateIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchLibraryDeskFromDb();
  if (dbDesk.bundle.titles.length > 0 || libraryReadFromDbEnabled()) {
    state = mergeDbDeskIntoLibraryState(state, dbDesk.bundle, {
      preferDb: libraryReadFromDbEnabled() || (state.titles?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) writeLibraryLocalRaw(state);
  return changed;
}
