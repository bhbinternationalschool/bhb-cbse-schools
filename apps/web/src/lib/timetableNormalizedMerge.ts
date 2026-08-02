import type { TimetableState } from "@/lib/timetable";
import { normalizeTimetableState } from "@/lib/timetable";
import { timetableReadFromDbEnabled } from "@/lib/timetableDbConfig";
import type { TimetableDeskBundle } from "@/lib/timetableNormalized.server";

export function mergeDbDeskIntoTimetableState(
  state: TimetableState,
  bundle: TimetableDeskBundle,
  opts?: { preferDb?: boolean },
): TimetableState {
  const hasRemote =
    bundle.bellTemplate.length > 0 ||
    bundle.grids.length > 0 ||
    bundle.publishedGrids.length > 0 ||
    bundle.substitutions.length > 0;
  if (!hasRemote && !timetableReadFromDbEnabled() && !opts?.preferDb) {
    return state;
  }

  const preferDb = !!opts?.preferDb || timetableReadFromDbEnabled();
  const merged: TimetableState = {
    version: 1,
    workingWeekdays: preferDb
      ? bundle.workingWeekdays
      : state.workingWeekdays.length
        ? state.workingWeekdays
        : bundle.workingWeekdays,
    bellTemplate: preferDb
      ? bundle.bellTemplate
      : state.bellTemplate.length
        ? state.bellTemplate
        : bundle.bellTemplate,
    grids: preferDb
      ? bundle.grids
      : state.grids.length >= bundle.grids.length
        ? state.grids
        : bundle.grids,
    publishedGrids: preferDb
      ? bundle.publishedGrids
      : state.publishedGrids.length >= bundle.publishedGrids.length
        ? state.publishedGrids
        : bundle.publishedGrids,
    substitutions: preferDb
      ? bundle.substitutions
      : state.substitutions.length >= bundle.substitutions.length
        ? state.substitutions
        : bundle.substitutions,
    meta: bundle.meta?.status ? bundle.meta : state.meta,
  };

  return normalizeTimetableState(merged);
}
