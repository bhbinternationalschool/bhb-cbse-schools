import type { AccountsState } from "@/lib/accountsTypes";
import { accountsReadFromDbEnabled } from "@/lib/accountsDbConfig";
import type { AccountsDeskBundle } from "@/lib/accountsNormalized.server";

export function mergeDbDeskIntoAccountsState(
  state: AccountsState,
  bundle: AccountsDeskBundle,
  opts?: { preferDb?: boolean },
): AccountsState {
  const hasRemote =
    bundle.coaAccounts.length > 0 ||
    bundle.cashPools.length > 0 ||
    bundle.expenseVouchers.length > 0 ||
    bundle.journalEntries.length > 0;
  if (!hasRemote && !opts?.preferDb && !accountsReadFromDbEnabled()) return state;

  const preferDb = !!opts?.preferDb || accountsReadFromDbEnabled();

  function mergeById<T extends { id: string }>(
    local: T[],
    remote: T[],
    takeRemote: boolean,
  ): T[] {
    const byId = new Map<string, T>();
    if (!takeRemote) {
      for (const row of local) byId.set(row.id, row);
    }
    for (const row of remote) byId.set(row.id, row);
    if (!takeRemote) {
      for (const row of local) {
        if (!byId.has(row.id)) byId.set(row.id, row);
      }
    }
    return [...byId.values()];
  }

  function mergeFiscalYears(
    local: AccountsState["fiscalYears"],
    remote: AccountsState["fiscalYears"],
    takeRemote: boolean,
  ) {
    const byCode = new Map<string, AccountsState["fiscalYears"][number]>();
    if (!takeRemote) {
      for (const row of local) byCode.set(row.code, row);
    }
    for (const row of remote) byCode.set(row.code, row);
    if (!takeRemote) {
      for (const row of local) {
        if (!byCode.has(row.code)) byCode.set(row.code, row);
      }
    }
    return [...byCode.values()];
  }

  return {
    ...state,
    version: 1,
    cashPools: mergeById(
      state.cashPools ?? [],
      bundle.cashPools,
      preferDb || bundle.cashPools.length >= (state.cashPools?.length ?? 0),
    ),
    cashLedger: mergeById(
      state.cashLedger ?? [],
      bundle.cashLedger,
      preferDb || bundle.cashLedger.length >= (state.cashLedger?.length ?? 0),
    ),
    bankAccounts: mergeById(
      state.bankAccounts ?? [],
      bundle.bankAccounts,
      preferDb || bundle.bankAccounts.length >= (state.bankAccounts?.length ?? 0),
    ),
    bankLedger: mergeById(
      state.bankLedger ?? [],
      bundle.bankLedger,
      preferDb || bundle.bankLedger.length >= (state.bankLedger?.length ?? 0),
    ),
    modeBankMap:
      preferDb && bundle.modeBankMap.length > 0
        ? bundle.modeBankMap
        : bundle.modeBankMap.length >= (state.modeBankMap?.length ?? 0)
          ? bundle.modeBankMap
          : state.modeBankMap,
    reconSessions: mergeById(
      state.reconSessions ?? [],
      bundle.reconSessions,
      preferDb || bundle.reconSessions.length >= (state.reconSessions?.length ?? 0),
    ),
    expenseCategories: mergeById(
      state.expenseCategories ?? [],
      bundle.expenseCategories,
      preferDb ||
        bundle.expenseCategories.length >= (state.expenseCategories?.length ?? 0),
    ),
    expenseVouchers: mergeById(
      state.expenseVouchers ?? [],
      bundle.expenseVouchers,
      preferDb ||
        bundle.expenseVouchers.length >= (state.expenseVouchers?.length ?? 0),
    ),
    recurringRules: mergeById(
      state.recurringRules ?? [],
      bundle.recurringRules,
      preferDb ||
        bundle.recurringRules.length >= (state.recurringRules?.length ?? 0),
    ),
    vendors: mergeById(
      state.vendors ?? [],
      bundle.vendors,
      preferDb || bundle.vendors.length >= (state.vendors?.length ?? 0),
    ),
    vendorBills: mergeById(
      state.vendorBills ?? [],
      bundle.vendorBills,
      preferDb || bundle.vendorBills.length >= (state.vendorBills?.length ?? 0),
    ),
    payables: mergeById(
      state.payables ?? [],
      bundle.payables,
      preferDb || bundle.payables.length >= (state.payables?.length ?? 0),
    ),
    trustees: mergeById(
      state.trustees ?? [],
      bundle.trustees,
      preferDb || bundle.trustees.length >= (state.trustees?.length ?? 0),
    ),
    ownerLoans: mergeById(
      state.ownerLoans ?? [],
      bundle.ownerLoans,
      preferDb || bundle.ownerLoans.length >= (state.ownerLoans?.length ?? 0),
    ),
    ownerLoanSchedule: mergeById(
      state.ownerLoanSchedule ?? [],
      bundle.ownerLoanSchedule,
      preferDb ||
        bundle.ownerLoanSchedule.length >= (state.ownerLoanSchedule?.length ?? 0),
    ),
    ownerCashHandovers: mergeById(
      state.ownerCashHandovers ?? [],
      bundle.ownerCashHandovers,
      preferDb ||
        bundle.ownerCashHandovers.length >= (state.ownerCashHandovers?.length ?? 0),
    ),
    coaAccounts: mergeById(
      state.coaAccounts ?? [],
      bundle.coaAccounts,
      preferDb || bundle.coaAccounts.length >= (state.coaAccounts?.length ?? 0),
    ),
    journalEntries: mergeById(
      state.journalEntries ?? [],
      bundle.journalEntries,
      preferDb ||
        bundle.journalEntries.length >= (state.journalEntries?.length ?? 0),
    ),
    fiscalYears: mergeFiscalYears(
      state.fiscalYears ?? [],
      bundle.fiscalYears,
      preferDb || bundle.fiscalYears.length >= (state.fiscalYears?.length ?? 0),
    ),
    settings: bundle.settings ?? state.settings,
  };
}
