/**
 * Self-test: a failed settlement is FAILED, and the board does not count it.
 *
 * Run: npx tsx src/lib/ledger/pgSettlementStatus.selftest.ts
 *
 * The fixtures are the three rows ledger_pg_settlements held on 15 Oct 2026
 * (raw payloads as stored, PII-free). Cashfree's first transfer of the 9 Oct
 * ₹2,600 (404691537) failed at the bank and was retried as 405119119; the
 * mapper had stored the failure as PENDING and the board showed Gross
 * collected ₹7,700 for what was ₹5,100.
 */
import assert from "node:assert/strict";
import { settlementFromList, settlementFromWebhook } from "@/lib/cashfreeSettlements.server";
import {
  deriveSettlementStatus,
  failedLabel,
  failedReconState,
  findRetry,
  mergeStoredStatus,
  rawSaysSettlementFailed,
  settlementPaymentWindow,
  summariseSettlements,
  type BoardSettlement,
} from "./pgSettlementStatus";

const listRow = (sd: Record<string, unknown>, paymentStatus: string, amount: number) => ({
  event_details: { event_type: "SETTLEMENT" },
  order_details: {},
  refund_details: {},
  dispute_details: {},
  customer_details: { customer_id: null, customer_name: null },
  payment_details: { status: paymentStatus, payment_amount: amount, charges_currency: "INR" },
  settlement_details: sd,
});

const failedRaw = listRow(
  {
    utr: null,
    reason: "FAILED",
    remarks: "Settlement Failed",
    adjustment: 0,
    service_tax: 9.13,
    payment_from: "2026-10-09T10:23:01+05:30",
    payment_till: "2026-10-09T10:23:01+05:30",
    amount_settled: 2540.17,
    service_charge: 50.7,
    settlement_date: "2026-10-13T17:35:01+05:30",
    settlement_type: "NORMAL_SETTLEMENT",
    cf_settlement_id: "404691537",
    settlement_initiated_on: null,
  },
  "FAILED",
  2600,
);

const retryRaw = listRow(
  {
    utr: "AXISCN1498598504",
    reason: null,
    remarks: null,
    adjustment: 0,
    service_tax: 9.13,
    payment_from: "2026-10-09T10:23:01+05:30",
    payment_till: "2026-10-09T10:23:01+05:30",
    amount_settled: 2540.17,
    service_charge: 50.7,
    settlement_date: "2026-10-14T09:19:47+05:30",
    settlement_type: "NORMAL_SETTLEMENT",
    cf_settlement_id: "405119119",
    settlement_initiated_on: "2026-10-14T08:43:47+05:30",
  },
  "PAID",
  2600,
);

const septRaw = listRow(
  {
    utr: "HDFCH01289751481",
    reason: null,
    remarks: null,
    adjustment: 0,
    service_tax: 8.77,
    payment_from: "2026-09-26T09:32:25+05:30",
    payment_till: "2026-09-26T09:32:25+05:30",
    amount_settled: 2442.48,
    service_charge: 48.75,
    settlement_date: "2026-09-29T20:51:59+05:30",
    settlement_type: "NORMAL_SETTLEMENT",
    cf_settlement_id: "395231809",
    settlement_initiated_on: "2026-09-29T18:03:43+05:30",
  },
  "PAID",
  2500,
);

/* ─── 1. Mapping ─────────────────────────────────────────────── */

const failed = settlementFromList(failedRaw)!;
assert.equal(failed.cfSettlementId, "404691537");
assert.equal(failed.status, "FAILED", "reason/remarks/payment status FAILED → FAILED, not PENDING");
const retry = settlementFromList(retryRaw)!;
assert.equal(retry.status, "SUCCESS");
assert.equal(settlementFromList(septRaw)!.status, "SUCCESS");

// Each signal on its own is enough.
assert.equal(rawSaysSettlementFailed({ settlement_details: { reason: "FAILED" } }), true);
assert.equal(rawSaysSettlementFailed({ settlement_details: { remarks: "Settlement Failed" } }), true);
assert.equal(rawSaysSettlementFailed({ payment_details: { status: "FAILED" } }), true);
assert.equal(rawSaysSettlementFailed({ status: "FAILED" }), true);
assert.equal(rawSaysSettlementFailed(retryRaw), false, "a paid row is not failed");
assert.equal(rawSaysSettlementFailed({}), false);

// Unknown stays PENDING: no UTR is "not yet", never "failed".
assert.equal(deriveSettlementStatus({ utr: "", hasSettledDate: true, raw: {} }), "PENDING");
assert.equal(deriveSettlementStatus({ explicit: "INITIATED", raw: {} }), "INITIATED");
assert.equal(deriveSettlementStatus({ eventType: "SETTLEMENT_FAILED", raw: {} }), "FAILED");

// The webhook as it arrived at 02:45 IST on 14 Oct (reason is free text).
const hook = settlementFromWebhook(
  {
    settlement: {
      utr: null,
      reason: "Due to some technical issues at the bank, your amount will be settled in the next settlement cycle.",
      status: "FAILED",
      remarks: "Settlement Failed",
      settled_on: "2026-10-13T17:35:01+05:30",
      payment_from: "2026-10-09T10:23:01+05:30",
      payment_till: "2026-10-09T10:23:01+05:30",
      settlement_id: 404691537,
      amount_settled: 2540.17,
      payment_amount: 2600,
    },
  },
  "SETTLEMENT_FAILED",
)!;
assert.equal(hook.status, "FAILED");
// INITIATED webhooks are not promoted to paid by the date they carry.
assert.equal(
  settlementFromWebhook({ settlement: { settlement_id: 1, utr: "U", settled_on: "2026-10-14T08:41:36+05:30" } })!.status,
  "PENDING",
);

// A FAILED already stored is not undone by a row that merely lacks signals,
// but a real verdict from the gateway still replaces it.
assert.equal(mergeStoredStatus("FAILED", "PENDING"), "FAILED");
assert.equal(mergeStoredStatus("FAILED", "SUCCESS"), "SUCCESS");
assert.equal(mergeStoredStatus("PENDING", "FAILED"), "FAILED", "the existing 404691537 row self-corrects on the next pull");
assert.equal(mergeStoredStatus("", "PENDING"), "PENDING");

// The row stored as PENDING before this fix reads as FAILED from its raw.
assert.equal(deriveSettlementStatus({ explicit: "PENDING", raw: failedRaw }), "FAILED");

/* ─── 2. The board ───────────────────────────────────────────── */

function board(id: string, raw: unknown, over: Partial<BoardSettlement>): BoardSettlement {
  const w = settlementPaymentWindow(raw);
  return {
    cfSettlementId: id,
    utr: "",
    status: "SUCCESS",
    paymentAmountPaise: 0,
    feePaise: 0,
    amountSettledPaise: 0,
    voucherNo: "",
    reconState: "explained",
    paymentFrom: w.from,
    paymentTill: w.till,
    ...over,
  };
}

const rows: BoardSettlement[] = [
  board("405119119", retryRaw, {
    utr: "AXISCN1498598504",
    paymentAmountPaise: 260000,
    feePaise: 5983,
    amountSettledPaise: 254017,
    voucherNo: "JV/FY2026-27/00122",
  }),
  board("404691537", failedRaw, {
    status: "FAILED",
    paymentAmountPaise: 260000,
    feePaise: 5983,
    amountSettledPaise: 254017,
    reconState: failedReconState(""),
  }),
  board("395231809", septRaw, {
    utr: "HDFCH01289751481",
    paymentAmountPaise: 250000,
    feePaise: 5752,
    amountSettledPaise: 244248,
    voucherNo: "JV/x",
  }),
];

const t = summariseSettlements(rows);
assert.equal(t.gross, 510000, "Gross collected ₹5,100, not ₹7,700");
assert.equal(t.fee, 5983 + 5752);
assert.equal(t.net, 254017 + 244248, "Reached the bank counts the retry once");
assert.equal(t.counted, 2);
assert.equal(t.failed, 1);

const retriedAs = findRetry(rows[1], rows);
assert.deepEqual(retriedAs, { cfSettlementId: "405119119", utr: "AXISCN1498598504" });
assert.equal(failedLabel(retriedAs), "Failed — retried as 405119119 / AXISCN1498598504");
assert.equal(failedLabel(null), "Failed — Cashfree will retry");

// No paid settlement covering the window → no invented match.
assert.equal(findRetry(rows[1], [rows[2]]), null, "a different window is not the retry");
assert.equal(findRetry({ ...rows[1], paymentFrom: "", paymentTill: "" }, rows), null);
// A failed candidate is never the retry.
assert.equal(findRetry(rows[1], [{ ...rows[0], status: "FAILED" }]), null);

// A failed settlement with a voucher is a break, and still not summed.
assert.equal(failedReconState("JV/1"), "failed_posted");
const withBreak = summariseSettlements([
  ...rows.slice(0, 1),
  { ...rows[1], voucherNo: "JV/1", reconState: failedReconState("JV/1") },
]);
assert.equal(withBreak.gross, 260000);
assert.equal(withBreak.failed, 1);

console.log("pg settlement failed-retry: all assertions passed");
