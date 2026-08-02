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
  try {
    const { createBrowserSupabase, isSupabaseConfigured } = await import(
      "@/lib/supabase/client"
    );
    const { TENANT } = await import("@/lib/types");
    if (!isSupabaseConfigured()) return false;
    const sb = createBrowserSupabase();
    if (!sb) return false;
    const { data: tenant } = await sb
      .from("tenants")
      .select("id")
      .eq("slug", TENANT.slug)
      .maybeSingle();
    if (!tenant?.id) return false;
    const { data, error } = await sb
      .from("erp_chat_state")
      .select("state, updated_at")
      .eq("tenant_id", tenant.id)
      .maybeSingle();
    if (error || !data?.state) return false;
    const before = JSON.stringify(loadErpChat());
    blobWriteLocal(normalizeErpChatState(data.state));
    const after = JSON.stringify(loadErpChat());
    if (before !== after) {
      if (typeof window !== "undefined") {
        window.dispatchEvent(new Event("bhb-erp-chat"));
      }
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
