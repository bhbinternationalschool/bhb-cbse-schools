/**
 * ERP chat remote sync — jsonb blob on erp_chat_state with merge-on-hydrate.
 */

import { createDomainBlobPersistence } from "@/lib/domainBlobPersistence";
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

function writeLocalMerged(remote: ErpChatState) {
  const local = loadErpChat();
  const merged = mergeErpChatStates(local, normalizeErpChatState(remote));
  writeErpChatLocalRaw(merged);
}

const blob = createDomainBlobPersistence<ErpChatState>({
  table: "erp_chat_state",
  metaKey: META_KEY,
  label: "erp chat",
  isEmpty: erpChatStateIsEmpty,
  loadLocal: loadErpChat,
  writeLocalRaw: writeLocalMerged,
});

export const scheduleErpChatSync = blob.scheduleSync;
export const ensureErpChatHydrated = blob.ensureHydrated;
export const resetErpChatPersistenceCache = blob.resetCache;

/** Soft poll: pull remote and merge if newer. */
export async function pollErpChatRemote(): Promise<boolean> {
  if (!blob.remoteEnabled()) return false;
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
    const merged = mergeErpChatStates(
      loadErpChat(),
      normalizeErpChatState(data.state),
    );
    writeErpChatLocalRaw(merged);
    const after = JSON.stringify(merged);
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
