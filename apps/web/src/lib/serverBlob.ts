/**
 * Fetch / upsert tenant jsonb blobs via service-role Supabase.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerTenantContext } from "@/lib/serverTenant";

export type ServerBlobTable =
  | "school_mirror_state"
  | "wa_bot_threads_state"
  | "fees_state"
  | "payments_state"
  | "admissions_state"
  | "staff_attendance_state";

export async function fetchServerBlob<T>(
  table: ServerBlobTable,
): Promise<{ state: T | null; updatedAt: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { state: null, updatedAt: "" };
  const { sb, tenantId } = ctx;
  const { data, error } = await sb
    .from(table)
    .select("state, updated_at")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  if (error || !data) {
    if (error) console.warn(`[serverBlob] pull ${table} failed`, error.message);
    return { state: null, updatedAt: "" };
  }
  return {
    state: (data.state as T) ?? null,
    updatedAt: String(data.updated_at || ""),
  };
}

export type PushServerBlobResult = {
  ok: boolean;
  error?: string;
};

export async function pushServerBlob<T>(
  table: ServerBlobTable,
  state: T,
  sb?: SupabaseClient,
  tenantId?: string,
): Promise<PushServerBlobResult> {
  const ctx =
    sb && tenantId
      ? { sb, tenantId }
      : await getServerTenantContext();
  if (!ctx) {
    return {
      ok: false,
      error: "Supabase service role or tenant not configured on server",
    };
  }
  const now = new Date().toISOString();
  const { error } = await ctx.sb.from(table).upsert(
    {
      tenant_id: ctx.tenantId,
      state,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );
  if (error) {
    const message = error.message || "upsert failed";
    console.warn(`[serverBlob] push ${table} failed`, message);
    return { ok: false, error: message };
  }
  return { ok: true };
}
