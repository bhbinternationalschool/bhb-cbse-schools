/**
 * Accounts — vendors, bills, and payment allocation.
 *
 * A bill is an accrual (Dr purchases, Cr accounts payable); settling it is a
 * separate step. The allocation helpers at the bottom are what let an expense
 * voucher line that names a vendor also close out that vendor's open bills.
 */

import {
  COA_ACCOUNTS_PAYABLE,
  COA_STORE_PURCHASES,
} from "@/lib/accountsTypes";
import type {
  AccountsPayable,
  AccountsRemovalCheck,
  AccountsState,
  AccountsVendor,
  ExpenseVoucherLine,
  PayableStatus,
  VendorBill,
  VendorBillLine,
  VendorBillStatus,
} from "@/lib/accountsTypes";
import {
  fail,
  id,
  todayIso,
} from "@/lib/accountsUtil";
import {
  ensureStoreCoaAccounts,
  isExpenseVoucherCancelled,
  normalizeBill,
  normalizePayable,
  normalizeVendor,
  vendorBillLineTotalPaise,
} from "@/lib/accountsNormalize";
import {
  loadAccounts,
  saveAccounts,
} from "@/lib/accountsStore";
import {
  getCoaByCode,
  getExpenseCategory,
} from "@/lib/accountsLookups";
import {
  postJournal,
} from "@/lib/accountsJournal";
import {
} from "@/lib/accountsCashBank";

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

export function validateVendorPaymentAmounts(
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

export function settleVendorPaymentForExpensePay(
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

export function vendorPaymentPaiseFromVoucherLines(
  lines: ExpenseVoucherLine[],
): number {
  let total = 0;
  for (const line of lines) {
    if (line.vendorId && line.paidPaise > 0) total += line.paidPaise;
  }
  return total;
}

