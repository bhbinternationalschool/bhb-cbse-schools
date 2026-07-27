import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  homeworkStateIsEmpty,
  loadHomework,
  writeHomeworkLocalRaw,
  type HomeworkState,
} from "@/lib/homework";

const blob = createDomainBlobPersistence<HomeworkState>({
  table: "homework_state",
  metaKey: "bhb_homework_v1_remote_meta",
  label: "homework",
  isEmpty: homeworkStateIsEmpty,
  loadLocal: loadHomework,
  writeLocalRaw: writeHomeworkLocalRaw,
});

export const scheduleHomeworkSync = blob.scheduleSync;
export const ensureHomeworkHydrated = blob.ensureHydrated;
export const resetHomeworkPersistenceCache = blob.resetCache;
