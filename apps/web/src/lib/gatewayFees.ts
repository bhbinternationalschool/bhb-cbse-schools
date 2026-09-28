/**
 * Who bears the payment-gateway fee, and what that costs to the paisa.
 *
 * Pure: no network, no env, no clock. Every number a parent is shown and
 * every number the ledger posts comes from here, so it is testable in
 * isolation and the same arithmetic runs on the pay page and on the server.
 *
 * TWO NUMBERS, NEVER ONE
 *
 * The school's books already learn the REAL fee: the settlement recon report
 * gives gross and net per event, and buildPgSettlementVoucher posts the
 * difference to Payment Gateway Charges with its GST split out. That is
 * authoritative and it is not guesswork.
 *
 * What it cannot do is tell a parent, BEFORE they pay, what the charge will
 * be. For that the amount has to be grossed up at checkout from a rate the
 * school has configured. So there are two numbers by design:
 *
 *   quoted   what we told the parent and added to the order   (this file)
 *   actual   what Cashfree really deducted                    (recon report)
 *
 * They will not match to the paisa — a bank's card rate differs per network,
 * and Cashfree's own pricing changes. `reconcileQuoteAgainstActual` exists so
 * the difference is a report the office can look at rather than a silent drift.
 *
 * WHY THE DEFAULT IS `school`
 *
 * Adding a charge on top of a CBSE/state-regulated fee is a decision with a
 * regulator and a GST treatment attached, not a default. Shipping this with
 * `payer` on would start charging every parent the moment it deployed. So the
 * default policy is exactly today's behaviour — the school absorbs it — and
 * nothing changes until somebody sets it deliberately.
 */

/** Cashfree's own grouping, as the eligible-methods API returns it. */
export type GatewayMethodGroup =
  | "upi"
  | "netbanking"
  | "debit_card"
  | "credit_card"
  | "prepaid_card"
  | "wallet"
  | "pay_later"
  | "emi";

export const GATEWAY_METHOD_GROUPS: readonly GatewayMethodGroup[] = [
  "upi",
  "netbanking",
  "debit_card",
  "credit_card",
  "prepaid_card",
  "wallet",
  "pay_later",
  "emi",
] as const;

/** What a parent sees next to each rail. Kept short — it goes on a button. */
export const GATEWAY_METHOD_LABELS: Record<GatewayMethodGroup, string> = {
  upi: "UPI",
  netbanking: "Net banking",
  debit_card: "Debit card",
  credit_card: "Credit card",
  prepaid_card: "Prepaid card",
  wallet: "Wallet",
  pay_later: "Pay later",
  emi: "EMI",
};

/**
 * One rail's price. `percent` is of the amount charged, `flatPaise` is per
 * transaction, and GST applies to their sum.
 */
export type GatewayRate = { percent: number; flatPaise: number };

export type GatewayRateTable = Record<GatewayMethodGroup, GatewayRate>;

/** GST on a gateway fee. 18% at the time of writing; a setting, not a constant. */
export const DEFAULT_GATEWAY_GST_PERCENT = 18;

/**
 * Starting rates, to be replaced with the school's actual Cashfree pricing.
 *
 * These are deliberately conservative placeholders, NOT quoted pricing: real
 * rates are per-merchant and per-network and Cashfree revises them. The
 * reconciliation report is what tells the office whether these are right, and
 * `ratesAreDefaults` is carried through so the UI can say so out loud.
 */
export function defaultGatewayRates(): GatewayRateTable {
  return {
    // UPI on an education merchant is commonly zero-MDR. Charging a parent
    // for it when it costs nothing would be indefensible, so it starts at 0.
    upi: { percent: 0, flatPaise: 0 },
    netbanking: { percent: 0, flatPaise: 900 },
    debit_card: { percent: 0.4, flatPaise: 0 },
    credit_card: { percent: 1.9, flatPaise: 0 },
    prepaid_card: { percent: 1.9, flatPaise: 0 },
    wallet: { percent: 1.9, flatPaise: 0 },
    pay_later: { percent: 1.9, flatPaise: 0 },
    // EMI carries the issuer's interest subvention on top of the MDR and is
    // the widest-varying rail of the set.
    emi: { percent: 2.5, flatPaise: 0 },
  };
}

export type GatewayFeeBearer = "school" | "payer";

/**
 * How the fee is split, per rail.
 *
 * `bearer: "method"` is not a third mode — it is `perMethod` being consulted.
 * Keeping the shape flat means a school that passes on cards but not UPI is
 * expressible without a second concept.
 */
export type GatewayFeePolicy = {
  /** Applies to any rail `perMethod` does not name. */
  bearer: GatewayFeeBearer;
  perMethod?: Partial<Record<GatewayMethodGroup, GatewayFeeBearer>>;
  rates: GatewayRateTable;
  gstPercent: number;
  /**
   * True while `rates` is still the shipped placeholder set. Surfaced to the
   * office so a quoted charge is never mistaken for the school's real pricing.
   */
  ratesAreDefaults: boolean;
  /**
   * Rail used when a quote is needed before the parent has chosen one — a
   * WhatsApp pay-link, say, where there is no picker. In `payer` mode the
   * parent still sees the per-rail table on the pay page.
   */
  fallbackGroup: GatewayMethodGroup;
};

/** Today's behaviour, expressed as a policy: the school absorbs everything. */
export function defaultGatewayFeePolicy(): GatewayFeePolicy {
  return {
    bearer: "school",
    rates: defaultGatewayRates(),
    gstPercent: DEFAULT_GATEWAY_GST_PERCENT,
    ratesAreDefaults: true,
    fallbackGroup: "upi",
  };
}

export function bearerFor(
  policy: GatewayFeePolicy,
  group: GatewayMethodGroup,
): GatewayFeeBearer {
  return policy.perMethod?.[group] ?? policy.bearer;
}

export type GatewayFeeQuote = {
  group: GatewayMethodGroup;
  bearer: GatewayFeeBearer;
  /** What the school's books must receive — the fee due, unchanged. */
  netPaise: number;
  /** Added to the order when the payer bears it; 0 when the school does. */
  surchargePaise: number;
  /** What Cashfree is asked to collect: net + surcharge. */
  chargeablePaise: number;
  /** The fee itself, before GST — for the disclosure line and the report. */
  feePaise: number;
  /** GST on that fee. */
  gstPaise: number;
};

/**
 * The gateway's own cut on an amount it collects. Rounded half-up to the
 * paisa, which is the direction Cashfree rounds and the direction that does
 * not quietly under-state the cost.
 */
export function gatewayFeeOn(
  chargeablePaise: number,
  rate: GatewayRate,
  gstPercent: number,
): { feePaise: number; gstPaise: number; totalPaise: number } {
  const base = Math.max(0, Math.round(chargeablePaise));
  const feePaise = Math.round((base * rate.percent) / 100 + rate.flatPaise);
  const gstPaise = Math.round((feePaise * gstPercent) / 100);
  return { feePaise, gstPaise, totalPaise: feePaise + gstPaise };
}

/**
 * What to charge so the school nets `netPaise` after the fee on the charge.
 *
 * Solving the circularity rather than adding the fee on the net: the fee is a
 * percentage OF THE CHARGED amount, so `net + fee(net)` still leaves the
 * school short. With g = 1 + gst/100,
 *
 *   C = net + g·(C·r/100 + flat)   ⇒   C = (net + g·flat) / (1 − g·r/100)
 *
 * The surcharge is then rounded UP to the whole rupee: a parent should see a
 * round number, and rounding down would make the school under-recover on
 * every single transaction.
 */
export function quoteGatewayFee(input: {
  netPaise: number;
  group: GatewayMethodGroup;
  policy: GatewayFeePolicy;
}): GatewayFeeQuote {
  const { group, policy } = input;
  const netPaise = Math.max(0, Math.round(input.netPaise));
  const bearer = bearerFor(policy, group);
  const rate = policy.rates[group] ?? { percent: 0, flatPaise: 0 };

  if (bearer === "school" || netPaise === 0) {
    // The school's cost is still worth reporting even though the parent is
    // not charged for it, so the fee is quoted on the amount as it stands.
    const cost = gatewayFeeOn(netPaise, rate, policy.gstPercent);
    return {
      group,
      bearer: "school",
      netPaise,
      surchargePaise: 0,
      chargeablePaise: netPaise,
      feePaise: cost.feePaise,
      gstPaise: cost.gstPaise,
    };
  }

  const g = 1 + policy.gstPercent / 100;
  const denominator = 1 - (g * rate.percent) / 100;
  // A rate at or above 100/g would make the gross-up diverge or go negative.
  // No real rate is anywhere near it; refusing to charge rather than
  // producing a nonsense figure is the safe branch if one is ever configured.
  if (!(denominator > 0) || !Number.isFinite(denominator)) {
    const cost = gatewayFeeOn(netPaise, rate, policy.gstPercent);
    return {
      group,
      bearer: "school",
      netPaise,
      surchargePaise: 0,
      chargeablePaise: netPaise,
      feePaise: cost.feePaise,
      gstPaise: cost.gstPaise,
    };
  }

  const exact = (netPaise + g * rate.flatPaise) / denominator;
  const rawSurcharge = Math.max(0, exact - netPaise);
  // Up to the next whole rupee, so the parent is shown ₹12 and not ₹11.63.
  const surchargePaise = Math.ceil(rawSurcharge / 100) * 100;
  const chargeablePaise = netPaise + surchargePaise;
  const cost = gatewayFeeOn(chargeablePaise, rate, policy.gstPercent);

  return {
    group,
    bearer: "payer",
    netPaise,
    surchargePaise,
    chargeablePaise,
    feePaise: cost.feePaise,
    gstPaise: cost.gstPaise,
  };
}

/**
 * Every rail priced for one amount — what the pay page shows so a parent can
 * see that UPI is free before they reach for a credit card.
 *
 * `available` narrows it to what the account actually has enabled; passing
 * nothing prices the full set.
 */
export function quoteAllGatewayFees(input: {
  netPaise: number;
  policy: GatewayFeePolicy;
  available?: readonly GatewayMethodGroup[];
}): GatewayFeeQuote[] {
  const groups = input.available?.length ? input.available : GATEWAY_METHOD_GROUPS;
  return groups
    .filter((g) => GATEWAY_METHOD_GROUPS.includes(g))
    .map((group) => quoteGatewayFee({ netPaise: input.netPaise, group, policy: input.policy }));
}

/** The quote used where no rail has been chosen yet — a WhatsApp pay-link. */
export function fallbackGatewayQuote(input: {
  netPaise: number;
  policy: GatewayFeePolicy;
}): GatewayFeeQuote {
  return quoteGatewayFee({
    netPaise: input.netPaise,
    group: input.policy.fallbackGroup,
    policy: input.policy,
  });
}

/** True when any rail would add something to what a parent pays. */
export function policyChargesParents(policy: GatewayFeePolicy): boolean {
  if (policy.bearer === "payer") return true;
  return Object.values(policy.perMethod ?? {}).some((b) => b === "payer");
}

/**
 * One line of plain language for the parent, before they pay.
 *
 * Never silent: a charge a parent discovers on their card statement rather
 * than on the pay page is the same failure as a receipt for money that was
 * never booked, pointed the other way.
 */
export function surchargeDisclosure(quote: GatewayFeeQuote): string {
  if (quote.surchargePaise <= 0) return "No payment charge on this method.";
  const rupees = (quote.surchargePaise / 100).toFixed(2).replace(/\.00$/, "");
  const total = (quote.chargeablePaise / 100).toFixed(2).replace(/\.00$/, "");
  return `Includes a ₹${rupees} payment charge — you will pay ₹${total}.`;
}

/**
 * Quoted against actual, per settlement event.
 *
 * `shortfall` positive means the school recovered LESS than the gateway took,
 * which is the direction that matters: it means the configured rate for that
 * rail is too low and every transaction on it is losing money quietly.
 */
export function reconcileQuoteAgainstActual(input: {
  surchargePaise: number;
  actualFeePaise: number;
}): { shortfallPaise: number; overRecoveredPaise: number } {
  const diff = Math.round(input.actualFeePaise) - Math.round(input.surchargePaise);
  return {
    shortfallPaise: diff > 0 ? diff : 0,
    overRecoveredPaise: diff < 0 ? -diff : 0,
  };
}

/** Cashfree's `payment_group` strings, mapped onto our groups. */
export function gatewayGroupFromCashfree(raw: string): GatewayMethodGroup | null {
  const key = (raw || "").trim().toLowerCase();
  if (!key) return null;
  const map: Record<string, GatewayMethodGroup> = {
    upi: "upi",
    upi_credit_card: "credit_card",
    upi_credit_line: "pay_later",
    upi_ppi: "wallet",
    net_banking: "netbanking",
    netbanking: "netbanking",
    credit_card: "credit_card",
    debit_card: "debit_card",
    prepaid_card: "prepaid_card",
    wallet: "wallet",
    pay_later: "pay_later",
    paylater: "pay_later",
    cardless_emi: "emi",
    credit_card_emi: "emi",
    debit_card_emi: "emi",
    emi: "emi",
    bank_transfer: "netbanking",
  };
  return map[key] ?? null;
}
