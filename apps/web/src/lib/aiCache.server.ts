/**
 * Response cache for deterministic AI drafts — see migration
 * 20260819120000_ai_response_cache. Key = sha256 of everything that
 * determines the output. 30-day TTL enforced on read. Best-effort: a cache
 * failure never blocks a generation.
 */

import { createHash } from "crypto";
import { getServerTenantContext } from "@/lib/serverTenant";

const TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function aiCacheKey(parts: {
  route: string;
  promptVersion: string;
  tier: string;
  system: string;
  userMessage: string;
  history?: string;
}): string {
  return createHash("sha256")
    .update(
      [parts.route, parts.promptVersion, parts.tier, parts.system, parts.history ?? "", parts.userMessage].join(
        "",
      ),
    )
    .digest("hex");
}

export async function aiCacheGet(
  key: string,
): Promise<{ response: string; engine: string; model: string; generationId: string } | null> {
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { sb, tenantId } = ctx;
  try {
    const { data } = await sb
      .from("ai_response_cache")
      .select("response, engine, model, generation_id, created_at, hits")
      .eq("tenant_id", tenantId)
      .eq("cache_key", key)
      .maybeSingle();
    if (!data) return null;
    if (Date.now() - new Date(String(data.created_at)).getTime() > TTL_MS) {
      // Supabase builders are lazy — must be awaited to run.
      await sb.from("ai_response_cache").delete().eq("cache_key", key);
      return null;
    }
    await sb
      .from("ai_response_cache")
      .update({ hits: Number(data.hits ?? 0) + 1, last_hit_at: new Date().toISOString() })
      .eq("cache_key", key);
    return {
      response: String(data.response),
      engine: String(data.engine),
      model: String(data.model ?? ""),
      generationId: String(data.generation_id ?? ""),
    };
  } catch {
    return null;
  }
}

export async function aiCachePut(input: {
  key: string;
  route: string;
  engine: string;
  model: string;
  response: string;
  generationId: string;
}): Promise<void> {
  const ctx = await getServerTenantContext();
  if (!ctx) return;
  const { sb, tenantId } = ctx;
  try {
    await sb.from("ai_response_cache").upsert({
      cache_key: input.key,
      tenant_id: tenantId,
      route: input.route,
      engine: input.engine,
      model: input.model,
      response: input.response,
      generation_id: input.generationId,
    });
  } catch {
    /* best effort */
  }
}
