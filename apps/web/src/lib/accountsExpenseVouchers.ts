/**
 * Accounts — expense vouchers.
 *
 * The full lifecycle: create (auto-paying below the approval limit, parking
 * above it), approve, pay in cash or bank, cancel, void. Payment fans out to
 * the cash/bank primitive, the GL, and — where a line names a vendor — the
 * vendor payment allocation.
 */

import {
  COA_ACCOUNTS_PAYABLE,
  COA_BANK_ACCOUNTS,
  COA_CASH_IN_HAND,
} from "@/lib/accountsTypes";
import type {
  ExpensePaymentSplit,
  ExpenseVoucher,
  ExpenseVoucherLine,
  JournalLine,
  PaymentMode,
} from "@/lib/accountsTypes";
import {
  fail,
  id,
  todayIso,
} from "@/lib/accountsUtil";
import {
  isExpenseVoucherCancelled,
  normalizeExpenseVoucherLine,
  normalizePaymentSplit,
  normalizeVoucher,
} from "@/lib/accountsNormalize";
import {
  loadAccounts,
  saveAccounts,
} from "@/lib/accountsStore";
import {
  expenseVoucherHasLedgerPayment,
  getCoaByCode,
  nextExpenseVoucherNo,
} from "@/lib/accountsLookups";
import {
  postJournal,
} from "@/lib/accountsJournal";
import {
  settleVendorPaymentForExpensePay,
  validateVendorPaymentAmounts,
  vendorPaymentPaiseFromVoucherLines,
} from "@/lib/accountsVendors";
import {
  postBankMovement,
  postCashMovement,
} from "@/lib/accountsCashBank";
import { persistSeriesUse } from "@/lib/numberSeries";

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

