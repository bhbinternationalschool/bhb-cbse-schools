/**
 * Inventory & Procurement — shared types (browser + server).
 *
 * Server truth. Nothing in this module is cached in localStorage, so these
 * types describe rows that exist in Postgres, not a client-side state blob.
 * Money is always integer paise; quantity is a plain number (the UOM's
 * `decimals` says how many places the UI should show).
 */

export type InvItemKind = "consumable" | "asset";
export type InvLocationKind =
  | "store"
  | "library"
  | "lab"
  | "hostel"
  | "mess"
  | "office"
  | "other";
export type InvAudience = "student" | "staff" | "both";
export type InvKitPriceMode = "sum" | "fixed";
export type InvCostingMethod = "weighted_avg" | "last_purchase";

export type InvStockKind =
  | "opening"
  | "purchase_in"
  | "purchase_return_out"
  | "sale_out"
  | "sale_return_in"
  | "transfer_out"
  | "transfer_in"
  | "adjust_in"
  | "adjust_out"
  | "consumption"
  | "production";

export type InvVendor = {
  id: string;
  code: string;
  name: string;
  legalName: string;
  gstin: string;
  pan: string;
  contactPerson: string;
  phone: string;
  email: string;
  address: string;
  city: string;
  state: string;
  pincode: string;
  paymentTermsDays: number;
  defaultDiscountPct: number;
  bankAccountName: string;
  bankAccountNo: string;
  bankIfsc: string;
  notes: string;
  isActive: boolean;
  accountsVendorId: string;
  createdAt: string;
  updatedAt: string;
};

export type InvCategory = {
  id: string;
  name: string;
  code: string;
  kind: InvItemKind;
  parentId: string;
  sortOrder: number;
  isActive: boolean;
};

export type InvUom = {
  id: string;
  name: string;
  code: string;
  decimals: number;
  sortOrder: number;
  isActive: boolean;
};

export type InvLocation = {
  id: string;
  name: string;
  code: string;
  kind: InvLocationKind;
  sortOrder: number;
  isActive: boolean;
};

export type InvItem = {
  id: string;
  sku: string;
  name: string;
  categoryId: string;
  uomId: string;
  itemKind: InvItemKind;
  variantOf: string;
  variantLabel: string;
  hsnCode: string;
  gstRate: number;
  reorderLevel: number;
  defaultVendorId: string;
  /** Weighted-average landed cost. Maintained by goods receipts, read-only in UI. */
  avgCostPaise: number;
  lastPurchasePaise: number;
  barcode: string;
  notes: string;
  isActive: boolean;
  createdAt: string;
  updatedAt: string;
};

/** An item joined with the numbers the catalogue screen shows. */
export type InvItemRow = InvItem & {
  categoryName: string;
  uomName: string;
  uomDecimals: number;
  defaultVendorName: string;
  qtyOnHand: number;
  /** Sale price from the price list the query asked for; 0 when unpriced. */
  salePaise: number;
  mrpPaise: number;
  maxDiscountPct: number;
  /** salePaise − avgCostPaise. Negative means we sell below cost. */
  marginPaise: number;
};

export type InvVendorItemRate = {
  id: string;
  vendorId: string;
  itemId: string;
  ratePaise: number;
  discountPct: number;
  gstRate: number;
  leadTimeDays: number;
  lastPurchasedOn: string;
  notes: string;
  /** Net of discount — what a PO line defaults to. */
  netRatePaise: number;
};

export type InvPriceList = {
  id: string;
  name: string;
  academicYearCode: string;
  effectiveFrom: string;
  isDefault: boolean;
  isActive: boolean;
  notes: string;
  itemCount: number;
};

export type InvPriceListItem = {
  id: string;
  priceListId: string;
  itemId: string;
  mrpPaise: number;
  salePaise: number;
  maxDiscountPct: number;
};

export type InvKitItem = {
  id: string;
  kitId: string;
  itemId: string;
  qty: number;
  isOptional: boolean;
  sortOrder: number;
};

export type InvKit = {
  id: string;
  name: string;
  code: string;
  academicYearCode: string;
  priceMode: InvKitPriceMode;
  fixedPricePaise: number;
  audience: InvAudience;
  notes: string;
  sortOrder: number;
  isActive: boolean;
};

/** A kit with its lines and the classes it is assigned to. */
export type InvKitDetail = InvKit & {
  items: (InvKitItem & {
    sku: string;
    name: string;
    variantLabel: string;
    salePaise: number;
    avgCostPaise: number;
  })[];
  classIds: string[];
  /** Sum of non-optional lines at price-list rates. */
  computedPricePaise: number;
  /** What the counter would actually charge (fixed price when set). */
  effectivePricePaise: number;
};

export type InvStockLedgerRow = {
  id: string;
  itemId: string;
  locationId: string;
  at: string;
  qtyDelta: number;
  unitCostPaise: number;
  kind: InvStockKind;
  refType: string;
  refId: string;
  refNo: string;
  note: string;
  createdBy: string;
  /** Running balance, filled by the stock-card query. */
  balance?: number;
};

export type InvStockBalance = {
  itemId: string;
  locationId: string;
  qtyOnHand: number;
  lastMoveAt: string;
};

export type InvSettings = {
  poApprovalThresholdPaise: number;
  defaultPriceListId: string;
  defaultLocationId: string;
  costingMethod: InvCostingMethod;
  allowNegativeStock: boolean;
  walkinSalesEnabled: boolean;
  trackGst: boolean;
  docPrefixes: Record<string, string>;
};

/** One call that boots the whole module shell. */
export type InvBootstrap = {
  categories: InvCategory[];
  uoms: InvUom[];
  locations: InvLocation[];
  priceLists: InvPriceList[];
  vendors: Pick<InvVendor, "id" | "name" | "code" | "isActive">[];
  settings: InvSettings;
  counts: {
    items: number;
    activeItems: number;
    vendors: number;
    kits: number;
  };
};

export type InvItemQuery = {
  search?: string;
  categoryId?: string;
  vendorId?: string;
  itemKind?: InvItemKind | "";
  priceListId?: string;
  locationId?: string;
  /** "all" includes inactive rows; default lists active only. */
  status?: "active" | "inactive" | "all";
  lowStockOnly?: boolean;
  page?: number;
  pageSize?: number;
  sort?: "name" | "sku" | "stock" | "margin" | "updated";
  sortDir?: "asc" | "desc";
};

export type InvItemPage = {
  rows: InvItemRow[];
  total: number;
  page: number;
  pageSize: number;
};

export const INV_MASTER_KINDS = ["category", "uom", "location"] as const;
export type InvMasterKind = (typeof INV_MASTER_KINDS)[number];

/* ─── Money + quantity helpers (pure; safe on both sides) ──── */

export function paiseToInput(paise: number): string {
  if (!Number.isFinite(paise) || paise === 0) return "";
  return (paise / 100).toFixed(2).replace(/\.00$/, "");
}

export function inputToPaise(text: string): number {
  const n = Number(String(text ?? "").replace(/[₹,\s]/g, ""));
  if (!Number.isFinite(n)) return 0;
  return Math.round(n * 100);
}

export function formatPaise(paise: number): string {
  const v = (Number(paise) || 0) / 100;
  return `₹${v.toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

export function formatQty(qty: number, decimals = 0): string {
  const n = Number(qty) || 0;
  return n.toLocaleString("en-IN", {
    minimumFractionDigits: decimals,
    maximumFractionDigits: decimals,
  });
}

/** Margin as a percentage of the sale price — the number the dashboard shows. */
export function marginPct(salePaise: number, costPaise: number): number {
  if (!salePaise) return 0;
  return Math.round(((salePaise - costPaise) / salePaise) * 1000) / 10;
}

export function slugCode(text: string, fallback = ""): string {
  const s = String(text ?? "")
    .trim()
    .toLowerCase()
    .replace(/[^a-z0-9]+/g, "_")
    .replace(/^_|_$/g, "")
    .slice(0, 32);
  return s || fallback;
}
