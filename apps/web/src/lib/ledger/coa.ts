/**
 * Ledger v2 — the chart of accounts the school actually reports on.
 *
 * The desk's chart is 20 flat codes chosen to make the app's postings work.
 * That is enough to run a cash book and nowhere near enough to produce the
 * statements a trust is audited on: it has no receivable for fee demand, no
 * statutory liabilities, no depreciation, no way to group ledgers into the
 * lines of a Balance Sheet or an Income & Expenditure account.
 *
 * This chart is a superset. Every desk code keeps its meaning and its number,
 * so the adapter can map a desk journal straight across by code, and the new
 * accounts sit alongside for the things P2–P4 will post.
 *
 * `scheduleGroup` is the line of the audited statements an account rolls into.
 * Carrying it here means the Form 10B / Receipts & Payments pack is generated
 * from the book rather than from a spreadsheet the CA re-maps every March.
 */

import type { LedgerAccountSeed } from "@/lib/ledger/types";

/* Codes the desk already posts to — these must not change. */
export const L_CASH = "1000";
export const L_BANK = "1010";
export const L_CWIP = "1020";
export const L_FIXED_ASSETS = "1030";
export const L_STORE_RECEIVABLE = "1040";
export const L_CHEQUES_IN_HAND = "1050";
export const L_ACCOUNTS_PAYABLE = "2000";
export const L_OWNER_LOANS = "2100";
export const L_RETENTION_PAYABLE = "2200";
/** Fees collected before the session they belong to begins. */
export const L_FEE_ADVANCES = "2400";
export const L_CORPUS = "3000";
export const L_FEE_INCOME = "4000";
export const L_OTHER_INCOME = "4100";
export const L_STORE_SALES = "4200";

/* New in v2 — what the desk chart cannot express. */
export const L_FEE_RECEIVABLE = "1060";
export const L_STAFF_ADVANCES = "1070";
export const L_ACCUM_DEPRECIATION = "1035";
export const L_SALARY_PAYABLE = "2110";
export const L_STATUTORY_PAYABLE = "2300";
export const L_TDS_PAYABLE = "2310";
export const L_PF_PAYABLE = "2320";
export const L_ESI_PAYABLE = "2330";
export const L_GST_INPUT = "1080";
/** Stock on hand. Perpetual: moved by every receipt, sale and write-off. */
export const L_INVENTORY = "1090";
/** GST charged on sales — owed to the government, not income. */
export const L_GST_OUTPUT = "2340";
export const L_FEE_CONCESSION = "5100";
export const L_DEPRECIATION = "5200";
/** What the goods sold actually cost — the other half of a sale. */
export const L_COGS = "5065";
/** Stock lost to damage, shrinkage or a corrected count. */
export const L_STOCK_WRITTEN_OFF = "5066";

export const SCHEDULE_GROUPS = {
  currentAssets: "Current assets",
  fixedAssets: "Fixed assets",
  currentLiabilities: "Current liabilities",
  loans: "Loans & borrowings",
  corpus: "Corpus & funds",
  feeIncome: "Income from fees",
  otherIncome: "Other income",
  establishment: "Establishment expenses",
  academic: "Academic expenses",
  administrative: "Administrative expenses",
  depreciation: "Depreciation",
} as const;

const G = SCHEDULE_GROUPS;

/**
 * The default chart. Parents are groups, not postable in themselves — the
 * hierarchy exists so statements can roll up without a mapping table.
 */
export function defaultLedgerAccounts(): LedgerAccountSeed[] {
  return [
    /* ─── Assets ─────────────────────────────────────────── */
    { code: "1", name: "Assets", kind: "asset", scheduleGroup: "" },

    { code: L_CASH, name: "Cash in Hand", kind: "asset", parentCode: "1", scheduleGroup: G.currentAssets, isCash: true },
    { code: L_BANK, name: "Bank Accounts", kind: "asset", parentCode: "1", scheduleGroup: G.currentAssets, isBank: true },
    { code: L_CHEQUES_IN_HAND, name: "Cheques in Hand", kind: "asset", parentCode: "1", scheduleGroup: G.currentAssets },
    { code: L_STORE_RECEIVABLE, name: "Store Receivable", kind: "asset", parentCode: "1", scheduleGroup: G.currentAssets, isControl: true },
    { code: L_FEE_RECEIVABLE, name: "Fee Receivable", kind: "asset", parentCode: "1", scheduleGroup: G.currentAssets, isControl: true },
    { code: L_STAFF_ADVANCES, name: "Staff Advances", kind: "asset", parentCode: "1", scheduleGroup: G.currentAssets, isControl: true },
    { code: L_GST_INPUT, name: "GST Input Credit", kind: "asset", parentCode: "1", scheduleGroup: G.currentAssets },
    // Perpetual inventory: goods are capitalised here when received and
    // relieved as they are sold or written off, so this balance tracks the
    // store's own valuation continuously rather than only at a period end.
    { code: L_INVENTORY, name: "Inventory", kind: "asset", parentCode: "1", scheduleGroup: G.currentAssets },

    { code: L_CWIP, name: "Capital Work in Progress", kind: "asset", parentCode: "1", scheduleGroup: G.fixedAssets },
    { code: L_FIXED_ASSETS, name: "Fixed Assets", kind: "asset", parentCode: "1", scheduleGroup: G.fixedAssets },
    { code: L_ACCUM_DEPRECIATION, name: "Accumulated Depreciation", kind: "asset", parentCode: "1", scheduleGroup: G.fixedAssets },

    /* ─── Liabilities ────────────────────────────────────── */
    { code: "2", name: "Liabilities", kind: "liability", scheduleGroup: "" },

    { code: L_ACCOUNTS_PAYABLE, name: "Accounts Payable", kind: "liability", parentCode: "2", scheduleGroup: G.currentLiabilities, isControl: true },
    { code: L_FEE_ADVANCES, name: "Fees Received in Advance", kind: "liability", parentCode: "2", scheduleGroup: G.currentLiabilities },
    { code: L_SALARY_PAYABLE, name: "Salary Payable", kind: "liability", parentCode: "2", scheduleGroup: G.currentLiabilities, isControl: true },
    { code: L_STATUTORY_PAYABLE, name: "Statutory Dues", kind: "liability", parentCode: "2", scheduleGroup: G.currentLiabilities },
    { code: L_TDS_PAYABLE, name: "TDS Payable", kind: "liability", parentCode: L_STATUTORY_PAYABLE, scheduleGroup: G.currentLiabilities },
    { code: L_PF_PAYABLE, name: "Provident Fund Payable", kind: "liability", parentCode: L_STATUTORY_PAYABLE, scheduleGroup: G.currentLiabilities },
    { code: L_ESI_PAYABLE, name: "ESI Payable", kind: "liability", parentCode: L_STATUTORY_PAYABLE, scheduleGroup: G.currentLiabilities },
    // GST collected on store sales sits beside TDS/PF/ESI: money held for the
    // government, not the school's income. Added for the store rebuild's
    // native posting; the input-credit side (1080) already existed.
    { code: L_GST_OUTPUT, name: "GST Payable", kind: "liability", parentCode: L_STATUTORY_PAYABLE, scheduleGroup: G.currentLiabilities },
    { code: L_RETENTION_PAYABLE, name: "Retention Payable", kind: "liability", parentCode: "2", scheduleGroup: G.currentLiabilities },
    { code: L_OWNER_LOANS, name: "Owner / Trustee Loans", kind: "liability", parentCode: "2", scheduleGroup: G.loans, isControl: true },

    /* ─── Corpus ─────────────────────────────────────────── */
    { code: "3", name: "Corpus & Funds", kind: "equity", scheduleGroup: "" },
    { code: L_CORPUS, name: "Corpus / Trust Fund", kind: "equity", parentCode: "3", scheduleGroup: G.corpus },

    /* ─── Income ─────────────────────────────────────────── */
    { code: "4", name: "Income", kind: "income", scheduleGroup: "" },
    { code: L_FEE_INCOME, name: "Fee Income", kind: "income", parentCode: "4", scheduleGroup: G.feeIncome },
    { code: L_OTHER_INCOME, name: "Other Income", kind: "income", parentCode: "4", scheduleGroup: G.otherIncome },
    { code: L_STORE_SALES, name: "Store Sales Income", kind: "income", parentCode: "4", scheduleGroup: G.otherIncome },

    /* ─── Expenses ───────────────────────────────────────── */
    { code: "5", name: "Expenditure", kind: "expense", scheduleGroup: "" },
    { code: "5000", name: "Mess Expenses", kind: "expense", parentCode: "5", scheduleGroup: G.administrative },
    { code: "5010", name: "Milk Expenses", kind: "expense", parentCode: "5", scheduleGroup: G.administrative },
    { code: "5020", name: "Utilities Expenses", kind: "expense", parentCode: "5", scheduleGroup: G.administrative },
    { code: "5030", name: "Transport Batta Expenses", kind: "expense", parentCode: "5", scheduleGroup: G.administrative },
    { code: "5040", name: "Office Expenses", kind: "expense", parentCode: "5", scheduleGroup: G.administrative },
    { code: "5050", name: "Academic Expenses", kind: "expense", parentCode: "5", scheduleGroup: G.academic },
    // Store goods no longer land here — they are capitalised to Inventory and
    // released through Cost of Goods Sold. Kept for expense vouchers coded to
    // it by hand, and for history.
    { code: "5060", name: "Store Purchases", kind: "expense", parentCode: "5", scheduleGroup: G.administrative },
    { code: L_COGS, name: "Cost of Goods Sold", kind: "expense", parentCode: "5", scheduleGroup: G.administrative },
    { code: L_STOCK_WRITTEN_OFF, name: "Stock Written Off", kind: "expense", parentCode: "5", scheduleGroup: G.administrative },
    { code: "5070", name: "Salary & Wages", kind: "expense", parentCode: "5", scheduleGroup: G.establishment },
    { code: L_FEE_CONCESSION, name: "Fee Concessions & RTE", kind: "expense", parentCode: "5", scheduleGroup: G.feeIncome },
    { code: L_DEPRECIATION, name: "Depreciation", kind: "expense", parentCode: "5", scheduleGroup: G.depreciation },
    { code: "5900", name: "Other Expenses", kind: "expense", parentCode: "5", scheduleGroup: G.administrative },
  ];
}

/** Cost centres the school reports by. */
export function defaultCostCentres(): { code: string; name: string }[] {
  return [
    { code: "school", name: "School" },
    { code: "hostel", name: "Hostel" },
    { code: "transport", name: "Transport" },
    { code: "trust", name: "Trust" },
  ];
}

/**
 * Group codes — parents in the hierarchy, never posted to directly.
 *
 * A posting to a group would make the roll-up double-count, so the adapter and
 * any importer must skip these.
 */
export const LEDGER_GROUP_CODES = new Set(["1", "2", "3", "4", "5"]);

export function isPostableLedgerCode(code: string): boolean {
  return !LEDGER_GROUP_CODES.has(code);
}
