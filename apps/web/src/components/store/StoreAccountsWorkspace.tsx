"use client";

import { useEffect, useMemo, useState } from "react";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
} from "@/components/ui/erp-roster";
import { ErpSortTh, useTableSort } from "@/components/ui/erp-table-sort";
import { payUnifiedPayable } from "@/lib/accountsPayables";
import {
  loadAccounts,
  seedAccountsIfEmpty,
} from "@/lib/accountsStore";
import type {
  AccountsPayable,
  AccountsVendor,
  PaymentMode,
  VendorBill,
} from "@/lib/accountsTypes";
import { vendorBillBalancePaise } from "@/lib/accountsVendors";
import { formatInr, loadFees, paidByDueKey } from "@/lib/fees";
import { loadMasters, type MastersState } from "@/lib/masters";
import {
  createPurchaseReturn,
  loadPurchase,
  purchaseReturnedQtyByGrnLine,
  seedPurchaseIfEmpty,
  type Grn,
  type PurchaseReturn,
} from "@/lib/purchase";
import { loadSis } from "@/lib/sis";
import {
  createStoreSellReturn,
  loadStore,
  returnedQtyByItem,
  salesDayBook,
  seedStoreIfEmpty,
  storeDueKey,
  storeIssueNetBilledPaise,
  type StoreIssue,
  type StoreSellReturn,
} from "@/lib/store";
import {
  runStoreReport,
  type StoreReportFormat,
  type StoreReportId,
} from "@/lib/storeReportCatalog";
import { useDemoSession } from "@/components/shell/SessionContext";
import { ModuleTabs } from "@/components/ui/ModuleTabs";
import { StoreReportsPanel } from "@/components/store/StoreReportsPanel";
import { btn, btnOutline, field } from "@/components/ui/erp-ui";

type AcctSub =
  | "vendor_pay"
  | "vendor_ledger"
  | "sales_dues"
  | "purchase_return"
  | "sell_return"
  | "exports";

const card = "rounded-xl border border-[var(--border)] bg-[var(--card)] p-4";
function todayIso() {
  return new Date().toISOString().slice(0, 10);
}

export function StoreAccountsWorkspace() {
  const session = useDemoSession();
  const [sub, setSub] = useState<AcctSub>("vendor_pay");
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const [tick, setTick] = useState(0);

  const [bills, setBills] = useState<VendorBill[]>([]);
  const [payables, setPayables] = useState<AccountsPayable[]>([]);
  const [vendors, setVendors] = useState<AccountsVendor[]>([]);
  const [grns, setGrns] = useState<Grn[]>([]);
  const [purchaseReturns, setPurchaseReturns] = useState<PurchaseReturn[]>([]);
  const [issues, setIssues] = useState<StoreIssue[]>([]);
  const [sellReturns, setSellReturns] = useState<StoreSellReturn[]>([]);
  const [masters, setMasters] = useState<MastersState | null>(null);
  const [cashPools, setCashPools] = useState<
    { id: string; name: string; code: string }[]
  >([]);
  const [banks, setBanks] = useState<{ id: string; name: string }[]>([]);

  const [payBillId, setPayBillId] = useState("");
  const [payAmount, setPayAmount] = useState("");
  const [payMode, setPayMode] = useState<"cash" | "bank">("bank");
  const [payBankMode, setPayBankMode] = useState<PaymentMode>("neft");
  const [payPoolId, setPayPoolId] = useState("");
  const [payBankId, setPayBankId] = useState("");
  const [payDate, setPayDate] = useState(todayIso);

  const [ledgerVendorId, setLedgerVendorId] = useState("");

  const [retGrnId, setRetGrnId] = useState("");
  const [retQty, setRetQty] = useState<Record<string, string>>({});
  const [retNote, setRetNote] = useState("");
  const [retDate, setRetDate] = useState(todayIso);

  const [sellIssueId, setSellIssueId] = useState("");
  const [sellQty, setSellQty] = useState<Record<string, string>>({});
  const [sellNote, setSellNote] = useState("");
  const [sellDate, setSellDate] = useState(todayIso);

  const [reportDate, setReportDate] = useState(todayIso);
  const [reportRunning, setReportRunning] = useState<string | null>(null);

  function flash(msg: string) {
    setNotice(msg);
    setError(null);
    window.setTimeout(() => setNotice(null), 2800);
  }

  function refresh() {
    seedAccountsIfEmpty();
    seedPurchaseIfEmpty();
    seedStoreIfEmpty();
    const acc = loadAccounts();
    const purchase = loadPurchase();
    const store = loadStore();
    setBills(acc.vendorBills);
    setPayables(acc.payables);
    setVendors(acc.vendors.filter((v) => v.isActive !== false));
    setCashPools(
      acc.cashPools.map((p) => ({ id: p.id, name: p.name, code: p.code })),
    );
    setBanks(
      acc.bankAccounts
        .filter((b) => b.isActive !== false)
        .map((b) => ({ id: b.id, name: b.name })),
    );
    setGrns(purchase.grns);
    setPurchaseReturns(purchase.returns ?? []);
    setIssues(
      store.issues
        .filter((i) => !i.voidedAt)
        .sort((a, b) => b.issuedOn.localeCompare(a.issuedOn)),
    );
    setSellReturns(store.sellReturns ?? []);
    setMasters(loadMasters());
    if (!payPoolId && acc.cashPools[0]) setPayPoolId(acc.cashPools[0].id);
    if (!payBankId && acc.bankAccounts[0]) setPayBankId(acc.bankAccounts[0].id);
    setTick((t) => t + 1);
  }

  useEffect(() => {
    refresh();
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const openBills = useMemo(
    () =>
      bills
        .filter((b) => vendorBillBalancePaise(b) > 0)
        .sort((a, b) => a.dueOn.localeCompare(b.dueOn)),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [bills, tick],
  );

  // openBills already arrives due-date first; that stays the default and the
  // headers let a clerk re-order from there.
  const billSort = useTableSort(
    openBills,
    {
      vendor: (b) => vendors.find((x) => x.id === b.vendorId)?.name || null,
      receipt: (b) => b.receiptNo || b.billNo || null,
      due: (b) => b.dueOn || null,
      bill: (b) => b.amountPaise,
      paid: (b) => b.paidPaise,
      balance: (b) => vendorBillBalancePaise(b),
    },
    "due",
  );

  const selectedBill = bills.find((b) => b.id === payBillId);
  const selectedPayable = payables.find(
    (p) => p.sourceType === "expense_bill" && p.sourceId === payBillId,
  );

  const ledgerRows = useMemo(() => {
    const vendorId = ledgerVendorId || vendors[0]?.id || "";
    if (!vendorId) return [];
    return bills
      .filter((b) => b.vendorId === vendorId)
      .map((b) => {
        const grn = grns.find((g) => g.vendorBillId === b.id);
        const returns = purchaseReturns.filter((r) => r.vendorBillId === b.id);
        const returnPaise = returns.reduce((s, r) => s + r.amountPaise, 0);
        return {
          bill: b,
          grnNo: grn?.grnNo || "—",
          returnPaise,
          balance: vendorBillBalancePaise(b),
        };
      });
  }, [ledgerVendorId, vendors, bills, grns, purchaseReturns]);

  const unpaidDues = useMemo(() => {
    const fees = loadFees();
    const paidMap = paidByDueKey(fees);
    const rows: {
      issue: StoreIssue;
      billed: number;
      paid: number;
      balance: number;
    }[] = [];
    for (const iss of issues) {
      if (iss.paymentMode !== "credit" || iss.paymentStatus === "void") continue;
      if (iss.recipientKind === "staff") continue;
      const billed = storeIssueNetBilledPaise(iss);
      const paid = paidMap.get(storeDueKey(iss.studentId, iss.id)) ?? 0;
      const balance = Math.max(0, billed - paid);
      if (balance <= 0) continue;
      rows.push({ issue: iss, billed, paid, balance });
    }
    return rows;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [issues, tick]);

  const salesToday = useMemo(
    () => salesDayBook(reportDate, loadStore()),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [reportDate, tick],
  );

  const retGrn = grns.find((g) => g.id === retGrnId);
  const retAlready = retGrn
    ? purchaseReturnedQtyByGrnLine(retGrn.id)
    : new Map<string, number>();

  const sellIssue = issues.find((i) => i.id === sellIssueId);
  const sellAlready = sellIssue
    ? returnedQtyByItem(sellIssue.id)
    : new Map<string, number>();

  function onPayVendor() {
    if (!selectedBill || !selectedPayable) {
      setError("Pick a vendor bill with an open payable");
      return;
    }
    const remaining = vendorBillBalancePaise(selectedBill);
    const amountPaise = Math.round(Number(payAmount || "0") * 100);
    if (amountPaise <= 0) {
      setError("Enter payment amount");
      return;
    }
    if (amountPaise > remaining) {
      setError(`Amount exceeds balance ${formatInr(remaining)}`);
      return;
    }
    const r = payUnifiedPayable(selectedPayable.id, {
      date: payDate,
      mode: payMode,
      poolId: payPoolId,
      bankId: payBankId,
      bankMode: payBankMode,
      amountPaise,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setPayAmount("");
    refresh();
    flash(
      `Paid ${formatInr(amountPaise)} · bill ${selectedBill.billNo || selectedBill.receiptNo}`,
    );
  }

  function onPurchaseReturn() {
    if (!retGrn) {
      setError("Pick a GRN");
      return;
    }
    const lines = retGrn.lines
      .map((l) => ({
        grnLineId: l.id,
        qty: Math.floor(Number(retQty[l.id] || "0") || 0),
      }))
      .filter((l) => l.qty > 0);
    const r = createPurchaseReturn({
      grnId: retGrn.id,
      date: retDate,
      note: retNote,
      createdBy: session.fullName,
      lines,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setRetQty({});
    setRetNote("");
    refresh();
    flash(
      `Purchase return ${r.purchaseReturn.returnNo} · ${formatInr(r.purchaseReturn.amountPaise)} credited to vendor`,
    );
  }

  function onSellReturn() {
    if (!sellIssue) {
      setError("Pick an issue / sale");
      return;
    }
    const lines = sellIssue.lines
      .map((l) => ({
        itemId: l.itemId,
        qty: Math.floor(Number(sellQty[l.itemId] || "0") || 0),
      }))
      .filter((l) => l.qty > 0);
    const r = createStoreSellReturn({
      issueId: sellIssue.id,
      returnedOn: sellDate,
      note: sellNote,
      createdBy: session.fullName,
      lines,
    });
    if (!r.ok) {
      setError(r.error);
      return;
    }
    setSellQty({});
    setSellNote("");
    refresh();
    flash(
      `Sell return ${r.sellReturn.returnNo} · ${formatInr(r.sellReturn.totalPaise)} credited · stock restored`,
    );
  }

  function onRunReport(id: StoreReportId, format: StoreReportFormat) {
    const key = `${id}:${format}`;
    setReportRunning(key);
    const result = runStoreReport(id, {
      date: reportDate,
      format,
      masters: masters ?? undefined,
      sis: loadSis(),
    });
    setReportRunning(null);
    if (!result.ok) {
      setError(result.error);
      return;
    }
    flash(result.message);
  }

  const classOptions = useMemo(
    () => (masters?.classes ?? []).map((c) => ({ id: c.id, name: c.name })),
    [masters],
  );

  return (
    <div className="mt-4 space-y-4">
      {error ? (
        <p className="rounded-lg bg-[var(--danger-soft)] px-3 py-2 text-sm text-[var(--danger)]">
          {error}
        </p>
      ) : null}
      {notice ? (
        <p className="rounded-lg bg-[var(--surface-sunken)] px-3 py-2 text-sm text-[var(--brand-deep)]">
          {notice}
        </p>
      ) : null}

      <ModuleTabs
        aria-label="Store accounts"
        value={sub}
        onChange={(id) => setSub(id as AcctSub)}
        size="md"
        className="!mt-0"
        items={[
          { id: "vendor_pay", label: "Vendor payment", tone: "sky" },
          { id: "vendor_ledger", label: "Vendor account", tone: "navy" },
          { id: "sales_dues", label: "Sales & dues", tone: "teal" },
          { id: "purchase_return", label: "Purchase return", tone: "coral" },
          { id: "sell_return", label: "Sell return", tone: "amber" },
          { id: "exports", label: "Export reports", tone: "green" },
        ]}
      />

      <p className="text-[11px] text-[var(--muted)]">
        Postings sync to{" "}
        <a href="/accounts" className="font-semibold text-[var(--brand-deep)] underline">
          Accounts
        </a>{" "}
        — cashbook, day book, trial balance, P&amp;L and balance sheet (Store
        Sales · AR · Purchases · AP).
      </p>

      {sub === "vendor_pay" ? (
        <div className="space-y-4">
          <div className={card}>
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Pay vendor against purchase bill
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              Partial payments supported · updates bill status (open / partial /
              paid) and cash/bank ledger.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Open bill
                </span>
                <select
                  className={`${field} min-w-[280px]`}
                  value={payBillId}
                  onChange={(e) => {
                    setPayBillId(e.target.value);
                    const b = bills.find((x) => x.id === e.target.value);
                    if (b) {
                      setPayAmount(String(vendorBillBalancePaise(b) / 100));
                    }
                  }}
                >
                  <option value="">Pick bill</option>
                  {openBills.map((b) => {
                    const v = vendors.find((x) => x.id === b.vendorId);
                    return (
                      <option key={b.id} value={b.id}>
                        {v?.name || "Vendor"} · {b.receiptNo || b.billNo} · due{" "}
                        {formatInr(vendorBillBalancePaise(b))}
                      </option>
                    );
                  })}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Amount ₹
                </span>
                <input
                  className={`${field} w-28`}
                  type="number"
                  min={0}
                  step="0.01"
                  value={payAmount}
                  onChange={(e) => setPayAmount(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Date
                </span>
                <input
                  type="date"
                  className={field}
                  value={payDate}
                  onChange={(e) => setPayDate(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Mode
                </span>
                <select
                  className={field}
                  value={payMode}
                  onChange={(e) =>
                    setPayMode(e.target.value as "cash" | "bank")
                  }
                >
                  <option value="cash">Cash</option>
                  <option value="bank">Bank</option>
                </select>
              </label>
              {payMode === "cash" ? (
                <label className="text-sm">
                  <span className="mb-1 block text-[11px] text-[var(--muted)]">
                    Cash pool
                  </span>
                  <select
                    className={field}
                    value={payPoolId}
                    onChange={(e) => setPayPoolId(e.target.value)}
                  >
                    {cashPools.map((p) => (
                      <option key={p.id} value={p.id}>
                        {p.name}
                      </option>
                    ))}
                  </select>
                </label>
              ) : (
                <>
                  <label className="text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Bank
                    </span>
                    <select
                      className={field}
                      value={payBankId}
                      onChange={(e) => setPayBankId(e.target.value)}
                    >
                      {banks.map((b) => (
                        <option key={b.id} value={b.id}>
                          {b.name}
                        </option>
                      ))}
                    </select>
                  </label>
                  <label className="text-sm">
                    <span className="mb-1 block text-[11px] text-[var(--muted)]">
                      Bank mode
                    </span>
                    <select
                      className={field}
                      value={payBankMode}
                      onChange={(e) =>
                        setPayBankMode(e.target.value as PaymentMode)
                      }
                    >
                      <option value="neft">NEFT</option>
                      <option value="upi">UPI</option>
                      <option value="cheque">Cheque</option>
                      <option value="card">Card</option>
                    </select>
                  </label>
                </>
              )}
              <button
                type="button"
                className={btn}
                disabled={!payBillId}
                onClick={onPayVendor}
              >
                Record payment
              </button>
            </div>
            {selectedBill ? (
              <p className="mt-2 text-[11px] text-[var(--muted)]">
                Bill {formatInr(selectedBill.amountPaise)} · paid{" "}
                {formatInr(selectedBill.paidPaise)} · balance{" "}
                <strong className="text-[var(--brand-deep)]">
                  {formatInr(vendorBillBalancePaise(selectedBill))}
                </strong>{" "}
                · status {selectedBill.status}
              </p>
            ) : null}
          </div>

          <div className={card}>
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              Open purchase payables
            </h3>
            <div className="mt-3 overflow-x-auto">
              <ErpTable minWidth="min-w-[640px]">
                <ErpTableHead>
                  <tr className="text-[11px] uppercase text-[var(--muted)]">
                    <ErpSortTh sort={billSort} field="vendor">Vendor</ErpSortTh>
                    <ErpSortTh sort={billSort} field="receipt">
                      Receipt / invoice
                    </ErpSortTh>
                    <ErpSortTh sort={billSort} field="due">Due</ErpSortTh>
                    <ErpSortTh sort={billSort} field="bill" align="right">Bill</ErpSortTh>
                    <ErpSortTh sort={billSort} field="paid" align="right">Paid</ErpSortTh>
                    <ErpSortTh sort={billSort} field="balance" align="right">
                      Balance
                    </ErpSortTh>
                  </tr>
                </ErpTableHead>
                <ErpTableBody hoverable>
                  {openBills.length === 0 ? (
                    <tr>
                      <td colSpan={6} className="py-6 text-[var(--muted)]">
                        No open vendor bills.
                      </td>
                    </tr>
                  ) : (
                    billSort.rows.map((b) => {
                      const v = vendors.find((x) => x.id === b.vendorId);
                      return (
                        <tr
                          key={b.id}
                          className="cursor-pointer"
                          onClick={() => {
                            setPayBillId(b.id);
                            setPayAmount(
                              String(vendorBillBalancePaise(b) / 100),
                            );
                          }}
                        >
                          <td className="py-2 pr-3">{v?.name || "—"}</td>
                          <td className="py-2 pr-3">
                            {b.receiptNo || b.billNo || "—"}
                          </td>
                          <td className="py-2 pr-3">{b.dueOn}</td>
                          <td className="py-2 pr-3 text-right">
                            {formatInr(b.amountPaise)}
                          </td>
                          <td className="py-2 pr-3 text-right">
                            {formatInr(b.paidPaise)}
                          </td>
                          <td className="py-2 text-right font-semibold">
                            {formatInr(vendorBillBalancePaise(b))}
                          </td>
                        </tr>
                      );
                    })
                  )}
                </ErpTableBody>
              </ErpTable>
            </div>
          </div>
        </div>
      ) : null}

      {sub === "vendor_ledger" ? (
        <div className={card}>
          <div className="flex flex-wrap items-end gap-3">
            <label className="text-sm">
              <span className="mb-1 block text-[11px] text-[var(--muted)]">
                Vendor
              </span>
              <select
                className={`${field} min-w-[220px]`}
                value={ledgerVendorId || vendors[0]?.id || ""}
                onChange={(e) => setLedgerVendorId(e.target.value)}
              >
                {vendors.map((v) => (
                  <option key={v.id} value={v.id}>
                    {v.name}
                  </option>
                ))}
              </select>
            </label>
          </div>
          <div className="mt-4 overflow-x-auto">
            <ErpTable minWidth="min-w-[700px]">
              <ErpTableHead>
                <tr className="text-[11px] uppercase text-[var(--muted)]">
                  <th className="py-2 pr-3">Date</th>
                  <th className="py-2 pr-3">GRN</th>
                  <th className="py-2 pr-3">Invoice</th>
                  <th className="py-2 pr-3 text-right">Original</th>
                  <th className="py-2 pr-3 text-right">Returns</th>
                  <th className="py-2 pr-3 text-right">Net bill</th>
                  <th className="py-2 pr-3 text-right">Paid</th>
                  <th className="py-2 text-right">Balance</th>
                </tr>
              </ErpTableHead>
              <ErpTableBody>
                {ledgerRows.length === 0 ? (
                  <tr>
                    <td colSpan={8} className="py-6 text-[var(--muted)]">
                      No bills for this vendor.
                    </td>
                  </tr>
                ) : (
                  ledgerRows.map(({ bill: b, grnNo, returnPaise, balance }) => (
                    <tr key={b.id}>
                      <td className="py-2 pr-3">{b.billDate}</td>
                      <td className="py-2 pr-3">{grnNo}</td>
                      <td className="py-2 pr-3">
                        {b.supplierInvoiceNo || b.billNo || "—"}
                        <span className="ml-1 text-[10px] text-[var(--muted)]">
                          ({b.status})
                        </span>
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {formatInr(b.amountPaise + returnPaise)}
                      </td>
                      <td className="py-2 pr-3 text-right text-[#c2410c]">
                        {returnPaise ? `−${formatInr(returnPaise)}` : "—"}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {formatInr(b.amountPaise)}
                      </td>
                      <td className="py-2 pr-3 text-right">
                        {formatInr(b.paidPaise)}
                      </td>
                      <td className="py-2 text-right font-semibold">
                        {formatInr(balance)}
                      </td>
                    </tr>
                  ))
                )}
              </ErpTableBody>
            </ErpTable>
          </div>
        </div>
      ) : null}

      {sub === "sales_dues" ? (
        <div className="space-y-4">
          <div className={card}>
            <div className="flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Sales date
                </span>
                <input
                  type="date"
                  className={field}
                  value={reportDate}
                  onChange={(e) => setReportDate(e.target.value)}
                />
              </label>
            </div>
            <h3 className="mt-4 text-sm font-bold text-[var(--brand-deep)]">
              Sales day book · {reportDate}
            </h3>
            <ul className="mt-2 divide-y text-sm">
              {salesToday.length === 0 ? (
                <li className="py-3 text-[var(--muted)]">No sales this day.</li>
              ) : (
                salesToday.map((row) => (
                  <li
                    key={row.issueNo}
                    className="flex justify-between gap-2 py-2"
                  >
                    <span>
                      {row.issueNo} · {row.paymentMode}/{row.paymentStatus}
                      {row.itemCount ? ` · ${row.itemCount} items` : ""}
                    </span>
                    <span className="font-semibold">
                      {formatInr(row.totalPaise)}
                    </span>
                  </li>
                ))
              )}
            </ul>
          </div>
          <div className={card}>
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              Unpaid credit dues (after returns)
            </h3>
            <div className="mt-3 overflow-x-auto">
              <ErpTable minWidth="min-w-[640px]">
                <ErpTableHead>
                  <tr className="text-[11px] uppercase text-[var(--muted)]">
                    <th className="py-2 pr-3">Issue</th>
                    <th className="py-2 pr-3">Date</th>
                    <th className="py-2 pr-3 text-right">Billed</th>
                    <th className="py-2 pr-3 text-right">Paid</th>
                    <th className="py-2 text-right">Balance</th>
                  </tr>
                </ErpTableHead>
                <ErpTableBody>
                  {unpaidDues.length === 0 ? (
                    <tr>
                      <td colSpan={5} className="py-6 text-[var(--muted)]">
                        No unpaid store dues.
                      </td>
                    </tr>
                  ) : (
                    unpaidDues.map((r) => (
                      <tr key={r.issue.id}>
                        <td className="py-2 pr-3">{r.issue.issueNo}</td>
                        <td className="py-2 pr-3">{r.issue.issuedOn}</td>
                        <td className="py-2 pr-3 text-right">
                          {formatInr(r.billed)}
                          {r.issue.returnedPaise ? (
                            <span className="ml-1 text-[10px] text-[#c2410c]">
                              (−{formatInr(r.issue.returnedPaise)})
                            </span>
                          ) : null}
                        </td>
                        <td className="py-2 pr-3 text-right">
                          {formatInr(r.paid)}
                        </td>
                        <td className="py-2 text-right font-semibold">
                          {formatInr(r.balance)}
                        </td>
                      </tr>
                    ))
                  )}
                </ErpTableBody>
              </ErpTable>
            </div>
          </div>
        </div>
      ) : null}

      {sub === "purchase_return" ? (
        <div className="space-y-4">
          <div className={card}>
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Return items to vendor
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              Stock reduced · vendor bill &amp; payable auto-credited · due
              recalculated.
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  GRN
                </span>
                <select
                  className={`${field} min-w-[240px]`}
                  value={retGrnId}
                  onChange={(e) => {
                    setRetGrnId(e.target.value);
                    setRetQty({});
                  }}
                >
                  <option value="">Pick GRN</option>
                  {grns
                    .filter((g) => g.vendorBillId)
                    .map((g) => (
                      <option key={g.id} value={g.id}>
                        {g.grnNo} · {g.date}
                      </option>
                    ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Date
                </span>
                <input
                  type="date"
                  className={field}
                  value={retDate}
                  onChange={(e) => setRetDate(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Note
                </span>
                <input
                  className={`${field} min-w-[160px]`}
                  value={retNote}
                  onChange={(e) => setRetNote(e.target.value)}
                />
              </label>
              <button
                type="button"
                className={btn}
                disabled={!retGrnId}
                onClick={onPurchaseReturn}
              >
                Post return
              </button>
            </div>
            {retGrn ? (
              <ul className="mt-4 divide-y text-sm">
                {retGrn.lines.map((l) => {
                  const left = l.qtyReceived - (retAlready.get(l.id) ?? 0);
                  return (
                    <li
                      key={l.id}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span>
                        {l.description} · recv {l.qtyReceived} · left {left}
                      </span>
                      <input
                        className={`${field} w-20`}
                        type="number"
                        min={0}
                        max={left}
                        disabled={left <= 0}
                        value={retQty[l.id] ?? ""}
                        onChange={(e) =>
                          setRetQty((q) => ({ ...q, [l.id]: e.target.value }))
                        }
                        placeholder="Qty"
                      />
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
          <div className={card}>
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              Recent purchase returns
            </h3>
            <ul className="mt-2 divide-y text-sm">
              {purchaseReturns.slice(0, 20).map((r) => (
                <li key={r.id} className="flex justify-between py-2">
                  <span>
                    {r.returnNo} · {r.date} · {r.note || "—"}
                  </span>
                  <span className="font-semibold text-[#c2410c]">
                    −{formatInr(r.amountPaise)}
                  </span>
                </li>
              ))}
              {!purchaseReturns.length ? (
                <li className="py-3 text-[var(--muted)]">No returns yet.</li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}

      {sub === "sell_return" ? (
        <div className="space-y-4">
          <div className={card}>
            <h2 className="text-sm font-bold text-[var(--brand-deep)]">
              Student / staff return sold items
            </h2>
            <p className="mt-0.5 text-[11px] text-[var(--muted)]">
              Stock restored · credit due reduced automatically (Fee Take billed
              = sale − returns).
            </p>
            <div className="mt-3 flex flex-wrap items-end gap-3">
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Issue / sale
                </span>
                <select
                  className={`${field} min-w-[280px]`}
                  value={sellIssueId}
                  onChange={(e) => {
                    setSellIssueId(e.target.value);
                    setSellQty({});
                  }}
                >
                  <option value="">Pick issue</option>
                  {issues.slice(0, 80).map((iss) => (
                    <option key={iss.id} value={iss.id}>
                      {iss.issueNo} · {iss.issuedOn} ·{" "}
                      {formatInr(iss.totalPaise)}
                      {iss.returnedPaise
                        ? ` (−${formatInr(iss.returnedPaise)})`
                        : ""}
                    </option>
                  ))}
                </select>
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Date
                </span>
                <input
                  type="date"
                  className={field}
                  value={sellDate}
                  onChange={(e) => setSellDate(e.target.value)}
                />
              </label>
              <label className="text-sm">
                <span className="mb-1 block text-[11px] text-[var(--muted)]">
                  Note
                </span>
                <input
                  className={`${field} min-w-[160px]`}
                  value={sellNote}
                  onChange={(e) => setSellNote(e.target.value)}
                />
              </label>
              <button
                type="button"
                className={btn}
                disabled={!sellIssueId}
                onClick={onSellReturn}
              >
                Post return
              </button>
            </div>
            {sellIssue ? (
              <ul className="mt-4 divide-y text-sm">
                {sellIssue.lines.map((l) => {
                  const left = l.qty - (sellAlready.get(l.itemId) ?? 0);
                  return (
                    <li
                      key={l.itemId}
                      className="flex flex-wrap items-center justify-between gap-2 py-2"
                    >
                      <span>
                        {l.name}
                        {l.sizeLabel ? ` ${l.sizeLabel}` : ""} · sold {l.qty} ·
                        left {left} · {formatInr(l.unitPricePaise)}
                      </span>
                      <input
                        className={`${field} w-20`}
                        type="number"
                        min={0}
                        max={left}
                        disabled={left <= 0}
                        value={sellQty[l.itemId] ?? ""}
                        onChange={(e) =>
                          setSellQty((q) => ({
                            ...q,
                            [l.itemId]: e.target.value,
                          }))
                        }
                        placeholder="Qty"
                      />
                    </li>
                  );
                })}
              </ul>
            ) : null}
          </div>
          <div className={card}>
            <h3 className="text-sm font-bold text-[var(--brand-deep)]">
              Recent sell returns
            </h3>
            <ul className="mt-2 divide-y text-sm">
              {sellReturns.slice(0, 20).map((r) => (
                <li key={r.id} className="flex justify-between py-2">
                  <span>
                    {r.returnNo} · {r.returnedOn} · {r.note || "—"}
                  </span>
                  <span className="font-semibold text-[#c2410c]">
                    −{formatInr(r.totalPaise)}
                  </span>
                </li>
              ))}
              {!sellReturns.length ? (
                <li className="py-3 text-[var(--muted)]">No sell returns yet.</li>
              ) : null}
            </ul>
          </div>
        </div>
      ) : null}

      {sub === "exports" ? (
        <StoreReportsPanel
          categories={["sales"]}
          reportDate={reportDate}
          onReportDateChange={setReportDate}
          reportClassId=""
          onReportClassIdChange={() => {}}
          reportSkuId=""
          onReportSkuIdChange={() => {}}
          classOptions={classOptions}
          items={loadStore().items.filter((i) => i.isActive)}
          reportRunning={reportRunning}
          onRunReport={onRunReport}
        />
      ) : null}
    </div>
  );
}
