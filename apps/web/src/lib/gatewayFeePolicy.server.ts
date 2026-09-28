/**
 * The school's standing decision on who bears the gateway fee, read from
 * accounts_desk_settings, and the rails its Cashfree account will actually
 * accept for a given amount.
 *
 * Server-only: the policy read is a service-role query, and the eligibility
 * call carries the Cashfree keys.
 *
 * Both of these fail SOFT, and in the same direction. A settings read that
 * errors returns the default policy, which charges no parent anything. An
 * eligibility call that errors returns null, and every caller reads null as
 * "offer the standard rails" rather than blocking a payment. A parent must
 * never be unable to pay a fee because a settings table or an eligibility
 * endpoint was briefly unavailable — that is a worse failure than a
 * surcharge not being collected.
 */

import "server-only";

import {
  defaultGatewayFeePolicy,
  parseGatewayFeePolicy,
  type GatewayFeePolicy,
  type GatewayMethodGroup,
} from "@/lib/gatewayFees";
import { cashfreeAuthHeaders, cashfreeBaseUrl, cashfreeKeysPresent } from "@/lib/cashfree.server";
import { cashfreeFiltersFor, readEligibleGroups } from "@/lib/gatewayMethods";
import { getServerTenantContext } from "@/lib/serverTenant";

/**
 * Cached per process for a minute.
 *
 * The policy is read on every checkout, and it changes when somebody edits a
 * settings screen — minutes matter, milliseconds do not. A short TTL rather
 * than a long one because the thing being cached decides what a parent is
 * charged, and a stale answer there should not outlive a single sitting at
 * the accounts desk.
 */
const POLICY_TTL_MS = 60_000;
let policyCache: { at: number; tenantId: string; policy: GatewayFeePolicy } | null = null;

export async function loadGatewayFeePolicy(): Promise<GatewayFeePolicy> {
  const ctx = await getServerTenantContext();
  if (!ctx) return defaultGatewayFeePolicy();

  const now = Date.now();
  if (policyCache && policyCache.tenantId === ctx.tenantId && now - policyCache.at < POLICY_TTL_MS) {
    return policyCache.policy;
  }

  const { data, error } = await ctx.sb
    .from("accounts_desk_settings")
    .select("gateway_fee_policy")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  // An unreadable setting is not a reason to charge a parent something, nor a
  // reason to refuse the payment. It is a reason to do what the school did
  // before the setting existed: absorb the fee.
  const policy = error ? defaultGatewayFeePolicy() : parseGatewayFeePolicy(data?.gateway_fee_policy);
  policyCache = { at: now, tenantId: ctx.tenantId, policy };
  return policy;
}

/** Drop the cache — called by the settings writer so an edit takes effect at once. */
export function forgetGatewayFeePolicy(): void {
  policyCache = null;
}

export async function saveGatewayFeePolicy(
  policy: GatewayFeePolicy,
): Promise<{ ok: true } | { ok: false; error: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "No tenant context" };

  // Round-tripped through the parser before storing, so the column can only
  // ever hold something the reader will accept. A policy that would be
  // silently downgraded on the way out should be downgraded on the way in,
  // where the person who set it is still there to see what was stored.
  const clean = parseGatewayFeePolicy(policy as unknown);
  const { error } = await ctx.sb.from("accounts_desk_settings").upsert(
    {
      tenant_id: ctx.tenantId,
      gateway_fee_policy: {
        bearer: clean.bearer,
        ...(clean.perMethod ? { perMethod: clean.perMethod } : {}),
        rates: clean.rates,
        gstPercent: clean.gstPercent,
        fallbackGroup: clean.fallbackGroup,
      },
      updated_at: new Date().toISOString(),
    },
    { onConflict: "tenant_id" },
  );
  if (error) return { ok: false, error: error.message };
  forgetGatewayFeePolicy();
  return { ok: true };
}

/* ── what the account will actually accept ──────────────────────────────── */

const METHODS_TTL_MS = 10 * 60_000;
let methodsCache: { at: number; amountPaise: number; groups: GatewayMethodGroup[] } | null = null;

/**
 * The rails this account can offer for this amount, from Cashfree rather than
 * from a list in our source.
 *
 * Why ask per amount: EMI and Pay Later have issuer minimums, so a ₹200 book
 * charge and a ₹35,000 annual fee genuinely differ. Offering EMI on an amount
 * no bank will finance sends a parent into a dead end at the last step.
 *
 * Null means "could not tell" — the keys are missing, the call failed, or the
 * response was not the shape we expect. Callers offer the standard rails and
 * let Cashfree's own checkout be the authority, which it is anyway.
 */
export async function fetchEligibleMethodGroups(
  amountPaise: number,
): Promise<GatewayMethodGroup[] | null> {
  if (!cashfreeKeysPresent()) return null;
  const amount = Number((Math.max(0, Math.round(amountPaise)) / 100).toFixed(2));
  if (!(amount > 0)) return null;

  const now = Date.now();
  // Bucketed by rupee so a cache is actually reused across a class's fees
  // rather than being a miss on every distinct paisa.
  if (methodsCache && methodsCache.amountPaise === Math.round(amountPaise) && now - methodsCache.at < METHODS_TTL_MS) {
    return methodsCache.groups;
  }

  let payload: unknown;
  try {
    const res = await fetch(`${cashfreeBaseUrl()}/eligibility/payment_methods`, {
      method: "POST",
      headers: cashfreeAuthHeaders(),
      body: JSON.stringify({ queries: { amount } }),
    });
    if (!res.ok) return null;
    payload = await res.json();
  } catch {
    // Never let this throw into a checkout. A parent who cannot see the EMI
    // button can still pay; a parent who sees an error cannot.
    return null;
  }

  const groups = readEligibleGroups(payload);
  if (!groups) return null;
  methodsCache = { at: now, amountPaise: Math.round(amountPaise), groups };
  return groups;
}

/**
 * Re-exported so a caller needs one import for "which rails, and how do I ask
 * Cashfree for them". The implementations are in gatewayMethods.ts, which is
 * importable by the selftest runner; this module is server-only.
 */
export { cashfreeFiltersFor, readEligibleGroups };
