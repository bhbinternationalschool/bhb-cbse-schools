/**
 * Accounts — cash book, bank book, expenses/vendors, payables, owner loans,
 * chart of accounts + journal, and basic financial reports (localStorage).
 *
 * Everything is denominated in paise (integer) to avoid float drift.
 *
 * This file is the public surface only; the implementation lives in the
 * accounts* siblings. Those modules import each other by direct path, never
 * through this barrel — a submodule importing "@/lib/accounts" would create
 * an ESM cycle that shows up as an undefined function at call time rather
 * than as a type error.
 *
 * The layering, bottom up. Each layer may only reach downward:
 *
 *   accountsTypes         shapes, COA codes         (no imports)
 *   accountsUtil          id / dates / fail         (internal, see below)
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
 * accountsUtil is not re-exported: `id`, `todayIso` and `fail` are private
 * helpers in ~20 other lib modules, and putting them on the barrel would let
 * a collision silently shadow one. Import it directly where needed.
 */

export * from "@/lib/accountsTypes";
export * from "@/lib/accountsNormalize";
export * from "@/lib/accountsStore";
export * from "@/lib/accountsLookups";
export * from "@/lib/accountsJournal";
export * from "@/lib/accountsCoa";
export * from "@/lib/accountsCashBank";
export * from "@/lib/accountsVendors";
export * from "@/lib/accountsExpenseCategories";
export * from "@/lib/accountsExpenseVouchers";
export * from "@/lib/accountsRecurring";
export * from "@/lib/accountsPayables";
export * from "@/lib/accountsLoans";
export * from "@/lib/accountsReports";
export * from "@/lib/accountsPostings";
export * from "@/lib/accountsCapex";
