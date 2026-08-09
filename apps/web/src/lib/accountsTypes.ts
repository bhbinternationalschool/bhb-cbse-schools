/**
 * Accounts — shared shapes and well-known codes.
 *
 * The leaf of the accounts module graph: types, the literal-union constant
 * arrays they derive from, and the chart-of-accounts codes the posting paths
 * resolve by string. No imports, no behaviour — everything else in the
 * accounts family depends on this file, so it must never depend back.
 *
 * Everything is denominated in paise (integer) to avoid float drift.
 *
 * ─── The accounts family ─────────────────────────────────────
 *
 * Cash book, bank book, expenses/vendors, payables, owner loans, chart of
 * accounts + journal, and financial reports. Was one 4,500-line file; split
 * into the modules below, each of which may only reach downward:
 *
 *   accountsTypes         shapes, COA codes         (this file, no imports)
 *   accountsUtil          id / dates / fail
 *   accountsNormalize     defaults, field repair
 *   accountsStore         load / save / seed        (owns the storage key)
 *   accountsLookups       resolvers over the book
 *   accountsJournal       the general ledger
 *   accountsCoa           chart-of-accounts admin
 *   accountsCashBank      cash + bank sub-ledgers
 *   accountsVendors       vendors, bills, allocation
 *   accountsExpense*      categories, vouchers, recurring rules
 *   accountsPayables      unified payables
 *   accountsLoans         trustees + owner loans
 *   accountsReports       TB / P&L / balance sheet / dashboard
 *   accountsPostings      fee, store, day-close, recon
 *   accountsCapex         trust CWIP + capitalisation
 *
 * Import the module you need directly. There is deliberately no barrel: one
 * would invite a submodule to import it and close a cycle, which surfaces as
 * an undefined function at call time rather than as a type error.
 *
 * accounts.selftest.ts covers the family end to end and is the thing to run
 * after touching any posting path — `npm run test:accounts`.
 */

/* ─── Cash book ────────────────────────────────────────────── */

export type CashPoolCode = "main" | "drawer" | "petty";

export type CashPool = {
  id: string;
  code: CashPoolCode;
  name: string;
  balancePaise: number;
};

export type CashDirection = "in" | "out";

export type CashLedgerEntry = {
  id: string;
  poolId: string;
  date: string;
  direction: CashDirection;
  amountPaise: number;
  sourceType: string;
  sourceId: string;
  narration: string;
  /** UTR / receipt no. / txn id — required for audit trail */
  transactionRef: string;
  runningBalancePaise: number;
  createdAt: string;
  /** Set when payment/receipt is cancelled. */
  voidedAt: string | null;
  cancelReason: string;
};

/* ─── Bank book ────────────────────────────────────────────── */

export type BankAccount = {
  id: string;
  name: string;
  bankName: string;
  accountNo: string;
  ifsc: string;
  openingBalancePaise: number;
  isActive: boolean;
  /** UPI, RTGS, NEFT, cheque, card — for collections & expense payments. */
  paymentModes: PaymentMode[];
};

export type BankDirection = "dr" | "cr";

export type PaymentMode =
  | "cash"
  | "upi"
  | "cheque"
  | "neft"
  | "rtgs"
  | "card";

/** Non-cash modes configurable on bank accounts. */
export const BANK_PAYMENT_MODES: PaymentMode[] = [
  "upi",
  "rtgs",
  "neft",
  "cheque",
  "card",
];

export const BANK_PAYMENT_MODE_LABELS: Record<PaymentMode, string> = {
  cash: "Cash",
  upi: "UPI",
  rtgs: "RTGS",
  neft: "NEFT",
  cheque: "Cheque",
  card: "Card",
};

export type BankLedgerEntry = {
  id: string;
  bankId: string;
  date: string;
  direction: BankDirection;
  amountPaise: number;
  mode: PaymentMode;
  sourceType: string;
  sourceId: string;
  narration: string;
  /** UTR / cheque no. / txn id */
  transactionRef: string;
  createdAt: string;
  voidedAt: string | null;
  cancelReason: string;
};

export type ExpensePaymentSplit = {
  id: string;
  mode: PaymentMode;
  amountPaise: number;
  poolId: string;
  bankId: string;
  transactionRef: string;
};

export type SessionExpenseCategoryRow = {
  categoryId: string;
  subcategoryId: string;
  categoryName: string;
  subcategoryName: string;
  amountPaise: number;
};

export type ModeBankMapEntry = {
  mode: PaymentMode;
  bankId: string;
};

export type ReconLineStatus = "matched" | "unmatched" | "ignored";

export type ReconSessionLine = {
  id: string;
  date: string;
  amountPaise: number;
  narration: string;
  status: ReconLineStatus;
  matchedLedgerId: string;
};

export type ReconSession = {
  id: string;
  bankId: string;
  asOf: string;
  createdAt: string;
  note: string;
  lines: ReconSessionLine[];
};

/* ─── Expenses ─────────────────────────────────────────────── */

export type ExpenseCategory = {
  id: string;
  parentId: string;
  name: string;
  coaCode: string;
  isActive: boolean;
  /** Vendors linked for optional selection on expense entry. */
  vendorIds: string[];
};

export type ExpensePaymentStatus =
  | "draft"
  | "pending_approval"
  | "partial"
  | "paid"
  | "void"
  | "cancelled";

export type ExpenseVoucherLine = {
  id: string;
  categoryId: string;
  subcategoryId: string;
  /** Optional vendor chosen on expense entry when category links vendors. */
  vendorId: string;
  description: string;
  amountPaise: number;
  taxPaise: number;
  totalPaise: number;
  paidPaise: number;
  duePaise: number;
};

export type ExpenseVoucher = {
  id: string;
  voucherNo: string;
  date: string;
  categoryId: string;
  vendorId: string;
  /** Legacy header amount (= grandTotalPaise). */
  amountPaise: number;
  taxPaise: number;
  grandTotalPaise: number;
  paidPaise: number;
  duePaise: number;
  lines: ExpenseVoucherLine[];
  mode: PaymentMode;
  paymentStatus: ExpensePaymentStatus;
  paidOn: string;
  bankId: string;
  poolId: string;
  narration: string;
  /** Payment splits when multiple modes used (cash + UPI, etc.) */
  paymentSplits: ExpensePaymentSplit[];
  approvedBy: string;
  createdAt: string;
  cancelledAt: string | null;
  cancelledBy: string;
  cancelReason: string;
};

export type RecurringExpenseRule = {
  id: string;
  categoryId: string;
  vendorId: string;
  amountPaise: number;
  mode: PaymentMode;
  dayOfMonth: number;
  isActive: boolean;
  lastGeneratedOn: string;
  narration: string;
};

/* ─── Vendors / bills / payables ──────────────────────────── */

export type AccountsVendor = {
  id: string;
  name: string;
  type: string;
  phone: string;
  gstin: string;
  isActive: boolean;
};

export type VendorBillStatus = "open" | "partial" | "paid";

export const VENDOR_BILL_UNITS = [
  "pcs",
  "lt",
  "kg",
  "feet",
  "mtr",
  "box",
  "bag",
  "set",
  "other",
] as const;

export type VendorBillUnit = (typeof VENDOR_BILL_UNITS)[number];

export type VendorBillLine = {
  id: string;
  /** Line date (defaults to bill date when empty). */
  lineDate: string;
  /** Item / service name. */
  itemName: string;
  /** Legacy alias for itemName. */
  description: string;
  qty: number;
  unit: VendorBillUnit | string;
  ratePaise: number;
  /** Line discount in paise. */
  discountPaise: number;
  /** Line tax in paise. */
  taxPaise: number;
  /** Net line total: (qty × rate) − discount + tax. */
  amountPaise: number;
  /** Purchase ledger selection (mapped to an expense category / COA bucket). */
  categoryId: string;
};

export type VendorBill = {
  id: string;
  vendorId: string;
  /** GRN / receipt number (as per ERP UX). */
  receiptNo: string;
  /** Supplier invoice number. */
  billNo: string;
  /** Alias field for clarity when the bill was created from GRN. */
  supplierInvoiceNo: string;
  billDate: string;
  dueOn: string;
  /** Grand total (grandTotalPaise stored under legacy `amountPaise`). */
  amountPaise: number;
  /** Legacy single-category support (derived from the first line). */
  categoryId: string;
  discountType: "none" | "percent" | "amount";
  discountPaise: number;
  taxPaise: number;
  grandTotalPaise: number;
  lines: VendorBillLine[];
  status: VendorBillStatus;
  paidPaise: number;
  narration: string;
  attachmentNote: string;
};

export type PayableSourceType = "expense_bill" | "transport_fleet" | "other";
export type PayableStatus = "open" | "partial" | "paid";

export type AccountsPayable = {
  id: string;
  vendorId: string;
  sourceType: PayableSourceType;
  sourceId: string;
  amountPaise: number;
  dueOn: string;
  status: PayableStatus;
  paidPaise: number;
  paidOn: string;
  note: string;
};

/* ─── Owner / trustee loans ────────────────────────────────── */

export type Trustee = {
  id: string;
  name: string;
  phone: string;
  isActive: boolean;
};

export type OwnerLoanType = "working_capital" | "vehicle" | "capex";
export type OwnerLoanStatus = "open" | "closed";

export type OwnerLoan = {
  id: string;
  trusteeId: string;
  type: OwnerLoanType;
  principalPaise: number;
  ratePct: number;
  tenureMonths: number;
  startDate: string;
  status: OwnerLoanStatus;
  note: string;
};

export type OwnerLoanRowStatus = "due" | "paid" | "waived";

export type OwnerLoanScheduleRow = {
  id: string;
  loanId: string;
  installmentNo: number;
  dueOn: string;
  amountPaise: number;
  status: OwnerLoanRowStatus;
  paidOn: string;
  paidAmountPaise: number;
};

export type OwnerCashHandover = {
  id: string;
  date: string;
  amountPaise: number;
  fromPoolId: string;
  handedBy: string;
  receivedBy: string;
  purpose: string;
  note: string;
};

/* ─── Chart of accounts + journal ─────────────────────────── */

export type CoaGroup = "assets" | "liabilities" | "income" | "expense" | "equity";

export type CoaAccount = {
  id: string;
  code: string;
  name: string;
  group: CoaGroup;
  isActive: boolean;
};

export type JournalLine = {
  coaId: string;
  debitPaise: number;
  creditPaise: number;
  narration: string;
};

export type JournalEntry = {
  id: string;
  date: string;
  voucherNo: string;
  narration: string;
  lines: JournalLine[];
  sourceType: string;
  sourceId: string;
  fiscalYearCode: string;
  createdAt: string;
  voidedAt: string | null;
  cancelReason: string;
};

export type FiscalYearStatus = "open" | "closed";

export type FiscalYear = {
  code: string;
  label: string;
  startDate: string;
  endDate: string;
  status: FiscalYearStatus;
};

/* ─── Settings + state ────────────────────────────────────── */

export type AccountsSettings = {
  expenseApprovalPaise: number;
  pettyThresholdPaise: number;
};

export type AccountsState = {
  version: 1;
  cashPools: CashPool[];
  cashLedger: CashLedgerEntry[];
  bankAccounts: BankAccount[];
  bankLedger: BankLedgerEntry[];
  modeBankMap: ModeBankMapEntry[];
  reconSessions: ReconSession[];
  expenseCategories: ExpenseCategory[];
  expenseVouchers: ExpenseVoucher[];
  recurringRules: RecurringExpenseRule[];
  vendors: AccountsVendor[];
  vendorBills: VendorBill[];
  payables: AccountsPayable[];
  trustees: Trustee[];
  ownerLoans: OwnerLoan[];
  ownerLoanSchedule: OwnerLoanScheduleRow[];
  ownerCashHandovers: OwnerCashHandover[];
  coaAccounts: CoaAccount[];
  journalEntries: JournalEntry[];
  fiscalYears: FiscalYear[];
  settings: AccountsSettings;
};

/* ─── COA codes (well-known) ──────────────────────────────── */

export const COA_CASH_IN_HAND = "1000";
export const COA_BANK_ACCOUNTS = "1010";
export const COA_CWIP = "1020";
export const COA_FIXED_ASSETS = "1030";
/** Student / parent store credit receivables. */
export const COA_ACCOUNTS_RECEIVABLE = "1040";
export const COA_ACCOUNTS_PAYABLE = "2000";
export const COA_OWNER_LOANS = "2100";
export const COA_RETENTION_PAYABLE = "2200";
export const COA_CAPITAL_EQUITY = "3000";
export const COA_FEE_INCOME = "4000";
export const COA_OTHER_INCOME = "4100";
/** Store / books / uniform sales income. */
export const COA_STORE_SALES = "4200";
export const COA_EXP_MESS = "5000";
export const COA_EXP_MILK = "5010";
export const COA_EXP_UTILITIES = "5020";
export const COA_EXP_TRANSPORT_BATTA = "5030";
export const COA_EXP_OFFICE = "5040";
export const COA_EXP_ACADEMIC = "5050";
/** Purchases for store / inventory (GRN / vendor bills). */
export const COA_STORE_PURCHASES = "5060";
export const COA_EXP_OTHER = "5900";

export type AccountsRemovalCheck = {
  canRemove: boolean;
  blockers: string[];
  suggestion: string;
  confirmMessage: string;
};

