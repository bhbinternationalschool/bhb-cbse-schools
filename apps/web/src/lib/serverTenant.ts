/**
 * Resolve tenant id using service-role Supabase (server / WhatsApp webhooks).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { createServiceSupabase } from "@/lib/supabase/server";
import { TENANT } from "@/lib/types";

let tenantIdCache: string | null = null;

export async function getServerTenantContext(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  const sb = createServiceSupabase();
  if (!sb) return null;
  if (tenantIdCache) return { sb, tenantId: tenantIdCache };
  const { data, error } = await sb
    .from("tenants")
    .select("id")
    .eq("slug", TENANT.slug)
    .maybeSingle();
  if (error || !data?.id) {
    console.warn("[serverTenant] resolve failed", error?.message);
    return null;
  }
  tenantIdCache = data.id as string;
  return { sb, tenantId: tenantIdCache };
}
