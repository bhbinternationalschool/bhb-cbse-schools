/**
 * Self-test: salary paid on each person's own date, and a recall that
 * reverses the book (director, 14 Oct 2026: "July salary is held; I recalled
 * it to draft; I have to pay on different dates for every staff — how?").
 * Run: npx tsx src/lib/payrollPerDatePay.selftest.ts
 *
 * Pins:
 *  - source id → run mapping for every payroll voucher shape in the book,
 *    including the April hand corrections ('pr_dcnn8881:cash');
 *  - versioned source ids after a recall ('pr_x#2');
 *  - one payment group per (day paid, money account), wallet → 1110, cash
 *    → 1000, else the mode's bank (NEFT/RTGS/UPI fallback, then 1010);
 *  - "posted · partly paid (n of m)" until every payable line is paid;
 *  - marking / un-marking lines paid on a posted run (the posted-line lock
 *    let only payment fields through — it used to drop them silently too).
 */
import assert from "node:assert/strict";

delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
const store = new Map<string, string>();
(globalThis as Record<string, unknown>).window = globalThis;
(globalThis as Record<string, unknown>).dispatchEvent ??= () => true;
(globalThis as Record<string, unknown>).addEventListener ??= () => {};
(globalThis as Record<string, unknown>).removeEventListener ??= () => {};
(globalThis as Record<string, unknown>).localStorage = {
  getItem: (k: string) => store.get(k) ?? null,
  setItem: (k: string, v: string) => void store.set(k, v),
  removeItem: (k: string) => void store.delete(k),
  clear: () => void store.clear(),
};

import {
  groupPayrollPayments,
  isPayrollPaymentGroupSource,
  payrollPaidProgress,
  payrollPaidStatusLabel,
  payrollPaymentAccount,
  payrollPaymentGroupBase,
  payrollRunIdFromSourceId,
  payrollSourceBase,
  payrollSourceVersion,
  versionedPayrollSourceId,
} from "./payrollPayGroups";
import {
  loadPayroll,
  markPayrollLinesPaid,
  markPayrollPaid,
  normalizePayrollLine,
  payrollRecallBlockedReason,
  onlyPaymentFieldsDiffer,
  recallPayrollToDraft,
  recordPayrollLinePayment,
  unmarkPayrollLinePaid,
  upsertPayrollRun,
  writePayrollLocalRaw,
  type PayrollRun,
} from "./payroll";

console.log("payrollPerDatePay.selftest.ts");

/* ── 1. source ids ──────────────────────────────────────────────────── */
for (const [id, run] of [
  ["pr_23vo73w4", "pr_23vo73w4"],
  ["pr_23vo73w4#2", "pr_23vo73w4"],
  ["pr_23vo73w4:pay:2026-07-30:cash", "pr_23vo73w4"],
  ["pr_23vo73w4:pay:2026-08-09:bnk_5rx0puwl#3", "pr_23vo73w4"],
  ["pr_dcnn8881:cash", "pr_dcnn8881"],
  ["pr_dcnn8881:upi-2140", "pr_dcnn8881"],
  ["pr_8gghaeln:lwp-2600", "pr_8gghaeln"],
  ["", ""],
] as const) {
  assert.equal(payrollRunIdFromSourceId(id), run, id);
}
assert.equal(payrollSourceBase("pr_x:pay:2026-07-30:cash#2"), "pr_x:pay:2026-07-30:cash");
assert.equal(payrollSourceBase("pr_x"), "pr_x");
assert.equal(payrollSourceVersion("pr_x"), 1);
assert.equal(payrollSourceVersion("pr_x#3"), 3);
assert.equal(versionedPayrollSourceId("pr_x", 1), "pr_x");
assert.equal(versionedPayrollSourceId("pr_x", 2), "pr_x#2");
assert.equal(payrollSourceVersion(versionedPayrollSourceId("pr_x:pay:2026-07-30:cash", 4)), 4);
assert.ok(isPayrollPaymentGroupSource("pr_x:pay:2026-07-30:cash"));
assert.ok(!isPayrollPaymentGroupSource("pr_dcnn8881:cash"), "a hand correction is not a payment group");
assert.ok(!isPayrollPaymentGroupSource("pr_x"));
assert.equal(payrollPaymentGroupBase("pr_x", "2026-07-30", "cash"), "pr_x:pay:2026-07-30:cash");

/* ── 2. money account per line ──────────────────────────────────────── */
const map = { upi: "bnk_main", neft: "bnk_main", rtgs: "bnk_main", cheque: "bnk_main" };
const codeForBank = (b: string) => (b === "bnk_main" ? "1012" : "1010");
assert.deepEqual(payrollPaymentAccount({ paymentMode: "cash" }, { bankForMode: map, codeForBank }), { code: "1000", key: "cash", bankId: "" });
assert.deepEqual(payrollPaymentAccount({ paymentMode: "upi" }, { walletPaid: true, bankForMode: map, codeForBank }), { code: "1110", key: "wallet", bankId: "" }, "the wallet first, whatever the mode");
assert.deepEqual(payrollPaymentAccount({ paymentMode: "bank_transfer" }, { bankForMode: map, codeForBank }), { code: "1012", key: "bnk_main", bankId: "bnk_main" }, "unmapped mode → the NEFT bank");
assert.deepEqual(payrollPaymentAccount({ paymentMode: "bank_transfer" }, {}), { code: "1010", key: "1010", bankId: "" }, "no bank mapped → 1010");
assert.deepEqual(payrollPaymentAccount({ paymentMode: "cheque" }, { bankForMode: { rtgs: "bnk_r", upi: "bnk_u" }, codeForBank }), { code: "1010", key: "bnk_r", bankId: "bnk_r" }, "fallback order neft, rtgs, upi (the SQL's order by mode)");

/* ── 3. grouping by day paid and account ────────────────────────────── */
const lines = [
  { staffId: "a", amountPayable: 4000, paidOn: "2026-07-30", paymentMode: "cash" },
  { staffId: "b", amountPayable: 12000, paidOn: "2026-08-09", paymentMode: "cash" },
  { staffId: "c", amountPayable: 10000, paidOn: "2026-08-09", paymentMode: "neft" },
  { staffId: "d", amountPayable: 9000, paidOn: "2026-08-09", paymentMode: "upi" },
  { staffId: "e", amountPayable: 6000, paidOn: "2026-08-09", paymentMode: "upi" },
  { staffId: "f", amountPayable: 5000, paidOn: "", paymentMode: "bank_transfer" },
  { staffId: "g", amountPayable: 0, paidOn: "2026-08-09", paymentMode: "cash" },
];
const groups = groupPayrollPayments("pr_x", lines, { bankForMode: map, codeForBank, walletPaid: (id) => id === "e" });
assert.deepEqual(
  groups.map((g) => [g.sourceBase, g.account.code, g.amount, g.staffIds.join("")]),
  [
    ["pr_x:pay:2026-07-30:cash", "1000", 4000, "a"],
    ["pr_x:pay:2026-08-09:bnk_main", "1012", 19000, "cd"],
    ["pr_x:pay:2026-08-09:cash", "1000", 12000, "b"],
    ["pr_x:pay:2026-08-09:wallet", "1110", 6000, "e"],
  ],
  "unpaid lines and nothing-payable lines are not booked",
);
// A run paid as a whole before per-line days: every line on the run's day.
const whole = groupPayrollPayments(
  "pr_y",
  [
    { staffId: "a", amountPayable: 100, paymentMode: "cash" },
    { staffId: "b", amountPayable: 200, paymentMode: "upi" },
  ],
  { runPaidOn: "2026-09-05", bankForMode: map, codeForBank },
);
assert.deepEqual(whole.map((g) => g.sourceBase), ["pr_y:pay:2026-09-05:bnk_main", "pr_y:pay:2026-09-05:cash"]);
// …but never when any line carries its own day.
assert.equal(
  groupPayrollPayments("pr_y", [{ staffId: "a", amountPayable: 100, paidOn: "2026-09-01", paymentMode: "cash" }, { staffId: "b", amountPayable: 200, paymentMode: "cash" }], { runPaidOn: "2026-09-05" }).length,
  1,
);

/* ── 4. partly paid ─────────────────────────────────────────────────── */
assert.deepEqual(payrollPaidProgress(lines), { payable: 6, paid: 5, allPaid: false, lastPaidOn: "2026-08-09" });
assert.equal(payrollPaidStatusLabel("posted", lines), "partly paid (5 of 6)");
assert.equal(payrollPaidStatusLabel("posted", lines.map((l) => ({ ...l, paidOn: "" }))), "");
assert.equal(payrollPaidStatusLabel("paid", lines), "");

/* ── 5. the desk: mark, un-mark, whole-run paid ─────────────────────── */
const line = (id: string, amount: number, mode = "bank_transfer") =>
  normalizePayrollLine({ staffId: id, empCode: id.toUpperCase(), fullName: `Staff ${id}`, gross: amount, netPay: amount, amountPayable: amount, paymentMode: mode as "cash" });
const posted: PayrollRun = {
  id: "pr_test1", academicYearCode: "2026-27", month: "2026-07", dayCount: 31, kind: "bulk", status: "posted",
  lines: [line("a", 4000, "cash"), line("b", 12000, "cash"), line("c", 10000), line("h", 0)],
  createdBy: "t", createdAt: "", submittedBy: "", submittedAt: "", approvedBy: "", approvedAt: "",
  postedBy: "t", postedAt: "2026-10-14T05:00:00.000Z", paidBy: "", paidAt: "", remark: "", submissionNote: "",
  rejectionNote: "", rejectedBy: "", rejectedAt: "", lockVersion: 5,
};
writePayrollLocalRaw({ version: 2, runs: [posted], audit: [] });
const now = new Date("2026-10-14T06:00:00Z");

// Amounts never move on a posted run; payment fields do.
assert.ok(onlyPaymentFieldsDiffer(posted.lines, posted.lines.map((l) => ({ ...l, paidOn: "2026-07-30", paymentRef: "X" }))));
assert.ok(!onlyPaymentFieldsDiffer(posted.lines, posted.lines.map((l) => ({ ...l, netPay: l.netPay + 1 }))));
assert.ok(!onlyPaymentFieldsDiffer(posted.lines, posted.lines.slice(1)));
upsertPayrollRun({ ...posted, lines: posted.lines.map((l) => ({ ...l, gross: 1 })) });
assert.equal(loadPayroll().runs[0]!.lines[0]!.gross, 4000, "the posted-line lock still holds for amounts");

const bad = markPayrollLinesPaid("pr_test1", ["a"], { date: "2026-06-30" }, "t", now);
assert.ok(!bad.ok && /before 2026-07-01/.test(bad.error), "not before the month");
const future = markPayrollLinesPaid("pr_test1", ["a"], { date: "2026-10-20" }, "t", now);
assert.ok(!future.ok && /future/.test(future.error));

const m1 = markPayrollLinesPaid("pr_test1", ["a"], { date: "2026-07-30" }, "t", now);
assert.ok(m1.ok);
let run = loadPayroll().runs[0]!;
assert.equal(run.status, "posted");
assert.equal(run.lines[0]!.paidOn, "2026-07-30");
assert.equal(run.lines[0]!.paymentDate, "2026-07-30", "payslips read the day paid");
assert.equal(run.lines[0]!.paymentMode, "cash", "the line keeps its own mode when none is given");
assert.equal(run.lockVersion, 6);
assert.equal(payrollPaidStatusLabel(run.status, run.lines), "partly paid (1 of 3)", "a zero-payable line is not waiting");

assert.ok(markPayrollLinesPaid("pr_test1", ["b", "c"], { date: "2026-08-09", mode: "neft", ref: "UTR123" }, "t", now).ok);
run = loadPayroll().runs[0]!;
assert.equal(run.status, "paid", "everyone payable is paid → the run is paid");
assert.equal(run.paidAt.slice(0, 10), "2026-08-09", "on the latest day paid");
assert.equal(run.lines[1]!.paymentMode, "neft");
assert.equal(run.lines[2]!.paymentRef, "UTR123");
assert.match(run.lines[2]!.note, /UTR UTR123/);

// Recall stays refused for a paid run.
assert.ok(!recallPayrollToDraft("pr_test1", "t").ok);

// Un-mark: back to posted, partly paid.
const un = unmarkPayrollLinePaid("pr_test1", "c", "t");
assert.ok(un.ok);
run = loadPayroll().runs[0]!;
assert.equal(run.status, "posted");
assert.equal(run.paidAt, "");
assert.equal(run.lines[2]!.paidOn, "");
assert.ok(!unmarkPayrollLinePaid("pr_test1", "c", "t").ok, "not marked → nothing to un-mark");

// "Mark all paid" pays only who is still unpaid; the others keep their day.
assert.ok(markPayrollPaid("pr_test1", "t", "2026-08-12").ok);
run = loadPayroll().runs[0]!;
assert.equal(run.status, "paid");
assert.deepEqual(run.lines.map((l) => l.paidOn), ["2026-07-30", "2026-08-09", "2026-08-12", "2026-08-12"]);

// "Pay by UPI" on one line goes through the same path (and lands).
writePayrollLocalRaw({ version: 2, runs: [posted], audit: [] });
assert.ok(recordPayrollLinePayment("pr_test1", "c", { mode: "upi", date: "2026-08-01", ref: "412345678901" }, "t").ok);
run = loadPayroll().runs[0]!;
assert.equal(run.lines[2]!.paidOn, "2026-08-01", "the UPI line payment is no longer dropped by the posted-line lock");
assert.equal(run.lines[2]!.paymentMode, "upi");

// A run paid as a whole the old way cannot have lines re-dated or un-marked.
writePayrollLocalRaw({ version: 2, runs: [{ ...posted, status: "paid", paidAt: "2026-08-31T06:30:00.000Z", paidBy: "t" }], audit: [] });
assert.ok(!markPayrollLinesPaid("pr_test1", ["a"], { date: "2026-08-01" }, "t", now).ok);
const oldUn = unmarkPayrollLinePaid("pr_test1", "a", "t");
assert.ok(!oldUn.ok && /as a whole/.test(oldUn.error));

// A partly paid run is not recalled: their money has left (review of #620).
writePayrollLocalRaw({ version: 2, runs: [posted], audit: [] });
assert.ok(markPayrollLinesPaid("pr_test1", ["a"], { date: "2026-07-30" }, "t", now).ok);
const partly = recallPayrollToDraft("pr_test1", "t");
assert.ok(!partly.ok && /Staff a is already marked paid/.test(partly.error) && /Nothing was changed/.test(partly.error), partly.ok ? "" : partly.error);
assert.equal(payrollRecallBlockedReason(loadPayroll().runs[0]!)?.includes("Staff a"), true);
assert.equal(loadPayroll().runs[0]!.status, "posted");

// A posted run nobody is paid on recalls, and the audit names the book's reversals.
writePayrollLocalRaw({ version: 2, runs: [posted], audit: [] });
assert.equal(payrollRecallBlockedReason(posted), null);
const rc = recallPayrollToDraft("pr_test1", "t", { reversed: [{ voucherNo: "PR/FY2026-27/00002", reversalNo: "RV/FY2026-27/00983" }] });
assert.ok(rc.ok);
assert.equal(loadPayroll().runs[0]!.status, "draft");
assert.match(loadPayroll().audit[0]!.detail, /PR\/FY2026-27\/00002 → RV\/FY2026-27\/00983/);

console.log("  ok");
