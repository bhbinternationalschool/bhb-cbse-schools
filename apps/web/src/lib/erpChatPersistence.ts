/**
 * ERP chat remote sync — desk slices + jsonb blob with merge-on-hydrate.
 */

import { createDeskSlicePersistence } from "@/lib/createDeskSlicePersistence";
import {
  emptyErpChatState,
  erpChatStateIsEmpty,
  loadErpChat,
  mergeErpChatStates,
  normalizeErpChatState,
  writeErpChatLocalRaw,
  type ErpChatState,
} from "@/lib/erpChat";

const META_KEY = "bhb_erp_chat_v2_remote_meta";

function writeLocalMerged(state: ErpChatState) {
  const local = loadErpChat();
  const merged = mergeErpChatStates(local, normalizeErpChatState(state));
  writeErpChatLocalRaw(merged);
}

const desk = createDeskSlicePersistence<ErpChatState>({
  moduleId: "erp_chat",
  blobMetaKey: META_KEY,
  label: "erp chat",
  isEmpty: erpChatStateIsEmpty,
  loadLocal: loadErpChat,
  writeLocalRaw: writeErpChatLocalRaw,
  blobWriteLocalRaw: writeLocalMerged,
  hasRemoteData: (b) =>
    (Array.isArray(b.threads) ? b.threads.length : 0) > 0,
});

// Blob hydrate still merges via domain blob path
const blobWriteLocal = writeLocalMerged;

export const scheduleErpChatSync = desk.scheduleSync;
export const ensureErpChatHydrated = desk.ensureHydrated;
export const resetErpChatPersistenceCache = desk.resetCache;

/** Soft poll: pull remote and merge if newer. */
export async function pollErpChatRemote(): Promise<boolean> {
  if (!desk.remoteEnabled()) return false;
  if (typeof window === "undefined") return false;
  try {
    const res = await fetch(
      "/api/school-data/domain-blob?table=erp_chat_state",
      { method: "GET", credentials: "same-origin", cache: "no-store" },
    );
    if (!res.ok) return false;
    const body = (await res.json()) as { ok?: boolean; state?: unknown };
    if (!body.ok || !body.state) return false;
    const before = JSON.stringify(loadErpChat());
    blobWriteLocal(normalizeErpChatState(body.state));
    const after = JSON.stringify(loadErpChat());
    if (before !== after) {
      window.dispatchEvent(new Event("bhb-erp-chat"));
      return true;
    }
    return false;
  } catch {
    return false;
  }
}

export function seedEmptyIfMissing() {
  if (erpChatStateIsEmpty(loadErpChat())) {
    writeErpChatLocalRaw(emptyErpChatState());
  }
}
