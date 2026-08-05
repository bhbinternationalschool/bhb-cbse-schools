/**
 * Masters desk hydrate/sync — foundation + fee setup (school_mirror masters slice).
 */

import {
  loadMasters,
  mastersMirrorIsEmpty,
  type MastersState,
} from "@/lib/masters";
import { setMirrorSlice } from "@/lib/schoolDataMirror";
import {
  hydrateMastersDeskFromDb,
  mastersDeskPushPending,
  scheduleMastersDeskSync,
} from "@/lib/mastersNormalizedClient";
import { mergeDbDeskIntoMastersState } from "@/lib/mastersNormalizedMerge";
import { mastersReadFromDbEnabled } from "@/lib/mastersDbConfig";
import { deskSkipMirrorBlobSliceClient } from "@/lib/deskCutover";
import {
  isDeskHydrated,
  markDeskHydrated,
  resetDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "masters";

const STORAGE_KEY = "bhb_masters_v5";

export function writeMastersLocalRaw(state: MastersState): void {
  if (typeof window === "undefined") {
    setMirrorSlice("masters", state);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify({ ...state, version: 2 }));
  setMirrorSlice("masters", state);
}

export function scheduleMastersSync(state: MastersState) {
  if (typeof window === "undefined") {
    void pushMastersRemoteServer(state);
    return;
  }
  scheduleMastersDeskSync(state);
}

export async function pushMastersRemoteServer(
  state: MastersState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushMastersDeskToDb } = await import("@/lib/mastersNormalized.server");
  const desk = await pushMastersDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipMirrorBlobSlice } = await import("@/lib/deskCutover");
  if (deskSkipMirrorBlobSlice("masters")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const { stripStaffFromMastersForBlob } = await import("@/lib/staffPersistence");
  const remote = await fetchServerBlob<{ masters?: MastersState }>(
    "school_mirror_state",
  );
  const remoteClasses = remote.state?.masters?.classes?.length ?? 0;
  const nextClasses = state.classes?.length ?? 0;
  if (nextClasses < remoteClasses && remote.state?.masters) return { ok: true };

  const mirror = remote.state ?? {
    version: 1 as const,
    updatedAt: new Date().toISOString(),
    sis: null,
    fees: null,
    payments: null,
    masters: null,
    admissions: null,
  };
  return pushServerBlob("school_mirror_state", {
    ...mirror,
    masters: stripStaffFromMastersForBlob(state),
    updatedAt: new Date().toISOString(),
  });
}

export async function ensureMastersHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;
  markDeskHydrated(MODULE);

  const readFromDb = mastersReadFromDbEnabled();
  let mirrorChanged = false;

  if (!deskSkipMirrorBlobSliceClient("masters")) {
    const { fetchSchoolMirror } = await import("@/lib/schoolDataMirror");
    const { hydrateMastersFromMirror } = await import("@/lib/masters");
    const { readLocalMastersEditAt } = await import(
      "@/lib/mastersNormalizedClient"
    );
    const remote = await fetchSchoolMirror();
    if (remote?.masters) {
      const localAt = readLocalMastersEditAt();
      const remoteAt = remote.updatedAt || "";
      const remoteIsNewer = !localAt || (!!remoteAt && remoteAt > localAt);
      mirrorChanged = hydrateMastersFromMirror(
        remote.masters,
        remoteAt,
        remoteIsNewer,
      );
    }
  }

  let normChanged = false;
  const localBefore = loadMasters();
  const { bundle, changed } = await hydrateMastersDeskFromDb(readFromDb);
  if (
    changed &&
    (readFromDb ||
      bundle.classes.length > 0 ||
      bundle.feeHeads.length > 0 ||
      mastersMirrorIsEmpty(localBefore))
  ) {
    writeMastersLocalRaw(
      mergeDbDeskIntoMastersState(localBefore, bundle, {
        preferDb: readFromDb,
      }),
    );
    normChanged = true;
    // DB-read mode: hydrate is pull-only — edits sync via saveMasters().
    if (!readFromDb) {
      scheduleMastersSync(loadMasters());
    }
  } else if (readFromDb && mastersDeskPushPending()) {
    // Local edits never reached DB (tab closed, failed push) — push now.
    scheduleMastersSync(loadMasters());
  }
  return mirrorChanged || normChanged;
}

export function resetMastersPersistenceCache() {
  resetDeskHydrated(MODULE);
}
