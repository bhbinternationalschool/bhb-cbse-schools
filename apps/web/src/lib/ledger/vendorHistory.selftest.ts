/**
 * Vendor history: a paid bill is not a debt.
 */
import assert from "node:assert/strict";
import { buildVendorStatement, type VendorLine } from "@/lib/ledger/vendorHistory";

function line(p: Partial<VendorLine>): VendorLine {
  return {
    date: "2026-04-01",
    voucherNo: "V-1",
    voucherType: "expense",
    accountCode: "5031",
    accountName: "Vehicle Fuel",
    narration: "",
    instrumentRef: "",
    debitPaise: 0,
    creditPaise: 0,
    isPayable: false,
    ...p,
  };
}

function run() {
  // A bill paid in full: expense debit, cash credit, NO payable line at all.
  // The vendor is owed nothing, and the old bug reported the expense debit as
  // a balance in the vendor's favour.
  const settled = buildVendorStatement({
    partyKey: "kisan gas",
    name: "Kisan Gas",
    asOf: "2026-09-02",
    lines: [line({ debitPaise: 108_000 })],
  });
  assert.equal(settled.outstandingPaise, 0, "a cash purchase owes nothing");
  assert.equal(settled.purchasedPaise, 108_000, "but it is still turnover");
  assert.equal(settled.oldestDueDays, 0);

  // A bill on account, then a part payment.
  const partly = buildVendorStatement({
    partyKey: "peerson books",
    name: "Peerson Books",
    asOf: "2026-09-02",
    lines: [
      line({ date: "2026-04-10", voucherNo: "V-2", debitPaise: 50_000 }),
      line({ date: "2026-04-10", voucherNo: "V-2", accountCode: "2000", creditPaise: 50_000, isPayable: true }),
      line({ date: "2026-05-02", voucherNo: "V-9", accountCode: "2000", debitPaise: 20_000, isPayable: true }),
    ],
  });
  assert.equal(partly.billedPaise, 50_000);
  assert.equal(partly.paidPaise, 20_000);
  assert.equal(partly.outstandingPaise, 30_000);
  assert.equal(partly.purchasedPaise, 50_000);
  // The running balance is only moved by payable lines.
  assert.deepEqual(
    partly.rows.map((r) => r.runningDuePaise),
    [0, 50_000, 30_000],
  );
  // Aged from the bill that is still open, not from today.
  assert.equal(partly.oldestDueDays, 145, "10 Apr to 2 Sep");
  assert.equal(partly.lastActivityOn, "2026-05-02");

  // Two bills, one fully settled: the age is the SECOND bill's, because the
  // payment consumed the first. Ageing from the oldest bill regardless would
  // report a debt as far older than it is.
  const twoBills = buildVendorStatement({
    partyKey: "v",
    name: "V",
    asOf: "2026-09-02",
    lines: [
      line({ date: "2026-01-01", accountCode: "2000", creditPaise: 10_000, isPayable: true }),
      line({ date: "2026-08-01", accountCode: "2000", creditPaise: 10_000, isPayable: true }),
      line({ date: "2026-08-15", accountCode: "2000", debitPaise: 10_000, isPayable: true }),
    ],
  });
  assert.equal(twoBills.outstandingPaise, 10_000);
  assert.equal(twoBills.oldestDueDays, 32, "1 Aug to 2 Sep, not 1 Jan");

  // Nothing owed at all leaves no age to report.
  const clear = buildVendorStatement({
    partyKey: "v",
    name: "V",
    asOf: "2026-09-02",
    lines: [
      line({ date: "2026-01-01", accountCode: "2000", creditPaise: 10_000, isPayable: true }),
      line({ date: "2026-01-05", accountCode: "2000", debitPaise: 10_000, isPayable: true }),
    ],
  });
  assert.equal(clear.outstandingPaise, 0);
  assert.equal(clear.oldestDueDays, 0);

  console.log("vendorHistory selftest: ok");
}

run();
