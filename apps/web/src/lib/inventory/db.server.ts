/**
 * Inventory — Supabase context and row mappers.
 *
 * Every read and write in this module goes through here, so there is exactly
 * one place that knows the column names. Callers work in typed domain objects.
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import { getServerTenantContext } from "@/lib/serverTenant";
import type {
  InvAudience,
  InvCategory,
  InvCostingMethod,
  InvItem,
  InvItemKind,
  InvKit,
  InvKitItem,
  InvKitPriceMode,
  InvLocation,
  InvLocationKind,
  InvPriceList,
  InvPriceListItem,
  InvSettings,
  InvStockKind,
  InvStockLedgerRow,
  InvUom,
  InvVendor,
  InvVendorItemRate,
} from "@/lib/inventory/types";

export type InvCtx = { sb: SupabaseClient; tenantId: string };

export class InvError extends Error {
  status: number;
  constructor(message: string, status = 400) {
    super(message);
    this.status = status;
  }
}

/**
 * Resolve tenant + service client, or throw.
 *
 * Throwing rather than returning null is deliberate: a route that cannot
 * reach the database must fail loudly with 503. The old store desk swallowed
 * this and reported success, which is how an empty database looked like a
 * healthy one for weeks.
 */
export async function invCtx(): Promise<InvCtx> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    throw new InvError("Database unavailable — tenant could not be resolved", 503);
  }
  return ctx;
}

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const int = (v: unknown): number => Math.trunc(num(v));
const bool = (v: unknown, dflt = false): boolean =>
  typeof v === "boolean" ? v : dflt;
const dateOnly = (v: unknown): string => str(v).slice(0, 10);

/* ─── Vendors ──────────────────────────────────────────────── */

export function rowToVendor(r: Row): InvVendor {
  return {
    id: str(r.id),
    code: str(r.code),
    name: str(r.name),
    legalName: str(r.legal_name),
    gstin: str(r.gstin),
    pan: str(r.pan),
    contactPerson: str(r.contact_person),
    phone: str(r.phone),
    email: str(r.email),
    address: str(r.address),
    city: str(r.city),
    state: str(r.state),
    pincode: str(r.pincode),
    paymentTermsDays: int(r.payment_terms_days),
    defaultDiscountPct: num(r.default_discount_pct),
    bankAccountName: str(r.bank_account_name),
    bankAccountNo: str(r.bank_account_no),
    bankIfsc: str(r.bank_ifsc),
    notes: str(r.notes),
    isActive: bool(r.is_active, true),
    accountsVendorId: str(r.accounts_vendor_id),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function vendorToRow(
  tenantId: string,
  v: Partial<InvVendor> & { name: string },
): Row {
  const row: Row = {
    tenant_id: tenantId,
    name: v.name.trim(),
    code: str(v.code).trim(),
    legal_name: str(v.legalName).trim(),
    gstin: str(v.gstin).trim().toUpperCase(),
    pan: str(v.pan).trim().toUpperCase(),
    contact_person: str(v.contactPerson).trim(),
    phone: str(v.phone).trim(),
    email: str(v.email).trim(),
    address: str(v.address).trim(),
    city: str(v.city).trim(),
    state: str(v.state).trim(),
    pincode: str(v.pincode).trim(),
    payment_terms_days: Math.max(0, int(v.paymentTermsDays)),
    default_discount_pct: clampPct(v.defaultDiscountPct),
    bank_account_name: str(v.bankAccountName).trim(),
    bank_account_no: str(v.bankAccountNo).trim(),
    bank_ifsc: str(v.bankIfsc).trim().toUpperCase(),
    notes: str(v.notes),
    is_active: v.isActive !== false,
    accounts_vendor_id: str(v.accountsVendorId),
    updated_at: new Date().toISOString(),
  };
  if (v.id) row.id = v.id;
  return row;
}

/* ─── Masters ──────────────────────────────────────────────── */

export function rowToCategory(r: Row): InvCategory {
  return {
    id: str(r.id),
    name: str(r.name),
    code: str(r.code),
    kind: (str(r.kind) === "asset" ? "asset" : "consumable") as InvItemKind,
    parentId: str(r.parent_id),
    sortOrder: int(r.sort_order),
    isActive: bool(r.is_active, true),
  };
}

export function rowToUom(r: Row): InvUom {
  return {
    id: str(r.id),
    name: str(r.name),
    code: str(r.code),
    decimals: Math.min(3, Math.max(0, int(r.decimals))),
    sortOrder: int(r.sort_order),
    isActive: bool(r.is_active, true),
  };
}

const LOCATION_KINDS: InvLocationKind[] = [
  "store",
  "library",
  "lab",
  "hostel",
  "mess",
  "office",
  "other",
];

export function rowToLocation(r: Row): InvLocation {
  const kind = str(r.kind) as InvLocationKind;
  return {
    id: str(r.id),
    name: str(r.name),
    code: str(r.code),
    kind: LOCATION_KINDS.includes(kind) ? kind : "store",
    sortOrder: int(r.sort_order),
    isActive: bool(r.is_active, true),
  };
}

/* ─── Items ────────────────────────────────────────────────── */

export function rowToItem(r: Row): InvItem {
  return {
    id: str(r.id),
    sku: str(r.sku),
    name: str(r.name),
    categoryId: str(r.category_id),
    uomId: str(r.uom_id),
    itemKind: (str(r.item_kind) === "asset" ? "asset" : "consumable") as InvItemKind,
    variantOf: str(r.variant_of),
    variantLabel: str(r.variant_label),
    hsnCode: str(r.hsn_code),
    gstRate: num(r.gst_rate),
    reorderLevel: num(r.reorder_level),
    defaultVendorId: str(r.default_vendor_id),
    avgCostPaise: int(r.avg_cost_paise),
    lastPurchasePaise: int(r.last_purchase_paise),
    barcode: str(r.barcode),
    notes: str(r.notes),
    isActive: bool(r.is_active, true),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export function itemToRow(
  tenantId: string,
  i: Partial<InvItem> & { name: string; sku: string },
): Row {
  const row: Row = {
    tenant_id: tenantId,
    sku: i.sku.trim(),
    name: i.name.trim(),
    category_id: nullable(i.categoryId),
    uom_id: nullable(i.uomId),
    item_kind: i.itemKind === "asset" ? "asset" : "consumable",
    variant_of: nullable(i.variantOf),
    variant_label: str(i.variantLabel).trim(),
    hsn_code: str(i.hsnCode).trim(),
    gst_rate: clampPct(i.gstRate),
    reorder_level: Math.max(0, num(i.reorderLevel)),
    default_vendor_id: nullable(i.defaultVendorId),
    barcode: str(i.barcode).trim(),
    notes: str(i.notes),
    is_active: i.isActive !== false,
    updated_at: new Date().toISOString(),
  };
  if (i.id) row.id = i.id;
  // avg_cost_paise / last_purchase_paise are never client-set: goods receipts
  // own them. Accepting them here would let the counter edit its own margin.
  return row;
}

/* ─── Vendor rates ─────────────────────────────────────────── */

export function rowToVendorRate(r: Row): InvVendorItemRate {
  const rate = int(r.rate_paise);
  const disc = num(r.discount_pct);
  return {
    id: str(r.id),
    vendorId: str(r.vendor_id),
    itemId: str(r.item_id),
    ratePaise: rate,
    discountPct: disc,
    gstRate: num(r.gst_rate),
    leadTimeDays: int(r.lead_time_days),
    lastPurchasedOn: dateOnly(r.last_purchased_on),
    notes: str(r.notes),
    netRatePaise: Math.round(rate * (1 - clampPct(disc) / 100)),
  };
}

/* ─── Pricing ──────────────────────────────────────────────── */

export function rowToPriceList(r: Row, itemCount = 0): InvPriceList {
  return {
    id: str(r.id),
    name: str(r.name),
    academicYearCode: str(r.academic_year_code),
    effectiveFrom: dateOnly(r.effective_from),
    isDefault: bool(r.is_default),
    isActive: bool(r.is_active, true),
    notes: str(r.notes),
    itemCount,
  };
}

export function rowToPriceListItem(r: Row): InvPriceListItem {
  return {
    id: str(r.id),
    priceListId: str(r.price_list_id),
    itemId: str(r.item_id),
    mrpPaise: int(r.mrp_paise),
    salePaise: int(r.sale_paise),
    maxDiscountPct: num(r.max_discount_pct),
  };
}

/* ─── Kits ─────────────────────────────────────────────────── */

export function rowToKit(r: Row): InvKit {
  const mode = str(r.price_mode) === "fixed" ? "fixed" : "sum";
  const audience = str(r.audience);
  return {
    id: str(r.id),
    name: str(r.name),
    code: str(r.code),
    academicYearCode: str(r.academic_year_code),
    priceMode: mode as InvKitPriceMode,
    fixedPricePaise: int(r.fixed_price_paise),
    audience: (["student", "staff", "both"].includes(audience)
      ? audience
      : "student") as InvAudience,
    notes: str(r.notes),
    sortOrder: int(r.sort_order),
    isActive: bool(r.is_active, true),
  };
}

export function rowToKitItem(r: Row): InvKitItem {
  return {
    id: str(r.id),
    kitId: str(r.kit_id),
    itemId: str(r.item_id),
    qty: Math.max(0, num(r.qty)),
    isOptional: bool(r.is_optional),
    sortOrder: int(r.sort_order),
  };
}

/* ─── Stock ────────────────────────────────────────────────── */

export function rowToLedger(r: Row): InvStockLedgerRow {
  return {
    id: str(r.id),
    itemId: str(r.item_id),
    locationId: str(r.location_id),
    at: str(r.at),
    qtyDelta: num(r.qty_delta),
    unitCostPaise: int(r.unit_cost_paise),
    kind: str(r.kind) as InvStockKind,
    refType: str(r.ref_type),
    refId: str(r.ref_id),
    refNo: str(r.ref_no),
    note: str(r.note),
    createdBy: str(r.created_by),
  };
}

/* ─── Settings ─────────────────────────────────────────────── */

export const INV_DEFAULT_SETTINGS: InvSettings = {
  poApprovalThresholdPaise: 1_000_000,
  defaultPriceListId: "",
  defaultLocationId: "",
  costingMethod: "weighted_avg",
  allowNegativeStock: false,
  walkinSalesEnabled: true,
  trackGst: true,
  docPrefixes: {
    indent: "IND",
    po: "PO",
    grn: "GRN",
    sale: "SL",
    sale_return: "SR",
    purchase_return: "PR",
    adjust: "ADJ",
    transfer: "TRF",
    vendor: "VEN",
  },
};

export function rowToSettings(r: Row | null): InvSettings {
  if (!r) return { ...INV_DEFAULT_SETTINGS };
  const prefixes =
    r.doc_prefixes && typeof r.doc_prefixes === "object"
      ? (r.doc_prefixes as Record<string, string>)
      : {};
  const method = str(r.costing_method);
  return {
    poApprovalThresholdPaise: int(r.po_approval_threshold_paise),
    defaultPriceListId: str(r.default_price_list_id),
    defaultLocationId: str(r.default_location_id),
    costingMethod: (method === "last_purchase"
      ? "last_purchase"
      : "weighted_avg") as InvCostingMethod,
    allowNegativeStock: bool(r.allow_negative_stock),
    walkinSalesEnabled: bool(r.walkin_sales_enabled, true),
    trackGst: bool(r.track_gst, true),
    docPrefixes: { ...INV_DEFAULT_SETTINGS.docPrefixes, ...prefixes },
  };
}

/* ─── Small shared helpers ─────────────────────────────────── */

/** Empty string → null, so an unset FK stores as NULL rather than ''. */
export function nullable(v: unknown): string | null {
  const s = str(v).trim();
  return s ? s : null;
}

export function clampPct(v: unknown): number {
  const n = num(v);
  if (n < 0) return 0;
  if (n > 100) return 100;
  return Math.round(n * 100) / 100;
}

/**
 * Throw the Supabase error as an InvError so routes map it to a status.
 *
 * Returns the row untyped on purpose — the caller passes it straight to its
 * `rowTo*` mapper, which is the one place that knows the column shape.
 */
export function orThrow(
  result: { data: unknown; error: { message: string; code?: string } | null },
  what: string,
): Record<string, unknown> {
  if (result.error) {
    const code = result.error.code || "";
    // 23505 unique_violation — a duplicate name/SKU is the user's problem,
    // not a server fault, so it must not read as a 500.
    if (code === "23505") {
      throw new InvError(`${what}: that name or code is already used`, 409);
    }
    if (code === "42501") {
      throw new InvError(
        `${what}: database permission denied — the table is missing a service_role grant`,
        500,
      );
    }
    throw new InvError(`${what}: ${result.error.message}`, 500);
  }
  if (result.data == null || typeof result.data !== "object") {
    throw new InvError(`${what}: no data returned`, 500);
  }
  return result.data as Record<string, unknown>;
}
