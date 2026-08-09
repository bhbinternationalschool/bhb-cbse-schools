/**
 * Accounts — expense categories.
 *
 * Two levels: a root category carries the COA code that expense postings
 * resolve against, and sub-categories override it. Removal is guarded so a
 * category still referenced by vouchers cannot vanish under them.
 */

import {
} from "@/lib/accountsTypes";
import type {
  AccountsRemovalCheck,
  AccountsState,
  ExpenseCategory,
  SessionExpenseCategoryRow,
} from "@/lib/accountsTypes";
import {
  fail,
  id,
} from "@/lib/accountsUtil";
import {
  isExpenseVoucherCancelled,
  normalizeExpenseCategory,
} from "@/lib/accountsNormalize";
import {
  loadAccounts,
  saveAccounts,
} from "@/lib/accountsStore";
import {
  getExpenseCategory,
} from "@/lib/accountsLookups";
import {
} from "@/lib/accountsJournal";

/* ─── Expense categories + vouchers ───────────────────────── */

export function upsertExpenseCategory(
  patch: Partial<ExpenseCategory> & { name: string },
): { ok: true; category: ExpenseCategory } | { ok: false; error: string } {
  const name = patch.name.trim();
  if (!name) return fail("Category name required");
  const state = loadAccounts();
  const existing = patch.id
    ? state.expenseCategories.find((c) => c.id === patch.id)
    : undefined;
  const parentId = patch.parentId ?? existing?.parentId ?? "";
  if (parentId) {
    const parent = state.expenseCategories.find((c) => c.id === parentId);
    if (!parent) return fail("Parent category not found");
    if (parent.parentId) return fail("Sub-category cannot be nested further");
  }
  const category = normalizeExpenseCategory({
    ...existing,
    ...patch,
    name,
    parentId,
    vendorIds:
      patch.vendorIds !== undefined ? patch.vendorIds : existing?.vendorIds,
    id: existing?.id ?? patch.id ?? id("ecat"),
  });
  const expenseCategories = existing
    ? state.expenseCategories.map((c) => (c.id === category.id ? category : c))
    : [...state.expenseCategories, category];
  saveAccounts({ ...state, expenseCategories });
  return { ok: true, category };
}

/** Expense voucher (non-cancelled) referencing a category or sub-category. */
export function expenseCategoryHasVouchers(
  categoryId: string,
  state?: AccountsState,
): boolean {
  const s = state ?? loadAccounts();
  for (const v of s.expenseVouchers) {
    if (isExpenseVoucherCancelled(v)) continue;
    if (v.categoryId === categoryId) return true;
    for (const line of v.lines) {
      if (line.categoryId === categoryId || line.subcategoryId === categoryId) {
        return true;
      }
    }
  }
  return false;
}

export function checkExpenseCategoryRemoval(
  categoryId: string,
  state?: AccountsState,
): AccountsRemovalCheck {
  const s = state ?? loadAccounts();
  const cat = s.expenseCategories.find((c) => c.id === categoryId);
  const label = cat?.name ?? "this category";
  const blockers: string[] = [];
  if (expenseCategoryHasVouchers(categoryId, s)) {
    blockers.push("expense voucher(s)");
  }
  if (cat && !cat.parentId) {
    const subN = s.expenseCategories.filter((c) => c.parentId === categoryId).length;
    if (subN > 0) {
      blockers.push(`${subN} sub-categor${subN === 1 ? "y" : "ies"}`);
    }
  }
  const ruleN = s.recurringRules.filter((r) => r.categoryId === categoryId).length;
  if (ruleN > 0) {
    blockers.push(`${ruleN} recurring rule(s)`);
  }
  const billN = s.vendorBills.filter((b) => {
    if (b.categoryId === categoryId) return true;
    return b.lines.some((l) => l.categoryId === categoryId);
  }).length;
  if (billN > 0) {
    blockers.push(`${billN} vendor bill(s)`);
  }
  if (blockers.length > 0) {
    return {
      canRemove: false,
      blockers,
      suggestion: `Cannot delete — linked to ${blockers.join(", ")}.`,
      confirmMessage: `Delete “${label}”?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion: "This cannot be undone.",
    confirmMessage: `Delete “${label}”?`,
  };
}

export function deleteExpenseCategory(
  categoryId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const cat = state.expenseCategories.find((c) => c.id === categoryId);
  if (!cat) return fail("Category not found");
  const check = checkExpenseCategoryRemoval(categoryId, state);
  if (!check.canRemove) return fail(check.suggestion);
  saveAccounts({
    ...state,
    expenseCategories: state.expenseCategories.filter((c) => c.id !== categoryId),
  });
  return { ok: true };
}

export function sessionExpenseCategoryTotals(
  state: AccountsState,
  sessionDate: string,
): SessionExpenseCategoryRow[] {
  const map = new Map<string, SessionExpenseCategoryRow>();
  for (const v of state.expenseVouchers) {
    if (isExpenseVoucherCancelled(v)) continue;
    if (v.paidPaise <= 0) continue;
    const payDate = v.paidOn || v.date;
    if (payDate !== sessionDate) continue;
    for (const line of v.lines) {
      const share =
        v.grandTotalPaise > 0
          ? Math.round((line.totalPaise / v.grandTotalPaise) * v.paidPaise)
          : 0;
      if (share <= 0) continue;
      const cat = getExpenseCategory(line.categoryId, state);
      const sub = line.subcategoryId
        ? getExpenseCategory(line.subcategoryId, state)
        : undefined;
      const key = `${line.categoryId}:${line.subcategoryId || ""}`;
      const cur = map.get(key) ?? {
        categoryId: line.categoryId,
        subcategoryId: line.subcategoryId || "",
        categoryName: cat?.name || "Uncategorized",
        subcategoryName: sub?.name || "—",
        amountPaise: 0,
      };
      cur.amountPaise += share;
      map.set(key, cur);
    }
  }
  return [...map.values()].sort(
    (a, b) =>
      a.categoryName.localeCompare(b.categoryName) ||
      a.subcategoryName.localeCompare(b.subcategoryName),
  );
}

