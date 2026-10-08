/**
 * Run: npx tsx src/lib/payrollPaidOn.selftest.ts
 *
 * Director, 7 Oct 2026: "Mark paid" takes the date the salary was actually
 * paid, and the books date the payment on it.
 */
import assert from "node:assert/strict";
import { payrollPaidOnError, payrollRunPaymentDate, todayIstDate } from "./payroll";

console.log("payrollPaidOn.selftest.ts");

assert.equal(payrollPaidOnError("2026-09", "2026-10-07", "2026-10-07"), null);
assert.equal(payrollPaidOnError("2026-08", "2026-09-05", "2026-10-07"), null, "August salary paid in September");
assert.match(payrollPaidOnError("2026-09", "2026-10-08", "2026-10-07")!, /future/);
assert.match(payrollPaidOnError("2026-09", "2026-08-31", "2026-10-07")!, /before 2026-09-01/);
assert.match(payrollPaidOnError("2026-09", "", "2026-10-07")!, /Enter the date/);

const line = (paymentDate: string) => ({ paymentDate }) as never;
assert.equal(payrollRunPaymentDate({ lines: [line("2026-10-07"), line("2026-10-07")] }), "2026-10-07");
assert.equal(payrollRunPaymentDate({ lines: [line("2026-10-07"), line("2026-10-05")] }), "", "lines disagree → the office picks");
assert.equal(payrollRunPaymentDate({ lines: [line("")] }), "");

// 01:00 IST on 7 Oct is 6 Oct in UTC — the school's day wins.
assert.equal(todayIstDate(new Date("2026-10-06T19:30:00Z")), "2026-10-07");
// The stored instant reads back as the chosen day in India.
const at = new Date("2026-09-05T12:00:00+05:30");
assert.equal(new Date(at.getTime() + 330 * 60 * 1000).toISOString().slice(0, 10), "2026-09-05");

console.log("  ✓ payroll paid-on date — real pay day, not the click; never future or before the month");
