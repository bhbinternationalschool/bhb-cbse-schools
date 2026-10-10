/**
 * Run: npx tsx src/lib/cashfreeSettlements.selftest.ts
 */
import assert from "node:assert/strict";
import { settlementFromList } from "@/lib/cashfreeSettlements.server";

// The exact shape POST /pg/settlements returned on 8 Oct 2026 (x-api-version
// 2025-01-01): everything nested, nothing at the top level, no status.
const nested = {
  customer_details: { customer_bank_account_number: null, customer_phone: null },
  dispute_details: {},
  event_details: { event_type: "SETTLEMENT" },
  order_details: {},
  payment_details: { charges_currency: "INR", payment_amount: 2500.0, status: "PAID" },
  refund_details: {},
  settlement_details: {
    adjustment: 0.0,
    amount_settled: 2442.48,
    cf_settlement_id: "395231809",
    payment_from: "2026-09-26T09:32:25+05:30",
    payment_till: "2026-09-26T09:32:25+05:30",
    service_charge: 48.75,
    service_tax: 8.77,
    settlement_date: "2026-09-29T20:51:59+05:30",
    settlement_initiated_on: "2026-09-29T18:03:43+05:30",
    settlement_type: "NORMAL_SETTLEMENT",
    utr: "HDFCH01289751481",
  },
};
const s = settlementFromList(nested);
assert.ok(s, "a nested row is read, not dropped (it was, every day, until 8 Oct)");
assert.equal(s!.cfSettlementId, "395231809");
assert.equal(s!.utr, "HDFCH01289751481");
assert.equal(s!.status, "SUCCESS", "UTR + settlement date = a completed bank transfer");
assert.equal(s!.paymentAmountPaise, 250000);
assert.equal(s!.amountSettledPaise, 244248);
assert.equal(s!.serviceChargePaise, 4875);
assert.equal(s!.serviceTaxPaise, 877);
assert.equal(s!.paymentAmountPaise - s!.serviceChargePaise - s!.serviceTaxPaise, s!.amountSettledPaise, "gross − fee − GST = net");
assert.equal(s!.settledOn, "2026-09-29");
assert.equal(s!.settlementType, "NORMAL_SETTLEMENT");
assert.equal(s!.bankAccountLast4, "", "no account number in the row → the configured settlement bank is used");

// Settled just after midnight IST: filed on the IST date, not the UTC one.
const late = settlementFromList({ settlement_details: { ...nested.settlement_details, settlement_date: "2026-10-01T00:30:00+05:30" } });
assert.equal(late!.settledOn, "2026-10-01");

// No UTR yet: pending, never assumed paid.
const pending = settlementFromList({ settlement_details: { ...nested.settlement_details, utr: "" } });
assert.equal(pending!.status, "PENDING");

// The old flat shape still reads.
const flat = settlementFromList({ cf_settlement_id: 77, utr: "U1", status: "SUCCESS", amount_settled: 100, payment_amount: 102, settlement_time: "2026-08-30T10:00:00+05:30" });
assert.equal(flat!.cfSettlementId, "77");
assert.equal(flat!.status, "SUCCESS");
assert.equal(flat!.amountSettledPaise, 10000);

assert.equal(settlementFromList({ settlement_details: {} }), null, "no settlement id → no row");
console.log("cashfreeSettlements selftest: ok");
