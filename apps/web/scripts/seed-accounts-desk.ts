#!/usr/bin/env npx tsx
/**
 * Seed accounts_desk_* — starter COA, cash pools, bank, categories, trustee, FY.
 *
 * Usage:
 *   cd apps/web && npx tsx scripts/seed-accounts-desk.ts
 */

import {
  BANK_PAYMENT_MODES,
  COA_EXP_ACADEMIC,
  COA_EXP_MESS,
  COA_EXP_MILK,
  COA_EXP_OFFICE,
  COA_EXP_TRANSPORT_BATTA,
  COA_EXP_UTILITIES,
  COA_STORE_PURCHASES,
  defaultCoaAccounts,
  type AccountsState,
  type BankAccount,
  type CashPool,
  type ExpenseCategory,
  type FiscalYear,
  type Trustee,
} from "../src/lib/accounts";
import {
  fetchAccountsDeskFromDb,
  pushAccountsDeskToDb,
} from "../src/lib/accountsNormalized.server";

function syncModeBankMap(banks: BankAccount[]) {
  const entries: { mode: string; bankId: string }[] = [];
  for (const mode of BANK_PAYMENT_MODES) {
    const bank = banks.find((b) => b.isActive && b.paymentModes.includes(mode));
    if (bank) entries.push({ mode, bankId: bank.id });
  }
  return entries;
}

async function main() {
  const cashPools: CashPool[] = [
    { id: "pool_main", code: "main", name: "Main Cash Box", balancePaise: 0 },
    { id: "pool_drawer", code: "drawer", name: "Office Drawer", balancePaise: 0 },
    { id: "pool_petty", code: "petty", name: "Petty Cash", balancePaise: 0 },
  ];

  const bankAccounts: BankAccount[] = [
    {
      id: "bnk_main",
      name: "School Main Account",
      bankName: "State Bank of India",
      accountNo: "00000000000000",
      ifsc: "SBIN0000001",
      openingBalancePaise: 0,
      isActive: true,
      paymentModes: [...BANK_PAYMENT_MODES],
    },
  ];

  const expenseCategories: ExpenseCategory[] = [
    { id: "ecat_mess", parentId: "", name: "Mess", coaCode: COA_EXP_MESS, isActive: true },
    { id: "ecat_milk", parentId: "", name: "Milk", coaCode: COA_EXP_MILK, isActive: true },
    {
      id: "ecat_util",
      parentId: "",
      name: "Utilities",
      coaCode: COA_EXP_UTILITIES,
      isActive: true,
    },
    {
      id: "ecat_transport",
      parentId: "",
      name: "Transport Batta",
      coaCode: COA_EXP_TRANSPORT_BATTA,
      isActive: true,
    },
    { id: "ecat_office", parentId: "", name: "Office", coaCode: COA_EXP_OFFICE, isActive: true },
    {
      id: "ecat_academic",
      parentId: "",
      name: "Academic",
      coaCode: COA_EXP_ACADEMIC,
      isActive: true,
    },
    {
      id: "ecat_store",
      parentId: "",
      name: "Store Purchases",
      coaCode: COA_STORE_PURCHASES,
      isActive: true,
    },
  ];

  const trustees: Trustee[] = [
    { id: "trustee_main", name: "Managing Trustee", phone: "", isActive: true },
  ];

  const year = new Date().getFullYear();
  const fyStartMonth = 4;
  const fyStartYear =
    new Date().getMonth() + 1 >= fyStartMonth ? year : year - 1;
  const fyCode = `FY${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`;
  const fiscalYears: FiscalYear[] = [
    {
      code: fyCode,
      label: `FY ${fyStartYear}-${String(fyStartYear + 1).slice(-2)}`,
      startDate: `${fyStartYear}-04-01`,
      endDate: `${fyStartYear + 1}-03-31`,
      status: "open",
    },
  ];

  const coaAccounts = defaultCoaAccounts().map((c) => ({
    ...c,
    id: `coa_${c.code}`,
  }));

  const state: AccountsState = {
    version: 1,
    cashPools,
    cashLedger: [],
    bankAccounts,
    bankLedger: [],
    modeBankMap: syncModeBankMap(bankAccounts),
    reconSessions: [],
    expenseCategories,
    expenseVouchers: [],
    recurringRules: [],
    vendors: [],
    vendorBills: [],
    payables: [],
    trustees,
    ownerLoans: [],
    ownerLoanSchedule: [],
    ownerCashHandovers: [],
    coaAccounts,
    journalEntries: [],
    fiscalYears,
    settings: { expenseApprovalPaise: 1_000_000, pettyThresholdPaise: 200_000 },
  };

  console.log(
    `Seeding ${coaAccounts.length} COA accounts, ${cashPools.length} cash pools, ${bankAccounts.length} banks, ${expenseCategories.length} categories`,
  );

  const before = await fetchAccountsDeskFromDb();
  console.log(`DB before: ${before.bundle.coaAccounts.length} COA rows`);

  const result = await pushAccountsDeskToDb(state);
  if (!result.ok) {
    console.error("Seed failed:", result.error);
    process.exit(1);
  }

  const after = await fetchAccountsDeskFromDb();
  console.log(
    `Seed OK — DB now ${after.bundle.coaAccounts.length} COA, ${after.bundle.cashPools.length} pools, ${after.meta?.coaCount ?? 0} COA in meta`,
  );
}

main().catch((e) => {
  console.error(e instanceof Error ? e.message : e);
  process.exit(1);
});
