/**
 * Self-test: a multi-line expense voucher and what it leaves owing.
 *
 * One trip buys a printer cartridge and a tank of CNG — one voucher, two
 * heads, two vendors, and often one payment that does not cover both. The
 * money that left must equal the money credited, and every remainder must
 * name the vendor it is owed to or the payable cannot be chased.
 */

import assert from "node:assert/strict";

import {
  allocateExpensePayment,
  buildExpenseVoucherLines,
  lineTotalPaise,
  vendorPartyKey,
  type DraftExpenseLine,
} from "./expenseVoucherDraft";

console.log("expenseVoucherDraft.selftest.ts");

const line = (p: Partial<DraftExpenseLine>): DraftExpenseLine => ({
  id: "l1", accountCode: "5040", tag: "", vendorName: "",
  description: "", amountPaise: 0, taxPaise: 0, ...p,
});

const cartridge = line({
  id: "a", accountCode: "5040", vendorName: "Peerson Books",
  description: "Printer cartridge", amountPaise: 2000_00, taxPaise: 360_00, tag: "school",
});
const cng = line({
  id: "b", accountCode: "5031", vendorName: "Indraprastha Gas",
  description: "CNG", amountPaise: 3000_00, tag: "transport",
});

/* Totals add up, tax included. */
{
  assert.equal(lineTotalPaise(cartridge), 2360_00, "amount plus tax");
  const t = allocateExpensePayment([cartridge, cng], 5360_00);
  assert.equal(t.amountPaise, 5000_00);
  assert.equal(t.taxPaise, 360_00);
  assert.equal(t.grandTotalPaise, 5360_00);
  assert.equal(t.duePaise, 0, "paid in full leaves nothing owing");
  assert.deepEqual(t.duesByVendor, []);
}

/* A part payment settles the earliest line, not a slice of everything. */
{
  const t = allocateExpensePayment([cartridge, cng], 2360_00);
  assert.equal(t.lines[0]!.paidPaise, 2360_00, "the cartridge is settled");
  assert.equal(t.lines[0]!.duePaise, 0);
  assert.equal(t.lines[1]!.paidPaise, 0, "the CNG is not part-paid");
  assert.equal(t.lines[1]!.duePaise, 3000_00);
  assert.deepEqual(
    t.duesByVendor,
    [{ vendorName: "Indraprastha Gas", duePaise: 3000_00 }],
    "and the whole remainder is owed to ONE vendor, chaseable by name",
  );
}

/* Paid and due always add back to the voucher. */
{
  for (const paid of [0, 1, 999_99, 2360_00, 4000_00, 5360_00, 9999_00]) {
    const t = allocateExpensePayment([cartridge, cng], paid);
    assert.equal(
      t.paidPaise + t.duePaise,
      t.grandTotalPaise,
      `paid + due must equal the voucher at ${paid}`,
    );
    assert.equal(
      t.lines.reduce((n, l) => n + l.paidPaise, 0),
      t.paidPaise,
      "the per-line split adds back to the money that left",
    );
    assert.ok(t.paidPaise <= t.grandTotalPaise, "never allocates more than the voucher");
  }
}

/* Overpayment and negatives are clamped rather than posted. */
{
  assert.equal(allocateExpensePayment([cng], 9_00_000_00).paidPaise, 3000_00, "capped at the total");
  assert.equal(allocateExpensePayment([cng], -500).paidPaise, 0, "a negative pays nothing");
}

/* Empty and zero lines are ignored, not posted as nothing. */
{
  const t = allocateExpensePayment(
    [line({ id: "x", accountCode: "", amountPaise: 500 }), line({ id: "y", amountPaise: 0 }), cng],
    0,
  );
  assert.equal(t.lines.length, 1, "only the real line survives");
  assert.equal(t.grandTotalPaise, 3000_00);
}

/* Vendor identity is normalised, so a history is one party not three. */
{
  assert.equal(vendorPartyKey("  Peerson   Books "), "peerson books");
  assert.equal(vendorPartyKey("PEERSON BOOKS"), vendorPartyKey("Peerson Books"));
}

/* The built voucher balances, and the payable names its vendor. */
{
  const t = allocateExpensePayment([cartridge, cng], 2360_00);
  const lines = buildExpenseVoucherLines({
    totals: t,
    gstInputCode: "1080",
    payableCode: "2000",
    payment: { kind: "cash", accountCode: "1000" },
  });
  const dr = lines.reduce((n, l) => n + l.debitPaise, 0);
  const cr = lines.reduce((n, l) => n + l.creditPaise, 0);
  assert.equal(dr, cr, "the voucher balances");
  assert.equal(dr, 5360_00, "and is worth the whole voucher, paid or not");

  const tax = lines.find((l) => l.accountCode === "1080")!;
  assert.equal(tax.debitPaise, 360_00, "tax goes to GST input credit");

  const payable = lines.find((l) => l.accountCode === "2000")!;
  assert.equal(payable.creditPaise, 3000_00);
  assert.equal(payable.party?.name, "Indraprastha Gas", "the payable names who it is owed to");
  assert.equal(payable.party?.externalId, "indraprastha gas");

  const cash = lines.find((l) => l.accountCode === "1000")!;
  assert.equal(cash.creditPaise, 2360_00, "only the money that actually left");

  const fuel = lines.find((l) => l.accountCode === "5031")!;
  assert.equal(fuel.costCentreCode, "transport", "the line's tag rides with it");
  assert.equal(fuel.party?.name, "Indraprastha Gas", "so does its vendor");
}

/* Two vendors part-paid get two payable credits, not one lump. */
{
  const third = line({ id: "c", accountCode: "5020", vendorName: "UPPCL", amountPaise: 1000_00 });
  const t = allocateExpensePayment([cartridge, cng, third], 0);
  const lines = buildExpenseVoucherLines({
    totals: t, gstInputCode: "1080", payableCode: "2000",
    payment: { kind: "cash", accountCode: "1000" },
  });
  const payables = lines.filter((l) => l.accountCode === "2000");
  assert.equal(payables.length, 3, "one credit per vendor");
  assert.equal(
    payables.reduce((n, l) => n + l.creditPaise, 0),
    t.grandTotalPaise,
    "and together they are the whole unpaid voucher",
  );
  assert.ok(!lines.some((l) => l.accountCode === "1000"), "nothing paid, so no cash line at all");
}

/* A bank payment carries the bank and the instrument. */
{
  const t = allocateExpensePayment([cng], 3000_00);
  const lines = buildExpenseVoucherLines({
    totals: t, gstInputCode: "1080", payableCode: "2000",
    payment: { kind: "bank", accountCode: "1012", bankId: "bnk_1", mode: "upi", ref: "UTR9", date: "2026-09-01" },
  });
  const bank = lines.find((l) => l.accountCode === "1012")!;
  assert.equal(bank.subledgerId, "bnk_1", "the bank the money left");
  assert.equal(bank.instrument?.ref, "UTR9", "and the reference to find it by");
}

console.log("  ok — totals tie, part payments settle whole lines, dues name their vendor");
