/**
 * Exam papers remote sync — jsonb blob on exam_papers_state.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  examPapersStateIsEmpty,
  loadExamPapers,
  writeExamPapersLocalRaw,
  type ExamPapersState,
} from "@/lib/examPapers";

const blob = createDomainBlobPersistence<ExamPapersState>({
  table: "exam_papers_state",
  metaKey: "bhb_exam_papers_v1_remote_meta",
  label: "exam papers",
  isEmpty: examPapersStateIsEmpty,
  loadLocal: loadExamPapers,
  writeLocalRaw: writeExamPapersLocalRaw,
});

export const scheduleExamPapersSync = blob.scheduleSync;
export const ensureExamPapersHydrated = blob.ensureHydrated;
export const resetExamPapersPersistenceCache = blob.resetCache;
