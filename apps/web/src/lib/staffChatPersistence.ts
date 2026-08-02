/**
 * Internal staff chat remote sync — desk slices + jsonb blob.
 */

import { createDeskSlicePersistence } from "@/lib/createDeskSlicePersistence";
import {
  loadStaffChat,
  staffChatStateIsEmpty,
  writeStaffChatLocalRaw,
  type StaffChatState,
} from "@/lib/staffInternalChat";

const desk = createDeskSlicePersistence<StaffChatState>({
  moduleId: "staff_chat",
  blobMetaKey: "bhb_staff_chat_v1_remote_meta",
  label: "staff chat",
  isEmpty: staffChatStateIsEmpty,
  loadLocal: loadStaffChat,
  writeLocalRaw: writeStaffChatLocalRaw,
  hasRemoteData: (b) =>
    (Array.isArray(b.threads) ? b.threads.length : 0) > 0,
});

export const scheduleStaffChatSync = desk.scheduleSync;
export const ensureStaffChatHydrated = desk.ensureHydrated;
export const resetStaffChatPersistenceCache = desk.resetCache;
