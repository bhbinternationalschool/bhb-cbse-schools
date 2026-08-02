import type { SchoolCommsState } from "@/lib/schoolComms";
import { schoolCommsReadFromDbEnabled } from "@/lib/schoolCommsDbConfig";
import type { SchoolCommsDeskBundle } from "@/lib/schoolCommsNormalized.server";

export function mergeDbDeskIntoSchoolCommsState(
  state: SchoolCommsState,
  bundle: SchoolCommsDeskBundle,
  opts?: { preferDb?: boolean },
): SchoolCommsState {
  const hasRemote =
    bundle.notices.length > 0 ||
    bundle.news.length > 0 ||
    bundle.albums.length > 0 ||
    bundle.photos.length > 0;
  if (!hasRemote && !opts?.preferDb && !schoolCommsReadFromDbEnabled()) return state;

  const preferDb = !!opts?.preferDb || schoolCommsReadFromDbEnabled();

  function mergeById<T extends { id: string }>(
    local: T[],
    remote: T[],
    takeRemote: boolean,
  ): T[] {
    const byId = new Map<string, T>();
    if (!takeRemote) {
      for (const row of local) byId.set(row.id, row);
    }
    for (const row of remote) byId.set(row.id, row);
    if (!takeRemote) {
      for (const row of local) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    }
    return [...byId.values()];
  }

  return {
    ...state,
    version: 1,
    notices: mergeById(
      state.notices ?? [],
      bundle.notices,
      preferDb || bundle.notices.length >= (state.notices?.length ?? 0),
    ),
    news: mergeById(
      state.news ?? [],
      bundle.news,
      preferDb || bundle.news.length >= (state.news?.length ?? 0),
    ),
    albums: mergeById(
      state.albums ?? [],
      bundle.albums,
      preferDb || bundle.albums.length >= (state.albums?.length ?? 0),
    ),
    photos: mergeById(
      state.photos ?? [],
      bundle.photos,
      preferDb || bundle.photos.length >= (state.photos?.length ?? 0),
    ),
  };
}
