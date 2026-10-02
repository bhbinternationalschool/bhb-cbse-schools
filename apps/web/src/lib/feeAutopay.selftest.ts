/**
 * Self-test: fee auto-pay rules — the ids that keep a family from being
 * debited twice, what a month's debit covers, and which mandates are debited.
 *
 * Run: npx tsx src/lib/feeAutopay.selftest.ts
 */

import assert from "node:assert/strict";

import {
  AUTOPAY_UPI_CAP_PAISE,
  autopayPlanId,
  chargeIdFor,
  chargeOutcome,
  childNamesLabel,
  clampMaxPaise,
  composeAutopayInviteText,
  cycleKeyFor,
  debitDateFor,
  debitDateLabel,
  debitScheduleIso,
  defaultAutopaySettings,
  isAutopayId,
  isOnOrAfterChargeDay,
  isTerminalMandate,
  istDateIso,
  mandateIdFor,
  mandateIsChargeable,
  mandateIsLive,
  mandateStatusLabel,
  parseAutopaySettings,
  planCharge,
  readAutopayEvent,
  rupeesLabel,
} from "./feeAutopay";

/* ── settings: off until a person turns it on ──────────────────────── */

{
  const d = defaultAutopaySettings();
  assert.equal(d.enabled, false, "nothing is debited until the school decides");
  assert.equal(d.defaultMaxPaise, AUTOPAY_UPI_CAP_PAISE);
  assert.deepEqual(parseAutopaySettings(null), d);
  assert.deepEqual(parseAutopaySettings({ enabled: "yes" }).enabled, false, "only a real true arms it");
  assert.equal(parseAutopaySettings({ enabled: true }).enabled, true);
  assert.equal(parseAutopaySettings({ chargeDay: 31 }).chargeDay, 5, "a day every month has");
  assert.equal(parseAutopaySettings({ chargeDay: 10 }).chargeDay, 10);
  assert.equal(clampMaxPaise(14_999_50), 15_000_00, "whole rupees");
  assert.equal(clampMaxPaise(5), 500_00, "never a ₹0 mandate");
  assert.equal(clampMaxPaise(5_00_00_000_00), 1_00_000_00, "never ₹ lakhs by a typo");
  assert.equal(clampMaxPaise("abc"), AUTOPAY_UPI_CAP_PAISE);
}

/* ── ids Cashfree accepts, and one debit per month ─────────────────── */

{
  const sid = mandateIdFor("hh_8f2a-91c3_ab12cd34ef56gh78", Date.UTC(2026, 9, 2));
  assert.ok(isAutopayId(sid), sid);
  assert.ok(sid.startsWith("ap_"));
  assert.notEqual(sid, mandateIdFor("hh_8f2a-91c3_ab12cd34ef56gh78", Date.UTC(2026, 9, 3)), "a family can set up again");
  assert.ok(isAutopayId(mandateIdFor("", 0)), "never an invalid id");
  const c1 = chargeIdFor(sid, "2026-10");
  assert.equal(c1, chargeIdFor(sid, "2026-10"), "a rerun asks for the same debit — Cashfree refuses the copy");
  assert.notEqual(c1, chargeIdFor(sid, "2026-11"));
  assert.notEqual(c1, chargeIdFor(sid, "2026-10", 2), "an office retry is a new debit");
  assert.ok(isAutopayId(chargeIdFor(sid, "2026-10", 2)));
  assert.equal(autopayPlanId(15_000_00), "bhb_fee_od_15000");
  assert.ok(isAutopayId(autopayPlanId(1_00_000_00)));
  assert.ok(!isAutopayId("has space"));
}

/* ── dates ─────────────────────────────────────────────────────────── */

{
  assert.equal(istDateIso(new Date("2026-10-01T19:00:00Z")), "2026-10-02", "after 18:30 UTC it is tomorrow in India");
  assert.equal(cycleKeyFor("2026-10-05"), "2026-10");
  assert.equal(debitDateFor("2026-10-31"), "2026-11-01");
  assert.equal(debitScheduleIso("2026-10-06"), "2026-10-06T10:00:00+05:30");
  assert.equal(isOnOrAfterChargeDay("2026-10-04", 5), false);
  assert.equal(isOnOrAfterChargeDay("2026-10-05", 5), true);
  assert.equal(isOnOrAfterChargeDay("2026-10-09", 5), true, "a missed run catches up the same month");
  assert.equal(debitDateLabel("2026-10-06"), "Tue, 6 Oct");
}

/* ── what a month's debit covers ───────────────────────────────────── */

{
  const dues = [
    { studentId: "s2", dueKey: "b", dueOn: "2026-10-01", balancePaise: 3_000_00 },
    { studentId: "s1", dueKey: "a", dueOn: "2026-09-01", balancePaise: 2_500_00 },
    { studentId: "s1", dueKey: "c", dueOn: "2026-10-01", balancePaise: 2_500_00 },
    { studentId: "s1", dueKey: "z", dueOn: "2026-08-01", balancePaise: 0 },
  ];
  const all = planCharge(dues, 15_000_00);
  assert.equal(all.totalPaise, 8_000_00);
  assert.deepEqual(all.perStudent, { s1: 5_000_00, s2: 3_000_00 }, "one receipt per child");
  assert.equal(all.leftoverPaise, 0);

  const capped = planCharge(dues, 4_000_00);
  assert.equal(capped.totalPaise, 4_000_00, "never past the family's limit");
  // Oldest first: September (s1 ₹2,500), then October by key — s2's "b" takes the last ₹1,500.
  assert.deepEqual(capped.perStudent, { s1: 2_500_00, s2: 1_500_00 });
  assert.equal(capped.leftoverPaise, 4_000_00, "the rest is left to pay another way");

  assert.equal(planCharge([], 15_000_00).totalPaise, 0);
  assert.equal(planCharge(dues, 0).totalPaise, 0);
}

/* ── which mandates are debited ────────────────────────────────────── */

{
  assert.equal(mandateIsChargeable("ACTIVE"), true);
  for (const s of ["INITIALIZED", "BANK_APPROVAL_PENDING", "ON_HOLD", "PAUSED", "CUSTOMER_PAUSED", "CANCELLED"]) {
    assert.equal(mandateIsChargeable(s), false, s);
  }
  assert.equal(isTerminalMandate("CUSTOMER_CANCELLED"), true);
  assert.equal(mandateIsLive("ON_HOLD"), true, "held is not over");
  assert.equal(mandateIsLive("LINK_EXPIRED"), false, "an expired set-up link can be sent again");
  assert.ok(mandateStatusLabel("BANK_APPROVAL_PENDING").includes("bank"));
  assert.equal(mandateStatusLabel("weird"), "weird");
  assert.equal(chargeOutcome("SUCCESS"), "success");
  assert.equal(chargeOutcome("PENDING"), "pending");
  assert.equal(chargeOutcome("INITIALIZED"), "pending");
  assert.equal(chargeOutcome("FAILED"), "failed");
}

/* ── webhooks: ids only ────────────────────────────────────────────── */

{
  assert.deepEqual(
    readAutopayEvent({
      type: "SUBSCRIPTION_STATUS_CHANGED",
      data: { subscription_details: { subscription_id: "ap_x_1", subscription_status: "ACTIVE" } },
    }),
    { type: "SUBSCRIPTION_STATUS_CHANGED", subscriptionId: "ap_x_1", paymentId: "" },
  );
  assert.deepEqual(
    readAutopayEvent({
      type: "SUBSCRIPTION_PAYMENT_SUCCESS",
      data: { payment_id: "ap_x_1_202610", subscription_id: "ap_x_1", payment_status: "SUCCESS" },
    }),
    { type: "SUBSCRIPTION_PAYMENT_SUCCESS", subscriptionId: "ap_x_1", paymentId: "ap_x_1_202610" },
  );
  assert.equal(readAutopayEvent({ type: "PAYMENT_SUCCESS_WEBHOOK", data: {} }), null, "not ours");
  assert.equal(readAutopayEvent({ type: "SUBSCRIPTION_STATUS_CHANGED", data: {} }), null, "no id, nothing to do");
  assert.equal(readAutopayEvent(null), null);
}

/* ── words ─────────────────────────────────────────────────────────── */

{
  assert.equal(rupeesLabel(15_000_00), "₹15,000");
  assert.equal(childNamesLabel(["Aarav"]), "Aarav");
  assert.equal(childNamesLabel(["Aarav", "Siya", "Kabir"]), "Aarav, Siya and Kabir");
  assert.equal(childNamesLabel([]), "your child");
  const t = composeAutopayInviteText({ guardianName: "Ravi", childNames: "Aarav", maxPaise: 15_000_00, link: "https://x/pay/autopay/ap_1", schoolName: "BHB" });
  assert.ok(t.includes("₹15,000") && t.includes("https://x/pay/autopay/ap_1") && t.includes("stop it any time"));
}

console.log("feeAutopay.selftest.ts\n  ok");
