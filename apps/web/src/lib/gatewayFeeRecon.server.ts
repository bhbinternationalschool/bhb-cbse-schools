/**
 * Quoted against actual, per payment rail.
 *
 * The school configures a rate per rail in order to quote a charge at
 * checkout. The rate it configured and the rate Cashfree really applied are
 * two different numbers — card pricing differs by network, and Cashfree
 * revises it — so a configured rate that is too low loses money on every
 * payment made on that rail, silently, for as long as nobody looks.
 *
 * This is the looking. The settlement recon report already stores, per event,
 * the gross and the amount that event contributed net of its own fees, so the
 * ACTUAL fee is a subtraction and not an estimate:
 *
 *   actual fee = event_amount_paise − event_settlement_paise
 *
 * Joined to the checkout by order_id, which also carries what we quoted and
 * which rail we quoted it for. Without method_group on the checkout there
 * would be no way to tell WHICH rail's rate was wrong, only that something was.
 *
 * SHORTFALL IS THE DIRECTION THAT MATTERS. Over-recovery is a parent charged
 * slightly too much, which is visible and refundable. A shortfall is the
 * school quietly absorbing part of a fee it believed it had passed on, and
 * nothing anywhere else in the system would ever show it.
 */

import "server-only";

import { GATEWAY_METHOD_LABELS, type GatewayMethodGroup } from "@/lib/gatewayFees";
import { getServerTenantContext } from "@/lib/serverTenant";

export type RailReconRow = {
  group: GatewayMethodGroup | "unknown";
  label: string;
  payments: number;
  /** What we added to orders on this rail. */
  quotedPaise: number;
  /** What Cashfree actually deducted on those same payments. */
  actualPaise: number;
  /** Positive: the school absorbed this much it meant to recover. */
  shortfallPaise: number;
  /** Positive: parents were charged this much more than the fee came to. */
  overRecoveredPaise: number;
};

export type GatewayFeeRecon = {
  from: string;
  to: string;
  /** Rails with at least one settled payment in the window. */
  rails: RailReconRow[];
  totals: { payments: number; quotedPaise: number; actualPaise: number; shortfallPaise: number; overRecoveredPaise: number };
  /**
   * Settled payments whose order we could not match to a checkout row —
   * a payment taken outside this ERP, or an order predating the surcharge
   * columns. Reported rather than folded into a rail, because counting them
   * as zero-quoted would read as a shortfall the school never caused.
   */
  unmatchedPayments: number;
};

/**
 * Reconcile a window. Dates are YYYY-MM-DD and inclusive, read as IST days —
 * the day the office means.
 */
export async function gatewayFeeReconciliation(range: {
  from: string;
  to: string;
}): Promise<GatewayFeeRecon> {
  const empty: GatewayFeeRecon = {
    from: range.from,
    to: range.to,
    rails: [],
    totals: { payments: 0, quotedPaise: 0, actualPaise: 0, shortfallPaise: 0, overRecoveredPaise: 0 },
    unmatchedPayments: 0,
  };
  const ctx = await getServerTenantContext();
  if (!ctx) return empty;

  const fromIso = new Date(`${range.from}T00:00:00+05:30`).toISOString();
  const toIso = new Date(`${range.to}T23:59:59.999+05:30`).toISOString();
  if (Number.isNaN(Date.parse(fromIso)) || Number.isNaN(Date.parse(toIso))) return empty;

  const { data: events } = await ctx.sb
    .from("ledger_pg_settlement_events")
    .select("order_id, event_amount_paise, event_settlement_paise, sale_type, event_time")
    .eq("tenant_id", ctx.tenantId)
    .neq("order_id", "")
    .gte("event_time", fromIso)
    .lte("event_time", toIso);

  const rows = (events ?? []) as Record<string, unknown>[];
  if (rows.length === 0) return empty;

  // Only the capture events. A refund is also an event with a fee of its own,
  // but it was never quoted to a parent at checkout, so including it would
  // read as a shortfall on a rail that did nothing wrong.
  const captures = rows.filter((r) => {
    const sale = String(r.sale_type ?? "").toUpperCase();
    return !sale.includes("REFUND") && !sale.includes("CHARGEBACK") && Number(r.event_amount_paise ?? 0) > 0;
  });
  if (captures.length === 0) return empty;

  const orderIds = [...new Set(captures.map((r) => String(r.order_id ?? "")).filter(Boolean))];
  const bySurcharge = new Map<string, { surchargePaise: number; methodGroup: string }>();
  // Chunked: a term list of a few thousand order ids is refused by PostgREST,
  // and a settlement window can easily hold that many on a fee-collection day.
  for (let i = 0; i < orderIds.length; i += 200) {
    const { data } = await ctx.sb
      .from("cashfree_checkouts")
      .select("order_id, surcharge_paise, method_group")
      .eq("tenant_id", ctx.tenantId)
      .in("order_id", orderIds.slice(i, i + 200));
    for (const raw of data ?? []) {
      const r = raw as Record<string, unknown>;
      bySurcharge.set(String(r.order_id ?? ""), {
        surchargePaise: Math.max(0, Math.round(Number(r.surcharge_paise ?? 0))),
        methodGroup: String(r.method_group ?? ""),
      });
    }
  }

  const byRail = new Map<string, RailReconRow>();
  let unmatched = 0;

  for (const r of captures) {
    const orderId = String(r.order_id ?? "");
    const match = bySurcharge.get(orderId);
    if (!match) {
      unmatched += 1;
      continue;
    }
    const gross = Math.round(Number(r.event_amount_paise ?? 0));
    const net = Math.round(Number(r.event_settlement_paise ?? 0));
    const actual = Math.max(0, gross - net);

    // Empty method_group means no rail was recorded, which is every payment
    // where the school absorbed the fee. Grouped as "unknown" rather than
    // dropped: the ACTUAL cost is still worth seeing even when nothing was
    // quoted, because it is what the school is paying to take money online.
    const key = (match.methodGroup || "unknown") as GatewayMethodGroup | "unknown";
    const existing = byRail.get(key) ?? {
      group: key,
      label: key === "unknown" ? "Not recorded / school absorbed" : GATEWAY_METHOD_LABELS[key],
      payments: 0,
      quotedPaise: 0,
      actualPaise: 0,
      shortfallPaise: 0,
      overRecoveredPaise: 0,
    };
    existing.payments += 1;
    existing.quotedPaise += match.surchargePaise;
    existing.actualPaise += actual;
    byRail.set(key, existing);
  }

  // Netted per rail rather than per payment: a rail that is a rupee over on
  // one payment and a rupee under on the next is fine, and reporting both as
  // problems would bury the rail that is genuinely mispriced.
  const rails = [...byRail.values()].map((row) => {
    const diff = row.actualPaise - row.quotedPaise;
    return {
      ...row,
      shortfallPaise: diff > 0 ? diff : 0,
      overRecoveredPaise: diff < 0 ? -diff : 0,
    };
  });
  rails.sort((a, b) => b.shortfallPaise - a.shortfallPaise || b.payments - a.payments);

  return {
    from: range.from,
    to: range.to,
    rails,
    totals: rails.reduce(
      (acc, r) => ({
        payments: acc.payments + r.payments,
        quotedPaise: acc.quotedPaise + r.quotedPaise,
        actualPaise: acc.actualPaise + r.actualPaise,
        shortfallPaise: acc.shortfallPaise + r.shortfallPaise,
        overRecoveredPaise: acc.overRecoveredPaise + r.overRecoveredPaise,
      }),
      { payments: 0, quotedPaise: 0, actualPaise: 0, shortfallPaise: 0, overRecoveredPaise: 0 },
    ),
    unmatchedPayments: unmatched,
  };
}
