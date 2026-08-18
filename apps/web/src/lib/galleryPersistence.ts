/**
 * Standalone gallery desk hydrate/sync (school_comms_desk_albums / _photos).
 */

import {
  loadSchoolComms,
  writeSchoolCommsLocalRaw,
} from "@/lib/schoolComms";
import {
  hydrateGalleryDeskFromDb,
  scheduleGalleryDeskSync,
} from "@/lib/galleryNormalizedClient";
import { mergeDbDeskIntoGalleryState } from "@/lib/galleryNormalizedMerge";
import { galleryReadFromDbEnabled } from "@/lib/galleryDbConfig";
import {
  isDeskHydrated,
  markDeskHydrated,
} from "@/lib/deskHydrateGuard";

const MODULE = "gallery";

export { scheduleGalleryDeskSync };

export async function ensureGalleryHydrated(): Promise<boolean> {
  if (isDeskHydrated(MODULE)) return false;

  const readFromDb = galleryReadFromDbEnabled();
  const { bundle, changed, ok } = await hydrateGalleryDeskFromDb(readFromDb);
  if (!ok) {
    // Fetch failed — do not lock hydration flag; caller can retry later.
    return false;
  }
  markDeskHydrated(MODULE);
  if (!changed || (bundle.albums.length === 0 && !readFromDb)) return false;

  writeSchoolCommsLocalRaw(
    mergeDbDeskIntoGalleryState(loadSchoolComms(), bundle, {
      preferDb: readFromDb,
    }),
  );
  // Pull-only under desk-as-truth — hydrate must not re-push (audit 2026-08-18).
  if (!readFromDb) scheduleGalleryDeskSync();
  return true;
}

export async function pushGalleryRemoteServer(): Promise<{
  ok: boolean;
  error?: string;
}> {
  const state = loadSchoolComms();
  const { pushGalleryDeskToDb } = await import(
    "@/lib/schoolCommsNormalized.server"
  );
  return pushGalleryDeskToDb({
    albums: state.albums,
    photos: state.photos,
  });
}
