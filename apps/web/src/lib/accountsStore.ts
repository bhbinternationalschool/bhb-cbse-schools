/**
 * Accounts — the persisted state: read, write, and first-run seed.
 *
 * The single owner of the accounts storage key and of `serverAccountsCache`.
 * Nothing else in the family may declare either: two copies of the cache
 * would give server-side rendering two divergent views of the book and lose
 * writes silently.
 *
 * Almost every accounts function is a loadAccounts() -> compute ->
 * saveAccounts() transaction rather than threading state around, so this is
 * the hinge the whole family turns on.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import {
  COA_EXP_ACADEMIC,
  COA_EXP_MESS,
  COA_EXP_MILK,
  COA_EXP_OFFICE,
  COA_EXP_TRANSPORT_BATTA,
  COA_EXP_UTILITIES,
  COA_STORE_PURCHASES,
} from "@/lib/accountsTypes";
import type {
  AccountsState,
  BankAccount,
  CashPool,
  ExpenseCategory,
  FiscalYear,
  Trustee,
} from "@/lib/accountsTypes";
import {
  defaultCoaAccounts,
  defaultSettings,
  emptyAccounts,
  ensureConstructionCoaAccounts,
  ensureStoreCoaAccounts,
  normalizeBank,
  normalizeBankLedger,
  normalizeBill,
  normalizeCashLedger,
  normalizeCoa,
  normalizeExpenseCategory,
  normalizeJournal,
  normalizeLoan,
  normalizeLoanRow,
  normalizePayable,
  normalizePool,
  normalizeReconSession,
  normalizeRule,
  normalizeTrustee,
  normalizeVendor,
  normalizeVoucher,
  repairOrphanedCancelledVoucherLedger,
  syncModeBankMapFromBanks,
} from "@/lib/accountsNormalize";
import { writeCacheOrInvalidate } from "@/lib/browserStorage";

const STORAGE_KEY = "bhb_accounts_v1";

let serverAccountsCache: AccountsState | null = null;


/* ─── Empty / normalize / load / save ─────────────────────── */


export function loadAccounts(): AccountsState {
  if (typeof window === "undefined") {
    if (serverAccountsCache) return serverAccountsCache;
    return emptyAccounts();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptyAccounts();
    const parsed = JSON.parse(raw) as Partial<AccountsState>;
    const state: AccountsState = {
      version: 1,
      cashPools: Array.isArray(parsed.cashPools)
        ? parsed.cashPools.map(normalizePool)
        : [],
      cashLedger: Array.isArray(parsed.cashLedger)
        ? parsed.cashLedger.map(normalizeCashLedger)
        : [],
      bankAccounts: Array.isArray(parsed.bankAccounts)
        ? parsed.bankAccounts.map(normalizeBank)
        : [],
      bankLedger: Array.isArray(parsed.bankLedger)
        ? parsed.bankLedger.map(normalizeBankLedger)
        : [],
      modeBankMap: Array.isArray(parsed.modeBankMap) ? parsed.modeBankMap : [],
      reconSessions: Array.isArray(parsed.reconSessions)
        ? parsed.reconSessions.map(normalizeReconSession)
        : [],
      expenseCategories: Array.isArray(parsed.expenseCategories)
        ? parsed.expenseCategories.map(normalizeExpenseCategory)
        : [],
      expenseVouchers: Array.isArray(parsed.expenseVouchers)
        ? parsed.expenseVouchers.map(normalizeVoucher)
        : [],
      recurringRules: Array.isArray(parsed.recurringRules)
        ? parsed.recurringRules.map(normalizeRule)
        : [],
      vendors: Array.isArray(parsed.vendors)
        ? parsed.vendors.map(normalizeVendor)
        : [],
      vendorBills: Array.isArray(parsed.vendorBills)
        ? parsed.vendorBills.map(normalizeBill)
        : [],
      payables: Array.isArray(parsed.payables)
        ? parsed.payables.map(normalizePayable)
        : [],
      trustees: Array.isArray(parsed.trustees)
        ? parsed.trustees.map(normalizeTrustee)
        : [],
      ownerLoans: Array.isArray(parsed.ownerLoans)
        ? parsed.ownerLoans.map(normalizeLoan)
        : [],
      ownerLoanSchedule: Array.isArray(parsed.ownerLoanSchedule)
        ? parsed.ownerLoanSchedule.map(normalizeLoanRow)
        : [],
      ownerCashHandovers: Array.isArray(parsed.ownerCashHandovers)
        ? parsed.ownerCashHandovers
        : [],
      coaAccounts: Array.isArray(parsed.coaAccounts)
        ? parsed.coaAccounts.map(normalizeCoa)
        : [],
      journalEntries: Array.isArray(parsed.journalEntries)
        ? parsed.journalEntries.map(normalizeJournal)
        : [],
      fiscalYears: Array.isArray(parsed.fiscalYears) ? parsed.fiscalYears : [],
      settings: { ...defaultSettings(), ...(parsed.settings ?? {}) },
    };
    const repaired = repairOrphanedCancelledVoucherLedger(state);
    const synced = {
      ...repaired,
      modeBankMap: syncModeBankMapFromBanks(repaired.bankAccounts),
    };
    if (repaired !== state || synced.modeBankMap !== state.modeBankMap) {
      writeAccountsLocalRaw(synced);
    }
    return synced;
  } catch {
    return emptyAccounts();
  }
}

export function saveAccounts(state: AccountsState): void {
  if (!assertModulePermission("accounts", "edit", "saveAccounts")) return;

  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify({ ...state, version: 1 }));
  } catch (e) {
    console.warn("[accounts] localStorage quota exceeded — relying on server DB sync", e);
  }
  void import("@/lib/accountsPersistence").then(({ scheduleAccountsSync }) => {
    scheduleAccountsSync(state);
  });
}

export function writeAccountsLocalRaw(state: AccountsState): void {
  if (typeof window === "undefined") {
    serverAccountsCache = state;
    return;
  }
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify({ ...state, version: 1 }));
  } catch (e) {
    console.warn("[accounts] localStorage quota exceeded — relying on server DB sync", e);
  }
}

export function accountsStateIsEmpty(state: AccountsState): boolean {
  return (
    (state.cashLedger?.length ?? 0) === 0 &&
    (state.bankLedger?.length ?? 0) === 0 &&
    (state.expenseVouchers?.length ?? 0) === 0 &&
    (state.journalEntries?.length ?? 0) === 0 &&
    (state.coaAccounts?.length ?? 0) === 0
  );
}

/** Seed a starter chart of accounts, cash pools, one bank, categories, one trustee. */
export function seedAccountsIfEmpty(): AccountsState {
  let state = loadAccounts();
  if (state.coaAccounts.length > 0) {
    state = ensureConstructionCoaAccounts(state);
    state = ensureStoreCoaAccounts(state);
    saveAccounts(state);
    return state;
  }

  const cashPools: CashPool[] = [
    normalizePool({ code: "main", name: "Main Cash Box", balancePaise: 0 }),
    normalizePool({ code: "drawer", name: "Office Drawer", balancePaise: 0 }),
    normalizePool({ code: "petty", name: "Petty Cash", balancePaise: 0 }),
  ];

  const bankAccounts: BankAccount[] = [
    normalizeBank({
      name: "School Main Account",
      bankName: "State Bank of India",
      accountNo: "00000000000000",
      ifsc: "SBIN0000001",
      openingBalancePaise: 0,
      isActive: true,
    }),
  ];

  const expenseCategories: ExpenseCategory[] = [
    normalizeExpenseCategory({ name: "Mess", coaCode: COA_EXP_MESS }),
    normalizeExpenseCategory({ name: "Milk", coaCode: COA_EXP_MILK }),
    normalizeExpenseCategory({ name: "Utilities", coaCode: COA_EXP_UTILITIES }),
    normalizeExpenseCategory({
      name: "Transport Batta",
      coaCode: COA_EXP_TRANSPORT_BATTA,
    }),
    normalizeExpenseCategory({ name: "Office", coaCode: COA_EXP_OFFICE }),
    normalizeExpenseCategory({ name: "Academic", coaCode: COA_EXP_ACADEMIC }),
    normalizeExpenseCategory({
      name: "Store Purchases",
      coaCode: COA_STORE_PURCHASES,
    }),
  ];

  const trustees: Trustee[] = [
    normalizeTrustee({ name: "Managing Trustee", phone: "" }),
  ];

  const year = new Date().getFullYear();
  const fyStartMonth = 4; // Apr–Mar Indian FY
  const fyStartYear = new Date().getMonth() + 1 >= fyStartMonth ? year : year - 1;
  const fiscalYears: FiscalYear[] = [
    {
      code: `FY${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`,
      label: `FY ${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`,
      startDate: `${fyStartYear}-04-01`,
      endDate: `${fyStartYear + 1}-03-31`,
      status: "open",
    },
  ];

  const next: AccountsState = {
    ...emptyAccounts(),
    coaAccounts: defaultCoaAccounts(),
    cashPools,
    bankAccounts,
    expenseCategories,
    trustees,
    fiscalYears,
    modeBankMap: syncModeBankMapFromBanks(bankAccounts),
  };
  saveAccounts(next);
  return next;
}

