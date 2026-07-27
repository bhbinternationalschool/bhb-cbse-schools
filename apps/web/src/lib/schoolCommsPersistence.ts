import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadSchoolComms,
  schoolCommsIsEmpty,
  writeSchoolCommsLocalRaw,
  type SchoolCommsState,
} from "@/lib/schoolComms";

const blob = createDomainBlobPersistence<SchoolCommsState>({
  table: "school_comms_state",
  metaKey: "bhb_school_comms_v1_remote_meta",
  label: "schoolComms",
  isEmpty: schoolCommsIsEmpty,
  loadLocal: loadSchoolComms,
  writeLocalRaw: writeSchoolCommsLocalRaw,
});

export const scheduleSchoolCommsSync = blob.scheduleSync;
export const ensureSchoolCommsHydrated = blob.ensureHydrated;
export const resetSchoolCommsPersistenceCache = blob.resetCache;
