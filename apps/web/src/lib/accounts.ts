/**
 * Accounts — cash book, bank book, expenses/vendors, payables, owner loans,
 * chart of accounts + journal, and basic financial reports (localStorage).
 *
 * Everything is denominated in paise (integer) to avoid float drift.
 */

import { loadMasters } from "@/lib/masters";
import { suggestFromSeriesCode, persistSeriesUse } from "@/lib/numberSeries";
import {
  listOpenPayables as listOpenTransportPayables,
  markPayablePaid as markTransportPayablePaid,
  loadTransport,
} from "@/lib/transport";
import { id, todayIso, clampDay, fail } from "@/lib/accountsUtil";
import {
  COA_ACCOUNTS_PAYABLE,
  COA_ACCOUNTS_RECEIVABLE,
  COA_BANK_ACCOUNTS,
  COA_CASH_IN_HAND,
  COA_CWIP,
  COA_FEE_INCOME,
  COA_FIXED_ASSETS,
  COA_OWNER_LOANS,
  COA_RETENTION_PAYABLE,
  COA_STORE_PURCHASES,
  COA_STORE_SALES,
} from "@/lib/accountsTypes";
import type {
  AccountsPayable,
  AccountsRemovalCheck,
  AccountsState,
  AccountsVendor,
  BankAccount,
  BankDirection,
  BankLedgerEntry,
  CashDirection,
  CashLedgerEntry,
  CashPool,
  CoaAccount,
  CoaGroup,
  ExpenseCategory,
  ExpensePaymentSplit,
  ExpenseVoucher,
  ExpenseVoucherLine,
  FiscalYear,
  FiscalYearStatus,
  JournalEntry,
  JournalLine,
  ModeBankMapEntry,
  OwnerCashHandover,
  OwnerLoan,
  OwnerLoanScheduleRow,
  OwnerLoanType,
  PayableStatus,
  PaymentMode,
  ReconSession,
  ReconSessionLine,
  RecurringExpenseRule,
  SessionExpenseCategoryRow,
  Trustee,
  VendorBill,
  VendorBillLine,
  VendorBillStatus,
} from "@/lib/accountsTypes";

import {
  isExpenseVoucherCancelled,
  ensureStoreCoaAccounts,
  normalizeBank,
  normalizeBill,
  normalizeCoa,
  normalizeExpenseCategory,
  normalizeExpenseVoucherLine,
  normalizeJournal,
  normalizeLoan,
  normalizeLoanRow,
  normalizePayable,
  normalizePaymentSplit,
  normalizeReconSession,
  normalizeRule,
  normalizeTrustee,
  normalizeVendor,
  normalizeVoucher,
  syncModeBankMapFromBanks,
  vendorBillLineTotalPaise,
} from "@/lib/accountsNormalize";

export * from "@/lib/accountsTypes";
import {
  loadAccounts,
  saveAccounts,
  seedAccountsIfEmpty,
} from "@/lib/accountsStore";

export * from "@/lib/accountsTypes";
export * from "@/lib/accountsNormalize";
export * from "@/lib/accountsStore";
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

export function upsertCoaAccount(
  patch: Partial<CoaAccount> & { code: string; name: string; group: CoaGroup },
): { ok: true; account: CoaAccount } | { ok: false; error: string } {
  const code = patch.code.trim();
  const name = patch.name.trim();
  if (!code) return fail("Account code required");
  if (!name) return fail("Account name required");
  const state = loadAccounts();
  const dup = state.coaAccounts.find(
    (c) => c.code === code && c.id !== patch.id,
  );
  if (dup) return fail(`Account code ${code} already exists`);
  const existing = patch.id
    ? state.coaAccounts.find((c) => c.id === patch.id)
    : undefined;
  const account = normalizeCoa({
    ...existing,
    ...patch,
    code,
    name,
    id: existing?.id ?? patch.id ?? id("coa"),
  });
  const coaAccounts = existing
    ? state.coaAccounts.map((c) => (c.id === account.id ? account : c))
    : [...state.coaAccounts, account];
  saveAccounts({ ...state, coaAccounts });
  return { ok: true, account };
}

/** Non-void journal lines posted against a COA account. */
export function coaAccountHasJournalActivity(
  coaId: string,
  state?: AccountsState,
): boolean {
  const s = state ?? loadAccounts();
  return s.journalEntries.some(
    (j) =>
      !j.voidedAt &&
      j.lines.some(
        (l) =>
          l.coaId === coaId && (l.debitPaise > 0 || l.creditPaise > 0),
      ),
  );
}

export function checkCoaAccountRemoval(
  coaId: string,
  state?: AccountsState,
): AccountsRemovalCheck {
  const s = state ?? loadAccounts();
  const account = s.coaAccounts.find((c) => c.id === coaId);
  const label = account ? `${account.code} · ${account.name}` : "this account";
  const blockers: string[] = [];
  if (coaAccountHasJournalActivity(coaId, s)) {
    blockers.push("journal entries");
  }
  const categoryN = account
    ? s.expenseCategories.filter((c) => c.coaCode === account.code).length
    : 0;
  if (categoryN > 0) {
    blockers.push(`${categoryN} expense categor${categoryN === 1 ? "y" : "ies"}`);
  }
  if (blockers.length > 0) {
    return {
      canRemove: false,
      blockers,
      suggestion: `Cannot delete — linked to ${blockers.join(" and ")}. Mark inactive instead.`,
      confirmMessage: `Delete account “${label}”?`,
    };
  }
  return {
    canRemove: true,
    blockers: [],
    suggestion: "This cannot be undone.",
    confirmMessage: `Delete account “${label}”?`,
  };
}

export function deleteCoaAccount(
  coaId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const account = state.coaAccounts.find((c) => c.id === coaId);
  if (!account) return fail("Account not found");
  const check = checkCoaAccountRemoval(coaId, state);
  if (!check.canRemove) return fail(check.suggestion);
  saveAccounts({
    ...state,
    coaAccounts: state.coaAccounts.filter((c) => c.id !== coaId),
  });
  return { ok: true };
}

/* ─── Cash book ────────────────────────────────────────────── */

export function cashInHandPaise(state?: AccountsState): number {
  const s = state ?? loadAccounts();
  return s.cashPools.reduce((n, p) => n + p.balancePaise, 0);
}

export function postCashMovement(input: {
  poolId: string;
  date?: string;
  direction: CashDirection;
  amountPaise: number;
  sourceType: string;
  sourceId?: string;
  narration?: string;
  transactionRef?: string;
}):
  | { ok: true; entry: CashLedgerEntry; pool: CashPool }
  | { ok: false; error: string } {
  const amount = Math.round(input.amountPaise);
  if (amount <= 0) return fail("Amount must be greater than zero");
  const state = loadAccounts();
  const pool = state.cashPools.find((p) => p.id === input.poolId);
  if (!pool) return fail("Cash pool not found");
  const delta = input.direction === "in" ? amount : -amount;
  const nextBalance = pool.balancePaise + delta;
  if (nextBalance < 0) return fail("Insufficient cash in pool");

  const entry: CashLedgerEntry = {
    id: id("cle"),
    poolId: pool.id,
    date: input.date || todayIso(),
    direction: input.direction,
    amountPaise: amount,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? "",
    narration: input.narration ?? "",
    transactionRef: input.transactionRef?.trim() ?? "",
    runningBalancePaise: nextBalance,
    createdAt: new Date().toISOString(),
    voidedAt: null,
    cancelReason: "",
  };
  const updatedPool: CashPool = { ...pool, balancePaise: nextBalance };
  saveAccounts({
    ...state,
    cashPools: state.cashPools.map((p) => (p.id === pool.id ? updatedPool : p)),
    cashLedger: [entry, ...state.cashLedger],
  });
  return { ok: true, entry, pool: updatedPool };
}

/* ─── Bank book ────────────────────────────────────────────── */

export function upsertBankAccount(
  patch: Partial<BankAccount> & { name: string },
): { ok: true; bank: BankAccount } | { ok: false; error: string } {
  const name = patch.name.trim();
  if (!name) return fail("Bank account name required");
  const state = loadAccounts();
  const existing = patch.id
    ? state.bankAccounts.find((b) => b.id === patch.id)
    : undefined;
  const bank = normalizeBank({
    ...existing,
    ...patch,
    name,
    id: existing?.id ?? patch.id ?? id("bnk"),
  });
  const bankAccounts = existing
    ? state.bankAccounts.map((b) => (b.id === bank.id ? bank : b))
    : [...state.bankAccounts, bank];
  saveAccounts({
    ...state,
    bankAccounts,
    modeBankMap: syncModeBankMapFromBanks(bankAccounts),
  });
  return { ok: true, bank };
}

export function checkBankAccountRemoval(
  bankId: string,
  state?: AccountsState,
): AccountsRemovalCheck {
  const s = state ?? loadAccounts();
  const bank = s.bankAccounts.find((b) => b.id === bankId);
  const label = bank?.name ?? "this bank account";
  const blockers: string[] = [];
  if (
    s.bankLedger.some((e) => e.bankId === bankId && !e.voidedAt)
  ) {
    blockers.push("bank ledger entries");
  }
  if (blockers.length > 0) {
    return {
      canRemove: false,
      blockers,
      suggestion: `Cannot delete — linked to ${blockers.join(", ")}. Mark inactive instead.`,
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

export function deleteBankAccount(
  bankId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const bank = state.bankAccounts.find((b) => b.id === bankId);
  if (!bank) return fail("Bank account not found");

  const check = checkBankAccountRemoval(bankId, state);
  if (!check.canRemove) return fail(check.suggestion);

  const bankAccounts = state.bankAccounts.filter((b) => b.id !== bankId);
  saveAccounts({
    ...state,
    bankAccounts,
    modeBankMap: syncModeBankMapFromBanks(bankAccounts),
  });
  return { ok: true };
}

export function postBankMovement(input: {
  bankId: string;
  date?: string;
  direction: BankDirection;
  amountPaise: number;
  mode: PaymentMode;
  sourceType: string;
  sourceId?: string;
  narration?: string;
  transactionRef?: string;
}): { ok: true; entry: BankLedgerEntry } | { ok: false; error: string } {
  const amount = Math.round(input.amountPaise);
  if (amount <= 0) return fail("Amount must be greater than zero");
  const state = loadAccounts();
  const bank = state.bankAccounts.find((b) => b.id === input.bankId);
  if (!bank) return fail("Bank account not found");
  const entry: BankLedgerEntry = {
    id: id("ble"),
    bankId: bank.id,
    date: input.date || todayIso(),
    direction: input.direction,
    amountPaise: amount,
    mode: input.mode,
    sourceType: input.sourceType,
    sourceId: input.sourceId ?? "",
    narration: input.narration ?? "",
    transactionRef: input.transactionRef?.trim() ?? "",
    createdAt: new Date().toISOString(),
    voidedAt: null,
    cancelReason: "",
  };
  saveAccounts({ ...state, bankLedger: [entry, ...state.bankLedger] });
  return { ok: true, entry };
}

/** Current bank balance = opening balance + debits (money in) - credits (money out). */
export function bankBalancePaise(bankId: string, state?: AccountsState): number {
  const s = state ?? loadAccounts();
  const bank = s.bankAccounts.find((b) => b.id === bankId);
  if (!bank) return 0;
  const movement = s.bankLedger
    .filter((e) => e.bankId === bankId && !e.voidedAt)
    .reduce((n, e) => n + (e.direction === "dr" ? e.amountPaise : -e.amountPaise), 0);
  return bank.openingBalancePaise + movement;
}

export function totalBankBalancePaise(state?: AccountsState): number {
  const s = state ?? loadAccounts();
  return s.bankAccounts
    .filter((b) => b.isActive)
    .reduce((n, b) => n + bankBalancePaise(b.id, s), 0);
}

export function recordBankDeposit(
  fromPoolId: string,
  bankId: string,
  amountPaise: number,
  date?: string,
): { ok: true } | { ok: false; error: string } {
  const amount = Math.round(amountPaise);
  const d = date || todayIso();
  const sourceId = id("dep");

  const cashRes = postCashMovement({
    poolId: fromPoolId,
    date: d,
    direction: "out",
    amountPaise: amount,
    sourceType: "bank_deposit",
    sourceId,
    narration: "Cash deposited to bank",
  });
  if (!cashRes.ok) return cashRes;

  const bankRes = postBankMovement({
    bankId,
    date: d,
    direction: "dr",
    amountPaise: amount,
    mode: "cash",
    sourceType: "bank_deposit",
    sourceId,
    narration: "Cash deposit",
  });
  if (!bankRes.ok) return bankRes;

  const cashCoa = getCoaByCode(COA_CASH_IN_HAND);
  const bankCoa = getCoaByCode(COA_BANK_ACCOUNTS);
  if (cashCoa && bankCoa) {
    postJournal({
      date: d,
      narration: "Cash deposited to bank",
      sourceType: "bank_deposit",
      sourceId,
      lines: [
        { coaId: bankCoa.id, debitPaise: amount, creditPaise: 0, narration: "" },
        { coaId: cashCoa.id, debitPaise: 0, creditPaise: amount, narration: "" },
      ],
    });
  }
  return { ok: true };
}

export function recordOwnerCashHandover(input: {
  fromPoolId: string;
  amountPaise: number;
  handedBy: string;
  receivedBy: string;
  purpose?: string;
  date?: string;
  note?: string;
}): { ok: true; handover: OwnerCashHandover } | { ok: false; error: string } {
  const handoverId = id("och");
  const cashRes = postCashMovement({
    poolId: input.fromPoolId,
    date: input.date,
    direction: "out",
    amountPaise: input.amountPaise,
    sourceType: "owner_handover",
    sourceId: handoverId,
    narration: input.purpose || "Owner cash handover",
  });
  if (!cashRes.ok) return cashRes;

  const state = loadAccounts();
  const handover: OwnerCashHandover = {
    id: handoverId,
    date: input.date || todayIso(),
    amountPaise: Math.round(input.amountPaise),
    fromPoolId: input.fromPoolId,
    handedBy: input.handedBy,
    receivedBy: input.receivedBy,
    purpose: input.purpose ?? "",
    note: input.note ?? "",
  };
  saveAccounts({
    ...state,
    ownerCashHandovers: [handover, ...state.ownerCashHandovers],
  });
  return { ok: true, handover };
}

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

export function createExpenseVoucher(input: {
  date?: string;
  voucherNo?: string;
  categoryId?: string;
  vendorId?: string;
  amountPaise?: number;
  lines?: Partial<ExpenseVoucherLine>[];
  taxPaise?: number;
  paidPaise?: number;
  mode: PaymentMode;
  narration?: string;
  poolId?: string;
  bankId?: string;
  paymentSplits?: Partial<ExpensePaymentSplit>[];
}): { ok: true; voucher: ExpenseVoucher } | { ok: false; error: string } {
  const state = loadAccounts();
  const lines =
    input.lines && input.lines.length > 0
      ? input.lines.map((l) => normalizeExpenseVoucherLine(l))
      : input.categoryId
        ? [
            normalizeExpenseVoucherLine({
              categoryId: input.categoryId,
              amountPaise: input.amountPaise ?? 0,
              description: input.narration ?? "",
            }),
          ]
        : [];

  if (lines.length === 0) return fail("Add at least one expense line");
  for (const line of lines) {
    if (!line.categoryId) return fail("Each line needs a category");
    if (!state.expenseCategories.some((c) => c.id === line.categoryId)) {
      return fail("Expense category not found on a line");
    }
    if (line.subcategoryId) {
      const sub = state.expenseCategories.find((c) => c.id === line.subcategoryId);
      if (!sub || sub.parentId !== line.categoryId) {
        return fail("Invalid sub-category on a line");
      }
    }
    if (line.totalPaise <= 0) return fail("Line total must be greater than zero");
  }

  const vendorPayErr = validateVendorPaymentAmounts(lines, state);
  if (vendorPayErr) return fail(vendorPayErr);

  const grandTotalPaise = lines.reduce((s, l) => s + l.totalPaise, 0);
  const taxPaise =
    input.taxPaise !== undefined
      ? Math.max(0, Math.round(input.taxPaise))
      : lines.reduce((s, l) => s + l.taxPaise, 0);
  const intendedPaidPaise = Math.min(
    grandTotalPaise,
    Math.max(
      0,
      Math.round(
        input.paidPaise ?? lines.reduce((s, l) => s + l.paidPaise, 0),
      ),
    ),
  );
  const needsApproval = grandTotalPaise > state.settings.expenseApprovalPaise;

  const splits =
    input.paymentSplits && input.paymentSplits.length > 0
      ? input.paymentSplits.map((s) => normalizePaymentSplit(s))
      : intendedPaidPaise > 0
        ? [
            normalizePaymentSplit({
              mode: input.mode,
              amountPaise: intendedPaidPaise,
              poolId: input.poolId ?? "",
              bankId: input.bankId ?? "",
              transactionRef: "",
            }),
          ]
        : [];

  if (intendedPaidPaise > 0) {
    const splitSum = splits.reduce((s, x) => s + x.amountPaise, 0);
    if (splitSum !== intendedPaidPaise) {
      return fail(
        `Payment splits (${splitSum}) must equal paid amount (${intendedPaidPaise})`,
      );
    }
    for (const split of splits) {
      if (split.mode !== "cash" && !split.transactionRef.trim()) {
        return fail("Transaction ID is required for non-cash payments");
      }
      if (split.mode === "cash" && !split.poolId) {
        return fail("Select cash pool for cash payment");
      }
      if (split.mode !== "cash" && !split.bankId) {
        return fail("Select bank account for non-cash payment");
      }
    }
  }

  const headerVendorId =
    input.vendorId ??
    lines.find((l) => l.vendorId)?.vendorId ??
    "";

  const voucher = normalizeVoucher({
    id: id("exv"),
    voucherNo: input.voucherNo?.trim() || nextExpenseVoucherNo(state),
    date: input.date || todayIso(),
    categoryId: lines[0]!.categoryId,
    vendorId: headerVendorId,
    amountPaise: grandTotalPaise,
    taxPaise,
    grandTotalPaise,
    paidPaise: 0,
    duePaise: grandTotalPaise,
    lines: lines.map((l) => ({
      ...l,
      paidPaise: Math.min(l.totalPaise, l.paidPaise),
      duePaise: Math.max(0, l.totalPaise - Math.min(l.totalPaise, l.paidPaise)),
    })),
    mode: splits[0]?.mode ?? input.mode,
    paymentSplits: splits,
    paymentStatus: needsApproval ? "pending_approval" : "draft",
    narration: input.narration ?? "",
    createdAt: new Date().toISOString(),
  });

  saveAccounts({
    ...state,
    expenseVouchers: [voucher, ...state.expenseVouchers],
  });

  persistSeriesUse("EXPENSE_VOUCHER", undefined, voucher.voucherNo);

  if (!needsApproval && intendedPaidPaise > 0) {
    const payDate = input.date || todayIso();
    for (const split of splits) {
      const payRes = payExpenseVoucher(voucher.id, {
        date: payDate,
        mode: split.mode,
        poolId: split.mode === "cash" ? split.poolId : undefined,
        bankId: split.mode !== "cash" ? split.bankId : undefined,
        amountPaise: split.amountPaise,
        transactionRef: split.transactionRef,
      });
      if (!payRes.ok) return payRes;
    }
    const final = loadAccounts().expenseVouchers.find((v) => v.id === voucher.id);
    return { ok: true, voucher: final ?? voucher };
  }

  return { ok: true, voucher };
}

export function approveExpenseVoucher(
  voucherId: string,
  approvedBy: string,
): { ok: true; voucher: ExpenseVoucher } | { ok: false; error: string } {
  const state = loadAccounts();
  const voucher = state.expenseVouchers.find((v) => v.id === voucherId);
  if (!voucher) return fail("Voucher not found");
  if (voucher.paymentStatus !== "pending_approval") {
    return fail("Voucher is not pending approval");
  }
  const updated: ExpenseVoucher = {
    ...voucher,
    paymentStatus: "draft",
    approvedBy,
  };
  saveAccounts({
    ...state,
    expenseVouchers: state.expenseVouchers.map((v) =>
      v.id === voucherId ? updated : v,
    ),
  });
  return { ok: true, voucher: updated };
}

export function cancelExpenseVoucher(
  voucherId: string,
  reason: string,
  cancelledBy = "",
): { ok: true; voucher: ExpenseVoucher } | { ok: false; error: string } {
  const trimmed = reason.trim();
  if (!trimmed) return fail("Cancellation reason is required");

  const state = loadAccounts();
  const voucher = state.expenseVouchers.find((v) => v.id === voucherId);
  if (!voucher) return fail("Voucher not found");
  const alreadyCancelled = isExpenseVoucherCancelled(voucher);
  const hasActiveLedger = expenseVoucherHasLedgerPayment(voucherId, state);
  if (alreadyCancelled && !hasActiveLedger) {
    return fail("Voucher already cancelled");
  }

  const now = new Date().toISOString();
  let cashPools = [...state.cashPools];
  let cashLedger = [...state.cashLedger];
  let bankLedger = [...state.bankLedger];
  let journalEntries = [...state.journalEntries];

  for (const entry of cashLedger) {
    if (entry.voidedAt) continue;
    if (entry.sourceType !== "expense_voucher" || entry.sourceId !== voucherId) {
      continue;
    }
    const pool = cashPools.find((p) => p.id === entry.poolId);
    if (!pool) return fail("Cash pool not found for linked entry");
    const reverse =
      entry.direction === "in" ? -entry.amountPaise : entry.amountPaise;
    const nextBalance = pool.balancePaise + reverse;
    if (nextBalance < 0) {
      return fail("Cannot cancel — cash pool balance would go negative");
    }
    cashPools = cashPools.map((p) =>
      p.id === pool.id ? { ...p, balancePaise: nextBalance } : p,
    );
    cashLedger = cashLedger.map((e) =>
      e.id === entry.id ? { ...e, voidedAt: now, cancelReason: trimmed } : e,
    );
  }

  bankLedger = bankLedger.map((e) =>
    !e.voidedAt &&
    e.sourceType === "expense_voucher" &&
    e.sourceId === voucherId
      ? { ...e, voidedAt: now, cancelReason: trimmed }
      : e,
  );

  journalEntries = journalEntries.map((j) =>
    !j.voidedAt &&
    j.sourceType === "expense_voucher" &&
    j.sourceId === voucherId
      ? { ...j, voidedAt: now, cancelReason: trimmed }
      : j,
  );

  const updated = alreadyCancelled
    ? normalizeVoucher({
        ...voucher,
        cancelReason: voucher.cancelReason || trimmed,
      })
    : normalizeVoucher({
        ...voucher,
        paymentStatus: "cancelled",
        cancelledAt: now,
        cancelledBy,
        cancelReason: trimmed,
        paidPaise: 0,
        duePaise: 0,
        lines: voucher.lines.map((l) => ({
          ...l,
          paidPaise: 0,
          duePaise: 0,
        })),
      });

  saveAccounts({
    ...state,
    cashPools,
    cashLedger,
    bankLedger,
    journalEntries,
    expenseVouchers: state.expenseVouchers.map((v) =>
      v.id === voucherId ? updated : v,
    ),
  });
  return { ok: true, voucher: updated };
}

export function voidExpenseVoucher(
  voucherId: string,
  reason = "Voided",
): { ok: true } | { ok: false; error: string } {
  const res = cancelExpenseVoucher(voucherId, reason);
  return res.ok ? { ok: true } : res;
}

export function payExpenseVoucher(
  voucherId: string,
  input: {
    date?: string;
    poolId?: string;
    bankId?: string;
    mode?: PaymentMode;
    postJv?: boolean;
    /** Pay this amount now (defaults to full due). */
    amountPaise?: number;
    transactionRef?: string;
  } = {},
): { ok: true; voucher: ExpenseVoucher } | { ok: false; error: string } {
  const state = loadAccounts();
  const voucher = state.expenseVouchers.find((v) => v.id === voucherId);
  if (!voucher) return fail("Voucher not found");
  if (voucher.paymentStatus === "pending_approval") {
    return fail("Voucher needs approval before payment");
  }
  if (voucher.paymentStatus === "paid") return fail("Voucher already paid");
  if (voucher.paymentStatus === "void") return fail("Voucher is void");
  if (voucher.paymentStatus === "cancelled") {
    return fail("Voucher is cancelled");
  }

  const payNow = Math.min(
    voucher.duePaise || voucher.grandTotalPaise - voucher.paidPaise,
    Math.max(
      0,
      Math.round(
        input.amountPaise ??
          voucher.duePaise ??
          voucher.grandTotalPaise - voucher.paidPaise,
      ),
    ),
  );
  if (payNow <= 0) return fail("Nothing due on this voucher");

  const payMode = input.mode ?? voucher.mode;
  if (payMode !== "cash" && !input.transactionRef?.trim()) {
    return fail("Transaction ID is required for non-cash payments");
  }

  const date = input.date || todayIso();
  const expenseLines =
    voucher.lines.length > 0
      ? voucher.lines
      : [
          normalizeExpenseVoucherLine({
            categoryId: voucher.categoryId,
            amountPaise: voucher.amountPaise,
            totalPaise: voucher.grandTotalPaise || voucher.amountPaise,
          }),
        ];

  const vendorPayIntent = Math.min(
    payNow,
    vendorPaymentPaiseFromVoucherLines(expenseLines),
  );
  if (vendorPayIntent > 0) {
    const vendorErr = validateVendorPaymentAmounts(
      expenseLines.map((l) =>
        l.vendorId && l.paidPaise > 0
          ? l
          : { ...l, paidPaise: 0 },
      ),
      state,
    );
    if (vendorErr) return fail(vendorErr);
  }

  const expensePayPortion = Math.max(0, payNow - vendorPayIntent);

  const jvLines: JournalLine[] = [];
  if (vendorPayIntent > 0) {
    const apCoa = getCoaByCode(COA_ACCOUNTS_PAYABLE, state);
    if (apCoa) {
      jvLines.push({
        coaId: apCoa.id,
        debitPaise: vendorPayIntent,
        creditPaise: 0,
        narration: "Vendor payment",
      });
    }
  }
  if (expensePayPortion > 0) {
    for (const line of expenseLines) {
      if (line.vendorId && line.paidPaise > 0) continue;
      const catId = line.subcategoryId || line.categoryId;
      const category = state.expenseCategories.find((c) => c.id === catId);
      const expenseCoa = category
        ? getCoaByCode(category.coaCode, state)
        : undefined;
      if (expenseCoa) {
        const lineShare =
          voucher.grandTotalPaise > 0
            ? Math.round((line.totalPaise / voucher.grandTotalPaise) * expensePayPortion)
            : expensePayPortion;
        if (lineShare > 0) {
          jvLines.push({
            coaId: expenseCoa.id,
            debitPaise: lineShare,
            creditPaise: 0,
            narration: line.description,
          });
        }
      }
    }
  }

  if (payMode === "cash") {
    const poolId = input.poolId || voucher.poolId;
    if (!poolId) return fail("Select a cash pool");
    const res = postCashMovement({
      poolId,
      date,
      direction: "out",
      amountPaise: payNow,
      sourceType: "expense_voucher",
      sourceId: voucher.id,
      narration: voucher.narration || voucher.voucherNo,
      transactionRef: input.transactionRef,
    });
    if (!res.ok) return res;
    if (input.postJv !== false && jvLines.length) {
      const cashCoa = getCoaByCode(COA_CASH_IN_HAND, state);
      if (cashCoa) {
        const debitTotal = jvLines.reduce((s, l) => s + l.debitPaise, 0);
        postJournal({
          date,
          voucherNo: voucher.voucherNo,
          narration: voucher.narration || "Expense payment",
          sourceType: "expense_voucher",
          sourceId: voucher.id,
          lines: [
            ...jvLines,
            {
              coaId: cashCoa.id,
              debitPaise: 0,
              creditPaise: debitTotal || payNow,
              narration: "",
            },
          ],
        });
      }
    }
    const newPaid = voucher.paidPaise + payNow;
    const updated = normalizeVoucher({
      ...voucher,
      mode: payMode,
      paidPaise: newPaid,
      duePaise: Math.max(0, voucher.grandTotalPaise - newPaid),
      paidOn: date,
      poolId,
      paymentSplits: [
        ...voucher.paymentSplits,
        normalizePaymentSplit({
          mode: payMode,
          amountPaise: payNow,
          poolId,
          bankId: "",
          transactionRef: input.transactionRef ?? "",
        }),
      ],
    });
    const s2 = loadAccounts();
    saveAccounts({
      ...s2,
      expenseVouchers: s2.expenseVouchers.map((v) =>
        v.id === voucherId ? updated : v,
      ),
    });
    settleVendorPaymentForExpensePay(expenseLines, vendorPayIntent, date);
    return { ok: true, voucher: updated };
  }

  const bankId = input.bankId || voucher.bankId;
  if (!bankId) return fail("Select a bank account");
  const res = postBankMovement({
    bankId,
    date,
    direction: "cr",
    amountPaise: payNow,
    mode: payMode,
    sourceType: "expense_voucher",
    sourceId: voucher.id,
    narration: voucher.narration || voucher.voucherNo,
    transactionRef: input.transactionRef,
  });
  if (!res.ok) return res;
  if (input.postJv !== false && jvLines.length) {
    const bankCoa = getCoaByCode(COA_BANK_ACCOUNTS, state);
    if (bankCoa) {
      const debitTotal = jvLines.reduce((s, l) => s + l.debitPaise, 0);
      postJournal({
        date,
        voucherNo: voucher.voucherNo,
        narration: voucher.narration || "Expense payment",
        sourceType: "expense_voucher",
        sourceId: voucher.id,
        lines: [
          ...jvLines,
          {
            coaId: bankCoa.id,
            debitPaise: 0,
            creditPaise: debitTotal || payNow,
            narration: "",
          },
        ],
      });
    }
  }
  const newPaid = voucher.paidPaise + payNow;
  const updated = normalizeVoucher({
    ...voucher,
    mode: payMode,
    paidPaise: newPaid,
    duePaise: Math.max(0, voucher.grandTotalPaise - newPaid),
    paidOn: date,
    bankId,
    paymentSplits: [
      ...voucher.paymentSplits,
      normalizePaymentSplit({
        mode: payMode,
        amountPaise: payNow,
        poolId: "",
        bankId,
        transactionRef: input.transactionRef ?? "",
      }),
    ],
  });
  const s2 = loadAccounts();
  saveAccounts({
    ...s2,
    expenseVouchers: s2.expenseVouchers.map((v) =>
      v.id === voucherId ? updated : v,
    ),
  });
  settleVendorPaymentForExpensePay(expenseLines, vendorPayIntent, date);
  return { ok: true, voucher: updated };
}

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

/* ─── Vendors + bills ──────────────────────────────────────── */

export function upsertVendor(
  patch: Partial<AccountsVendor> & { name: string },
): { ok: true; vendor: AccountsVendor } | { ok: false; error: string } {
  const name = patch.name.trim();
  if (!name) return fail("Vendor name required");
  const state = loadAccounts();
  const existing = patch.id
    ? state.vendors.find((v) => v.id === patch.id)
    : undefined;
  const vendor = normalizeVendor({
    ...existing,
    ...patch,
    name,
    id: existing?.id ?? patch.id ?? id("ven"),
  });
  const vendors = existing
    ? state.vendors.map((v) => (v.id === vendor.id ? vendor : v))
    : [...state.vendors, vendor];
  saveAccounts({ ...state, vendors });
  return { ok: true, vendor };
}

export function checkVendorRemoval(
  vendorId: string,
  state?: AccountsState,
): AccountsRemovalCheck {
  const s = state ?? loadAccounts();
  const vendor = s.vendors.find((v) => v.id === vendorId);
  const label = vendor?.name ?? "this vendor";
  const blockers: string[] = [];
  const billN = s.vendorBills.filter((b) => b.vendorId === vendorId).length;
  if (billN > 0) blockers.push(`${billN} vendor bill(s)`);
  const payableN = s.payables.filter((p) => p.vendorId === vendorId).length;
  if (payableN > 0) blockers.push(`${payableN} payable(s)`);
  const voucherN = s.expenseVouchers.filter(
    (v) =>
      !isExpenseVoucherCancelled(v) &&
      (v.vendorId === vendorId ||
        v.lines.some((l) => l.vendorId === vendorId)),
  ).length;
  if (voucherN > 0) blockers.push(`${voucherN} expense voucher(s)`);
  const ruleN = s.recurringRules.filter((r) => r.vendorId === vendorId).length;
  if (ruleN > 0) blockers.push(`${ruleN} recurring rule(s)`);
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

export function deleteVendor(
  vendorId: string,
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const vendor = state.vendors.find((v) => v.id === vendorId);
  if (!vendor) return fail("Vendor not found");
  const check = checkVendorRemoval(vendorId, state);
  if (!check.canRemove) return fail(check.suggestion);
  saveAccounts({
    ...state,
    vendors: state.vendors.filter((v) => v.id !== vendorId),
    expenseCategories: state.expenseCategories.map((c) =>
      c.vendorIds?.length
        ? { ...c, vendorIds: c.vendorIds.filter((vid) => vid !== vendorId) }
        : c,
    ),
  });
  return { ok: true };
}

export function createVendorBill(input: {
  vendorId: string;
  billNo?: string;
  supplierInvoiceNo?: string;
  receiptNo?: string;
  billDate?: string;
  dueOn?: string;
  amountPaise?: number;
  categoryId?: string;
  narration?: string;
  attachmentNote?: string;
  discountType?: VendorBill["discountType"];
  discountPaise?: number;
  taxPaise?: number;
  grandTotalPaise?: number;
  lines?: VendorBillLine[];
}): { ok: true; bill: VendorBill; payable: AccountsPayable } | { ok: false; error: string } {
  const state = loadAccounts();
  if (!state.vendors.some((v) => v.id === input.vendorId)) {
    return fail("Vendor not found");
  }

  const lines = Array.isArray(input.lines) ? input.lines : [];
  const discountPaise = Math.max(
    0,
    Math.round(Number(input.discountPaise) || 0),
  );
  const taxPaise = Math.max(0, Math.round(Number(input.taxPaise) || 0));

  const grossPaise = lines.length
    ? lines.reduce((s, l) => s + vendorBillLineTotalPaise(l), 0)
    : Math.max(0, Math.round(Number(input.amountPaise) || 0));

  const grandTotalPaise = Math.max(
    0,
    Math.round(
      Number(
        input.grandTotalPaise ??
          (lines.length ? grossPaise - discountPaise + taxPaise : input.amountPaise),
      ) || 0,
    ),
  );

  if (grandTotalPaise <= 0) return fail("Amount must be greater than zero");
  const amount = grandTotalPaise;
  const bill = normalizeBill({
    id: id("bill"),
    vendorId: input.vendorId,
    receiptNo: input.receiptNo ?? "",
    billNo: input.supplierInvoiceNo ?? input.billNo ?? "",
    supplierInvoiceNo: input.supplierInvoiceNo ?? input.billNo ?? "",
    billDate: input.billDate || todayIso(),
    dueOn: input.dueOn || input.billDate || todayIso(),
    amountPaise: amount,
    categoryId: input.categoryId ?? lines[0]?.categoryId ?? "",
    discountType: input.discountType ?? "none",
    discountPaise,
    taxPaise,
    grandTotalPaise,
    lines,
    narration: input.narration ?? "",
    attachmentNote: input.attachmentNote ?? "",
  });
  const payable = normalizePayable({
    id: id("pay"),
    vendorId: input.vendorId,
    sourceType: "expense_bill",
    sourceId: bill.id,
    amountPaise: amount,
    dueOn: bill.dueOn,
    note: input.narration ?? bill.billNo,
  });
  saveAccounts({
    ...state,
    vendorBills: [bill, ...state.vendorBills],
    payables: [payable, ...state.payables],
  });

  // Accrual: Dr Store Purchases (or line category) · Cr Accounts Payable
  saveAccounts(ensureStoreCoaAccounts(loadAccounts()));
  const purchaseCoa =
    getCoaByCode(
      getExpenseCategory(bill.categoryId)?.coaCode || COA_STORE_PURCHASES,
    ) || getCoaByCode(COA_STORE_PURCHASES);
  const apCoa = getCoaByCode(COA_ACCOUNTS_PAYABLE);
  if (purchaseCoa && apCoa && amount > 0) {
    postJournal({
      date: bill.billDate,
      narration:
        bill.narration ||
        `Vendor bill ${bill.receiptNo || bill.billNo || bill.id}`,
      sourceType: "vendor_bill",
      sourceId: bill.id,
      lines: [
        {
          coaId: purchaseCoa.id,
          debitPaise: amount,
          creditPaise: 0,
          narration: "Purchase",
        },
        {
          coaId: apCoa.id,
          debitPaise: 0,
          creditPaise: amount,
          narration: "AP",
        },
      ],
    });
  }

  return { ok: true, bill, payable };
}

export function markBillPaid(
  billId: string,
  paidOn = todayIso(),
  paidPaise?: number,
): { ok: true; bill: VendorBill } | { ok: false; error: string } {
  const state = loadAccounts();
  const bill = state.vendorBills.find((b) => b.id === billId);
  if (!bill) return fail("Bill not found");
  const amount = Math.min(bill.amountPaise, Math.max(0, paidPaise ?? bill.amountPaise));
  const status: VendorBillStatus =
    amount >= bill.amountPaise ? "paid" : amount > 0 ? "partial" : "open";
  const updatedBill: VendorBill = { ...bill, paidPaise: amount, status };
  const payables = state.payables.map((p) => {
    if (p.sourceType !== "expense_bill" || p.sourceId !== billId) return p;
    const pStatus: PayableStatus =
      amount >= p.amountPaise ? "paid" : amount > 0 ? "partial" : "open";
    return { ...p, paidPaise: amount, status: pStatus, paidOn };
  });
  saveAccounts({
    ...state,
    vendorBills: state.vendorBills.map((b) => (b.id === billId ? updatedBill : b)),
    payables,
  });
  return { ok: true, bill: updatedBill };
}

/**
 * Reduce vendor bill / payable after a purchase return (credit note).
 * Caps paidPaise if already overpaid relative to the new amount.
 */
export function creditVendorBill(
  billId: string,
  creditPaise: number,
  note?: string,
): { ok: true; bill: VendorBill } | { ok: false; error: string } {
  const state = loadAccounts();
  const bill = state.vendorBills.find((b) => b.id === billId);
  if (!bill) return fail("Bill not found");
  const credit = Math.max(0, Math.round(Number(creditPaise) || 0));
  if (credit <= 0) return fail("Credit amount must be positive");
  if (credit > bill.amountPaise) {
    return fail("Return credit exceeds bill amount");
  }
  const newAmount = Math.max(0, bill.amountPaise - credit);
  const paidPaise = Math.min(bill.paidPaise, newAmount);
  const status: VendorBillStatus =
    newAmount <= 0 || paidPaise >= newAmount
      ? "paid"
      : paidPaise > 0
        ? "partial"
        : "open";
  const updatedBill: VendorBill = {
    ...bill,
    amountPaise: newAmount,
    grandTotalPaise: newAmount,
    paidPaise,
    status,
    narration: note
      ? `${bill.narration ? bill.narration + " · " : ""}Return credit ₹${(credit / 100).toFixed(0)}${note ? ` · ${note}` : ""}`.trim()
      : bill.narration,
  };
  const payables = state.payables.map((p) => {
    if (p.sourceType !== "expense_bill" || p.sourceId !== billId) return p;
    const pPaid = Math.min(p.paidPaise, newAmount);
    const pStatus: PayableStatus =
      newAmount <= 0 || pPaid >= newAmount
        ? "paid"
        : pPaid > 0
          ? "partial"
          : "open";
    return {
      ...p,
      amountPaise: newAmount,
      paidPaise: pPaid,
      status: pStatus,
      note: note ? `${p.note} · return` : p.note,
    };
  });
  saveAccounts({
    ...state,
    vendorBills: state.vendorBills.map((b) =>
      b.id === billId ? updatedBill : b,
    ),
    payables,
  });

  // Credit note JV: Dr AP · Cr Store Purchases
  saveAccounts(ensureStoreCoaAccounts(loadAccounts()));
  const purchaseCoa =
    getCoaByCode(
      getExpenseCategory(updatedBill.categoryId)?.coaCode || COA_STORE_PURCHASES,
    ) || getCoaByCode(COA_STORE_PURCHASES);
  const apCoa = getCoaByCode(COA_ACCOUNTS_PAYABLE);
  if (purchaseCoa && apCoa && credit > 0) {
    postJournal({
      date: todayIso(),
      narration: note
        ? `Purchase return ${note}`
        : `Purchase return · ${updatedBill.receiptNo || updatedBill.billNo}`,
      sourceType: "purchase_return",
      sourceId: id("prv"),
      lines: [
        {
          coaId: apCoa.id,
          debitPaise: credit,
          creditPaise: 0,
          narration: "AP credit",
        },
        {
          coaId: purchaseCoa.id,
          debitPaise: 0,
          creditPaise: credit,
          narration: "Purchase reverse",
        },
      ],
    });
  }

  return { ok: true, bill: updatedBill };
}

/** Open / partial vendor bills for a vendor (purchase AP). */
export function listVendorBillsForVendor(
  vendorId: string,
  state?: AccountsState,
): VendorBill[] {
  const s = state ?? loadAccounts();
  return s.vendorBills
    .filter((b) => b.vendorId === vendorId)
    .sort((a, b) => b.billDate.localeCompare(a.billDate));
}

export function vendorBillBalancePaise(bill: VendorBill): number {
  return Math.max(0, bill.amountPaise - bill.paidPaise);
}

/** Open AP balance for a vendor (sum of unpaid payables). */
export function vendorOutstandingBalancePaise(
  vendorId: string,
  state?: AccountsState,
): number {
  const s = state ?? loadAccounts();
  return s.payables
    .filter((p) => p.vendorId === vendorId && p.status !== "paid")
    .reduce((sum, p) => sum + Math.max(0, p.amountPaise - p.paidPaise), 0);
}

function vendorPaymentTotalsByVendor(
  lines: ExpenseVoucherLine[],
): Map<string, number> {
  const byVendor = new Map<string, number>();
  for (const line of lines) {
    if (!line.vendorId || line.paidPaise <= 0) continue;
    byVendor.set(
      line.vendorId,
      (byVendor.get(line.vendorId) ?? 0) + line.paidPaise,
    );
  }
  return byVendor;
}

function validateVendorPaymentAmounts(
  lines: ExpenseVoucherLine[],
  state: AccountsState,
): string | null {
  for (const [vendorId, amount] of vendorPaymentTotalsByVendor(lines)) {
    const balance = vendorOutstandingBalancePaise(vendorId, state);
    if (amount > balance) {
      const vendor = state.vendors.find((v) => v.id === vendorId);
      const name = vendor?.name ?? "vendor";
      const amt = (amount / 100).toFixed(2);
      const bal = (balance / 100).toFixed(2);
      return `Payment to ${name} (₹${amt}) exceeds outstanding balance (₹${bal})`;
    }
  }
  return null;
}

function applyVendorPaymentAllocation(
  state: AccountsState,
  vendorId: string,
  amountPaise: number,
  paidOn: string,
): AccountsState {
  let remaining = Math.max(0, Math.round(amountPaise));
  if (remaining <= 0) return state;

  const openPayables = state.payables
    .filter((p) => p.vendorId === vendorId && p.status !== "paid")
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));

  let payables = [...state.payables];
  let vendorBills = [...state.vendorBills];

  for (const payable of openPayables) {
    if (remaining <= 0) break;
    const due = Math.max(0, payable.amountPaise - payable.paidPaise);
    if (due <= 0) continue;
    const apply = Math.min(remaining, due);
    remaining -= apply;
    const newPaid = payable.paidPaise + apply;
    const status: PayableStatus =
      newPaid >= payable.amountPaise ? "paid" : "partial";
    payables = payables.map((p) =>
      p.id === payable.id ? { ...p, paidPaise: newPaid, status, paidOn } : p,
    );
    if (payable.sourceType === "expense_bill") {
      vendorBills = vendorBills.map((b) => {
        if (b.id !== payable.sourceId) return b;
        const bPaid = Math.min(b.amountPaise, b.paidPaise + apply);
        const bStatus: VendorBillStatus =
          bPaid >= b.amountPaise ? "paid" : bPaid > 0 ? "partial" : "open";
        return { ...b, paidPaise: bPaid, status: bStatus };
      });
    }
  }

  return { ...state, payables, vendorBills };
}

function settleVendorPaymentForExpensePay(
  lines: ExpenseVoucherLine[],
  vendorPayAmount: number,
  paidOn: string,
): void {
  if (vendorPayAmount <= 0) return;
  const totalIntent = vendorPaymentPaiseFromVoucherLines(lines);
  if (totalIntent <= 0) return;

  const byVendor = new Map<string, number>();
  for (const line of lines) {
    if (!line.vendorId || line.paidPaise <= 0) continue;
    const share = Math.round((line.paidPaise / totalIntent) * vendorPayAmount);
    if (share > 0) {
      byVendor.set(line.vendorId, (byVendor.get(line.vendorId) ?? 0) + share);
    }
  }

  let state = loadAccounts();
  for (const [vendorId, amount] of byVendor) {
    state = applyVendorPaymentAllocation(state, vendorId, amount, paidOn);
  }
  saveAccounts(state);
}

function vendorPaymentPaiseFromVoucherLines(
  lines: ExpenseVoucherLine[],
): number {
  let total = 0;
  for (const line of lines) {
    if (line.vendorId && line.paidPaise > 0) total += line.paidPaise;
  }
  return total;
}

/* ─── Unified payables (incl. transport fleet) ────────────── */

export function listUnifiedPayables(state?: AccountsState): AccountsPayable[] {
  const s = state ?? loadAccounts();
  return s.payables
    .filter((p) => p.status !== "paid")
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

/** Mirror open transport-fleet payables into the accounts payables list. */
export function syncTransportPayables(): AccountsState {
  try {
    const t = loadTransport();
    const openFleet = listOpenTransportPayables(t);
    const state = loadAccounts();
    let payables = [...state.payables];
    for (const fp of openFleet) {
      const idx = payables.findIndex(
        (p) => p.sourceType === "transport_fleet" && p.sourceId === fp.id,
      );
      const row = normalizePayable({
        id: idx >= 0 ? payables[idx]!.id : id("pay"),
        vendorId: "",
        sourceType: "transport_fleet",
        sourceId: fp.id,
        amountPaise: fp.amountPaise,
        dueOn: fp.dueOn,
        status: fp.status === "paid" ? "paid" : fp.status,
        paidPaise: fp.paidPaise,
        paidOn: fp.paidOn,
        note: fp.note,
      });
      if (idx >= 0) payables[idx] = row;
      else payables = [row, ...payables];
    }
    const next = { ...state, payables };
    saveAccounts(next);
    return next;
  } catch {
    return loadAccounts();
  }
}

export function payUnifiedPayable(
  payableId: string,
  input: {
    date?: string;
    mode: "cash" | "bank";
    poolId?: string;
    bankId?: string;
    bankMode?: PaymentMode;
    amountPaise?: number;
  },
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const payable = state.payables.find((p) => p.id === payableId);
  if (!payable) return fail("Payable not found");
  const remaining = payable.amountPaise - payable.paidPaise;
  const amount = Math.min(remaining, Math.max(0, input.amountPaise ?? remaining));
  if (amount <= 0) return fail("Nothing due on this payable");
  const date = input.date || todayIso();

  if (input.mode === "cash") {
    if (!input.poolId) return fail("Select a cash pool");
    const res = postCashMovement({
      poolId: input.poolId,
      date,
      direction: "out",
      amountPaise: amount,
      sourceType: "accounts_payable",
      sourceId: payable.id,
      narration: payable.note,
    });
    if (!res.ok) return res;
  } else {
    if (!input.bankId) return fail("Select a bank account");
    const res = postBankMovement({
      bankId: input.bankId,
      date,
      direction: "cr",
      amountPaise: amount,
      mode: input.bankMode ?? "neft",
      sourceType: "accounts_payable",
      sourceId: payable.id,
      narration: payable.note,
    });
    if (!res.ok) return res;
  }

  const apCoa = getCoaByCode(COA_ACCOUNTS_PAYABLE, state);
  const settleCoa = getCoaByCode(
    input.mode === "cash" ? COA_CASH_IN_HAND : COA_BANK_ACCOUNTS,
    state,
  );
  if (apCoa && settleCoa) {
    postJournal({
      date,
      narration: payable.note || "Payable settlement",
      sourceType: "accounts_payable",
      sourceId: payable.id,
      lines: [
        { coaId: apCoa.id, debitPaise: amount, creditPaise: 0, narration: "" },
        { coaId: settleCoa.id, debitPaise: 0, creditPaise: amount, narration: "" },
      ],
    });
  }

  const paidPaise = payable.paidPaise + amount;
  const status: PayableStatus =
    paidPaise >= payable.amountPaise ? "paid" : "partial";
  const s2 = loadAccounts();
  saveAccounts({
    ...s2,
    payables: s2.payables.map((p) =>
      p.id === payableId ? { ...p, paidPaise, status, paidOn: date } : p,
    ),
  });

  if (payable.sourceType === "expense_bill") {
    markBillPaid(payable.sourceId, date, paidPaise);
  } else if (payable.sourceType === "transport_fleet") {
    try {
      markTransportPayablePaid(payable.sourceId, date, paidPaise);
    } catch {
      /* transport module unavailable — accounts-side payable still updated */
    }
  }
  return { ok: true };
}

/* ─── Owner / trustee loans ────────────────────────────────── */

export function upsertTrustee(
  patch: Partial<Trustee> & { name: string },
): { ok: true; trustee: Trustee } | { ok: false; error: string } {
  const name = patch.name.trim();
  if (!name) return fail("Trustee name required");
  const state = loadAccounts();
  const existing = patch.id
    ? state.trustees.find((t) => t.id === patch.id)
    : undefined;
  const trustee = normalizeTrustee({
    ...existing,
    ...patch,
    name,
    id: existing?.id ?? patch.id ?? id("trs"),
  });
  const trustees = existing
    ? state.trustees.map((t) => (t.id === trustee.id ? trustee : t))
    : [...state.trustees, trustee];
  saveAccounts({ ...state, trustees });
  return { ok: true, trustee };
}

function computeEmiPaise(principalPaise: number, ratePct: number, tenureMonths: number): number {
  if (tenureMonths <= 0) return principalPaise;
  if (ratePct <= 0) return Math.round(principalPaise / tenureMonths);
  const r = ratePct / 12 / 100;
  const factor = Math.pow(1 + r, tenureMonths);
  const emi = (principalPaise * r * factor) / (factor - 1);
  return Math.round(emi);
}

export function createOwnerLoan(input: {
  trusteeId: string;
  type: OwnerLoanType;
  principalPaise: number;
  ratePct: number;
  tenureMonths: number;
  startDate?: string;
  note?: string;
  disburseToPoolId?: string;
  disburseToBankId?: string;
}): { ok: true; loan: OwnerLoan; schedule: OwnerLoanScheduleRow[] } | { ok: false; error: string } {
  const state = loadAccounts();
  if (!state.trustees.some((t) => t.id === input.trusteeId)) {
    return fail("Trustee not found");
  }
  const principal = Math.max(0, Math.round(input.principalPaise));
  if (principal <= 0) return fail("Principal amount required");
  const tenure = Math.max(1, Math.round(input.tenureMonths));
  const start = input.startDate || todayIso();
  const emi = computeEmiPaise(principal, input.ratePct, tenure);

  const loan = normalizeLoan({
    id: id("oln"),
    trusteeId: input.trusteeId,
    type: input.type,
    principalPaise: principal,
    ratePct: Math.max(0, input.ratePct),
    tenureMonths: tenure,
    startDate: start,
    note: input.note ?? "",
  });

  const schedule: OwnerLoanScheduleRow[] = [];
  for (let i = 0; i < tenure; i++) {
    const d = new Date(`${start}T12:00:00`);
    d.setMonth(d.getMonth() + i + 1);
    schedule.push(
      normalizeLoanRow({
        id: id("olr"),
        loanId: loan.id,
        installmentNo: i + 1,
        dueOn: d.toISOString().slice(0, 10),
        amountPaise: emi,
      }),
    );
  }

  saveAccounts({
    ...state,
    ownerLoans: [loan, ...state.ownerLoans],
    ownerLoanSchedule: [...schedule, ...state.ownerLoanSchedule],
  });

  const liabilityCoa = getCoaByCode(COA_OWNER_LOANS);
  if (input.disburseToPoolId) {
    const res = postCashMovement({
      poolId: input.disburseToPoolId,
      date: start,
      direction: "in",
      amountPaise: principal,
      sourceType: "owner_loan_disbursement",
      sourceId: loan.id,
      narration: `Loan disbursed — ${loan.type}`,
    });
    const cashCoa = getCoaByCode(COA_CASH_IN_HAND);
    if (res.ok && liabilityCoa && cashCoa) {
      postJournal({
        date: start,
        narration: "Owner loan disbursement",
        sourceType: "owner_loan_disbursement",
        sourceId: loan.id,
        lines: [
          { coaId: cashCoa.id, debitPaise: principal, creditPaise: 0, narration: "" },
          { coaId: liabilityCoa.id, debitPaise: 0, creditPaise: principal, narration: "" },
        ],
      });
    }
  } else if (input.disburseToBankId) {
    const res = postBankMovement({
      bankId: input.disburseToBankId,
      date: start,
      direction: "dr",
      amountPaise: principal,
      mode: "neft",
      sourceType: "owner_loan_disbursement",
      sourceId: loan.id,
      narration: `Loan disbursed — ${loan.type}`,
    });
    const bankCoa = getCoaByCode(COA_BANK_ACCOUNTS);
    if (res.ok && liabilityCoa && bankCoa) {
      postJournal({
        date: start,
        narration: "Owner loan disbursement",
        sourceType: "owner_loan_disbursement",
        sourceId: loan.id,
        lines: [
          { coaId: bankCoa.id, debitPaise: principal, creditPaise: 0, narration: "" },
          { coaId: liabilityCoa.id, debitPaise: 0, creditPaise: principal, narration: "" },
        ],
      });
    }
  }

  return { ok: true, loan, schedule };
}

export function recordOwnerLoanPayment(
  scheduleId: string,
  input: {
    paidOn?: string;
    paidAmountPaise?: number;
    mode: "cash" | "bank";
    poolId?: string;
    bankId?: string;
    bankMode?: PaymentMode;
  },
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const row = state.ownerLoanSchedule.find((r) => r.id === scheduleId);
  if (!row) return fail("Schedule row not found");
  if (row.status === "paid") return fail("Installment already paid");
  const amount = Math.max(0, Math.round(input.paidAmountPaise ?? row.amountPaise));
  const paidOn = input.paidOn || todayIso();

  if (input.mode === "cash") {
    if (!input.poolId) return fail("Select a cash pool");
    const res = postCashMovement({
      poolId: input.poolId,
      date: paidOn,
      direction: "out",
      amountPaise: amount,
      sourceType: "owner_loan_emi",
      sourceId: row.id,
      narration: `Loan installment #${row.installmentNo}`,
    });
    if (!res.ok) return res;
  } else {
    if (!input.bankId) return fail("Select a bank account");
    const res = postBankMovement({
      bankId: input.bankId,
      date: paidOn,
      direction: "cr",
      amountPaise: amount,
      mode: input.bankMode ?? "neft",
      sourceType: "owner_loan_emi",
      sourceId: row.id,
      narration: `Loan installment #${row.installmentNo}`,
    });
    if (!res.ok) return res;
  }

  const liabilityCoa = getCoaByCode(COA_OWNER_LOANS);
  const settleCoa = getCoaByCode(
    input.mode === "cash" ? COA_CASH_IN_HAND : COA_BANK_ACCOUNTS,
  );
  if (liabilityCoa && settleCoa) {
    postJournal({
      date: paidOn,
      narration: `Owner loan installment #${row.installmentNo}`,
      sourceType: "owner_loan_emi",
      sourceId: row.id,
      lines: [
        { coaId: liabilityCoa.id, debitPaise: amount, creditPaise: 0, narration: "" },
        { coaId: settleCoa.id, debitPaise: 0, creditPaise: amount, narration: "" },
      ],
    });
  }

  const s2 = loadAccounts();
  const updatedSchedule = s2.ownerLoanSchedule.map((r) =>
    r.id === scheduleId
      ? { ...r, status: "paid" as const, paidOn, paidAmountPaise: amount }
      : r,
  );
  const stillDue = updatedSchedule.some(
    (r) => r.loanId === row.loanId && r.status === "due",
  );
  saveAccounts({
    ...s2,
    ownerLoanSchedule: updatedSchedule,
    ownerLoans: stillDue
      ? s2.ownerLoans
      : s2.ownerLoans.map((l) =>
          l.id === row.loanId ? { ...l, status: "closed" as const } : l,
        ),
  });
  return { ok: true };
}

export function listOwnerLoanDue(
  asOf = todayIso(),
  state?: AccountsState,
): (OwnerLoanScheduleRow & { loan?: OwnerLoan })[] {
  const s = state ?? loadAccounts();
  return s.ownerLoanSchedule
    .filter((r) => r.status === "due" && r.dueOn <= asOf)
    .map((r) => ({ ...r, loan: s.ownerLoans.find((l) => l.id === r.loanId) }))
    .sort((a, b) => a.dueOn.localeCompare(b.dueOn));
}

/* ─── Journal / ledger ─────────────────────────────────────── */

export function postJournal(input: {
  date?: string;
  voucherNo?: string;
  narration?: string;
  lines: JournalLine[];
  sourceType?: string;
  sourceId?: string;
  fiscalYearCode?: string;
}): { ok: true; entry: JournalEntry } | { ok: false; error: string } {
  const lines = (input.lines ?? []).filter(
    (l) => l.coaId && (l.debitPaise > 0 || l.creditPaise > 0),
  );
  if (lines.length === 0) return fail("At least one journal line is required");
  const totalDebit = lines.reduce((n, l) => n + Math.round(l.debitPaise), 0);
  const totalCredit = lines.reduce((n, l) => n + Math.round(l.creditPaise), 0);
  if (totalDebit !== totalCredit) return fail("Journal entry is not balanced");
  if (totalDebit <= 0) return fail("Journal entry amount must be greater than zero");

  const state = loadAccounts();
  const date = input.date || todayIso();
  const fy =
    (input.fiscalYearCode
      ? state.fiscalYears.find((f) => f.code === input.fiscalYearCode)
      : undefined) ?? resolveFiscalYearForDate(date, state);
  if (fy?.status === "closed") {
    return fail(`Fiscal year ${fy.label} is closed — reopen to post journals`);
  }

  const entry = normalizeJournal({
    id: id("jv"),
    date,
    voucherNo: input.voucherNo ?? "",
    narration: input.narration ?? "",
    lines,
    sourceType: input.sourceType ?? "",
    sourceId: input.sourceId ?? "",
    fiscalYearCode: fy?.code ?? input.fiscalYearCode ?? "",
    createdAt: new Date().toISOString(),
    voidedAt: null,
  });
  saveAccounts({ ...state, journalEntries: [entry, ...state.journalEntries] });
  return { ok: true, entry };
}

export function resolveFiscalYearForDate(
  date: string,
  state?: AccountsState,
): FiscalYear | undefined {
  const s = state ?? loadAccounts();
  return s.fiscalYears.find(
    (fy) => fy.startDate <= date && fy.endDate >= date,
  );
}

export function setFiscalYearStatus(
  code: string,
  status: FiscalYearStatus,
): { ok: true; fiscalYear: FiscalYear } | { ok: false; error: string } {
  const state = loadAccounts();
  const fy = state.fiscalYears.find((f) => f.code === code);
  if (!fy) return fail("Fiscal year not found");
  const updated = { ...fy, status };
  saveAccounts({
    ...state,
    fiscalYears: state.fiscalYears.map((f) => (f.code === code ? updated : f)),
  });
  return { ok: true, fiscalYear: updated };
}

export function listJournals(state?: AccountsState): JournalEntry[] {
  const s = state ?? loadAccounts();
  return [...s.journalEntries].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    return byDate !== 0 ? byDate : b.createdAt.localeCompare(a.createdAt);
  });
}

/** Active (non-void) journal lines for one COA in a period, with running balance. */
export function coaLedgerRows(
  coaId: string,
  from: string,
  to: string,
  state?: AccountsState,
): {
  date: string;
  voucherNo: string;
  narration: string;
  sourceType: string;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
}[] {
  const s = state ?? loadAccounts();
  const coa = s.coaAccounts.find((c) => c.id === coaId);
  if (!coa) return [];
  const debitNormal = coa.group === "assets" || coa.group === "expense";
  const lines: {
    date: string;
    voucherNo: string;
    narration: string;
    sourceType: string;
    debitPaise: number;
    creditPaise: number;
    sortKey: string;
  }[] = [];
  for (const entry of s.journalEntries) {
    if (entry.voidedAt) continue;
    if (entry.date < from || entry.date > to) continue;
    for (const line of entry.lines) {
      if (line.coaId !== coaId) continue;
      if (!line.debitPaise && !line.creditPaise) continue;
      lines.push({
        date: entry.date,
        voucherNo: entry.voucherNo || entry.id.slice(-8),
        narration: line.narration || entry.narration,
        sourceType: entry.sourceType,
        debitPaise: line.debitPaise,
        creditPaise: line.creditPaise,
        sortKey: `${entry.date}_${entry.createdAt}`,
      });
    }
  }
  lines.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  let bal = 0;
  return lines.map((l) => {
    bal += debitNormal
      ? l.debitPaise - l.creditPaise
      : l.creditPaise - l.debitPaise;
    return {
      date: l.date,
      voucherNo: l.voucherNo,
      narration: l.narration,
      sourceType: l.sourceType,
      debitPaise: l.debitPaise,
      creditPaise: l.creditPaise,
      balancePaise: bal,
    };
  });
}

/** Group-wise totals from trial balance (assets / liabilities / …). */
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
export function voidCashLedgerEntry(
  entryId: string,
  reason = "",
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const entry = state.cashLedger.find((e) => e.id === entryId);
  if (!entry) return fail("Cash entry not found");
  if (entry.voidedAt) return fail("Already cancelled");
  const pool = state.cashPools.find((p) => p.id === entry.poolId);
  if (!pool) return fail("Cash pool not found");
  const reverse = entry.direction === "in" ? -entry.amountPaise : entry.amountPaise;
  const nextBalance = pool.balancePaise + reverse;
  if (nextBalance < 0) return fail("Cannot cancel — pool balance would go negative");
  const now = new Date().toISOString();
  saveAccounts({
    ...state,
    cashPools: state.cashPools.map((p) =>
      p.id === pool.id ? { ...p, balancePaise: nextBalance } : p,
    ),
    cashLedger: state.cashLedger.map((e) =>
      e.id === entryId
        ? { ...e, voidedAt: now, cancelReason: reason.trim() || e.cancelReason }
        : e,
    ),
  });
  return { ok: true };
}

/** Cancel a bank ledger payment/receipt. */
export function voidBankLedgerEntry(
  entryId: string,
  reason = "",
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const entry = state.bankLedger.find((e) => e.id === entryId);
  if (!entry) return fail("Bank entry not found");
  if (entry.voidedAt) return fail("Already cancelled");
  const now = new Date().toISOString();
  saveAccounts({
    ...state,
    bankLedger: state.bankLedger.map((e) =>
      e.id === entryId
        ? { ...e, voidedAt: now, cancelReason: reason.trim() || e.cancelReason }
        : e,
    ),
  });
  return { ok: true };
}

/** Cancel a journal voucher (excluded from TB / P&L thereafter). */
export function voidJournalEntry(
  journalId: string,
  reason = "",
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const entry = state.journalEntries.find((j) => j.id === journalId);
  if (!entry) return fail("Journal not found");
  if (entry.voidedAt) return fail("Already cancelled");
  const now = new Date().toISOString();
  saveAccounts({
    ...state,
    journalEntries: state.journalEntries.map((j) =>
      j.id === journalId
        ? { ...j, voidedAt: now, cancelReason: reason.trim() || j.cancelReason }
        : j,
    ),
  });
  return { ok: true };
}

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

/* ─── Day-close → cash book ───────────────────────────────── */

export function transferCashBetweenPools(input: {
  fromPoolId: string;
  toPoolId: string;
  amountPaise: number;
  date?: string;
  sourceType?: string;
  sourceId?: string;
  narration?: string;
}): { ok: true } | { ok: false; error: string } {
  const amount = Math.round(input.amountPaise);
  if (amount <= 0) return fail("Amount must be greater than zero");
  if (input.fromPoolId === input.toPoolId) return fail("Pick two different pools");
  const sourceId = input.sourceId ?? id("xfer");
  const date = input.date || todayIso();
  const out = postCashMovement({
    poolId: input.fromPoolId,
    date,
    direction: "out",
    amountPaise: amount,
    sourceType: input.sourceType ?? "pool_transfer",
    sourceId: `${sourceId}_out`,
    narration: input.narration ?? "Pool transfer",
  });
  if (!out.ok) return out;
  const inn = postCashMovement({
    poolId: input.toPoolId,
    date,
    direction: "in",
    amountPaise: amount,
    sourceType: input.sourceType ?? "pool_transfer",
    sourceId: `${sourceId}_in`,
    narration: input.narration ?? "Pool transfer",
  });
  if (!inn.ok) return inn;
  return { ok: true };
}

/**
 * On Fee Take day-close approve: move counted cash drawer → main.
 * Fee income / counter cash should already be posted via postFeeCollectionToAccounts.
 */
export function applyDayCloseHandover(session: {
  id: string;
  closeDate: string;
  systemCashPaise: number;
  physicalCashPaise: number;
}): { ok: true; applied: boolean } | { ok: false; error: string } {
  seedAccountsIfEmpty();
  const state = loadAccounts();
  const sourceId = `day_close_${session.id}`;
  if (
    state.cashLedger.some(
      (e) => e.sourceId === sourceId || e.sourceId.startsWith(`${sourceId}_`),
    )
  ) {
    return { ok: true, applied: false };
  }

  const drawer = state.cashPools.find((p) => p.code === "drawer");
  const main = state.cashPools.find((p) => p.code === "main");
  if (!drawer || !main) return fail("Cash pools not seeded");

  const amount = Math.max(
    0,
    Math.round(session.physicalCashPaise || session.systemCashPaise),
  );
  if (amount <= 0) return { ok: true, applied: false };

  if (drawer.balancePaise < amount) {
    const topUp = amount - drawer.balancePaise;
    const res = postCashMovement({
      poolId: drawer.id,
      date: session.closeDate,
      direction: "in",
      amountPaise: topUp,
      sourceType: "fee_day_close_backfill",
      sourceId: `${sourceId}_backfill`,
      narration: "Day-close variance / backfill to drawer",
    });
    if (!res.ok) return res;
  }

  const xfer = transferCashBetweenPools({
    fromPoolId: drawer.id,
    toPoolId: main.id,
    amountPaise: amount,
    date: session.closeDate,
    sourceType: "fee_day_close",
    sourceId,
    narration: "Day close cash handover · drawer → main",
  });
  if (!xfer.ok) return xfer;
  return { ok: true, applied: true };
}

export function setModeBankMap(
  entries: ModeBankMapEntry[],
): AccountsState {
  const state = loadAccounts();
  const next = { ...state, modeBankMap: entries };
  saveAccounts(next);
  return next;
}

/**
 * Post fee collection to cash/bank books (idempotent by voucher id).
 * Cash → drawer; UPI/NEFT/card/cheque → mapped bank.
 * JV: Dr Cash/Bank · Cr Fee Income (fees) · Cr AR (store dues collected).
 * When storeAmountPaise is set, that portion settles store AR instead of fee income.
 */
export function postFeeCollectionToAccounts(input: {
  voucherId: string;
  collectionDate: string;
  receiptNo?: string;
  label?: string;
  tenders: { mode: string; amountPaise: number; bankAccountId?: string; ref?: string }[];
  /** Portion of collection that settles store credit dues. */
  storeAmountPaise?: number;
}): { ok: true; posted: boolean } | { ok: false; error: string } {
  seedAccountsIfEmpty();
  const ensured = ensureStoreCoaAccounts(loadAccounts());
  saveAccounts(ensured);
  const sourceId = `fee_v_${input.voucherId}`;
  const state = loadAccounts();
  if (
    state.cashLedger.some((e) => e.sourceId === sourceId || e.sourceId.startsWith(`${sourceId}_`)) ||
    state.bankLedger.some((e) => e.sourceId === sourceId || e.sourceId.startsWith(`${sourceId}_`)) ||
    state.journalEntries.some((j) => j.sourceId === sourceId)
  ) {
    return { ok: true, posted: false };
  }

  const drawer = state.cashPools.find((p) => p.code === "drawer");
  if (!drawer) return fail("Drawer cash pool not seeded");

  const cashPaise = input.tenders
    .filter((t) => t.mode === "cash" && t.amountPaise > 0)
    .reduce((n, t) => n + t.amountPaise, 0);
  const bankTenders = input.tenders.filter(
    (t) => t.mode !== "cash" && t.amountPaise > 0,
  );
  const narrationBase =
    input.receiptNo
      ? `Fee receipt ${input.receiptNo}`
      : input.label || "Fee collection";

  if (cashPaise > 0) {
    const cashRef =
      input.tenders.find((t) => t.mode === "cash" && t.amountPaise > 0)?.ref?.trim() ||
      input.receiptNo ||
      "";
    const res = postCashMovement({
      poolId: drawer.id,
      date: input.collectionDate,
      direction: "in",
      amountPaise: cashPaise,
      sourceType: "fee_voucher",
      sourceId,
      narration: narrationBase,
      transactionRef: cashRef,
    });
    if (!res.ok) return res;
  }

  for (const t of bankTenders) {
    const mode = (
      ["upi", "cheque", "neft", "rtgs", "card"].includes(t.mode)
        ? t.mode
        : "neft"
    ) as PaymentMode;
    const s = loadAccounts();
    const bankId =
      t.bankAccountId || resolveBankForPaymentMode(mode, s);
    if (!bankId) continue;
    const res = postBankMovement({
      bankId,
      date: input.collectionDate,
      direction: "dr",
      amountPaise: t.amountPaise,
      mode,
      sourceType: "fee_voucher",
      sourceId: `${sourceId}_${mode}`,
      narration: `${narrationBase} · ${mode}`,
      transactionRef: t.ref?.trim() || input.receiptNo || "",
    });
    if (!res.ok) return res;
  }

  const total = cashPaise + bankTenders.reduce((n, t) => n + t.amountPaise, 0);
  if (total > 0) {
    const cashCoa = getCoaByCode(COA_CASH_IN_HAND);
    const bankCoa = getCoaByCode(COA_BANK_ACCOUNTS);
    const feeCoa = getCoaByCode(COA_FEE_INCOME);
    const arCoa = getCoaByCode(COA_ACCOUNTS_RECEIVABLE);
    const storeShare = Math.min(
      total,
      Math.max(0, Math.round(Number(input.storeAmountPaise) || 0)),
    );
    const feeShare = total - storeShare;
    if ((feeCoa || arCoa) && (cashCoa || bankCoa)) {
      const lines: JournalLine[] = [];
      if (cashPaise > 0 && cashCoa) {
        lines.push({
          coaId: cashCoa.id,
          debitPaise: cashPaise,
          creditPaise: 0,
          narration: "Cash",
        });
      }
      const bankTotal = bankTenders.reduce((n, t) => n + t.amountPaise, 0);
      if (bankTotal > 0 && bankCoa) {
        lines.push({
          coaId: bankCoa.id,
          debitPaise: bankTotal,
          creditPaise: 0,
          narration: "Bank modes",
        });
      }
      if (storeShare > 0 && arCoa) {
        lines.push({
          coaId: arCoa.id,
          debitPaise: 0,
          creditPaise: storeShare,
          narration: "Store dues collected",
        });
      } else if (storeShare > 0 && feeCoa) {
        // Fallback if AR missing
        lines.push({
          coaId: feeCoa.id,
          debitPaise: 0,
          creditPaise: storeShare,
          narration: "Store (no AR COA)",
        });
      }
      if (feeShare > 0 && feeCoa) {
        lines.push({
          coaId: feeCoa.id,
          debitPaise: 0,
          creditPaise: feeShare,
          narration: narrationBase,
        });
      }
      if (lines.length >= 2) {
        postJournal({
          date: input.collectionDate,
          narration: narrationBase,
          sourceType: "fee_voucher",
          sourceId,
          lines,
        });
      }
    }
  }

  return { ok: true, posted: true };
}

/**
 * Post store issue / sale into cashbook + GL (idempotent by issue id).
 * Cash: Dr Cash · Cr Store Sales (+ cash drawer in)
 * Credit: Dr AR · Cr Store Sales
 */
export function postStoreSaleToAccounts(input: {
  issueId: string;
  issueNo: string;
  issuedOn: string;
  amountPaise: number;
  paymentMode: "cash" | "credit";
  tenderMode?: string;
  paymentChannel?: string;
  transactionRef?: string;
  narration?: string;
}): { ok: true; posted: boolean } | { ok: false; error: string } {
  seedAccountsIfEmpty();
  const amount = Math.max(0, Math.round(Number(input.amountPaise) || 0));
  if (amount <= 0) return { ok: true, posted: false };

  saveAccounts(ensureStoreCoaAccounts(loadAccounts()));
  const sourceId = `store_sale_${input.issueId}`;
  const state = loadAccounts();
  if (
    state.journalEntries.some((j) => j.sourceId === sourceId) ||
    state.cashLedger.some((e) => e.sourceId === sourceId)
  ) {
    return { ok: true, posted: false };
  }

  const salesCoa = getCoaByCode(COA_STORE_SALES);
  const cashCoa = getCoaByCode(COA_CASH_IN_HAND);
  const arCoa = getCoaByCode(COA_ACCOUNTS_RECEIVABLE);
  if (!salesCoa) return fail("Store Sales COA missing");

  const narration =
    input.narration || `Store sale ${input.issueNo}`;

  if (input.paymentMode === "cash") {
    const drawer = state.cashPools.find((p) => p.code === "drawer");
    if (!drawer) return fail("Drawer cash pool not seeded");
    if (!cashCoa) return fail("Cash COA missing");
    const cashRes = postCashMovement({
      poolId: drawer.id,
      date: input.issuedOn,
      direction: "in",
      amountPaise: amount,
      sourceType: "store_sale",
      sourceId,
      narration,
      transactionRef: input.transactionRef,
    });
    if (!cashRes.ok) return cashRes;
    postJournal({
      date: input.issuedOn,
      narration,
      sourceType: "store_sale",
      sourceId,
      lines: [
        {
          coaId: cashCoa.id,
          debitPaise: amount,
          creditPaise: 0,
          narration: "Cash sale",
        },
        {
          coaId: salesCoa.id,
          debitPaise: 0,
          creditPaise: amount,
          narration: "Store sales",
        },
      ],
    });
  } else {
    if (!arCoa) return fail("Accounts Receivable COA missing");
    postJournal({
      date: input.issuedOn,
      narration,
      sourceType: "store_sale",
      sourceId,
      lines: [
        {
          coaId: arCoa.id,
          debitPaise: amount,
          creditPaise: 0,
          narration: "Store credit",
        },
        {
          coaId: salesCoa.id,
          debitPaise: 0,
          creditPaise: amount,
          narration: "Store sales",
        },
      ],
    });
  }
  return { ok: true, posted: true };
}

/**
 * Reverse store sale for a sell return (idempotent by return id).
 * Credit sale: Dr Store Sales · Cr AR
 * Cash sale: Dr Store Sales · Cr Cash (+ cash drawer out)
 */
export function postStoreSellReturnToAccounts(input: {
  returnId: string;
  returnNo: string;
  returnedOn: string;
  amountPaise: number;
  paymentMode: "cash" | "credit";
  narration?: string;
}): { ok: true; posted: boolean } | { ok: false; error: string } {
  seedAccountsIfEmpty();
  const amount = Math.max(0, Math.round(Number(input.amountPaise) || 0));
  if (amount <= 0) return { ok: true, posted: false };

  saveAccounts(ensureStoreCoaAccounts(loadAccounts()));
  const sourceId = `store_sret_${input.returnId}`;
  const state = loadAccounts();
  if (
    state.journalEntries.some((j) => j.sourceId === sourceId) ||
    state.cashLedger.some((e) => e.sourceId === sourceId)
  ) {
    return { ok: true, posted: false };
  }

  const salesCoa = getCoaByCode(COA_STORE_SALES);
  const cashCoa = getCoaByCode(COA_CASH_IN_HAND);
  const arCoa = getCoaByCode(COA_ACCOUNTS_RECEIVABLE);
  if (!salesCoa) return fail("Store Sales COA missing");

  const narration =
    input.narration || `Store sell return ${input.returnNo}`;

  if (input.paymentMode === "cash") {
    const drawer = state.cashPools.find((p) => p.code === "drawer");
    if (!drawer || !cashCoa) return fail("Cash pool / COA missing");
    const cashRes = postCashMovement({
      poolId: drawer.id,
      date: input.returnedOn,
      direction: "out",
      amountPaise: amount,
      sourceType: "store_sell_return",
      sourceId,
      narration,
    });
    if (!cashRes.ok) return cashRes;
    postJournal({
      date: input.returnedOn,
      narration,
      sourceType: "store_sell_return",
      sourceId,
      lines: [
        {
          coaId: salesCoa.id,
          debitPaise: amount,
          creditPaise: 0,
          narration: "Sales reverse",
        },
        {
          coaId: cashCoa.id,
          debitPaise: 0,
          creditPaise: amount,
          narration: "Cash refund",
        },
      ],
    });
  } else {
    if (!arCoa) return fail("Accounts Receivable COA missing");
    postJournal({
      date: input.returnedOn,
      narration,
      sourceType: "store_sell_return",
      sourceId,
      lines: [
        {
          coaId: salesCoa.id,
          debitPaise: amount,
          creditPaise: 0,
          narration: "Sales reverse",
        },
        {
          coaId: arCoa.id,
          debitPaise: 0,
          creditPaise: amount,
          narration: "AR reduce",
        },
      ],
    });
  }
  return { ok: true, posted: true };
}

/** Save a bank statement recon session (CSV match results). */
export function saveReconSession(input: {
  bankId: string;
  asOf?: string;
  note?: string;
  lines: Omit<ReconSessionLine, "id">[];
}): { ok: true; session: ReconSession } | { ok: false; error: string } {
  const state = loadAccounts();
  if (!state.bankAccounts.some((b) => b.id === input.bankId)) {
    return fail("Bank not found");
  }
  const session = normalizeReconSession({
    id: id("recn"),
    bankId: input.bankId,
    asOf: input.asOf || todayIso(),
    createdAt: new Date().toISOString(),
    note: input.note ?? "",
    lines: input.lines.map((l) => ({ ...l, id: id("rl") })),
  });
  saveAccounts({
    ...state,
    reconSessions: [session, ...state.reconSessions],
  });
  return { ok: true, session };
}

/** Inter-trustee memo — balanced JV on Owner Loans with audit note (novation lite). */
export function postInterTrusteeTransfer(input: {
  fromTrusteeId: string;
  toTrusteeId: string;
  amountPaise: number;
  date?: string;
  note?: string;
}): { ok: true; entry: JournalEntry } | { ok: false; error: string } {
  const amount = Math.round(input.amountPaise);
  if (amount <= 0) return fail("Amount must be greater than zero");
  if (input.fromTrusteeId === input.toTrusteeId) {
    return fail("Pick two different trustees");
  }
  const state = loadAccounts();
  const from = state.trustees.find((t) => t.id === input.fromTrusteeId);
  const to = state.trustees.find((t) => t.id === input.toTrusteeId);
  if (!from || !to) return fail("Trustee not found");
  const liability = getCoaByCode(COA_OWNER_LOANS, state);
  if (!liability) return fail("Owner loans COA missing");

  const date = input.date || todayIso();
  const note =
    input.note?.trim() ||
    `Inter-trustee memo · ${from.name} → ${to.name}`;

  return postJournal({
    date,
    narration: note,
    sourceType: "inter_trustee_memo",
    sourceId: id("itm"),
    lines: [
      {
        coaId: liability.id,
        debitPaise: amount,
        creditPaise: 0,
        narration: `Reduce liability · ${from.name}`,
      },
      {
        coaId: liability.id,
        debitPaise: 0,
        creditPaise: amount,
        narration: `Assume liability · ${to.name}`,
      },
    ],
  });
}


/**
 * Post trust construction cost to CWIP (idempotent by costLineId).
 * Dr CWIP · Cr Cash/Bank (net) · Cr Retention (if any).
 */
export function postTrustCostLineToCwip(input: {
  costLineId: string;
  projectCode: string;
  projectName: string;
  amountPaise: number;
  retentionPaise?: number;
  date?: string;
  narration?: string;
  poolId?: string;
  bankId?: string;
}): { ok: true } | { ok: false; error: string } {
  seedAccountsIfEmpty();
  const state = loadAccounts();
  const sourceId = `trust_cost_${input.costLineId}`;
  if (
    state.journalEntries.some((j) => j.sourceId === sourceId) ||
    state.cashLedger.some((e) => e.sourceId === sourceId) ||
    state.bankLedger.some((e) => e.sourceId === sourceId)
  ) {
    return { ok: true };
  }

  const net = Math.max(0, Math.round(input.amountPaise));
  const retention = Math.max(0, Math.round(input.retentionPaise ?? 0));
  const totalCwip = net + retention;
  if (totalCwip <= 0) return fail("Payment amount must be greater than zero");

  const date = input.date || todayIso();
  const narration =
    input.narration?.trim() ||
    `CWIP · ${input.projectCode} · ${input.projectName}`;

  if (input.poolId) {
    const res = postCashMovement({
      poolId: input.poolId,
      date,
      direction: "out",
      amountPaise: net,
      sourceType: "trust_cwip",
      sourceId,
      narration,
    });
    if (!res.ok) return res;
  } else if (input.bankId) {
    const res = postBankMovement({
      bankId: input.bankId,
      date,
      direction: "cr",
      amountPaise: net,
      mode: "neft",
      sourceType: "trust_cwip",
      sourceId,
      narration,
    });
    if (!res.ok) return res;
  } else {
    const drawer = state.cashPools.find((p) => p.code === "main") ?? state.cashPools[0];
    if (!drawer) return fail("No cash pool for payment");
    const res = postCashMovement({
      poolId: drawer.id,
      date,
      direction: "out",
      amountPaise: net,
      sourceType: "trust_cwip",
      sourceId,
      narration,
    });
    if (!res.ok) return res;
  }

  const cwipCoa = getCoaByCode(COA_CWIP, state);
  const settleCoa = getCoaByCode(
    input.poolId || !input.bankId ? COA_CASH_IN_HAND : COA_BANK_ACCOUNTS,
    state,
  );
  const retentionCoa = getCoaByCode(COA_RETENTION_PAYABLE, state);
  if (!cwipCoa || !settleCoa) return fail("CWIP or settlement COA missing");

  const lines: JournalLine[] = [
    {
      coaId: cwipCoa.id,
      debitPaise: totalCwip,
      creditPaise: 0,
      narration: input.projectCode,
    },
    {
      coaId: settleCoa.id,
      debitPaise: 0,
      creditPaise: net,
      narration: "Net payment",
    },
  ];
  if (retention > 0 && retentionCoa) {
    lines.push({
      coaId: retentionCoa.id,
      debitPaise: 0,
      creditPaise: retention,
      narration: "Retention held",
    });
  }

  const jv = postJournal({
    date,
    narration,
    sourceType: "trust_cwip",
    sourceId,
    lines,
  });
  if (!jv.ok) return jv;
  return { ok: true };
}

/** Capitalise project CWIP → fixed asset on completion (idempotent). */
export function capitaliseTrustProject(input: {
  projectId: string;
  projectCode: string;
  projectName: string;
  amountPaise: number;
  date?: string;
  assetName?: string;
}): { ok: true } | { ok: false; error: string } {
  seedAccountsIfEmpty();
  const state = loadAccounts();
  const sourceId = `trust_capitalise_${input.projectId}`;
  if (state.journalEntries.some((j) => j.sourceId === sourceId)) {
    return { ok: true };
  }

  const amount = Math.max(0, Math.round(input.amountPaise));
  if (amount <= 0) return fail("Nothing to capitalise");

  const cwipCoa = getCoaByCode(COA_CWIP, state);
  const assetCoa = getCoaByCode(COA_FIXED_ASSETS, state);
  if (!cwipCoa || !assetCoa) return fail("CWIP or Fixed Asset COA missing");

  const date = input.date || todayIso();
  const narration =
    input.assetName?.trim() ||
    `Capitalise · ${input.projectCode} · ${input.projectName}`;

  const jv = postJournal({
    date,
    narration,
    sourceType: "trust_capitalise",
    sourceId,
    lines: [
      {
        coaId: assetCoa.id,
        debitPaise: amount,
        creditPaise: 0,
        narration: input.projectCode,
      },
      {
        coaId: cwipCoa.id,
        debitPaise: 0,
        creditPaise: amount,
        narration: "CWIP cleared",
      },
    ],
  });
  if (!jv.ok) return jv;
  return { ok: true };
}
