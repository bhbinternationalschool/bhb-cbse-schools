/**
 * The parent app's online fee payment — the parts the checkout and the
 * quote share, so the number a parent is quoted and the number the order is
 * created for come from the same recomputation.
 *
 * The client sends only due keys and, from app 1.0.14, the rail it chose.
 * Amounts always come from the fee book here, never from the phone.
 */
import "server-only";

import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { computeHouseholdDues, loadFees, openFeeDues } from "@/lib/fees";
import {
  GATEWAY_METHOD_GROUPS,
  GATEWAY_METHOD_LABELS,
  policyChargesParents,
  quoteAllGatewayFees,
  surchargeDisclosure,
  type GatewayMethodGroup,
} from "@/lib/gatewayFees";
import { fetchEligibleMethodGroups, loadGatewayFeePolicy } from "@/lib/gatewayFeePolicy.server";
import { loadMasters } from "@/lib/masters";
import { ensureSchoolMirrorHydrated } from "@/lib/schoolDataMirror.server";
import { loadSis } from "@/lib/sis";

export type ParentAuth = { ok: true; householdId: string } | { ok: false; status: number; error: string };

export async function parentHouseholdFrom(req: Request): Promise<ParentAuth> {
  try {
    const ctx = await resolveApiAuth(req);
    if (ctx.session.persona !== "parent" || !ctx.session.householdId) {
      return { ok: false, status: 403, error: "Parent session required" };
    }
    return { ok: true, householdId: ctx.session.householdId };
  } catch (e) {
    return { ok: false, status: 401, error: e instanceof ApiError ? e.message : "Unauthorized" };
  }
}

export function readDueKeys(raw: unknown): Set<string> {
  return new Set((Array.isArray(raw) ? raw : []).filter((k): k is string => typeof k === "string"));
}

/** A rail name from the client, or undefined — never a string we did not define. */
export function readMethodGroup(raw: unknown): GatewayMethodGroup | undefined {
  return typeof raw === "string" && (GATEWAY_METHOD_GROUPS as readonly string[]).includes(raw)
    ? (raw as GatewayMethodGroup)
    : undefined;
}

/**
 * The household's open dues the parent chose, recomputed. A family may pay
 * months ahead from the app, so future dues are included; only the chosen
 * keys are collected.
 */
export async function resolveChosenDues(householdId: string, wanted: Set<string>) {
  // Hydrated from the database: the local mirror file does not exist on Cloud
  // Run, so "loaded" meant no fee structure and nothing to pay.
  await ensureSchoolMirrorHydrated();
  const sis = loadSis();
  const masters = loadMasters();
  const fees = loadFees();
  const hh = sis.households.find((h) => h.id === householdId);
  if (!hh) return { ok: false as const, status: 404, error: "Household not found" };
  const bundle = computeHouseholdDues(hh.id, sis, masters, fees, { includeFuture: true });
  const dues = openFeeDues(bundle.flatMap((r) => r.dues)).filter(
    (d) => wanted.has(d.dueKey) && d.balancePaise > 0,
  );
  if (dues.length === 0) {
    return { ok: false as const, status: 400, error: "Nothing left to pay on the selected fees" };
  }
  return { ok: true as const, sis, masters, hh, dues };
}

/** The rails offered when Cashfree cannot be asked which ones it takes. */
const STANDARD_RAILS: GatewayMethodGroup[] = ["upi", "netbanking", "debit_card", "credit_card"];

export type PayOption = {
  group: GatewayMethodGroup;
  label: string;
  surchargePaise: number;
  chargeablePaise: number;
  note: string;
};

/**
 * What each way of paying would cost this parent for this amount.
 *
 * `chargesParents` false means the school absorbs every rail: the app then
 * skips the picker and goes straight to the open checkout, exactly as 1.0.13
 * does. Options are cheapest first, so the free rail leads.
 */
export async function quoteParentPayment(netPaise: number): Promise<{
  netPaise: number;
  chargesParents: boolean;
  options: PayOption[];
}> {
  const policy = await loadGatewayFeePolicy();
  if (!policyChargesParents(policy)) return { netPaise, chargesParents: false, options: [] };
  const available = (await fetchEligibleMethodGroups(netPaise)) ?? STANDARD_RAILS;
  const options = quoteAllGatewayFees({ netPaise, policy, available })
    .map((q) => ({
      group: q.group,
      label: GATEWAY_METHOD_LABELS[q.group],
      surchargePaise: q.surchargePaise,
      chargeablePaise: q.chargeablePaise,
      note: surchargeDisclosure(q),
    }))
    .sort(
      (a, b) =>
        a.surchargePaise - b.surchargePaise ||
        GATEWAY_METHOD_GROUPS.indexOf(a.group) - GATEWAY_METHOD_GROUPS.indexOf(b.group),
    );
  return { netPaise, chargesParents: true, options };
}
