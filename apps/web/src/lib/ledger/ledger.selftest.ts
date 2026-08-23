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
  allocateVoucherCash,
  buildBalanceSheet,
  buildIncomeExpenditure,
  buildReceiptsPayments,
  buildTrialBalance,
  paiseToRupeeString,
  type PeriodBalanceRow,
} from "@/lib/ledger/reports";
import {
  matchStatementToBook,
  parseAmountToPaise,
  parseBankStatementCsv,
  parseStatementDate,
  statementRowHash,
  summariseReconciliation,
} from "@/lib/ledger/reconcile";
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


/* ─── Bank statement parsing ───────────────────────────────── */

{
  assert.equal(parseAmountToPaise("1,23,456.78"), 12_345_678, "Indian digit grouping");
  assert.equal(parseAmountToPaise("₹ 1,000.00"), 100_000, "currency symbol and spaces");
  assert.equal(parseAmountToPaise("(500.50)"), -50_050, "parenthesised negatives");
  assert.equal(parseAmountToPaise("1234.5 Cr"), 123_450, "a trailing Cr marker");
  assert.equal(parseAmountToPaise(""), null, "an empty cell is not zero");
  assert.equal(parseAmountToPaise("  "), null, "nor is whitespace");
  assert.equal(parseAmountToPaise("abc"), null, "nor is text");
  // 0.1 + 0.2 arithmetic must not leak into money.
  assert.equal(parseAmountToPaise("0.07"), 7, "small amounts round exactly");
  assert.equal(parseAmountToPaise("8.29"), 829, "and so do awkward ones");

  assert.equal(parseStatementDate("2026-08-23"), "2026-08-23");
  assert.equal(parseStatementDate("23/08/2026"), "2026-08-23", "dd/mm/yyyy, as Indian banks write it");
  assert.equal(parseStatementDate("23-08-2026"), "2026-08-23");
  assert.equal(parseStatementDate("23-Aug-26"), "2026-08-23", "dd-MMM-yy");
  assert.equal(parseStatementDate("garbage"), null);
  console.log("  ok  bank amounts and dates parse in the formats Indian banks actually emit");
}

{
  // Header is not the first row: statements carry account preamble.
  const csv = [
    "Account Statement for 00000000",
    "Period: 01-08-2026 to 31-08-2026",
    "Txn Date,Value Date,Description,Chq/Ref Number,Withdrawal Amt,Deposit Amt,Closing Balance",
    "10/08/2026,10/08/2026,UPI/CR/778899/FEE,UTR-77,,7000.00,57000.00",
    "12/08/2026,12/08/2026,CHQ PAID 004521,004521,5000.00,,52000.00",
    "15/08/2026,15/08/2026,SMS CHRG AUG,,17.70,,51982.30",
    "Total,,,,5017.70,7000.00,",
  ].join("\n");

  const parsed = parseBankStatementCsv({ csv, bankSubledgerId: "bnk_1" });
  assert.equal(parsed.lines.length, 3, "three real rows, preamble and totals ignored");

  const [credit, cheque, charge] = parsed.lines;
  assert.equal(credit.direction, "credit");
  assert.equal(credit.amountPaise, 7_000_00);
  assert.equal(credit.signedPaise, 7_000_00, "a bank credit is money INTO the book's bank account");
  assert.equal(credit.ref, "UTR-77");
  assert.equal(credit.txnDate, "2026-08-10");

  assert.equal(cheque.direction, "debit");
  assert.equal(cheque.signedPaise, -5_000_00, "a bank debit is money out");
  assert.equal(charge.amountPaise, 17_70, "paise survive the round trip");

  assert.ok(
    parsed.skipped.some((s) => /no readable transaction date/.test(s.reason)),
    "the totals row is reported as skipped, not silently dropped",
  );
  console.log("  ok  a statement parses past its preamble and reports what it could not read");
}

{
  // Re-exporting an overlapping range is the normal case; the same line must
  // hash the same, and a different amount must not.
  const base = {
    bankSubledgerId: "bnk_1", txnDate: "2026-08-10", amountPaise: 700000,
    direction: "credit" as const, narration: "UPI/CR/778899", ref: "UTR-77",
  };
  assert.equal(statementRowHash(base), statementRowHash({ ...base }), "identical lines hash identically");
  assert.equal(
    statementRowHash(base),
    statementRowHash({ ...base, narration: "  UPI/CR/778899  " }),
    "whitespace differences do not defeat dedupe",
  );
  assert.notEqual(statementRowHash(base), statementRowHash({ ...base, amountPaise: 700001 }), "a paisa apart is a different line");
  assert.notEqual(statementRowHash(base), statementRowHash({ ...base, direction: "debit" }), "direction is part of identity");
  console.log("  ok  a re-imported statement line hashes to the same row, a changed one does not");
}

/* ─── Matching ─────────────────────────────────────────────── */

function stmtLine(o: Partial<{ id: string; txnDate: string; signedPaise: number; ref: string; narration: string; lineNo: number }>) {
  const signed = o.signedPaise ?? 0;
  return {
    id: o.id ?? "s1",
    lineNo: o.lineNo ?? 1,
    txnDate: o.txnDate ?? "2026-08-10",
    valueDate: null,
    amountPaise: Math.abs(signed),
    direction: (signed >= 0 ? "credit" : "debit") as "credit" | "debit",
    narration: o.narration ?? "",
    ref: o.ref ?? "",
    balancePaise: null,
    rowHash: "",
    signedPaise: signed,
  };
}

function bookLine(o: Partial<{ ledgerLineId: string; voucherDate: string; signedPaise: number; instrumentRef: string }>) {
  return {
    ledgerLineId: o.ledgerLineId ?? "b1",
    voucherDate: o.voucherDate ?? "2026-08-10",
    voucherNo: "RC/FY2026-27/00001",
    narration: "",
    instrumentRef: o.instrumentRef ?? "",
    instrumentMode: "",
    signedPaise: o.signedPaise ?? 0,
    alreadyMatched: false,
  };
}

{
  const r = matchStatementToBook({
    statementLines: [stmtLine({ id: "s1", signedPaise: 700000, ref: "UTR-77" })],
    bookLines: [
      bookLine({ ledgerLineId: "b_far", voucherDate: "2026-08-01", signedPaise: 700000 }),
      bookLine({ ledgerLineId: "b_ref", voucherDate: "2026-08-10", signedPaise: 700000, instrumentRef: "utr77" }),
    ],
  });
  assert.equal(r.matches.length, 1);
  assert.equal(r.matches[0]!.ledgerLineId, "b_ref", "the bank's own reference wins over a nearer date");
  assert.equal(r.matches[0]!.confidence, "exact");
  console.log("  ok  a matching bank reference beats every other signal");
}

{
  // Amount must agree exactly; a rupee out is a different transaction.
  const r = matchStatementToBook({
    statementLines: [stmtLine({ id: "s1", signedPaise: 700000 })],
    bookLines: [bookLine({ ledgerLineId: "b1", signedPaise: 700100 })],
  });
  assert.equal(r.matches.length, 0, "a near-miss amount is not a match");
  assert.deepEqual(r.unmatchedStatement, ["s1"]);
  assert.deepEqual(r.unmatchedBook, ["b1"]);

  // Direction must agree too: money out cannot explain money in.
  const opposite = matchStatementToBook({
    statementLines: [stmtLine({ id: "s1", signedPaise: 700000 })],
    bookLines: [bookLine({ ledgerLineId: "b1", signedPaise: -700000 })],
  });
  assert.equal(opposite.matches.length, 0, "an equal amount in the opposite direction is not a match");
  console.log("  ok  amount and direction must agree exactly — near misses stay unmatched");
}

{
  // Two identical amounts must pair in date order, not arbitrarily.
  const r = matchStatementToBook({
    statementLines: [
      stmtLine({ id: "s_late", txnDate: "2026-08-20", signedPaise: 500000, lineNo: 2 }),
      stmtLine({ id: "s_early", txnDate: "2026-08-10", signedPaise: 500000, lineNo: 1 }),
    ],
    bookLines: [
      bookLine({ ledgerLineId: "b_late", voucherDate: "2026-08-19", signedPaise: 500000 }),
      bookLine({ ledgerLineId: "b_early", voucherDate: "2026-08-09", signedPaise: 500000 }),
    ],
  });
  assert.equal(r.matches.length, 2);
  const pairs = Object.fromEntries(r.matches.map((m) => [m.statementLineId, m.ledgerLineId]));
  assert.equal(pairs.s_early, "b_early", "the earlier statement line takes the earlier book entry");
  assert.equal(pairs.s_late, "b_late");
  console.log("  ok  identical amounts pair up in date order rather than by luck");
}

{
  // A distant equal amount is proposed, never applied.
  const r = matchStatementToBook({
    statementLines: [stmtLine({ id: "s1", txnDate: "2026-08-20", signedPaise: 500000 })],
    bookLines: [bookLine({ ledgerLineId: "b1", voucherDate: "2026-08-12", signedPaise: 500000 })],
  });
  assert.equal(r.matches[0]!.confidence, "weak", "eight days apart is a weak match");
  assert.match(r.matches[0]!.reason, /confirm/, "and it says so");

  const tooFar = matchStatementToBook({
    statementLines: [stmtLine({ id: "s1", txnDate: "2026-09-20", signedPaise: 500000 })],
    bookLines: [bookLine({ ledgerLineId: "b1", voucherDate: "2026-08-12", signedPaise: 500000 })],
  });
  assert.equal(tooFar.matches.length, 0, "beyond the window it is not proposed at all");

  // An already-matched book line cannot be claimed twice.
  const taken = matchStatementToBook({
    statementLines: [stmtLine({ id: "s1", signedPaise: 500000 })],
    bookLines: [{ ...bookLine({ ledgerLineId: "b1", signedPaise: 500000 }), alreadyMatched: true }],
  });
  assert.equal(taken.matches.length, 0, "a book line already reconciled is not offered again");
  console.log("  ok  distant matches are proposed not applied, and nothing is matched twice");
}

/* ─── The reconciliation statement ─────────────────────────── */

{
  // The classic identity: book − unpresented + unrecorded = the bank.
  const s = summariseReconciliation({
    bankSubledgerId: "bnk_1",
    asOf: "2026-08-31",
    bookBalancePaise: 52_000_00,
    statementClosingPaise: 51_982_30,
    // A cheque we issued that has not been presented.
    unmatchedBookSignedPaise: [-5_000_00],
    // A bank charge we never recorded.
    unmatchedStatementSignedPaise: [-17_70],
  });
  assert.equal(s.unpresentedPaise, -5_000_00);
  assert.equal(s.unrecordedPaise, -17_70);
  assert.equal(s.reconciledPaise, 52_000_00 + 5_000_00 - 17_70);
  assert.equal(s.reconciledPaise, 56_982_30);
  assert.equal(s.reconciles, false, "and when it does not tie, it says so");

  const clean = summariseReconciliation({
    bankSubledgerId: "bnk_1",
    asOf: "2026-08-31",
    bookBalancePaise: 52_000_00,
    statementClosingPaise: 51_982_30,
    unmatchedBookSignedPaise: [],
    unmatchedStatementSignedPaise: [-17_70],
  });
  assert.equal(clean.reconciledPaise, 51_982_30, "book less nothing plus the unrecorded charge is the bank's figure");
  assert.equal(clean.reconciles, true, "which reconciles");

  const noStatement = summariseReconciliation({
    bankSubledgerId: "bnk_1", asOf: "2026-08-31", bookBalancePaise: 100,
    statementClosingPaise: null, unmatchedBookSignedPaise: [], unmatchedStatementSignedPaise: [],
  });
  assert.equal(noStatement.reconciles, false, "with no closing balance it cannot claim to reconcile");
  console.log("  ok  the reconciliation identity holds, and refuses to claim success without the bank's figure");
}


/* ─── Statements ───────────────────────────────────────────── */

function bal(o: Partial<PeriodBalanceRow> & { code: string; kind: PeriodBalanceRow["kind"] }): PeriodBalanceRow {
  return {
    accountId: o.code, code: o.code, name: o.name ?? o.code,
    kind: o.kind, scheduleGroup: o.scheduleGroup ?? "Group", parentCode: "",
    openingPaise: o.openingPaise ?? 0, debitPaise: o.debitPaise ?? 0,
    creditPaise: o.creditPaise ?? 0, closingPaise: o.closingPaise ?? 0,
  };
}

{
  const rows = [
    bal({ code: "1000", kind: "asset",     openingPaise: 50_000_00, debitPaise: 30_000_00, creditPaise: 10_000_00, closingPaise: 70_000_00 }),
    bal({ code: "3000", kind: "equity",    openingPaise: 50_000_00, closingPaise: 50_000_00 }),
    bal({ code: "4000", kind: "income",    creditPaise: 30_000_00, closingPaise: 30_000_00 }),
    bal({ code: "5000", kind: "expense",   debitPaise: 10_000_00, closingPaise: 10_000_00 }),
    bal({ code: "9999", kind: "asset" }),
  ];

  const tb = buildTrialBalance({ from: "2026-04-01", to: "2027-03-31", rows });
  assert.equal(tb.rows.length, 4, "an account with nothing at all is left out");
  assert.equal(tb.totals.debitPaise, 40_000_00);
  assert.equal(tb.totals.creditPaise, 40_000_00);
  assert.equal(tb.totals.closingDebitPaise, tb.totals.closingCreditPaise, "closing sides agree");
  assert.equal(tb.balanced, true);

  // A liability sitting in debit must appear on the debit side, not vanish.
  const contrary = buildTrialBalance({
    from: "2026-04-01", to: "2027-03-31",
    rows: [bal({ code: "2000", kind: "liability", closingPaise: -5_000_00 })],
  });
  assert.equal(contrary.rows[0]!.closingDebitPaise, 5_000_00, "a liability in debit shows as a debit");
  assert.equal(contrary.rows[0]!.closingCreditPaise, 0);
  console.log("  ok  the trial balance carries opening, movement and closing, and ties");
}

{
  // The rule that matters: a nominal account's brought-forward balance
  // belongs to a year already reported on.
  const rows = [
    bal({ code: "4000", kind: "income",  scheduleGroup: "Income from fees", openingPaise: 900_000_00, creditPaise: 30_000_00 }),
    bal({ code: "5000", kind: "expense", scheduleGroup: "Establishment",     openingPaise: 400_000_00, debitPaise: 12_000_00 }),
    bal({ code: "5100", kind: "expense", scheduleGroup: "Establishment",     debitPaise: 3_000_00 }),
  ];
  const ie = buildIncomeExpenditure({ from: "2026-04-01", to: "2027-03-31", rows });

  assert.equal(ie.totalIncomePaise, 30_000_00, "income is this year's movement, not since inception");
  assert.equal(ie.totalExpenditurePaise, 15_000_00, "and so is expenditure");
  assert.equal(ie.surplusPaise, 15_000_00, "the difference is the surplus");
  assert.equal(ie.expenditure.length, 1, "the two establishment lines group together");
  assert.equal(ie.expenditure[0]!.lines.length, 2);
  assert.equal(ie.expenditure[0]!.totalPaise, 15_000_00);
  console.log("  ok  income & expenditure reports the period only, never the brought-forward balance");
}

{
  // While the year is open, income and expenditure have not been swept into
  // corpus — so the surplus has to appear on the balance sheet or the sides
  // differ by exactly it.
  const rows = [
    bal({ code: "1000", kind: "asset",     closingPaise: 65_000_00 }),
    bal({ code: "3000", kind: "equity",    closingPaise: 50_000_00 }),
    bal({ code: "4000", kind: "income",    creditPaise: 30_000_00, closingPaise: 30_000_00 }),
    bal({ code: "5000", kind: "expense",   debitPaise: 15_000_00, closingPaise: 15_000_00 }),
  ];
  const ie = buildIncomeExpenditure({ from: "2026-04-01", to: "2027-03-31", rows });
  const bs = buildBalanceSheet({ asOf: "2027-03-31", rows, surplusPaise: ie.surplusPaise });

  assert.equal(ie.surplusPaise, 15_000_00);
  assert.equal(bs.totalAssetsPaise, 65_000_00);
  assert.equal(bs.totalLiabilitiesPaise, 50_000_00 + 15_000_00, "corpus plus the year's surplus");
  assert.equal(bs.balanced, true, "and the sheet balances");
  assert.equal(bs.differencePaise, 0);
  console.log("  ok  the balance sheet balances with the open year's surplus carried to corpus");
}

/* ─── Receipts & Payments allocation ───────────────────────── */

{
  // A plain fee receipt: the whole of it against fee income.
  const simple = allocateVoucherCash({
    cashSignedPaise: 20_000_00,
    heads: [{ code: "4000", name: "Fee Income", scheduleGroup: "Fees", signedPaise: 20_000_00 }],
  });
  assert.equal(simple.length, 1);
  assert.equal(simple[0]!.amountPaise, 20_000_00);

  // Fee plus a store portion: split as the voucher says.
  const split = allocateVoucherCash({
    cashSignedPaise: 20_000_00,
    heads: [
      { code: "4000", name: "Fee Income", scheduleGroup: "Fees", signedPaise: 17_000_00 },
      { code: "1040", name: "Store Receivable", scheduleGroup: "Current assets", signedPaise: 3_000_00 },
    ],
  });
  assert.equal(split.find((s) => s.code === "4000")!.amountPaise, 17_000_00);
  assert.equal(split.find((s) => s.code === "1040")!.amountPaise, 3_000_00);
  console.log("  ok  a receipt is attributed to the heads the voucher actually credited");
}

{
  // The case that separates a correct R&P from a plausible one. An expense of
  // 12,000 part-paid 5,000 in cash leaves 7,000 on credit. The payment is
  // 5,000 against the EXPENSE — the payable leg is a liability created, not
  // money paid, and attributing part of the cash to it would be wrong.
  const partPaid = allocateVoucherCash({
    cashSignedPaise: -5_000_00,
    heads: [
      { code: "5020", name: "Utilities", scheduleGroup: "Admin", signedPaise: -12_000_00 },
      { code: "2000", name: "Accounts Payable", scheduleGroup: "Current liabilities", signedPaise: 7_000_00 },
    ],
  });
  assert.equal(partPaid.length, 1, "only the head the cash actually went to");
  assert.equal(partPaid[0]!.code, "5020");
  assert.equal(partPaid[0]!.amountPaise, 5_000_00, "the whole payment, not a proportion of it");
  console.log("  ok  a part-paid expense attributes the cash to the expense, not to the payable it created");
}

{
  // Integer paise must not leak. Three equal heads against an amount that
  // does not divide by three.
  const rounded = allocateVoucherCash({
    cashSignedPaise: 100_00,
    heads: [
      { code: "A", name: "A", scheduleGroup: "G", signedPaise: 1 },
      { code: "B", name: "B", scheduleGroup: "G", signedPaise: 1 },
      { code: "C", name: "C", scheduleGroup: "G", signedPaise: 1 },
    ],
  });
  assert.equal(
    rounded.reduce((n, r) => n + r.amountPaise, 0),
    100_00,
    "the parts sum to exactly the cash that moved",
  );

  const odd = allocateVoucherCash({
    cashSignedPaise: 10_00,
    heads: [
      { code: "A", name: "A", scheduleGroup: "G", signedPaise: 700 },
      { code: "B", name: "B", scheduleGroup: "G", signedPaise: 300 },
    ],
  });
  assert.equal(odd.reduce((n, r) => n + r.amountPaise, 0), 10_00, "and again with uneven weights");
  assert.equal(allocateVoucherCash({ cashSignedPaise: 0, heads: [] }).length, 0, "no cash, no allocation");
  console.log("  ok  allocation never loses or invents a paisa to rounding");
}

{
  const rp = buildReceiptsPayments({
    from: "2026-08-01",
    to: "2026-08-31",
    openingCashPaise: 10_000_00,
    closingCashPaise: 10_000_00 + 20_000_00 - 5_000_00,
    movements: [
      { voucherId: "v1", voucherDate: "2026-08-05", voucherNo: "RC/1", narration: "Fees",
        cashSignedPaise: 20_000_00, headCode: "4000", headName: "Fee Income",
        headScheduleGroup: "Income from fees", headKind: "income", headSignedPaise: 20_000_00 },
      { voucherId: "v2", voucherDate: "2026-08-14", voucherNo: "PY/1", narration: "Power",
        cashSignedPaise: -5_000_00, headCode: "5020", headName: "Utilities",
        headScheduleGroup: "Administrative", headKind: "expense", headSignedPaise: -5_000_00 },
    ],
  });

  assert.equal(rp.totalReceiptsPaise, 20_000_00);
  assert.equal(rp.totalPaymentsPaise, 5_000_00);
  assert.equal(rp.computedClosingPaise, 25_000_00);
  assert.equal(rp.reconciles, true, "opening plus receipts less payments is the closing cash");

  const broken = buildReceiptsPayments({
    from: "2026-08-01", to: "2026-08-31",
    openingCashPaise: 10_000_00, closingCashPaise: 99_999_00,
    movements: [],
  });
  assert.equal(broken.reconciles, false, "and when it does not agree with the cash book, it says so");
  console.log("  ok  receipts & payments reconciles to the actual cash and bank balances");
}

{
  assert.equal(paiseToRupeeString(12_345_678), "123456.78");
  assert.equal(paiseToRupeeString(7), "0.07", "small amounts keep their paise");
  assert.equal(paiseToRupeeString(-50_050), "-500.50");
  assert.equal(paiseToRupeeString(0), "0.00");
  console.log("  ok  amounts export as rupees and paise without float drift");
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
