/**
 * Exams remote sync — jsonb blob on exams_state.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  examsStateIsEmpty,
  loadExams,
  writeExamsLocalRaw,
  type ExamsState,
} from "@/lib/exams";

const blob = createDomainBlobPersistence<ExamsState>({
  table: "exams_state",
  metaKey: "bhb_exams_v1_remote_meta",
  label: "exams",
  isEmpty: examsStateIsEmpty,
  loadLocal: loadExams,
  writeLocalRaw: writeExamsLocalRaw,
});

export const examsRemoteEnabled = blob.remoteEnabled;
export const scheduleExamsSync = blob.scheduleSync;
export const ensureExamsHydrated = blob.ensureHydrated;
export const resetExamsPersistenceCache = blob.resetCache;
