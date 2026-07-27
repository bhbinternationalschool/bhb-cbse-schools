/**
 * Timetable remote sync — jsonb blob on timetable_state.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadTimetable,
  timetableStateIsEmpty,
  writeTimetableLocalRaw,
  type TimetableState,
} from "@/lib/timetable";

const blob = createDomainBlobPersistence<TimetableState>({
  table: "timetable_state",
  metaKey: "bhb_timetable_v1_remote_meta",
  label: "timetable",
  isEmpty: timetableStateIsEmpty,
  loadLocal: loadTimetable,
  writeLocalRaw: writeTimetableLocalRaw,
});

export const scheduleTimetableSync = blob.scheduleSync;
export const ensureTimetableHydrated = blob.ensureHydrated;
export const resetTimetablePersistenceCache = blob.resetCache;
