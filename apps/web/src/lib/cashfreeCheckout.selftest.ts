/**
 * Self-test: the pure half of Cashfree Orders checkout.
 * Run: npx tsx apps/web/src/lib/cashfreeCheckout.selftest.ts
 */
import assert from "node:assert/strict";
import {
  buildCashfreeOrderBody,
  cashfreeContact,
  cashfreeCustomerId,
  cashfreePayPageUrl,
  isCashfreeOrderId,
  readCashfreeOrderEvent,
} from "@/lib/cashfreeCheckout";

const now = new Date("2026-09-05T10:00:00.000Z");
const base = {
  orderId: "tutp_abc123",
  amountPaise: 4900,
  customerId: "hh_0pfgpfql",
  customerName: "Ramesh Singh",
  customerMobile: "+91 94519 38805",
  note: "AI tutor pass · 1 day",
  returnUrl: "https://bhbinternational.school/pay/cf/tutp_abc123",
  notifyUrl: "https://bhbinternational.school/api/payments/cashfree/webhook",
  tags: { kind: "tutor_pass", orderId: "tutp_abc123", empty: "" },
};

{
  const r = buildCashfreeOrderBody(base, now);
  assert.ok(r.ok);
  assert.equal(r.body.order_amount, 49);
  assert.equal(r.body.customer_details.customer_phone, "9451938805", "country code stripped");
  assert.deepEqual(r.body.order_tags, { kind: "tutor_pass", orderId: "tutp_abc123" }, "empty tags dropped");
  assert.equal(r.body.order_expiry_time, undefined);
}
{
  assert.equal(buildCashfreeOrderBody({ ...base, customerMobile: "12345" }, now).ok, false, "no phone → no order, never invented");
  assert.equal(buildCashfreeOrderBody({ ...base, amountPaise: 50 }, now).ok, false, "under ₹1 refused");
  assert.equal(buildCashfreeOrderBody({ ...base, returnUrl: "http://localhost:3000/x" }, now).ok, false, "http return url refused up front");
  assert.equal(buildCashfreeOrderBody({ ...base, orderId: "bad id!" }, now).ok, false);
  assert.equal(buildCashfreeOrderBody({ ...base, amountPaise: 123456 }, now).ok && (buildCashfreeOrderBody({ ...base, amountPaise: 123456 }, now) as { body: { order_amount: number } }).body.order_amount, 1234.56);
}
{
  // expiry: clamped into Cashfree's 15 min – 30 day window
  const soon = buildCashfreeOrderBody({ ...base, expiresAt: "2026-09-05T10:05:00.000Z" }, now);
  assert.ok(soon.ok && soon.body.order_expiry_time === "2026-09-05T10:16:00.000Z", "too-soon expiry is pushed to 16 min");
  const far = buildCashfreeOrderBody({ ...base, expiresAt: "2027-01-01T00:00:00.000Z" }, now);
  assert.ok(far.ok && far.body.order_expiry_time === "2026-10-05T10:00:00.000Z", "beyond 30 days is capped");
  const fine = buildCashfreeOrderBody({ ...base, expiresAt: "2026-09-06T18:29:59.999Z" }, now);
  assert.ok(fine.ok && fine.body.order_expiry_time === "2026-09-06T18:29:59.999Z");
}
{
  assert.ok(isCashfreeOrderId("pl_7K2M-x"));
  assert.ok(isCashfreeOrderId("evtp_" + "a".repeat(36)));
  assert.ok(!isCashfreeOrderId("ab"));
  assert.ok(!isCashfreeOrderId("a".repeat(51)));
  assert.equal(cashfreeContact("09451938805"), "9451938805");
  assert.equal(cashfreeContact(""), null);
  assert.equal(cashfreeCustomerId("hh 0pfg/pfql"), "hh_0pfg_pfql");
  assert.equal(cashfreeCustomerId("x"), "cust_x");
  assert.equal(cashfreePayPageUrl("https://bhbinternational.school/", "pl_1"), "https://bhbinternational.school/pay/cf/pl_1");
}
{
  const ev = readCashfreeOrderEvent({
    type: "PAYMENT_SUCCESS_WEBHOOK",
    data: {
      order: { order_id: "tutp_abc123", order_amount: 49, order_tags: { kind: "tutor_pass", n: 1 } },
      payment: { cf_payment_id: 1453002795, payment_status: "SUCCESS", payment_amount: 49, bank_reference: "234928698581" },
    },
  });
  assert.deepEqual(ev, {
    type: "PAYMENT_SUCCESS_WEBHOOK",
    orderId: "tutp_abc123",
    cfPaymentId: "1453002795",
    paymentStatus: "SUCCESS",
    bankReference: "234928698581",
    amountRupees: 49,
    tags: { kind: "tutor_pass", n: "1" },
  });
  assert.equal(readCashfreeOrderEvent({ type: "PAYMENT_LINK_EVENT", data: { link_id: "x" } }), null, "link events are not order events");
  assert.equal(readCashfreeOrderEvent({}), null);
}
console.log("cashfreeCheckout.selftest: ok");
