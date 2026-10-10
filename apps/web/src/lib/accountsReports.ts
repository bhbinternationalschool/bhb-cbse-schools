/**
 * Accounts — trial balance, P&L, balance sheet, dashboard.
 *
 * All derived: nothing here writes. Note that the balance sheet takes cash
 * and bank from the sub-ledgers but everything else from the GL, so it only
 * ties when every movement was posted with its matching journal.
 */

import {
  COA_BANK_ACCOUNTS,
  COA_CASH_IN_HAND,
} from "@/lib/accountsTypes";
import type {
  AccountsState,
  CoaGroup,
} from "@/lib/accountsTypes";
import {
  todayIso,
} from "@/lib/accountsUtil";
import {
} from "@/lib/accountsNormalize";
import {
  loadAccounts,
} from "@/lib/accountsStore";
import {
} from "@/lib/accountsLookups";
import {
} from "@/lib/accountsJournal";
import { listUnifiedPayables } from "@/lib/accountsPayables";
import { listOwnerLoanDue } from "@/lib/accountsLoans";
import {
  cashInHandPaise,
  totalBankBalancePaise,
} from "@/lib/accountsCashBank";

export function groupSummary(
  asOf = todayIso(),
  state?: AccountsState,
): {
  group: CoaGroup;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
  accountCount: number;
}[] {
  const tb = trialBalance(asOf, state);
  const groups: CoaGroup[] = [
    "assets",
    "liabilities",
    "equity",
    "income",
    "expense",
  ];
  return groups.map((group) => {
    const rows = tb.filter((r) => r.group === group);
    return {
      group,
      debitPaise: rows.reduce((n, r) => n + r.debitPaise, 0),
      creditPaise: rows.reduce((n, r) => n + r.creditPaise, 0),
      balancePaise: rows.reduce((n, r) => n + r.balancePaise, 0),
      accountCount: rows.filter(
        (r) => r.debitPaise > 0 || r.creditPaise > 0 || r.balancePaise !== 0,
      ).length,
    };
  });
}

/** Cancel a cash ledger payment/receipt and reverse pool balance. */
/* ─── Reports ──────────────────────────────────────────────── */

export type TrialBalanceRow = {
  coaId: string;
  code: string;
  name: string;
  group: CoaGroup;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
};

export function trialBalance(asOf = todayIso(), state?: AccountsState): TrialBalanceRow[] {
  const s = state ?? loadAccounts();
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const entry of s.journalEntries) {
    if (entry.voidedAt) continue;
    if (entry.date > asOf) continue;
    for (const line of entry.lines) {
      const cur = totals.get(line.coaId) ?? { debit: 0, credit: 0 };
      cur.debit += line.debitPaise;
      cur.credit += line.creditPaise;
      totals.set(line.coaId, cur);
    }
  }
  return s.coaAccounts.map((coa) => {
    const t = totals.get(coa.id) ?? { debit: 0, credit: 0 };
    const debitNormal = coa.group === "assets" || coa.group === "expense";
    const balancePaise = debitNormal ? t.debit - t.credit : t.credit - t.debit;
    return {
      coaId: coa.id,
      code: coa.code,
      name: coa.name,
      group: coa.group,
      debitPaise: t.debit,
      creditPaise: t.credit,
      balancePaise,
    };
  });
}

export type ProfitAndLossLine = {
  coaId: string;
  code: string;
  name: string;
  group: "income" | "expense";
  amountPaise: number;
};

export type ProfitAndLossReport = {
  from: string;
  to: string;
  incomeLines: ProfitAndLossLine[];
  expenseLines: ProfitAndLossLine[];
  totalIncomePaise: number;
  totalExpensePaise: number;
  netProfitPaise: number;
};

export function profitAndLoss(
  from: string,
  to: string,
  state?: AccountsState,
): ProfitAndLossReport {
  const s = state ?? loadAccounts();
  const totals = new Map<string, { debit: number; credit: number }>();
  for (const entry of s.journalEntries) {
    if (entry.voidedAt) continue;
    if (entry.date < from || entry.date > to) continue;
    for (const line of entry.lines) {
      const cur = totals.get(line.coaId) ?? { debit: 0, credit: 0 };
      cur.debit += line.debitPaise;
      cur.credit += line.creditPaise;
      totals.set(line.coaId, cur);
    }
  }
  const incomeLines: ProfitAndLossLine[] = [];
  const expenseLines: ProfitAndLossLine[] = [];
  for (const coa of s.coaAccounts) {
    const t = totals.get(coa.id);
    if (!t) continue;
    if (coa.group === "income") {
      const amountPaise = t.credit - t.debit;
      if (amountPaise !== 0) {
        incomeLines.push({ coaId: coa.id, code: coa.code, name: coa.name, group: "income", amountPaise });
      }
    } else if (coa.group === "expense") {
      const amountPaise = t.debit - t.credit;
      if (amountPaise !== 0) {
        expenseLines.push({ coaId: coa.id, code: coa.code, name: coa.name, group: "expense", amountPaise });
      }
    }
  }
  const totalIncomePaise = incomeLines.reduce((n, l) => n + l.amountPaise, 0);
  const totalExpensePaise = expenseLines.reduce((n, l) => n + l.amountPaise, 0);
  return {
    from,
    to,
    incomeLines,
    expenseLines,
    totalIncomePaise,
    totalExpensePaise,
    netProfitPaise: totalIncomePaise - totalExpensePaise,
  };
}

export type BalanceSheetReport = {
  asOf: string;
  assets: {
    cashPaise: number;
    bankPaise: number;
    otherAssetsPaise: number;
    totalPaise: number;
  };
  liabilities: {
    totalPaise: number;
  };
  equity: {
    capitalPaise: number;
    retainedEarningsPaise: number;
    totalPaise: number;
  };
  totalLiabilitiesAndEquityPaise: number;
  balanced: boolean;
};

export function balanceSheet(asOf = todayIso(), state?: AccountsState): BalanceSheetReport {
  const s = state ?? loadAccounts();
  const rows = trialBalance(asOf, s);
  const cashPaise = cashInHandPaise(s);
  const bankPaise = totalBankBalancePaise(s);
  const otherAssetsPaise = rows
    .filter((r) => r.group === "assets" && r.code !== COA_CASH_IN_HAND && r.code !== COA_BANK_ACCOUNTS)
    .reduce((n, r) => n + r.balancePaise, 0);
  const liabilitiesPaise = rows
    .filter((r) => r.group === "liabilities")
    .reduce((n, r) => n + r.balancePaise, 0);
  const capitalPaise = rows
    .filter((r) => r.group === "equity")
    .reduce((n, r) => n + r.balancePaise, 0);
  const retainedEarningsPaise = profitAndLoss("0001-01-01", asOf, s).netProfitPaise;

  const totalAssetsPaise = cashPaise + bankPaise + otherAssetsPaise;
  const equityTotalPaise = capitalPaise + retainedEarningsPaise;
  const totalLiabilitiesAndEquityPaise = liabilitiesPaise + equityTotalPaise;

  return {
    asOf,
    assets: {
      cashPaise,
      bankPaise,
      otherAssetsPaise,
      totalPaise: totalAssetsPaise,
    },
    liabilities: { totalPaise: liabilitiesPaise },
    equity: {
      capitalPaise,
      retainedEarningsPaise,
      totalPaise: equityTotalPaise,
    },
    totalLiabilitiesAndEquityPaise,
    balanced: Math.abs(totalAssetsPaise - totalLiabilitiesAndEquityPaise) <= 1,
  };
}

/* ─── Dashboard ────────────────────────────────────────────── */

export type AccountsDashboardSnapshot = {
  cashInHandPaise: number;
  openApPaise: number;
  ownerDuePaise: number;
  todayExpensePaise: number;
};

export function dashboardSnapshot(state?: AccountsState): AccountsDashboardSnapshot {
  const s = state ?? loadAccounts();
  const today = todayIso();
  const openApPaise = listUnifiedPayables(s).reduce(
    (n, p) => n + Math.max(0, p.amountPaise - p.paidPaise),
    0,
  );
  const ownerDuePaise = listOwnerLoanDue(today, s).reduce(
    (n, r) => n + Math.max(0, r.amountPaise - r.paidAmountPaise),
    0,
  );
  const todayExpensePaise = s.expenseVouchers
    .filter((v) => v.paymentStatus === "paid" && v.paidOn === today)
    .reduce((n, v) => n + v.amountPaise, 0);
  return {
    cashInHandPaise: cashInHandPaise(s),
    openApPaise,
    ownerDuePaise,
    todayExpensePaise,
  };
}

