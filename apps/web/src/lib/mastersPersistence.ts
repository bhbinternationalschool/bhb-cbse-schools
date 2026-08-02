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
  scheduleMastersDeskSync,
} from "@/lib/mastersNormalizedClient";
import { mergeDbDeskIntoMastersState } from "@/lib/mastersNormalizedMerge";
import { mastersReadFromDbEnabled } from "@/lib/mastersDbConfig";
import { deskSkipMirrorBlobSliceClient } from "@/lib/deskCutover";

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
  const readFromDb = mastersReadFromDbEnabled();
  let mirrorChanged = false;

  if (!deskSkipMirrorBlobSliceClient("masters")) {
    const { fetchSchoolMirror } = await import("@/lib/schoolDataMirror");
    const { hydrateMastersFromMirror } = await import("@/lib/masters");
    const remote = await fetchSchoolMirror();
    if (remote?.masters) {
      mirrorChanged = hydrateMastersFromMirror(
        remote.masters,
        remote.updatedAt,
        true,
      );
    }
  }

  let normChanged = false;
  const { bundle, changed } = await hydrateMastersDeskFromDb(readFromDb);
  if (
    changed &&
    (bundle.classes.length > 0 ||
      bundle.feeHeads.length > 0 ||
      readFromDb ||
      mastersMirrorIsEmpty(loadMasters()))
  ) {
    writeMastersLocalRaw(
      mergeDbDeskIntoMastersState(loadMasters(), bundle, {
        preferDb: readFromDb,
      }),
    );
    normChanged = true;
  }

  if (normChanged) scheduleMastersSync(loadMasters());
  return mirrorChanged || normChanged;
}
