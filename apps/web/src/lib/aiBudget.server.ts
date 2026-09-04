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

/**
 * Today's tallies, held for a short window so a conversation's follow-up
 * messages do not each pay the ai_generations scan (a quarter second on
 * the critical path before the model is even asked). The tallies are
 * bumped locally by noteAiBudgetUse() as calls complete, so a cap still
 * trips at the right count inside the window; other Cloud Run instances'
 * calls are only seen at the next refresh, which is the accepted slack.
 */
const BUDGET_TALLY_TTL_MS = 15_000;
type BudgetTally = {
  since: string;
  at: number;
  tenantCalls: number;
  tenantTokens: number;
  userCalls: Map<string, number>;
};
let budgetTally: BudgetTally | null = null;

export function noteAiBudgetUse(requester: string, tokens: number): void {
  const t = budgetTally;
  if (!t) return;
  t.tenantCalls += 1;
  t.tenantTokens += Math.max(0, tokens);
  if (requester !== "system") {
    t.userCalls.set(requester, (t.userCalls.get(requester) ?? 0) + 1);
  }
}

async function loadBudgetTally(since: string): Promise<BudgetTally | null> {
  const now = Date.now();
  const cached = budgetTally;
  if (cached && cached.since === since && now - cached.at < BUDGET_TALLY_TTL_MS) {
    return cached;
  }
  const ctx = await getServerTenantContext();
  if (!ctx) return null;
  const { sb, tenantId } = ctx;
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
  const userCalls = new Map<string, number>();
  let tenantTokens = 0;
  for (const r of rows) {
    tenantTokens += (r.prompt_tokens ?? 0) + (r.completion_tokens ?? 0);
    userCalls.set(r.requester, (userCalls.get(r.requester) ?? 0) + 1);
  }
  budgetTally = { since, at: now, tenantCalls: rows.length, tenantTokens, userCalls };
  return budgetTally;
}

export async function checkAiBudget(requester: string): Promise<AiBudgetVerdict> {
  const perUser = envInt("AI_DAILY_CALLS_PER_USER", 300);
  const perTenantCalls = envInt("AI_DAILY_CALLS_PER_TENANT", 3000);
  const perTenantTokens = envInt("AI_DAILY_TOKENS_PER_TENANT", 2_000_000);
  const since = istDayStartIso();
  try {
    const tally = await loadBudgetTally(since);
    if (!tally) return { ok: true };
    const tenantCalls = tally.tenantCalls;
    const tenantTokens = tally.tenantTokens;
    const userCalls = requester === "system" ? 0 : (tally.userCalls.get(requester) ?? 0);
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
