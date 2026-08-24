"use client";

/**
 * Inventory — browser data access.
 *
 * The whole client contract is here: typed fetches plus small hooks. There is
 * deliberately no client-side store, no localStorage cache and no "hydrate
 * then re-push" cycle. A screen asks for exactly the rows it renders, and a
 * save is a request whose response is the new truth.
 *
 * Why that matters for typing lag: the old module called loadStore() inside
 * render, which re-parsed and re-normalised the entire catalogue on every
 * keystroke. Here, keystrokes touch local component state only; the network
 * is touched by a debounced query or an explicit Save.
 */

import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import type {
  InvAssetEventRow,
  InvAssetRow,
  InvAssetSummary,
  InvBootstrap,
  InvDaybookRowData,
  InvDashboardData,
  InvMarginRowData,
  InvPurchaseRowData,
  InvStockReportRowData,
  InvBuyerKind,
  InvBuyerStudent,
  InvCounterSummary,
  InvSalePage,
  InvSaleReturn,
  InvSaleStatus,
  InvTenderMode,
  InvGrn,
  InvIndent,
  InvPendingPoLine,
  InvPurchaseOrder,
  InvPurchaseReturn,
  InvVendorBill,
  InvItem,
  InvItemPage,
  InvItemQuery,
  InvKitDetail,
  InvMasterKind,
  InvPriceList,
  InvPriceListItem,
  InvSettings,
  InvStockBalance,
  InvVendor,
} from "@/lib/inventory/types";

const BASE = "/api/inventory";

export class InvRequestError extends Error {
  status: number;
  constructor(message: string, status: number) {
    super(message);
    this.status = status;
  }
}

async function req<T>(
  path: string,
  init?: RequestInit & { query?: Record<string, unknown> },
): Promise<T> {
  const url = new URL(`${BASE}${path}`, window.location.origin);
  for (const [k, v] of Object.entries(init?.query ?? {})) {
    if (v === undefined || v === null || v === "" || v === false) continue;
    url.searchParams.set(k, String(v));
  }

  const res = await fetch(url.toString(), {
    ...init,
    headers: init?.body
      ? { "content-type": "application/json", ...(init?.headers ?? {}) }
      : init?.headers,
    cache: "no-store",
  });

  let payload: Record<string, unknown> = {};
  try {
    payload = (await res.json()) as Record<string, unknown>;
  } catch {
    // Fall through to the status-based message below.
  }

  if (!res.ok || payload.ok === false) {
    const message =
      typeof payload.error === "string" && payload.error
        ? payload.error
        : `Request failed (${res.status})`;
    throw new InvRequestError(message, res.status);
  }
  return payload as T;
}

/* ─── Calls ────────────────────────────────────────────────── */

export const invApi = {
  bootstrap: () =>
    req<{ bootstrap: InvBootstrap }>("/bootstrap").then((r) => r.bootstrap),

  saveSettings: (patch: Partial<InvSettings>) =>
    req<{ settings: InvSettings }>("/bootstrap", {
      method: "POST",
      body: JSON.stringify(patch),
    }).then((r) => r.settings),

  listVendors: (query: { search?: string; status?: string } = {}) =>
    req<{ vendors: InvVendor[] }>("/vendors", { query }).then((r) => r.vendors),

  saveVendor: (vendor: Partial<InvVendor>) =>
    req<{ vendor: InvVendor }>("/vendors", {
      method: "POST",
      body: JSON.stringify(vendor),
    }).then((r) => r.vendor),

  removeVendor: (id: string) =>
    req<{ deleted: boolean; reason: string }>("/vendors", {
      method: "DELETE",
      query: { id },
    }),

  saveMaster: (kind: InvMasterKind, row: Record<string, unknown>) =>
    req<{ row: unknown }>("/masters", {
      method: "POST",
      body: JSON.stringify({ ...row, kind }),
    }).then((r) => r.row),

  removeMaster: (kind: InvMasterKind, id: string) =>
    req<{ deleted: boolean; reason: string }>("/masters", {
      method: "DELETE",
      query: { kind, id },
    }),

  listItems: (query: InvItemQuery) =>
    req<InvItemPage>("/items", { query: query as Record<string, unknown> }),

  saveItem: (item: Partial<InvItem>) =>
    req<{ item: InvItem }>("/items", {
      method: "POST",
      body: JSON.stringify(item),
    }).then((r) => r.item),

  /** Paste-a-sheet import. dryRun previews; without it the write is all-or-nothing. */
  importItems: (input: {
    rows: {
      sku: string;
      name: string;
      category?: string;
      uom?: string;
      itemKind?: string;
      hsnCode?: string;
      gstRate?: number;
      reorderLevel?: number;
      barcode?: string;
      notes?: string;
      mrpPaise?: number;
      salePaise?: number;
      maxDiscountPct?: number;
    }[];
    dryRun: boolean;
    priceListId?: string;
  }) =>
    req<{
      result: {
        ok: boolean;
        applied: boolean;
        error: string;
        summary: { create: number; update: number; error: number };
        rows: {
          row: number;
          sku: string;
          name: string;
          action: "create" | "update" | "error";
          error: string;
        }[];
      };
    }>("/items", {
      method: "POST",
      body: JSON.stringify({ import: input }),
    }).then((r) => r.result),

  bulkUpdateItems: (bulk: {
    itemIds: string[];
    isActive?: boolean;
    categoryId?: string;
    defaultVendorId?: string;
    gstRate?: number;
    reorderLevel?: number;
  }) =>
    req<{ updated: number }>("/items", {
      method: "POST",
      body: JSON.stringify({ bulk }),
    }).then((r) => r.updated),

  removeItem: (id: string) =>
    req<{ deleted: boolean; reason: string }>("/items", {
      method: "DELETE",
      query: { id },
    }),

  listPrices: (priceListId: string) =>
    req<{ items: InvPriceListItem[] }>("/prices", { query: { priceListId } }).then(
      (r) => r.items,
    ),

  savePriceList: (list: Partial<InvPriceList>) =>
    req<{ list: InvPriceList }>("/prices", {
      method: "POST",
      body: JSON.stringify({ action: "saveList", list }),
    }).then((r) => r.list),

  savePrices: (
    priceListId: string,
    rows: {
      itemId: string;
      salePaise: number;
      mrpPaise?: number;
      maxDiscountPct?: number;
    }[],
  ) =>
    req<{ saved: number }>("/prices", {
      method: "POST",
      body: JSON.stringify({ action: "savePrices", priceListId, rows }),
    }).then((r) => r.saved),

  copyPrices: (input: {
    fromId: string;
    toId: string;
    markupPct?: number;
    overwrite?: boolean;
  }) =>
    req<{ copied: number }>("/prices", {
      method: "POST",
      body: JSON.stringify({ action: "copy", ...input }),
    }).then((r) => r.copied),

  removePriceList: (priceListId: string) =>
    req<{ deleted: boolean }>("/prices", {
      method: "DELETE",
      query: { priceListId },
    }),

  listKits: (query: { academicYearCode?: string; classId?: string; status?: string } = {}) =>
    req<{ kits: InvKitDetail[] }>("/kits", { query }).then((r) => r.kits),

  saveKit: (kit: Record<string, unknown>) =>
    req<{ kit: unknown }>("/kits", {
      method: "POST",
      body: JSON.stringify(kit),
    }).then((r) => r.kit),

  removeKit: (id: string) =>
    req<{ deleted: boolean }>("/kits", { method: "DELETE", query: { id } }),

  balances: (query: { itemIds?: string[]; locationId?: string } = {}) =>
    req<{ balances: InvStockBalance[] }>("/stock", {
      query: {
        itemIds: query.itemIds?.join(","),
        locationId: query.locationId,
      },
    }).then((r) => r.balances),

  stockCard: (itemId: string, locationId = "") =>
    req<{ rows: unknown[]; qtyOnHand: number }>("/stock", {
      query: { view: "card", itemId, locationId },
    }),

  valuation: (locationId = "") =>
    req<{ rows: unknown[]; totalPaise: number }>("/stock", {
      query: { view: "valuation", locationId },
    }),

  setOpeningStock: (input: {
    itemId: string;
    locationId: string;
    qty: number;
    unitCostPaise?: number;
    note?: string;
  }) =>
    req<{ qty: number }>("/stock", {
      method: "POST",
      body: JSON.stringify({ action: "opening", ...input }),
    }),

  adjustStock: (input: {
    itemId: string;
    locationId: string;
    countedQty: number;
    reason: string;
  }) =>
    req<{ delta: number; before: number; after: number }>("/stock", {
      method: "POST",
      body: JSON.stringify({ action: "adjust", ...input }),
    }),

  transferStock: (input: {
    itemId: string;
    fromLocationId: string;
    toLocationId: string;
    qty: number;
    note?: string;
  }) =>
    req<{ qty: number }>("/stock", {
      method: "POST",
      body: JSON.stringify({ action: "transfer", ...input }),
    }),

  /* ─── Procurement ────────────────────────────────────────── */

  listIndents: (query: { status?: string } = {}) =>
    req<{ indents: InvIndent[] }>("/indents", { query }).then((r) => r.indents),

  saveIndent: (indent: Record<string, unknown>) =>
    req<{ indent: InvIndent }>("/indents", {
      method: "POST",
      body: JSON.stringify(indent),
    }).then((r) => r.indent),

  decideIndent: (
    id: string,
    decision: "submit" | "approve" | "reject" | "cancel",
    note?: string,
  ) =>
    req<{ status: string }>("/indents", {
      method: "POST",
      body: JSON.stringify({ action: "decide", id, decision, note }),
    }),

  listOrders: (query: { status?: string; vendorId?: string } = {}) =>
    req<{ orders: InvPurchaseOrder[] }>("/orders", { query }).then((r) => r.orders),

  saveOrder: (order: Record<string, unknown>) =>
    req<{ order: InvPurchaseOrder }>("/orders", {
      method: "POST",
      body: JSON.stringify(order),
    }).then((r) => r.order),

  decideOrder: (
    id: string,
    decision: "submit" | "approve" | "reject" | "issue" | "cancel",
    note?: string,
  ) =>
    req<{ status: string }>("/orders", {
      method: "POST",
      body: JSON.stringify({ action: "decide", id, decision, note }),
    }),

  pendingPoLines: (query: { vendorId?: string; poId?: string } = {}) =>
    req<{ pendingLines: InvPendingPoLine[] }>("/orders", {
      query: { ...query, view: "pending" },
    }).then((r) => r.pendingLines),

  listReceipts: (query: { vendorId?: string; poId?: string } = {}) =>
    req<{ receipts: InvGrn[] }>("/receipts", { query }).then((r) => r.receipts),

  postReceipt: (receipt: Record<string, unknown>) =>
    req<{
      receipt: {
        grnId: string;
        grnNo: string;
        billId: string;
        billNo: string;
        totalPaise: number;
      };
    }>("/receipts", { method: "POST", body: JSON.stringify(receipt) }).then(
      (r) => r.receipt,
    ),

  /** Cancel a receipt and everything it caused. Refuses when it would lie. */
  voidReceipt: (id: string, reason: string) =>
    req<{
      voided: {
        grnId: string;
        grnNo: string;
        status: string;
        reversalVoucherNo: string;
      };
    }>("/receipts", { method: "DELETE", query: { id, reason } }).then(
      (r) => r.voided,
    ),

  /** Descriptive fields only — quantities and rates need a void and re-entry. */
  amendReceipt: (amend: {
    grnId: string;
    supplierInvoiceNo?: string;
    supplierInvoiceDate?: string;
    note?: string;
  }) =>
    req<{ amended: { grnId: string; amended: boolean } }>("/receipts", {
      method: "POST",
      body: JSON.stringify({ amend }),
    }).then((r) => r.amended),

  listBills: (query: { vendorId?: string; status?: string } = {}) =>
    req<{ bills: InvVendorBill[] }>("/bills", { query }).then((r) => r.bills),

  payBill: (input: {
    billId: string;
    amountPaise: number;
    mode?: string;
    paidOn?: string;
    reference?: string;
    note?: string;
  }) =>
    req<{ paidPaise: number; balancePaise: number; status: string }>("/bills", {
      method: "POST",
      body: JSON.stringify(input),
    }),

  listPurchaseReturns: (query: { vendorId?: string } = {}) =>
    req<{ returns: InvPurchaseReturn[] }>("/returns", { query }).then(
      (r) => r.returns,
    ),

  postPurchaseReturn: (input: Record<string, unknown>) =>
    req<{ return: { returnId: string; returnNo: string; totalPaise: number } }>(
      "/returns",
      { method: "POST", body: JSON.stringify(input) },
    ).then((r) => r.return),

  /* ─── Counter sales ──────────────────────────────────────── */

  findStudents: (search: string) =>
    req<{ students: InvBuyerStudent[] }>("/buyers", { query: { search } }).then(
      (r) => r.students,
    ),

  listSales: (query: {
    search?: string;
    status?: string;
    buyerKind?: InvBuyerKind | "";
    studentId?: string;
    fromDate?: string;
    toDate?: string;
    page?: number;
    pageSize?: number;
  } = {}) => req<InvSalePage>("/sales", { query }),

  /** What this student already took this year — the counter's repeat warning. */
  studentPurchases: (studentId: string, ay = "") =>
    req<{
      purchases: {
        itemId: string;
        itemName: string;
        totalQty: number;
        saleCount: number;
        lastSaleDate: string;
        lastSaleNo: string;
      }[];
    }>("/sales", { query: { view: "purchases", studentId, ay } }).then(
      (r) => r.purchases,
    ),

  /** Several children, one payment. One sale each; all of them or none. */
  postHouseholdSale: (input: {
    sales: Record<string, unknown>[];
    payments: { amountPaise: number; mode: string; reference: string }[];
  }) =>
    req<{
      household: {
        sales: {
          saleId: string;
          saleNo: string;
          studentId: string;
          buyerName: string;
          totalPaise: number;
        }[];
        totalPaise: number;
        tenderedPaise: number;
        balancePaise: number;
      };
    }>("/sales", {
      method: "POST",
      body: JSON.stringify({ action: "household", ...input }),
    }).then((r) => r.household),

  /** The other children of one household, for serving a family in one go. */
  householdSiblings: (householdId: string, ay = "") =>
    req<{ siblings: InvBuyerStudent[] }>("/sales", {
      query: { view: "siblings", householdId, ay },
    }).then((r) => r.siblings),

  counterSummary: () =>
    req<{ summary: InvCounterSummary }>("/sales", {
      query: { view: "summary" },
    }).then((r) => r.summary),

  counterPrices: (itemIds: string[], priceListId = "") =>
    req<{
      prices: Record<
        string,
        { salePaise: number; mrpPaise: number; maxDiscountPct: number }
      >;
    }>("/sales", {
      query: { view: "prices", itemIds: itemIds.join(","), priceListId },
    }).then((r) => r.prices),

  postSale: (sale: Record<string, unknown>) =>
    req<{
      sale: {
        saleId: string;
        saleNo: string;
        totalPaise: number;
        paidPaise: number;
        balancePaise: number;
        status: InvSaleStatus;
      };
    }>("/sales", { method: "POST", body: JSON.stringify(sale) }).then(
      (r) => r.sale,
    ),

  collectOnSale: (input: {
    saleId: string;
    amountPaise: number;
    mode?: InvTenderMode;
    reference?: string;
  }) =>
    req<{ paidPaise: number; balancePaise: number; status: InvSaleStatus }>(
      "/sales",
      { method: "POST", body: JSON.stringify({ action: "collect", ...input }) },
    ),

  postSaleReturn: (input: Record<string, unknown>) =>
    req<{
      return: {
        returnNo: string;
        totalPaise: number;
        refundedPaise: number;
        balanceReducedPaise: number;
      };
    }>("/sales", {
      method: "POST",
      body: JSON.stringify({ action: "return", ...input }),
    }).then((r) => r.return),

  voidSale: (saleId: string, reason: string) =>
    req<{ saleNo: string; status: string }>("/sales", {
      method: "POST",
      body: JSON.stringify({ action: "void", saleId, reason }),
    }),

  listSaleReturns: (saleId = "") =>
    req<{ returns: InvSaleReturn[] }>("/sales", {
      query: { view: "returns", saleId },
    }).then((r) => r.returns),

  /* ─── Assets ─────────────────────────────────────────────── */

  listAssets: (query: {
    search?: string;
    itemId?: string;
    locationId?: string;
    status?: string;
  } = {}) =>
    req<{ assets: InvAssetRow[] }>("/assets", { query }).then((r) => r.assets),

  assetSummary: () =>
    req<{ summary: InvAssetSummary }>("/assets", {
      query: { view: "summary" },
    }).then((r) => r.summary),

  assetHistory: (assetId: string) =>
    req<{ events: InvAssetEventRow[] }>("/assets", {
      query: { view: "history", assetId },
    }).then((r) => r.events),

  saveAsset: (asset: Record<string, unknown>) =>
    req<{ asset: InvAssetRow }>("/assets", {
      method: "POST",
      body: JSON.stringify(asset),
    }).then((r) => r.asset),

  bulkRegisterAssets: (input: Record<string, unknown>) =>
    req<{ created: number; firstTag: string; lastTag: string }>("/assets", {
      method: "POST",
      body: JSON.stringify({ action: "bulk", ...input }),
    }),

  removeAsset: (id: string) =>
    req<{ deleted: boolean; reason: string }>("/assets", {
      method: "DELETE",
      query: { id },
    }),

  /* ─── Reports ────────────────────────────────────────────── */

  dashboard: () =>
    req<{ dashboard: InvDashboardData }>("/reports").then((r) => r.dashboard),

  stockReport: (locationId = "", lowOnly = false) =>
    req<{
      rows: InvStockReportRowData[];
      totals: { valuePaise: number; lines: number; belowReorder: number };
    }>("/reports", { query: { report: "stock", locationId, lowOnly } }),

  marginReport: (from: string, to: string) =>
    req<{
      rows: InvMarginRowData[];
      totals: { revenue: number; cost: number; margin: number };
    }>("/reports", { query: { report: "margin", from, to } }),

  daybookReport: (from: string, to: string) =>
    req<{
      rows: InvDaybookRowData[];
      totals: {
        billed: number;
        collected: number;
        outstanding: number;
        margin: number;
      };
    }>("/reports", { query: { report: "daybook", from, to } }),

  inventoryParity: () =>
    req<{
      parity: {
        stockValuePaise: number;
        ledgerValuePaise: number;
        differencePaise: number;
        ledgerActive: boolean;
      };
    }>("/reports", { query: { report: "parity" } }).then((r) => r.parity),

  repeatPurchases: (ay = "") =>
    req<{
      repeats: {
        studentId: string;
        buyerName: string;
        classId: string;
        sectionId: string;
        itemId: string;
        itemName: string;
        saleCount: number;
        totalQty: number;
        totalPaise: number;
        firstSaleDate: string;
        lastSaleDate: string;
        saleNos: string;
        minutesApart: number;
      }[];
    }>("/reports", { query: { report: "repeats", ay } }).then((r) => r.repeats),

  purchaseReport: (from: string, to: string) =>
    req<{
      rows: InvPurchaseRowData[];
      totals: { total: number; outstanding: number };
    }>("/reports", { query: { report: "purchases", from, to } }),
};

/* ─── Hooks ────────────────────────────────────────────────── */

/** Debounce a value — used so a search box queries once, not per letter. */
export function useDebounced<T>(value: T, ms = 300): T {
  const [debounced, setDebounced] = useState(value);
  useEffect(() => {
    const t = setTimeout(() => setDebounced(value), ms);
    return () => clearTimeout(t);
  }, [value, ms]);
  return debounced;
}

export type AsyncState<T> = {
  data: T | null;
  loading: boolean;
  error: string;
  reload: () => void;
};

/**
 * Run an async loader, ignoring responses that arrive out of order.
 *
 * Without the sequence guard a slow response for "sh" can land after the fast
 * one for "shirt" and repaint the table with the wrong rows — the kind of
 * "stale data appears correct" bug that is very hard to see in testing.
 */
export function useAsync<T>(
  load: () => Promise<T>,
  deps: unknown[],
): AsyncState<T> {
  const [data, setData] = useState<T | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState("");
  const [nonce, setNonce] = useState(0);
  const seq = useRef(0);
  const loadRef = useRef(load);
  loadRef.current = load;

  useEffect(() => {
    const mine = ++seq.current;
    let alive = true;
    setLoading(true);
    loadRef
      .current()
      .then((res) => {
        if (!alive || mine !== seq.current) return;
        setData(res);
        setError("");
      })
      .catch((e: unknown) => {
        if (!alive || mine !== seq.current) return;
        setError(e instanceof Error ? e.message : "Could not load");
      })
      .finally(() => {
        if (!alive || mine !== seq.current) return;
        setLoading(false);
      });
    return () => {
      alive = false;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [...deps, nonce]);

  const reload = useCallback(() => setNonce((n) => n + 1), []);
  return { data, loading, error, reload };
}

/** Module-wide masters. Loaded once per mount, refreshed after master edits. */
export function useInvBootstrap() {
  return useAsync<InvBootstrap>(() => invApi.bootstrap(), []);
}

export function useInvItems(query: InvItemQuery) {
  const key = useMemo(() => JSON.stringify(query), [query]);
  return useAsync<InvItemPage>(() => invApi.listItems(query), [key]);
}

/** Wrap a save so the UI gets pending state and a readable error for free. */
export function useSaver() {
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState("");
  const [notice, setNotice] = useState("");

  const run = useCallback(
    async <T>(
      fn: () => Promise<T>,
      opts: { success?: string } = {},
    ): Promise<T | null> => {
      setSaving(true);
      setError("");
      try {
        const out = await fn();
        if (opts.success) setNotice(opts.success);
        return out;
      } catch (e) {
        setError(e instanceof Error ? e.message : "Save failed");
        return null;
      } finally {
        setSaving(false);
      }
    },
    [],
  );

  return { run, saving, error, notice, setError, setNotice };
}
