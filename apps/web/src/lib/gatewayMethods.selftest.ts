/**
 * Self-test: reading Cashfree's eligible-payment-methods reply, and the
 * filter names we send back when restricting an order to one rail.
 * Run: npx tsx apps/web/src/lib/gatewayMethods.selftest.ts
 *
 * WHY THIS IS SHAPE-TOLERANT ON PURPOSE. The eligibility response has moved
 * between API versions — a bare array in one, `items` in another,
 * `payment_methods` in the docs — and the per-rail detail is sometimes on the
 * row and sometimes nested under entity_details.payment_method_details. This
 * could not be verified against the live endpoint from the build container
 * (no Cashfree keys there), so the reader accepts every documented shape and
 * returns null on anything it does not recognise. Null means "offer the
 * standard rails and let Cashfree's own checkout decide", which is the only
 * safe failure: a parent who cannot see the EMI button can still pay a fee,
 * and a parent shown an error cannot.
 */
import assert from "node:assert/strict";

import { cashfreeFiltersFor, readEligibleGroups } from "@/lib/gatewayMethods";
import { GATEWAY_METHOD_GROUPS, type GatewayMethodGroup } from "@/lib/gatewayFees";

console.log("gatewayMethods.selftest.ts");

/* ── the nested shape, with the groups the live account really returns ──── */
{
  // Groups copied from this school's own account on 28 Sep 2026.
  const payload = {
    items: [
      {
        entity: "payment_methods",
        eligibility: true,
        entity_details: {
          payment_method_details: [
            { nick: "upi", display: "UPI", isActive: true, payment_group: "UPI" },
            { nick: "visa", display: "VISA - Credit Card", isActive: true, payment_group: "CREDIT_CARD" },
            { nick: "rupay", display: "Rupay - Debit Card", isActive: true, payment_group: "DEBIT_CARD" },
            { nick: "yes", display: "Yes Bank Ltd", isActive: true, payment_group: "NET_BANKING" },
            { nick: "phonepe", display: "PhonePe", isActive: true, payment_group: "Wallet" },
            { nick: "icici", display: "ICICI Credit Card - EMI", isActive: true, payment_group: "CREDIT_CARD_EMI" },
            { nick: "ausmallccemi", display: "AuSmall Credit Card Emi", isActive: true, payment_group: "CARDLESS_EMI" },
            { nick: "creditlineupi", display: "UPI Credit Line", isActive: true, payment_group: "UPI_CREDIT_LINE" },
            { nick: "banktrans", display: "CashFree Bank Transfer", isActive: true, payment_group: "BANK_TRANSFER" },
          ],
        },
      },
    ],
  };

  const groups = readEligibleGroups(payload);
  assert.ok(groups, "the live account's own shape must be readable");
  const set = new Set(groups);
  assert.ok(set.has("upi"));
  assert.ok(set.has("credit_card"));
  assert.ok(set.has("debit_card"));
  assert.ok(set.has("netbanking"), "net banking, and bank transfer folded into it");
  assert.ok(set.has("wallet"));
  assert.ok(set.has("emi"), "both EMI families collapse to one rail the parent recognises");
  assert.ok(set.has("pay_later"), "UPI Credit Line is a pay-later, not a UPI, for pricing");
  // Nothing invented: the account has no PayPal, so the picker must not offer one.
  for (const g of groups!) assert.ok(GATEWAY_METHOD_GROUPS.includes(g), `${g} is a rail we know`);
}

/* ── ineligible and inactive rails are dropped, not offered ────────────── */
{
  const groups = readEligibleGroups([
    { payment_method: "upi", eligibility: true },
    // The dead end this call exists to prevent: EMI on an amount no bank will
    // finance. Cashfree says no, so the button must not appear.
    { payment_method: "credit_card_emi", eligibility: false },
    { payment_method: "paylater", eligibility: false },
    {
      payment_method: "netbanking",
      entity_details: {
        payment_method_details: [
          { nick: "yes", payment_group: "NET_BANKING", isActive: false },
        ],
      },
    },
  ]);
  assert.deepEqual(groups, ["upi", "netbanking"], "netbanking survives on the row, its dead bank does not");

  const absent = readEligibleGroups([{ payment_method: "upi" }]);
  assert.deepEqual(absent, ["upi"], "no eligibility field means eligible — only an explicit false excludes");
}

/* ── every envelope the docs describe ─────────────────────────────────── */
{
  const rows = [{ payment_method: "upi", eligibility: true }];
  assert.deepEqual(readEligibleGroups(rows), ["upi"], "bare array");
  assert.deepEqual(readEligibleGroups({ items: rows }), ["upi"], "items");
  assert.deepEqual(readEligibleGroups({ payment_methods: rows }), ["upi"], "payment_methods");
}

/* ── anything unrecognised is null, never an empty offering ───────────── */
{
  // Each of these must read as "could not tell", so the caller offers the
  // standard rails. Returning [] would read as "this school accepts no
  // payments" and would stop a parent paying a fee.
  for (const junk of [
    null,
    undefined,
    "",
    7,
    {},
    { error: "unauthorised" },
    { items: [] },
    { items: [{ payment_method: "something_new", eligibility: true }] },
    [{ nonsense: true }],
    [null, 3, "upi"],
  ]) {
    assert.equal(
      readEligibleGroups(junk),
      null,
      `${JSON.stringify(junk)} must be null, so the caller falls back rather than offering nothing`,
    );
  }
}

/* ── the filter names sent back to Cashfree ──────────────────────────── */
{
  // Not a lowercase of our own names: `emi` is three of Cashfree's filters and
  // `credit_card` is three more. Getting this wrong restricts an order to a
  // rail that does not exist and the parent reaches a checkout with nothing on it.
  assert.deepEqual(cashfreeFiltersFor(["upi"]), ["upi"]);
  assert.deepEqual(cashfreeFiltersFor(["netbanking"]), ["netbanking", "banktransfer"]);
  assert.deepEqual(cashfreeFiltersFor(["emi"]), ["cardless_emi", "credit_card_emi", "debit_card_emi"]);
  assert.deepEqual(cashfreeFiltersFor(["credit_card"]), [
    "credit_card",
    "corporate_credit_card",
    "upi_credit_card",
  ]);
  assert.deepEqual(cashfreeFiltersFor(["pay_later"]), ["paylater"], "Cashfree spells it without the underscore");
  assert.deepEqual(cashfreeFiltersFor(["wallet"]), ["wallet", "upi_ppi"]);

  // De-duplicated across rails, and every rail we know produces at least one
  // filter — a group with none would silently restrict an order to nothing.
  const all = cashfreeFiltersFor(GATEWAY_METHOD_GROUPS);
  assert.equal(new Set(all).size, all.length, "no duplicate filters");
  for (const g of GATEWAY_METHOD_GROUPS) {
    assert.ok(cashfreeFiltersFor([g]).length > 0, `${g} must map to at least one Cashfree filter`);
  }
  assert.deepEqual(cashfreeFiltersFor([]), [], "no choice means no restriction");
  assert.deepEqual(cashfreeFiltersFor(["nope" as GatewayMethodGroup]), [], "an unknown rail adds nothing");
}

console.log("  ok");
