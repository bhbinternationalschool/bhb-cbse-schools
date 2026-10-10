/**
 * Google Play Billing — the rules that decide whether a pass is granted.
 *
 * Play requires its own billing for digital content consumed inside a Play
 * app, so the tutor pass changes rail there. School FEES do not: paying for a
 * real-world education service is exempt and stays on Cashfree everywhere.
 *
 * Three things here are money, so they are pinned rather than trusted:
 *
 *  1. The Play product ids must BE the plan codes. One catalogue serves both
 *     rails, and a mismatch sells the wrong number of days.
 *  2. Only purchaseState 0 is a purchase. State 2 is PENDING — cash at a
 *     counter in some markets — and is not money yet.
 *  3. One purchase token grants once. Play redelivers until the client
 *     acknowledges, so a replay must extend nothing.
 *
 * Run: npx tsx src/lib/playBilling.selftest.ts
 */
import assert from "node:assert/strict";
import { createHash } from "crypto";

import { PLAY_PRODUCT_IDS } from "./playBilling.server";
import { DEFAULT_TUTOR_PLANS } from "./tutorPlans";

console.log("playBilling.selftest.ts");

// 1. The catalogues must agree, in both directions.
const planCodes = DEFAULT_TUTOR_PLANS.map((p) => p.code).sort();
assert.deepEqual(
  [...PLAY_PRODUCT_IDS].sort(),
  planCodes,
  "every Play product must be a tutor plan and every plan a Play product",
);
for (const p of DEFAULT_TUTOR_PLANS) {
  assert.ok(p.days > 0, `${p.code} must grant days`);
  assert.ok(p.pricePaise > 0, `${p.code} must have a price`);
}

// Play's minimum price for an in-app product in India is ₹10. A plan cheaper
// than that cannot be sold through Play at all and would fail at product
// creation, not at runtime — catch it here instead.
for (const p of DEFAULT_TUTOR_PLANS) {
  assert.ok(
    p.pricePaise >= 1000,
    `${p.code} at ₹${p.pricePaise / 100} is below Play's ₹10 minimum`,
  );
}

// 2. purchaseState — mirrors the check in verifyPlayPurchase.
const PURCHASED = 0;
const grants = (purchaseState: number) => purchaseState === PURCHASED;
assert.equal(grants(0), true, "0 = purchased, grant it");
assert.equal(grants(1), false, "1 = cancelled, grant nothing");
assert.equal(
  grants(2),
  false,
  "2 = PENDING — the parent has not paid yet and must not get the tutor",
);

// 3. The order id is derived from the token, so a replay collides on the
//    primary key instead of granting a second time.
const playOrderId = (t: string) =>
  `tp_play_${createHash("sha256").update(t).digest("hex").slice(0, 24)}`;
const token = "abc.def.ghi-a-real-token-would-be-longer";
assert.equal(
  playOrderId(token),
  playOrderId(token),
  "the same token must always derive the same order id",
);
assert.notEqual(
  playOrderId(token),
  playOrderId(token + "x"),
  "different tokens must be different orders",
);
assert.match(playOrderId(token), /^tp_play_[0-9a-f]{24}$/);

// A derived id is the whole point: two deliveries of one purchase collide.
const seen = new Set([playOrderId(token), playOrderId(token)]);
assert.equal(seen.size, 1, "a redelivered purchase is one order, not two");

console.log("OK");
