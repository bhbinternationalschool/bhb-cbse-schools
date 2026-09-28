import { NextResponse } from "next/server";
import { requireStaffPermission } from "@/lib/apiRouteAuth.server";
import {
  GATEWAY_METHOD_GROUPS,
  GATEWAY_METHOD_LABELS,
  parseGatewayFeePolicy,
  policyChargesParents,
  quoteAllGatewayFees,
  type GatewayFeePolicy,
} from "@/lib/gatewayFees";
import {
  loadGatewayFeePolicy,
  saveGatewayFeePolicy,
} from "@/lib/gatewayFeePolicy.server";
import { gatewayFeeReconciliation } from "@/lib/gatewayFeeRecon.server";

export const runtime = "nodejs";

/**
 * Who bears the gateway fee — read and set.
 *
 * Before this the policy could be read by the code and changed only by SQL,
 * which is not a setting, it is a trap: nobody would remember it existed.
 *
 * GET returns the policy, a PREVIEW of what a parent would actually pay on
 * each rail for a real amount, and the quoted-against-actual reconciliation.
 * The preview matters more than it sounds — the whole risk of this feature is
 * a rate typed in a box turning into a charge on a card, and seeing "₹2,500
 * becomes ₹2,547 on a credit card" before saving is the difference between a
 * decision and a guess.
 *
 * PUT gated on `accounts: edit`: this is an accounts-desk instruction about
 * the school's own cost recovery, not a fee-counter action.
 */
const PREVIEW_AMOUNTS_PAISE = [250000, 1_000_000, 3_500_000];

function describe(policy: GatewayFeePolicy) {
  return {
    bearer: policy.bearer,
    perMethod: policy.perMethod ?? {},
    rates: policy.rates,
    gstPercent: policy.gstPercent,
    ratesAreDefaults: policy.ratesAreDefaults,
    fallbackGroup: policy.fallbackGroup,
    chargesParents: policyChargesParents(policy),
    rails: GATEWAY_METHOD_GROUPS.map((g) => ({ group: g, label: GATEWAY_METHOD_LABELS[g] })),
    preview: PREVIEW_AMOUNTS_PAISE.map((netPaise) => ({
      netPaise,
      rails: quoteAllGatewayFees({ netPaise, policy }).map((q) => ({
        group: q.group,
        bearer: q.bearer,
        surchargePaise: q.surchargePaise,
        chargeablePaise: q.chargeablePaise,
      })),
    })),
  };
}

export async function GET(req: Request) {
  const auth = await requireStaffPermission(req, "accounts", "view");
  if (!auth.ok) return auth.response;

  const url = new URL(req.url);
  const to = (url.searchParams.get("to") || "").trim() || new Date().toISOString().slice(0, 10);
  const from =
    (url.searchParams.get("from") || "").trim() ||
    new Date(Date.now() - 30 * 86400_000).toISOString().slice(0, 10);

  const policy = await loadGatewayFeePolicy();
  return NextResponse.json({
    ok: true,
    policy: describe(policy),
    recon: await gatewayFeeReconciliation({ from, to }),
  });
}

export async function PUT(req: Request) {
  const auth = await requireStaffPermission(req, "accounts", "edit");
  if (!auth.ok) return auth.response;

  let body: unknown;
  try {
    body = await req.json();
  } catch {
    return NextResponse.json({ ok: false, error: "Invalid JSON" }, { status: 400 });
  }

  // Parsed, not trusted. The same parser the reader uses, so what is stored is
  // exactly what will be read back — a policy that would be silently
  // downgraded on the way out is downgraded here, while whoever set it is
  // still looking at the screen. Everything unreadable degrades towards the
  // school bearing the cost, never towards charging a parent more.
  const wanted = parseGatewayFeePolicy(body);
  const saved = await saveGatewayFeePolicy(wanted);
  if (!saved.ok) return NextResponse.json(saved, { status: 400 });

  const stored = await loadGatewayFeePolicy();
  return NextResponse.json({
    ok: true,
    policy: describe(stored),
    // Said out loud on every save that turns this on, because it is the one
    // consequence a settings screen can hide: parents start paying more, at
    // the next payment, with no further confirmation anywhere.
    warning: policyChargesParents(stored)
      ? "Parents will now be charged the gateway fee on the rails marked 'payer'. Check the GST treatment and your fee-regulation position before telling families."
      : "",
  });
}
