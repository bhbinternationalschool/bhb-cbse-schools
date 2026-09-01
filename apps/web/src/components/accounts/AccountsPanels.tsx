"use client";

import Link from "next/link";
import { Fragment, useEffect, useMemo, useState } from "react";
import { DayClosePanel } from "@/components/fees/DayClosePanel";
import {
  bankBalancePaise,
  bankMovementExists,
  cashInHandPaise,
  deleteBankAccount,
  postBankMovement,
  postCashMovement,
  recordBankDeposit,
  recordOwnerCashHandover,
  totalBankBalancePaise,
  upsertBankAccount,
} from "@/lib/accountsCashBank";
import {
  sessionExpenseCategoryTotals,
  upsertExpenseCategory,
} from "@/lib/accountsExpenseCategories";
import {
  approveExpenseVoucher,
  cancelExpenseVoucher,
  createExpenseVoucher,
  payExpenseVoucher,
} from "@/lib/accountsExpenseVouchers";
import {
  listJournals,
  postJournal,
  setFiscalYearStatus,
} from "@/lib/accountsJournal";
import {
  createOwnerLoan,
  listOwnerLoanDue,
  postInterTrusteeTransfer,
  recordOwnerLoanPayment,
  upsertTrustee,
} from "@/lib/accountsLoans";
import {
  getExpenseCategory,
  listExpenseSubcategories,
  listLinkedVendorsForExpense,
  listRootExpenseCategories,
  nextExpenseVoucherNo,
  resolveBankForPaymentMode,
} from "@/lib/accountsLookups";
import {
  isExpenseVoucherCancelled,
  vendorBillLineTotalPaise,
} from "@/lib/accountsNormalize";
import {
  listUnifiedPayables,
  payUnifiedPayable,
  syncTransportPayables,
} from "@/lib/accountsPayables";
import { applyDayCloseHandover } from "@/lib/accountsPostings";
import {
  runRecurringExpensesForMonth,
  upsertRecurringRule,
} from "@/lib/accountsRecurring";
import {
  balanceSheet,
  dashboardSnapshot,
  profitAndLoss,
  trialBalance,
} from "@/lib/accountsReports";
import { saveAccounts } from "@/lib/accountsStore";
import {
  BANK_PAYMENT_MODES,
  BANK_PAYMENT_MODE_LABELS,
  VENDOR_BILL_UNITS,
  type AccountsState,
  type ExpensePaymentSplit,
  type ExpenseVoucher,
  type FiscalYearStatus,
  type JournalLine,
  type OwnerLoanType,
  type PaymentMode,
} from "@/lib/accountsTypes";
import {
  createVendorBill,
  markBillPaid,
  vendorOutstandingBalancePaise,
} from "@/lib/accountsVendors";
import { PaymentChannelSelect } from "@/components/accounts/PaymentChannelSelect";
import {
  decodePaymentChannel,
  defaultPaymentChannel,
} from "@/lib/paymentChannels";
import {
  buildDayBook,
  dayCloseNeedsAttention,
  formatInr,
  listDayCloses,
  tenderModeLabel,
} from "@/lib/fees";
import {
  ACCOUNTS_REPORT_CATEGORIES,
  ACCOUNTS_REPORTS,
  runAccountsReport,
  type AccountsReportFormat,
  type AccountsReportId,
} from "@/lib/accountsReportCatalog";
import {
  exportAccountsTallyCsv,
  exportAccountsTallyXml,
} from "@/lib/accountsTallyExport";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";

export type AccountsPanelProps = {
  state: AccountsState;
  onRefresh: () => void;
  onFlash: (message: string) => void;
  onError: (message: string) => void;
  actorName: string;
  tick?: number;
};

function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

function paiseFromInr(v: string) {
  return Math.round((Number(v) || 0) * 100);
}

function paymentChannelAvailablePaise(
  channel: string,
  poolId: string,
  state: AccountsState,
): number {
  const { mode, bankId } = decodePaymentChannel(channel);
  if (mode === "cash") {
    const pool = state.cashPools.find((p) => p.id === poolId);
    return pool?.balancePaise ?? 0;
  }
  if (bankId) return bankBalancePaise(bankId, state);
  return 0;
}

function formatExpensePaymentSplit(
  split: ExpensePaymentSplit,
  state: AccountsState,
): string {
  const modeLabel = BANK_PAYMENT_MODE_LABELS[split.mode] ?? split.mode;
  if (split.mode === "cash") {
    const pool = state.cashPools.find((p) => p.id === split.poolId);
    return `${modeLabel}${pool ? ` · ${pool.name}` : ""} · ${formatInr(split.amountPaise)}${split.transactionRef ? ` · ${split.transactionRef}` : ""}`;
  }
  const bank = state.bankAccounts.find((b) => b.id === split.bankId);
  return `${modeLabel}${bank ? ` · ${bank.name}` : ""} · ${formatInr(split.amountPaise)}${split.transactionRef ? ` · ${split.transactionRef}` : ""}`;
}

function expenseVoucherPayDate(v: ExpenseVoucher): string {
  return v.paidOn || v.date;
}

function printExpenseVoucher(v: ExpenseVoucher, state: AccountsState) {
  const lines =
    v.lines.length > 0
      ? v.lines
      : [
          {
            categoryId: v.categoryId,
            subcategoryId: "",
            description: v.narration,
            totalPaise: v.grandTotalPaise || v.amountPaise,
          },
        ];
  const lineRows = lines
    .map((line) => {
      const cat = getExpenseCategory(line.categoryId, state);
      const sub = line.subcategoryId
        ? getExpenseCategory(line.subcategoryId, state)
        : undefined;
      return `<tr>
        <td>${cat?.name || "—"}</td>
        <td>${sub?.name || "—"}</td>
        <td>${line.description || ""}</td>
        <td style="text-align:right">${formatInr(line.totalPaise)}</td>
      </tr>`;
    })
    .join("");
  const splitRows =
    v.paymentSplits.length > 0
      ? v.paymentSplits
          .map(
            (s) =>
              `<tr><td colspan="3">${formatExpensePaymentSplit(s, state)}</td><td style="text-align:right">${formatInr(s.amountPaise)}</td></tr>`,
          )
          .join("")
      : `<tr><td colspan="4">No payment splits recorded</td></tr>`;
  const html = `<!DOCTYPE html><html><head><title>${v.voucherNo}</title>
    <style>
      body { font-family: system-ui, sans-serif; padding: 24px; color: #0f2744; }
      h1 { font-size: 18px; margin: 0 0 4px; }
      .meta { font-size: 12px; color: #555; margin-bottom: 16px; }
      table { width: 100%; border-collapse: collapse; font-size: 12px; margin-top: 8px; }
      th, td { border: 1px solid #ccc; padding: 6px 8px; text-align: left; }
      th { background: #f4f6f9; }
      h2 { font-size: 14px; margin: 20px 0 6px; }
    </style></head><body>
    <h1>Expense voucher ${v.voucherNo || v.id.slice(-8)}</h1>
    <div class="meta">Date: ${v.date} · Paid on: ${v.paidOn || "—"} · Status: ${v.paymentStatus}</div>
    <div class="meta">${v.narration || ""}</div>
    <h2>Expense lines</h2>
    <table>
      <thead><tr><th>Category</th><th>Sub-category</th><th>Description</th><th>Amount</th></tr></thead>
      <tbody>${lineRows}</tbody>
      <tfoot><tr><th colspan="3">Total</th><th style="text-align:right">${formatInr(v.grandTotalPaise || v.amountPaise)}</th></tr></tfoot>
    </table>
    <h2>Payment splits</h2>
    <table>
      <thead><tr><th colspan="3">Mode / account / reference</th><th>Amount</th></tr></thead>
      <tbody>${splitRows}</tbody>
      <tfoot><tr><th colspan="3">Paid</th><th style="text-align:right">${formatInr(v.paidPaise)}</th></tr></tfoot>
    </table>
    </body></html>`;
  const win = window.open("", "_blank", "noopener,noreferrer");
  if (!win) return;
  win.document.write(html);
  win.document.close();
  win.focus();
  win.print();
}

const CARD =
  "rounded-2xl border border-[var(--border)] bg-[var(--card)] p-4";
const FIELD =
  "w-full rounded-xl border border-[var(--border)] px-3 py-2 text-sm";
const BTN =
  "rounded-xl bg-[var(--primary)] px-4 py-2 text-sm font-medium text-[var(--primary-foreground)] disabled:opacity-50";
const BTN_OUTLINE =
  "rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-bold text-[var(--brand-deep)]";

const PAYMENT_MODES: PaymentMode[] = [
  "cash",
  "upi",
  "rtgs",
  "neft",
  "cheque",
  "card",
];

function StatCard({
  label,
  value,
  hint,
}: {
  label: string;
  value: string;
  hint?: string;
}) {
  return (
    <div className={CARD}>
      <div className="text-[11px] font-bold uppercase tracking-wider text-[var(--muted)]">
        {label}
      </div>
      <div className="mt-1 text-2xl font-bold text-[var(--brand-deep)]">
        {value}
      </div>
      {hint ? (
        <div className="mt-1 text-xs text-[var(--muted)]">{hint}</div>
      ) : null}
    </div>
  );
}

export function DashboardPanel({ state, onRefresh, tick }: AccountsPanelProps) {
  void onRefresh;
  const snap = dashboardSnapshot(state);
  const dayClosePending = dayCloseNeedsAttention();
  const bankTotal = totalBankBalancePaise(state);
  const [backfillBusy, setBackfillBusy] = useState(false);
  const [backfillNote, setBackfillNote] = useState<string | null>(null);

  const doStoreBankBackfill = async () => {
    if (backfillBusy) return;
    setBackfillBusy(true);
    setBackfillNote(null);
    try {
      const { runStoreBankBackfill } = await import(
        "@/lib/accountsStoreBankBackfill"
      );
      const out = await runStoreBankBackfill();
      if (!out.ok) {
        setBackfillNote(out.error);
        return;
      }
      const r = out.result;
      const parts: string[] = [];
      parts.push(
        r.applied === 0
          ? "Nothing new to bring in."
          : `${r.applied} store movement(s) added — ${formatInr(Math.abs(r.appliedPaise))} ${r.appliedPaise < 0 ? "out of" : "into"} the bank book.`,
      );
      if (r.skippedExisting > 0)
        parts.push(`${r.skippedExisting} already there.`);
      if (r.unknownBank > 0)
        parts.push(`${r.unknownBank} name a bank this desk does not have.`);
      if (r.failed.length > 0)
        parts.push(`${r.failed.length} could not be written (${r.failed[0]!.reason}).`);
      setBackfillNote([...parts, ...out.notes].join(" "));
    } catch {
      setBackfillNote("Could not bring in the store's bank history.");
    } finally {
      setBackfillBusy(false);
    }
  };
  // Recompute when the desk changes, not once at mount.
  //
  // The dependency list was empty, so this froze at whatever it read when the
  // panel first rendered. buildDayBook already drops voided receipts — it
  // filters on `!v.voidedAt` — but a receipt voided after the panel mounted
  // kept showing in today's collection until the page was reloaded, which
  // reads as the void not having worked.
  //
  // `tick` is the workspace's refresh counter and `state` changes when the
  // void posts its reversal to accounts; either one is enough on its own, and
  // both together mean no route in leaves it stale.
  const todayBook = useMemo(() => buildDayBook(todayIso()), [tick, state]);
  const openApCount = listUnifiedPayables(state).length;
  const ownerDueCount = listOwnerLoanDue(todayIso(), state).length;

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3 xl:grid-cols-5">
        <StatCard
          label="Today's collection"
          value={formatInr(todayBook.totalPaise)}
          hint={`${todayBook.receiptCount} receipt(s) · cash ${formatInr(todayBook.cashPaise)}`}
        />
        <StatCard label="Cash in hand" value={formatInr(snap.cashInHandPaise)} />
        <StatCard
          label="Open payables"
          value={formatInr(snap.openApPaise)}
          hint={`${openApCount} open bill(s)`}
        />
        <StatCard
          label="Owner EMI due"
          value={formatInr(snap.ownerDuePaise)}
          hint={`${ownerDueCount} installment(s)`}
        />
        <StatCard
          label="Today's expenses"
          value={formatInr(snap.todayExpensePaise)}
          hint="Paid vouchers today"
        />
      </div>

      <div className={`${CARD} flex flex-wrap items-center justify-between gap-3`}>
        <div>
          <div className="text-sm font-semibold text-[var(--brand-deep)]">
            Bank balances
          </div>
          <div className="text-lg font-bold">{formatInr(bankTotal)}</div>
          <div className="text-xs text-[var(--muted)]">
            {state.bankAccounts.filter((b) => b.isActive).length} active account(s)
          </div>
          {/* Store banked and paid through the server module, which never
              wrote the desk bank book, so this tile counted fee receipts
              coming in and nothing going out. New payments mirror themselves;
              this brings over the history. Safe to press twice — every
              movement is keyed by its store payment row and one already here
              is skipped. */}
          <button
            type="button"
            className="mt-2 text-[11px] font-semibold text-[var(--brand-mid)] underline decoration-dotted underline-offset-2 disabled:opacity-60"
            disabled={backfillBusy}
            onClick={() => void doStoreBankBackfill()}
          >
            {backfillBusy
              ? "Bringing store payments in…"
              : "Bring in store bank payments"}
          </button>
          {backfillNote ? (
            <p className="mt-1 max-w-md text-[11px] text-[var(--muted)]">
              {backfillNote}
            </p>
          ) : null}
        </div>
        {dayClosePending ? (
          <span className="rounded-lg bg-[rgba(197,160,40,0.2)] px-3 py-1.5 text-xs font-bold text-[#8a6d12]">
            Day close pending approval
          </span>
        ) : (
          <span className="rounded-lg bg-[var(--success-soft)] px-3 py-1.5 text-xs font-bold text-[var(--success)]">
            Day close up to date
          </span>
        )}
      </div>

      <div className={`${CARD} space-y-2`}>
        <div className="text-sm font-semibold text-[var(--brand-deep)]">
          Quick links
        </div>
        <div className="flex flex-wrap gap-2">
          <Link href="/fees" className={BTN_OUTLINE}>
            Fee Take
          </Link>
          <Link href="/fees?tab=cheques" className={BTN_OUTLINE}>
            Cheques
          </Link>
          <Link href="/fees?tab=dayclose" className={BTN_OUTLINE}>
            Fee day close
          </Link>
          <Link href="/fees/defaulters" className={BTN_OUTLINE}>
            Defaulters
          </Link>
          <Link href="/transport?tab=finance" className={BTN_OUTLINE}>
            Transport AP
          </Link>
        </div>
      </div>
    </div>
  );
}

export function DayBookPanel({ state }: AccountsPanelProps) {
  const [date, setDate] = useState(todayIso());
  const book = useMemo(() => buildDayBook(date), [date]);

  const unpaidExpenses = state.expenseVouchers.filter(
    (v) =>
      v.date === date &&
      !isExpenseVoucherCancelled(v) &&
      (v.paymentStatus === "draft" || v.paymentStatus === "pending_approval"),
  );
  const paidExpenses = state.expenseVouchers.filter(
    (v) =>
      !isExpenseVoucherCancelled(v) &&
      v.paidPaise > 0 &&
      expenseVoucherPayDate(v) === date,
  );
  const cashMoves = state.cashLedger.filter((e) => e.date === date && !e.voidedAt);
  const bankMoves = state.bankLedger.filter((e) => e.date === date && !e.voidedAt);
  const storeJournals = state.journalEntries.filter(
    (j) =>
      !j.voidedAt &&
      j.date === date &&
      [
        "store_sale",
        "store_sell_return",
        "vendor_bill",
        "purchase_return",
        "accounts_payable",
        "expense_voucher",
      ].includes(j.sourceType),
  );

  const feeIn = book.totalPaise;
  const cashIn = cashMoves
    .filter((e) => e.direction === "in")
    .reduce((n, e) => n + e.amountPaise, 0);
  const cashOut = cashMoves
    .filter((e) => e.direction === "out")
    .reduce((n, e) => n + e.amountPaise, 0);
  const bankIn = bankMoves
    .filter((e) => e.direction === "dr")
    .reduce((n, e) => n + e.amountPaise, 0);
  const bankOut = bankMoves
    .filter((e) => e.direction === "cr")
    .reduce((n, e) => n + e.amountPaise, 0);
  const expenseOut = cashOut + bankOut;

  return (
    <div className="mt-4 space-y-4">
      <div className={`${CARD} flex flex-wrap items-end gap-3`}>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Date</span>
          <input
            type="date"
            className={FIELD}
            value={date}
            onChange={(e) => setDate(e.target.value)}
          />
        </label>
        <div className="text-sm text-[var(--muted)]">
          {book.receiptCount} fee receipt(s) · {formatInr(book.totalPaise)}
        </div>
      </div>

      <div className="grid gap-3 sm:grid-cols-3">
        <StatCard
          label="Total in"
          value={formatInr(feeIn + cashIn + bankIn)}
          hint="Fees + cash/bank receipts"
        />
        <StatCard
          label="Total out"
          value={formatInr(expenseOut)}
          hint="Cash/bank payments (incl. expenses)"
        />
        <StatCard
          label="Net movement"
          value={formatInr(feeIn + cashIn + bankIn - expenseOut)}
        />
      </div>

      <section className={CARD}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Fee collections by mode
        </h3>
        <ErpTable minWidth="min-w-full" className="mt-3">
          <ErpTableHead>
            <tr>
              <th className="pb-2">Mode</th>
              <th className="pb-2">Tenders</th>
              <th className="pb-2 text-right">Amount</th>
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {book.modeTotals.map((m) => (
              <tr key={m.mode}>
                <td className="py-2">{tenderModeLabel(m.mode)}</td>
                <td className="py-2">{m.tenderCount}</td>
                <td className="py-2 text-right font-medium">{formatInr(m.paise)}</td>
              </tr>
            ))}
            {book.modeTotals.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-4 text-[var(--muted)]">
                  No fee collections on this date
                </td>
              </tr>
            ) : null}
          </ErpTableBody>
        </ErpTable>
      </section>

      <section className={CARD}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Expense payments (with splits)
        </h3>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Paid vouchers on this date — cash / UPI / bank breakdown.
        </p>
        <ErpTable minWidth="min-w-full" className="mt-3">
          <ErpTableHead>
            <tr>
              <th className="pb-2">Voucher</th>
              <th className="pb-2">Category lines</th>
              <th className="pb-2">Payment splits</th>
              <th className="pb-2 text-right">Paid</th>
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {paidExpenses.map((v) => (
              <tr key={v.id}>
                <td className="py-2 align-top font-mono text-xs">
                  {v.voucherNo || v.id.slice(-8)}
                  <div className="mt-0.5 font-sans text-[10px] text-[var(--muted)]">
                    {v.narration || "—"}
                  </div>
                </td>
                <td className="py-2 align-top text-xs text-[var(--muted)]">
                  {(v.lines.length ? v.lines : [{ categoryId: v.categoryId, subcategoryId: "", description: v.narration, totalPaise: v.grandTotalPaise || v.amountPaise }]).map((line, i) => {
                    const cat = getExpenseCategory(line.categoryId, state);
                    const sub = line.subcategoryId
                      ? getExpenseCategory(line.subcategoryId, state)
                      : undefined;
                    return (
                      <div key={i}>
                        {cat?.name || "—"}
                        {sub ? ` / ${sub.name}` : ""}
                        {" · "}
                        {formatInr(line.totalPaise)}
                      </div>
                    );
                  })}
                </td>
                <td className="py-2 align-top text-xs">
                  {v.paymentSplits.length > 0 ? (
                    v.paymentSplits.map((s) => (
                      <div key={s.id}>{formatExpensePaymentSplit(s, state)}</div>
                    ))
                  ) : (
                    <span className="text-[var(--muted)]">—</span>
                  )}
                </td>
                <td className="py-2 text-right align-top font-medium">
                  {formatInr(v.paidPaise)}
                </td>
              </tr>
            ))}
            {paidExpenses.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-4 text-[var(--muted)]">
                  No paid expense vouchers on this date
                </td>
              </tr>
            ) : null}
          </ErpTableBody>
        </ErpTable>
      </section>

      <section className={CARD}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Expenses · cash/bank ledger
        </h3>
        <ErpTable minWidth="min-w-full" className="mt-3">
          <ErpTableHead>
            <tr>
              <th className="pb-2">Type</th>
              <th className="pb-2">Detail</th>
              <th className="pb-2 text-right">Amount</th>
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {unpaidExpenses.map((v) => (
              <tr key={v.id}>
                <td className="py-2">Expense (unpaid)</td>
                <td className="py-2">
                  {v.voucherNo} ·{" "}
                  {getExpenseCategory(v.categoryId, state)?.name || v.narration}
                </td>
                <td className="py-2 text-right">
                  {formatInr(v.grandTotalPaise || v.amountPaise)}
                </td>
              </tr>
            ))}
            {cashMoves.map((e) => (
              <tr key={e.id}>
                <td className="py-2">
                  Cash {e.direction}
                  {e.sourceType === "expense_voucher" ? " · expense" : ""}
                </td>
                <td className="py-2">{e.narration || e.sourceType}</td>
                <td className="py-2 text-right">{formatInr(e.amountPaise)}</td>
              </tr>
            ))}
            {bankMoves.map((e) => (
              <tr key={e.id}>
                <td className="py-2">
                  Bank {e.direction === "dr" ? "Dr" : "Cr"}
                  {e.sourceType === "expense_voucher" ? " · expense" : ""}
                </td>
                <td className="py-2">{e.narration || e.sourceType}</td>
                <td className="py-2 text-right">{formatInr(e.amountPaise)}</td>
              </tr>
            ))}
            {unpaidExpenses.length + cashMoves.length + bankMoves.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-4 text-[var(--muted)]">
                  No expense or ledger entries on this date
                </td>
              </tr>
            ) : null}
          </ErpTableBody>
        </ErpTable>
      </section>

      <section className={CARD}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Store / purchase journals
        </h3>
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">
          Sales, returns, vendor bills &amp; AP — feeds trial balance, P&amp;L
          and balance sheet.
        </p>
        <ErpTable minWidth="min-w-full" className="mt-3">
          <ErpTableHead>
            <tr>
              <th className="pb-2">Source</th>
              <th className="pb-2">Narration</th>
              <th className="pb-2 text-right">Amount</th>
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {storeJournals.map((j) => {
              const amt = j.lines.reduce((n, l) => n + l.debitPaise, 0);
              return (
                <tr key={j.id}>
                  <td className="py-2">{j.sourceType.replace(/_/g, " ")}</td>
                  <td className="py-2">{j.narration || j.voucherNo}</td>
                  <td className="py-2 text-right">{formatInr(amt)}</td>
                </tr>
              );
            })}
            {storeJournals.length === 0 ? (
              <tr>
                <td colSpan={3} className="py-4 text-[var(--muted)]">
                  No store / purchase journals on this date
                </td>
              </tr>
            ) : null}
          </ErpTableBody>
        </ErpTable>
      </section>
    </div>
  );
}

export function CashBookPanel({
  state,
  onRefresh,
  onFlash,
  onError,
  actorName,
}: AccountsPanelProps) {
  const [poolId, setPoolId] = useState(state.cashPools[0]?.id ?? "");
  const [moveDir, setMoveDir] = useState<"in" | "out">("in");
  const [moveAmt, setMoveAmt] = useState("");
  const [moveNote, setMoveNote] = useState("");
  const [depPool, setDepPool] = useState(state.cashPools[0]?.id ?? "");
  const [depBank, setDepBank] = useState(state.bankAccounts[0]?.id ?? "");
  const [depAmt, setDepAmt] = useState("");
  const [handAmt, setHandAmt] = useState("");
  const [handPurpose, setHandPurpose] = useState("");
  const [handReceived, setHandReceived] = useState("");

  const ledger = state.cashLedger
    .filter((e) => !poolId || e.poolId === poolId)
    .slice(0, 40);

  function postMove() {
    const amountPaise = paiseFromInr(moveAmt);
    const res = postCashMovement({
      poolId,
      direction: moveDir,
      amountPaise,
      sourceType: "manual",
      narration: moveNote,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash(`Cash ${moveDir} recorded`);
    setMoveAmt("");
    setMoveNote("");
    onRefresh();
  }

  function deposit() {
    const res = recordBankDeposit(depPool, depBank, paiseFromInr(depAmt));
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Bank deposit recorded");
    setDepAmt("");
    onRefresh();
  }

  function handover() {
    const res = recordOwnerCashHandover({
      fromPoolId: poolId,
      amountPaise: paiseFromInr(handAmt),
      handedBy: actorName,
      receivedBy: handReceived.trim(),
      purpose: handPurpose,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Owner cash handover recorded");
    setHandAmt("");
    setHandPurpose("");
    onRefresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-3 sm:grid-cols-3">
        {state.cashPools.map((p) => (
          <StatCard
            key={p.id}
            label={p.name}
            value={formatInr(p.balancePaise)}
            hint={p.code}
          />
        ))}
        <StatCard label="Total cash" value={formatInr(cashInHandPaise(state))} />
      </div>

      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${CARD} space-y-3`}>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">Cash in / out</h3>
          <select className={FIELD} value={poolId} onChange={(e) => setPoolId(e.target.value)}>
            {state.cashPools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
          <div className="flex gap-2">
            <button
              type="button"
              className={`${BTN_OUTLINE} ${moveDir === "in" ? "ring-2 ring-[var(--brand-gold)]" : ""}`}
              onClick={() => setMoveDir("in")}
            >
              Cash in
            </button>
            <button
              type="button"
              className={`${BTN_OUTLINE} ${moveDir === "out" ? "ring-2 ring-[var(--brand-gold)]" : ""}`}
              onClick={() => setMoveDir("out")}
            >
              Cash out
            </button>
          </div>
          <input
            className={FIELD}
            placeholder="Amount ₹"
            value={moveAmt}
            onChange={(e) => setMoveAmt(e.target.value)}
          />
          <input
            className={FIELD}
            placeholder="Narration"
            value={moveNote}
            onChange={(e) => setMoveNote(e.target.value)}
          />
          <button type="button" className={BTN} onClick={postMove}>
            Post movement
          </button>
        </section>

        <section className={`${CARD} space-y-3`}>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Bank deposit · owner handover
          </h3>
          <div className="grid gap-2 sm:grid-cols-2">
            <select className={FIELD} value={depPool} onChange={(e) => setDepPool(e.target.value)}>
              {state.cashPools.map((p) => (
                <option key={p.id} value={p.id}>
                  From {p.name}
                </option>
              ))}
            </select>
            <select className={FIELD} value={depBank} onChange={(e) => setDepBank(e.target.value)}>
              {state.bankAccounts.map((b) => (
                <option key={b.id} value={b.id}>
                  To {b.name}
                </option>
              ))}
            </select>
          </div>
          <input
            className={FIELD}
            placeholder="Deposit amount ₹"
            value={depAmt}
            onChange={(e) => setDepAmt(e.target.value)}
          />
          <button type="button" className={BTN} onClick={deposit}>
            Record deposit
          </button>
          <hr className="border-[var(--border)]" />
          <input
            className={FIELD}
            placeholder="Handover amount ₹"
            value={handAmt}
            onChange={(e) => setHandAmt(e.target.value)}
          />
          <input
            className={FIELD}
            placeholder="Received by (trustee)"
            value={handReceived}
            onChange={(e) => setHandReceived(e.target.value)}
          />
          <input
            className={FIELD}
            placeholder="Purpose"
            value={handPurpose}
            onChange={(e) => setHandPurpose(e.target.value)}
          />
          <button type="button" className={BTN} onClick={handover}>
            Record handover
          </button>
        </section>
      </div>

      <section className={CARD}>
        <div className="mb-3 flex items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">Cash ledger</h3>
          <select className={`${FIELD} !w-auto`} value={poolId} onChange={(e) => setPoolId(e.target.value)}>
            <option value="">All pools</option>
            {state.cashPools.map((p) => (
              <option key={p.id} value={p.id}>
                {p.name}
              </option>
            ))}
          </select>
        </div>
        <ErpTableShell>
          <div className="overflow-x-auto">
            <ErpTable>
              <ErpTableHead>
                <tr>
                  <th className="px-4 py-2.5 font-bold">Date</th>
                  <th className="px-4 py-2.5 font-bold">Pool</th>
                  <th className="px-4 py-2.5 font-bold">Dir</th>
                  <th className="px-4 py-2.5 font-bold text-right">Amount</th>
                  <th className="px-4 py-2.5 font-bold text-right">Balance</th>
                  <th className="px-4 py-2.5 font-bold">Narration</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {ledger.map((e) => (
                  <tr key={e.id} className="hover:bg-[var(--surface-sunken)]">
                    <td className="px-4 py-2">{e.date}</td>
                    <td className="px-4 py-2">
                      {state.cashPools.find((p) => p.id === e.poolId)?.name}
                    </td>
                    <td className="px-4 py-2">{e.direction}</td>
                    <td className="px-4 py-2 text-right">{formatInr(e.amountPaise)}</td>
                    <td className="px-4 py-2 text-right">{formatInr(e.runningBalancePaise)}</td>
                    <td className="px-4 py-2 text-[var(--muted)]">{e.narration}</td>
                  </tr>
                ))}
              </ErpTableBody>
            </ErpTable>
          </div>
        </ErpTableShell>
      </section>
    </div>
  );
}

export function BanksPanel({
  state,
  onRefresh,
  onFlash,
  onError,
}: AccountsPanelProps) {
  const [editId, setEditId] = useState("");
  const [name, setName] = useState("");
  const [bankName, setBankName] = useState("");
  const [accountNo, setAccountNo] = useState("");
  const [ifsc, setIfsc] = useState("");
  const [openBal, setOpenBal] = useState("0");
  const [paymentModes, setPaymentModes] = useState<PaymentMode[]>([
    ...BANK_PAYMENT_MODES,
  ]);
  const [isActive, setIsActive] = useState(true);

  function resetForm() {
    setEditId("");
    setName("");
    setBankName("");
    setAccountNo("");
    setIfsc("");
    setOpenBal("0");
    setPaymentModes([...BANK_PAYMENT_MODES]);
    setIsActive(true);
  }

  function loadBank(bankId: string) {
    const bank = state.bankAccounts.find((b) => b.id === bankId);
    if (!bank) return;
    setEditId(bank.id);
    setName(bank.name);
    setBankName(bank.bankName);
    setAccountNo(bank.accountNo);
    setIfsc(bank.ifsc);
    setOpenBal(String((bank.openingBalancePaise / 100).toFixed(2)));
    setPaymentModes([...bank.paymentModes]);
    setIsActive(bank.isActive !== false);
  }

  function toggleMode(mode: PaymentMode) {
    setPaymentModes((prev) =>
      prev.includes(mode) ? prev.filter((m) => m !== mode) : [...prev, mode],
    );
  }

  function saveBank() {
    if (paymentModes.length === 0) {
      onError("Select at least one payment mode for this bank account");
      return;
    }
    const res = upsertBankAccount({
      id: editId || undefined,
      name: name.trim() || "Bank account",
      bankName,
      accountNo,
      ifsc,
      openingBalancePaise: paiseFromInr(openBal),
      paymentModes,
      isActive,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash(editId ? "Bank account updated" : "Bank account created");
    resetForm();
    onRefresh();
  }

  function removeBank() {
    if (!editId) return;
    const bank = state.bankAccounts.find((b) => b.id === editId);
    if (
      !window.confirm(
        `Delete bank account "${bank?.name || "this account"}"? This cannot be undone.`,
      )
    ) {
      return;
    }
    const res = deleteBankAccount(editId);
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Bank account deleted");
    resetForm();
    onRefresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <p className="text-sm text-[var(--muted)]">
        Create multiple bank accounts and choose which payment modes each handles
        for collections and expense payments (UPI, RTGS, NEFT, cheque, card).
        An account with only UPI enabled appears only under UPI when paying or collecting.
      </p>

      <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-3">
        {state.bankAccounts.map((b) => (
          <button
            key={b.id}
            type="button"
            className={`${CARD} text-left ${editId === b.id ? "ring-2 ring-[var(--brand-gold)]" : ""} ${b.isActive === false ? "opacity-60" : ""}`}
            onClick={() => loadBank(b.id)}
          >
            <div className="flex items-start justify-between gap-2">
              <div className="font-semibold text-[var(--brand-deep)]">{b.name}</div>
              {b.isActive === false ? (
                <span className="rounded bg-[var(--surface-sunken)] px-2 py-0.5 text-[10px] font-bold uppercase text-[var(--muted)]">
                  Inactive
                </span>
              ) : null}
            </div>
            <div className="text-xs text-[var(--muted)]">
              {b.bankName || "Bank"} · {b.accountNo || "—"}
              {b.ifsc ? ` · ${b.ifsc}` : ""}
            </div>
            <div className="mt-2 text-lg font-bold">
              {formatInr(bankBalancePaise(b.id, state))}
            </div>
            <div className="mt-2 flex flex-wrap gap-1">
              {b.paymentModes.map((mode) => (
                <span
                  key={mode}
                  className="rounded-full bg-[#1565c0]/10 px-2 py-0.5 text-[10px] font-bold uppercase text-[#1565c0]"
                >
                  {BANK_PAYMENT_MODE_LABELS[mode]}
                </span>
              ))}
            </div>
          </button>
        ))}
        {state.bankAccounts.length === 0 ? (
          <div className={`${CARD} text-sm text-[var(--muted)]`}>
            No bank accounts yet. Add your first account using the form.
          </div>
        ) : null}
      </div>

      <section className={`${CARD} space-y-4`}>
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            {editId ? "Edit bank account" : "New bank account"}
          </h3>
          {editId ? (
            <button type="button" className={BTN_OUTLINE} onClick={resetForm}>
              + New account
            </button>
          ) : null}
        </div>

        <div className="grid gap-3 sm:grid-cols-2">
          <input
            className={FIELD}
            placeholder="Account label e.g. HDFC Main"
            value={name}
            onChange={(e) => setName(e.target.value)}
          />
          <input
            className={FIELD}
            placeholder="Bank name"
            value={bankName}
            onChange={(e) => setBankName(e.target.value)}
          />
          <input
            className={FIELD}
            placeholder="Account number"
            value={accountNo}
            onChange={(e) => setAccountNo(e.target.value)}
          />
          <input
            className={FIELD}
            placeholder="IFSC"
            value={ifsc}
            onChange={(e) => setIfsc(e.target.value)}
          />
          <input
            className={FIELD}
            placeholder="Opening balance ₹"
            value={openBal}
            onChange={(e) => setOpenBal(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm">
            <input
              type="checkbox"
              checked={isActive}
              onChange={(e) => setIsActive(e.target.checked)}
            />
            Active account
          </label>
        </div>

        <div>
          <div className="mb-2 text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
            Payment modes (collections & expenses)
          </div>
          <div className="flex flex-wrap gap-2">
            {BANK_PAYMENT_MODES.map((mode) => {
              const on = paymentModes.includes(mode);
              return (
                <button
                  key={mode}
                  type="button"
                  className={`rounded-xl border px-3 py-2 text-xs font-bold uppercase ${
                    on
                      ? "border-[#1565c0] bg-[#1565c0]/10 text-[#1565c0]"
                      : "border-[var(--border)] bg-[var(--card)] text-[var(--muted)]"
                  }`}
                  onClick={() => toggleMode(mode)}
                >
                  {BANK_PAYMENT_MODE_LABELS[mode]}
                </button>
              );
            })}
          </div>
        </div>

        <div className="flex flex-wrap gap-2">
          <button type="button" className={BTN} onClick={saveBank}>
            {editId ? "Update bank account" : "Save bank account"}
          </button>
          {editId ? (
            <button type="button" className={BTN_OUTLINE} onClick={removeBank}>
              Delete account
            </button>
          ) : null}
        </div>
      </section>
    </div>
  );
}

export function ExpensesPanel({
  state,
  onRefresh,
  onFlash,
  onError,
  actorName,
}: AccountsPanelProps) {
  const rootCategories = useMemo(
    () => listRootExpenseCategories(state),
    [state.expenseCategories],
  );

  const [vDate, setVDate] = useState(todayIso());
  const [voucherNo, setVoucherNo] = useState(() => nextExpenseVoucherNo(state));
  const [payChannel, setPayChannel] = useState(() => defaultPaymentChannel(state));
  const [vNote, setVNote] = useState("");
  const [payPool, setPayPool] = useState(state.cashPools[0]?.id ?? "");

  type PaymentSplitDraft = {
    key: string;
    channel: string;
    amount: string;
    transactionRef: string;
    poolId: string;
  };

  const [paymentSplits, setPaymentSplits] = useState<PaymentSplitDraft[]>([]);

  const sessionTotals = useMemo(
    () => sessionExpenseCategoryTotals(state, vDate),
    [state, vDate],
  );

  function addPaymentSplit() {
    setPaymentSplits((prev) => [
      ...prev,
      {
        key: `ps_${Math.random().toString(36).slice(2, 8)}`,
        channel: defaultPaymentChannel(state),
        amount: "",
        transactionRef: "",
        poolId: state.cashPools[0]?.id ?? "",
      },
    ]);
  }

  const splitSumPaise = useMemo(
    () => paymentSplits.reduce((n, s) => n + paiseFromInr(s.amount), 0),
    [paymentSplits],
  );

  const [recCat, setRecCat] = useState(rootCategories[0]?.id ?? "");
  const [recAmt, setRecAmt] = useState("");
  const [recDay, setRecDay] = useState("5");
  const [genYm, setGenYm] = useState(todayIso().slice(0, 7));

  type DraftLine = {
    id: string;
    categoryId: string;
    subcategoryId: string;
    vendorId: string;
    description: string;
    amount: string;
    tax: string;
    paid: string;
  };

  function emptyLine(): DraftLine {
    return {
      id: `ln_${Math.random().toString(36).slice(2, 8)}`,
      categoryId: rootCategories[0]?.id ?? "",
      subcategoryId: "",
      vendorId: "",
      description: "",
      amount: "",
      tax: "",
      paid: "",
    };
  }

  const [lines, setLines] = useState<DraftLine[]>([emptyLine()]);

  function lineTotal(l: DraftLine) {
    return paiseFromInr(l.amount) + paiseFromInr(l.tax);
  }

  function lineDue(l: DraftLine) {
    return Math.max(0, lineTotal(l) - paiseFromInr(l.paid));
  }

  const totals = useMemo(() => {
    let amount = 0;
    let tax = 0;
    let total = 0;
    let paid = 0;
    let due = 0;
    for (const l of lines) {
      const a = paiseFromInr(l.amount);
      const t = paiseFromInr(l.tax);
      const tot = a + t;
      const p = Math.min(tot, paiseFromInr(l.paid));
      amount += a;
      tax += t;
      total += tot;
      paid += p;
      due += tot - p;
    }
    return { amount, tax, total, paid, due };
  }, [lines]);

  function updateLine(id: string, patch: Partial<DraftLine>) {
    setLines((prev) =>
      prev.map((l) => {
        if (l.id !== id) return l;
        const next = { ...l, ...patch };
        if (patch.categoryId !== undefined && patch.categoryId !== l.categoryId) {
          next.subcategoryId = "";
          next.vendorId = "";
        }
        if (
          patch.subcategoryId !== undefined &&
          patch.subcategoryId !== l.subcategoryId
        ) {
          next.vendorId = "";
        }
        return next;
      }),
    );
  }

  function createVoucher() {
    const vendorTotals = new Map<string, number>();
    for (const l of lines) {
      if (!l.vendorId) continue;
      const paidPaise = paiseFromInr(l.paid);
      if (paidPaise <= 0) continue;
      vendorTotals.set(
        l.vendorId,
        (vendorTotals.get(l.vendorId) ?? 0) + paidPaise,
      );
    }
    for (const [vendorId, amount] of vendorTotals) {
      const balance = vendorOutstandingBalancePaise(vendorId, state);
      if (amount > balance) {
        const vendor = state.vendors.find((v) => v.id === vendorId);
        onError(
          `Payment to ${vendor?.name ?? "vendor"} (${formatInr(amount)}) exceeds outstanding balance (${formatInr(balance)})`,
        );
        return;
      }
    }

    if (totals.paid > 0) {
      if (paymentSplits.length === 0) {
        onError("Add at least one payment mode (cash / UPI / bank)");
        return;
      }
      if (splitSumPaise !== totals.paid) {
        onError(
          `Payment splits (${formatInr(splitSumPaise)}) must equal paid (${formatInr(totals.paid)})`,
        );
        return;
      }
      for (const split of paymentSplits) {
        const { mode, bankId } = decodePaymentChannel(split.channel);
        if (mode !== "cash" && !split.transactionRef.trim()) {
          onError("Transaction ID is required for non-cash payments");
          return;
        }
        if (mode === "cash" && !split.poolId) {
          onError("Select cash pool for cash payment");
          return;
        }
        if (mode !== "cash" && !bankId) {
          onError("Select bank account for non-cash payment");
          return;
        }
      }
    }
    const firstSplit = paymentSplits[0];
    const firstMode = firstSplit
      ? decodePaymentChannel(firstSplit.channel).mode
      : "cash";
    const res = createExpenseVoucher({
      date: vDate,
      voucherNo,
      mode: firstMode,
      narration: vNote,
      paidPaise: totals.paid,
      taxPaise: totals.tax,
      paymentSplits:
        totals.paid > 0
          ? paymentSplits.map((s) => {
              const { mode, bankId } = decodePaymentChannel(s.channel);
              return {
                mode,
                amountPaise: paiseFromInr(s.amount),
                poolId: mode === "cash" ? s.poolId : "",
                bankId: mode !== "cash" ? bankId : "",
                transactionRef: s.transactionRef.trim(),
              };
            })
          : undefined,
      lines: lines.map((l) => ({
        categoryId: l.categoryId,
        subcategoryId: l.subcategoryId,
        vendorId: l.vendorId,
        description: l.description,
        amountPaise: paiseFromInr(l.amount),
        taxPaise: paiseFromInr(l.tax),
        totalPaise: lineTotal(l),
        paidPaise: paiseFromInr(l.paid),
        duePaise: lineDue(l),
      })),
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash(
      res.voucher.paymentStatus === "pending_approval"
        ? `Voucher ${res.voucher.voucherNo} — needs approval`
        : `Voucher ${res.voucher.voucherNo} saved`,
    );
    setVNote("");
    setLines([emptyLine()]);
    setPaymentSplits([]);
    setVoucherNo(nextExpenseVoucherNo());
    onRefresh();
  }

  function payVoucher(id: string, voucherMode: PaymentMode, duePaise: number) {
    const { mode, bankId } = decodePaymentChannel(payChannel);
    let txnId = "";
    if (mode !== "cash") {
      const promptVal = window.prompt("Transaction ID (required):");
      if (!promptVal?.trim()) {
        if (promptVal !== null) {
          onError("Transaction ID is required for non-cash payments");
        }
        return;
      }
      txnId = promptVal.trim();
    }
    if (mode !== voucherMode) {
      onError(
        `Select a ${BANK_PAYMENT_MODE_LABELS[voucherMode]} account to pay this voucher`,
      );
      return;
    }
    const res = payExpenseVoucher(id, {
      poolId: mode === "cash" ? payPool : undefined,
      bankId: mode !== "cash" ? bankId : undefined,
      amountPaise: duePaise,
      transactionRef: txnId.trim(),
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Payment recorded");
    onRefresh();
  }

  function addRecurring() {
    const res = upsertRecurringRule({
      categoryId: recCat,
      amountPaise: paiseFromInr(recAmt),
      mode: "neft",
      dayOfMonth: Number(recDay) || 5,
      narration: "Recurring expense",
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Recurring rule saved");
    onRefresh();
  }

  function generateMonth() {
    const res = runRecurringExpensesForMonth(genYm);
    onFlash(`Generated ${res.generated} voucher(s) for ${genYm}`);
    onRefresh();
  }

  const openVouchers = state.expenseVouchers.filter(
    (v) => !isExpenseVoucherCancelled(v),
  );

  // Sort before the 30-row cut below, not after — sorting a slice would only
  // reorder the first page and hide the rows the clerk is looking for.
  const voucherSort = useTableSort(
    openVouchers,
    {
      date: (v) => v.date,
      voucherNo: (v) => v.voucherNo || null,
      lines: (v) => v.lines.length || 1,
      status: (v) => v.paymentStatus,
      total: (v) => v.grandTotalPaise || v.amountPaise,
      paid: (v) => v.paidPaise,
      due: (v) => v.duePaise,
    },
    "date",
    "desc",
  );

  function cancelVoucher(voucherId: string) {
    const reason = window.prompt("Reason for cancellation (required):");
    if (!reason?.trim()) {
      if (reason !== null) onError("Cancellation reason is required");
      return;
    }
    const r = cancelExpenseVoucher(voucherId, reason, actorName);
    if (!r.ok) {
      onError(r.error);
      return;
    }
    onFlash(`Voucher ${r.voucher.voucherNo} cancelled`);
    onRefresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <section className={`${CARD} space-y-4`}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Expense voucher entry
        </h3>
        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Date
            <input
              type="date"
              className={`${FIELD} mt-1`}
              value={vDate}
              onChange={(e) => setVDate(e.target.value)}
            />
          </label>
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Voucher no.
            <input
              className={`${FIELD} mt-1 font-mono text-[11px]`}
              value={voucherNo}
              onChange={(e) => setVoucherNo(e.target.value)}
            />
          </label>
          <label className="block text-[11px] font-semibold text-[var(--muted)] sm:col-span-2">
            Narration
            <input
              className={`${FIELD} mt-1`}
              value={vNote}
              onChange={(e) => setVNote(e.target.value)}
              placeholder="Optional header note"
            />
          </label>
        </div>

        {totals.paid > 0 ? (
          <div className="space-y-2 rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-3">
            <div className="flex flex-wrap items-center justify-between gap-2">
              <h4 className="text-xs font-bold text-[var(--brand-deep)]">
                Payment modes (split cash + UPI / bank)
              </h4>
              <button type="button" className={BTN_OUTLINE} onClick={addPaymentSplit}>
                + Add payment
              </button>
            </div>
            {paymentSplits.length === 0 ? (
              <p className="text-[11px] text-[var(--muted)]">
                Add payment rows — total must match paid column ({formatInr(totals.paid)}).
              </p>
            ) : (
              <div className="space-y-2">
                {paymentSplits.map((s) => {
                  const { mode } = decodePaymentChannel(s.channel);
                  const available = paymentChannelAvailablePaise(
                    s.channel,
                    s.poolId,
                    state,
                  );
                  return (
                    <div
                      key={s.key}
                      className="space-y-1 rounded-lg border border-[var(--border)] bg-[var(--card)] p-2"
                    >
                      <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-5">
                        <div>
                          <PaymentChannelSelect
                            className={FIELD}
                            value={s.channel}
                            onChange={(ch) =>
                              setPaymentSplits((prev) =>
                                prev.map((x) =>
                                  x.key === s.key ? { ...x, channel: ch } : x,
                                ),
                              )
                            }
                            accounts={state}
                          />
                          <p className="mt-0.5 text-[10px] font-medium text-emerald-800">
                            Available: {formatInr(available)}
                          </p>
                        </div>
                        {mode === "cash" ? (
                          <div>
                            <select
                              className={FIELD}
                              value={s.poolId}
                              onChange={(e) =>
                                setPaymentSplits((prev) =>
                                  prev.map((x) =>
                                    x.key === s.key
                                      ? { ...x, poolId: e.target.value }
                                      : x,
                                  ),
                                )
                              }
                            >
                              {state.cashPools.map((p) => (
                                <option key={p.id} value={p.id}>
                                  {p.name}
                                </option>
                              ))}
                            </select>
                            <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                              Pool balance shown above
                            </p>
                          </div>
                        ) : (
                          <div />
                        )}
                        <input
                          className={`${FIELD} text-right`}
                          placeholder="Amount ₹"
                          value={s.amount}
                          onChange={(e) =>
                            setPaymentSplits((prev) =>
                              prev.map((x) =>
                                x.key === s.key ? { ...x, amount: e.target.value } : x,
                              ),
                            )
                          }
                        />
                        <input
                          className={FIELD}
                          placeholder={
                            mode === "cash"
                              ? "Txn ID (optional)"
                              : "Transaction ID *"
                          }
                          value={s.transactionRef}
                          onChange={(e) =>
                            setPaymentSplits((prev) =>
                              prev.map((x) =>
                                x.key === s.key
                                  ? { ...x, transactionRef: e.target.value }
                                  : x,
                              ),
                            )
                          }
                        />
                        <button
                          type="button"
                          className={BTN_OUTLINE}
                          onClick={() =>
                            setPaymentSplits((prev) =>
                              prev.filter((x) => x.key !== s.key),
                            )
                          }
                        >
                          Remove
                        </button>
                      </div>
                    </div>
                  );
                })}
                <p className="text-[11px] text-[var(--muted)]">
                  Split total: {formatInr(splitSumPaise)} / {formatInr(totals.paid)}
                  {splitSumPaise !== totals.paid ? " — must match" : ""}
                </p>
              </div>
            )}
          </div>
        ) : null}

        <div className="overflow-x-auto">
          <ErpTable minWidth="min-w-[900px]" className="text-xs">
            <ErpTableHead>
              <tr>
                <th className="pb-2 pr-2">Category</th>
                <th className="pb-2 pr-2">Sub-category</th>
                <th className="pb-2 pr-2">Vendor</th>
                <th className="pb-2 pr-2">Description</th>
                <th className="pb-2 pr-2 text-right">Amount ₹</th>
                <th className="pb-2 pr-2 text-right">Tax ₹</th>
                <th className="pb-2 pr-2 text-right">Total ₹</th>
                <th className="pb-2 pr-2 text-right">Paid ₹</th>
                <th className="pb-2 pr-2 text-right">Due ₹</th>
                <th className="pb-2" />
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {lines.map((l) => {
                const subs = l.categoryId
                  ? listExpenseSubcategories(l.categoryId, state)
                  : [];
                const linkedVendors = l.categoryId
                  ? listLinkedVendorsForExpense(
                      l.categoryId,
                      l.subcategoryId,
                      state,
                    )
                  : [];
                return (
                  <tr key={l.id}>
                    <td className="py-1 pr-2">
                      <select
                        className={FIELD}
                        value={l.categoryId}
                        onChange={(e) =>
                          updateLine(l.id, { categoryId: e.target.value })
                        }
                      >
                        <option value="">—</option>
                        {rootCategories.map((c) => (
                          <option key={c.id} value={c.id}>
                            {c.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      <select
                        className={FIELD}
                        value={l.subcategoryId}
                        onChange={(e) =>
                          updateLine(l.id, { subcategoryId: e.target.value })
                        }
                        disabled={!l.categoryId || subs.length === 0}
                      >
                        <option value="">—</option>
                        {subs.map((s) => (
                          <option key={s.id} value={s.id}>
                            {s.name}
                          </option>
                        ))}
                      </select>
                    </td>
                    <td className="py-1 pr-2">
                      {linkedVendors.length > 0 ? (
                        <div>
                          <select
                            className={FIELD}
                            value={l.vendorId}
                            onChange={(e) =>
                              updateLine(l.id, {
                                vendorId: e.target.value,
                                paid: "",
                              })
                            }
                          >
                            <option value="">— Optional —</option>
                            {linkedVendors.map((v) => (
                              <option key={v.id} value={v.id}>
                                {v.name}
                              </option>
                            ))}
                          </select>
                          {l.vendorId ? (
                            <p className="mt-0.5 text-[10px] font-semibold text-amber-800">
                              Outstanding:{" "}
                              {formatInr(
                                vendorOutstandingBalancePaise(l.vendorId, state),
                              )}
                            </p>
                          ) : null}
                        </div>
                      ) : (
                        <span className="text-[10px] text-[var(--muted)]">—</span>
                      )}
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className={FIELD}
                        value={l.description}
                        onChange={(e) =>
                          updateLine(l.id, { description: e.target.value })
                        }
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className={`${FIELD} text-right`}
                        value={l.amount}
                        onChange={(e) =>
                          updateLine(l.id, { amount: e.target.value })
                        }
                      />
                    </td>
                    <td className="py-1 pr-2">
                      <input
                        className={`${FIELD} text-right`}
                        value={l.tax}
                        onChange={(e) =>
                          updateLine(l.id, { tax: e.target.value })
                        }
                      />
                    </td>
                    <td className="py-1 pr-2 text-right font-semibold">
                      {formatInr(lineTotal(l))}
                    </td>
                    <td className="py-1 pr-2">
                      <div className="flex flex-col gap-1">
                        <input
                          className={`${FIELD} text-right`}
                          value={l.paid}
                          onChange={(e) => {
                            let paid = e.target.value;
                            if (l.vendorId) {
                              const bal = vendorOutstandingBalancePaise(
                                l.vendorId,
                                state,
                              );
                              if (paiseFromInr(paid) > bal) {
                                paid = bal > 0 ? (bal / 100).toFixed(2) : "0";
                              }
                            }
                            updateLine(l.id, { paid });
                          }}
                        />
                        {l.vendorId &&
                        vendorOutstandingBalancePaise(l.vendorId, state) > 0 ? (
                          <button
                            type="button"
                            className="text-[10px] font-semibold text-[var(--brand-deep)] underline"
                            onClick={() => {
                              const bal = vendorOutstandingBalancePaise(
                                l.vendorId,
                                state,
                              );
                              updateLine(l.id, {
                                paid: (bal / 100).toFixed(2),
                              });
                            }}
                          >
                            Pay full balance
                          </button>
                        ) : null}
                      </div>
                    </td>
                    <td className="py-1 pr-2 text-right text-amber-800">
                      {formatInr(lineDue(l))}
                    </td>
                    <td className="py-1">
                      <button
                        type="button"
                        className={BTN_OUTLINE}
                        onClick={() =>
                          setLines((prev) =>
                            prev.length > 1
                              ? prev.filter((x) => x.id !== l.id)
                              : prev,
                          )
                        }
                      >
                        ×
                      </button>
                    </td>
                  </tr>
                );
              })}
            </ErpTableBody>
            <tfoot>
              <tr className="border-t-2 border-[var(--border)] font-bold">
                <td colSpan={3} className="py-2 text-right text-[var(--muted)]">
                  Totals
                </td>
                <td className="py-2 text-right">{formatInr(totals.amount)}</td>
                <td className="py-2 text-right">{formatInr(totals.tax)}</td>
                <td className="py-2 text-right">{formatInr(totals.total)}</td>
                <td className="py-2 text-right">{formatInr(totals.paid)}</td>
                <td className="py-2 text-right">{formatInr(totals.due)}</td>
                <td />
              </tr>
            </tfoot>
          </ErpTable>
        </div>

        <div className="flex flex-wrap gap-2">
          <button
            type="button"
            className={BTN_OUTLINE}
            onClick={() => setLines((prev) => [...prev, emptyLine()])}
          >
            + Add line
          </button>
          <button type="button" className={BTN} onClick={createVoucher}>
            Save voucher
          </button>
        </div>
        <p className="text-[11px] text-[var(--muted)]">
          Set up accounts, categories & sub-categories under Accounts → Masters.
        </p>
      </section>

      {sessionTotals.length > 0 ? (
        <section className={CARD}>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Session expenses — {vDate}
          </h3>
          <p className="text-[11px] text-[var(--muted)]">
            Paid vouchers on this date (category & sub-category totals).
          </p>
          <div className="mt-3 overflow-x-auto">
            <ErpTable minWidth="min-w-[480px]">
              <ErpTableHead>
                <tr>
                  <th className="pb-2">Category</th>
                  <th className="pb-2">Sub-category</th>
                  <th className="pb-2 text-right">Amount</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {sessionTotals.map((row) => (
                  <tr key={`${row.categoryId}:${row.subcategoryId}`}>
                    <td className="py-2">{row.categoryName}</td>
                    <td className="py-2">{row.subcategoryName}</td>
                    <td className="py-2 text-right font-medium">
                      {formatInr(row.amountPaise)}
                    </td>
                  </tr>
                ))}
              </ErpTableBody>
              <tfoot>
                <tr className="border-t-2 font-bold">
                  <td colSpan={2} className="py-2 text-right">
                    Total
                  </td>
                  <td className="py-2 text-right">
                    {formatInr(
                      sessionTotals.reduce((n, r) => n + r.amountPaise, 0),
                    )}
                  </td>
                </tr>
              </tfoot>
            </ErpTable>
          </div>
        </section>
      ) : null}

      <section className={CARD}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">Vouchers</h3>
        <div className="mb-3 flex flex-wrap items-end gap-2 text-sm">
          <label className="min-w-[14rem] flex-1 text-[11px] font-semibold text-[var(--muted)]">
            Pay using
            <PaymentChannelSelect
              className={`${FIELD} mt-1`}
              value={payChannel}
              onChange={setPayChannel}
              accounts={state}
            />
            <span className="mt-0.5 block text-[10px] font-medium text-emerald-800">
              Available:{" "}
              {formatInr(
                paymentChannelAvailablePaise(payChannel, payPool, state),
              )}
            </span>
          </label>
          {decodePaymentChannel(payChannel).mode === "cash" ? (
            <select className={FIELD} value={payPool} onChange={(e) => setPayPool(e.target.value)}>
              {state.cashPools.map((p) => (
                <option key={p.id} value={p.id}>
                  Cash pool: {p.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <ErpTableShell>
          <div className="overflow-x-auto">
            <ErpTable minWidth="min-w-[720px]">
              <ErpTableHead>
                <tr>
                  <ErpSortTh sort={voucherSort} field="date">Date</ErpSortTh>
                  <ErpSortTh sort={voucherSort} field="voucherNo">Voucher</ErpSortTh>
                  <ErpSortTh sort={voucherSort} field="lines">Lines</ErpSortTh>
                  <ErpSortTh sort={voucherSort} field="status">Status</ErpSortTh>
                  <ErpSortTh sort={voucherSort} field="total" align="right">Total</ErpSortTh>
                  <ErpSortTh sort={voucherSort} field="paid" align="right">Paid</ErpSortTh>
                  <ErpSortTh sort={voucherSort} field="due" align="right">Due</ErpSortTh>
                  <th className="px-4 py-2.5 font-bold">Actions</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {voucherSort.rows.slice(0, 30).map((v) => (
                  <tr key={v.id} className="hover:bg-[var(--surface-sunken)]">
                    <td className="px-4 py-2">{v.date}</td>
                    <td className="px-4 py-2 font-mono text-xs">{v.voucherNo || v.id.slice(-8)}</td>
                    <td className="px-4 py-2 text-xs text-[var(--muted)]">
                      {v.lines.length || 1} line(s)
                    </td>
                    <td className="px-4 py-2">{v.paymentStatus}</td>
                    <td className="px-4 py-2 text-right">
                      {formatInr(v.grandTotalPaise || v.amountPaise)}
                    </td>
                    <td className="px-4 py-2 text-right">{formatInr(v.paidPaise)}</td>
                    <td className="px-4 py-2 text-right">{formatInr(v.duePaise)}</td>
                    <td className="px-4 py-2">
                    <div className="flex flex-wrap gap-1">
                      {v.paymentStatus === "pending_approval" ? (
                        <button
                          type="button"
                          className={BTN_OUTLINE}
                          onClick={() => {
                            const r = approveExpenseVoucher(v.id, actorName);
                            if (!r.ok) onError(r.error);
                            else {
                              onFlash("Approved");
                              onRefresh();
                            }
                          }}
                        >
                          Approve
                        </button>
                      ) : null}
                      {v.paymentStatus === "draft" ||
                      v.paymentStatus === "partial" ? (
                        <button
                          type="button"
                          className={BTN_OUTLINE}
                          onClick={() =>
                            payVoucher(v.id, v.mode, v.duePaise)
                          }
                        >
                          Pay due
                        </button>
                      ) : null}
                      {!isExpenseVoucherCancelled(v) ? (
                        <button
                          type="button"
                          className={BTN_OUTLINE}
                          onClick={() => cancelVoucher(v.id)}
                        >
                          Cancel
                        </button>
                      ) : null}
                      {v.paidPaise > 0 ? (
                        <button
                          type="button"
                          className={BTN_OUTLINE}
                          onClick={() => printExpenseVoucher(v, state)}
                        >
                          Print
                        </button>
                      ) : null}
                    </div>
                  </td>
                </tr>
              ))}
              </ErpTableBody>
            </ErpTable>
          </div>
        </ErpTableShell>
      </section>

      <section className={`${CARD} space-y-3`}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Recurring expenses
        </h3>
        <div className="grid gap-2 sm:grid-cols-4">
          <select className={FIELD} value={recCat} onChange={(e) => setRecCat(e.target.value)}>
            {rootCategories.map((c) => (
              <option key={c.id} value={c.id}>
                {c.name}
              </option>
            ))}
          </select>
          <input
            className={FIELD}
            placeholder="Amount ₹"
            value={recAmt}
            onChange={(e) => setRecAmt(e.target.value)}
          />
          <input
            className={FIELD}
            placeholder="Day of month"
            value={recDay}
            onChange={(e) => setRecDay(e.target.value)}
          />
          <button type="button" className={BTN} onClick={addRecurring}>
            Save rule
          </button>
        </div>
        <div className="flex flex-wrap items-center gap-2">
          <input
            type="month"
            className={FIELD}
            value={genYm}
            onChange={(e) => setGenYm(e.target.value)}
          />
          <button type="button" className={BTN_OUTLINE} onClick={generateMonth}>
            Generate for month
          </button>
        </div>
        <ul className="text-sm text-[var(--muted)]">
          {state.recurringRules.map((r) => (
            <li key={r.id}>
              Day {r.dayOfMonth} · {formatInr(r.amountPaise)} ·{" "}
              {getExpenseCategory(r.categoryId, state)?.name}
            </li>
          ))}
        </ul>
      </section>
    </div>
  );
}

/* ─── Store vendor dues, straight from the ledger ──────────── */

type StoreVendorDue = {
  vendorId: string;
  name: string;
  gstin: string;
  phone: string;
  contactPerson: string;
  paymentTermsDays: number;
  ledgerDuePaise: number;
  billsOpenPaise: number;
  openBillCount: number;
  oldestBillDate: string;
};

/** One open store bill, as `listVendorBills` returns it. */
type StoreVendorBill = {
  id: string;
  billNo: string;
  supplierInvoiceNo: string;
  grnNo: string;
  billDate: string;
  dueDate: string;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  status: string;
  overdueDays: number;
};

/**
 * What the school owes its store suppliers, read from account 2000.
 *
 * Separate from "Unified payables" above on purpose. That list is built from
 * the browser's own accounts state; this one is the ledger's answer, and the
 * two are not the same source. Showing them apart means a supplier who appears
 * in one and not the other is visible rather than quietly merged away.
 *
 * The store's own open-bill total is shown beside the ledger balance. They
 * should agree to the paisa; when they do not, a bill moved on one side only,
 * and that is worth a look rather than an average.
 */
function StoreVendorDues() {
  const [rows, setRows] = useState<StoreVendorDue[] | null>(null);
  const [error, setError] = useState("");
  const [loading, setLoading] = useState(true);
  const [openVendor, setOpenVendor] = useState<string | null>(null);
  const [billsByVendor, setBillsByVendor] = useState<
    Record<string, StoreVendorBill[]>
  >({});
  const [billsBusy, setBillsBusy] = useState(false);
  const [pay, setPay] = useState<{
    billId: string;
    billNo: string;
    vendorId: string;
    balancePaise: number;
    amount: string;
    mode: string;
    paidOn: string;
    reference: string;
  } | null>(null);
  const [paying, setPaying] = useState(false);
  const [notice, setNotice] = useState("");

  const load = async () => {
    setLoading(true);
    try {
      const res = await fetch("/api/ledger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "vendor-dues" }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        dues?: StoreVendorDue[];
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setError(json.error || "Could not read vendor dues");
        setRows(null);
      } else {
        setError("");
        setRows(json.dues ?? []);
      }
    } catch {
      setError("Could not reach the server");
      setRows(null);
    } finally {
      setLoading(false);
    }
  };

  useEffect(() => {
    void load();
  }, []);

  const loadBills = async (vendorId: string) => {
    setBillsBusy(true);
    try {
      const res = await fetch("/api/ledger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({ action: "vendor-bills", vendorId }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        bills?: StoreVendorBill[];
        error?: string;
      };
      if (res.ok && json.ok) {
        setBillsByVendor((m) => ({ ...m, [vendorId]: json.bills ?? [] }));
      } else {
        setNotice(json.error || "Could not read this vendor's bills");
      }
    } catch {
      setNotice("Could not reach the server");
    } finally {
      setBillsBusy(false);
    }
  };

  const toggleVendor = (vendorId: string) => {
    if (openVendor === vendorId) {
      setOpenVendor(null);
      return;
    }
    setOpenVendor(vendorId);
    setPay(null);
    void loadBills(vendorId);
  };

  const submitPay = async () => {
    if (!pay || paying) return;
    const amountPaise = paiseFromInr(pay.amount);
    if (amountPaise <= 0) {
      setNotice("Enter the amount to pay");
      return;
    }
    setPaying(true);
    try {
      const res = await fetch("/api/ledger", {
        method: "POST",
        headers: { "content-type": "application/json" },
        body: JSON.stringify({
          action: "pay-vendor-bill",
          billId: pay.billId,
          amountPaise,
          mode: pay.mode,
          paidOn: pay.paidOn || undefined,
          reference: pay.reference.trim(),
        }),
      });
      const json = (await res.json()) as {
        ok?: boolean;
        balancePaise?: number;
        paymentNo?: string;
        ledgerVoucherNo?: string;
        error?: string;
      };
      if (!res.ok || !json.ok) {
        setNotice(json.error || "Payment failed");
        return;
      }
      // Mirror the payment into the DESK bank book.
      //
      // The store pays through inv_pay_vendor_bill, which writes the server
      // book (Dr 2000 / Cr tender) and nothing else. The desk's own bank
      // ledger never saw a store payment, so the Accounts dashboard's "Bank
      // balances" counted fee receipts coming IN and not one rupee going OUT
      // — 170 debits, zero credits, while the book carried 3.06 lakh of bank
      // payments the desk had never heard of.
      //
      // Written here rather than in the RPC on purpose: a desk push deletes
      // accounts_desk_bank_ledger rows whose ids it does not carry, so a row
      // inserted server-side would be destroyed by the next browser sync.
      //
      // Never allowed to disturb the payment itself — that has already
      // committed on the server, and a desk-side problem must not report a
      // successful payment as failed.
      let deskNote = "";
      if (pay.mode !== "cash") {
        try {
          const source = json.paymentNo || `${pay.billId}:${amountPaise}`;
          if (!bankMovementExists("inv_vendor_payment", source)) {
            const bankId = resolveBankForPaymentMode(pay.mode as PaymentMode);
            if (bankId) {
              const moved = postBankMovement({
                bankId,
                date: pay.paidOn || undefined,
                direction: "cr",
                amountPaise,
                mode: pay.mode as PaymentMode,
                sourceType: "inv_vendor_payment",
                sourceId: source,
                narration: `Vendor payment · ${pay.billNo}`,
                transactionRef: pay.reference.trim(),
              });
              if (!moved.ok) deskNote = ` · bank book not updated: ${moved.error}`;
            } else {
              deskNote =
                ` · no bank is set up for ${pay.mode}, so the desk bank book was not updated`;
            }
          }
        } catch {
          deskNote = " · the desk bank book could not be updated";
        }
      }

      setNotice(
        `Paid ${formatInr(amountPaise)} against ${pay.billNo} — ` +
          `${formatInr(json.balancePaise ?? 0)} still outstanding` +
          (json.ledgerVoucherNo ? ` · voucher ${json.ledgerVoucherNo}` : "") +
          deskNote,
      );
      const vendorId = pay.vendorId;
      setPay(null);
      await Promise.all([load(), loadBills(vendorId)]);
    } catch {
      setNotice("Could not reach the server");
    } finally {
      setPaying(false);
    }
  };

  const owing = (rows ?? []).filter((r) => r.ledgerDuePaise !== 0);
  const totalPaise = owing.reduce((n, r) => n + r.ledgerDuePaise, 0);

  return (
    <section className={CARD}>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <div>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Store vendors
          </h3>
          <p className="text-[11px] text-[var(--muted)]">
            Every vendor created in Store → Vendors, with what the ledger says
            the school owes. Click a vendor to see and pay its open bills —
            the payment settles the store bill and posts to the books in one
            step.
          </p>
        </div>
        <button type="button" className={BTN_OUTLINE} onClick={() => void load()}>
          Refresh
        </button>
      </div>

      {error ? (
        <p className="rounded-lg border border-[var(--danger)] bg-[var(--danger-soft)] px-3 py-2 text-xs text-[var(--danger)]">
          {error}
        </p>
      ) : null}

      {notice ? (
        <p className="mb-2 rounded-lg border border-[var(--border)] bg-[var(--accent)] px-3 py-1.5 text-xs text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      {loading && !rows ? (
        <p className="py-3 text-sm text-[var(--muted)]">Loading vendor dues…</p>
      ) : null}

      {rows && rows.length === 0 ? (
        <p className="py-3 text-sm text-[var(--muted)]">
          No store vendors yet. Create them in Store → Vendors; they appear
          here immediately, and their bills become payable here as soon as a
          goods receipt raises one.
        </p>
      ) : null}

      {rows && rows.length > 0 ? (
        <>
          <ErpTable minWidth="min-w-full">
            <ErpTableHead>
              <tr>
                <th className="pb-2 text-left">Vendor</th>
                <th className="pb-2 text-left">Contact</th>
                <th className="pb-2 text-left">GSTIN</th>
                <th className="pb-2 text-right">Owed (books)</th>
                <th className="pb-2 text-right">Open bills</th>
                <th className="pb-2 text-left">Oldest</th>
                <th className="pb-2 text-right">Action</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {rows.map((r) => {
                const agrees = r.ledgerDuePaise === r.billsOpenPaise;
                const expanded = openVendor === r.vendorId;
                const bills = billsByVendor[r.vendorId] ?? [];
                return (
                  <Fragment key={r.vendorId}>
                    <tr>
                      <td className="py-2 font-semibold">
                        {r.name}
                        {r.paymentTermsDays > 0 ? (
                          <span className="ml-1 text-[11px] font-normal text-[var(--muted)]">
                            {r.paymentTermsDays}d terms
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 text-[var(--muted)]">
                        {r.phone || r.contactPerson || "—"}
                      </td>
                      <td className="py-2 text-[var(--muted)]">{r.gstin || "—"}</td>
                      <td className="py-2 text-right font-semibold">
                        {formatInr(r.ledgerDuePaise)}
                      </td>
                      <td
                        className={`py-2 text-right ${
                          agrees ? "text-[var(--muted)]" : "text-[var(--danger)]"
                        }`}
                        title={
                          agrees
                            ? undefined
                            : "The store's bills and the ledger disagree — a bill moved on one side only"
                        }
                      >
                        {formatInr(r.billsOpenPaise)}
                        {r.openBillCount > 0 ? (
                          <span className="ml-1 text-[11px] text-[var(--muted)]">
                            ({r.openBillCount})
                          </span>
                        ) : null}
                      </td>
                      <td className="py-2 text-[var(--muted)]">
                        {r.oldestBillDate || "—"}
                      </td>
                      <td className="py-2 text-right">
                        <button
                          type="button"
                          className={BTN_OUTLINE}
                          onClick={() => toggleVendor(r.vendorId)}
                        >
                          {expanded
                            ? "Close"
                            : r.openBillCount > 0
                              ? "Bills / pay"
                              : "Bills"}
                        </button>
                      </td>
                    </tr>
                    {expanded ? (
                      <tr>
                        <td colSpan={7} className="pb-3">
                          <div className="rounded-lg border border-[var(--border)] bg-[var(--surface-sunken)] p-2">
                            {billsBusy && !bills.length ? (
                              <p className="px-1 py-2 text-xs text-[var(--muted)]">
                                Loading bills…
                              </p>
                            ) : bills.length === 0 ? (
                              <p className="px-1 py-2 text-xs text-[var(--muted)]">
                                No open bills. A bill is raised in Store when
                                goods are received against this vendor.
                              </p>
                            ) : (
                              <ul className="space-y-2">
                                {bills.map((b) => (
                                  <li
                                    key={b.id}
                                    className="rounded-lg border border-[var(--border)] bg-[var(--card)] px-2.5 py-2"
                                  >
                                    <div className="flex flex-wrap items-center justify-between gap-2 text-xs">
                                      <span className="font-semibold text-[var(--brand-deep)]">
                                        {b.billNo}
                                        {b.supplierInvoiceNo
                                          ? ` · inv ${b.supplierInvoiceNo}`
                                          : ""}
                                        {b.grnNo ? ` · ${b.grnNo}` : ""}
                                      </span>
                                      <span className="text-[var(--muted)]">
                                        {b.billDate}
                                        {b.overdueDays > 0 ? (
                                          <span className="ml-1 font-semibold text-[var(--danger)]">
                                            {b.overdueDays}d overdue
                                          </span>
                                        ) : null}
                                      </span>
                                      <span>
                                        {formatInr(b.totalPaise)} billed ·{" "}
                                        {formatInr(b.paidPaise)} paid ·{" "}
                                        <strong>
                                          {formatInr(b.balancePaise)} due
                                        </strong>
                                      </span>
                                      {pay?.billId !== b.id ? (
                                        <button
                                          type="button"
                                          className={BTN}
                                          disabled={b.balancePaise <= 0}
                                          onClick={() =>
                                            setPay({
                                              billId: b.id,
                                              billNo: b.billNo,
                                              vendorId: r.vendorId,
                                              balancePaise: b.balancePaise,
                                              amount: (b.balancePaise / 100).toFixed(2),
                                              mode: "bank",
                                              paidOn: new Date()
                                                .toISOString()
                                                .slice(0, 10),
                                              reference: "",
                                            })
                                          }
                                        >
                                          Pay
                                        </button>
                                      ) : null}
                                    </div>
                                    {pay?.billId === b.id ? (
                                      <div className="mt-2 flex flex-wrap items-end gap-2 border-t border-[var(--border)] pt-2">
                                        <label className="text-[11px] text-[var(--muted)]">
                                          Amount (₹)
                                          <input
                                            className={FIELD}
                                            value={pay.amount}
                                            onChange={(e) =>
                                              setPay({ ...pay, amount: e.target.value })
                                            }
                                          />
                                        </label>
                                        <label className="text-[11px] text-[var(--muted)]">
                                          Paid on
                                          <input
                                            type="date"
                                            className={FIELD}
                                            value={pay.paidOn}
                                            onChange={(e) =>
                                              setPay({ ...pay, paidOn: e.target.value })
                                            }
                                          />
                                        </label>
                                        <label className="text-[11px] text-[var(--muted)]">
                                          Mode
                                          <select
                                            className={FIELD}
                                            value={pay.mode}
                                            onChange={(e) =>
                                              setPay({ ...pay, mode: e.target.value })
                                            }
                                          >
                                            <option value="bank">Bank</option>
                                            <option value="upi">UPI</option>
                                            <option value="neft">NEFT</option>
                                            <option value="rtgs">RTGS</option>
                                            <option value="cheque">Cheque</option>
                                            <option value="cash">Cash</option>
                                          </select>
                                        </label>
                                        <label className="text-[11px] text-[var(--muted)]">
                                          Reference
                                          <input
                                            className={FIELD}
                                            placeholder="UTR / cheque no."
                                            value={pay.reference}
                                            onChange={(e) =>
                                              setPay({ ...pay, reference: e.target.value })
                                            }
                                          />
                                        </label>
                                        <button
                                          type="button"
                                          className={BTN}
                                          disabled={paying}
                                          onClick={() => void submitPay()}
                                        >
                                          {paying
                                            ? "Paying…"
                                            : `Pay ${formatInr(paiseFromInr(pay.amount))}`}
                                        </button>
                                        <button
                                          type="button"
                                          className={BTN_OUTLINE}
                                          disabled={paying}
                                          onClick={() => setPay(null)}
                                        >
                                          Cancel
                                        </button>
                                      </div>
                                    ) : null}
                                  </li>
                                ))}
                              </ul>
                            )}
                          </div>
                        </td>
                      </tr>
                    ) : null}
                  </Fragment>
                );
              })}
            </ErpTableBody>
          </ErpTable>
          <p className="mt-2 text-right text-sm font-bold text-[var(--brand-deep)]">
            Total owed: {formatInr(totalPaise)}
          </p>
        </>
      ) : null}
    </section>
  );
}

export function BillsPanel({
  state,
  onRefresh,
  onFlash,
  onError,
}: AccountsPanelProps) {
  const rootCategories = useMemo(
    () => listRootExpenseCategories(state),
    [state.expenseCategories],
  );
  const activeVendors = useMemo(
    () => state.vendors.filter((v) => v.isActive !== false),
    [state.vendors],
  );

  const [billVendor, setBillVendor] = useState(activeVendors[0]?.id ?? "");
  const [billDate, setBillDate] = useState(todayIso());
  const [dueOn, setDueOn] = useState(todayIso());
  const [billNo, setBillNo] = useState("");
  const [receiptNo, setReceiptNo] = useState("");
  const [billNarration, setBillNarration] = useState("");
  const [billDiscount, setBillDiscount] = useState("");
  const [billTax, setBillTax] = useState("");
  const [payChannel, setPayChannel] = useState(() => defaultPaymentChannel(state));
  const [payPool, setPayPool] = useState(state.cashPools[0]?.id ?? "");

  type BillLineDraft = {
    id: string;
    lineDate: string;
    itemName: string;
    qty: string;
    unit: string;
    rate: string;
    discount: string;
    tax: string;
    categoryId: string;
  };

  function emptyBillLine(): BillLineDraft {
    return {
      id: `bl_${Math.random().toString(36).slice(2, 8)}`,
      lineDate: billDate,
      itemName: "",
      qty: "1",
      unit: "pcs",
      rate: "",
      discount: "",
      tax: "",
      categoryId: rootCategories[0]?.id ?? "",
    };
  }

  const [billLines, setBillLines] = useState<BillLineDraft[]>([emptyBillLine()]);

  useEffect(() => {
    syncTransportPayables();
    onRefresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const payables = listUnifiedPayables(state);

  // Balance is amount minus paid, computed per row — sort the arithmetic, not
  // the formatted "₹1,200" the cell shows.
  const payableSort = useTableSort(
    payables,
    {
      due: (p) => p.dueOn || null,
      source: (p) => p.sourceType,
      balance: (p) => Math.max(0, p.amountPaise - p.paidPaise),
      note: (p) => p.note || null,
    },
    "due",
  );

  function billLineTotalPaise(l: BillLineDraft) {
    return vendorBillLineTotalPaise({
      qty: Number(l.qty) || 0,
      ratePaise: paiseFromInr(l.rate),
      discountPaise: paiseFromInr(l.discount),
      taxPaise: paiseFromInr(l.tax),
    });
  }

  const billTotals = useMemo(() => {
    const subtotal = billLines.reduce((s, l) => s + billLineTotalPaise(l), 0);
    const lineTax = billLines.reduce((s, l) => s + paiseFromInr(l.tax), 0);
    const discount = paiseFromInr(billDiscount);
    const headerTax = paiseFromInr(billTax);
    const tax = lineTax + headerTax;
    const grand = Math.max(0, subtotal - Math.min(discount, subtotal) + headerTax);
    return { subtotal, discount, tax, grand };
  }, [billLines, billDiscount, billTax]);

  function updateBillLine(id: string, patch: Partial<BillLineDraft>) {
    setBillLines((prev) =>
      prev.map((l) => (l.id === id ? { ...l, ...patch } : l)),
    );
  }

  function addBill() {
    if (!billVendor) {
      onError("Select a vendor — add vendors under Masters → Vendors");
      return;
    }
    if (!billLines.some((l) => l.itemName.trim())) {
      onError("Add at least one line item with a name");
      return;
    }
    const lines = billLines
      .filter((l) => l.itemName.trim())
      .map((l) => {
        const amountPaise = billLineTotalPaise(l);
        return {
          id: l.id,
          lineDate: l.lineDate || billDate,
          itemName: l.itemName.trim(),
          description: l.itemName.trim(),
          qty: Number(l.qty) || 0,
          unit: l.unit || "pcs",
          ratePaise: paiseFromInr(l.rate),
          discountPaise: paiseFromInr(l.discount),
          taxPaise: paiseFromInr(l.tax),
          amountPaise,
          categoryId: l.categoryId,
        };
      });
    const res = createVendorBill({
      vendorId: billVendor,
      billNo,
      supplierInvoiceNo: billNo,
      receiptNo,
      billDate,
      dueOn: dueOn || billDate,
      narration: billNarration,
      discountType: billTotals.discount > 0 ? "amount" : "none",
      discountPaise: billTotals.discount,
      taxPaise: paiseFromInr(billTax),
      grandTotalPaise: billTotals.grand,
      lines,
      categoryId: lines[0]?.categoryId,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash(`Bill ${res.bill.billNo || res.bill.id} created`);
    setBillNo("");
    setReceiptNo("");
    setBillNarration("");
    setBillDiscount("");
    setBillTax("");
    setBillLines([emptyBillLine()]);
    onRefresh();
  }

  function pay(payableId: string) {
    const { mode, bankId } = decodePaymentChannel(payChannel);
    const res = payUnifiedPayable(payableId, {
      mode: mode === "cash" ? "cash" : "bank",
      poolId: mode === "cash" ? payPool : undefined,
      bankId: mode !== "cash" ? bankId : undefined,
      bankMode: mode !== "cash" ? mode : undefined,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Payable settled");
    onRefresh();
  }

  return (
    <div className="mt-4 space-y-4">
      {/* Server-truth vendors first: this is where store suppliers are
          seen and paid. The forms below are the browser-book side. */}
      <StoreVendorDues />

      <section className={`${CARD} space-y-4`}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Vendor bill entry
        </h3>
        <p className="text-[11px] text-[var(--muted)]">
          Select an existing vendor from Masters. Add line items with qty, unit, rate,
          discount and tax — bill total is computed automatically.
        </p>

        <div className="grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Vendor *
            <select
              className={`${FIELD} mt-1`}
              value={billVendor}
              onChange={(e) => setBillVendor(e.target.value)}
            >
              <option value="">— Select vendor —</option>
              {activeVendors.map((v) => (
                <option key={v.id} value={v.id}>
                  {v.name}
                </option>
              ))}
            </select>
          </label>
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Bill date
            <input
              type="date"
              className={`${FIELD} mt-1`}
              value={billDate}
              onChange={(e) => setBillDate(e.target.value)}
            />
          </label>
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Due on
            <input
              type="date"
              className={`${FIELD} mt-1`}
              value={dueOn}
              onChange={(e) => setDueOn(e.target.value)}
            />
          </label>
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Supplier invoice #
            <input
              className={`${FIELD} mt-1`}
              value={billNo}
              onChange={(e) => setBillNo(e.target.value)}
              placeholder="Bill / invoice number"
            />
          </label>
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            GRN / receipt #
            <input
              className={`${FIELD} mt-1`}
              value={receiptNo}
              onChange={(e) => setReceiptNo(e.target.value)}
              placeholder="Optional"
            />
          </label>
          <label className="col-span-full block text-[11px] font-semibold text-[var(--muted)]">
            Narration
            <input
              className={`${FIELD} mt-1`}
              value={billNarration}
              onChange={(e) => setBillNarration(e.target.value)}
              placeholder="Optional note"
            />
          </label>
        </div>

        <div className="overflow-x-auto">
          <ErpTable minWidth="min-w-[1100px]" className="text-xs">
            <ErpTableHead>
              <tr>
                <th className="pb-2 pr-2">Date</th>
                <th className="pb-2 pr-2">Item</th>
                <th className="pb-2 pr-2 text-right">Qty</th>
                <th className="pb-2 pr-2">Unit</th>
                <th className="pb-2 pr-2 text-right">Rate ₹</th>
                <th className="pb-2 pr-2 text-right">Discount ₹</th>
                <th className="pb-2 pr-2 text-right">Tax ₹</th>
                <th className="pb-2 pr-2">Category</th>
                <th className="pb-2 pr-2 text-right">Line total</th>
                <th className="pb-2" />
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {billLines.map((l) => (
                <tr key={l.id}>
                  <td className="py-1 pr-2">
                    <input
                      type="date"
                      className={FIELD}
                      value={l.lineDate || billDate}
                      onChange={(e) =>
                        updateBillLine(l.id, { lineDate: e.target.value })
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className={FIELD}
                      placeholder="Item name"
                      value={l.itemName}
                      onChange={(e) =>
                        updateBillLine(l.id, { itemName: e.target.value })
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className={`${FIELD} text-right`}
                      value={l.qty}
                      onChange={(e) => updateBillLine(l.id, { qty: e.target.value })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      className={FIELD}
                      value={l.unit}
                      onChange={(e) => updateBillLine(l.id, { unit: e.target.value })}
                    >
                      {VENDOR_BILL_UNITS.map((u) => (
                        <option key={u} value={u}>
                          {u}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className={`${FIELD} text-right`}
                      placeholder="0"
                      value={l.rate}
                      onChange={(e) => updateBillLine(l.id, { rate: e.target.value })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className={`${FIELD} text-right`}
                      placeholder="0"
                      value={l.discount}
                      onChange={(e) =>
                        updateBillLine(l.id, { discount: e.target.value })
                      }
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <input
                      className={`${FIELD} text-right`}
                      placeholder="0"
                      value={l.tax}
                      onChange={(e) => updateBillLine(l.id, { tax: e.target.value })}
                    />
                  </td>
                  <td className="py-1 pr-2">
                    <select
                      className={FIELD}
                      value={l.categoryId}
                      onChange={(e) =>
                        updateBillLine(l.id, { categoryId: e.target.value })
                      }
                    >
                      {rootCategories.map((c) => (
                        <option key={c.id} value={c.id}>
                          {c.name}
                        </option>
                      ))}
                    </select>
                  </td>
                  <td className="py-1 pr-2 text-right font-semibold">
                    {formatInr(billLineTotalPaise(l))}
                  </td>
                  <td className="py-1">
                    <button
                      type="button"
                      className={BTN_OUTLINE}
                      onClick={() =>
                        setBillLines((prev) =>
                          prev.length > 1
                            ? prev.filter((x) => x.id !== l.id)
                            : prev,
                        )
                      }
                    >
                      ×
                    </button>
                  </td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </div>

        <div className="flex flex-wrap items-end gap-3">
          <button
            type="button"
            className={BTN_OUTLINE}
            onClick={() => setBillLines((prev) => [...prev, emptyBillLine()])}
          >
            + Add line
          </button>
          <label className="text-[11px] font-semibold text-[var(--muted)]">
            Bill discount ₹
            <input
              className={`${FIELD} mt-1 w-28 text-right`}
              value={billDiscount}
              onChange={(e) => setBillDiscount(e.target.value)}
            />
          </label>
          <label className="text-[11px] font-semibold text-[var(--muted)]">
            Bill tax ₹
            <input
              className={`${FIELD} mt-1 w-28 text-right`}
              value={billTax}
              onChange={(e) => setBillTax(e.target.value)}
            />
          </label>
          <div className="ml-auto text-right text-sm">
            <p className="text-[var(--muted)]">
              Subtotal: {formatInr(billTotals.subtotal)}
            </p>
            <p className="font-bold text-[var(--brand-deep)]">
              Bill total: {formatInr(billTotals.grand)}
            </p>
          </div>
          <button type="button" className={BTN} onClick={addBill}>
            Create bill
          </button>
        </div>
      </section>


      <section className={CARD}>
        <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Unified payables
          </h3>
          <button
            type="button"
            className={BTN_OUTLINE}
            onClick={() => {
              syncTransportPayables();
              onFlash("Transport payables synced");
              onRefresh();
            }}
          >
            Sync transport
          </button>
        </div>
        <div className="mb-3 flex flex-wrap items-end gap-2 text-sm">
          <label className="min-w-[14rem] flex-1 text-[11px] font-semibold text-[var(--muted)]">
            Pay using
            <PaymentChannelSelect
              className={`${FIELD} mt-1`}
              value={payChannel}
              onChange={setPayChannel}
              accounts={state}
            />
          </label>
          {decodePaymentChannel(payChannel).mode === "cash" ? (
            <select className={FIELD} value={payPool} onChange={(e) => setPayPool(e.target.value)}>
              {state.cashPools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <ErpTable minWidth="min-w-full">
          <ErpTableHead>
            <tr>
              <ErpSortTh sort={payableSort} field="due">Due</ErpSortTh>
              <ErpSortTh sort={payableSort} field="source">Source</ErpSortTh>
              <ErpSortTh sort={payableSort} field="balance" align="right">
                Balance
              </ErpSortTh>
              <ErpSortTh sort={payableSort} field="note">Note</ErpSortTh>
              <th className="pb-2" />
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {payableSort.rows.map((p) => {
              const bal = Math.max(0, p.amountPaise - p.paidPaise);
              return (
                <tr key={p.id}>
                  <td className="py-2">{p.dueOn}</td>
                  <td className="py-2">{p.sourceType}</td>
                  <td className="py-2 text-right">{formatInr(bal)}</td>
                  <td className="py-2 text-[var(--muted)]">{p.note}</td>
                  <td className="py-2">
                    <button type="button" className={BTN_OUTLINE} onClick={() => pay(p.id)}>
                      Pay
                    </button>
                    {p.sourceType === "expense_bill" ? (
                      <button
                        type="button"
                        className={`${BTN_OUTLINE} ml-1`}
                        onClick={() => {
                          markBillPaid(p.sourceId);
                          onFlash("Bill marked paid");
                          onRefresh();
                        }}
                      >
                        Mark paid
                      </button>
                    ) : null}
                  </td>
                </tr>
              );
            })}
            {payables.length === 0 ? (
              <tr>
                <td colSpan={5} className="py-4 text-[var(--muted)]">
                  No open payables
                </td>
              </tr>
            ) : null}
          </ErpTableBody>
        </ErpTable>
      </section>
    </div>
  );
}

export function OwnerLoansPanel({
  state,
  onRefresh,
  onFlash,
  onError,
}: AccountsPanelProps) {
  const [trusteeName, setTrusteeName] = useState("");
  const [loanTrustee, setLoanTrustee] = useState(state.trustees[0]?.id ?? "");
  const [loanType, setLoanType] = useState<OwnerLoanType>("working_capital");
  const [loanPrincipal, setLoanPrincipal] = useState("");
  const [loanRate, setLoanRate] = useState("12");
  const [loanTenure, setLoanTenure] = useState("12");
  const [disburseChannel, setDisburseChannel] = useState(() =>
    defaultPaymentChannel(state),
  );
  const [disbursePool, setDisbursePool] = useState(state.cashPools[0]?.id ?? "");
  const [payChannel, setPayChannel] = useState(() => defaultPaymentChannel(state));
  const [payPool, setPayPool] = useState(state.cashPools[0]?.id ?? "");
  const [fromTrustee, setFromTrustee] = useState(state.trustees[0]?.id ?? "");
  const [toTrustee, setToTrustee] = useState(state.trustees[1]?.id ?? state.trustees[0]?.id ?? "");
  const [memoAmt, setMemoAmt] = useState("");
  const [memoNote, setMemoNote] = useState("");

  const dueRows = listOwnerLoanDue(todayIso(), state);

  function addTrustee() {
    const res = upsertTrustee({ name: trusteeName });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Trustee saved");
    setTrusteeName("");
    onRefresh();
  }

  function createLoan() {
    const { mode, bankId } = decodePaymentChannel(disburseChannel);
    const res = createOwnerLoan({
      trusteeId: loanTrustee,
      type: loanType,
      principalPaise: paiseFromInr(loanPrincipal),
      ratePct: Number(loanRate) || 0,
      tenureMonths: Number(loanTenure) || 12,
      disburseToPoolId: mode === "cash" ? disbursePool : undefined,
      disburseToBankId: mode !== "cash" ? bankId : undefined,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Owner loan created with EMI schedule");
    setLoanPrincipal("");
    onRefresh();
  }

  function payEmi(scheduleId: string) {
    const { mode, bankId } = decodePaymentChannel(payChannel);
    const res = recordOwnerLoanPayment(scheduleId, {
      mode: mode === "cash" ? "cash" : "bank",
      poolId: mode === "cash" ? payPool : undefined,
      bankId: mode !== "cash" ? bankId : undefined,
      bankMode: mode !== "cash" ? mode : undefined,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("EMI recorded");
    onRefresh();
  }

  function postTrusteeMemo() {
    const res = postInterTrusteeTransfer({
      fromTrusteeId: fromTrustee,
      toTrusteeId: toTrustee,
      amountPaise: paiseFromInr(memoAmt),
      note: memoNote,
    });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash("Inter-trustee memo posted");
    setMemoAmt("");
    setMemoNote("");
    onRefresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="grid gap-4 lg:grid-cols-2">
        <section className={`${CARD} space-y-3`}>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">Trustees</h3>
          <input className={FIELD} placeholder="Trustee name" value={trusteeName} onChange={(e) => setTrusteeName(e.target.value)} />
          <button type="button" className={BTN} onClick={addTrustee}>
            Add trustee
          </button>
          <ul className="text-sm">
            {state.trustees.map((t) => (
              <li key={t.id}>{t.name}</li>
            ))}
          </ul>
        </section>

        <section className={`${CARD} space-y-3`}>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">New loan</h3>
          <select className={FIELD} value={loanTrustee} onChange={(e) => setLoanTrustee(e.target.value)}>
            {state.trustees.map((t) => (
              <option key={t.id} value={t.id}>
                {t.name}
              </option>
            ))}
          </select>
          <select className={FIELD} value={loanType} onChange={(e) => setLoanType(e.target.value as OwnerLoanType)}>
            <option value="working_capital">Working capital</option>
            <option value="vehicle">Vehicle</option>
            <option value="capex">Capex</option>
          </select>
          <input className={FIELD} placeholder="Principal ₹" value={loanPrincipal} onChange={(e) => setLoanPrincipal(e.target.value)} />
          <div className="grid grid-cols-2 gap-2">
            <input className={FIELD} placeholder="Rate %" value={loanRate} onChange={(e) => setLoanRate(e.target.value)} />
            <input className={FIELD} placeholder="Tenure months" value={loanTenure} onChange={(e) => setLoanTenure(e.target.value)} />
          </div>
          <label className="block text-[11px] font-semibold text-[var(--muted)]">
            Disburse via
            <PaymentChannelSelect
              className={`${FIELD} mt-1`}
              value={disburseChannel}
              onChange={setDisburseChannel}
              accounts={state}
            />
          </label>
          {decodePaymentChannel(disburseChannel).mode === "cash" ? (
            <select className={FIELD} value={disbursePool} onChange={(e) => setDisbursePool(e.target.value)}>
              {state.cashPools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
          <button type="button" className={BTN} onClick={createLoan}>
            Create loan
          </button>
        </section>
      </div>

      <section className={`${CARD} space-y-3`}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Inter-trustee memo
        </h3>
        <p className="text-xs text-[var(--muted)]">
          Transfers liability between trustees as a balanced journal note (novation lite).
        </p>
        <div className="grid gap-2 sm:grid-cols-2">
          <select className={FIELD} value={fromTrustee} onChange={(e) => setFromTrustee(e.target.value)}>
            {state.trustees.map((t) => (
              <option key={t.id} value={t.id}>
                From · {t.name}
              </option>
            ))}
          </select>
          <select className={FIELD} value={toTrustee} onChange={(e) => setToTrustee(e.target.value)}>
            {state.trustees.map((t) => (
              <option key={t.id} value={t.id}>
                To · {t.name}
              </option>
            ))}
          </select>
        </div>
        <input className={FIELD} placeholder="Amount ₹" value={memoAmt} onChange={(e) => setMemoAmt(e.target.value)} />
        <input className={FIELD} placeholder="Note (optional)" value={memoNote} onChange={(e) => setMemoNote(e.target.value)} />
        <button type="button" className={BTN} onClick={postTrusteeMemo}>
          Post memo JV
        </button>
      </section>

      <section className={CARD}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">EMI due</h3>
        <div className="mb-3 flex flex-wrap items-end gap-2">
          <label className="min-w-[14rem] flex-1 text-[11px] font-semibold text-[var(--muted)]">
            Pay using
            <PaymentChannelSelect
              className={`${FIELD} mt-1`}
              value={payChannel}
              onChange={setPayChannel}
              accounts={state}
            />
          </label>
          {decodePaymentChannel(payChannel).mode === "cash" ? (
            <select className={FIELD} value={payPool} onChange={(e) => setPayPool(e.target.value)}>
              {state.cashPools.map((p) => (
                <option key={p.id} value={p.id}>
                  {p.name}
                </option>
              ))}
            </select>
          ) : null}
        </div>
        <ErpTable minWidth="min-w-full" className="mt-3">
          <ErpTableHead>
            <tr>
              <th className="pb-2">Due</th>
              <th className="pb-2">#</th>
              <th className="pb-2 text-right">Amount</th>
              <th className="pb-2">Actions</th>
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {dueRows.map((r) => (
              <tr key={r.id}>
                <td className="py-2">{r.dueOn}</td>
                <td className="py-2">{r.installmentNo}</td>
                <td className="py-2 text-right">{formatInr(r.amountPaise)}</td>
                <td className="py-2">
                  <button type="button" className={BTN_OUTLINE} onClick={() => payEmi(r.id)}>
                    Pay EMI
                  </button>
                </td>
              </tr>
            ))}
            {dueRows.length === 0 ? (
              <tr>
                <td colSpan={4} className="py-4 text-[var(--muted)]">
                  No EMI due today
                </td>
              </tr>
            ) : null}
          </ErpTableBody>
        </ErpTable>
      </section>

      <section className={CARD}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Loans & schedule
        </h3>
        <ErpTable minWidth="min-w-full" className="mt-3">
          <ErpTableHead>
            <tr>
              <th className="pb-2">Trustee</th>
              <th className="pb-2">Type</th>
              <th className="pb-2 text-right">Principal</th>
              <th className="pb-2">Status</th>
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {state.ownerLoans.map((l) => (
              <tr key={l.id}>
                <td className="py-2">
                  {state.trustees.find((t) => t.id === l.trusteeId)?.name}
                </td>
                <td className="py-2">{l.type}</td>
                <td className="py-2 text-right">{formatInr(l.principalPaise)}</td>
                <td className="py-2">{l.status}</td>
              </tr>
            ))}
          </ErpTableBody>
        </ErpTable>
      </section>

      <section className={CARD}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Cash handovers to owner
        </h3>
        <ErpTable minWidth="min-w-full" className="mt-3">
          <ErpTableHead>
            <tr>
              <th className="pb-2">Date</th>
              <th className="pb-2 text-right">Amount</th>
              <th className="pb-2">Received by</th>
              <th className="pb-2">Purpose</th>
            </tr>
          </ErpTableHead>
          <ErpTableBody>
            {state.ownerCashHandovers.slice(0, 20).map((h) => (
              <tr key={h.id}>
                <td className="py-2">{h.date}</td>
                <td className="py-2 text-right">{formatInr(h.amountPaise)}</td>
                <td className="py-2">{h.receivedBy}</td>
                <td className="py-2 text-[var(--muted)]">{h.purpose}</td>
              </tr>
            ))}
          </ErpTableBody>
        </ErpTable>
      </section>
    </div>
  );
}

type JvDraftLine = {
  coaId: string;
  debit: string;
  credit: string;
  narration: string;
};

export function BooksPanel({
  state,
  onRefresh,
  onFlash,
  onError,
}: AccountsPanelProps) {
  const [jvDate, setJvDate] = useState(todayIso());
  const [jvNarration, setJvNarration] = useState("");
  const [jvLines, setJvLines] = useState<JvDraftLine[]>([
    { coaId: "", debit: "", credit: "", narration: "" },
    { coaId: "", debit: "", credit: "", narration: "" },
  ]);
  const [tbAsOf, setTbAsOf] = useState(todayIso());
  const [plFrom, setPlFrom] = useState(`${todayIso().slice(0, 7)}-01`);
  const [plTo, setPlTo] = useState(todayIso());
  const [bsAsOf, setBsAsOf] = useState(todayIso());
  const [view, setView] = useState<"coa" | "jv" | "tb" | "pl" | "bs">("coa");

  const tb = useMemo(() => trialBalance(tbAsOf, state), [tbAsOf, state]);
  const pl = useMemo(() => profitAndLoss(plFrom, plTo, state), [plFrom, plTo, state]);
  const bs = useMemo(() => balanceSheet(bsAsOf, state), [bsAsOf, state]);
  const journals = listJournals(state).slice(0, 20);

  function postJv() {
    const lines: JournalLine[] = jvLines
      .filter((l) => l.coaId)
      .map((l) => ({
        coaId: l.coaId,
        debitPaise: paiseFromInr(l.debit),
        creditPaise: paiseFromInr(l.credit),
        narration: l.narration,
      }));
    const res = postJournal({ date: jvDate, narration: jvNarration, lines });
    if (!res.ok) {
      onError(res.error);
      return;
    }
    onFlash(`Journal ${res.entry.voucherNo || "posted"}`);
    onRefresh();
  }

  return (
    <div className="mt-4 space-y-4">
      <div className="flex flex-wrap gap-2">
        {(["coa", "jv", "tb", "pl", "bs"] as const).map((v) => (
          <button
            key={v}
            type="button"
            className={`${BTN_OUTLINE} ${view === v ? "ring-2 ring-[var(--brand-gold)]" : ""}`}
            onClick={() => setView(v)}
          >
            {v === "coa"
              ? "Chart of accounts"
              : v === "jv"
                ? "Manual JV"
                : v === "tb"
                  ? "Trial balance"
                  : v === "pl"
                    ? "P&L"
                    : "Balance sheet"}
          </button>
        ))}
      </div>

      {view === "coa" ? (
        <section className={CARD}>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">
            Chart of accounts
          </h3>
          <ErpTable minWidth="min-w-full" className="mt-3">
            <ErpTableHead>
              <tr>
                <th className="pb-2">Code</th>
                <th className="pb-2">Name</th>
                <th className="pb-2">Group</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {state.coaAccounts.map((c) => (
                <tr key={c.id}>
                  <td className="py-2 font-mono">{c.code}</td>
                  <td className="py-2">{c.name}</td>
                  <td className="py-2">{c.group}</td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
          {state.fiscalYears.length > 0 ? (
            <div className="mt-4 space-y-2 text-sm">
              <div className="font-semibold text-[var(--brand-deep)]">
                Fiscal years
              </div>
              {state.fiscalYears.map((fy) => (
                <div
                  key={fy.code}
                  className="flex flex-wrap items-center justify-between gap-2 rounded-xl border border-[var(--border)] px-3 py-2"
                >
                  <div>
                    <div className="font-medium">
                      {fy.label}{" "}
                      <span className="text-[var(--muted)]">({fy.status})</span>
                    </div>
                    <div className="text-xs text-[var(--muted)]">
                      {fy.startDate} → {fy.endDate}
                    </div>
                  </div>
                  <button
                    type="button"
                    className={BTN_OUTLINE}
                    onClick={() => {
                      const next: FiscalYearStatus =
                        fy.status === "open" ? "closed" : "open";
                      const res = setFiscalYearStatus(fy.code, next);
                      if (!res.ok) {
                        onError(res.error);
                        return;
                      }
                      onFlash(
                        next === "closed"
                          ? `${fy.label} closed — journals soft-locked`
                          : `${fy.label} reopened`,
                      );
                      onRefresh();
                    }}
                  >
                    {fy.status === "open" ? "Close FY" : "Reopen FY"}
                  </button>
                </div>
              ))}
              <p className="text-xs text-[var(--muted)]">
                Closed years reject new journal entries that fall in that date range.
              </p>
            </div>
          ) : (
            <p className="mt-4 text-xs text-[var(--muted)]">
              No fiscal years configured — journal entries use open dating.
            </p>
          )}
        </section>
      ) : null}

      {view === "jv" ? (
        <section className={`${CARD} space-y-3`}>
          <h3 className="text-sm font-bold text-[var(--brand-deep)]">Manual journal</h3>
          <input type="date" className={FIELD} value={jvDate} onChange={(e) => setJvDate(e.target.value)} />
          <input className={FIELD} placeholder="Narration" value={jvNarration} onChange={(e) => setJvNarration(e.target.value)} />
          {jvLines.map((line, i) => (
            <div key={i} className="grid gap-2 sm:grid-cols-4">
              <select
                className={FIELD}
                value={line.coaId}
                onChange={(e) => {
                  const next = [...jvLines];
                  next[i] = { ...line, coaId: e.target.value };
                  setJvLines(next);
                }}
              >
                <option value="">COA account</option>
                {state.coaAccounts.map((c) => (
                  <option key={c.id} value={c.id}>
                    {c.code} · {c.name}
                  </option>
                ))}
              </select>
              <input
                className={FIELD}
                placeholder="Debit ₹"
                value={line.debit}
                onChange={(e) => {
                  const next = [...jvLines];
                  next[i] = { ...line, debit: e.target.value };
                  setJvLines(next);
                }}
              />
              <input
                className={FIELD}
                placeholder="Credit ₹"
                value={line.credit}
                onChange={(e) => {
                  const next = [...jvLines];
                  next[i] = { ...line, credit: e.target.value };
                  setJvLines(next);
                }}
              />
              <input
                className={FIELD}
                placeholder="Line narration"
                value={line.narration}
                onChange={(e) => {
                  const next = [...jvLines];
                  next[i] = { ...line, narration: e.target.value };
                  setJvLines(next);
                }}
              />
            </div>
          ))}
          <div className="flex gap-2">
            <button
              type="button"
              className={BTN_OUTLINE}
              onClick={() =>
                setJvLines([...jvLines, { coaId: "", debit: "", credit: "", narration: "" }])
              }
            >
              + Line
            </button>
            <button type="button" className={BTN} onClick={postJv}>
              Post journal
            </button>
          </div>
          <h4 className="text-sm font-semibold text-[var(--brand-deep)]">Recent journals</h4>
          <ul className="text-sm text-[var(--muted)]">
            {journals.map((j) => (
              <li key={j.id}>
                {j.date} · {j.narration || j.sourceType} · {j.lines.length} line(s)
              </li>
            ))}
          </ul>
        </section>
      ) : null}

      {view === "tb" ? (
        <section className={CARD}>
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">As of</span>
            <input type="date" className={FIELD} value={tbAsOf} onChange={(e) => setTbAsOf(e.target.value)} />
          </label>
          <ErpTable minWidth="min-w-full" className="mt-3">
            <ErpTableHead>
              <tr>
                <th className="pb-2">Code</th>
                <th className="pb-2">Account</th>
                <th className="pb-2 text-right">Debit</th>
                <th className="pb-2 text-right">Credit</th>
                <th className="pb-2 text-right">Balance</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {tb.filter((r) => r.debitPaise || r.creditPaise).map((r) => (
                <tr key={r.coaId}>
                  <td className="py-2">{r.code}</td>
                  <td className="py-2">{r.name}</td>
                  <td className="py-2 text-right">{formatInr(r.debitPaise)}</td>
                  <td className="py-2 text-right">{formatInr(r.creditPaise)}</td>
                  <td className="py-2 text-right">{formatInr(Math.abs(r.balancePaise))}</td>
                </tr>
              ))}
            </ErpTableBody>
          </ErpTable>
        </section>
      ) : null}

      {view === "pl" ? (
        <section className={CARD}>
          <div className="flex flex-wrap gap-2">
            <input type="date" className={FIELD} value={plFrom} onChange={(e) => setPlFrom(e.target.value)} />
            <input type="date" className={FIELD} value={plTo} onChange={(e) => setPlTo(e.target.value)} />
          </div>
          <div className="mt-3 grid gap-4 sm:grid-cols-2">
            <div>
              <h4 className="text-sm font-bold text-[var(--success)]">Income</h4>
              <ul className="mt-2 text-sm">
                {pl.incomeLines.map((l) => (
                  <li key={l.coaId} className="flex justify-between">
                    <span>{l.name}</span>
                    <span>{formatInr(l.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            </div>
            <div>
              <h4 className="text-sm font-bold text-[var(--danger)]">Expense</h4>
              <ul className="mt-2 text-sm">
                {pl.expenseLines.map((l) => (
                  <li key={l.coaId} className="flex justify-between">
                    <span>{l.name}</span>
                    <span>{formatInr(l.amountPaise)}</span>
                  </li>
                ))}
              </ul>
            </div>
          </div>
          <div className="mt-4 text-lg font-bold">
            Net: {formatInr(pl.netProfitPaise)}
          </div>
        </section>
      ) : null}

      {view === "bs" ? (
        <section className={CARD}>
          <input type="date" className={FIELD} value={bsAsOf} onChange={(e) => setBsAsOf(e.target.value)} />
          <div className="mt-3 grid gap-4 sm:grid-cols-3 text-sm">
            <div>
              <h4 className="font-bold">Assets</h4>
              <p>Cash: {formatInr(bs.assets.cashPaise)}</p>
              <p>Bank: {formatInr(bs.assets.bankPaise)}</p>
              <p>Other: {formatInr(bs.assets.otherAssetsPaise)}</p>
              <p className="font-semibold">Total: {formatInr(bs.assets.totalPaise)}</p>
            </div>
            <div>
              <h4 className="font-bold">Liabilities</h4>
              <p>{formatInr(bs.liabilities.totalPaise)}</p>
            </div>
            <div>
              <h4 className="font-bold">Equity</h4>
              <p>Capital: {formatInr(bs.equity.capitalPaise)}</p>
              <p>Retained: {formatInr(bs.equity.retainedEarningsPaise)}</p>
              <p className="font-semibold">Total L+E: {formatInr(bs.totalLiabilitiesAndEquityPaise)}</p>
            </div>
          </div>
          <p className="mt-3 text-xs text-[var(--muted)]">
            {bs.balanced ? "Books balanced" : "Out of balance — review journals"}
          </p>
        </section>
      ) : null}
    </div>
  );
}

export function DayCloseAccountsPanel({
  onRefresh,
  onFlash,
  actorName,
  tick = 0,
}: AccountsPanelProps) {
  function handleChanged() {
    const approved = listDayCloses().find((d) => d.status === "approved");
    if (approved) {
      applyDayCloseHandover({
        id: approved.id,
        closeDate: approved.closeDate,
        systemCashPaise: approved.systemCashPaise,
        physicalCashPaise: approved.physicalCashPaise,
      });
    }
    onRefresh();
    onFlash("Day close updated");
  }

  return (
    <div className="mt-4 space-y-4">
      <div className={`${CARD} text-sm text-[var(--muted)]`}>
        Approve cashier day close here. Fee collections are recorded in{" "}
        <Link href="/fees" className="font-semibold text-[var(--brand-deep)] underline">
          Fee Take
        </Link>
        . Approving posts counter cash to the main cash pool (drawer → main).
        Fee cash is auto-posted to the drawer on each Fee Take receipt.
      </div>
      <DayClosePanel
        tick={tick}
        cashierName={actorName}
        onChanged={handleChanged}
        onOpenReceipt={() => {}}
      />
    </div>
  );
}

export function ReportsPanel({
  state,
  onFlash,
  onError,
}: AccountsPanelProps) {
  const [date, setDate] = useState(todayIso());
  const [fromDate, setFromDate] = useState(`${todayIso().slice(0, 7)}-01`);
  const [toDate, setToDate] = useState(todayIso());
  const [asOf, setAsOf] = useState(todayIso());
  const [coaId, setCoaId] = useState(state.coaAccounts[0]?.id ?? "");
  const [format, setFormat] = useState<AccountsReportFormat>("excel");
  const [tallyDate, setTallyDate] = useState(todayIso());

  function run(id: AccountsReportId) {
    const result = runAccountsReport(id, {
      date,
      fromDate,
      toDate,
      asOf,
      coaId,
      format,
      accounts: state,
    });
    if (!result.ok) {
      onError(result.error);
      return;
    }
    onFlash(result.message);
  }

  function tallyCsv() {
    const r = exportAccountsTallyCsv(tallyDate);
    if (!r.ok) onError(r.error);
    else onFlash(r.message);
  }

  function tallyXml() {
    const r = exportAccountsTallyXml(tallyDate);
    if (!r.ok) onError(r.error);
    else onFlash(r.message);
  }

  return (
    <div className="mt-4 space-y-4">
      <div className={`${CARD} grid gap-3 sm:grid-cols-3 lg:grid-cols-6`}>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Date</span>
          <input type="date" className={FIELD} value={date} onChange={(e) => setDate(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">From</span>
          <input type="date" className={FIELD} value={fromDate} onChange={(e) => setFromDate(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">To</span>
          <input type="date" className={FIELD} value={toDate} onChange={(e) => setToDate(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">As of</span>
          <input type="date" className={FIELD} value={asOf} onChange={(e) => setAsOf(e.target.value)} />
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">
            Ledger account
          </span>
          <select
            className={FIELD}
            value={coaId}
            onChange={(e) => setCoaId(e.target.value)}
          >
            {state.coaAccounts
              .filter((c) => c.isActive)
              .sort((a, b) => a.code.localeCompare(b.code))
              .map((c) => (
                <option key={c.id} value={c.id}>
                  {c.code} · {c.name}
                </option>
              ))}
          </select>
        </label>
        <label className="text-sm">
          <span className="mb-1 block text-[11px] text-[var(--muted)]">Format</span>
          <select className={FIELD} value={format} onChange={(e) => setFormat(e.target.value as AccountsReportFormat)}>
            <option value="excel">Excel</option>
            <option value="pdf">PDF</option>
          </select>
        </label>
      </div>

      <section className={`${CARD} space-y-3`}>
        <h3 className="text-sm font-bold text-[var(--brand-deep)]">
          Tally export (day JV)
        </h3>
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-sm">
            <span className="mb-1 block text-[11px] text-[var(--muted)]">Date</span>
            <input type="date" className={FIELD} value={tallyDate} onChange={(e) => setTallyDate(e.target.value)} />
          </label>
          <button type="button" className={BTN_OUTLINE} onClick={tallyCsv}>
            Tally CSV
          </button>
          <button type="button" className={BTN_OUTLINE} onClick={tallyXml}>
            Tally XML
          </button>
        </div>
      </section>

      <div className="grid gap-4 lg:grid-cols-2">
        {ACCOUNTS_REPORT_CATEGORIES.map((category) => (
          <section
            key={category.id}
            className="overflow-hidden rounded-xl border border-[var(--border)] bg-[var(--card)]"
          >
            <h2 className={`${category.headerClass} px-4 py-3 text-sm font-bold text-white`}>
              {category.title}
            </h2>
            <ul className="divide-y divide-[var(--border)] px-4">
              {ACCOUNTS_REPORTS.filter((r) => r.category === category.id).map(
                (report) => (
                  <li
                    key={report.id}
                    className="flex items-center justify-between gap-3 py-3"
                  >
                    <div>
                      <div className="text-sm font-semibold text-[var(--brand-deep)]">
                        {report.label}
                      </div>
                      {report.hint ? (
                        <div className="text-[10px] text-[var(--muted)]">
                          {report.hint}
                        </div>
                      ) : null}
                    </div>
                    <button type="button" className={BTN_OUTLINE} onClick={() => run(report.id)}>
                      Run
                    </button>
                  </li>
                ),
              )}
            </ul>
          </section>
        ))}
      </div>
    </div>
  );
}
