import type { SchoolCommsState } from "@/lib/schoolComms";
import { galleryReadFromDbEnabled } from "@/lib/galleryDbConfig";
import type { GalleryDeskBundle } from "@/lib/schoolCommsNormalized.server";

export function mergeDbDeskIntoGalleryState(
  state: SchoolCommsState,
  bundle: GalleryDeskBundle,
  opts?: { preferDb?: boolean },
): SchoolCommsState {
  const hasRemote = bundle.albums.length > 0 || bundle.photos.length > 0;
  if (!hasRemote && !galleryReadFromDbEnabled() && !opts?.preferDb) return state;

  const preferDb = !!opts?.preferDb || galleryReadFromDbEnabled();

  const albumById = new Map<string, SchoolCommsState["albums"][0]>();
  if (!preferDb) for (const a of state.albums ?? []) albumById.set(a.id, a);
  for (const a of bundle.albums) albumById.set(a.id, a);
  if (!preferDb) {
    for (const a of state.albums ?? []) {
      if (!albumById.has(a.id)) albumById.set(a.id, a);
    }
  }

  const photoById = new Map<string, SchoolCommsState["photos"][0]>();
  if (!preferDb) for (const p of state.photos ?? []) photoById.set(p.id, p);
  for (const p of bundle.photos) photoById.set(p.id, p);
  if (!preferDb) {
    for (const p of state.photos ?? []) {
      if (!photoById.has(p.id)) photoById.set(p.id, p);
    }
  }

  return {
    ...state,
    version: 1,
    albums: [...albumById.values()],
    photos: [...photoById.values()],
  };
}
