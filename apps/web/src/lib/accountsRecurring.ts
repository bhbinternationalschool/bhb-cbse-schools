/**
 * Accounts — recurring expense rules.
 *
 * Standing monthly charges (rent, retainers) materialised into ordinary
 * expense vouchers for a given month.
 */

import {
} from "@/lib/accountsTypes";
import type {
  ExpenseVoucher,
  RecurringExpenseRule,
} from "@/lib/accountsTypes";
import {
  clampDay,
  fail,
  id,
} from "@/lib/accountsUtil";
import {
  normalizeRule,
} from "@/lib/accountsNormalize";
import {
  loadAccounts,
  saveAccounts,
} from "@/lib/accountsStore";
import {
} from "@/lib/accountsLookups";
import {
} from "@/lib/accountsJournal";
import { createExpenseVoucher } from "@/lib/accountsExpenseVouchers";

/* ─── Recurring expenses ───────────────────────────────────── */

export function upsertRecurringRule(
  patch: Partial<RecurringExpenseRule> & {
    categoryId: string;
    amountPaise: number;
  },
): { ok: true; rule: RecurringExpenseRule } | { ok: false; error: string } {
  const state = loadAccounts();
  if (!state.expenseCategories.some((c) => c.id === patch.categoryId)) {
    return fail("Expense category not found");
  }
  const existing = patch.id
    ? state.recurringRules.find((r) => r.id === patch.id)
    : undefined;
  const rule = normalizeRule({
    ...existing,
    ...patch,
    id: existing?.id ?? patch.id ?? id("rec"),
  });
  const recurringRules = existing
    ? state.recurringRules.map((r) => (r.id === rule.id ? rule : r))
    : [...state.recurringRules, rule];
  saveAccounts({ ...state, recurringRules });
  return { ok: true, rule };
}

export function runRecurringExpensesForMonth(
  ym: string,
): { generated: number; vouchers: ExpenseVoucher[] } {
  const state = loadAccounts();
  const vouchers: ExpenseVoucher[] = [];
  for (const rule of state.recurringRules) {
    if (!rule.isActive) continue;
    if (rule.lastGeneratedOn === ym) continue;
    const date = clampDay(ym, rule.dayOfMonth);
    const res = createExpenseVoucher({
      date,
      categoryId: rule.categoryId,
      vendorId: rule.vendorId,
      amountPaise: rule.amountPaise,
      mode: rule.mode,
      narration: rule.narration || "Recurring expense",
    });
    if (res.ok) {
      vouchers.push(res.voucher);
      const s = loadAccounts();
      saveAccounts({
        ...s,
        recurringRules: s.recurringRules.map((r) =>
          r.id === rule.id ? { ...r, lastGeneratedOn: ym } : r,
        ),
      });
    }
  }
  return { generated: vouchers.length, vouchers };
}

