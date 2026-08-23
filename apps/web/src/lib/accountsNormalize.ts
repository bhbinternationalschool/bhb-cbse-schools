/**
 * Accounts — defaults, field normalization, and state repair.
 *
 * Every shape read back out of storage passes through here, so this file
 * decides what a missing or malformed field becomes. Pure functions on plain
 * data: nothing in here loads or saves state, which is what lets
 * accountsStore's seed path call the COA migrations at the bottom without
 * creating a cycle.
 */

import {
  COA_ACCOUNTS_PAYABLE,
  COA_ACCOUNTS_RECEIVABLE,
  COA_BANK_ACCOUNTS,
  COA_CHEQUES_IN_HAND,
  COA_CAPITAL_EQUITY,
  COA_CASH_IN_HAND,
  COA_CWIP,
  COA_EXP_ACADEMIC,
  COA_EXP_MESS,
  COA_EXP_MILK,
  COA_EXP_OFFICE,
  COA_EXP_OTHER,
  COA_EXP_TRANSPORT_BATTA,
  COA_EXP_UTILITIES,
  COA_FEE_INCOME,
  COA_FIXED_ASSETS,
  COA_OTHER_INCOME,
  COA_OWNER_LOANS,
  COA_RETENTION_PAYABLE,
  COA_STORE_PURCHASES,
  COA_STORE_SALES,
  BANK_PAYMENT_MODES,
  VENDOR_BILL_UNITS,
} from "@/lib/accountsTypes";
import type {
  AccountsPayable,
  AccountsSettings,
  AccountsState,
  AccountsVendor,
  BankAccount,
  BankLedgerEntry,
  CashLedgerEntry,
  CashPool,
  CashPoolCode,
  CoaAccount,
  CoaGroup,
  ExpenseCategory,
  ExpensePaymentSplit,
  ExpensePaymentStatus,
  ExpenseVoucher,
  ExpenseVoucherLine,
  JournalEntry,
  ModeBankMapEntry,
  OwnerLoan,
  OwnerLoanRowStatus,
  OwnerLoanScheduleRow,
  OwnerLoanStatus,
  OwnerLoanType,
  PayableSourceType,
  PayableStatus,
  PaymentMode,
  ReconSession,
  RecurringExpenseRule,
  Trustee,
  VendorBill,
  VendorBillLine,
  VendorBillStatus,
  VendorBillUnit,
} from "@/lib/accountsTypes";
import { id, todayIso } from "@/lib/accountsUtil";

/** Compute net line total from qty, rate, discount, and tax. */
export function vendorBillLineTotalPaise(line: {
  qty?: number;
  ratePaise?: number;
  discountPaise?: number;
  taxPaise?: number;
  amountPaise?: number;
}): number {
  if (line.amountPaise !== undefined && line.amountPaise > 0) {
    return Math.max(0, Math.round(line.amountPaise));
  }
  const gross = Math.max(0, Number(line.qty) || 0) * Math.max(0, Math.round(Number(line.ratePaise) || 0));
  const discount = Math.max(0, Math.round(Number(line.discountPaise) || 0));
  const tax = Math.max(0, Math.round(Number(line.taxPaise) || 0));
  return Math.max(0, gross - Math.min(discount, gross) + tax);
}


export function defaultCoaAccounts(): CoaAccount[] {
  const row = (code: string, name: string, group: CoaGroup): CoaAccount => ({
    id: id("coa"),
    code,
    name,
    group,
    isActive: true,
  });
  return [
    row(COA_CASH_IN_HAND, "Cash in Hand", "assets"),
    row(COA_BANK_ACCOUNTS, "Bank Accounts", "assets"),
    row(COA_CHEQUES_IN_HAND, "Cheques in Hand", "assets"),
    row(COA_CWIP, "Capital Work in Progress", "assets"),
    row(COA_FIXED_ASSETS, "Fixed Assets", "assets"),
    row(COA_ACCOUNTS_RECEIVABLE, "Accounts Receivable (Store)", "assets"),
    row(COA_ACCOUNTS_PAYABLE, "Accounts Payable", "liabilities"),
    row(COA_OWNER_LOANS, "Owner / Trustee Loans", "liabilities"),
    row(COA_RETENTION_PAYABLE, "Retention Payable", "liabilities"),
    row(COA_CAPITAL_EQUITY, "Capital / Trustee Equity", "equity"),
    row(COA_FEE_INCOME, "Fee Income", "income"),
    row(COA_OTHER_INCOME, "Other Income", "income"),
    row(COA_STORE_SALES, "Store Sales Income", "income"),
    row(COA_EXP_MESS, "Mess Expenses", "expense"),
    row(COA_EXP_MILK, "Milk Expenses", "expense"),
    row(COA_EXP_UTILITIES, "Utilities Expenses", "expense"),
    row(COA_EXP_TRANSPORT_BATTA, "Transport Batta Expenses", "expense"),
    row(COA_EXP_OFFICE, "Office Expenses", "expense"),
    row(COA_EXP_ACADEMIC, "Academic Expenses", "expense"),
    row(COA_STORE_PURCHASES, "Store Purchases", "expense"),
    row(COA_EXP_OTHER, "Other Expenses", "expense"),
  ];
}

export function defaultSettings(): AccountsSettings {
  return {
    expenseApprovalPaise: 1000000,
    pettyThresholdPaise: 200000,
  };
}

export function emptyAccounts(): AccountsState {
  return {
    version: 1,
    cashPools: [],
    cashLedger: [],
    bankAccounts: [],
    bankLedger: [],
    modeBankMap: [],
    reconSessions: [],
    expenseCategories: [],
    expenseVouchers: [],
    recurringRules: [],
    vendors: [],
    vendorBills: [],
    payables: [],
    trustees: [],
    ownerLoans: [],
    ownerLoanSchedule: [],
    ownerCashHandovers: [],
    coaAccounts: [],
    journalEntries: [],
    fiscalYears: [],
    settings: defaultSettings(),
  };
}

export function normalizePool(p: Partial<CashPool>): CashPool {
  return {
    id: p.id ?? id("pool"),
    code: (p.code as CashPoolCode) ?? "main",
    name: p.name ?? "Cash",
    balancePaise: Math.round(Number(p.balancePaise) || 0),
  };
}

export function normalizeBank(b: Partial<BankAccount>): BankAccount {
  const paymentModes = Array.isArray(b.paymentModes)
    ? b.paymentModes.filter((m): m is PaymentMode =>
        BANK_PAYMENT_MODES.includes(m as PaymentMode),
      )
    : [...BANK_PAYMENT_MODES];
  return {
    id: b.id ?? id("bnk"),
    name: b.name ?? "Bank Account",
    bankName: b.bankName ?? "",
    accountNo: b.accountNo ?? "",
    ifsc: b.ifsc ?? "",
    openingBalancePaise: Math.round(Number(b.openingBalancePaise) || 0),
    isActive: b.isActive !== false,
    paymentModes,
  };
}

export function syncModeBankMapFromBanks(
  bankAccounts: BankAccount[],
): ModeBankMapEntry[] {
  const entries: ModeBankMapEntry[] = [];
  for (const mode of BANK_PAYMENT_MODES) {
    const bank = bankAccounts.find(
      (b) => b.isActive && b.paymentModes.includes(mode),
    );
    if (bank) entries.push({ mode, bankId: bank.id });
  }
  return entries;
}

export function normalizeExpenseCategory(c: Partial<ExpenseCategory>): ExpenseCategory {
  const vendorIds = Array.isArray(c.vendorIds)
    ? c.vendorIds.filter((vid) => typeof vid === "string" && vid.trim())
    : [];
  return {
    id: c.id ?? id("ecat"),
    parentId: c.parentId ?? "",
    name: c.name ?? "Category",
    coaCode: c.coaCode ?? COA_EXP_OTHER,
    isActive: c.isActive !== false,
    vendorIds,
  };
}

export function normalizeExpenseVoucherLine(
  l: Partial<ExpenseVoucherLine>,
): ExpenseVoucherLine {
  const amountPaise = Math.max(0, Math.round(Number(l.amountPaise) || 0));
  const taxPaise = Math.max(0, Math.round(Number(l.taxPaise) || 0));
  const totalPaise = Math.max(
    0,
    Math.round(Number(l.totalPaise) || amountPaise + taxPaise),
  );
  const paidPaise = Math.min(
    totalPaise,
    Math.max(0, Math.round(Number(l.paidPaise) || 0)),
  );
  const duePaise = Math.max(0, totalPaise - paidPaise);
  return {
    id: l.id ?? id("exln"),
    categoryId: l.categoryId ?? "",
    subcategoryId: l.subcategoryId ?? "",
    vendorId: l.vendorId ?? "",
    description: l.description ?? "",
    amountPaise,
    taxPaise,
    totalPaise,
    paidPaise,
    duePaise,
  };
}

export function normalizeVoucher(v: Partial<ExpenseVoucher>): ExpenseVoucher {
  const rawLines = Array.isArray(v.lines) ? v.lines : [];
  const lines =
    rawLines.length > 0
      ? rawLines.map((l) => normalizeExpenseVoucherLine(l))
      : v.categoryId || v.amountPaise
        ? [
            normalizeExpenseVoucherLine({
              categoryId: v.categoryId ?? "",
              subcategoryId: "",
              description: v.narration ?? "",
              amountPaise: v.amountPaise ?? 0,
              taxPaise: v.taxPaise ?? 0,
              totalPaise: v.grandTotalPaise ?? v.amountPaise ?? 0,
              paidPaise: v.paidPaise ?? 0,
            }),
          ]
        : [];

  const taxPaise = Math.max(
    0,
    Math.round(
      Number(v.taxPaise) ||
        lines.reduce((s, l) => s + l.taxPaise, 0),
    ),
  );
  const grandTotalPaise = Math.max(
    0,
    Math.round(
      Number(v.grandTotalPaise) ||
        Number(v.amountPaise) ||
        lines.reduce((s, l) => s + l.totalPaise, 0),
    ),
  );
  const paidPaise = Math.min(
    grandTotalPaise,
    Math.max(
      0,
      Math.round(
        Number(v.paidPaise) || lines.reduce((s, l) => s + l.paidPaise, 0),
      ),
    ),
  );
  const duePaise = Math.max(0, grandTotalPaise - paidPaise);

  let paymentStatus = (v.paymentStatus as ExpensePaymentStatus) ?? "draft";
  if (paymentStatus === "void") paymentStatus = "cancelled";
  if (
    paymentStatus !== "cancelled" &&
    paymentStatus !== "pending_approval"
  ) {
    if (paidPaise >= grandTotalPaise && grandTotalPaise > 0) {
      paymentStatus = "paid";
    } else if (paidPaise > 0 && duePaise > 0) {
      paymentStatus = "partial";
    }
  }

  return {
    id: v.id ?? id("exv"),
    voucherNo: v.voucherNo ?? "",
    date: v.date ?? todayIso(),
    categoryId: v.categoryId ?? lines[0]?.categoryId ?? "",
    vendorId: v.vendorId ?? "",
    amountPaise: grandTotalPaise,
    taxPaise,
    grandTotalPaise,
    paidPaise,
    duePaise,
    lines,
    mode: (v.mode as PaymentMode) ?? "cash",
    paymentStatus,
    paidOn: v.paidOn ?? "",
    bankId: v.bankId ?? "",
    poolId: v.poolId ?? "",
    narration: v.narration ?? "",
    paymentSplits: Array.isArray(v.paymentSplits)
      ? v.paymentSplits.map((s) => normalizePaymentSplit(s))
      : [],
    approvedBy: v.approvedBy ?? "",
    createdAt: v.createdAt ?? new Date().toISOString(),
    cancelledAt: v.cancelledAt ?? null,
    cancelledBy: v.cancelledBy ?? "",
    cancelReason: v.cancelReason ?? "",
  };
}

export function normalizeRule(r: Partial<RecurringExpenseRule>): RecurringExpenseRule {
  return {
    id: r.id ?? id("rec"),
    categoryId: r.categoryId ?? "",
    vendorId: r.vendorId ?? "",
    amountPaise: Math.max(0, Math.round(Number(r.amountPaise) || 0)),
    mode: (r.mode as PaymentMode) ?? "cash",
    dayOfMonth: Math.min(28, Math.max(1, Math.round(Number(r.dayOfMonth) || 5))),
    isActive: r.isActive !== false,
    lastGeneratedOn: r.lastGeneratedOn ?? "",
    narration: r.narration ?? "",
  };
}

export function normalizeVendor(v: Partial<AccountsVendor>): AccountsVendor {
  return {
    id: v.id ?? id("ven"),
    name: v.name ?? "Vendor",
    type: v.type ?? "supplier",
    phone: v.phone ?? "",
    gstin: v.gstin ?? "",
    isActive: v.isActive !== false,
  };
}

export function normalizeBill(b: Partial<VendorBill>): VendorBill {
  const normalizeLine = (l: Partial<VendorBillLine>): VendorBillLine => {
    const itemName = (l.itemName ?? l.description ?? "").trim();
    const qty = Math.max(0, Number(l.qty) || 0);
    const ratePaise = Math.max(0, Math.round(Number(l.ratePaise) || 0));
    const discountPaise = Math.max(0, Math.round(Number(l.discountPaise) || 0));
    const taxPaise = Math.max(0, Math.round(Number(l.taxPaise) || 0));
    const amountPaise = vendorBillLineTotalPaise({
      qty,
      ratePaise,
      discountPaise,
      taxPaise,
      amountPaise: l.amountPaise,
    });
    const unitRaw = (l.unit ?? "pcs").trim() || "pcs";
    const unit = (VENDOR_BILL_UNITS as readonly string[]).includes(unitRaw)
      ? (unitRaw as VendorBillUnit)
      : unitRaw;
    return {
      id: l.id ?? id("vbln"),
      lineDate: l.lineDate ?? "",
      itemName,
      description: itemName,
      qty,
      unit,
      ratePaise,
      discountPaise,
      taxPaise,
      amountPaise,
      categoryId: l.categoryId ?? "",
    };
  };

  const lines: VendorBillLine[] = Array.isArray(b.lines)
    ? b.lines.map(normalizeLine)
    : [];

  const discountPaise = Math.max(0, Math.round(Number(b.discountPaise) || 0));
  const taxPaise = Math.max(0, Math.round(Number(b.taxPaise) || 0));
  const grossPaise = lines.reduce((s, l) => s + l.amountPaise, 0);
  const computedGrand = grossPaise - discountPaise + taxPaise;

  const grandTotalPaise = Math.max(
    0,
    Math.round(
      Number(
        (b as Partial<VendorBill> & { grandTotalPaise?: number | null }).grandTotalPaise ??
          (lines.length ? computedGrand : b.amountPaise),
      ) || 0,
    ),
  );

  const amountPaise = Math.max(0, Math.round(Number(b.amountPaise) || grandTotalPaise));

  return {
    id: b.id ?? id("bill"),
    vendorId: b.vendorId ?? "",
    receiptNo: (b as Partial<VendorBill> & { receiptNo?: string }).receiptNo ?? "",
    billNo: b.billNo ?? "",
    supplierInvoiceNo:
      (b as Partial<VendorBill> & { supplierInvoiceNo?: string }).supplierInvoiceNo ??
      b.billNo ??
      "",
    billDate: b.billDate ?? todayIso(),
    dueOn: b.dueOn ?? todayIso(),
    amountPaise,
    categoryId: b.categoryId ?? lines[0]?.categoryId ?? "",
    discountType:
      (b as Partial<VendorBill> & { discountType?: VendorBill["discountType"] }).discountType ??
      "none",
    discountPaise,
    taxPaise,
    grandTotalPaise,
    lines,
    status: (b.status as VendorBillStatus) ?? "open",
    paidPaise: Math.max(0, Math.round(Number(b.paidPaise) || 0)),
    narration: b.narration ?? "",
    attachmentNote: b.attachmentNote ?? "",
  };
}

export function normalizePayable(p: Partial<AccountsPayable>): AccountsPayable {
  return {
    id: p.id ?? id("pay"),
    vendorId: p.vendorId ?? "",
    sourceType: (p.sourceType as PayableSourceType) ?? "other",
    sourceId: p.sourceId ?? "",
    amountPaise: Math.max(0, Math.round(Number(p.amountPaise) || 0)),
    dueOn: p.dueOn ?? todayIso(),
    status: (p.status as PayableStatus) ?? "open",
    paidPaise: Math.max(0, Math.round(Number(p.paidPaise) || 0)),
    paidOn: p.paidOn ?? "",
    note: p.note ?? "",
  };
}

export function normalizeTrustee(t: Partial<Trustee>): Trustee {
  return {
    id: t.id ?? id("trs"),
    name: t.name ?? "Trustee",
    phone: t.phone ?? "",
    isActive: t.isActive !== false,
  };
}

export function normalizeLoan(l: Partial<OwnerLoan>): OwnerLoan {
  return {
    id: l.id ?? id("oln"),
    trusteeId: l.trusteeId ?? "",
    type: (l.type as OwnerLoanType) ?? "working_capital",
    principalPaise: Math.max(0, Math.round(Number(l.principalPaise) || 0)),
    ratePct: Math.max(0, Number(l.ratePct) || 0),
    tenureMonths: Math.max(1, Math.round(Number(l.tenureMonths) || 1)),
    startDate: l.startDate ?? todayIso(),
    status: (l.status as OwnerLoanStatus) ?? "open",
    note: l.note ?? "",
  };
}

export function normalizeLoanRow(r: Partial<OwnerLoanScheduleRow>): OwnerLoanScheduleRow {
  return {
    id: r.id ?? id("olr"),
    loanId: r.loanId ?? "",
    installmentNo: Math.max(1, Math.round(Number(r.installmentNo) || 1)),
    dueOn: r.dueOn ?? todayIso(),
    amountPaise: Math.max(0, Math.round(Number(r.amountPaise) || 0)),
    status: (r.status as OwnerLoanRowStatus) ?? "due",
    paidOn: r.paidOn ?? "",
    paidAmountPaise: Math.max(0, Math.round(Number(r.paidAmountPaise) || 0)),
  };
}

export function normalizeCoa(c: Partial<CoaAccount>): CoaAccount {
  return {
    id: c.id ?? id("coa"),
    code: c.code ?? "0000",
    name: c.name ?? "Account",
    group: (c.group as CoaGroup) ?? "expense",
    isActive: c.isActive !== false,
  };
}

export function normalizePaymentSplit(
  s: Partial<ExpensePaymentSplit>,
): ExpensePaymentSplit {
  return {
    id: s.id ?? id("exps"),
    mode: (s.mode as PaymentMode) ?? "cash",
    amountPaise: Math.max(0, Math.round(Number(s.amountPaise) || 0)),
    poolId: s.poolId ?? "",
    bankId: s.bankId ?? "",
    transactionRef: s.transactionRef?.trim() ?? "",
  };
}

export function normalizeCashLedger(e: Partial<CashLedgerEntry>): CashLedgerEntry {
  return {
    id: e.id ?? id("cle"),
    poolId: e.poolId ?? "",
    date: e.date ?? todayIso(),
    direction: e.direction === "out" ? "out" : "in",
    amountPaise: Math.max(0, Math.round(Number(e.amountPaise) || 0)),
    sourceType: e.sourceType ?? "",
    sourceId: e.sourceId ?? "",
    narration: e.narration ?? "",
    transactionRef: e.transactionRef ?? "",
    runningBalancePaise: Math.round(Number(e.runningBalancePaise) || 0),
    createdAt: e.createdAt ?? new Date().toISOString(),
    voidedAt: e.voidedAt ?? null,
    cancelReason: e.cancelReason ?? "",
  };
}

export function normalizeBankLedger(e: Partial<BankLedgerEntry>): BankLedgerEntry {
  return {
    id: e.id ?? id("ble"),
    bankId: e.bankId ?? "",
    date: e.date ?? todayIso(),
    direction: e.direction === "cr" ? "cr" : "dr",
    amountPaise: Math.max(0, Math.round(Number(e.amountPaise) || 0)),
    mode: (e.mode as PaymentMode) ?? "neft",
    sourceType: e.sourceType ?? "",
    sourceId: e.sourceId ?? "",
    narration: e.narration ?? "",
    transactionRef: e.transactionRef ?? "",
    createdAt: e.createdAt ?? new Date().toISOString(),
    voidedAt: e.voidedAt ?? null,
    cancelReason: e.cancelReason ?? "",
  };
}

export function normalizeJournal(j: Partial<JournalEntry>): JournalEntry {
  return {
    id: j.id ?? id("jv"),
    date: j.date ?? todayIso(),
    voucherNo: j.voucherNo ?? "",
    narration: j.narration ?? "",
    lines: Array.isArray(j.lines)
      ? j.lines.map((l) => ({
          coaId: l.coaId ?? "",
          debitPaise: Math.max(0, Math.round(Number(l.debitPaise) || 0)),
          creditPaise: Math.max(0, Math.round(Number(l.creditPaise) || 0)),
          narration: l.narration ?? "",
        }))
      : [],
    sourceType: j.sourceType ?? "",
    sourceId: j.sourceId ?? "",
    fiscalYearCode: j.fiscalYearCode ?? "",
    createdAt: j.createdAt ?? new Date().toISOString(),
    voidedAt: j.voidedAt ?? null,
    cancelReason: j.cancelReason ?? "",
  };
}

export function normalizeReconSession(s: Partial<ReconSession>): ReconSession {
  return {
    id: s.id ?? id("recn"),
    bankId: s.bankId ?? "",
    asOf: s.asOf ?? todayIso(),
    createdAt: s.createdAt ?? new Date().toISOString(),
    note: s.note ?? "",
    lines: Array.isArray(s.lines)
      ? s.lines.map((l) => ({
          id: l.id ?? id("rl"),
          date: l.date ?? "",
          amountPaise: Math.max(0, Math.round(Number(l.amountPaise) || 0)),
          narration: l.narration ?? "",
          status:
            l.status === "matched" || l.status === "ignored"
              ? l.status
              : "unmatched",
          matchedLedgerId: l.matchedLedgerId ?? "",
        }))
      : [],
  };
}

/** A voucher in a terminal, non-payable state. */
export function isExpenseVoucherCancelled(v: ExpenseVoucher): boolean {
  return v.paymentStatus === "cancelled" || v.paymentStatus === "void";
}

export function repairOrphanedCancelledVoucherLedger(
  state: AccountsState,
): AccountsState {
  const cancelledIds = new Set(
    state.expenseVouchers
      .filter(isExpenseVoucherCancelled)
      .map((v) => v.id),
  );
  if (cancelledIds.size === 0) return state;

  const now = new Date().toISOString();
  let cashPools = [...state.cashPools];
  let cashLedger = state.cashLedger;
  let bankLedger = state.bankLedger;
  let journalEntries = state.journalEntries;
  let changed = false;

  for (const entry of cashLedger) {
    if (entry.voidedAt) continue;
    if (entry.sourceType !== "expense_voucher" || !cancelledIds.has(entry.sourceId)) {
      continue;
    }
    const pool = cashPools.find((p) => p.id === entry.poolId);
    if (pool) {
      const reverse =
        entry.direction === "in" ? -entry.amountPaise : entry.amountPaise;
      cashPools = cashPools.map((p) =>
        p.id === pool.id ? { ...p, balancePaise: p.balancePaise + reverse } : p,
      );
    }
    cashLedger = cashLedger.map((e) =>
      e.id === entry.id
        ? {
            ...e,
            voidedAt: now,
            cancelReason: e.cancelReason || "Voucher cancelled",
          }
        : e,
    );
    changed = true;
  }

  bankLedger = bankLedger.map((e) => {
    if (
      !e.voidedAt &&
      e.sourceType === "expense_voucher" &&
      cancelledIds.has(e.sourceId)
    ) {
      changed = true;
      return {
        ...e,
        voidedAt: now,
        cancelReason: e.cancelReason || "Voucher cancelled",
      };
    }
    return e;
  });

  journalEntries = journalEntries.map((j) => {
    if (
      !j.voidedAt &&
      j.sourceType === "expense_voucher" &&
      cancelledIds.has(j.sourceId)
    ) {
      changed = true;
      return {
        ...j,
        voidedAt: now,
        cancelReason: j.cancelReason || "Voucher cancelled",
      };
    }
    return j;
  });

  if (!changed) return state;
  return { ...state, cashPools, cashLedger, bankLedger, journalEntries };
}

/** Merge CWIP / fixed asset / retention COA rows for existing installs. */
export function ensureConstructionCoaAccounts(state: AccountsState): AccountsState {
  const needed: { code: string; name: string; group: CoaGroup }[] = [
    { code: COA_CWIP, name: "Capital Work in Progress", group: "assets" },
    { code: COA_FIXED_ASSETS, name: "Fixed Assets", group: "assets" },
    { code: COA_RETENTION_PAYABLE, name: "Retention Payable", group: "liabilities" },
  ];
  let coaAccounts = [...state.coaAccounts];
  let changed = false;
  for (const row of needed) {
    if (!coaAccounts.some((c) => c.code === row.code)) {
      coaAccounts = [
        ...coaAccounts,
        normalizeCoa({ code: row.code, name: row.name, group: row.group }),
      ];
      changed = true;
    }
  }
  return changed ? { ...state, coaAccounts } : state;
}

/**
 * Ensure the "Cheques in Hand" COA exists on books seeded before cheques
 * were held off the bank book (audit 2026-08-23). A cheque tender debits
 * this account on collection and clears to Bank only when the bank does.
 */
export function ensureChequeCoaAccount(state: AccountsState): AccountsState {
  if (state.coaAccounts.some((c) => c.code === COA_CHEQUES_IN_HAND)) return state;
  return {
    ...state,
    coaAccounts: [
      ...state.coaAccounts,
      normalizeCoa({
        code: COA_CHEQUES_IN_HAND,
        name: "Cheques in Hand",
        group: "assets",
      }),
    ],
  };
}

/** Ensure store AR / sales / purchases COA exist on older tenants. */
export function ensureStoreCoaAccounts(state: AccountsState): AccountsState {
  const needed: { code: string; name: string; group: CoaGroup }[] = [
    {
      code: COA_ACCOUNTS_RECEIVABLE,
      name: "Accounts Receivable (Store)",
      group: "assets",
    },
    { code: COA_STORE_SALES, name: "Store Sales Income", group: "income" },
    { code: COA_STORE_PURCHASES, name: "Store Purchases", group: "expense" },
  ];
  let coaAccounts = [...state.coaAccounts];
  let changed = false;
  for (const row of needed) {
    if (!coaAccounts.some((c) => c.code === row.code)) {
      coaAccounts = [
        ...coaAccounts,
        normalizeCoa({ code: row.code, name: row.name, group: row.group }),
      ];
      changed = true;
    }
  }
  let expenseCategories = state.expenseCategories;
  if (
    !expenseCategories.some((c) => c.coaCode === COA_STORE_PURCHASES) &&
    !expenseCategories.some((c) => /store\s*purchase/i.test(c.name))
  ) {
    expenseCategories = [
      ...expenseCategories,
      normalizeExpenseCategory({
        name: "Store Purchases",
        coaCode: COA_STORE_PURCHASES,
      }),
    ];
    changed = true;
  }
  return changed ? { ...state, coaAccounts, expenseCategories } : state;
}
