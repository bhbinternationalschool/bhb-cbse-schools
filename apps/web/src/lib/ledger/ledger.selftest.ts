/**
 * Ledger v2 — harness.
 *
 * Two halves, because they fail differently:
 *
 *   1. Translation, offline. A desk journal becomes a ledger voucher without
 *      losing or inventing a paisa. This is pure and always runs.
 *   2. The live path, against a real Postgres. ledgerPost / ledgerReverse /
 *      the views, through the same TypeScript the app uses. Runs only when
 *      SUPABASE creds are present — `npm run test:ledger:live` points it at
 *      the verification project.
 *
 * The SQL side has its own coverage applied directly to the verification
 * database (see the P1 notes); what this adds is proof that the TypeScript
 * layer speaks to it correctly.
 *
 * Run: npx tsx src/lib/ledger/ledger.selftest.ts
 */
import assert from "node:assert/strict";

import {
  deskJournalToLedgerVoucher,
  voucherTypeForSource,
} from "@/lib/ledger/mirror";
import { defaultLedgerAccounts, isPostableLedgerCode } from "@/lib/ledger/coa";
import {
  buildExpenseVoucher,
  buildFeeReceiptVoucher,
  buildPayrollAccrualVoucher,
  buildPayrollPaymentVoucher,
  buildVendorBillVoucher,
  monthEndIso,
} from "@/lib/ledger/projectionMap";
import type { AccountsState, JournalEntry } from "@/lib/accountsTypes";

console.log("ledger.selftest.ts");

/* ─── Fixtures ─────────────────────────────────────────────── */

function bookWithCoa(): AccountsState {
  return {
    version: 1,
    cashPools: [],
    cashLedger: [],
    bankAccounts: [],
    bankLedger: [],
    modeBankMap: [],
    reconSessions: [],
    expenseCategories: [],
    expenseVouchers: [],
    recurringRules: [],
    vendors: [],
    vendorBills: [],
    payables: [],
    trustees: [],
    ownerLoans: [],
    ownerLoanSchedule: [],
    ownerCashHandovers: [],
    coaAccounts: [
      { id: "coa_cash", code: "1000", name: "Cash in Hand", group: "assets", isActive: true },
      { id: "coa_bank", code: "1010", name: "Bank Accounts", group: "assets", isActive: true },
      { id: "coa_fee", code: "4000", name: "Fee Income", group: "income", isActive: true },
      { id: "coa_group", code: "1", name: "Assets", group: "assets", isActive: true },
    ],
    journalEntries: [],
    fiscalYears: [],
    settings: { expenseApprovalPaise: 1_000_000, pettyThresholdPaise: 200_000 },
  };
}

function journal(patch: Partial<JournalEntry>): JournalEntry {
  return {
    id: "jv_1",
    date: "2026-08-23",
    voucherNo: "",
    narration: "Fee receipt RC-0001",
    lines: [
      { coaId: "coa_cash", debitPaise: 800_000, creditPaise: 0, narration: "Cash" },
      { coaId: "coa_bank", debitPaise: 1_200_000, creditPaise: 0, narration: "UPI" },
      { coaId: "coa_fee", debitPaise: 0, creditPaise: 2_000_000, narration: "Fee" },
    ],
    sourceType: "owner_loan",
    sourceId: "loan_abc",
    fiscalYearCode: "FY2026-27",
    createdAt: "2026-08-23T05:00:00.000Z",
    voidedAt: null,
    cancelReason: "",
    ...patch,
  };
}

/* ─── The chart itself ─────────────────────────────────────── */
{
  const coa = defaultLedgerAccounts();
  const codes = coa.map((a) => a.code);
  assert.equal(new Set(codes).size, codes.length, "no duplicate account codes");

  // Every desk code the posting paths resolve by string must survive into v2,
  // or a mirrored journal lands nowhere.
  for (const code of [
    "1000", "1010", "1020", "1030", "1040", "1050",
    "2000", "2100", "2200", "3000", "4000", "4100", "4200",
    "5000", "5010", "5020", "5030", "5040", "5050", "5060", "5900",
  ]) {
    assert.ok(codes.includes(code), `v2 chart must keep desk code ${code}`);
  }

  // Parents must exist, or the roll-up to a statement line breaks.
  for (const a of coa) {
    if (!a.parentCode) continue;
    assert.ok(codes.includes(a.parentCode), `${a.code} points at a missing parent ${a.parentCode}`);
  }

  // Group headings are not postable — posting to one would double-count it
  // against its own children.
  assert.equal(isPostableLedgerCode("1"), false, "group headings are not postable");
  assert.equal(isPostableLedgerCode("1000"), true, "leaf accounts are postable");

  for (const a of coa) {
    if (a.parentCode) {
      assert.ok(a.scheduleGroup !== "", `${a.code} needs a schedule group for the statutory pack`);
    }
  }
  console.log("  ok  the v2 chart keeps every desk code, resolves its parents, and maps to schedules");
}

/* ─── Voucher classification ───────────────────────────────── */
{
  assert.equal(voucherTypeForSource("fee_voucher"), "receipt");
  assert.equal(voucherTypeForSource("fee_cheque"), "receipt");
  assert.equal(voucherTypeForSource("expense_voucher"), "payment");
  assert.equal(voucherTypeForSource("day_close"), "contra");
  assert.equal(voucherTypeForSource("vendor_bill"), "purchase");
  assert.equal(voucherTypeForSource("payroll_run"), "payroll");
  assert.equal(voucherTypeForSource("something_new"), "journal");
  console.log("  ok  desk postings are filed under the right voucher series");
}

/* ─── Translation ──────────────────────────────────────────── */
{
  const v = deskJournalToLedgerVoucher(journal({}), bookWithCoa());
  assert.ok(v, "a normal journal must translate");

  assert.equal(v.voucherType, "journal", "an owner-loan posting files as a journal");
  assert.equal(v.date, "2026-08-23");
  assert.equal(v.sourceType, "desk_owner_loan", "the desk source is namespaced");
  assert.equal(v.sourceId, "loan_abc", "the desk's own key carries across for idempotency");

  const dr = v.lines.reduce((n, l) => n + l.debitPaise, 0);
  const cr = v.lines.reduce((n, l) => n + l.creditPaise, 0);
  assert.equal(dr, 2_000_000, "debits survive translation exactly");
  assert.equal(cr, 2_000_000, "credits survive translation exactly");
  assert.equal(dr, cr, "a translated voucher is still balanced");

  assert.deepEqual(
    v.lines.map((l) => l.accountCode),
    ["1000", "1010", "4000"],
    "COA ids resolve to the codes the ledger keys on",
  );
  console.log("  ok  a desk journal becomes a balanced ledger voucher, paisa for paisa");
}

/* ─── What must NOT translate ──────────────────────────────── */
{
  const book = bookWithCoa();

  assert.equal(
    deskJournalToLedgerVoucher(journal({ voidedAt: "2026-08-24T00:00:00.000Z" }), book),
    null,
    "a voided entry is not mirrored — the ledger records a reversal, not a flag",
  );

  assert.equal(
    deskJournalToLedgerVoucher(
      journal({
        lines: [
          { coaId: "coa_missing", debitPaise: 100, creditPaise: 0, narration: "" },
          { coaId: "coa_fee", debitPaise: 0, creditPaise: 100, narration: "" },
        ],
      }),
      book,
    ),
    null,
    "an unresolvable COA id refuses the whole voucher rather than dropping a line",
  );

  assert.equal(
    deskJournalToLedgerVoucher(
      journal({
        lines: [
          { coaId: "coa_group", debitPaise: 100, creditPaise: 0, narration: "" },
          { coaId: "coa_fee", debitPaise: 0, creditPaise: 100, narration: "" },
        ],
      }),
      book,
    ),
    null,
    "a posting to a group heading is refused",
  );

  assert.equal(
    deskJournalToLedgerVoucher(
      journal({
        lines: [{ coaId: "coa_cash", debitPaise: 100, creditPaise: 0, narration: "" }],
      }),
      book,
    ),
    null,
    "a one-sided entry is refused",
  );

  // The projection owns these outright. Mirroring them too would post the
  // same money twice under two different source keys.
  for (const owned of ["fee_voucher", "fee_cheque", "expense_voucher", "vendor_bill", "payroll_run"]) {
    assert.equal(
      deskJournalToLedgerVoucher(journal({ sourceType: owned }), book),
      null,
      `${owned} is projected from the desk record, so the mirror must stand aside`,
    );
  }
  console.log("  ok  voids, unknown accounts, group headings and one-sided entries are refused");
  console.log("  ok  the mirror stands aside for every source the projection owns");
}


/* ─── Projection: what each desk record becomes ────────────── */

/** Debit/credit totals plus a by-account view, for asserting placement. */
function shape(lines: { accountCode: string; debitPaise: number; creditPaise: number }[]) {
  const dr = lines.reduce((n, l) => n + l.debitPaise, 0);
  const cr = lines.reduce((n, l) => n + l.creditPaise, 0);
  const by: Record<string, number> = {};
  for (const l of lines) {
    by[l.accountCode] = (by[l.accountCode] ?? 0) + l.debitPaise - l.creditPaise;
  }
  return { dr, cr, by };
}

{
  const built = buildFeeReceiptVoucher({
    voucher: {
      id: "v1",
      householdId: "hh_1",
      receiptNo: "RC-1",
      collectionDate: "2026-08-23",
      totalPaise: 20_000_00,
      cashierName: "Counter 1",
      voidedAt: null,
    },
    tenders: [
      { mode: "cash", amountPaise: 8_000_00, ref: "", instrumentDate: null, bankAccountId: "" },
      { mode: "upi", amountPaise: 7_000_00, ref: "UTR1", instrumentDate: "2026-08-23", bankAccountId: "bnk_1" },
      { mode: "cheque", amountPaise: 5_000_00, ref: "004521", instrumentDate: "2026-08-20", bankAccountId: "" },
    ],
    lines: [
      { kind: "academic", amountPaise: 17_000_00 },
      { kind: "store", amountPaise: 3_000_00 },
    ],
  });
  assert.ok(built.ok, `fee receipt must build: ${built.ok ? "" : built.reason}`);
  const v = built.voucher;
  const { dr, cr, by } = shape(v.lines);

  assert.equal(v.voucherType, "receipt", "a fee collection is a receipt");
  assert.equal(v.sourceType, "fee_receipt");
  assert.equal(v.sourceId, "v1", "keyed on the desk voucher, so a replay lands once");
  assert.equal(dr, cr, "the receipt balances");
  assert.equal(dr, 20_000_00, "the whole receipt is booked");

  assert.equal(by["1000"], 8_000_00, "cash goes to Cash in Hand");
  assert.equal(by["1010"], 7_000_00, "UPI goes to Bank");
  assert.equal(by["1050"], 5_000_00, "a cheque waits in Cheques in Hand, not Bank");
  assert.equal(by["1040"], -3_000_00, "the store portion settles Store Receivable");
  assert.equal(by["4000"], -17_000_00, "only the rest is fee income");

  const upi = v.lines.find((l) => l.accountCode === "1010");
  assert.ok(upi, "the UPI tender produced a bank line");
  assert.equal(upi.subledgerKind, "bank_account", "the bank tender is tagged to its account");
  assert.equal(upi.subledgerId, "bnk_1");
  assert.equal(upi.instrument?.ref, "UTR1", "the UTR is carried for reconciliation");

  const cashLine = v.lines.find((l) => l.accountCode === "1000");
  assert.ok(cashLine, "the cash tender produced a cash line");
  assert.equal(cashLine.subledgerId, undefined, "no cash pool is invented — the desk row does not say which");
  assert.ok(
    v.lines.every((l) => l.accountCode === "1050" || l.party?.externalId === "hh_1" || l.accountCode === "1010"),
    "the household is carried so the party ledger works",
  );
  console.log("  ok  a fee receipt splits to cash / bank / cheques-in-hand and settles store dues first");
}

{
  // A receipt whose tenders disagree with its own total is a data problem.
  // Preferring either number would silently invent money.
  const built = buildFeeReceiptVoucher({
    voucher: {
      id: "v2", householdId: "hh_2", receiptNo: "RC-2",
      collectionDate: "2026-08-23", totalPaise: 10_000_00,
      cashierName: "", voidedAt: null,
    },
    tenders: [{ mode: "cash", amountPaise: 9_000_00, ref: "", instrumentDate: null, bankAccountId: "" }],
    lines: [],
  });
  assert.equal(built.ok, false, "a receipt that disagrees with its tenders is refused");
  assert.match(built.reason, /tenders total/, "the refusal says what disagreed");

  const noTender = buildFeeReceiptVoucher({
    voucher: {
      id: "v3", householdId: "", receiptNo: "RC-3",
      collectionDate: "2026-08-23", totalPaise: 100, cashierName: "", voidedAt: null,
    },
    tenders: [],
    lines: [],
  });
  assert.equal(noTender.ok, false, "a receipt with no tender is refused");
  console.log("  ok  a receipt that does not add up is refused, not reconciled by guesswork");
}

{
  const built = buildExpenseVoucher({
    voucher: {
      id: "e1", voucherNo: "EX-1", voucherDate: "2026-08-23",
      grandTotalPaise: 12_000_00, paidPaise: 5_000_00, duePaise: 7_000_00,
      mode: "upi", bankId: "bnk_1", vendorId: "ven_1",
      narration: "Diesel", approvedBy: "director", cancelledAt: null,
    },
    expenseAccountCode: "5030",
  });
  assert.ok(built.ok, `expense must build: ${built.ok ? "" : built.reason}`);
  const { dr, cr, by } = shape(built.voucher.lines);
  assert.equal(dr, cr, "the expense balances");
  assert.equal(by["5030"], 12_000_00, "the whole expense is incurred on the voucher date");
  assert.equal(by["1010"], -5_000_00, "what was paid leaves the bank");
  assert.equal(by["2000"], -7_000_00, "what is still owed becomes a payable");
  assert.equal(built.voucher.voucherType, "payment");
  console.log("  ok  a part-paid expense splits between bank and accounts payable");
}

{
  const built = buildVendorBillVoucher({
    bill: {
      id: "b1", vendorId: "ven_1", billNo: "INV-9",
      billDate: "2026-08-20", grandTotalPaise: 25_000_00, narration: "",
    },
    expenseAccountCode: "5060",
  });
  assert.ok(built.ok);
  const { dr, cr, by } = shape(built.voucher.lines);
  assert.equal(dr, cr);
  assert.equal(by["5060"], 25_000_00, "purchases are debited");
  assert.equal(by["2000"], -25_000_00, "the vendor is credited");
  assert.equal(built.voucher.voucherType, "purchase");
  const payable = built.voucher.lines.find((l) => l.accountCode === "2000");
  assert.ok(payable, "the bill produced a payable line");
  assert.equal(payable.party?.externalId, "ven_1", "the vendor is carried as a party");
  console.log("  ok  a vendor bill accrues to the vendor's payable without touching cash");
}

{
  const built = buildPayrollAccrualVoucher({
    run: { id: "pr1", month: "2026-07", status: "posted", postedBy: "director" },
    lines: [
      { staffId: "s1", fullName: "A", grossPaise: 30_000_00, netPaise: 25_000_00, advanceDeductPaise: 2_000_00 },
      { staffId: "s2", fullName: "B", grossPaise: 20_000_00, netPaise: 18_000_00, advanceDeductPaise: 0 },
    ],
    date: monthEndIso("2026-07"),
  });
  assert.ok(built.ok, `payroll must build: ${built.ok ? "" : built.reason}`);
  const { dr, cr, by } = shape(built.voucher.lines);
  assert.equal(dr, cr, "payroll balances");
  assert.equal(by["5070"], 50_000_00, "gross pay is the expense");
  assert.equal(by["1070"], -2_000_00, "advances recovered reduce the staff advance asset");
  assert.equal(by["2300"], -5_000_00, "the rest withheld becomes a statutory liability");
  assert.equal(by["2110"], -43_000_00, "net pay is what the staff are owed");
  assert.equal(built.voucher.date, "2026-07-31", "payroll accrues at month end");
  assert.equal(built.voucher.voucherType, "payroll");
  console.log("  ok  a payroll run books gross pay, advances, deductions and net payable");
}

{
  // net + advances exceeding gross means the run's arithmetic disagrees with
  // itself; a balancing plug would invent a number.
  const bad = buildPayrollAccrualVoucher({
    run: { id: "pr2", month: "2026-07", status: "posted", postedBy: "" },
    lines: [{ staffId: "s1", fullName: "A", grossPaise: 10_000_00, netPaise: 12_000_00, advanceDeductPaise: 0 }],
    date: "2026-07-31",
  });
  assert.equal(bad.ok, false, "an impossible run is refused");
  assert.match(bad.reason, /less than net/, "the refusal explains the arithmetic");

  const pay = buildPayrollPaymentVoucher({
    run: { id: "pr1", month: "2026-07", status: "paid", postedBy: "" },
    netPaise: 43_000_00,
    date: "2026-08-05",
  });
  assert.ok(pay.ok);
  const { by } = shape(pay.voucher.lines);
  assert.equal(by["2110"], 43_000_00, "paying clears the salary payable");
  assert.equal(by["1010"], -43_000_00, "and the money leaves the bank");
  assert.equal(pay.voucher.sourceType, "payroll_payment", "payment is its own event, keyed separately");
  console.log("  ok  paying a run clears the payable separately, on its own date");
}

/* ─── Live path ────────────────────────────────────────────── */

async function live() {
  if (!process.env.SUPABASE_SERVICE_ROLE_KEY || !process.env.NEXT_PUBLIC_SUPABASE_URL) {
    console.log("  --  live checks skipped (no Supabase credentials in env)");
    return;
  }
  const url = process.env.NEXT_PUBLIC_SUPABASE_URL;
  console.log(`  ..  live checks against ${url}`);

  const { ledgerPost, ledgerReverse, ledgerTrialBalance, ensureLedgerMasters } =
    await import("@/lib/ledger/ledger.server");

  const masters = await ensureLedgerMasters({ fyCode: "FY2026-27" });
  assert.ok(masters.ok, `masters must install: ${masters.error ?? ""}`);
  console.log(`  ok  ledger masters installed (${masters.accountsAdded} accounts added)`);

  const stamp = Date.now();
  const sourceId = `selftest_${stamp}`;

  const posted = await ledgerPost({
    voucherType: "receipt",
    date: "2026-08-23",
    narration: "Ledger selftest receipt",
    sourceType: "selftest",
    sourceId,
    createdBy: "selftest",
    lines: [
      {
        accountCode: "1000",
        debitPaise: 250_000,
        creditPaise: 0,
        narration: "Cash",
        subledgerKind: "cash_pool",
        subledgerId: "drawer",
        costCentreCode: "school",
        party: { kind: "household", externalId: `hh_${stamp}`, name: "Selftest" },
      },
      { accountCode: "4000", debitPaise: 0, creditPaise: 250_000, narration: "Fee" },
    ],
  });
  assert.ok(posted.ok, `live post must succeed: ${posted.ok ? "" : posted.error}`);
  assert.equal(posted.created, true, "the first post creates a voucher");
  assert.match(posted.voucherNo, /^RC\/FY\d{4}-\d{2}\/\d{5}$/, "voucher is numbered in its series");

  const replay = await ledgerPost({
    voucherType: "receipt",
    date: "2026-08-23",
    sourceType: "selftest",
    sourceId,
    lines: [
      { accountCode: "1000", debitPaise: 250_000, creditPaise: 0 },
      { accountCode: "4000", debitPaise: 0, creditPaise: 250_000 },
    ],
  });
  assert.ok(replay.ok, "a replay must not error");
  assert.equal(replay.created, false, "a replay creates nothing");
  assert.equal(replay.voucherId, posted.voucherId, "a replay returns the original voucher");
  console.log(`  ok  live post is idempotent (${posted.voucherNo})`);

  const unbalanced = await ledgerPost({
    voucherType: "journal",
    date: "2026-08-23",
    lines: [
      { accountCode: "1000", debitPaise: 100, creditPaise: 0 },
      { accountCode: "4000", debitPaise: 0, creditPaise: 90 },
    ],
  });
  assert.equal(unbalanced.ok, false, "the server refuses an unbalanced voucher");

  const group = await ledgerPost({
    voucherType: "journal",
    date: "2026-08-23",
    lines: [
      { accountCode: "1", debitPaise: 100, creditPaise: 0 },
      { accountCode: "4000", debitPaise: 0, creditPaise: 100 },
    ],
  });
  assert.equal(group.ok, false, "a group heading is refused before it reaches the server");
  console.log("  ok  unbalanced vouchers and group-heading postings are refused");

  const reversed = await ledgerReverse({
    voucherId: posted.voucherId,
    reason: "selftest cleanup",
    createdBy: "selftest",
  });
  assert.ok(reversed.ok, `reversal must succeed: ${reversed.ok ? "" : reversed.error}`);

  const again = await ledgerReverse({ voucherId: posted.voucherId, reason: "again" });
  assert.ok(again.ok && again.created === false, "reversal is idempotent");
  console.log(`  ok  live reversal is idempotent (${reversed.voucherNo})`);

  const tb = await ledgerTrialBalance();
  assert.ok(tb.ok, `trial balance must read: ${tb.error ?? ""}`);
  const dr = tb.rows.reduce((n, r) => n + r.closingDebitPaise, 0);
  const cr = tb.rows.reduce((n, r) => n + r.closingCreditPaise, 0);
  assert.equal(dr, cr, `the server trial balance must tie — Dr ${dr} vs Cr ${cr}`);
  console.log(`  ok  server trial balance ties (Dr = Cr = ${dr})`);
}

void live()
  .then(() => {
    console.log("\nAll ledger checks passed.");
    process.exit(0);
  })
  .catch((e) => {
    console.error(e);
    process.exit(1);
  });
