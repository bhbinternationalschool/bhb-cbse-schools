/**
 * Self-test: the controls page must report things worth looking at.
 *
 * It had grown to 1 critical, 178 warnings and 590 info on production — and
 * every one was a false alarm. The module's own note says why that matters:
 * "A finding that fires on ordinary activity gets ignored within a fortnight,
 * and then the real one is ignored too."
 *
 * Each case below pins BOTH halves: the ordinary activity must stop firing,
 * and the thing the rule exists for must still fire.
 */

import assert from "node:assert/strict";

import {
  findBackdatedEntries,
  findDuplicatePayments,
  findOverpaidParties,
  DEFAULT_ANOMALY_THRESHOLDS as T,
  type AnomalyFacts,
  type AnomalyLine,
  type AnomalyVoucher,
} from "./anomalies";

console.log("controlsNoise.selftest.ts");

const voucher = (p: Partial<AnomalyVoucher>): AnomalyVoucher => ({
  id: "v1", voucherNo: "V-1", voucherType: "payment", date: "2026-04-04",
  createdAt: "2026-04-04T10:00:00.000Z", narration: "", sourceType: "",
  sourceId: "", createdBy: "clerk", reversed: false, ...p,
});

const line = (p: Partial<AnomalyLine>): AnomalyLine => ({
  voucherId: "v1", accountCode: "2000", partyKey: "vendor:1", partyName: "Acme",
  debitPaise: 0, creditPaise: 0, instrumentRef: "", ...p,
});

const facts = (p: Partial<AnomalyFacts>): AnomalyFacts => ({
  asOf: "2026-09-01", vouchers: [], lines: [], balances: [],
  unreconciled: [], reopenedPeriods: [], ...p,
});

/* ── 1. "Paid more than was billed" — suppliers only ── */
{
  // A student with a store balance OWES the school. 177 of 177 students were
  // reported as overpaid, the entire store sales book.
  const student = findOverpaidParties(facts({
    vouchers: [voucher({})],
    lines: [line({ partyKey: "student:s1", partyName: "Aarav", debitPaise: 5000_00 })],
  }));
  assert.equal(student.length, 0, "a student's receivable is not an overpayment");

  // A supplier in debit genuinely has our money.
  const vendor = findOverpaidParties(facts({
    vouchers: [voucher({})],
    lines: [line({ partyKey: "vendor:v1", partyName: "Acme", debitPaise: 5000_00 })],
  }));
  assert.equal(vendor.length, 1, "an overpaid SUPPLIER is still reported");
  assert.equal(vendor[0]!.code, "party_overpaid");
}

/* ── 2. "Entered well after its own date" — only when the period is shut ── */
{
  const late = voucher({
    voucherType: "receipt", date: "2026-04-10",
    createdAt: "2026-09-01T10:00:00.000Z", // 144 days later
  });

  const openPeriod = findBackdatedEntries(
    facts({ vouchers: [late], reopenedPeriods: [{ period: "2026-04", status: "open" }] }),
    T,
  );
  assert.equal(openPeriod.length, 0, "late entry into an OPEN period is just late entry");

  const shut = findBackdatedEntries(
    facts({ vouchers: [late], reopenedPeriods: [{ period: "2026-04", status: "closed" }] }),
    T,
  );
  assert.equal(shut.length, 1, "the same entry into a CLOSED period is still reported");
  assert.equal(shut[0]!.code, "backdated_entry");

  const locked = findBackdatedEntries(
    facts({ vouchers: [late], reopenedPeriods: [{ period: "2026-04", status: "locked" }] }),
    T,
  );
  assert.equal(locked.length, 1, "locked counts as shut");
}

/* ── 3. "Same amount paid twice" — instalments are not duplicates ── */
{
  const pays = [
    voucher({ id: "p1", voucherNo: "PY-2", date: "2026-04-04" }),
    voucher({ id: "p2", voucherNo: "PY-3", date: "2026-04-05" }),
  ];
  // Peerson Books: two equal instalments, and the school still owes the rest,
  // so the payable is in CREDIT overall.
  const instalments = findDuplicatePayments(
    facts({
      vouchers: pays,
      lines: [
        line({ voucherId: "p1", debitPaise: 100000_00 }),
        line({ voucherId: "p2", debitPaise: 100000_00 }),
        line({ voucherId: "p1", creditPaise: 687450_00 }), // the bill
      ],
    }),
    T,
  );
  assert.equal(instalments.length, 0, "instalments on a bill still owed are not a duplicate");

  // The real thing: paid twice, and the supplier now holds money never billed.
  const real = findDuplicatePayments(
    facts({
      vouchers: pays,
      lines: [
        line({ voucherId: "p1", debitPaise: 100000_00 }),
        line({ voucherId: "p2", debitPaise: 100000_00 }),
        line({ voucherId: "p1", creditPaise: 100000_00 }), // billed once, paid twice
      ],
    }),
    T,
  );
  assert.equal(real.length, 1, "a genuine double payment is still critical");
  assert.equal(real[0]!.severity, "critical");
}

console.log("  ok — noise gone, the real findings still fire");
