"use client";

/**
 * Reports — the module's front page and its four standing reports.
 *
 * Every figure is read at request time from the ledger and the documents that
 * produced it. Nothing here is a stored total that could drift away from what
 * it claims to summarise, which is why the dashboard and the reports can never
 * disagree with the stock card.
 */

import { useState } from "react";
import { Download, RefreshCw } from "lucide-react";
import { Button } from "@/components/ui/button";
import {
  ErpTable,
  ErpTableBody,
  ErpTableHead,
  ErpTableShell,
} from "@/components/ui/erp-roster";
import {
  FIELD_CLASS,
  InvAlert,
  InvSpinner,
  Pill,
  StatTile,
} from "@/components/inventory/InvUi";
import { invApi, useAsync } from "@/lib/inventory/client";
import { downloadExcelCsv } from "@/lib/reportExport";
import {
  formatPaise,
  formatQty,
  marginPct,
  saleStatusLabel,
  type InvBootstrap,
  type InvSaleStatus,
} from "@/lib/inventory/types";

type ReportId =
  | "dashboard"
  | "stock"
  | "margin"
  | "daybook"
  | "purchases"
  | "parity"
  | "repeats";

const REPORTS: { id: ReportId; label: string }[] = [
  { id: "dashboard", label: "Overview" },
  { id: "stock", label: "Stock register" },
  { id: "margin", label: "Item margin" },
  { id: "daybook", label: "Sales day book" },
  { id: "purchases", label: "Purchases by vendor" },
  { id: "parity", label: "Stock vs books" },
  { id: "repeats", label: "Bought twice" },
];

function monthStart(): string {
  return `${new Date().toISOString().slice(0, 7)}-01`;
}
function today(): string {
  return new Date().toISOString().slice(0, 10);
}

export function ReportsTab({ boot }: { boot: InvBootstrap }) {
  const [report, setReport] = useState<ReportId>("dashboard");
  const [from, setFrom] = useState(monthStart());
  const [to, setTo] = useState(today());
  const [locationId, setLocationId] = useState("");

  return (
    <div className="space-y-3">
      <div className="flex flex-wrap items-center gap-1.5">
        {REPORTS.map((r) => (
          <button
            key={r.id}
            type="button"
            onClick={() => setReport(r.id)}
            className={
              report === r.id
                ? "rounded-lg bg-foreground px-3 py-1.5 text-sm font-medium text-background"
                : "rounded-lg border px-3 py-1.5 text-sm hover:bg-muted"
            }
          >
            {r.label}
          </button>
        ))}
      </div>

      {report !== "dashboard" && report !== "stock" && report !== "parity" ? (
        <div className="flex flex-wrap items-end gap-2">
          <label className="text-xs">
            <span className="block text-muted-foreground">From</span>
            <input
              type="date"
              className={`${FIELD_CLASS} w-[150px]`}
              value={from}
              onChange={(e) => setFrom(e.target.value)}
            />
          </label>
          <label className="text-xs">
            <span className="block text-muted-foreground">To</span>
            <input
              type="date"
              className={`${FIELD_CLASS} w-[150px]`}
              value={to}
              onChange={(e) => setTo(e.target.value)}
            />
          </label>
        </div>
      ) : null}

      {report === "stock" ? (
        <select
          className={`${FIELD_CLASS} w-[180px]`}
          value={locationId}
          onChange={(e) => setLocationId(e.target.value)}
        >
          <option value="">All locations</option>
          {boot.locations
            .filter((l) => l.isActive)
            .map((l) => (
              <option key={l.id} value={l.id}>
                {l.name}
              </option>
            ))}
        </select>
      ) : null}

      {report === "dashboard" ? <Overview /> : null}
      {report === "stock" ? <StockRegister locationId={locationId} /> : null}
      {report === "margin" ? <MarginReport from={from} to={to} /> : null}
      {report === "daybook" ? <DayBook from={from} to={to} /> : null}
      {report === "purchases" ? <Purchases from={from} to={to} /> : null}
      {report === "parity" ? <InventoryParity /> : null}
      {report === "repeats" ? <RepeatPurchases /> : null}
    </div>
  );
}

/* ─── Closing stock ────────────────────────────────────────── */

/**
 * The period-end entry that brings unsold stock back onto the balance sheet.
 *
 * The copy here matters as much as the button: the natural expectation is that
 * every stock adjustment posts to the books, and under this chart it must not.
 * Saying so plainly is what stops someone "fixing" it later.
 */
/**
 * Does the ledger's Inventory balance match the stock on the shelf?
 *
 * Under perpetual inventory these two must agree at all times, because every
 * receipt, sale and write-off moves both together. A gap means an event moved
 * one without the other, so this is the check that catches it early — and the
 * screen says what to do rather than only showing a number.
 */
function InventoryParity() {
  const p = useAsync(() => invApi.inventoryParity(), []);
  const d = p.data;
  // With no chart of accounts the books are empty on purpose — sales skip
  // posting until the ledger is opened — so the whole stock value shows as a
  // difference. That is the designed state, not a drift to chase.
  const ledgerOff = d ? !d.ledgerActive : false;
  const agrees = d ? d.differencePaise === 0 : false;

  return (
    <div className="space-y-4">
      <InvAlert error={p.error} />

      <div className="grid gap-2 sm:grid-cols-3">
        <StatTile
          label="Stock on the shelf"
          value={d ? formatPaise(d.stockValuePaise) : "—"}
          sub="quantity × average cost"
        />
        <StatTile
          label="Inventory in the books"
          value={d ? formatPaise(d.ledgerValuePaise) : "—"}
          sub={ledgerOff ? "ledger not opened yet" : "account 1090"}
        />
        <StatTile
          label="Difference"
          value={d ? formatPaise(d.differencePaise) : "—"}
          tone={ledgerOff ? "neutral" : agrees ? "good" : "bad"}
          sub={
            ledgerOff
              ? "not a discrepancy — see below"
              : agrees
                ? "they agree"
                : "needs looking at"
          }
        />
      </div>

      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={p.reload}>
          <RefreshCw className="size-3.5" />
          Re-check
        </Button>
      </div>

      <div className="space-y-2 rounded-xl border p-3 text-sm">
        <h3 className="font-semibold">How stock reaches the books</h3>
        <div className="rounded-lg bg-muted/50 px-3 py-2 font-mono text-xs leading-relaxed">
          receiving{"      "}Dr Inventory{"        "}Cr Accounts Payable
          <br />
          selling{"        "}Dr Cost of Goods Sold{"  "}Cr Inventory
          <br />
          written off{"    "}Dr Stock Written Off{"  "}Cr Inventory
          <br />
          opening stock{"  "}Dr Inventory{"        "}Cr Corpus
        </div>
        <p className="text-muted-foreground">
          Goods are an asset from the moment they arrive until they are sold or
          lost, so these two figures move together and should never drift. A
          transfer between rooms posts nothing — value moving location is not an
          accounting event.
        </p>
      </div>

      {ledgerOff && d ? (
        <div className="rounded-xl border px-3 py-2 text-xs text-muted-foreground">
          The ledger has no chart of accounts yet, so nothing posts to account
          1090 and the books read zero. The difference above is simply the stock
          you hold, not a drift between two records. Open the ledger and seed its
          accounts, and these two figures start moving together.
        </div>
      ) : null}

      {!ledgerOff && !agrees && d ? (
        <div className="rounded-xl border border-destructive/40 bg-destructive/5 px-3 py-2 text-xs text-destructive">
          The shelf and the books disagree by {formatPaise(d.differencePaise)}.
          That means stock moved without its journal, or the reverse. Check the
          stock history of anything changed recently, and whether a posting was
          refused.
        </div>
      ) : null}

      <p className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
        Stock the school owned before it started using this module is entered
        as opening stock in the Catalogue, which posts it here. It must not also
        be entered on the ledger&rsquo;s own opening-balance screen, or the same
        goods land twice.
      </p>
    </div>
  );
}

/* ─── Bought twice ─────────────────────────────────────────── */

/**
 * Children who have the same item on more than one receipt this year.
 *
 * The counter warns before the sale; this finds what got past it. Sorted by
 * how close together the two sales were, because that is the thing that tells
 * a keying mistake from a real second purchase — minutes apart is an error,
 * months apart is a replacement.
 */
function RepeatPurchases() {
  const r = useAsync(() => invApi.repeatPurchases(), []);
  const rows = r.data ?? [];

  if (r.loading) return <InvSpinner label="Looking for repeats" />;
  if (r.error) return <InvAlert error={r.error} />;

  return (
    <div className="space-y-3">
      {rows.length === 0 ? (
        <p className="rounded-xl border p-3 text-sm text-muted-foreground">
          Nothing sold twice to the same child this year.
        </p>
      ) : (
        <ErpTableShell>
          <ErpTable minWidth="min-w-full">
            <ErpTableHead>
              <tr>
                <th className="pb-2 text-left">Student</th>
                <th className="pb-2 text-left">Class</th>
                <th className="pb-2 text-left">Item</th>
                <th className="pb-2 text-right">Sales</th>
                <th className="pb-2 text-right">Qty</th>
                <th className="pb-2 text-right">Value</th>
                <th className="pb-2 text-left">Receipts</th>
                <th className="pb-2 text-left">Apart</th>
              </tr>
            </ErpTableHead>
            <ErpTableBody>
              {rows.map((row) => {
                // Two sales inside an hour is almost never a real repeat.
                const suspicious = row.minutesApart < 60;
                return (
                  <tr key={`${row.studentId}-${row.itemId}`}>
                    <td className="py-2 font-medium">{row.buyerName}</td>
                    <td className="py-2 text-muted-foreground">
                      {row.classId}
                      {row.sectionId ? `-${row.sectionId}` : ""}
                    </td>
                    <td className="py-2">{row.itemName}</td>
                    <td className="py-2 text-right">{row.saleCount}</td>
                    <td className="py-2 text-right">{row.totalQty}</td>
                    <td className="py-2 text-right">
                      {formatPaise(row.totalPaise)}
                    </td>
                    <td className="py-2 text-muted-foreground">{row.saleNos}</td>
                    <td
                      className={
                        suspicious
                          ? "py-2 font-semibold text-[var(--danger)]"
                          : "py-2 text-muted-foreground"
                      }
                    >
                      {row.minutesApart < 60
                        ? `${row.minutesApart} min`
                        : `${row.firstSaleDate} → ${row.lastSaleDate}`}
                    </td>
                  </tr>
                );
              })}
            </ErpTableBody>
          </ErpTable>
        </ErpTableShell>
      )}
      <p className="rounded-lg bg-muted/50 px-3 py-2 text-[11px] text-muted-foreground">
        Sales minutes apart are almost always the same purchase rung up twice —
        void the later receipt rather than refunding, so the stock goes back at
        the cost it left at. Sales months apart are usually a genuine
        replacement.
      </p>
    </div>
  );
}

/* ─── Overview ─────────────────────────────────────────────── */

function Overview() {
  const d = useAsync(() => invApi.dashboard(), []);
  const data = d.data;

  if (d.loading) return <InvSpinner label="Loading overview" />;
  if (d.error || !data) return <InvAlert error={d.error || "Could not load"} />;

  return (
    <div className="space-y-4">
      <div className="flex justify-end">
        <Button variant="outline" size="sm" onClick={d.reload}>
          <RefreshCw className="size-3.5" />
          Refresh
        </Button>
      </div>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Stock
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Stock value"
            value={formatPaise(data.stockValuePaise)}
            sub={`${data.itemCount} items`}
          />
          <StatTile
            label="Below reorder"
            value={data.lowStockCount}
            tone={data.lowStockCount > 0 ? "warn" : "good"}
          />
          <StatTile label="Assets" value={data.assetCount} sub="in service" />
          <StatTile
            label="Asset value"
            value={formatPaise(data.assetValuePaise)}
          />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Buying
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile label="Open orders" value={data.openOrders} />
          <StatTile
            label="Awaiting approval"
            value={data.awaitingApproval}
            tone={data.awaitingApproval > 0 ? "warn" : "neutral"}
          />
          <StatTile label="Awaiting delivery" value={data.pendingReceipt} />
          <StatTile
            label="Owed to vendors"
            value={formatPaise(data.vendorOutstandingPaise)}
            tone={data.vendorOverduePaise > 0 ? "bad" : "neutral"}
            sub={
              data.vendorOverduePaise > 0
                ? `${formatPaise(data.vendorOverduePaise)} overdue`
                : "nothing overdue"
            }
          />
        </div>
      </section>

      <section className="space-y-2">
        <h3 className="text-xs font-semibold tracking-wide text-muted-foreground uppercase">
          Selling
        </h3>
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">
          <StatTile
            label="Sold today"
            value={formatPaise(data.salesTodayPaise)}
          />
          <StatTile
            label="Collected today"
            value={formatPaise(data.collectedTodayPaise)}
            tone="good"
          />
          <StatTile
            label="This month"
            value={formatPaise(data.monthSalesPaise)}
            sub={`margin ${formatPaise(data.monthMarginPaise)}`}
            tone={data.monthMarginPaise < 0 ? "bad" : "neutral"}
          />
          <StatTile
            label="Owed by buyers"
            value={formatPaise(data.studentOutstandingPaise)}
            tone={data.studentOutstandingPaise > 0 ? "warn" : "neutral"}
            sub="tracked in the store"
          />
        </div>
      </section>
    </div>
  );
}

/* ─── Stock register ───────────────────────────────────────── */

function StockRegister({ locationId }: { locationId: string }) {
  const r = useAsync(() => invApi.stockReport(locationId, false), [locationId]);
  const rows = r.data?.rows ?? [];

  return (
    <ReportShell
      state={r}
      empty="No stock to report."
      onExport={() =>
        downloadExcelCsv({
          title: "Stock register",
          fileBaseName: "stock-register",
          columns: [
            { key: "sku", header: "SKU" },
            { key: "item", header: "Item" },
            { key: "category", header: "Category" },
            { key: "uom", header: "Unit" },
            { key: "qty", header: "On hand", align: "right" },
            { key: "cost", header: "Avg cost", align: "right" },
            { key: "value", header: "Value", align: "right" },
          ],
          rows: rows.map((x) => ({
            sku: x.sku,
            item: x.itemName,
            category: x.categoryName,
            uom: x.uomName,
            qty: x.qtyOnHand,
            cost: x.avgCostPaise / 100,
            value: x.valuePaise / 100,
          })),
        })
      }
      summary={
        r.data ? (
          <>
            <StatTile
              label="Total value"
              value={formatPaise(r.data.totals.valuePaise)}
            />
            <StatTile label="Lines" value={rows.length} />
            <StatTile
              label="Below reorder"
              value={r.data.totals.belowReorder}
              tone={r.data.totals.belowReorder > 0 ? "warn" : "neutral"}
            />
          </>
        ) : null
      }
    >
      <ErpTable minWidth="min-w-[820px]">
        <ErpTableHead>
          <tr>
            <th className="px-3 py-2 text-left font-medium">Item</th>
            <th className="px-3 py-2 text-left font-medium">Category</th>
            <th className="px-3 py-2 text-right font-medium">On hand</th>
            <th className="px-3 py-2 text-right font-medium">Avg cost</th>
            <th className="px-3 py-2 text-right font-medium">Value</th>
          </tr>
        </ErpTableHead>
        <ErpTableBody hoverable>
          {rows.map((x) => (
            <tr key={x.itemId}>
              <td className="px-3 py-2">
                <div className="font-medium">{x.itemName}</div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {x.sku}
                </div>
              </td>
              <td className="px-3 py-2 text-xs">{x.categoryName || "—"}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                <span className={x.belowReorder ? "font-semibold text-amber-600" : ""}>
                  {formatQty(x.qtyOnHand)}
                </span>{" "}
                <span className="text-xs text-muted-foreground">{x.uomName}</span>
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {formatPaise(x.avgCostPaise)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatPaise(x.valuePaise)}
              </td>
            </tr>
          ))}
        </ErpTableBody>
      </ErpTable>
    </ReportShell>
  );
}

/* ─── Margin ───────────────────────────────────────────────── */

function MarginReport({ from, to }: { from: string; to: string }) {
  const r = useAsync(() => invApi.marginReport(from, to), [from, to]);
  const rows = r.data?.rows ?? [];

  return (
    <ReportShell
      state={r}
      empty="Nothing sold in this period."
      onExport={() =>
        downloadExcelCsv({
          title: "Item margin",
          subtitle: `${from} to ${to}`,
          fileBaseName: "item-margin",
          columns: [
            { key: "sku", header: "SKU" },
            { key: "item", header: "Item" },
            { key: "category", header: "Category" },
            { key: "qty", header: "Qty sold", align: "right" },
            { key: "revenue", header: "Revenue", align: "right" },
            { key: "cost", header: "Cost", align: "right" },
            { key: "margin", header: "Margin", align: "right" },
            { key: "pct", header: "Margin %", align: "right" },
          ],
          rows: rows.map((x) => ({
            sku: x.sku,
            item: x.itemName,
            category: x.categoryName,
            qty: x.qtySold,
            revenue: x.revenuePaise / 100,
            cost: x.costPaise / 100,
            margin: x.marginPaise / 100,
            pct: marginPct(x.revenuePaise, x.costPaise),
          })),
        })
      }
      summary={
        r.data ? (
          <>
            <StatTile label="Revenue" value={formatPaise(r.data.totals.revenue)} />
            <StatTile
              label="Cost of goods"
              value={formatPaise(r.data.totals.cost)}
            />
            <StatTile
              label="Margin"
              value={formatPaise(r.data.totals.margin)}
              tone={r.data.totals.margin < 0 ? "bad" : "good"}
              sub={`${marginPct(r.data.totals.revenue, r.data.totals.cost)}%`}
            />
          </>
        ) : null
      }
    >
      <p className="px-1 pb-2 text-[11px] text-muted-foreground">
        Returns are netted off and cancelled sales excluded, so these are goods
        that actually stayed with the buyer. Cost is what each item cost when it
        was sold, not today&rsquo;s average.
      </p>
      <ErpTable minWidth="min-w-[820px]">
        <ErpTableHead>
          <tr>
            <th className="px-3 py-2 text-left font-medium">Item</th>
            <th className="px-3 py-2 text-right font-medium">Sold</th>
            <th className="px-3 py-2 text-right font-medium">Revenue</th>
            <th className="px-3 py-2 text-right font-medium">Cost</th>
            <th className="px-3 py-2 text-right font-medium">Margin</th>
          </tr>
        </ErpTableHead>
        <ErpTableBody hoverable>
          {rows.map((x) => (
            <tr key={x.itemId}>
              <td className="px-3 py-2">
                <div className="font-medium">{x.itemName}</div>
                <div className="font-mono text-[11px] text-muted-foreground">
                  {x.sku}
                </div>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatQty(x.qtySold)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatPaise(x.revenuePaise)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {formatPaise(x.costPaise)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                <span
                  className={
                    x.marginPaise < 0
                      ? "font-semibold text-destructive"
                      : "text-emerald-600 dark:text-emerald-400"
                  }
                >
                  {formatPaise(x.marginPaise)}
                  {x.revenuePaise ? (
                    <span className="ml-1 text-[11px]">
                      ({marginPct(x.revenuePaise, x.costPaise)}%)
                    </span>
                  ) : null}
                </span>
              </td>
            </tr>
          ))}
        </ErpTableBody>
      </ErpTable>
    </ReportShell>
  );
}

/* ─── Day book ─────────────────────────────────────────────── */

function DayBook({ from, to }: { from: string; to: string }) {
  const r = useAsync(() => invApi.daybookReport(from, to), [from, to]);
  const rows = r.data?.rows ?? [];

  return (
    <ReportShell
      state={r}
      empty="No sales in this period."
      onExport={() =>
        downloadExcelCsv({
          title: "Sales day book",
          subtitle: `${from} to ${to}`,
          fileBaseName: "sales-day-book",
          columns: [
            { key: "no", header: "Receipt" },
            { key: "date", header: "Date" },
            { key: "buyer", header: "Buyer" },
            { key: "kind", header: "Type" },
            { key: "items", header: "Items", align: "right" },
            { key: "total", header: "Total", align: "right" },
            { key: "paid", header: "Paid", align: "right" },
            { key: "owing", header: "Owing", align: "right" },
            { key: "margin", header: "Margin", align: "right" },
            { key: "tenders", header: "Paid by" },
            { key: "status", header: "Status" },
          ],
          rows: rows.map((x) => ({
            no: x.saleNo,
            date: x.saleDate,
            buyer: x.buyerName,
            kind: x.buyerKind,
            items: x.itemCount,
            total: x.totalPaise / 100,
            paid: x.paidPaise / 100,
            owing: x.balancePaise / 100,
            margin: x.marginPaise / 100,
            tenders: x.tenders,
            status: x.status,
          })),
        })
      }
      summary={
        r.data ? (
          <>
            <StatTile label="Billed" value={formatPaise(r.data.totals.billed)} />
            <StatTile
              label="Collected"
              value={formatPaise(r.data.totals.collected)}
              tone="good"
            />
            <StatTile
              label="Still owing"
              value={formatPaise(r.data.totals.outstanding)}
              tone={r.data.totals.outstanding > 0 ? "warn" : "neutral"}
            />
            <StatTile
              label="Margin"
              value={formatPaise(r.data.totals.margin)}
              tone={r.data.totals.margin < 0 ? "bad" : "neutral"}
            />
          </>
        ) : null
      }
    >
      <ErpTable minWidth="min-w-[900px]">
        <ErpTableHead>
          <tr>
            <th className="px-3 py-2 text-left font-medium">Receipt</th>
            <th className="px-3 py-2 text-left font-medium">Buyer</th>
            <th className="px-3 py-2 text-right font-medium">Items</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
            <th className="px-3 py-2 text-right font-medium">Paid</th>
            <th className="px-3 py-2 text-right font-medium">Margin</th>
            <th className="px-3 py-2 text-left font-medium">Paid by</th>
          </tr>
        </ErpTableHead>
        <ErpTableBody hoverable>
          {rows.map((x) => (
            <tr key={x.saleId} className={x.status === "void" ? "opacity-60" : ""}>
              <td className="px-3 py-2">
                <div className="font-mono text-xs">{x.saleNo}</div>
                <div className="text-[11px] text-muted-foreground">
                  {x.saleDate}
                </div>
              </td>
              <td className="px-3 py-2">
                <div className="text-sm">{x.buyerName || "—"}</div>
                <Pill
                  tone={
                    x.status === "paid"
                      ? "good"
                      : x.status === "void"
                        ? "bad"
                        : "warn"
                  }
                >
                  {saleStatusLabel(x.status as InvSaleStatus)}
                </Pill>
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatQty(x.itemCount)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatPaise(x.totalPaise)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {formatPaise(x.paidPaise)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatPaise(x.marginPaise)}
              </td>
              <td className="px-3 py-2 text-xs">{x.tenders || "—"}</td>
            </tr>
          ))}
        </ErpTableBody>
      </ErpTable>
    </ReportShell>
  );
}

/* ─── Purchases ────────────────────────────────────────────── */

function Purchases({ from, to }: { from: string; to: string }) {
  const r = useAsync(() => invApi.purchaseReport(from, to), [from, to]);
  const rows = r.data?.rows ?? [];

  return (
    <ReportShell
      state={r}
      empty="No purchases in this period."
      onExport={() =>
        downloadExcelCsv({
          title: "Purchases by vendor",
          subtitle: `${from} to ${to}`,
          fileBaseName: "purchases-by-vendor",
          columns: [
            { key: "vendor", header: "Vendor" },
            { key: "receipts", header: "Receipts", align: "right" },
            { key: "goods", header: "Goods", align: "right" },
            { key: "gst", header: "GST", align: "right" },
            { key: "charges", header: "Charges", align: "right" },
            { key: "total", header: "Total", align: "right" },
            { key: "returned", header: "Returned", align: "right" },
            { key: "billed", header: "Billed", align: "right" },
            { key: "paid", header: "Paid", align: "right" },
            { key: "outstanding", header: "Outstanding", align: "right" },
          ],
          rows: rows.map((x) => ({
            vendor: x.vendorName,
            receipts: x.receiptCount,
            goods: x.goodsPaise / 100,
            gst: x.taxPaise / 100,
            charges: x.chargesPaise / 100,
            total: x.totalPaise / 100,
            returned: x.returnedPaise / 100,
            billed: x.billedPaise / 100,
            paid: x.paidPaise / 100,
            outstanding: x.outstandingPaise / 100,
          })),
        })
      }
      summary={
        r.data ? (
          <>
            <StatTile
              label="Purchased"
              value={formatPaise(r.data.totals.total)}
            />
            <StatTile
              label="Still owed"
              value={formatPaise(r.data.totals.outstanding)}
              tone={r.data.totals.outstanding > 0 ? "warn" : "neutral"}
            />
            <StatTile label="Vendors" value={rows.length} />
          </>
        ) : null
      }
    >
      <ErpTable minWidth="min-w-[860px]">
        <ErpTableHead>
          <tr>
            <th className="px-3 py-2 text-left font-medium">Vendor</th>
            <th className="px-3 py-2 text-right font-medium">Receipts</th>
            <th className="px-3 py-2 text-right font-medium">Goods</th>
            <th className="px-3 py-2 text-right font-medium">GST + charges</th>
            <th className="px-3 py-2 text-right font-medium">Total</th>
            <th className="px-3 py-2 text-right font-medium">Returned</th>
            <th className="px-3 py-2 text-right font-medium">Outstanding</th>
          </tr>
        </ErpTableHead>
        <ErpTableBody hoverable>
          {rows.map((x) => (
            <tr key={x.vendorId}>
              <td className="px-3 py-2 font-medium">{x.vendorName}</td>
              <td className="px-3 py-2 text-right tabular-nums">
                {x.receiptCount}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatPaise(x.goodsPaise)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {formatPaise(x.taxPaise + x.chargesPaise)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums">
                {formatPaise(x.totalPaise)}
              </td>
              <td className="px-3 py-2 text-right tabular-nums text-muted-foreground">
                {x.returnedPaise ? formatPaise(x.returnedPaise) : "—"}
              </td>
              <td className="px-3 py-2 text-right font-medium tabular-nums">
                {x.outstandingPaise ? formatPaise(x.outstandingPaise) : "—"}
              </td>
            </tr>
          ))}
        </ErpTableBody>
      </ErpTable>
    </ReportShell>
  );
}

/* ─── Shared report frame ──────────────────────────────────── */

function ReportShell<T extends { rows: unknown[] }>({
  state,
  summary,
  empty,
  onExport,
  children,
}: {
  state: { data: T | null; loading: boolean; error: string; reload: () => void };
  summary?: React.ReactNode;
  empty: string;
  onExport: () => void;
  children: React.ReactNode;
}) {
  const count = state.data?.rows.length ?? 0;

  return (
    <div className="space-y-3">
      {summary ? (
        <div className="grid gap-2 sm:grid-cols-2 lg:grid-cols-4">{summary}</div>
      ) : null}

      <div className="flex items-center justify-end gap-2">
        <Button variant="outline" size="sm" onClick={state.reload}>
          <RefreshCw className="size-3.5" />
        </Button>
        <Button
          variant="outline"
          size="sm"
          onClick={onExport}
          disabled={count === 0}
        >
          <Download className="size-3.5" />
          Export
        </Button>
      </div>

      <InvAlert error={state.error} />

      {state.loading ? (
        <InvSpinner label="Running report" />
      ) : state.error ? null : count === 0 ? (
        <div className="rounded-xl border border-dashed px-4 py-10 text-center text-sm text-muted-foreground">
          {empty}
        </div>
      ) : (
        <ErpTableShell density="compact" className="overflow-x-auto">
          {children}
        </ErpTableShell>
      )}
    </div>
  );
}
