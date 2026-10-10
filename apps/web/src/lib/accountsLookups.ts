/**
 * Accounts — read-only lookups over the current book.
 *
 * Resolvers the posting paths lean on: pools, banks, payment-mode routing,
 * COA by well-known code, expense categories and their linked vendors, and
 * the next voucher number. Reads state; never writes it.
 */

import {
} from "@/lib/accountsTypes";
import type {
  AccountsState,
  AccountsVendor,
  BankAccount,
  CashPool,
  CoaAccount,
  CoaGroup,
  ExpenseCategory,
  PaymentMode,
} from "@/lib/accountsTypes";
import {
} from "@/lib/accountsUtil";
import {
} from "@/lib/accountsNormalize";
import {
  loadAccounts,
} from "@/lib/accountsStore";
import { loadMasters } from "@/lib/masters";
import { suggestFromSeriesCode } from "@/lib/numberSeries";

/* ─── Lookups ──────────────────────────────────────────────── */

export function getPool(poolId: string, state?: AccountsState): CashPool | undefined {
  const s = state ?? loadAccounts();
  return s.cashPools.find((p) => p.id === poolId);
}

export function getBank(bankId: string, state?: AccountsState): BankAccount | undefined {
  const s = state ?? loadAccounts();
  return s.bankAccounts.find((b) => b.id === bankId);
}

export function bankSupportsPaymentMode(
  bank: BankAccount,
  mode: PaymentMode,
): boolean {
  if (mode === "cash") return false;
  return bank.isActive !== false && bank.paymentModes.includes(mode);
}

export function listBanksForPaymentMode(
  mode: PaymentMode,
  state?: AccountsState,
): BankAccount[] {
  if (mode === "cash") return [];
  const s = state ?? loadAccounts();
  return s.bankAccounts.filter((b) => bankSupportsPaymentMode(b, mode));
}

export function resolveBankForPaymentMode(
  mode: PaymentMode,
  state?: AccountsState,
  preferredBankId?: string,
): string | undefined {
  if (mode === "cash") return undefined;
  const s = state ?? loadAccounts();
  if (preferredBankId) {
    const preferred = s.bankAccounts.find((b) => b.id === preferredBankId);
    if (preferred && bankSupportsPaymentMode(preferred, mode)) {
      return preferred.id;
    }
  }
  const match = listBanksForPaymentMode(mode, s)[0];
  if (match) return match.id;
  return s.modeBankMap.find((m) => m.mode === mode)?.bankId;
}

export function getCoaByCode(code: string, state?: AccountsState): CoaAccount | undefined {
  const s = state ?? loadAccounts();
  return s.coaAccounts.find((c) => c.code === code);
}

export function getExpenseCategory(
  categoryId: string,
  state?: AccountsState,
): ExpenseCategory | undefined {
  const s = state ?? loadAccounts();
  return s.expenseCategories.find((c) => c.id === categoryId);
}

export function listRootExpenseCategories(state?: AccountsState): ExpenseCategory[] {
  const s = state ?? loadAccounts();
  return s.expenseCategories.filter((c) => c.isActive !== false && !c.parentId);
}

export function listExpenseSubcategories(
  parentId: string,
  state?: AccountsState,
): ExpenseCategory[] {
  const s = state ?? loadAccounts();
  return s.expenseCategories.filter(
    (c) => c.isActive !== false && c.parentId === parentId,
  );
}

/** Vendor IDs linked to category or sub-category (sub-category overrides when set). */
export function linkedVendorIdsForExpense(
  categoryId: string,
  subcategoryId: string,
  state?: AccountsState,
): string[] {
  const s = state ?? loadAccounts();
  if (subcategoryId) {
    const sub = s.expenseCategories.find((c) => c.id === subcategoryId);
    if (sub?.vendorIds?.length) return sub.vendorIds;
  }
  const cat = s.expenseCategories.find((c) => c.id === categoryId);
  return cat?.vendorIds ?? [];
}

export function listLinkedVendorsForExpense(
  categoryId: string,
  subcategoryId: string,
  state?: AccountsState,
): AccountsVendor[] {
  const ids = linkedVendorIdsForExpense(categoryId, subcategoryId, state);
  if (!ids.length) return [];
  const s = state ?? loadAccounts();
  return ids
    .map((vid) => s.vendors.find((v) => v.id === vid && v.isActive !== false))
    .filter((v): v is AccountsVendor => !!v);
}

export function accountKindFromCoaGroup(
  group: CoaGroup,
): "expense" | "collection" | "other" {
  if (group === "expense") return "expense";
  if (group === "income") return "collection";
  return "other";
}

export function nextExpenseVoucherNo(state?: AccountsState): string {
  const s = state ?? loadAccounts();
  if (typeof window !== "undefined") {
    const masters = loadMasters();
    const fromSeries = suggestFromSeriesCode(
      masters.numberSeries,
      "EXPENSE_VOUCHER",
      undefined,
      s.expenseVouchers.map((v) => v.voucherNo),
    );
    if (fromSeries) return fromSeries;
  }

  const year = new Date().getFullYear();
  const prefix = `EXP-${year}-`;
  const nums = s.expenseVouchers
    .map((v) => v.voucherNo)
    .filter((n) => n.startsWith(prefix))
    .map((n) => Number(n.slice(prefix.length)) || 0);
  const next = (nums.length ? Math.max(...nums) : 0) + 1;
  return `${prefix}${String(next).padStart(4, "0")}`;
}

export function expenseVoucherHasLedgerPayment(
  voucherId: string,
  state?: AccountsState,
): boolean {
  const s = state ?? loadAccounts();
  return (
    s.cashLedger.some(
      (e) =>
        !e.voidedAt &&
        e.sourceType === "expense_voucher" &&
        e.sourceId === voucherId,
    ) ||
    s.bankLedger.some(
      (e) =>
        !e.voidedAt &&
        e.sourceType === "expense_voucher" &&
        e.sourceId === voucherId,
    )
  );
}
