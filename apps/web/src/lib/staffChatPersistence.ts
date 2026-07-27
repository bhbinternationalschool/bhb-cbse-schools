/**
 * Internal staff chat remote sync — jsonb blob on staff_chat_state.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
import {
  loadStaffChat,
  staffChatStateIsEmpty,
  writeStaffChatLocalRaw,
  type StaffChatState,
} from "@/lib/staffInternalChat";

const blob = createDomainBlobPersistence<StaffChatState>({
  table: "staff_chat_state",
  metaKey: "bhb_staff_chat_v1_remote_meta",
  label: "staff chat",
  isEmpty: staffChatStateIsEmpty,
  loadLocal: loadStaffChat,
  writeLocalRaw: writeStaffChatLocalRaw,
});

export const scheduleStaffChatSync = blob.scheduleSync;
export const ensureStaffChatHydrated = blob.ensureHydrated;
export const resetStaffChatPersistenceCache = blob.resetCache;
