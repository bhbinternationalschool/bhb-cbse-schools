/**
 * Self-test: who bears the gateway fee, and what that costs to the paisa.
 * Run: npx tsx apps/web/src/lib/gatewayFees.selftest.ts
 *
 * This decides what a parent is charged, so the arithmetic is pinned rather
 * than spot-checked. The property that matters is the round trip: charge the
 * quoted amount, take the gateway's real cut out of it, and the school must
 * still be left with the whole fee. Anything less and the fee book shows a
 * head unpaid; anything much more and a parent has been over-charged.
 */
import assert from "node:assert/strict";

import {
  bearerFor,
  defaultGatewayFeePolicy,
  fallbackGatewayQuote,
  gatewayFeeOn,
  gatewayGroupFromCashfree,
  parseGatewayFeePolicy,
  policyChargesParents,
  quoteAllGatewayFees,
  quoteGatewayFee,
  reconcileQuoteAgainstActual,
  surchargeDisclosure,
  type GatewayFeePolicy,
} from "@/lib/gatewayFees";

console.log("gatewayFees.selftest.ts");

/* ── the default changes nothing for any parent ───────────────────────── */
{
  const policy = defaultGatewayFeePolicy();
  assert.equal(policy.bearer, "school", "shipping default is the school absorbing the fee");
  assert.equal(
    policyChargesParents(policy),
    false,
    "the default policy must not charge a single parent — it ships to a live school",
  );

  for (const netPaise of [100, 250000, 4_000_000]) {
    const q = quoteGatewayFee({ netPaise, group: "credit_card", policy });
    assert.equal(q.surchargePaise, 0, "school-bears adds nothing to the order");
    assert.equal(q.chargeablePaise, netPaise, "the parent pays exactly the fee due");
    assert.ok(q.feePaise > 0, "the school's own cost is still quoted, for the report");
  }
}

/* ── payer-bears: the school nets the whole fee after the real cut ────── */
{
  const policy: GatewayFeePolicy = { ...defaultGatewayFeePolicy(), bearer: "payer" };

  for (const group of ["credit_card", "emi", "debit_card", "netbanking", "wallet"] as const) {
    for (const netPaise of [100, 5000, 250000, 3_750_000]) {
      const q = quoteGatewayFee({ netPaise, group, policy });
      const cost = gatewayFeeOn(q.chargeablePaise, policy.rates[group], policy.gstPercent);
      const left = q.chargeablePaise - cost.totalPaise;
      // THE property this file exists for. Rounding the surcharge up to the
      // rupee means the school may be left with a few paise more; it must
      // never be left with less, on any rail, at any amount.
      assert.ok(
        left >= netPaise,
        `${group} @ ${netPaise}: school left with ${left}, needs ${netPaise}`,
      );
      assert.ok(
        left - netPaise < 100,
        `${group} @ ${netPaise}: over-recovered by ${left - netPaise}, more than the rupee rounding`,
      );
      assert.equal(
        q.chargeablePaise,
        netPaise + q.surchargePaise,
        "chargeable is the fee plus the surcharge and nothing else",
      );
      assert.equal(q.surchargePaise % 100, 0, "a parent is shown whole rupees");
    }
  }
}

/* ── a zero-rate rail is free, and says so ───────────────────────────── */
{
  const policy: GatewayFeePolicy = { ...defaultGatewayFeePolicy(), bearer: "payer" };
  const q = quoteGatewayFee({ netPaise: 250000, group: "upi", policy });
  assert.equal(q.surchargePaise, 0, "UPI at 0% must never carry a charge");
  assert.equal(q.chargeablePaise, 250000);
  assert.match(surchargeDisclosure(q), /No payment charge/);

  const card = quoteGatewayFee({ netPaise: 250000, group: "credit_card", policy });
  assert.ok(card.surchargePaise > 0);
  // The parent must be told the charge and the total before paying, in rupees.
  const line = surchargeDisclosure(card);
  assert.match(line, /payment charge/);
  assert.match(line, /₹/);
  assert.ok(
    line.includes((card.chargeablePaise / 100).toFixed(2).replace(/\.00$/, "")),
    `the disclosure names the real total: ${line}`,
  );
}

/* ── per-method: pass on cards, absorb UPI ───────────────────────────── */
{
  const policy: GatewayFeePolicy = {
    ...defaultGatewayFeePolicy(),
    bearer: "school",
    perMethod: { credit_card: "payer", emi: "payer" },
  };
  assert.equal(bearerFor(policy, "credit_card"), "payer");
  assert.equal(bearerFor(policy, "upi"), "school", "unnamed rails fall back to the policy");
  assert.equal(policyChargesParents(policy), true, "one payer rail is enough to be disclosed");

  assert.equal(quoteGatewayFee({ netPaise: 250000, group: "upi", policy }).surchargePaise, 0);
  assert.ok(quoteGatewayFee({ netPaise: 250000, group: "credit_card", policy }).surchargePaise > 0);
}

/* ── the pay page's table, and the link's fallback ────────────────────── */
{
  const policy: GatewayFeePolicy = { ...defaultGatewayFeePolicy(), bearer: "payer" };
  const all = quoteAllGatewayFees({ netPaise: 250000, policy });
  assert.equal(all.length, 8, "every rail is priced for the picker");
  const upi = all.find((q) => q.group === "upi");
  assert.ok(upi && upi.surchargePaise === 0);

  const narrowed = quoteAllGatewayFees({
    netPaise: 250000,
    policy,
    available: ["upi", "credit_card"],
  });
  assert.deepEqual(
    narrowed.map((q) => q.group),
    ["upi", "credit_card"],
    "the picker only offers what the account has enabled",
  );

  // A WhatsApp pay-link has no picker, so it quotes the fallback rail. The
  // default fallback is UPI, which charges nothing — a link can never
  // surprise a parent with a card-rate surcharge they did not choose.
  assert.equal(fallbackGatewayQuote({ netPaise: 250000, policy }).surchargePaise, 0);
}

/* ── an absurd configured rate refuses to charge rather than diverge ──── */
{
  const policy: GatewayFeePolicy = {
    ...defaultGatewayFeePolicy(),
    bearer: "payer",
    rates: { ...defaultGatewayFeePolicy().rates, credit_card: { percent: 200, flatPaise: 0 } },
  };
  const q = quoteGatewayFee({ netPaise: 250000, group: "credit_card", policy });
  assert.equal(q.surchargePaise, 0, "a rate that cannot be grossed up charges nothing");
  assert.equal(q.bearer, "school", "and says the school bore it, which is what happened");
  assert.equal(q.chargeablePaise, 250000);
}

/* ── quoted against actual ────────────────────────────────────────────── */
{
  // Recovered less than the gateway took: the configured rate is too low and
  // this is the direction that bleeds money unnoticed.
  const short = reconcileQuoteAgainstActual({ surchargePaise: 500, actualFeePaise: 620 });
  assert.equal(short.shortfallPaise, 120);
  assert.equal(short.overRecoveredPaise, 0);

  const over = reconcileQuoteAgainstActual({ surchargePaise: 700, actualFeePaise: 620 });
  assert.equal(over.shortfallPaise, 0);
  assert.equal(over.overRecoveredPaise, 80);

  const level = reconcileQuoteAgainstActual({ surchargePaise: 620, actualFeePaise: 620 });
  assert.equal(level.shortfallPaise, 0);
  assert.equal(level.overRecoveredPaise, 0);
}

/* ── a stored policy is read back, and bad input fails towards the school ── */
{
  // The column's default. Not "unconfigured, guess" — it is today's behaviour.
  for (const empty of [{}, null, undefined, [], "", 7, "payer"]) {
    const p = parseGatewayFeePolicy(empty);
    assert.equal(p.bearer, "school", `${JSON.stringify(empty)} must read as school-bears`);
    assert.equal(policyChargesParents(p), false);
    assert.equal(p.ratesAreDefaults, true);
  }

  const stored = parseGatewayFeePolicy({
    bearer: "school",
    perMethod: { credit_card: "payer", emi: "payer", upi: "school", nonsense_rail: "payer" },
    rates: {
      credit_card: { percent: 1.75, flatPaise: 0 },
      netbanking: { percent: 0, flatPaise: 1200 },
      not_a_rail: { percent: 9, flatPaise: 0 },
    },
    gstPercent: 18,
    fallbackGroup: "upi",
  });
  assert.equal(bearerFor(stored, "credit_card"), "payer");
  assert.equal(bearerFor(stored, "upi"), "school");
  assert.equal(stored.rates.credit_card.percent, 1.75, "a configured rate is honoured");
  assert.equal(stored.rates.netbanking.flatPaise, 1200);
  assert.equal(stored.rates.upi.percent, 0, "a rail the school did not price keeps its default");
  assert.equal(stored.ratesAreDefaults, false, "the office is told these are its own rates");
  assert.equal(
    (stored.perMethod as Record<string, unknown>).nonsense_rail,
    undefined,
    "a rail nobody recognises is dropped, not carried",
  );

  // EVERY unreadable field degrades towards the school paying. A bad rate must
  // never become a charge on a parent's card.
  const junk = parseGatewayFeePolicy({
    bearer: "payer",
    perMethod: { credit_card: "PAYER", emi: true, wallet: "payer" },
    rates: {
      credit_card: { percent: -5, flatPaise: "abc" },
      emi: { percent: 999, flatPaise: 0 },
      wallet: { percent: Number.NaN, flatPaise: Number.POSITIVE_INFINITY },
      upi: "not an object",
    },
    gstPercent: 900,
    fallbackGroup: "teleport",
  });
  assert.equal(
    bearerFor(junk, "credit_card"),
    "school",
    'only the exact string "payer" passes on the cost — "PAYER" is a typo, not consent',
  );
  assert.equal(bearerFor(junk, "emi"), "school", "a non-string bearer is the school's");
  assert.equal(bearerFor(junk, "wallet"), "payer", "a well-formed rail still works");
  const defaults = defaultGatewayFeePolicy();
  // A rail the school PRICED unusably goes to zero, not to the shipped
  // default: keeping 1.9% would charge a parent a rate nobody set, off a typo.
  assert.deepEqual(
    junk.rates.credit_card,
    { percent: 0, flatPaise: 0 },
    "an unusable rate charges nothing rather than guessing",
  );
  assert.deepEqual(
    junk.rates.emi,
    { percent: 0, flatPaise: 0 },
    "a rate above the ceiling is refused, and does not fall back to 2.5%",
  );
  assert.deepEqual(junk.rates.wallet, { percent: 0, flatPaise: 0 }, "NaN and Infinity are refused");
  assert.deepEqual(junk.rates.upi, { percent: 0, flatPaise: 0 }, "so is a rate that is not an object");
  // A rail left OUT of `rates` was never priced, so it keeps its estimate —
  // that is a different thing from being priced badly.
  assert.deepEqual(junk.rates.debit_card, defaults.rates.debit_card, "an unpriced rail keeps its default");
  assert.equal(junk.gstPercent, defaults.gstPercent, "an absurd GST falls back to 18");
  assert.equal(junk.fallbackGroup, "upi", "an unknown fallback rail becomes the free one");

  // The one charge that does survive must still net the school whole.
  const q = quoteGatewayFee({ netPaise: 250000, group: "wallet", policy: junk });
  const cost = gatewayFeeOn(q.chargeablePaise, junk.rates.wallet, junk.gstPercent);
  assert.ok(q.chargeablePaise - cost.totalPaise >= 250000);
}

/* ── Cashfree's payment_group strings map onto our rails ──────────────── */
{
  // These are the groups the live account returns from the eligible-methods
  // call, spelled exactly as it spells them.
  assert.equal(gatewayGroupFromCashfree("UPI"), "upi");
  assert.equal(gatewayGroupFromCashfree("NET_BANKING"), "netbanking");
  assert.equal(gatewayGroupFromCashfree("CREDIT_CARD"), "credit_card");
  assert.equal(gatewayGroupFromCashfree("DEBIT_CARD"), "debit_card");
  assert.equal(gatewayGroupFromCashfree("PREPAID_CARD"), "prepaid_card");
  assert.equal(gatewayGroupFromCashfree("Wallet"), "wallet");
  assert.equal(gatewayGroupFromCashfree("PAY_LATER"), "pay_later");
  assert.equal(gatewayGroupFromCashfree("CARDLESS_EMI"), "emi");
  assert.equal(gatewayGroupFromCashfree("CREDIT_CARD_EMI"), "emi");
  assert.equal(gatewayGroupFromCashfree("DEBIT_CARD_EMI"), "emi");
  // RuPay credit card over UPI is a credit card as far as pricing goes, and
  // billing it at the UPI rate would under-recover on every one.
  assert.equal(gatewayGroupFromCashfree("UPI_CREDIT_CARD"), "credit_card");
  assert.equal(gatewayGroupFromCashfree("UPI_CREDIT_LINE"), "pay_later");
  assert.equal(gatewayGroupFromCashfree("UPI_PPI"), "wallet");
  assert.equal(gatewayGroupFromCashfree("BANK_TRANSFER"), "netbanking");
  assert.equal(gatewayGroupFromCashfree("something_new"), null, "an unknown rail is not guessed");
  assert.equal(gatewayGroupFromCashfree(""), null);
}

console.log("  ok");
