/**
 * The accounts lists saved row by row with stamps (rowStampClient /
 * rowStampWrite.server), and the table each lives in. Shared by the browser
 * and the server so both name the same lists.
 *
 * Lines (journal, expense voucher, vendor bill, reconciliation) are not here:
 * they belong to their parent and are written only when the parent's save
 * lands. The payment-mode map and settings have no row id and are handled on
 * their own.
 */

export const ACCOUNTS_STAMPED_TABLES = {
  cashPools: "accounts_desk_cash_pools",
  cashLedger: "accounts_desk_cash_ledger",
  bankAccounts: "accounts_desk_bank_accounts",
  bankLedger: "accounts_desk_bank_ledger",
  reconSessions: "accounts_desk_recon_sessions",
  expenseCategories: "accounts_desk_expense_categories",
  expenseVouchers: "accounts_desk_expense_vouchers",
  recurringRules: "accounts_desk_recurring_rules",
  vendors: "accounts_desk_vendors",
  vendorBills: "accounts_desk_vendor_bills",
  payables: "accounts_desk_payables",
  trustees: "accounts_desk_trustees",
  ownerLoans: "accounts_desk_owner_loans",
  ownerLoanSchedule: "accounts_desk_owner_loan_schedule",
  ownerCashHandovers: "accounts_desk_owner_cash_handovers",
  coaAccounts: "accounts_desk_coa_accounts",
  journalEntries: "accounts_desk_journal_entries",
  fiscalYears: "accounts_desk_fiscal_years",
} as const;

export type AccountsStampedSlice = keyof typeof ACCOUNTS_STAMPED_TABLES;

export const ACCOUNTS_STAMPED_SLICES = Object.keys(
  ACCOUNTS_STAMPED_TABLES,
) as AccountsStampedSlice[];
