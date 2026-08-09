/**
 * Accounts — characterization harness.
 *
 * The accounts family (cash book, bank book, expense vouchers, vendor bills,
 * payables, owner loans, chart of accounts + journal, reports) is the finance
 * core, and had no test coverage until it was split out of one 4,500-line
 * file. This is what the split had to survive, and what any future change to
 * a posting path still has to: every path is exercised end to end and checked
 * against the one invariant that cannot be negotiated —
 *
 *     the books balance.
 *
 * Every scenario ends in `assertBooksBalance`, which re-checks that each
 * journal entry is internally balanced and that the whole trial balance nets
 * to zero. A misplaced debit/credit, a dropped `saveAccounts`, or a posting
 * that silently no-ops after a bad import will fail here rather than in
 * production a month later.
 *
 * Run: npx tsx src/lib/accounts.selftest.ts
 *
 * Minimal window/localStorage stubs let the browser-path code run under plain
 * Node (no jsdom). Imports hoist above this setup, so it is not the load order
 * that makes it safe — it is that nothing in the accounts graph reads these
 * globals at module scope. They are only ever touched inside functions, all of
 * which run after the stubs are in place.
 */
import assert from "node:assert/strict";

// isSupabaseConfigured() gates both the blob sync and the desk sync, and is
// read per call rather than at load, so clearing the env here is enough to
// keep saveAccounts() purely local instead of reaching the network.
delete process.env.NEXT_PUBLIC_SUPABASE_URL;
delete process.env.NEXT_PUBLIC_SUPABASE_ANON_KEY;
process.env.ACCOUNTS_DUAL_WRITE_DB = "false";

const store = new Map<string, string>();
(globalThis as Record<string, unknown>).window = globalThis;
// masters/rbac broadcast DOM events on save; nothing here listens, so a
// no-op keeps the browser path running under Node.
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
  bankBalancePaise,
  cashInHandPaise,
  postBankMovement,
  postCashMovement,
  recordBankDeposit,
  totalBankBalancePaise,
  transferCashBetweenPools,
} from "@/lib/accountsCashBank";
import {
  cancelExpenseVoucher,
  createExpenseVoucher,
} from "@/lib/accountsExpenseVouchers";
import {
  coaLedgerRows,
  listJournals,
  postJournal,
  setFiscalYearStatus,
  voidJournalEntry,
} from "@/lib/accountsJournal";
import { createOwnerLoan } from "@/lib/accountsLoans";
import { getCoaByCode } from "@/lib/accountsLookups";
import { listUnifiedPayables } from "@/lib/accountsPayables";
import { postFeeCollectionToAccounts } from "@/lib/accountsPostings";
import {
  balanceSheet,
  dashboardSnapshot,
  groupSummary,
  profitAndLoss,
  trialBalance,
} from "@/lib/accountsReports";
import {
  loadAccounts,
  seedAccountsIfEmpty,
} from "@/lib/accountsStore";
import {
  COA_ACCOUNTS_PAYABLE,
  COA_BANK_ACCOUNTS,
  COA_CASH_IN_HAND,
  COA_FEE_INCOME,
  COA_OWNER_LOANS,
  type AccountsState,
} from "@/lib/accountsTypes";
import {
  createVendorBill,
  upsertVendor,
  vendorOutstandingBalancePaise,
} from "@/lib/accountsVendors";

console.log("accounts.selftest.ts");

const TODAY = new Date().toISOString().slice(0, 10);

/* ─── Fixture helpers ──────────────────────────────────────── */

/** Wipe local state and re-seed, so each scenario starts from a known book. */
function freshBooks(): AccountsState {
  store.clear();
  const state = seedAccountsIfEmpty();
  assert.ok(state.coaAccounts.length > 0, "seed must install a chart of accounts");
  return state;
}

function poolByCode(code: "main" | "drawer" | "petty"): string {
  const pool = loadAccounts().cashPools.find((p) => p.code === code);
  assert.ok(pool, `seed must create the ${code} cash pool`);
  return pool.id;
}

function firstBankId(): string {
  const bank = loadAccounts().bankAccounts[0];
  assert.ok(bank, "seed must create one bank account");
  return bank.id;
}

function categoryIdByName(name: string): string {
  const cat = loadAccounts().expenseCategories.find((c) => c.name === name);
  assert.ok(cat, `seed must create the "${name}" expense category`);
  return cat.id;
}

/** Trial-balance row for a well-known COA code. */
function tbBalancePaise(code: string): number {
  const row = trialBalance(TODAY).find((r) => r.code === code);
  assert.ok(row, `trial balance must include COA ${code}`);
  return row.balancePaise;
}

/**
 * The load-bearing invariant. Two independent checks, because they fail
 * differently: a lopsided single entry means a posting built bad lines, while
 * a lopsided trial balance means entries were dropped or double-counted.
 */
function assertBooksBalance(label: string): void {
  const state = loadAccounts();

  for (const entry of state.journalEntries) {
    if (entry.voidedAt) continue;
    const debit = entry.lines.reduce((n, l) => n + l.debitPaise, 0);
    const credit = entry.lines.reduce((n, l) => n + l.creditPaise, 0);
    assert.equal(
      debit,
      credit,
      `${label}: journal ${entry.id} (${entry.sourceType || "manual"}) is unbalanced — Dr ${debit} vs Cr ${credit}`,
    );
  }

  const rows = trialBalance(TODAY, state);
  const totalDebit = rows.reduce((n, r) => n + r.debitPaise, 0);
  const totalCredit = rows.reduce((n, r) => n + r.creditPaise, 0);
  assert.equal(
    totalDebit,
    totalCredit,
    `${label}: trial balance does not net to zero — Dr ${totalDebit} vs Cr ${totalCredit}`,
  );
}

/**
 * The stronger check, for books built only from complete posting paths.
 *
 * postCashMovement/postBankMovement move the sub-ledger and nothing else —
 * the GL side is the caller's job. So the cash book agreeing with COA 1000,
 * and the bank book with COA 1010, is exactly the property that breaks if a
 * posting path loses its paired `postJournal`. That is the most likely way a
 * bad module split goes wrong, and it is invisible to a balance-only check.
 *
 * Only valid where every rupee entered the book through a path that posts
 * both sides; see the raw-movement scenario for the deliberate exception.
 */
function assertSubledgersTieToGl(label: string): void {
  const state = loadAccounts();
  const rows = trialBalance(TODAY, state);
  const glCash = rows.find((r) => r.code === COA_CASH_IN_HAND)?.balancePaise ?? 0;
  const glBank = rows.find((r) => r.code === COA_BANK_ACCOUNTS)?.balancePaise ?? 0;

  assert.equal(
    cashInHandPaise(state),
    glCash,
    `${label}: cash book (${cashInHandPaise(state)}) has drifted from GL cash (${glCash}) — a posting path lost its journal`,
  );
  assert.equal(
    totalBankBalancePaise(state),
    glBank,
    `${label}: bank book (${totalBankBalancePaise(state)}) has drifted from GL bank (${glBank}) — a posting path lost its journal`,
  );
  assert.equal(balanceSheet(TODAY, state).balanced, true, `${label}: balance sheet must tie`);
}

/* ─── Seed ─────────────────────────────────────────────────── */
{
  const state = freshBooks();

  assert.equal(state.cashPools.length, 3, "seed installs main/drawer/petty pools");
  assert.equal(state.bankAccounts.length, 1, "seed installs one bank account");
  assert.ok(state.expenseCategories.length >= 7, "seed installs expense categories");
  assert.equal(state.trustees.length, 1, "seed installs one trustee");
  assert.equal(state.fiscalYears.length, 1, "seed opens one fiscal year");
  assert.equal(state.fiscalYears[0]!.status, "open", "the seeded FY starts open");
  assert.equal(cashInHandPaise(state), 0, "a fresh book holds no cash");

  // Well-known codes the posting paths resolve by string — a rename here
  // silently turns postings into no-ops rather than errors.
  for (const code of [
    COA_CASH_IN_HAND,
    COA_BANK_ACCOUNTS,
    COA_ACCOUNTS_PAYABLE,
    COA_FEE_INCOME,
    COA_OWNER_LOANS,
  ]) {
    assert.ok(getCoaByCode(code, state), `seeded COA must include ${code}`);
  }

  // Seeding twice must not duplicate the chart of accounts.
  const again = seedAccountsIfEmpty();
  assert.equal(
    again.coaAccounts.length,
    state.coaAccounts.length,
    "re-seeding an existing book must be idempotent",
  );

  console.log("  ok  seed installs pools, bank, categories, COA, and one open FY");
}

/* ─── Cash movements ───────────────────────────────────────── */
{
  freshBooks();
  const drawer = poolByCode("drawer");
  const main = poolByCode("main");

  const inRes = postCashMovement({
    poolId: drawer,
    date: TODAY,
    direction: "in",
    amountPaise: 500_00,
    sourceType: "test_opening",
    narration: "Opening float",
  });
  assert.ok(inRes.ok, "cash in must succeed");
  assert.equal(inRes.pool.balancePaise, 500_00, "pool balance follows the movement");
  assert.equal(cashInHandPaise(), 500_00, "cash in hand sums every pool");

  // Overdrawing a pool is refused rather than allowed to go negative.
  const over = postCashMovement({
    poolId: drawer,
    date: TODAY,
    direction: "out",
    amountPaise: 900_00,
    sourceType: "test_overdraw",
  });
  assert.equal(over.ok, false, "a pool must not be overdrawn");
  assert.equal(cashInHandPaise(), 500_00, "a refused movement must not alter cash");

  // Zero/negative amounts are rejected.
  assert.equal(
    postCashMovement({ poolId: drawer, direction: "in", amountPaise: 0, sourceType: "t" }).ok,
    false,
    "a zero-amount movement is rejected",
  );

  const moved = transferCashBetweenPools({
    fromPoolId: drawer,
    toPoolId: main,
    amountPaise: 200_00,
    date: TODAY,
  });
  assert.ok(moved.ok, "pool-to-pool transfer must succeed");
  assert.equal(cashInHandPaise(), 500_00, "an internal transfer must not change total cash");

  const s = loadAccounts();
  assert.equal(
    s.cashPools.find((p) => p.id === drawer)!.balancePaise,
    300_00,
    "transfer debits the source pool",
  );
  assert.equal(
    s.cashPools.find((p) => p.id === main)!.balancePaise,
    200_00,
    "transfer credits the destination pool",
  );

  assertBooksBalance("cash movements");
  console.log("  ok  cash in/out, overdraw refusal, and pool transfer conserve cash");
}

/* ─── Bank deposit ─────────────────────────────────────────── */
{
  freshBooks();
  const drawer = poolByCode("drawer");
  const bank = firstBankId();

  postCashMovement({
    poolId: drawer,
    date: TODAY,
    direction: "in",
    amountPaise: 1_000_00,
    sourceType: "test_opening",
  });

  const dep = recordBankDeposit(drawer, bank, 400_00, TODAY);
  assert.ok(dep.ok, "bank deposit must succeed");

  assert.equal(cashInHandPaise(), 600_00, "deposit removes cash from the pool");
  assert.equal(bankBalancePaise(bank), 400_00, "deposit lands in the bank");
  assert.equal(totalBankBalancePaise(), 400_00, "total bank balance follows");

  // Contra entry: cash down, bank up, nothing hits income or expense.
  assert.equal(tbBalancePaise(COA_BANK_ACCOUNTS), 400_00, "Dr bank on deposit");
  assert.equal(tbBalancePaise(COA_CASH_IN_HAND), -400_00, "Cr cash on deposit");
  const pl = profitAndLoss("0001-01-01", TODAY);
  assert.equal(pl.netProfitPaise, 0, "a deposit is a contra entry, not income");

  assertBooksBalance("bank deposit");
  console.log("  ok  bank deposit moves cash to bank as a contra entry");
}

/* ─── Expense voucher, paid in cash ────────────────────────── */
{
  freshBooks();
  const drawer = poolByCode("drawer");
  const mess = categoryIdByName("Mess");

  // Fund through a complete posting path so the GL side exists too.
  postFeeCollectionToAccounts({
    voucherId: "v_fund_expense",
    collectionDate: TODAY,
    receiptNo: "RC-9000",
    tenders: [{ mode: "cash", amountPaise: 50_000_00 }],
  });

  const created = createExpenseVoucher({
    date: TODAY,
    categoryId: mess,
    amountPaise: 1_200_00,
    mode: "cash",
    poolId: drawer,
    paidPaise: 1_200_00,
    narration: "Kitchen provisions",
  });
  assert.ok(created.ok, `expense voucher must be created: ${created.ok ? "" : created.error}`);

  const voucher = loadAccounts().expenseVouchers.find((v) => v.id === created.voucher.id);
  assert.ok(voucher, "the voucher must be persisted");
  assert.equal(voucher.paymentStatus, "paid", "a fully paid cash voucher settles immediately");
  assert.equal(voucher.paidPaise, 1_200_00, "paid amount is recorded");
  assert.equal(voucher.duePaise, 0, "nothing remains due");

  assert.equal(cashInHandPaise(), 48_800_00, "payment leaves the cash pool");

  const plAfter = profitAndLoss("0001-01-01", TODAY);
  assert.equal(plAfter.totalExpensePaise, 1_200_00, "the expense hits P&L");
  assert.equal(plAfter.netProfitPaise, 48_800_00, "profit is the collection less the spend");

  assertBooksBalance("cash expense voucher");
  assertSubledgersTieToGl("cash expense voucher");

  // Cancelling must unwind both the cash and the GL side.
  const cancelled = cancelExpenseVoucher(voucher.id, "Duplicate entry");
  assert.ok(cancelled.ok, `cancel must succeed: ${cancelled.ok ? "" : cancelled.error}`);

  assert.equal(cashInHandPaise(), 50_000_00, "cancelling a paid voucher returns the cash");
  assert.equal(
    profitAndLoss("0001-01-01", TODAY).totalExpensePaise,
    0,
    "a cancelled voucher leaves no expense in P&L",
  );

  assertBooksBalance("cancelled expense voucher");
  assertSubledgersTieToGl("cancelled expense voucher");
  console.log("  ok  cash expense voucher pays, hits P&L, and fully unwinds on cancel");
}

/* ─── Expense voucher above the approval threshold ─────────── */
{
  freshBooks();
  const drawer = poolByCode("drawer");
  const office = categoryIdByName("Office");
  const threshold = loadAccounts().settings.expenseApprovalPaise;

  postFeeCollectionToAccounts({
    voucherId: "v_fund_threshold",
    collectionDate: TODAY,
    receiptNo: "RC-9001",
    tenders: [{ mode: "cash", amountPaise: threshold + 10_000_00 }],
  });
  const cashBefore = cashInHandPaise();

  const big = createExpenseVoucher({
    date: TODAY,
    categoryId: office,
    amountPaise: threshold + 1_00,
    mode: "cash",
    poolId: drawer,
    paidPaise: threshold + 1_00,
    narration: "Above threshold",
  });
  assert.ok(big.ok, "an over-threshold voucher is still created");
  assert.equal(
    big.voucher.paymentStatus,
    "pending_approval",
    "spend above the approval limit must park in pending_approval",
  );
  assert.equal(
    cashInHandPaise(),
    cashBefore,
    "an unapproved voucher must not disburse cash",
  );

  assertBooksBalance("pending-approval voucher");
  assertSubledgersTieToGl("pending-approval voucher");
  console.log("  ok  spend above the approval limit parks unpaid, holding the cash");
}

/* ─── Vendor bill → payable → AP ───────────────────────────── */
{
  freshBooks();

  const vendor = upsertVendor({ name: "Sharma Stationers", phone: "9990001111" });
  assert.ok(vendor.ok, "vendor must be created");

  const bill = createVendorBill({
    vendorId: vendor.vendor.id,
    billNo: "INV-2026-014",
    billDate: TODAY,
    dueOn: TODAY,
    amountPaise: 25_000_00,
    narration: "Exercise books",
  });
  assert.ok(bill.ok, `vendor bill must be created: ${bill.ok ? "" : bill.error}`);
  assert.equal(bill.bill.grandTotalPaise, 25_000_00, "bill total is recorded");

  assert.equal(
    vendorOutstandingBalancePaise(vendor.vendor.id),
    25_000_00,
    "an unpaid bill is outstanding against the vendor",
  );

  const payables = listUnifiedPayables();
  assert.equal(payables.length, 1, "the bill raises exactly one payable");
  assert.equal(payables[0]!.amountPaise, 25_000_00, "payable carries the bill amount");
  assert.equal(payables[0]!.status, "open", "a new payable is open");

  // Accrual, not payment: AP is credited and no cash has moved.
  assert.equal(tbBalancePaise(COA_ACCOUNTS_PAYABLE), 25_000_00, "Cr accounts payable");
  assert.equal(cashInHandPaise(), 0, "raising a bill must not move cash");

  const snap = dashboardSnapshot();
  assert.equal(snap.openApPaise, 25_000_00, "dashboard surfaces open AP");
  assert.equal(snap.cashInHandPaise, 0, "dashboard cash matches the cash book");

  assertBooksBalance("vendor bill");
  console.log("  ok  vendor bill accrues to AP without touching cash");
}

/* ─── Fee collection posting (the fees.ts hook) ────────────── */
{
  freshBooks();
  const bank = firstBankId();

  const posted = postFeeCollectionToAccounts({
    voucherId: "v_test_001",
    collectionDate: TODAY,
    receiptNo: "RC-0001",
    tenders: [
      { mode: "cash", amountPaise: 8_000_00 },
      { mode: "upi", amountPaise: 12_000_00, bankAccountId: bank, ref: "UPI-778899" },
    ],
  });
  assert.ok(posted.ok, "fee collection must post");
  assert.equal(posted.posted, true, "the first post is a real post");

  assert.equal(cashInHandPaise(), 8_000_00, "the cash tender lands in the drawer");
  assert.equal(bankBalancePaise(bank), 12_000_00, "the UPI tender lands in the bank");
  assert.equal(tbBalancePaise(COA_FEE_INCOME), 20_000_00, "the whole collection is fee income");

  const pl = profitAndLoss("0001-01-01", TODAY);
  assert.equal(pl.totalIncomePaise, 20_000_00, "fee income shows in P&L");
  assert.equal(pl.netProfitPaise, 20_000_00, "with no expense, income is the profit");

  assertBooksBalance("fee collection");

  // Idempotency by voucher id — fees.ts fires this from a floating promise,
  // so a retry or a double render must not double-count the money.
  const journalsBefore = loadAccounts().journalEntries.length;
  const again = postFeeCollectionToAccounts({
    voucherId: "v_test_001",
    collectionDate: TODAY,
    receiptNo: "RC-0001",
    tenders: [
      { mode: "cash", amountPaise: 8_000_00 },
      { mode: "upi", amountPaise: 12_000_00, bankAccountId: bank, ref: "UPI-778899" },
    ],
  });
  assert.ok(again.ok, "a repeat post must not error");
  assert.equal(again.posted, false, "a repeat post must report posted:false");
  assert.equal(cashInHandPaise(), 8_000_00, "a repeat post must not double the cash");
  assert.equal(bankBalancePaise(bank), 12_000_00, "a repeat post must not double the bank");
  assert.equal(
    loadAccounts().journalEntries.length,
    journalsBefore,
    "a repeat post must not add a journal entry",
  );

  assertBooksBalance("fee collection replay");
  assertSubledgersTieToGl("fee collection replay");
  console.log("  ok  fee collection splits tenders to cash/bank and is replay-safe");
}

/* ─── Fee collection with a store-dues portion ─────────────── */
{
  freshBooks();

  const posted = postFeeCollectionToAccounts({
    voucherId: "v_test_store",
    collectionDate: TODAY,
    receiptNo: "RC-0002",
    tenders: [{ mode: "cash", amountPaise: 10_000_00 }],
    storeAmountPaise: 3_000_00,
  });
  assert.ok(posted.ok, "mixed fee/store collection must post");

  assert.equal(
    tbBalancePaise(COA_FEE_INCOME),
    7_000_00,
    "only the non-store portion is fee income",
  );
  assert.equal(cashInHandPaise(), 10_000_00, "the full tender still lands in cash");

  assertBooksBalance("fee collection with store dues");
  assertSubledgersTieToGl("fee collection with store dues");
  console.log("  ok  the store portion settles receivables instead of fee income");
}

/* ─── Owner loan ───────────────────────────────────────────── */
{
  freshBooks();
  const main = poolByCode("main");
  const trustee = loadAccounts().trustees[0]!;

  const loan = createOwnerLoan({
    trusteeId: trustee.id,
    type: "working_capital",
    principalPaise: 10_00_000_00,
    ratePct: 12,
    tenureMonths: 24,
    startDate: TODAY,
    disburseToPoolId: main,
  });
  assert.ok(loan.ok, `owner loan must be created: ${loan.ok ? "" : loan.error}`);
  assert.equal(loan.schedule.length, 24, "the schedule has one row per month of tenure");
  assert.ok(loan.schedule[0]!.amountPaise > 0, "each installment carries an EMI amount");
  assert.ok(
    loan.schedule[0]!.dueOn > TODAY,
    "the first installment falls due after the start date",
  );

  assert.equal(cashInHandPaise(), 10_00_000_00, "disbursement raises cash");
  assert.equal(tbBalancePaise(COA_OWNER_LOANS), 10_00_000_00, "the loan is a liability");

  const bs = balanceSheet(TODAY);
  assert.equal(bs.balanced, true, "the balance sheet ties after a disbursement");
  assert.equal(bs.assets.cashPaise, 10_00_000_00, "cash shows on the asset side");
  assert.equal(bs.liabilities.totalPaise, 10_00_000_00, "the loan shows on the liability side");

  assertBooksBalance("owner loan");
  assertSubledgersTieToGl("owner loan");
  console.log("  ok  owner loan disburses to cash and books the matching liability");
}

/* ─── Raw movements are sub-ledger only (characterized) ────── */
{
  freshBooks();
  const bank = firstBankId();

  postFeeCollectionToAccounts({
    voucherId: "v_raw",
    collectionDate: TODAY,
    receiptNo: "RC-9002",
    tenders: [{ mode: "neft", amountPaise: 30_000_00, bankAccountId: bank, ref: "N-1" }],
  });
  assertSubledgersTieToGl("before raw movement");

  // postBankMovement moves the bank book and posts NO journal — the GL side
  // belongs to the caller. This is current, deliberate behaviour: the wrapper
  // paths (deposits, expense payments, loan disbursement) always pair the two.
  // Pinned here so the split cannot quietly add or drop a journal on the
  // primitive without this test saying so.
  const moved = postBankMovement({
    bankId: bank,
    date: TODAY,
    direction: "cr",
    amountPaise: 5_000_00,
    mode: "neft",
    sourceType: "test_raw_movement",
    narration: "Unpaired outflow",
    transactionRef: "N-2",
  });
  assert.ok(moved.ok, "a raw bank movement succeeds");

  assert.equal(totalBankBalancePaise(), 25_000_00, "the bank book follows the movement");
  assert.equal(
    trialBalance(TODAY).find((r) => r.code === COA_BANK_ACCOUNTS)!.balancePaise,
    30_000_00,
    "the GL does not move on its own — the primitive posts no journal",
  );
  assert.equal(
    balanceSheet(TODAY).balanced,
    false,
    "an unpaired raw movement leaves the balance sheet untied, by design",
  );

  // The journals that do exist are still internally sound.
  assertBooksBalance("raw movement");
  console.log("  ok  raw cash/bank movements are sub-ledger only, GL is the caller's job");
}

/* ─── Journal, ledger, and void ────────────────────────────── */
{
  freshBooks();
  const cash = getCoaByCode(COA_CASH_IN_HAND)!;
  const income = getCoaByCode(COA_FEE_INCOME)!;

  const unbalanced = postJournal({
    date: TODAY,
    narration: "Deliberately lopsided",
    lines: [
      { coaId: cash.id, debitPaise: 100_00, creditPaise: 0, narration: "" },
      { coaId: income.id, debitPaise: 0, creditPaise: 90_00, narration: "" },
    ],
  });
  assert.equal(unbalanced.ok, false, "an unbalanced journal must be refused");

  const jv = postJournal({
    date: TODAY,
    voucherNo: "JV-001",
    narration: "Donation received",
    lines: [
      { coaId: cash.id, debitPaise: 100_00, creditPaise: 0, narration: "" },
      { coaId: income.id, debitPaise: 0, creditPaise: 100_00, narration: "" },
    ],
  });
  assert.ok(jv.ok, "a balanced journal posts");
  assert.ok(jv.entry.fiscalYearCode, "the entry is stamped with the open fiscal year");

  assert.equal(listJournals().length, 1, "the entry is listed");

  const rows = coaLedgerRows(cash.id, "0001-01-01", TODAY);
  assert.equal(rows.length, 1, "the ledger shows one line for the cash account");

  const summary = groupSummary(TODAY);
  assert.equal(summary.length, 5, "group summary covers all five COA groups");
  assert.equal(
    summary.find((g) => g.group === "income")!.balancePaise,
    100_00,
    "the income group picks up the posting",
  );
  assert.equal(
    summary.find((g) => g.group === "assets")!.balancePaise,
    100_00,
    "the asset group picks up the matching debit",
  );

  // Voiding excludes the entry from the trial balance without deleting it.
  const voided = voidJournalEntry(jv.entry.id, "Posted in error");
  assert.ok(voided.ok, "a journal entry can be voided");
  assert.equal(tbBalancePaise(COA_FEE_INCOME), 0, "a voided entry drops out of the TB");
  assert.equal(
    loadAccounts().journalEntries.length,
    1,
    "voiding must not delete the audit trail",
  );

  assertBooksBalance("journal void");
  console.log("  ok  journals reject imbalance, stamp the FY, and void without deletion");
}

/* ─── Closed fiscal year blocks posting ────────────────────── */
{
  freshBooks();
  const cash = getCoaByCode(COA_CASH_IN_HAND)!;
  const income = getCoaByCode(COA_FEE_INCOME)!;
  const fy = loadAccounts().fiscalYears[0]!;

  const closed = setFiscalYearStatus(fy.code, "closed");
  assert.ok(closed.ok, "a fiscal year can be closed");

  const blocked = postJournal({
    date: TODAY,
    narration: "Late entry",
    lines: [
      { coaId: cash.id, debitPaise: 100_00, creditPaise: 0, narration: "" },
      { coaId: income.id, debitPaise: 0, creditPaise: 100_00, narration: "" },
    ],
  });
  assert.equal(blocked.ok, false, "a closed fiscal year must refuse new journals");

  const reopened = setFiscalYearStatus(fy.code, "open");
  assert.ok(reopened.ok, "a fiscal year can be reopened");
  const allowed = postJournal({
    date: TODAY,
    narration: "After reopen",
    lines: [
      { coaId: cash.id, debitPaise: 100_00, creditPaise: 0, narration: "" },
      { coaId: income.id, debitPaise: 0, creditPaise: 100_00, narration: "" },
    ],
  });
  assert.ok(allowed.ok, "reopening lets journals post again");

  assertBooksBalance("closed fiscal year");
  console.log("  ok  a closed fiscal year refuses journals until reopened");
}

/* ─── Full mixed book ties out ─────────────────────────────── */
{
  freshBooks();
  const drawer = poolByCode("drawer");
  const bank = firstBankId();
  const mess = categoryIdByName("Mess");

  postFeeCollectionToAccounts({
    voucherId: "v_mixed_1",
    collectionDate: TODAY,
    receiptNo: "RC-0100",
    tenders: [
      { mode: "cash", amountPaise: 60_000_00 },
      { mode: "neft", amountPaise: 40_000_00, bankAccountId: bank, ref: "NEFT-1" },
    ],
  });

  // Under settings.expenseApprovalPaise, so it disburses without approval.
  createExpenseVoucher({
    date: TODAY,
    categoryId: mess,
    amountPaise: 8_000_00,
    mode: "cash",
    poolId: drawer,
    paidPaise: 8_000_00,
    narration: "Provisions",
  });

  const vendor = upsertVendor({ name: "Rao Traders" });
  assert.ok(vendor.ok);
  createVendorBill({
    vendorId: vendor.vendor.id,
    billNo: "RT-9",
    billDate: TODAY,
    amountPaise: 8_000_00,
  });

  recordBankDeposit(drawer, bank, 20_000_00, TODAY);

  // Cash: +60,000 fee − 8,000 expense − 20,000 deposit = 32,000
  assert.equal(cashInHandPaise(), 32_000_00, "cash ties across every posting path");
  // Bank: +40,000 fee + 20,000 deposit = 60,000
  assert.equal(totalBankBalancePaise(), 60_000_00, "bank ties across every posting path");

  const bs = balanceSheet(TODAY);
  assert.equal(bs.balanced, true, "the mixed book's balance sheet ties");
  assert.equal(bs.assets.cashPaise, 32_000_00, "balance sheet cash matches the cash book");
  assert.equal(bs.assets.bankPaise, 60_000_00, "balance sheet bank matches the bank book");
  assert.equal(bs.liabilities.totalPaise, 8_000_00, "the unpaid vendor bill is the liability");

  const pl = profitAndLoss("0001-01-01", TODAY);
  assert.equal(
    pl.netProfitPaise,
    pl.totalIncomePaise - pl.totalExpensePaise,
    "net profit is income less expense",
  );

  assertBooksBalance("mixed book");
  assertSubledgersTieToGl("mixed book");
  console.log("  ok  a mixed book of fees, expenses, bills, and transfers ties out");
}

console.log("\nAll accounts checks passed.");

// The persistence layer's dynamic import may still hold a scheduled timer.
// Nothing above depends on it, so exit rather than wait it out.
process.exit(0);
