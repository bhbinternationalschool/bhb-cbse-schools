/**
 * The pure half of payment-rail eligibility: reading Cashfree's reply, and
 * the filter names to send back when an order is restricted to one rail.
 *
 * Split out of gatewayFeePolicy.server.ts for the same reason
 * cashfreeCheckout.ts is split out of cashfree.server.ts — the server module
 * carries `server-only`, which the selftest runner cannot import. The parsing
 * is the part most worth testing, so it lives where it can be.
 */

import { gatewayGroupFromCashfree, type GatewayMethodGroup } from "@/lib/gatewayFees";

/**
 * Cashfree's filter names for the rails it will take.
 *
 * NOT a lowercase of our own group names. `netbanking` happens to match, but
 * `emi` is three of Cashfree's filters and `credit_card` is three more, so the
 * mapping is spelled out. Getting it wrong restricts an order to a rail that
 * does not exist and the parent arrives at a checkout with nothing on it.
 */
const CASHFREE_FILTERS: Record<GatewayMethodGroup, string[]> = {
  upi: ["upi"],
  netbanking: ["netbanking", "banktransfer"],
  debit_card: ["debit_card"],
  credit_card: ["credit_card", "corporate_credit_card", "upi_credit_card"],
  prepaid_card: ["prepaid_card"],
  wallet: ["wallet", "upi_ppi"],
  pay_later: ["paylater"],
  emi: ["cardless_emi", "credit_card_emi", "debit_card_emi"],
};

export function cashfreeFiltersFor(groups: readonly GatewayMethodGroup[]): string[] {
  const out = new Set<string>();
  for (const g of groups) for (const f of CASHFREE_FILTERS[g] ?? []) out.add(f);
  return [...out];
}

/**
 * Pull the eligible rails out of an eligibility response.
 *
 * Three documented envelopes across API versions — a bare array, `items`, and
 * `payment_methods` — and the per-rail detail sits sometimes on the row and
 * sometimes nested under `entity_details.payment_method_details`. All of them
 * are accepted, because a version bump should cost a button on the picker at
 * worst, never a payment.
 *
 * Null means "could not tell". Callers offer the standard rails and let
 * Cashfree's own checkout be the authority, which it is regardless.
 */
export function readEligibleGroups(payload: unknown): GatewayMethodGroup[] | null {
  const asRows = (v: unknown): unknown[] | null => (Array.isArray(v) ? v : null);
  const obj = (payload && typeof payload === "object" ? payload : {}) as Record<string, unknown>;
  const rows = asRows(payload) ?? asRows(obj.items) ?? asRows(obj.payment_methods);
  if (!rows) return null;

  const out = new Set<GatewayMethodGroup>();
  const take = (raw: unknown) => {
    const group = gatewayGroupFromCashfree(String(raw ?? ""));
    if (group) out.add(group);
  };

  for (const row of rows) {
    if (!row || typeof row !== "object") continue;
    const r = row as Record<string, unknown>;
    // `eligibility: false` is Cashfree saying this parent, at this amount,
    // cannot use this rail — EMI below the issuer's minimum, say. Offering it
    // anyway is the dead end at the last step that this call exists to avoid.
    // Absent means eligible; only an explicit false excludes.
    if (r.eligibility === false) continue;

    take(r.payment_method);
    take(r.entity);

    const details = (
      r.entity_details && typeof r.entity_details === "object" ? r.entity_details : {}
    ) as Record<string, unknown>;
    take(details.payment_method);
    for (const mode of asRows(details.payment_method_details) ?? []) {
      if (!mode || typeof mode !== "object") continue;
      const m = mode as Record<string, unknown>;
      if (m.eligibility === false) continue;
      if (m.isActive === false) continue;
      // payment_group is the field the live account returns on every mode, so
      // it is preferred over the display nickname.
      take(m.payment_group);
      take(m.payment_method);
    }
  }

  // An empty set is not an answer. It means the payload was read and nothing
  // in it recognised — a parsing failure, not a school with no way to be paid.
  // Returning [] would read as "offer nothing" and stop parents paying.
  return out.size ? [...out] : null;
}
