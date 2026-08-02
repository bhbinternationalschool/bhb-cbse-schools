/**
 * School comms — jsonb blob on school_comms_state + normalized school_comms_desk_*.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadSchoolComms,
  schoolCommsIsEmpty,
  writeSchoolCommsLocalRaw,
  type SchoolCommsState,
} from "@/lib/schoolComms";
import {
  hydrateSchoolCommsDeskFromDb,
  scheduleSchoolCommsDeskSync,
} from "@/lib/schoolCommsNormalizedClient";
import { mergeDbDeskIntoSchoolCommsState } from "@/lib/schoolCommsNormalizedMerge";
import { schoolCommsReadFromDbEnabled } from "@/lib/schoolCommsDbConfig";
import { deskSkipBlobHydrateClient, deskSkipBlobPushClient } from "@/lib/deskCutover";

const blob = createDomainBlobPersistence<SchoolCommsState>({
  table: "school_comms_state",
  metaKey: "bhb_school_comms_v1_remote_meta",
  label: "schoolComms",
  isEmpty: schoolCommsIsEmpty,
  loadLocal: loadSchoolComms,
  writeLocalRaw: writeSchoolCommsLocalRaw,
});

export const schoolCommsRemoteEnabled = blob.remoteEnabled;
export const scheduleSchoolCommsSync = (state: SchoolCommsState) => {
  if (typeof window === "undefined") {
    void pushSchoolCommsRemoteServer(state);
    return;
  }
  if (!deskSkipBlobPushClient("school_comms")) blob.scheduleSync(state);
  scheduleSchoolCommsDeskSync(state);
  void import("@/lib/galleryPersistence").then(({ scheduleGalleryDeskSync }) => {
    scheduleGalleryDeskSync();
  });
  void import("@/lib/newsPersistence").then(({ scheduleNewsDeskSync }) => {
    scheduleNewsDeskSync();
  });
};
export const ensureSchoolCommsHydrated = async () => {
  const readFromDb = schoolCommsReadFromDbEnabled();
  const blobChanged = deskSkipBlobHydrateClient("school_comms")
    ? false
    : await blob.ensureHydrated();

  let normChanged = false;
  const { bundle, changed } = await hydrateSchoolCommsDeskFromDb(readFromDb);
  if (
    changed &&
    (bundle.notices.length > 0 ||
      bundle.news.length > 0 ||
      bundle.albums.length > 0 ||
      readFromDb)
  ) {
    writeSchoolCommsLocalRaw(
      mergeDbDeskIntoSchoolCommsState(loadSchoolComms(), bundle, {
        preferDb: readFromDb,
      }),
    );
    normChanged = true;
  }
  if (normChanged) scheduleSchoolCommsSync(loadSchoolComms());

  const { ensureGalleryHydrated } = await import("@/lib/galleryPersistence");
  const { ensureNewsHydrated } = await import("@/lib/newsPersistence");
  const galleryChanged = await ensureGalleryHydrated();
  const newsChanged = await ensureNewsHydrated();

  return blobChanged || normChanged || galleryChanged || newsChanged;
};

export async function pushSchoolCommsRemoteServer(
  state: SchoolCommsState,
): Promise<{ ok: boolean; error?: string }> {
  const { pushSchoolCommsDeskToDb } = await import(
    "@/lib/schoolCommsNormalized.server"
  );
  const desk = await pushSchoolCommsDeskToDb(state);
  if (!desk.ok) return { ok: false, error: desk.error };

  const { deskSkipBlobPush } = await import("@/lib/deskCutover");
  if (deskSkipBlobPush("school_comms")) return { ok: true };

  const { fetchServerBlob, pushServerBlob } = await import("@/lib/serverBlob");
  const remote = await fetchServerBlob<SchoolCommsState>("school_comms_state");
  const remoteNotices = remote.state?.notices?.length ?? 0;
  const nextNotices = state.notices?.length ?? 0;
  if (nextNotices < remoteNotices && remote.state) return { ok: true };

  return pushServerBlob("school_comms_state", state);
}

export async function ensureSchoolCommsHydratedServer(): Promise<boolean> {
  if (typeof window !== "undefined") return false;

  const { fetchServerBlob } = await import("@/lib/serverBlob");
  const { fetchSchoolCommsDeskFromDb } = await import(
    "@/lib/schoolCommsNormalized.server"
  );
  const { schoolCommsReadFromDbEnabled } = await import("@/lib/schoolCommsDbConfig");
  const { deskSkipBlobPush } = await import("@/lib/deskCutover");

  let state = loadSchoolComms();
  let changed = false;

  if (!deskSkipBlobPush("school_comms")) {
    const remoteBlob = await fetchServerBlob<SchoolCommsState>("school_comms_state");
    if (
      remoteBlob.state &&
      !schoolCommsReadFromDbEnabled() &&
      !schoolCommsIsEmpty(remoteBlob.state)
    ) {
      state = remoteBlob.state;
      changed = true;
    }
  }

  const dbDesk = await fetchSchoolCommsDeskFromDb();
  if (
    dbDesk.bundle.notices.length > 0 ||
    dbDesk.bundle.news.length > 0 ||
    schoolCommsReadFromDbEnabled()
  ) {
    state = mergeDbDeskIntoSchoolCommsState(state, dbDesk.bundle, {
      preferDb:
        schoolCommsReadFromDbEnabled() || (state.notices?.length ?? 0) === 0,
    });
    changed = true;
  }

  if (changed) writeSchoolCommsLocalRaw(state);
  return changed;
}

export const resetSchoolCommsPersistenceCache = blob.resetCache;
