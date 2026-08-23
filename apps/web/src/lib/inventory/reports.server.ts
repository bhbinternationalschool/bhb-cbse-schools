/**
 * Inventory — reports and the module dashboard.
 *
 * The aggregate reports are SQL functions: summing a term of sale lines in
 * application code means fetching a term of sale lines. This file calls them,
 * maps the rows, and assembles the dashboard from a handful of small counts.
 */

import { InvError, invCtx } from "@/lib/inventory/db.server";

export type InvClosingStockResult = {
  created: boolean;
  valuePaise: number;
  voucherNo: string;
  reversedVoucherNo: string;
  note: string;
};

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const int = (v: unknown): number => Math.trunc(num(v));

export type InvMarginRow = {
  itemId: string;
  sku: string;
  itemName: string;
  categoryName: string;
  qtySold: number;
  revenuePaise: number;
  costPaise: number;
  marginPaise: number;
};

export type InvDaybookRow = {
  saleId: string;
  saleNo: string;
  saleDate: string;
  buyerName: string;
  buyerKind: string;
  itemCount: number;
  totalPaise: number;
  paidPaise: number;
  balancePaise: number;
  marginPaise: number;
  status: string;
  tenders: string;
};

export type InvPurchaseReportRow = {
  vendorId: string;
  vendorName: string;
  receiptCount: number;
  goodsPaise: number;
  taxPaise: number;
  chargesPaise: number;
  totalPaise: number;
  returnedPaise: number;
  billedPaise: number;
  paidPaise: number;
  outstandingPaise: number;
};

export type InvStockReportRow = {
  itemId: string;
  sku: string;
  itemName: string;
  categoryName: string;
  uomName: string;
  qtyOnHand: number;
  avgCostPaise: number;
  valuePaise: number;
  reorderLevel: number;
  belowReorder: boolean;
  lastMoveAt: string;
};

/** Guard the date window so a typo cannot ask for a decade of rows. */
function range(from?: string, to?: string): { from: string; to: string } {
  const today = new Date().toISOString().slice(0, 10);
  const start = /^\d{4}-\d{2}-\d{2}$/.test(String(from)) ? String(from) : today;
  const end = /^\d{4}-\d{2}-\d{2}$/.test(String(to)) ? String(to) : today;
  return start <= end ? { from: start, to: end } : { from: end, to: start };
}

export async function marginReport(
  from?: string,
  to?: string,
): Promise<{ rows: InvMarginRow[]; totals: { revenue: number; cost: number; margin: number } }> {
  const { sb, tenantId } = await invCtx();
  const r = range(from, to);

  const { data, error } = await sb.rpc("inv_report_margin", {
    p_tenant_id: tenantId,
    p_from: r.from,
    p_to: r.to,
  });
  if (error) throw new InvError(`Margin report: ${error.message}`, 500);

  const rows: InvMarginRow[] = ((data ?? []) as Row[]).map((x) => ({
    itemId: str(x.item_id),
    sku: str(x.sku),
    itemName: str(x.item_name),
    categoryName: str(x.category_name),
    qtySold: num(x.qty_sold),
    revenuePaise: int(x.revenue_paise),
    costPaise: int(x.cost_paise),
    marginPaise: int(x.margin_paise),
  }));

  return {
    rows,
    totals: {
      revenue: rows.reduce((s, x) => s + x.revenuePaise, 0),
      cost: rows.reduce((s, x) => s + x.costPaise, 0),
      margin: rows.reduce((s, x) => s + x.marginPaise, 0),
    },
  };
}

export async function daybookReport(
  from?: string,
  to?: string,
): Promise<{
  rows: InvDaybookRow[];
  totals: { billed: number; collected: number; outstanding: number; margin: number };
}> {
  const { sb, tenantId } = await invCtx();
  const r = range(from, to);

  const { data, error } = await sb.rpc("inv_report_daybook", {
    p_tenant_id: tenantId,
    p_from: r.from,
    p_to: r.to,
  });
  if (error) throw new InvError(`Day book: ${error.message}`, 500);

  const rows: InvDaybookRow[] = ((data ?? []) as Row[]).map((x) => ({
    saleId: str(x.sale_id),
    saleNo: str(x.sale_no),
    saleDate: str(x.sale_date).slice(0, 10),
    buyerName: str(x.buyer_name),
    buyerKind: str(x.buyer_kind),
    itemCount: num(x.item_count),
    totalPaise: int(x.total_paise),
    paidPaise: int(x.paid_paise),
    balancePaise: int(x.balance_paise),
    marginPaise: int(x.margin_paise),
    status: str(x.status),
    tenders: str(x.tenders),
  }));

  // Cancelled sales are shown in the list but must not be counted as trade.
  const live = rows.filter((x) => x.status !== "void");
  return {
    rows,
    totals: {
      billed: live.reduce((s, x) => s + x.totalPaise, 0),
      collected: live.reduce((s, x) => s + x.paidPaise, 0),
      outstanding: live.reduce((s, x) => s + x.balancePaise, 0),
      margin: live.reduce((s, x) => s + x.marginPaise, 0),
    },
  };
}

export async function purchaseReport(
  from?: string,
  to?: string,
): Promise<{
  rows: InvPurchaseReportRow[];
  totals: { total: number; outstanding: number };
}> {
  const { sb, tenantId } = await invCtx();
  const r = range(from, to);

  const { data, error } = await sb.rpc("inv_report_purchases", {
    p_tenant_id: tenantId,
    p_from: r.from,
    p_to: r.to,
  });
  if (error) throw new InvError(`Purchase report: ${error.message}`, 500);

  const rows: InvPurchaseReportRow[] = ((data ?? []) as Row[]).map((x) => ({
    vendorId: str(x.vendor_id),
    vendorName: str(x.vendor_name),
    receiptCount: int(x.receipt_count),
    goodsPaise: int(x.goods_paise),
    taxPaise: int(x.tax_paise),
    chargesPaise: int(x.charges_paise),
    totalPaise: int(x.total_paise),
    returnedPaise: int(x.returned_paise),
    billedPaise: int(x.billed_paise),
    paidPaise: int(x.paid_paise),
    outstandingPaise: int(x.outstanding_paise),
  }));

  return {
    rows,
    totals: {
      total: rows.reduce((s, x) => s + x.totalPaise, 0),
      outstanding: rows.reduce((s, x) => s + x.outstandingPaise, 0),
    },
  };
}

export async function stockReport(
  locationId?: string,
  opts: { lowOnly?: boolean } = {},
): Promise<{
  rows: InvStockReportRow[];
  totals: { valuePaise: number; lines: number; belowReorder: number };
}> {
  const { sb, tenantId } = await invCtx();

  const { data, error } = await sb.rpc("inv_report_stock", {
    p_tenant_id: tenantId,
    p_location_id: locationId || null,
  });
  if (error) throw new InvError(`Stock report: ${error.message}`, 500);

  let rows: InvStockReportRow[] = ((data ?? []) as Row[]).map((x) => ({
    itemId: str(x.item_id),
    sku: str(x.sku),
    itemName: str(x.item_name),
    categoryName: str(x.category_name),
    uomName: str(x.uom_name),
    qtyOnHand: num(x.qty_on_hand),
    avgCostPaise: int(x.avg_cost_paise),
    valuePaise: int(x.value_paise),
    reorderLevel: num(x.reorder_level),
    belowReorder: x.below_reorder === true,
    lastMoveAt: str(x.last_move_at),
  }));

  const belowReorder = rows.filter((x) => x.belowReorder).length;
  const valuePaise = rows.reduce((s, x) => s + x.valuePaise, 0);
  if (opts.lowOnly) rows = rows.filter((x) => x.belowReorder);

  return { rows, totals: { valuePaise, lines: rows.length, belowReorder } };
}

/* ─── Dashboard ────────────────────────────────────────────── */

export type InvDashboard = {
  stockValuePaise: number;
  lowStockCount: number;
  itemCount: number;
  assetCount: number;
  assetValuePaise: number;
  openOrders: number;
  awaitingApproval: number;
  pendingReceipt: number;
  vendorOutstandingPaise: number;
  vendorOverduePaise: number;
  salesTodayPaise: number;
  collectedTodayPaise: number;
  marginTodayPaise: number;
  studentOutstandingPaise: number;
  monthSalesPaise: number;
  monthMarginPaise: number;
};

/**
 * One call for the module's front page.
 *
 * Every figure here is read from the database at request time; none of it is a
 * cached total that could drift from the ledger it claims to summarise.
 */
export async function dashboard(): Promise<InvDashboard> {
  const { sb, tenantId } = await invCtx();
  const today = new Date().toISOString().slice(0, 10);
  const monthStart = `${today.slice(0, 7)}-01`;

  const [stock, assets, orders, bills, salesToday, payToday, monthMargin] =
    await Promise.all([
      stockReport(),
      sb
        .from("inv_assets")
        .select("status, purchase_cost_paise")
        .eq("tenant_id", tenantId)
        .limit(10000),
      sb
        .from("inv_purchase_orders")
        .select("status")
        .eq("tenant_id", tenantId)
        .in("status", [
          "draft",
          "pending_approval",
          "approved",
          "issued",
          "partial_grn",
        ]),
      sb
        .from("inv_vendor_bills")
        .select("total_paise, paid_paise, due_date")
        .eq("tenant_id", tenantId)
        .in("status", ["open", "part_paid"]),
      sb
        .from("inv_sales")
        .select("total_paise, cost_paise, balance_paise, sale_date, status")
        .eq("tenant_id", tenantId)
        .gte("sale_date", monthStart)
        .neq("status", "void"),
      sb
        .from("inv_sale_payments")
        .select("amount_paise")
        .eq("tenant_id", tenantId)
        .eq("paid_on", today),
      sb
        .from("inv_sales")
        .select("balance_paise")
        .eq("tenant_id", tenantId)
        .in("status", ["open", "part_paid"]),
    ]);

  const assetRows = (assets.data ?? []) as Row[];
  const orderRows = (orders.data ?? []) as Row[];
  const billRows = (bills.data ?? []) as Row[];
  const monthRows = (salesToday.data ?? []) as Row[];
  const todayRows = monthRows.filter((r) => str(r.sale_date).slice(0, 10) === today);

  return {
    stockValuePaise: stock.totals.valuePaise,
    lowStockCount: stock.totals.belowReorder,
    itemCount: stock.rows.length,
    assetCount: assetRows.filter(
      (r) => !["scrapped", "lost"].includes(str(r.status)),
    ).length,
    assetValuePaise: assetRows
      .filter((r) => !["scrapped", "lost"].includes(str(r.status)))
      .reduce((s, r) => s + int(r.purchase_cost_paise), 0),
    openOrders: orderRows.length,
    awaitingApproval: orderRows.filter((r) => str(r.status) === "pending_approval")
      .length,
    pendingReceipt: orderRows.filter((r) =>
      ["issued", "partial_grn"].includes(str(r.status)),
    ).length,
    vendorOutstandingPaise: billRows.reduce(
      (s, r) => s + Math.max(0, int(r.total_paise) - int(r.paid_paise)),
      0,
    ),
    vendorOverduePaise: billRows
      .filter((r) => str(r.due_date).slice(0, 10) && str(r.due_date).slice(0, 10) < today)
      .reduce((s, r) => s + Math.max(0, int(r.total_paise) - int(r.paid_paise)), 0),
    salesTodayPaise: todayRows.reduce((s, r) => s + int(r.total_paise), 0),
    collectedTodayPaise: ((payToday.data ?? []) as Row[]).reduce(
      (s, r) => s + int(r.amount_paise),
      0,
    ),
    marginTodayPaise: todayRows.reduce(
      (s, r) => s + int(r.total_paise) - int(r.cost_paise),
      0,
    ),
    studentOutstandingPaise: ((monthMargin.data ?? []) as Row[]).reduce(
      (s, r) => s + int(r.balance_paise),
      0,
    ),
    monthSalesPaise: monthRows.reduce((s, r) => s + int(r.total_paise), 0),
    monthMarginPaise: monthRows.reduce(
      (s, r) => s + int(r.total_paise) - int(r.cost_paise),
      0,
    ),
  };
}


/* ─── Inventory parity ────────────────────────────────────── */

export type InvInventoryParity = {
  stockValuePaise: number;
  ledgerValuePaise: number;
  differencePaise: number;
  /**
   * False when no chart of accounts has been seeded. Postings are skipped in
   * that state by design, so the books are empty and a difference is expected
   * — not a fault to report.
   */
  ledgerActive: boolean;
};

/**
 * Does the ledger's Inventory balance match the stock on the shelf?
 *
 * The check worth running regularly under perpetual inventory. Any gap means
 * something moved stock without its journal, or the reverse — and the sooner
 * it is seen the smaller it is.
 */
export async function inventoryParity(): Promise<InvInventoryParity> {
  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb.rpc("inv_inventory_parity", {
    p_tenant_id: tenantId,
  });
  if (error) throw new InvError(`Inventory parity: ${error.message}`, 500);
  const out = (data ?? {}) as Row;
  return {
    stockValuePaise: int(out.stock_value_paise),
    ledgerValuePaise: int(out.ledger_value_paise),
    differencePaise: int(out.difference_paise),
    ledgerActive: out.ledger_active === true,
  };
}
