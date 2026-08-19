/**
 * Daily AI budget — counted from ai_generations (so it is shared across
 * Cloud Run instances, unlike an in-memory limiter). Three caps, all
 * env-tunable, all measured over the current IST day:
 *   AI_DAILY_CALLS_PER_USER    (default 300)  — one staff member's calls
 *   AI_DAILY_CALLS_PER_TENANT  (default 3000) — the school's calls
 *   AI_DAILY_TOKENS_PER_TENANT (default 2,000,000) — prompt + completion
 * Fails OPEN on a lookup error (a broken counter must not take AI down),
 * but logs loudly.
 */

import { getServerTenantContext } from "@/lib/serverTenant";

function envInt(name: string, dflt: number): number {
  const v = Number(process.env[name]);
  return Number.isFinite(v) && v > 0 ? Math.floor(v) : dflt;
}

/** Start of today in IST as an ISO timestamp. */
export function istDayStartIso(now = new Date()): string {
  const ist = new Date(now.getTime() + 330 * 60_000);
  const start = Date.UTC(ist.getUTCFullYear(), ist.getUTCMonth(), ist.getUTCDate()) - 330 * 60_000;
  return new Date(start).toISOString();
}

export type AiBudgetVerdict =
  | { ok: true }
  | { ok: false; reason: string; scope: "user" | "tenant_calls" | "tenant_tokens" };

export async function checkAiBudget(requester: string): Promise<AiBudgetVerdict> {
  const perUser = envInt("AI_DAILY_CALLS_PER_USER", 300);
  const perTenantCalls = envInt("AI_DAILY_CALLS_PER_TENANT", 3000);
  const perTenantTokens = envInt("AI_DAILY_TOKENS_PER_TENANT", 2_000_000);
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: true };
  const { sb, tenantId } = ctx;
  const since = istDayStartIso();
  try {
    const { data, error } = await sb
      .from("ai_generations")
      .select("requester, prompt_tokens, completion_tokens")
      .eq("tenant_id", tenantId)
      .gte("created_at", since);
    if (error) throw new Error(error.message);
    const rows = (data ?? []) as {
      requester: string;
      prompt_tokens: number | null;
      completion_tokens: number | null;
    }[];
    const tenantCalls = rows.length;
    const tenantTokens = rows.reduce(
      (a, r) => a + (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0),
      0,
    );
    const userCalls = requester === "system" ? 0 : rows.filter((r) => r.requester === requester).length;
    if (userCalls >= perUser) {
      return {
        ok: false,
        scope: "user",
        reason: `Daily AI limit reached for this account (${perUser} requests). Try again tomorrow or ask the office to raise AI_DAILY_CALLS_PER_USER.`,
      };
    }
    if (tenantCalls >= perTenantCalls) {
      return {
        ok: false,
        scope: "tenant_calls",
        reason: `The school's daily AI request limit (${perTenantCalls}) is reached. Try again tomorrow.`,
      };
    }
    if (tenantTokens >= perTenantTokens) {
      return {
        ok: false,
        scope: "tenant_tokens",
        reason: "The school's daily AI token budget is used up. Try again tomorrow.",
      };
    }
    return { ok: true };
  } catch (e) {
    console.error("[ai-budget] check failed — allowing call:", e instanceof Error ? e.message : e);
    return { ok: true };
  }
}
