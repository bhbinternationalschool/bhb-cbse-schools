/**
 * Accounts module reports — cash, expenses, payables, books.
 */

import {
  balanceSheet,
  BANK_PAYMENT_MODE_LABELS,
  cashInHandPaise,
  coaLedgerRows,
  getBank,
  getExpenseCategory,
  groupSummary,
  isExpenseVoucherCancelled,
  listJournals,
  listOwnerLoanDue,
  listUnifiedPayables,
  profitAndLoss,
  totalBankBalancePaise,
  loadAccounts,
  trialBalance,
  type AccountsState,
  type ExpensePaymentSplit,
} from "@/lib/accounts";
import { buildDayBook, loadFees, tenderModeLabel } from "@/lib/fees";
import { formatInr } from "@/lib/masters";
import {
  describeFilters,
  exportFilterReport,
} from "@/lib/reportExport";
import { TENANT } from "@/lib/types";

function formatExpensePaymentSplitLine(
  split: ExpensePaymentSplit,
  accounts: AccountsState,
): string {
  const modeLabel = BANK_PAYMENT_MODE_LABELS[split.mode] ?? split.mode;
  if (split.mode === "cash") {
    const pool = accounts.cashPools.find((p) => p.id === split.poolId);
    return `${modeLabel}${pool ? ` · ${pool.name}` : ""}${split.transactionRef ? ` · ${split.transactionRef}` : ""}`;
  }
  const bank = accounts.bankAccounts.find((b) => b.id === split.bankId);
  return `${modeLabel}${bank ? ` · ${bank.name}` : ""}${split.transactionRef ? ` · ${split.transactionRef}` : ""}`;
}

export type AccountsReportFormat = "excel" | "pdf";

export type AccountsReportId =
  | "receipts_payments"
  | "day_book"
  | "cash_register"
  | "ledger"
  | "headwise_receipts_payments"
  | "group_summary"
  | "journal_register"
  | "cancelled_receipts_payments"
  | "expenses_by_category"
  | "expenses_by_subcategory"
  | "transaction_id_register"
  | "ap_ageing"
  | "owner_loan_register"
  | "trial_balance"
  | "profit_loss"
  | "balance_sheet";

export type AccountsReportCategory =
  | "cashflow"
  | "ledgers"
  | "expenses"
  | "payables"
  | "books";

export type AccountsReportDef = {
  id: AccountsReportId;
  category: AccountsReportCategory;
  label: string;
  hint?: string;
};

export const ACCOUNTS_REPORT_CATEGORIES: {
  id: AccountsReportCategory;
  title: string;
  headerClass: string;
}[] = [
  { id: "cashflow", title: "Cash & bank", headerClass: "bg-[#1565c0]" },
  { id: "ledgers", title: "Ledgers & journals", headerClass: "bg-[#6d28d9]" },
  { id: "expenses", title: "Expenses", headerClass: "bg-[#ef6c00]" },
  { id: "payables", title: "Payables & loans", headerClass: "bg-[#0f766e]" },
  { id: "books", title: "Financial statements", headerClass: "bg-[#0f2744]" },
];

export const ACCOUNTS_REPORTS: AccountsReportDef[] = [
  {
    id: "receipts_payments",
    category: "cashflow",
    label: "Payment / Receipt Report",
    hint: "Cash + bank movements for date range",
  },
  {
    id: "day_book",
    category: "cashflow",
    label: "Day book",
    hint: "Fees + expenses + ledger for one date",
  },
  {
    id: "cash_register",
    category: "cashflow",
    label: "Cash Book",
    hint: "Pool ledger with running balance",
  },
  {
    id: "cancelled_receipts_payments",
    category: "cashflow",
    label: "Payment / Receipt Cancelled Report",
    hint: "Voided receipts, cash/bank, expense vouchers & journals with reasons",
  },
  {
    id: "ledger",
    category: "ledgers",
    label: "Ledger Report",
    hint: "Account-wise COA ledger (pick account)",
  },
  {
    id: "headwise_receipts_payments",
    category: "ledgers",
    label: "Head wise Payment / Receipt Report",
    hint: "Receipts & payments grouped by ledger head",
  },
  {
    id: "group_summary",
    category: "ledgers",
    label: "Group Summary",
    hint: "Assets · liabilities · equity · income · expense",
  },
  {
    id: "journal_register",
    category: "ledgers",
    label: "Journal Register",
    hint: "All journal vouchers in period",
  },
  {
    id: "expenses_by_category",
    category: "expenses",
    label: "Expenses by category",
    hint: "Paid vouchers in period",
  },
  {
    id: "expenses_by_subcategory",
    category: "expenses",
    label: "Expenses by sub-category",
    hint: "Category + sub-category totals for date range",
  },
  {
    id: "transaction_id_register",
    category: "cashflow",
    label: "Transaction ID register",
    hint: "Payments & receipts with txn / UPI / cheque refs",
  },
  {
    id: "ap_ageing",
    category: "payables",
    label: "AP ageing",
    hint: "Open payables by due date",
  },
  {
    id: "owner_loan_register",
    category: "payables",
    label: "Owner loan register",
    hint: "Loans + EMI schedule",
  },
  {
    id: "trial_balance",
    category: "books",
    label: "Trial Balance",
    hint: "As-of date from journal",
  },
  {
    id: "profit_loss",
    category: "books",
    label: "Profit & loss",
    hint: "Income vs expense for period",
  },
  {
    id: "balance_sheet",
    category: "books",
    label: "Balance sheet",
    hint: "Assets · liabilities · equity",
  },
];

export type AccountsReportFilters = {
  date?: string;
  fromDate?: string;
  toDate?: string;
  asOf?: string;
  poolId?: string;
  /** Required for Ledger Report */
  coaId?: string;
  format: AccountsReportFormat;
  accounts?: AccountsState;
};

function todayYmd() {
  return new Date().toISOString().slice(0, 10);
}

function inRange(d: string, from: string, to: string) {
  if (from && d < from) return false;
  if (to && d > to) return false;
  return true;
}

export function runAccountsReport(
  id: AccountsReportId,
  filters: AccountsReportFilters,
): { ok: true; message: string } | { ok: false; error: string } {
  const accounts = filters.accounts ?? loadAccounts();
  const date = filters.date || todayYmd();
  const from = filters.fromDate || date;
  const to = filters.toDate || date;
  const asOf = filters.asOf || date;
  const note = describeFilters([
    filters.date ? `Date ${date}` : null,
    filters.fromDate || filters.toDate ? `Period ${from} → ${to}` : null,
    filters.asOf ? `As of ${asOf}` : null,
    filters.poolId
      ? `Pool ${accounts.cashPools.find((p) => p.id === filters.poolId)?.name || filters.poolId}`
      : null,
    filters.coaId
      ? `Account ${accounts.coaAccounts.find((c) => c.id === filters.coaId)?.name || filters.coaId}`
      : null,
  ]);

  switch (id) {
    case "receipts_payments": {
      const rows: Record<string, string>[] = [];
      for (const e of accounts.cashLedger) {
        if (e.voidedAt) continue;
        if (!inRange(e.date, from, to)) continue;
        if (filters.poolId && e.poolId !== filters.poolId) continue;
        const pool = accounts.cashPools.find((p) => p.id === e.poolId);
        rows.push({
          date: e.date,
          book: "Cash",
          account: pool?.name || e.poolId,
          direction: e.direction === "in" ? "Receipt" : "Payment",
          amount: formatInr(e.amountPaise),
          transactionId: e.transactionRef || "—",
          source: e.sourceType,
          narration: e.narration,
        });
      }
      for (const e of accounts.bankLedger) {
        if (e.voidedAt) continue;
        if (!inRange(e.date, from, to)) continue;
        const bank = getBank(e.bankId, accounts);
        rows.push({
          date: e.date,
          book: "Bank",
          account: bank?.name || e.bankId,
          direction: e.direction === "dr" ? "Receipt" : "Payment",
          amount: formatInr(e.amountPaise),
          transactionId: e.transactionRef || "—",
          source: e.sourceType,
          narration: e.narration,
        });
      }
      rows.sort((a, b) => a.date.localeCompare(b.date));
      const r = exportFilterReport(
        {
          title: "Receipts & payments register",
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: note,
          columns: [
            { key: "date", header: "Date", width: 0.9 },
            { key: "book", header: "Book", width: 0.7 },
            { key: "account", header: "Account", width: 1.1 },
            { key: "direction", header: "Type", width: 0.8 },
            { key: "amount", header: "Amount", width: 0.9 },
            { key: "transactionId", header: "Txn ID", width: 1 },
            { key: "source", header: "Source", width: 1 },
            { key: "narration", header: "Narration", width: 1.4 },
          ],
          rows,
          fileBaseName: "accounts_receipts_payments",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Receipts & payments: ${rows.length} row(s)` }
        : r;
    }
    case "day_book": {
      const book = buildDayBook(date);
      const rows: Record<string, string>[] = [];
      for (const m of book.modeTotals) {
        rows.push({
          section: "Fee collection",
          detail: tenderModeLabel(m.mode),
          count: String(m.tenderCount),
          inOut: "In",
          amount: formatInr(m.paise),
        });
      }
      for (const v of accounts.expenseVouchers) {
        if (
          v.date !== date ||
          isExpenseVoucherCancelled(v) ||
          (v.paymentStatus !== "draft" && v.paymentStatus !== "pending_approval")
        ) {
          continue;
        }
        const cat = getExpenseCategory(v.categoryId, accounts);
        rows.push({
          section: "Expense (unpaid)",
          detail: `${v.voucherNo} · ${cat?.name || v.categoryId}`,
          count: "1",
          inOut: "Out",
          amount: formatInr(v.grandTotalPaise || v.amountPaise),
        });
      }
      for (const v of accounts.expenseVouchers) {
        if (isExpenseVoucherCancelled(v) || v.paidPaise <= 0) continue;
        const payDate = v.paidOn || v.date;
        if (payDate !== date) continue;
        if (v.paymentSplits.length > 0) {
          for (const split of v.paymentSplits) {
            rows.push({
              section: "Expense payment",
              detail: `${v.voucherNo} · ${formatExpensePaymentSplitLine(split, accounts)}`,
              count: v.narration || "paid",
              inOut: "Out",
              amount: formatInr(split.amountPaise),
            });
          }
        } else {
          rows.push({
            section: "Expense payment",
            detail: `${v.voucherNo} · ${v.narration || "paid"}`,
            count: v.paymentStatus,
            inOut: "Out",
            amount: formatInr(v.paidPaise),
          });
        }
      }
      for (const e of accounts.cashLedger.filter((x) => x.date === date && !x.voidedAt)) {
        const pool = accounts.cashPools.find((p) => p.id === e.poolId);
        rows.push({
          section: "Cash ledger",
          detail: pool?.name || e.poolId,
          count: e.sourceType,
          inOut: e.direction === "in" ? "In" : "Out",
          amount: formatInr(e.amountPaise),
        });
      }
      for (const e of accounts.bankLedger.filter((x) => x.date === date && !x.voidedAt)) {
        const bank = getBank(e.bankId, accounts);
        rows.push({
          section: "Bank ledger",
          detail: bank?.name || e.bankId,
          count: e.sourceType,
          inOut: e.direction === "dr" ? "In" : "Out",
          amount: formatInr(e.amountPaise),
        });
      }
      for (const j of accounts.journalEntries.filter(
        (x) =>
          !x.voidedAt &&
          x.date === date &&
          [
            "store_sale",
            "store_sell_return",
            "vendor_bill",
            "purchase_return",
            "accounts_payable",
          ].includes(x.sourceType),
      )) {
        const amt = j.lines.reduce((n, l) => n + l.debitPaise, 0);
        rows.push({
          section: "Store / purchase JV",
          detail: j.narration || j.sourceType,
          count: j.sourceType,
          inOut: "JV",
          amount: formatInr(amt),
        });
      }
      const r = exportFilterReport(
        {
          title: `Accounts day book · ${date}`,
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: `${note} · Fee receipts ${book.receiptCount} · ${formatInr(book.totalPaise)}`,
          columns: [
            { key: "section", header: "Section", width: 1 },
            { key: "detail", header: "Detail", width: 1.2 },
            { key: "count", header: "Ref / count", width: 0.9 },
            { key: "inOut", header: "In/Out", width: 0.6 },
            { key: "amount", header: "Amount", width: 0.9 },
          ],
          rows,
          fileBaseName: "accounts_day_book",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Day book ${date}: ${rows.length} line(s)` }
        : r;
    }
    case "cash_register": {
      const ledger = accounts.cashLedger
        .filter((e) => !e.voidedAt)
        .filter((e) => !filters.poolId || e.poolId === filters.poolId)
        .filter((e) => inRange(e.date, from, to))
        .sort((a, b) => a.date.localeCompare(b.date));
      const rows = ledger.map((e) => {
        const pool = accounts.cashPools.find((p) => p.id === e.poolId);
        return {
          date: e.date,
          pool: pool?.name || e.poolId,
          direction: e.direction,
          amount: formatInr(e.amountPaise),
          balance: formatInr(e.runningBalancePaise),
          source: e.sourceType,
          narration: e.narration,
        };
      });
      const r = exportFilterReport(
        {
          title: "Cash register",
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: `${note} · On hand ${formatInr(cashInHandPaise(accounts))}`,
          columns: [
            { key: "date", header: "Date", width: 0.9 },
            { key: "pool", header: "Pool", width: 1 },
            { key: "direction", header: "Dir", width: 0.6 },
            { key: "amount", header: "Amount", width: 0.9 },
            { key: "balance", header: "Balance", width: 0.9 },
            { key: "source", header: "Source", width: 0.9 },
            { key: "narration", header: "Narration", width: 1.2 },
          ],
          rows,
          fileBaseName: "accounts_cash_register",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Cash register: ${rows.length} entry(ies)` }
        : r;
    }
    case "ledger": {
      const coaId =
        filters.coaId ||
        accounts.coaAccounts.find((c) => c.isActive)?.id ||
        "";
      const coa = accounts.coaAccounts.find((c) => c.id === coaId);
      if (!coa) {
        return { ok: false, error: "Pick a ledger account (COA)" };
      }
      const rows = coaLedgerRows(coaId, from, to, accounts).map((r) => ({
        date: r.date,
        voucher: r.voucherNo,
        narration: r.narration,
        source: r.sourceType,
        debit: r.debitPaise ? formatInr(r.debitPaise) : "",
        credit: r.creditPaise ? formatInr(r.creditPaise) : "",
        balance: formatInr(r.balancePaise),
      }));
      const r = exportFilterReport(
        {
          title: `Ledger · ${coa.code} ${coa.name}`,
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: note,
          columns: [
            { key: "date", header: "Date", width: 0.9 },
            { key: "voucher", header: "Voucher", width: 0.9 },
            { key: "narration", header: "Narration", width: 1.4 },
            { key: "source", header: "Source", width: 1 },
            { key: "debit", header: "Debit", width: 0.9 },
            { key: "credit", header: "Credit", width: 0.9 },
            { key: "balance", header: "Balance", width: 0.9 },
          ],
          rows,
          fileBaseName: `accounts_ledger_${coa.code}`,
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Ledger ${coa.code}: ${rows.length} line(s)` }
        : r;
    }
    case "headwise_receipts_payments": {
      type Agg = {
        head: string;
        code: string;
        receipts: number;
        payments: number;
      };
      const map = new Map<string, Agg>();
      const bump = (
        coaId: string,
        kind: "receipt" | "payment",
        paise: number,
      ) => {
        if (paise <= 0 || !coaId) return;
        const coa = accounts.coaAccounts.find((c) => c.id === coaId);
        const key = coaId;
        const cur = map.get(key) ?? {
          head: coa?.name || "Unknown",
          code: coa?.code || "",
          receipts: 0,
          payments: 0,
        };
        if (kind === "receipt") cur.receipts += paise;
        else cur.payments += paise;
        map.set(key, cur);
      };
      const cashBankIds = new Set(
        accounts.coaAccounts
          .filter((c) => c.code === "1000" || c.code === "1010")
          .map((c) => c.id),
      );
      for (const entry of accounts.journalEntries) {
        if (entry.voidedAt) continue;
        if (!inRange(entry.date, from, to)) continue;
        const cashBankDebit = entry.lines
          .filter((l) => cashBankIds.has(l.coaId))
          .reduce((n, l) => n + l.debitPaise, 0);
        const cashBankCredit = entry.lines
          .filter((l) => cashBankIds.has(l.coaId))
          .reduce((n, l) => n + l.creditPaise, 0);
        for (const line of entry.lines) {
          if (cashBankIds.has(line.coaId)) continue;
          // Receipts: money in (cash/bank Dr) credited to this head
          if (cashBankDebit > 0 && line.creditPaise > 0) {
            bump(line.coaId, "receipt", line.creditPaise);
          }
          // Payments: money out (cash/bank Cr) debited to this head
          if (cashBankCredit > 0 && line.debitPaise > 0) {
            bump(line.coaId, "payment", line.debitPaise);
          }
        }
      }
      const rows = [...map.values()]
        .filter((a) => a.receipts > 0 || a.payments > 0)
        .sort((a, b) => a.code.localeCompare(b.code) || a.head.localeCompare(b.head))
        .map((a) => ({
          code: a.code,
          head: a.head,
          receipts: formatInr(a.receipts),
          payments: formatInr(a.payments),
          net: formatInr(a.receipts - a.payments),
        }));
      const r = exportFilterReport(
        {
          title: "Head-wise payment / receipt report",
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: note,
          columns: [
            { key: "code", header: "Code", width: 0.7 },
            { key: "head", header: "Ledger head", width: 1.4 },
            { key: "receipts", header: "Receipts", width: 1 },
            { key: "payments", header: "Payments", width: 1 },
            { key: "net", header: "Net", width: 1 },
          ],
          rows,
          fileBaseName: "accounts_headwise_pr",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Head-wise P/R: ${rows.length} head(s)` }
        : r;
    }
    case "group_summary": {
      const rows = groupSummary(asOf, accounts).map((g) => ({
        group: g.group,
        accounts: String(g.accountCount),
        debit: formatInr(g.debitPaise),
        credit: formatInr(g.creditPaise),
        balance: formatInr(g.balancePaise),
      }));
      const r = exportFilterReport(
        {
          title: `Group summary · as of ${asOf}`,
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: note,
          columns: [
            { key: "group", header: "Group", width: 1 },
            { key: "accounts", header: "Accounts", width: 0.8 },
            { key: "debit", header: "Debit", width: 1 },
            { key: "credit", header: "Credit", width: 1 },
            { key: "balance", header: "Balance", width: 1 },
          ],
          rows,
          fileBaseName: "accounts_group_summary",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Group summary: ${rows.length} group(s)` }
        : r;
    }
    case "journal_register": {
      const rows: Record<string, string>[] = [];
      for (const j of listJournals(accounts)) {
        if (j.voidedAt) continue;
        if (!inRange(j.date, from, to)) continue;
        for (const line of j.lines) {
          const coa = accounts.coaAccounts.find((c) => c.id === line.coaId);
          rows.push({
            date: j.date,
            voucher: j.voucherNo || j.id.slice(-8),
            narration: j.narration,
            source: j.sourceType,
            code: coa?.code || "",
            account: coa?.name || line.coaId,
            debit: line.debitPaise ? formatInr(line.debitPaise) : "",
            credit: line.creditPaise ? formatInr(line.creditPaise) : "",
            lineNote: line.narration,
          });
        }
      }
      const r = exportFilterReport(
        {
          title: "Journal register",
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: note,
          columns: [
            { key: "date", header: "Date", width: 0.85 },
            { key: "voucher", header: "Voucher", width: 0.85 },
            { key: "source", header: "Source", width: 0.9 },
            { key: "code", header: "Code", width: 0.6 },
            { key: "account", header: "Account", width: 1.2 },
            { key: "debit", header: "Debit", width: 0.85 },
            { key: "credit", header: "Credit", width: 0.85 },
            { key: "narration", header: "Narration", width: 1.2 },
            { key: "lineNote", header: "Line note", width: 1 },
          ],
          rows,
          fileBaseName: "accounts_journal_register",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Journal register: ${rows.length} line(s)` }
        : r;
    }
    case "cancelled_receipts_payments": {
      const rows: Record<string, string>[] = [];
      for (const e of accounts.cashLedger) {
        if (!e.voidedAt) continue;
        if (!inRange(e.date, from, to) && !inRange(e.voidedAt.slice(0, 10), from, to))
          continue;
        const pool = accounts.cashPools.find((p) => p.id === e.poolId);
        rows.push({
          cancelledOn: e.voidedAt.slice(0, 10),
          txnDate: e.date,
          book: "Cash",
          account: pool?.name || e.poolId,
          type: e.direction === "in" ? "Receipt" : "Payment",
          amount: formatInr(e.amountPaise),
          source: e.sourceType,
          reason: e.cancelReason || "",
          narration: e.narration,
        });
      }
      for (const e of accounts.bankLedger) {
        if (!e.voidedAt) continue;
        if (!inRange(e.date, from, to) && !inRange(e.voidedAt.slice(0, 10), from, to))
          continue;
        const bank = getBank(e.bankId, accounts);
        rows.push({
          cancelledOn: e.voidedAt.slice(0, 10),
          txnDate: e.date,
          book: "Bank",
          account: bank?.name || e.bankId,
          type: e.direction === "dr" ? "Receipt" : "Payment",
          amount: formatInr(e.amountPaise),
          source: e.sourceType,
          reason: e.cancelReason || "",
          narration: e.narration,
        });
      }
      for (const v of accounts.expenseVouchers) {
        if (!isExpenseVoucherCancelled(v)) continue;
        const cancelDate = (v.cancelledAt || v.date).slice(0, 10);
        if (!inRange(v.date, from, to) && !inRange(cancelDate, from, to)) continue;
        const cat = getExpenseCategory(v.categoryId, accounts);
        rows.push({
          cancelledOn: cancelDate,
          txnDate: v.paidOn || v.date,
          book: "Expense voucher",
          account: v.voucherNo || cat?.name || v.categoryId,
          type: "Payment",
          amount: formatInr(v.grandTotalPaise || v.amountPaise),
          source: "expense_voucher",
          reason: v.cancelReason || "",
          narration: v.narration,
        });
      }
      for (const j of accounts.journalEntries) {
        if (!j.voidedAt) continue;
        const cancelDate = j.voidedAt.slice(0, 10);
        if (!inRange(j.date, from, to) && !inRange(cancelDate, from, to)) continue;
        const amt = j.lines.reduce((n, l) => n + l.debitPaise, 0);
        rows.push({
          cancelledOn: cancelDate,
          txnDate: j.date,
          book: "Journal",
          account: j.voucherNo || j.id.slice(-8),
          type: "JV",
          amount: formatInr(amt),
          source: j.sourceType,
          reason: j.cancelReason || "",
          narration: j.narration,
        });
      }
      try {
        const fees = loadFees();
        for (const v of fees.vouchers) {
          if (!v.voidedAt) continue;
          const cancelDate = v.voidedAt.slice(0, 10);
          if (!inRange(v.collectionDate, from, to) && !inRange(cancelDate, from, to))
            continue;
          rows.push({
            cancelledOn: cancelDate,
            txnDate: v.collectionDate,
            book: "Fee receipt",
            account: v.receiptNo || v.id.slice(-8),
            type: "Receipt",
            amount: formatInr(
              (v.tenders ?? []).reduce((n, t) => n + t.amountPaise, 0),
            ),
            source: "fee_void",
            reason: "",
            narration: v.householdId || "",
          });
        }
      } catch {
        /* fees unavailable */
      }
      rows.sort((a, b) =>
        a.cancelledOn.localeCompare(b.cancelledOn) ||
        a.txnDate.localeCompare(b.txnDate),
      );
      const r = exportFilterReport(
        {
          title: "Payment / receipt cancelled report",
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: note,
          columns: [
            { key: "cancelledOn", header: "Cancelled on", width: 0.95 },
            { key: "txnDate", header: "Txn date", width: 0.9 },
            { key: "book", header: "Book", width: 0.9 },
            { key: "account", header: "Account / ref", width: 1.2 },
            { key: "type", header: "Type", width: 0.8 },
            { key: "amount", header: "Amount", width: 0.9 },
            { key: "source", header: "Source", width: 0.9 },
            { key: "reason", header: "Reason", width: 1.2 },
            { key: "narration", header: "Narration", width: 1.2 },
          ],
          rows,
          fileBaseName: "accounts_cancelled_pr",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Cancelled P/R: ${rows.length} row(s)` }
        : r;
    }
    case "expenses_by_category": {
      const totals = new Map<string, { name: string; count: number; paise: number }>();
      for (const v of accounts.expenseVouchers) {
        if (v.paymentStatus !== "paid" || isExpenseVoucherCancelled(v)) continue;
        if (!inRange(v.paidOn || v.date, from, to)) continue;
        const cat = getExpenseCategory(v.categoryId, accounts);
        const key = v.categoryId || "uncategorized";
        const cur = totals.get(key) ?? {
          name: cat?.name || "Uncategorized",
          count: 0,
          paise: 0,
        };
        cur.count += 1;
        cur.paise += v.amountPaise;
        totals.set(key, cur);
      }
      const rows = [...totals.values()]
        .sort((a, b) => b.paise - a.paise)
        .map((t) => ({
          category: t.name,
          vouchers: t.count,
          total: formatInr(t.paise),
        }));
      const r = exportFilterReport(
        {
          title: "Expenses by category",
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: note,
          columns: [
            { key: "category", header: "Category", width: 1.4 },
            { key: "vouchers", header: "Vouchers", width: 0.8, align: "right" },
            { key: "total", header: "Total", width: 1 },
          ],
          rows,
          fileBaseName: "accounts_expenses_by_category",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Expenses: ${rows.length} category(ies)` }
        : r;
    }
    case "expenses_by_subcategory": {
      const totals = new Map<
        string,
        {
          category: string;
          subcategory: string;
          count: number;
          paise: number;
        }
      >();
      for (const v of accounts.expenseVouchers) {
        if (v.paymentStatus !== "paid" || isExpenseVoucherCancelled(v)) continue;
        if (!inRange(v.paidOn || v.date, from, to)) continue;
        for (const line of v.lines) {
          const cat = getExpenseCategory(line.categoryId, accounts);
          const sub = line.subcategoryId
            ? getExpenseCategory(line.subcategoryId, accounts)
            : undefined;
          const key = `${line.categoryId}:${line.subcategoryId || ""}`;
          const share =
            v.grandTotalPaise > 0
              ? Math.round((line.totalPaise / v.grandTotalPaise) * v.amountPaise)
              : line.totalPaise;
          const cur = totals.get(key) ?? {
            category: cat?.name || "Uncategorized",
            subcategory: sub?.name || "—",
            count: 0,
            paise: 0,
          };
          cur.count += 1;
          cur.paise += share;
          totals.set(key, cur);
        }
      }
      const rows = [...totals.values()]
        .sort(
          (a, b) =>
            a.category.localeCompare(b.category) ||
            a.subcategory.localeCompare(b.subcategory),
        )
        .map((t) => ({
          category: t.category,
          subcategory: t.subcategory,
          lines: String(t.count),
          total: formatInr(t.paise),
        }));
      const r = exportFilterReport(
        {
          title: "Expenses by sub-category",
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: note,
          columns: [
            { key: "category", header: "Category", width: 1.2 },
            { key: "subcategory", header: "Sub-category", width: 1.2 },
            { key: "lines", header: "Lines", width: 0.7, align: "right" },
            { key: "total", header: "Total", width: 1 },
          ],
          rows,
          fileBaseName: "accounts_expenses_by_subcategory",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Sub-categories: ${rows.length} row(s)` }
        : r;
    }
    case "transaction_id_register": {
      const rows: Record<string, string>[] = [];
      for (const e of accounts.cashLedger) {
        if (e.voidedAt) continue;
        if (!inRange(e.date, from, to)) continue;
        const pool = accounts.cashPools.find((p) => p.id === e.poolId);
        rows.push({
          date: e.date,
          book: "Cash",
          account: pool?.name || e.poolId,
          direction: e.direction === "in" ? "Receipt" : "Payment",
          amount: formatInr(e.amountPaise),
          transactionId: e.transactionRef || "—",
          source: e.sourceType,
          ref: e.sourceId,
          narration: e.narration,
        });
      }
      for (const e of accounts.bankLedger) {
        if (e.voidedAt) continue;
        if (!inRange(e.date, from, to)) continue;
        const bank = getBank(e.bankId, accounts);
        rows.push({
          date: e.date,
          book: "Bank",
          account: bank?.name || e.bankId,
          direction: e.direction === "dr" ? "Receipt" : "Payment",
          amount: formatInr(e.amountPaise),
          transactionId: e.transactionRef || "—",
          source: e.sourceType,
          ref: e.sourceId,
          narration: e.narration,
        });
      }
      try {
        const fees = loadFees();
        for (const v of fees.vouchers) {
          if (v.voidedAt) continue;
          if (!inRange(v.collectionDate, from, to)) continue;
          for (const t of v.tenders) {
            if (t.amountPaise <= 0) continue;
            rows.push({
              date: v.collectionDate,
              book: "Fees",
              account: tenderModeLabel(t.mode),
              direction: "Receipt",
              amount: formatInr(t.amountPaise),
              transactionId: t.ref.trim() || v.transactionId || "—",
              source: "fee_collection",
              ref: v.receiptNo,
              narration: v.note || v.receiptNo,
            });
          }
        }
      } catch {
        /* fees unavailable */
      }
      rows.sort(
        (a, b) =>
          a.date.localeCompare(b.date) ||
          a.transactionId.localeCompare(b.transactionId),
      );
      const r = exportFilterReport(
        {
          title: "Transaction ID register",
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: note,
          columns: [
            { key: "date", header: "Date", width: 0.9 },
            { key: "book", header: "Book", width: 0.7 },
            { key: "account", header: "Account / mode", width: 1 },
            { key: "direction", header: "Type", width: 0.75 },
            { key: "amount", header: "Amount", width: 0.9 },
            { key: "transactionId", header: "Transaction ID", width: 1.1 },
            { key: "source", header: "Source", width: 0.85 },
            { key: "ref", header: "Voucher ref", width: 0.9 },
            { key: "narration", header: "Narration", width: 1.2 },
          ],
          rows,
          fileBaseName: "accounts_transaction_id_register",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Transaction IDs: ${rows.length} row(s)` }
        : r;
    }
    case "ap_ageing": {
      const today = todayYmd();
      const rows = listUnifiedPayables(accounts).map((p) => {
        const vendor = accounts.vendors.find((v) => v.id === p.vendorId);
        const due = Math.max(0, p.amountPaise - p.paidPaise);
        const days = Math.max(
          0,
          Math.floor(
            (Date.parse(today) - Date.parse(p.dueOn)) / (86400 * 1000),
          ),
        );
        let bucket = "Current";
        if (days > 90) bucket = "90+ days";
        else if (days > 60) bucket = "61–90 days";
        else if (days > 30) bucket = "31–60 days";
        else if (days > 0) bucket = "1–30 days";
        return {
          vendor: vendor?.name || p.vendorId || p.sourceType,
          source: p.sourceType,
          dueOn: p.dueOn,
          days: String(days),
          bucket,
          due: formatInr(due),
          note: p.note,
        };
      });
      const r = exportFilterReport(
        {
          title: "Accounts payable ageing",
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: note,
          columns: [
            { key: "vendor", header: "Vendor / source", width: 1.2 },
            { key: "source", header: "Type", width: 0.9 },
            { key: "dueOn", header: "Due", width: 0.8 },
            { key: "days", header: "Days", width: 0.6, align: "right" },
            { key: "bucket", header: "Bucket", width: 0.9 },
            { key: "due", header: "Balance", width: 0.9 },
            { key: "note", header: "Note", width: 1.2 },
          ],
          rows,
          fileBaseName: "accounts_ap_ageing",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `AP ageing: ${rows.length} open payable(s)` }
        : r;
    }
    case "owner_loan_register": {
      const rows: Record<string, string>[] = [];
      for (const loan of accounts.ownerLoans) {
        const trustee = accounts.trustees.find((t) => t.id === loan.trusteeId);
        const schedule = accounts.ownerLoanSchedule.filter(
          (r) => r.loanId === loan.id,
        );
        const paid = schedule.filter((r) => r.status === "paid").length;
        rows.push({
          loan: loan.id.slice(-8),
          trustee: trustee?.name || loan.trusteeId,
          type: loan.type,
          principal: formatInr(loan.principalPaise),
          rate: `${loan.ratePct}%`,
          tenure: `${loan.tenureMonths} mo`,
          status: loan.status,
          emis: `${paid}/${schedule.length}`,
          start: loan.startDate,
        });
      }
      for (const row of listOwnerLoanDue(asOf, accounts)) {
        rows.push({
          loan: row.loanId.slice(-8),
          trustee: "—",
          type: "EMI due",
          principal: formatInr(row.amountPaise),
          rate: `#${row.installmentNo}`,
          tenure: row.dueOn,
          status: row.status,
          emis: formatInr(row.paidAmountPaise),
          start: "",
        });
      }
      const r = exportFilterReport(
        {
          title: "Owner / trustee loan register",
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: note,
          columns: [
            { key: "loan", header: "Loan", width: 0.8 },
            { key: "trustee", header: "Trustee", width: 1.1 },
            { key: "type", header: "Type", width: 1 },
            { key: "principal", header: "Principal / EMI", width: 1 },
            { key: "rate", header: "Rate / #", width: 0.7 },
            { key: "tenure", header: "Tenure / due", width: 0.9 },
            { key: "status", header: "Status", width: 0.8 },
            { key: "emis", header: "Paid / EMI", width: 0.9 },
            { key: "start", header: "Start", width: 0.8 },
          ],
          rows,
          fileBaseName: "accounts_owner_loans",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Owner loans: ${rows.length} row(s)` }
        : r;
    }
    case "trial_balance": {
      const rows = trialBalance(asOf, accounts)
        .filter((r) => r.debitPaise > 0 || r.creditPaise > 0 || r.balancePaise !== 0)
        .map((r) => ({
          code: r.code,
          name: r.name,
          group: r.group,
          debit: formatInr(r.debitPaise),
          credit: formatInr(r.creditPaise),
          balance: formatInr(Math.abs(r.balancePaise)),
        }));
      const r = exportFilterReport(
        {
          title: `Trial balance · as of ${asOf}`,
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: note,
          columns: [
            { key: "code", header: "Code", width: 0.7 },
            { key: "name", header: "Account", width: 1.4 },
            { key: "group", header: "Group", width: 0.8 },
            { key: "debit", header: "Debit", width: 0.9 },
            { key: "credit", header: "Credit", width: 0.9 },
            { key: "balance", header: "Balance", width: 0.9 },
          ],
          rows,
          fileBaseName: "accounts_trial_balance",
        },
        filters.format,
      );
      return r.ok
        ? { ok: true, message: `Trial balance: ${rows.length} account(s)` }
        : r;
    }
    case "profit_loss": {
      const pl = profitAndLoss(from, to, accounts);
      const rows = [
        ...pl.incomeLines.map((l) => ({
          group: "Income",
          code: l.code,
          name: l.name,
          amount: formatInr(l.amountPaise),
        })),
        ...pl.expenseLines.map((l) => ({
          group: "Expense",
          code: l.code,
          name: l.name,
          amount: formatInr(l.amountPaise),
        })),
        {
          group: "Net",
          code: "",
          name: "Net profit / (loss)",
          amount: formatInr(pl.netProfitPaise),
        },
      ];
      const r = exportFilterReport(
        {
          title: `Profit & loss · ${from} → ${to}`,
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: `${note} · Income ${formatInr(pl.totalIncomePaise)} · Expense ${formatInr(pl.totalExpensePaise)}`,
          columns: [
            { key: "group", header: "Group", width: 0.8 },
            { key: "code", header: "Code", width: 0.7 },
            { key: "name", header: "Account", width: 1.4 },
            { key: "amount", header: "Amount", width: 1 },
          ],
          rows,
          fileBaseName: "accounts_profit_loss",
        },
        filters.format,
      );
      return r.ok ? { ok: true, message: `P&L ${from} → ${to}` } : r;
    }
    case "balance_sheet": {
      const bs = balanceSheet(asOf, accounts);
      const rows = [
        { section: "Assets", item: "Cash in hand", amount: formatInr(bs.assets.cashPaise) },
        { section: "Assets", item: "Bank balances", amount: formatInr(bs.assets.bankPaise) },
        {
          section: "Assets",
          item: "Other assets",
          amount: formatInr(bs.assets.otherAssetsPaise),
        },
        { section: "Assets", item: "Total assets", amount: formatInr(bs.assets.totalPaise) },
        {
          section: "Liabilities",
          item: "Total liabilities",
          amount: formatInr(bs.liabilities.totalPaise),
        },
        {
          section: "Equity",
          item: "Capital",
          amount: formatInr(bs.equity.capitalPaise),
        },
        {
          section: "Equity",
          item: "Retained earnings",
          amount: formatInr(bs.equity.retainedEarningsPaise),
        },
        {
          section: "Equity",
          item: "Total L + E",
          amount: formatInr(bs.totalLiabilitiesAndEquityPaise),
        },
      ];
      const r = exportFilterReport(
        {
          title: `Balance sheet · as of ${asOf}`,
          subtitle: `${TENANT.shortName} · Accounts`,
          filterNote: `${note} · Cash ${formatInr(cashInHandPaise(accounts))} · Bank ${formatInr(totalBankBalancePaise(accounts))} · ${bs.balanced ? "Balanced" : "Out of balance"}`,
          columns: [
            { key: "section", header: "Section", width: 1 },
            { key: "item", header: "Line item", width: 1.4 },
            { key: "amount", header: "Amount", width: 1 },
          ],
          rows,
          fileBaseName: "accounts_balance_sheet",
        },
        filters.format,
      );
      return r.ok ? { ok: true, message: `Balance sheet as of ${asOf}` } : r;
    }
    default:
      return { ok: false, error: "Unknown report" };
  }
}
