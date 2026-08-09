/**
 * Accounts desk — Supabase normalized tables (accounts_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  AccountsPayable,
  AccountsSettings,
  AccountsState,
  AccountsVendor,
  BankAccount,
  BankLedgerEntry,
  CashLedgerEntry,
  CashPool,
  CoaAccount,
  ExpenseCategory,
  ExpensePaymentSplit,
  ExpenseVoucher,
  ExpenseVoucherLine,
  FiscalYear,
  JournalEntry,
  JournalLine,
  ModeBankMapEntry,
  OwnerCashHandover,
  OwnerLoan,
  OwnerLoanScheduleRow,
  ReconSession,
  ReconSessionLine,
  RecurringExpenseRule,
  Trustee,
  VendorBill,
  VendorBillLine,
} from "@/lib/accountsTypes";
import { accountsDualWriteDbEnabled } from "@/lib/accountsDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type AccountsDeskSyncMeta = {
  coaCount: number;
  voucherCount: number;
  journalCount: number;
  vendorBillCount: number;
  lastVoucherAt: string | null;
  updatedAt: string;
};

export type AccountsDeskBundle = Pick<
  AccountsState,
  | "cashPools"
  | "cashLedger"
  | "bankAccounts"
  | "bankLedger"
  | "modeBankMap"
  | "reconSessions"
  | "expenseCategories"
  | "expenseVouchers"
  | "recurringRules"
  | "vendors"
  | "vendorBills"
  | "payables"
  | "trustees"
  | "ownerLoans"
  | "ownerLoanSchedule"
  | "ownerCashHandovers"
  | "coaAccounts"
  | "journalEntries"
  | "fiscalYears"
  | "settings"
>;

const META_SELECT =
  "coa_count, voucher_count, journal_count, vendor_bill_count, last_voucher_at, updated_at";

const DEFAULT_SETTINGS: AccountsSettings = {
  expenseApprovalPaise: 1_000_000,
  pettyThresholdPaise: 200_000,
};

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}

async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  const { data } = await sb.from(table).select("id").eq("tenant_id", tenantId);
  const stale = (data ?? [])
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !keepIds.has(id));
  if (stale.length > 0) {
    await sb.from(table).delete().in("id", stale);
  }
}

async function upsertChunks(
  sb: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  chunk = 200,
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + chunk));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

function nowIso() {
  return new Date().toISOString();
}

function journalLineId(journalId: string, idx: number) {
  return `${journalId}_L${idx}`;
}

function cashPoolToRow(tenantId: string, p: CashPool): Record<string, unknown> {
  return {
    id: p.id,
    tenant_id: tenantId,
    code: p.code || "main",
    name: p.name || "",
    balance_paise: p.balancePaise ?? 0,
    updated_at: nowIso(),
  };
}

function rowToCashPool(r: Record<string, unknown>): CashPool {
  const code = String(r.code || "main");
  return {
    id: String(r.id),
    code:
      code === "drawer" || code === "petty" ? code : "main",
    name: String(r.name || ""),
    balancePaise: Number(r.balance_paise ?? 0),
  };
}

function cashLedgerToRow(
  tenantId: string,
  e: CashLedgerEntry,
): Record<string, unknown> {
  return {
    id: e.id,
    tenant_id: tenantId,
    pool_id: e.poolId || "",
    entry_date: e.date,
    direction: e.direction || "in",
    amount_paise: e.amountPaise ?? 0,
    source_type: e.sourceType || "",
    source_id: e.sourceId || "",
    narration: e.narration || "",
    transaction_ref: e.transactionRef || "",
    running_balance_paise: e.runningBalancePaise ?? 0,
    created_at: e.createdAt || nowIso(),
    voided_at: e.voidedAt || null,
    cancel_reason: e.cancelReason || "",
    updated_at: nowIso(),
  };
}

function rowToCashLedger(r: Record<string, unknown>): CashLedgerEntry {
  return {
    id: String(r.id),
    poolId: String(r.pool_id || ""),
    date: String(r.entry_date).slice(0, 10),
    direction: r.direction === "out" ? "out" : "in",
    amountPaise: Number(r.amount_paise ?? 0),
    sourceType: String(r.source_type || ""),
    sourceId: String(r.source_id || ""),
    narration: String(r.narration || ""),
    transactionRef: String(r.transaction_ref || ""),
    runningBalancePaise: Number(r.running_balance_paise ?? 0),
    createdAt: String(r.created_at || nowIso()),
    voidedAt: r.voided_at ? String(r.voided_at) : null,
    cancelReason: String(r.cancel_reason || ""),
  };
}

function bankAccountToRow(
  tenantId: string,
  b: BankAccount,
): Record<string, unknown> {
  return {
    id: b.id,
    tenant_id: tenantId,
    name: b.name || "",
    bank_name: b.bankName || "",
    account_no: b.accountNo || "",
    ifsc: b.ifsc || "",
    opening_balance_paise: b.openingBalancePaise ?? 0,
    is_active: b.isActive !== false,
    payment_modes: b.paymentModes ?? [],
    updated_at: nowIso(),
  };
}

function rowToBankAccount(r: Record<string, unknown>): BankAccount {
  const modes = r.payment_modes;
  return {
    id: String(r.id),
    name: String(r.name || ""),
    bankName: String(r.bank_name || ""),
    accountNo: String(r.account_no || ""),
    ifsc: String(r.ifsc || ""),
    openingBalancePaise: Number(r.opening_balance_paise ?? 0),
    isActive: r.is_active !== false,
    paymentModes: Array.isArray(modes)
      ? modes.map((m) => String(m)) as BankAccount["paymentModes"]
      : [],
  };
}

function bankLedgerToRow(
  tenantId: string,
  e: BankLedgerEntry,
): Record<string, unknown> {
  return {
    id: e.id,
    tenant_id: tenantId,
    bank_id: e.bankId || "",
    entry_date: e.date,
    direction: e.direction || "dr",
    amount_paise: e.amountPaise ?? 0,
    mode: e.mode || "neft",
    source_type: e.sourceType || "",
    source_id: e.sourceId || "",
    narration: e.narration || "",
    transaction_ref: e.transactionRef || "",
    created_at: e.createdAt || nowIso(),
    voided_at: e.voidedAt || null,
    cancel_reason: e.cancelReason || "",
    updated_at: nowIso(),
  };
}

function rowToBankLedger(r: Record<string, unknown>): BankLedgerEntry {
  return {
    id: String(r.id),
    bankId: String(r.bank_id || ""),
    date: String(r.entry_date).slice(0, 10),
    direction: r.direction === "cr" ? "cr" : "dr",
    amountPaise: Number(r.amount_paise ?? 0),
    mode: String(r.mode || "neft") as BankLedgerEntry["mode"],
    sourceType: String(r.source_type || ""),
    sourceId: String(r.source_id || ""),
    narration: String(r.narration || ""),
    transactionRef: String(r.transaction_ref || ""),
    createdAt: String(r.created_at || nowIso()),
    voidedAt: r.voided_at ? String(r.voided_at) : null,
    cancelReason: String(r.cancel_reason || ""),
  };
}

function modeBankMapToRow(
  tenantId: string,
  m: ModeBankMapEntry,
): Record<string, unknown> {
  return {
    tenant_id: tenantId,
    mode: m.mode || "neft",
    bank_id: m.bankId || "",
    updated_at: nowIso(),
  };
}

function rowToModeBankMap(r: Record<string, unknown>): ModeBankMapEntry {
  return {
    mode: String(r.mode || "neft") as ModeBankMapEntry["mode"],
    bankId: String(r.bank_id || ""),
  };
}

function reconSessionToRow(
  tenantId: string,
  s: ReconSession,
): Record<string, unknown> {
  return {
    id: s.id,
    tenant_id: tenantId,
    bank_id: s.bankId || "",
    as_of: s.asOf,
    note: s.note || "",
    created_at: s.createdAt || nowIso(),
    updated_at: nowIso(),
  };
}

function reconLineToRow(
  tenantId: string,
  sessionId: string,
  idx: number,
  line: ReconSessionLine,
): Record<string, unknown> {
  return {
    id: line.id,
    tenant_id: tenantId,
    session_id: sessionId,
    line_index: idx,
    entry_date: line.date,
    amount_paise: line.amountPaise ?? 0,
    narration: line.narration || "",
    status: line.status || "unmatched",
    matched_ledger_id: line.matchedLedgerId || "",
    updated_at: nowIso(),
  };
}

function rowToReconLine(r: Record<string, unknown>): ReconSessionLine {
  const status = String(r.status || "unmatched");
  return {
    id: String(r.id),
    date: String(r.entry_date).slice(0, 10),
    amountPaise: Number(r.amount_paise ?? 0),
    narration: String(r.narration || ""),
    status:
      status === "matched" || status === "ignored" ? status : "unmatched",
    matchedLedgerId: String(r.matched_ledger_id || ""),
  };
}

function rowToReconSession(
  r: Record<string, unknown>,
  lines: ReconSessionLine[],
): ReconSession {
  return {
    id: String(r.id),
    bankId: String(r.bank_id || ""),
    asOf: String(r.as_of).slice(0, 10),
    createdAt: String(r.created_at || nowIso()),
    note: String(r.note || ""),
    lines,
  };
}

function expenseCategoryToRow(
  tenantId: string,
  c: ExpenseCategory,
): Record<string, unknown> {
  return {
    id: c.id,
    tenant_id: tenantId,
    parent_id: c.parentId || "",
    name: c.name || "",
    coa_code: c.coaCode || "",
    is_active: c.isActive !== false,
    updated_at: nowIso(),
  };
}

function rowToExpenseCategory(r: Record<string, unknown>): ExpenseCategory {
  const rawVendorIds = r.vendor_ids;
  const vendorIds = Array.isArray(rawVendorIds)
    ? rawVendorIds.filter((id): id is string => typeof id === "string")
    : [];
  return {
    id: String(r.id),
    parentId: String(r.parent_id || ""),
    name: String(r.name || ""),
    coaCode: String(r.coa_code || ""),
    isActive: r.is_active !== false,
    vendorIds,
  };
}

function expenseVoucherToRow(
  tenantId: string,
  v: ExpenseVoucher,
): Record<string, unknown> {
  return {
    id: v.id,
    tenant_id: tenantId,
    voucher_no: v.voucherNo || "",
    voucher_date: v.date,
    category_id: v.categoryId || "",
    vendor_id: v.vendorId || "",
    amount_paise: v.amountPaise ?? 0,
    tax_paise: v.taxPaise ?? 0,
    grand_total_paise: v.grandTotalPaise ?? 0,
    paid_paise: v.paidPaise ?? 0,
    due_paise: v.duePaise ?? 0,
    mode: v.mode || "cash",
    payment_status: v.paymentStatus || "draft",
    paid_on: v.paidOn || null,
    bank_id: v.bankId || "",
    pool_id: v.poolId || "",
    narration: v.narration || "",
    approved_by: v.approvedBy || "",
    created_at: v.createdAt || nowIso(),
    cancelled_at: v.cancelledAt || null,
    cancelled_by: v.cancelledBy || "",
    cancel_reason: v.cancelReason || "",
    payment_splits: v.paymentSplits ?? [],
    updated_at: nowIso(),
  };
}

function expenseVoucherLineToRow(
  tenantId: string,
  voucherId: string,
  idx: number,
  line: ExpenseVoucherLine,
): Record<string, unknown> {
  return {
    id: line.id,
    tenant_id: tenantId,
    voucher_id: voucherId,
    line_index: idx,
    category_id: line.categoryId || "",
    subcategory_id: line.subcategoryId || "",
    vendor_id: line.vendorId || "",
    description: line.description || "",
    amount_paise: line.amountPaise ?? 0,
    tax_paise: line.taxPaise ?? 0,
    total_paise: line.totalPaise ?? 0,
    paid_paise: line.paidPaise ?? 0,
    due_paise: line.duePaise ?? 0,
    updated_at: nowIso(),
  };
}

function rowToExpenseVoucherLine(r: Record<string, unknown>): ExpenseVoucherLine {
  return {
    id: String(r.id),
    categoryId: String(r.category_id || ""),
    subcategoryId: String(r.subcategory_id || ""),
    vendorId: String(r.vendor_id || ""),
    description: String(r.description || ""),
    amountPaise: Number(r.amount_paise ?? 0),
    taxPaise: Number(r.tax_paise ?? 0),
    totalPaise: Number(r.total_paise ?? 0),
    paidPaise: Number(r.paid_paise ?? 0),
    duePaise: Number(r.due_paise ?? 0),
  };
}

function rowToExpenseVoucher(
  r: Record<string, unknown>,
  lines: ExpenseVoucherLine[],
): ExpenseVoucher {
  const rawSplits = r.payment_splits;
  const paymentSplits: ExpensePaymentSplit[] = Array.isArray(rawSplits)
    ? rawSplits.map((s) => {
        const x = s as Record<string, unknown>;
        return {
          id: String(x.id || ""),
          mode: String(x.mode || "cash") as ExpensePaymentSplit["mode"],
          amountPaise: Number(x.amountPaise ?? x.amount_paise ?? 0),
          poolId: String(x.poolId ?? x.pool_id ?? ""),
          bankId: String(x.bankId ?? x.bank_id ?? ""),
          transactionRef: String(x.transactionRef ?? x.transaction_ref ?? ""),
        };
      })
    : [];
  return {
    id: String(r.id),
    voucherNo: String(r.voucher_no || ""),
    date: String(r.voucher_date).slice(0, 10),
    categoryId: String(r.category_id || ""),
    vendorId: String(r.vendor_id || ""),
    amountPaise: Number(r.amount_paise ?? 0),
    taxPaise: Number(r.tax_paise ?? 0),
    grandTotalPaise: Number(r.grand_total_paise ?? 0),
    paidPaise: Number(r.paid_paise ?? 0),
    duePaise: Number(r.due_paise ?? 0),
    lines,
    mode: String(r.mode || "cash") as ExpenseVoucher["mode"],
    paymentStatus: String(r.payment_status || "draft") as ExpenseVoucher["paymentStatus"],
    paidOn: r.paid_on ? String(r.paid_on).slice(0, 10) : "",
    bankId: String(r.bank_id || ""),
    poolId: String(r.pool_id || ""),
    narration: String(r.narration || ""),
    approvedBy: String(r.approved_by || ""),
    createdAt: String(r.created_at || nowIso()),
    cancelledAt: r.cancelled_at ? String(r.cancelled_at) : null,
    cancelledBy: String(r.cancelled_by || ""),
    cancelReason: String(r.cancel_reason || ""),
    paymentSplits,
  };
}

function recurringRuleToRow(
  tenantId: string,
  rule: RecurringExpenseRule,
): Record<string, unknown> {
  return {
    id: rule.id,
    tenant_id: tenantId,
    category_id: rule.categoryId || "",
    vendor_id: rule.vendorId || "",
    amount_paise: rule.amountPaise ?? 0,
    mode: rule.mode || "cash",
    day_of_month: rule.dayOfMonth ?? 1,
    is_active: rule.isActive !== false,
    last_generated_on: rule.lastGeneratedOn || null,
    narration: rule.narration || "",
    updated_at: nowIso(),
  };
}

function rowToRecurringRule(r: Record<string, unknown>): RecurringExpenseRule {
  return {
    id: String(r.id),
    categoryId: String(r.category_id || ""),
    vendorId: String(r.vendor_id || ""),
    amountPaise: Number(r.amount_paise ?? 0),
    mode: String(r.mode || "cash") as RecurringExpenseRule["mode"],
    dayOfMonth: Number(r.day_of_month ?? 1),
    isActive: r.is_active !== false,
    lastGeneratedOn: r.last_generated_on
      ? String(r.last_generated_on).slice(0, 10)
      : "",
    narration: String(r.narration || ""),
  };
}

function vendorToRow(tenantId: string, v: AccountsVendor): Record<string, unknown> {
  return {
    id: v.id,
    tenant_id: tenantId,
    name: v.name || "",
    vendor_type: v.type || "",
    phone: v.phone || "",
    gstin: v.gstin || "",
    is_active: v.isActive !== false,
    updated_at: nowIso(),
  };
}

function rowToVendor(r: Record<string, unknown>): AccountsVendor {
  return {
    id: String(r.id),
    name: String(r.name || ""),
    type: String(r.vendor_type || ""),
    phone: String(r.phone || ""),
    gstin: String(r.gstin || ""),
    isActive: r.is_active !== false,
  };
}

function vendorBillToRow(tenantId: string, b: VendorBill): Record<string, unknown> {
  return {
    id: b.id,
    tenant_id: tenantId,
    vendor_id: b.vendorId || "",
    receipt_no: b.receiptNo || "",
    bill_no: b.billNo || "",
    supplier_invoice_no: b.supplierInvoiceNo || "",
    bill_date: b.billDate,
    due_on: b.dueOn,
    amount_paise: b.amountPaise ?? 0,
    category_id: b.categoryId || "",
    discount_type: b.discountType || "none",
    discount_paise: b.discountPaise ?? 0,
    tax_paise: b.taxPaise ?? 0,
    grand_total_paise: b.grandTotalPaise ?? 0,
    status: b.status || "open",
    paid_paise: b.paidPaise ?? 0,
    narration: b.narration || "",
    attachment_note: b.attachmentNote || "",
    updated_at: nowIso(),
  };
}

function vendorBillLineToRow(
  tenantId: string,
  billId: string,
  idx: number,
  line: VendorBillLine,
): Record<string, unknown> {
  return {
    id: line.id,
    tenant_id: tenantId,
    bill_id: billId,
    line_index: idx,
    line_date: line.lineDate || null,
    item_name: line.itemName || line.description || "",
    description: line.itemName || line.description || "",
    qty: line.qty ?? 0,
    unit: line.unit || "pcs",
    rate_paise: line.ratePaise ?? 0,
    discount_paise: line.discountPaise ?? 0,
    tax_paise: line.taxPaise ?? 0,
    amount_paise: line.amountPaise ?? 0,
    category_id: line.categoryId || "",
    updated_at: nowIso(),
  };
}

function rowToVendorBillLine(r: Record<string, unknown>): VendorBillLine {
  const itemName = String(r.item_name || r.description || "");
  const unitRaw = String(r.unit || "pcs");
  return {
    id: String(r.id),
    lineDate: r.line_date ? String(r.line_date).slice(0, 10) : "",
    itemName,
    description: itemName,
    qty: Number(r.qty ?? 0),
    unit: unitRaw,
    ratePaise: Number(r.rate_paise ?? 0),
    discountPaise: Number(r.discount_paise ?? 0),
    taxPaise: Number(r.tax_paise ?? 0),
    amountPaise: Number(r.amount_paise ?? 0),
    categoryId: String(r.category_id || ""),
  };
}

function rowToVendorBill(
  r: Record<string, unknown>,
  lines: VendorBillLine[],
): VendorBill {
  const discountType = String(r.discount_type || "none");
  return {
    id: String(r.id),
    vendorId: String(r.vendor_id || ""),
    receiptNo: String(r.receipt_no || ""),
    billNo: String(r.bill_no || ""),
    supplierInvoiceNo: String(r.supplier_invoice_no || ""),
    billDate: String(r.bill_date).slice(0, 10),
    dueOn: String(r.due_on).slice(0, 10),
    amountPaise: Number(r.amount_paise ?? 0),
    categoryId: String(r.category_id || ""),
    discountType:
      discountType === "percent" || discountType === "amount"
        ? discountType
        : "none",
    discountPaise: Number(r.discount_paise ?? 0),
    taxPaise: Number(r.tax_paise ?? 0),
    grandTotalPaise: Number(r.grand_total_paise ?? 0),
    lines,
    status: String(r.status || "open") as VendorBill["status"],
    paidPaise: Number(r.paid_paise ?? 0),
    narration: String(r.narration || ""),
    attachmentNote: String(r.attachment_note || ""),
  };
}

function payableToRow(tenantId: string, p: AccountsPayable): Record<string, unknown> {
  return {
    id: p.id,
    tenant_id: tenantId,
    vendor_id: p.vendorId || "",
    source_type: p.sourceType || "other",
    source_id: p.sourceId || "",
    amount_paise: p.amountPaise ?? 0,
    due_on: p.dueOn,
    status: p.status || "open",
    paid_paise: p.paidPaise ?? 0,
    paid_on: p.paidOn || null,
    note: p.note || "",
    updated_at: nowIso(),
  };
}

function rowToPayable(r: Record<string, unknown>): AccountsPayable {
  const sourceType = String(r.source_type || "other");
  return {
    id: String(r.id),
    vendorId: String(r.vendor_id || ""),
    sourceType:
      sourceType === "expense_bill" || sourceType === "transport_fleet"
        ? sourceType
        : "other",
    sourceId: String(r.source_id || ""),
    amountPaise: Number(r.amount_paise ?? 0),
    dueOn: String(r.due_on).slice(0, 10),
    status: String(r.status || "open") as AccountsPayable["status"],
    paidPaise: Number(r.paid_paise ?? 0),
    paidOn: r.paid_on ? String(r.paid_on).slice(0, 10) : "",
    note: String(r.note || ""),
  };
}

function trusteeToRow(tenantId: string, t: Trustee): Record<string, unknown> {
  return {
    id: t.id,
    tenant_id: tenantId,
    name: t.name || "",
    phone: t.phone || "",
    is_active: t.isActive !== false,
    updated_at: nowIso(),
  };
}

function rowToTrustee(r: Record<string, unknown>): Trustee {
  return {
    id: String(r.id),
    name: String(r.name || ""),
    phone: String(r.phone || ""),
    isActive: r.is_active !== false,
  };
}

function ownerLoanToRow(tenantId: string, l: OwnerLoan): Record<string, unknown> {
  return {
    id: l.id,
    tenant_id: tenantId,
    trustee_id: l.trusteeId || "",
    loan_type: l.type || "working_capital",
    principal_paise: l.principalPaise ?? 0,
    rate_pct: l.ratePct ?? 0,
    tenure_months: l.tenureMonths ?? 0,
    start_date: l.startDate,
    status: l.status || "open",
    note: l.note || "",
    updated_at: nowIso(),
  };
}

function rowToOwnerLoan(r: Record<string, unknown>): OwnerLoan {
  const loanType = String(r.loan_type || "working_capital");
  return {
    id: String(r.id),
    trusteeId: String(r.trustee_id || ""),
    type:
      loanType === "vehicle" || loanType === "capex" ? loanType : "working_capital",
    principalPaise: Number(r.principal_paise ?? 0),
    ratePct: Number(r.rate_pct ?? 0),
    tenureMonths: Number(r.tenure_months ?? 0),
    startDate: String(r.start_date).slice(0, 10),
    status: r.status === "closed" ? "closed" : "open",
    note: String(r.note || ""),
  };
}

function ownerLoanScheduleToRow(
  tenantId: string,
  row: OwnerLoanScheduleRow,
): Record<string, unknown> {
  return {
    id: row.id,
    tenant_id: tenantId,
    loan_id: row.loanId || "",
    installment_no: row.installmentNo ?? 1,
    due_on: row.dueOn,
    amount_paise: row.amountPaise ?? 0,
    status: row.status || "due",
    paid_on: row.paidOn || null,
    paid_amount_paise: row.paidAmountPaise ?? 0,
    updated_at: nowIso(),
  };
}

function rowToOwnerLoanSchedule(r: Record<string, unknown>): OwnerLoanScheduleRow {
  const status = String(r.status || "due");
  return {
    id: String(r.id),
    loanId: String(r.loan_id || ""),
    installmentNo: Number(r.installment_no ?? 1),
    dueOn: String(r.due_on).slice(0, 10),
    amountPaise: Number(r.amount_paise ?? 0),
    status: status === "paid" || status === "waived" ? status : "due",
    paidOn: r.paid_on ? String(r.paid_on).slice(0, 10) : "",
    paidAmountPaise: Number(r.paid_amount_paise ?? 0),
  };
}

function ownerCashHandoverToRow(
  tenantId: string,
  h: OwnerCashHandover,
): Record<string, unknown> {
  return {
    id: h.id,
    tenant_id: tenantId,
    handover_date: h.date,
    amount_paise: h.amountPaise ?? 0,
    from_pool_id: h.fromPoolId || "",
    handed_by: h.handedBy || "",
    received_by: h.receivedBy || "",
    purpose: h.purpose || "",
    note: h.note || "",
    updated_at: nowIso(),
  };
}

function rowToOwnerCashHandover(r: Record<string, unknown>): OwnerCashHandover {
  return {
    id: String(r.id),
    date: String(r.handover_date).slice(0, 10),
    amountPaise: Number(r.amount_paise ?? 0),
    fromPoolId: String(r.from_pool_id || ""),
    handedBy: String(r.handed_by || ""),
    receivedBy: String(r.received_by || ""),
    purpose: String(r.purpose || ""),
    note: String(r.note || ""),
  };
}

function coaToRow(tenantId: string, c: CoaAccount): Record<string, unknown> {
  return {
    id: c.id,
    tenant_id: tenantId,
    code: c.code || "",
    name: c.name || "",
    coa_group: c.group || "expense",
    is_active: c.isActive !== false,
    updated_at: nowIso(),
  };
}

function rowToCoa(r: Record<string, unknown>): CoaAccount {
  const group = String(r.coa_group || "expense");
  return {
    id: String(r.id),
    code: String(r.code || ""),
    name: String(r.name || ""),
    group:
      group === "assets" ||
      group === "liabilities" ||
      group === "income" ||
      group === "equity"
        ? group
        : "expense",
    isActive: r.is_active !== false,
  };
}

function journalEntryToRow(
  tenantId: string,
  j: JournalEntry,
): Record<string, unknown> {
  return {
    id: j.id,
    tenant_id: tenantId,
    entry_date: j.date,
    voucher_no: j.voucherNo || "",
    narration: j.narration || "",
    source_type: j.sourceType || "",
    source_id: j.sourceId || "",
    fiscal_year_code: j.fiscalYearCode || "",
    created_at: j.createdAt || nowIso(),
    voided_at: j.voidedAt || null,
    cancel_reason: j.cancelReason || "",
    updated_at: nowIso(),
  };
}

function journalLineToRow(
  tenantId: string,
  journalId: string,
  idx: number,
  line: JournalLine,
): Record<string, unknown> {
  return {
    id: journalLineId(journalId, idx),
    tenant_id: tenantId,
    journal_id: journalId,
    line_index: idx,
    coa_id: line.coaId || "",
    debit_paise: line.debitPaise ?? 0,
    credit_paise: line.creditPaise ?? 0,
    narration: line.narration || "",
    updated_at: nowIso(),
  };
}

function rowToJournalLine(r: Record<string, unknown>): JournalLine {
  return {
    coaId: String(r.coa_id || ""),
    debitPaise: Number(r.debit_paise ?? 0),
    creditPaise: Number(r.credit_paise ?? 0),
    narration: String(r.narration || ""),
  };
}

function rowToJournalEntry(
  r: Record<string, unknown>,
  lines: JournalLine[],
): JournalEntry {
  return {
    id: String(r.id),
    date: String(r.entry_date).slice(0, 10),
    voucherNo: String(r.voucher_no || ""),
    narration: String(r.narration || ""),
    lines,
    sourceType: String(r.source_type || ""),
    sourceId: String(r.source_id || ""),
    fiscalYearCode: String(r.fiscal_year_code || ""),
    createdAt: String(r.created_at || nowIso()),
    voidedAt: r.voided_at ? String(r.voided_at) : null,
    cancelReason: String(r.cancel_reason || ""),
  };
}

function fiscalYearToRow(tenantId: string, fy: FiscalYear): Record<string, unknown> {
  return {
    id: fy.code,
    tenant_id: tenantId,
    label: fy.label || "",
    start_date: fy.startDate,
    end_date: fy.endDate,
    status: fy.status || "open",
    updated_at: nowIso(),
  };
}

function rowToFiscalYear(r: Record<string, unknown>): FiscalYear {
  return {
    code: String(r.id),
    label: String(r.label || ""),
    startDate: String(r.start_date).slice(0, 10),
    endDate: String(r.end_date).slice(0, 10),
    status: r.status === "closed" ? "closed" : "open",
  };
}

function collectNestedLineIds<T extends { id: string }>(
  parents: Array<{ id: string; lines?: T[] }>,
): Set<string> {
  const keep = new Set<string>();
  for (const parent of parents) {
    for (const line of parent.lines ?? []) {
      keep.add(line.id);
    }
  }
  return keep;
}

function collectJournalLineIds(entries: JournalEntry[]): Set<string> {
  const keep = new Set<string>();
  for (const entry of entries) {
    (entry.lines ?? []).forEach((_, idx) => {
      keep.add(journalLineId(entry.id, idx));
    });
  }
  return keep;
}

function sortLinesByIndex<T>(
  rows: Record<string, unknown>[],
  parentKey: string,
): Map<string, T[]> {
  const map = new Map<string, T[]>();
  const sorted = [...rows].sort(
    (a, b) => Number(a.line_index ?? 0) - Number(b.line_index ?? 0),
  );
  for (const row of sorted) {
    const parentId = String(row[parentKey]);
    const list = map.get(parentId) ?? [];
    list.push(row as T);
    map.set(parentId, list);
  }
  return map;
}

export async function pushAccountsDeskToDb(
  state: AccountsState,
): Promise<{ ok: boolean; error?: string }> {
  if (!accountsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();

  const cashPools = state.cashPools ?? [];
  const cashLedger = state.cashLedger ?? [];
  const bankAccounts = state.bankAccounts ?? [];
  const bankLedger = state.bankLedger ?? [];
  const modeBankMap = state.modeBankMap ?? [];
  const reconSessions = state.reconSessions ?? [];
  const expenseCategories = state.expenseCategories ?? [];
  const expenseVouchers = state.expenseVouchers ?? [];
  const recurringRules = state.recurringRules ?? [];
  const vendors = state.vendors ?? [];
  const vendorBills = state.vendorBills ?? [];
  const payables = state.payables ?? [];
  const trustees = state.trustees ?? [];
  const ownerLoans = state.ownerLoans ?? [];
  const ownerLoanSchedule = state.ownerLoanSchedule ?? [];
  const ownerCashHandovers = state.ownerCashHandovers ?? [];
  const coaAccounts = state.coaAccounts ?? [];
  const journalEntries = state.journalEntries ?? [];
  const fiscalYears = state.fiscalYears ?? [];
  const settings = state.settings ?? DEFAULT_SETTINGS;

  await Promise.all([
    deleteStale(sb, tenantId, "accounts_desk_cash_pools", new Set(cashPools.map((p) => p.id))),
    deleteStale(sb, tenantId, "accounts_desk_cash_ledger", new Set(cashLedger.map((e) => e.id))),
    deleteStale(sb, tenantId, "accounts_desk_bank_accounts", new Set(bankAccounts.map((b) => b.id))),
    deleteStale(sb, tenantId, "accounts_desk_bank_ledger", new Set(bankLedger.map((e) => e.id))),
    deleteStale(sb, tenantId, "accounts_desk_recon_sessions", new Set(reconSessions.map((s) => s.id))),
    deleteStale(
      sb,
      tenantId,
      "accounts_desk_recon_lines",
      collectNestedLineIds(reconSessions),
    ),
    deleteStale(
      sb,
      tenantId,
      "accounts_desk_expense_categories",
      new Set(expenseCategories.map((c) => c.id)),
    ),
    deleteStale(
      sb,
      tenantId,
      "accounts_desk_expense_vouchers",
      new Set(expenseVouchers.map((v) => v.id)),
    ),
    deleteStale(
      sb,
      tenantId,
      "accounts_desk_expense_voucher_lines",
      collectNestedLineIds(expenseVouchers),
    ),
    deleteStale(
      sb,
      tenantId,
      "accounts_desk_recurring_rules",
      new Set(recurringRules.map((r) => r.id)),
    ),
    deleteStale(sb, tenantId, "accounts_desk_vendors", new Set(vendors.map((v) => v.id))),
    deleteStale(sb, tenantId, "accounts_desk_vendor_bills", new Set(vendorBills.map((b) => b.id))),
    deleteStale(
      sb,
      tenantId,
      "accounts_desk_vendor_bill_lines",
      collectNestedLineIds(vendorBills),
    ),
    deleteStale(sb, tenantId, "accounts_desk_payables", new Set(payables.map((p) => p.id))),
    deleteStale(sb, tenantId, "accounts_desk_trustees", new Set(trustees.map((t) => t.id))),
    deleteStale(sb, tenantId, "accounts_desk_owner_loans", new Set(ownerLoans.map((l) => l.id))),
    deleteStale(
      sb,
      tenantId,
      "accounts_desk_owner_loan_schedule",
      new Set(ownerLoanSchedule.map((r) => r.id)),
    ),
    deleteStale(
      sb,
      tenantId,
      "accounts_desk_owner_cash_handovers",
      new Set(ownerCashHandovers.map((h) => h.id)),
    ),
    deleteStale(sb, tenantId, "accounts_desk_coa_accounts", new Set(coaAccounts.map((c) => c.id))),
    deleteStale(
      sb,
      tenantId,
      "accounts_desk_journal_entries",
      new Set(journalEntries.map((j) => j.id)),
    ),
    deleteStale(
      sb,
      tenantId,
      "accounts_desk_journal_lines",
      collectJournalLineIds(journalEntries),
    ),
    deleteStale(
      sb,
      tenantId,
      "accounts_desk_fiscal_years",
      new Set(fiscalYears.map((fy) => fy.code)),
    ),
  ]);

  await sb.from("accounts_desk_mode_bank_map").delete().eq("tenant_id", tenantId);

  const reconLineRows = reconSessions.flatMap((session) =>
    (session.lines ?? []).map((line, idx) =>
      reconLineToRow(tenantId, session.id, idx, line),
    ),
  );
  const expenseVoucherLineRows = expenseVouchers.flatMap((voucher) =>
    (voucher.lines ?? []).map((line, idx) =>
      expenseVoucherLineToRow(tenantId, voucher.id, idx, line),
    ),
  );
  const vendorBillLineRows = vendorBills.flatMap((bill) =>
    (bill.lines ?? []).map((line, idx) =>
      vendorBillLineToRow(tenantId, bill.id, idx, line),
    ),
  );
  const journalLineRows = journalEntries.flatMap((entry) =>
    (entry.lines ?? []).map((line, idx) =>
      journalLineToRow(tenantId, entry.id, idx, line),
    ),
  );

  const tables: [string, Record<string, unknown>[]][] = [
    ["accounts_desk_cash_pools", cashPools.map((p) => cashPoolToRow(tenantId, p))],
    ["accounts_desk_cash_ledger", cashLedger.map((e) => cashLedgerToRow(tenantId, e))],
    ["accounts_desk_bank_accounts", bankAccounts.map((b) => bankAccountToRow(tenantId, b))],
    ["accounts_desk_bank_ledger", bankLedger.map((e) => bankLedgerToRow(tenantId, e))],
    ["accounts_desk_mode_bank_map", modeBankMap.map((m) => modeBankMapToRow(tenantId, m))],
    ["accounts_desk_recon_sessions", reconSessions.map((s) => reconSessionToRow(tenantId, s))],
    ["accounts_desk_recon_lines", reconLineRows],
    [
      "accounts_desk_expense_categories",
      expenseCategories.map((c) => expenseCategoryToRow(tenantId, c)),
    ],
    ["accounts_desk_expense_vouchers", expenseVouchers.map((v) => expenseVoucherToRow(tenantId, v))],
    ["accounts_desk_expense_voucher_lines", expenseVoucherLineRows],
    ["accounts_desk_recurring_rules", recurringRules.map((r) => recurringRuleToRow(tenantId, r))],
    ["accounts_desk_vendors", vendors.map((v) => vendorToRow(tenantId, v))],
    ["accounts_desk_vendor_bills", vendorBills.map((b) => vendorBillToRow(tenantId, b))],
    ["accounts_desk_vendor_bill_lines", vendorBillLineRows],
    ["accounts_desk_payables", payables.map((p) => payableToRow(tenantId, p))],
    ["accounts_desk_trustees", trustees.map((t) => trusteeToRow(tenantId, t))],
    ["accounts_desk_owner_loans", ownerLoans.map((l) => ownerLoanToRow(tenantId, l))],
    [
      "accounts_desk_owner_loan_schedule",
      ownerLoanSchedule.map((r) => ownerLoanScheduleToRow(tenantId, r)),
    ],
    [
      "accounts_desk_owner_cash_handovers",
      ownerCashHandovers.map((h) => ownerCashHandoverToRow(tenantId, h)),
    ],
    ["accounts_desk_coa_accounts", coaAccounts.map((c) => coaToRow(tenantId, c))],
    ["accounts_desk_journal_entries", journalEntries.map((j) => journalEntryToRow(tenantId, j))],
    ["accounts_desk_journal_lines", journalLineRows],
    ["accounts_desk_fiscal_years", fiscalYears.map((fy) => fiscalYearToRow(tenantId, fy))],
  ];

  for (const [table, rows] of tables) {
    const r = await upsertChunks(sb, table, rows);
    if (!r.ok) return r;
  }

  await sb.from("accounts_desk_settings").upsert(
    {
      tenant_id: tenantId,
      expense_approval_paise: settings.expenseApprovalPaise ?? DEFAULT_SETTINGS.expenseApprovalPaise,
      petty_threshold_paise: settings.pettyThresholdPaise ?? DEFAULT_SETTINGS.pettyThresholdPaise,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  let lastVoucherAt: string | null = null;
  for (const v of expenseVouchers) {
    const at = v.date;
    if (at && (!lastVoucherAt || at > lastVoucherAt)) lastVoucherAt = at;
  }

  await sb.from("accounts_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      coa_count: coaAccounts.length,
      voucher_count: expenseVouchers.length,
      journal_count: journalEntries.length,
      vendor_bill_count: vendorBills.length,
      last_voucher_at: lastVoucherAt,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchAccountsDeskFromDb(): Promise<{
  bundle: AccountsDeskBundle;
  meta: AccountsDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  const empty: AccountsDeskBundle = {
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
    settings: DEFAULT_SETTINGS,
  };
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [
    { data: cashPoolRows },
    { data: cashLedgerRows },
    { data: bankAccountRows },
    { data: bankLedgerRows },
    { data: modeBankMapRows },
    { data: reconSessionRows },
    { data: reconLineRows },
    { data: expenseCategoryRows },
    { data: expenseVoucherRows },
    { data: expenseVoucherLineRows },
    { data: recurringRuleRows },
    { data: vendorRows },
    { data: vendorBillRows },
    { data: vendorBillLineRows },
    { data: payableRows },
    { data: trusteeRows },
    { data: ownerLoanRows },
    { data: ownerLoanScheduleRows },
    { data: ownerCashHandoverRows },
    { data: coaRows },
    { data: journalEntryRows },
    { data: journalLineRows },
    { data: fiscalYearRows },
    { data: settingsRow },
    { data: metaRow },
  ] = await Promise.all([
    sb.from("accounts_desk_cash_pools").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_cash_ledger").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_bank_accounts").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_bank_ledger").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_mode_bank_map").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_recon_sessions").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_recon_lines").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_expense_categories").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_expense_vouchers").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_expense_voucher_lines").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_recurring_rules").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_vendors").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_vendor_bills").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_vendor_bill_lines").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_payables").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_trustees").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_owner_loans").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_owner_loan_schedule").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_owner_cash_handovers").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_coa_accounts").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_journal_entries").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_journal_lines").select("*").eq("tenant_id", tenantId),
    sb.from("accounts_desk_fiscal_years").select("*").eq("tenant_id", tenantId),
    sb
      .from("accounts_desk_settings")
      .select("expense_approval_paise, petty_threshold_paise")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
    sb
      .from("accounts_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  const reconLinesBySession = sortLinesByIndex<Record<string, unknown>>(
    (reconLineRows ?? []) as Record<string, unknown>[],
    "session_id",
  );
  const expenseVoucherLinesByVoucher = sortLinesByIndex<Record<string, unknown>>(
    (expenseVoucherLineRows ?? []) as Record<string, unknown>[],
    "voucher_id",
  );
  const vendorBillLinesByBill = sortLinesByIndex<Record<string, unknown>>(
    (vendorBillLineRows ?? []) as Record<string, unknown>[],
    "bill_id",
  );
  const journalLinesByEntry = sortLinesByIndex<Record<string, unknown>>(
    (journalLineRows ?? []) as Record<string, unknown>[],
    "journal_id",
  );

  const s = settingsRow as {
    expense_approval_paise?: number;
    petty_threshold_paise?: number;
  } | null;

  return {
    bundle: {
      cashPools: (cashPoolRows ?? []).map((r) =>
        rowToCashPool(r as Record<string, unknown>),
      ),
      cashLedger: (cashLedgerRows ?? []).map((r) =>
        rowToCashLedger(r as Record<string, unknown>),
      ),
      bankAccounts: (bankAccountRows ?? []).map((r) =>
        rowToBankAccount(r as Record<string, unknown>),
      ),
      bankLedger: (bankLedgerRows ?? []).map((r) =>
        rowToBankLedger(r as Record<string, unknown>),
      ),
      modeBankMap: (modeBankMapRows ?? []).map((r) =>
        rowToModeBankMap(r as Record<string, unknown>),
      ),
      reconSessions: (reconSessionRows ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        const lines = (reconLinesBySession.get(String(rec.id)) ?? []).map((line) =>
          rowToReconLine(line),
        );
        return rowToReconSession(rec, lines);
      }),
      expenseCategories: (expenseCategoryRows ?? []).map((r) =>
        rowToExpenseCategory(r as Record<string, unknown>),
      ),
      expenseVouchers: (expenseVoucherRows ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        const lines = (expenseVoucherLinesByVoucher.get(String(rec.id)) ?? []).map((line) =>
          rowToExpenseVoucherLine(line),
        );
        return rowToExpenseVoucher(rec, lines);
      }),
      recurringRules: (recurringRuleRows ?? []).map((r) =>
        rowToRecurringRule(r as Record<string, unknown>),
      ),
      vendors: (vendorRows ?? []).map((r) => rowToVendor(r as Record<string, unknown>)),
      vendorBills: (vendorBillRows ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        const lines = (vendorBillLinesByBill.get(String(rec.id)) ?? []).map((line) =>
          rowToVendorBillLine(line),
        );
        return rowToVendorBill(rec, lines);
      }),
      payables: (payableRows ?? []).map((r) =>
        rowToPayable(r as Record<string, unknown>),
      ),
      trustees: (trusteeRows ?? []).map((r) => rowToTrustee(r as Record<string, unknown>)),
      ownerLoans: (ownerLoanRows ?? []).map((r) =>
        rowToOwnerLoan(r as Record<string, unknown>),
      ),
      ownerLoanSchedule: (ownerLoanScheduleRows ?? []).map((r) =>
        rowToOwnerLoanSchedule(r as Record<string, unknown>),
      ),
      ownerCashHandovers: (ownerCashHandoverRows ?? []).map((r) =>
        rowToOwnerCashHandover(r as Record<string, unknown>),
      ),
      coaAccounts: (coaRows ?? []).map((r) => rowToCoa(r as Record<string, unknown>)),
      journalEntries: (journalEntryRows ?? []).map((r) => {
        const rec = r as Record<string, unknown>;
        const lines = (journalLinesByEntry.get(String(rec.id)) ?? []).map((line) =>
          rowToJournalLine(line),
        );
        return rowToJournalEntry(rec, lines);
      }),
      fiscalYears: (fiscalYearRows ?? []).map((r) =>
        rowToFiscalYear(r as Record<string, unknown>),
      ),
      settings: {
        expenseApprovalPaise:
          s?.expense_approval_paise ?? DEFAULT_SETTINGS.expenseApprovalPaise,
        pettyThresholdPaise:
          s?.petty_threshold_paise ?? DEFAULT_SETTINGS.pettyThresholdPaise,
      },
    },
    meta: metaRow
      ? {
          coaCount: (metaRow as { coa_count: number }).coa_count,
          voucherCount: (metaRow as { voucher_count: number }).voucher_count,
          journalCount: (metaRow as { journal_count: number }).journal_count,
          vendorBillCount: (metaRow as { vendor_bill_count: number }).vendor_bill_count,
          lastVoucherAt: (metaRow as { last_voucher_at: string | null }).last_voucher_at,
          updatedAt: String((metaRow as { updated_at: string }).updated_at),
        }
      : null,
  };
}
