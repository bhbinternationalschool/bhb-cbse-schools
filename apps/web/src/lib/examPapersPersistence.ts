/**
 * Exam papers remote sync — desk slices + jsonb blob.
 */

import { createDeskSlicePersistence } from "@/lib/createDeskSlicePersistence";
import {
  examPapersStateIsEmpty,
  loadExamPapers,
  writeExamPapersLocalRaw,
  type ExamPapersState,
} from "@/lib/examPapers";

const desk = createDeskSlicePersistence<ExamPapersState>({
  moduleId: "exam_papers",
  blobMetaKey: "bhb_exam_papers_v1_remote_meta",
  label: "exam papers",
  isEmpty: examPapersStateIsEmpty,
  loadLocal: loadExamPapers,
  writeLocalRaw: writeExamPapersLocalRaw,
  hasRemoteData: (b) => (Array.isArray(b.papers) ? b.papers.length : 0) > 0,
});

export const scheduleExamPapersSync = desk.scheduleSync;
export const ensureExamPapersHydrated = desk.ensureHydrated;
export const resetExamPapersPersistenceCache = desk.resetCache;
