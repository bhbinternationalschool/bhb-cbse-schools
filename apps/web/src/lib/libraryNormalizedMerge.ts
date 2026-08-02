import type { LibraryState } from "@/lib/library";
import { libraryReadFromDbEnabled } from "@/lib/libraryDbConfig";
import type { LibraryDeskBundle } from "@/lib/libraryNormalized.server";

export function mergeDbDeskIntoLibraryState(
  state: LibraryState,
  bundle: LibraryDeskBundle,
  opts?: { preferDb?: boolean },
): LibraryState {
  const hasRemote =
    bundle.titles.length > 0 ||
    bundle.copies.length > 0 ||
    bundle.issues.length > 0;
  if (!hasRemote && !opts?.preferDb && !libraryReadFromDbEnabled()) return state;

  const preferDb = !!opts?.preferDb || libraryReadFromDbEnabled();

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
    titles: mergeById(
      state.titles ?? [],
      bundle.titles,
      preferDb || bundle.titles.length >= (state.titles?.length ?? 0),
    ),
    copies: mergeById(
      state.copies ?? [],
      bundle.copies,
      preferDb || bundle.copies.length >= (state.copies?.length ?? 0),
    ),
    issues: mergeById(
      state.issues ?? [],
      bundle.issues,
      preferDb || bundle.issues.length >= (state.issues?.length ?? 0),
    ),
    settings: bundle.settings ?? state.settings,
  };
}
