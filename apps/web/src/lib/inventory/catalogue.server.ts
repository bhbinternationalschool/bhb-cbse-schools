/**
 * Inventory — vendors, classification masters and the item catalogue.
 *
 * Reads are paginated at the database, so the catalogue screen never loads
 * the whole store to show 50 rows, and typing in a filter costs one small
 * query instead of re-parsing every item the browser has ever seen.
 */

import {
  clampPct,
  INV_DEFAULT_SETTINGS,
  InvError,
  invCtx,
  itemToRow,
  nullable,
  orThrow,
  rowToCategory,
  rowToItem,
  rowToLocation,
  rowToPriceList,
  rowToSettings,
  rowToUom,
  rowToVendor,
  rowToVendorRate,
  vendorToRow,
  type InvCtx,
} from "@/lib/inventory/db.server";
import {
  slugCode,
  type InvBootstrap,
  type InvCategory,
  type InvItem,
  type InvItemPage,
  type InvItemQuery,
  type InvItemRow,
  type InvLocation,
  type InvMasterKind,
  type InvSettings,
  type InvUom,
  type InvVendor,
  type InvVendorItemRate,
} from "@/lib/inventory/types";

/* ─── Seeds ────────────────────────────────────────────────── */

const SEED_CATEGORIES: { name: string; kind: "consumable" | "asset" }[] = [
  { name: "Books", kind: "consumable" },
  { name: "Uniform", kind: "consumable" },
  { name: "Stationery", kind: "consumable" },
  { name: "Lab & science", kind: "consumable" },
  { name: "Sports", kind: "consumable" },
  { name: "Housekeeping", kind: "consumable" },
  { name: "Furniture", kind: "asset" },
  { name: "IT equipment", kind: "asset" },
];

const SEED_UOMS: { name: string; decimals: number }[] = [
  { name: "Nos", decimals: 0 },
  { name: "Set", decimals: 0 },
  { name: "Pack", decimals: 0 },
  { name: "Dozen", decimals: 0 },
  { name: "Pair", decimals: 0 },
  { name: "Kg", decimals: 3 },
  { name: "Litre", decimals: 3 },
  { name: "Metre", decimals: 2 },
];

const SEED_LOCATIONS: { name: string; kind: InvLocation["kind"] }[] = [
  { name: "Main store", kind: "store" },
  { name: "Library", kind: "library" },
  { name: "Science lab", kind: "lab" },
  { name: "Computer lab", kind: "lab" },
  { name: "Office", kind: "office" },
];

/**
 * Create the masters a fresh school needs, once.
 *
 * Idempotent by name: the unique indexes make a second run a no-op rather
 * than a duplicate set, so this is safe to call on every bootstrap.
 */
async function seedMastersIfEmpty(ctx: InvCtx): Promise<void> {
  const { sb, tenantId } = ctx;
  const [cats, uoms, locs] = await Promise.all([
    sb.from("inv_categories").select("id").eq("tenant_id", tenantId).limit(1),
    sb.from("inv_uoms").select("id").eq("tenant_id", tenantId).limit(1),
    sb.from("inv_locations").select("id").eq("tenant_id", tenantId).limit(1),
  ]);

  // Supabase builders are thenable but not Promise instances.
  const jobs: PromiseLike<unknown>[] = [];
  if (!cats.error && (cats.data ?? []).length === 0) {
    jobs.push(
      sb.from("inv_categories").insert(
        SEED_CATEGORIES.map((c, i) => ({
          tenant_id: tenantId,
          name: c.name,
          code: slugCode(c.name),
          kind: c.kind,
          sort_order: i + 1,
        })),
      ),
    );
  }
  if (!uoms.error && (uoms.data ?? []).length === 0) {
    jobs.push(
      sb.from("inv_uoms").insert(
        SEED_UOMS.map((u, i) => ({
          tenant_id: tenantId,
          name: u.name,
          code: slugCode(u.name),
          decimals: u.decimals,
          sort_order: i + 1,
        })),
      ),
    );
  }
  if (!locs.error && (locs.data ?? []).length === 0) {
    jobs.push(
      sb.from("inv_locations").insert(
        SEED_LOCATIONS.map((l, i) => ({
          tenant_id: tenantId,
          name: l.name,
          code: slugCode(l.name),
          kind: l.kind,
          sort_order: i + 1,
        })),
      ),
    );
  }
  if (jobs.length) await Promise.all(jobs);
}

/** Ensure a default price list exists so items always have somewhere to be priced. */
async function seedPriceListIfEmpty(
  ctx: InvCtx,
  academicYearCode: string,
): Promise<void> {
  const { sb, tenantId } = ctx;
  const existing = await sb
    .from("inv_price_lists")
    .select("id")
    .eq("tenant_id", tenantId)
    .limit(1);
  if (existing.error || (existing.data ?? []).length > 0) return;
  await sb.from("inv_price_lists").insert({
    tenant_id: tenantId,
    name: "School price list",
    academic_year_code: academicYearCode,
    is_default: true,
    is_active: true,
  });
}

/**
 * Make sure a settings row exists.
 *
 * An absent row is not the same as a configured value, and treating it as one
 * is how a ₹2,25,000 purchase order was issued with no approval: the missing
 * row read as a zero threshold, which the caller took to mean "never require
 * approval". The row is created with the documented defaults instead.
 */
async function seedSettingsIfMissing(ctx: InvCtx): Promise<void> {
  await ctx.sb
    .from("inv_settings")
    .upsert({ tenant_id: ctx.tenantId }, { onConflict: "tenant_id", ignoreDuplicates: true });
}

/* ─── Bootstrap ────────────────────────────────────────────── */

export async function fetchBootstrap(
  academicYearCode: string,
): Promise<InvBootstrap> {
  const ctx = await invCtx();
  await seedSettingsIfMissing(ctx);
  await seedMastersIfEmpty(ctx);
  await seedPriceListIfEmpty(ctx, academicYearCode);
  const { sb, tenantId } = ctx;

  const [cats, uoms, locs, lists, vendors, settings, itemCounts, kitCount] =
    await Promise.all([
      sb
        .from("inv_categories")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("sort_order")
        .order("name"),
      sb
        .from("inv_uoms")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("sort_order")
        .order("name"),
      sb
        .from("inv_locations")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("sort_order")
        .order("name"),
      sb
        .from("inv_price_lists")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("is_default", { ascending: false })
        .order("name"),
      sb
        .from("inv_vendors")
        .select("id, name, code, is_active")
        .eq("tenant_id", tenantId)
        .order("name"),
      sb.from("inv_settings").select("*").eq("tenant_id", tenantId).maybeSingle(),
      sb
        .from("inv_items")
        .select("is_active", { count: "exact" })
        .eq("tenant_id", tenantId),
      sb
        .from("inv_kits")
        .select("id", { count: "exact", head: true })
        .eq("tenant_id", tenantId),
    ]);

  if (cats.error) throw new InvError(`Categories: ${cats.error.message}`, 500);

  const priceListRows = lists.data ?? [];
  const listIds = priceListRows.map((r) => String(r.id));
  const listCounts = await countPriceListItems(ctx, listIds);

  const allItems = (itemCounts.data ?? []) as { is_active: boolean }[];

  return {
    categories: (cats.data ?? []).map(rowToCategory),
    uoms: (uoms.data ?? []).map(rowToUom),
    locations: (locs.data ?? []).map(rowToLocation),
    priceLists: priceListRows.map((r) =>
      rowToPriceList(r, listCounts.get(String(r.id)) ?? 0),
    ),
    vendors: (vendors.data ?? []).map((r) => ({
      id: String(r.id),
      name: String(r.name),
      code: String(r.code ?? ""),
      isActive: r.is_active !== false,
    })),
    settings: rowToSettings(settings.data ?? null),
    counts: {
      items: itemCounts.count ?? allItems.length,
      activeItems: allItems.filter((r) => r.is_active !== false).length,
      vendors: (vendors.data ?? []).length,
      kits: kitCount.count ?? 0,
    },
  };
}

async function countPriceListItems(
  ctx: InvCtx,
  listIds: string[],
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (listIds.length === 0) return out;
  const { data } = await ctx.sb
    .from("inv_price_list_items")
    .select("price_list_id")
    .eq("tenant_id", ctx.tenantId)
    .in("price_list_id", listIds);
  for (const r of data ?? []) {
    const k = String((r as { price_list_id: string }).price_list_id);
    out.set(k, (out.get(k) ?? 0) + 1);
  }
  return out;
}

/* ─── Settings ─────────────────────────────────────────────── */

export async function saveSettings(
  patch: Partial<InvSettings>,
): Promise<InvSettings> {
  const { sb, tenantId } = await invCtx();
  const current = await sb
    .from("inv_settings")
    .select("*")
    .eq("tenant_id", tenantId)
    .maybeSingle();
  const merged = { ...rowToSettings(current.data ?? null), ...patch };
  const data = orThrow(
    await sb
      .from("inv_settings")
      .upsert(
        {
          tenant_id: tenantId,
          po_approval_threshold_paise: Math.max(
            0,
            Math.trunc(merged.poApprovalThresholdPaise) ||
              INV_DEFAULT_SETTINGS.poApprovalThresholdPaise,
          ),
          default_price_list_id: nullable(merged.defaultPriceListId),
          default_location_id: nullable(merged.defaultLocationId),
          costing_method: merged.costingMethod,
          allow_negative_stock: !!merged.allowNegativeStock,
          walkin_sales_enabled: !!merged.walkinSalesEnabled,
          track_gst: !!merged.trackGst,
          gst_credit_eligible: !!merged.gstCreditEligible,
          allow_credit_sales: !!merged.allowCreditSales,
          staff_discount_pct: clampPct(merged.staffDiscountPct),
          doc_prefixes: merged.docPrefixes,
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id" },
      )
      .select("*")
      .single(),
    "Save settings",
  );
  return rowToSettings(data);
}

/* ─── Vendors ──────────────────────────────────────────────── */

export async function listVendors(opts: {
  search?: string;
  status?: "active" | "inactive" | "all";
}): Promise<InvVendor[]> {
  const { sb, tenantId } = await invCtx();
  let q = sb.from("inv_vendors").select("*").eq("tenant_id", tenantId);
  if (opts.status === "active" || !opts.status) q = q.eq("is_active", true);
  else if (opts.status === "inactive") q = q.eq("is_active", false);
  const term = sanitizeSearch(opts.search);
  if (term) {
    q = q.or(
      `name.ilike.%${term}%,code.ilike.%${term}%,phone.ilike.%${term}%,gstin.ilike.%${term}%,contact_person.ilike.%${term}%`,
    );
  }
  const { data, error } = await q.order("name").limit(500);
  if (error) throw new InvError(`Vendors: ${error.message}`, 500);
  return (data ?? []).map(rowToVendor);
}

export async function saveVendor(
  input: Partial<InvVendor> & { name?: string },
  actor: string,
): Promise<InvVendor> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new InvError("Vendor name is required", 400);

  const { sb, tenantId } = await invCtx();
  const row = vendorToRow(tenantId, { ...input, name });

  if (!input.id) {
    row.created_by = actor;
    // Auto-code new vendors so purchase documents always have a short handle.
    if (!row.code) {
      row.code = await nextVendorCode(sb, tenantId);
    }
  }

  const data = orThrow(
    await sb
      .from("inv_vendors")
      .upsert(row, { onConflict: "id" })
      .select("*")
      .single(),
    "Save vendor",
  );
  return rowToVendor(data);
}

async function nextVendorCode(
  sb: InvCtx["sb"],
  tenantId: string,
): Promise<string> {
  const { data } = await sb.rpc("inv_next_doc_no", {
    p_tenant_id: tenantId,
    p_doc_type: "vendor_code",
    p_period: "",
    p_prefix: "VEN",
  });
  // "VEN/0007" → "VEN-0007"; fall back to a timestamp handle if the RPC is
  // unavailable rather than failing the whole save over a cosmetic code.
  const raw = typeof data === "string" ? data : "";
  return raw ? raw.replace(/\//g, "-") : `VEN-${Date.now().toString(36)}`;
}

/**
 * Deactivate a vendor, or delete it when nothing references it.
 *
 * A vendor named on a purchase order is part of the school's records; it is
 * archived, never erased. Only a vendor that was never used can be removed.
 */
export async function removeVendor(
  vendorId: string,
): Promise<{ deleted: boolean; reason: string }> {
  const { sb, tenantId } = await invCtx();
  const [rates, items] = await Promise.all([
    sb
      .from("inv_vendor_item_rates")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("vendor_id", vendorId),
    sb
      .from("inv_items")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("default_vendor_id", vendorId),
  ]);
  const used = (rates.count ?? 0) > 0 || (items.count ?? 0) > 0;

  if (used) {
    const { error } = await sb
      .from("inv_vendors")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", vendorId);
    if (error) throw new InvError(`Deactivate vendor: ${error.message}`, 500);
    return {
      deleted: false,
      reason: "Vendor is in use — marked inactive instead of deleted",
    };
  }

  const { error } = await sb
    .from("inv_vendors")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", vendorId);
  if (error) throw new InvError(`Delete vendor: ${error.message}`, 500);
  return { deleted: true, reason: "Vendor deleted" };
}

/* ─── Vendor item rates ────────────────────────────────────── */

export async function listVendorRates(opts: {
  vendorId?: string;
  itemId?: string;
}): Promise<InvVendorItemRate[]> {
  const { sb, tenantId } = await invCtx();
  let q = sb.from("inv_vendor_item_rates").select("*").eq("tenant_id", tenantId);
  if (opts.vendorId) q = q.eq("vendor_id", opts.vendorId);
  if (opts.itemId) q = q.eq("item_id", opts.itemId);
  const { data, error } = await q.limit(1000);
  if (error) throw new InvError(`Vendor rates: ${error.message}`, 500);
  return (data ?? []).map(rowToVendorRate);
}

export async function saveVendorRate(input: {
  vendorId: string;
  itemId: string;
  ratePaise: number;
  discountPct?: number;
  gstRate?: number;
  leadTimeDays?: number;
  notes?: string;
}): Promise<InvVendorItemRate> {
  if (!input.vendorId || !input.itemId) {
    throw new InvError("Vendor and item are both required for a rate", 400);
  }
  const { sb, tenantId } = await invCtx();
  const data = orThrow(
    await sb
      .from("inv_vendor_item_rates")
      .upsert(
        {
          tenant_id: tenantId,
          vendor_id: input.vendorId,
          item_id: input.itemId,
          rate_paise: Math.max(0, Math.trunc(input.ratePaise) || 0),
          discount_pct: clampPct(input.discountPct),
          gst_rate: clampPct(input.gstRate),
          lead_time_days: Math.max(0, Math.trunc(input.leadTimeDays ?? 0)),
          notes: String(input.notes ?? ""),
          updated_at: new Date().toISOString(),
        },
        { onConflict: "tenant_id,vendor_id,item_id" },
      )
      .select("*")
      .single(),
    "Save vendor rate",
  );
  return rowToVendorRate(data);
}

export async function deleteVendorRate(id: string): Promise<void> {
  const { sb, tenantId } = await invCtx();
  const { error } = await sb
    .from("inv_vendor_item_rates")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) throw new InvError(`Delete rate: ${error.message}`, 500);
}

/* ─── Classification masters ───────────────────────────────── */

const MASTER_TABLE: Record<InvMasterKind, string> = {
  category: "inv_categories",
  uom: "inv_uoms",
  location: "inv_locations",
};

export async function saveMaster(
  kind: InvMasterKind,
  input: Record<string, unknown>,
): Promise<InvCategory | InvUom | InvLocation> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new InvError("Name is required", 400);

  const { sb, tenantId } = await invCtx();
  const base: Record<string, unknown> = {
    tenant_id: tenantId,
    name,
    code: slugCode(String(input.code ?? "") || name),
    sort_order: Math.max(0, Math.trunc(Number(input.sortOrder) || 0)),
    is_active: input.isActive !== false,
    updated_at: new Date().toISOString(),
  };
  if (input.id) base.id = input.id;

  if (kind === "category") {
    base.kind = input.kind === "asset" ? "asset" : "consumable";
    base.parent_id = nullable(input.parentId);
  } else if (kind === "uom") {
    base.decimals = Math.min(3, Math.max(0, Math.trunc(Number(input.decimals) || 0)));
  } else {
    const k = String(input.kind ?? "store");
    base.kind = [
      "store",
      "library",
      "lab",
      "hostel",
      "mess",
      "office",
      "other",
    ].includes(k)
      ? k
      : "store";
  }

  const data = orThrow(
    await sb
      .from(MASTER_TABLE[kind])
      .upsert(base, { onConflict: "id" })
      .select("*")
      .single(),
    `Save ${kind}`,
  );
  const row = data as Record<string, unknown>;
  if (kind === "category") return rowToCategory(row);
  if (kind === "uom") return rowToUom(row);
  return rowToLocation(row);
}

/**
 * Remove a master, or deactivate it when items still point at it.
 *
 * Deleting a category out from under live items would leave rows whose
 * classification silently became "none" — the unknown-becoming-fact defect.
 */
export async function removeMaster(
  kind: InvMasterKind,
  id: string,
): Promise<{ deleted: boolean; reason: string }> {
  const { sb, tenantId } = await invCtx();

  const column =
    kind === "category" ? "category_id" : kind === "uom" ? "uom_id" : "";
  let inUse = false;
  if (column) {
    const { count } = await sb
      .from("inv_items")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq(column, id);
    inUse = (count ?? 0) > 0;
  } else {
    const { count } = await sb
      .from("inv_stock_ledger")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", tenantId)
      .eq("location_id", id);
    inUse = (count ?? 0) > 0;
  }

  if (inUse) {
    const { error } = await sb
      .from(MASTER_TABLE[kind])
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", id);
    if (error) throw new InvError(`Deactivate ${kind}: ${error.message}`, 500);
    return {
      deleted: false,
      reason: `In use — marked inactive instead of deleted`,
    };
  }

  const { error } = await sb
    .from(MASTER_TABLE[kind])
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) throw new InvError(`Delete ${kind}: ${error.message}`, 500);
  return { deleted: true, reason: `${kind} deleted` };
}

/* ─── Items ────────────────────────────────────────────────── */

/** PostgREST `or()` takes a comma-separated filter list — strip its syntax. */
function sanitizeSearch(raw: unknown): string {
  return String(raw ?? "")
    .trim()
    .replace(/[,()*\\%]/g, " ")
    .replace(/\s+/g, " ")
    .slice(0, 60);
}

export async function listItems(query: InvItemQuery): Promise<InvItemPage> {
  const ctx = await invCtx();
  const { sb, tenantId } = ctx;

  const page = Math.max(1, Math.trunc(Number(query.page) || 1));
  const pageSize = Math.min(200, Math.max(5, Math.trunc(Number(query.pageSize) || 50)));
  const sort = query.sort ?? "name";
  const dir = query.sortDir === "desc" ? "desc" : "asc";

  // Stock and margin live outside inv_items, so those sorts (and the low-stock
  // filter) resolve the full matching id set first, then page in memory. The
  // alternative — sorting only the current page — silently lies about order.
  const needsComputed =
    sort === "stock" || sort === "margin" || query.lowStockOnly === true;

  const select =
    "*, category:inv_categories(name), uom:inv_uoms(name, decimals), vendor:inv_vendors(name)";

  // A minimal structural view of the query builder. Passing the fully
  // generic PostgrestFilterBuilder through a helper makes TypeScript expand
  // its type until it gives up ("excessively deep"), and none of that detail
  // is useful here — these are the four methods this function calls.
  type ItemQuery = {
    eq(col: string, val: unknown): ItemQuery;
    or(filter: string): ItemQuery;
    order(col: string, opts: { ascending: boolean }): ItemQuery;
    limit(n: number): PromiseLike<ItemResult>;
    range(from: number, to: number): PromiseLike<ItemResult>;
  };
  type ItemResult = {
    data: Record<string, unknown>[] | null;
    error: { message: string } | null;
    count?: number | null;
  };

  const applyFilters = (q: ItemQuery): ItemQuery => {
    let out = q.eq("tenant_id", tenantId);
    if (query.status === "inactive") out = out.eq("is_active", false);
    else if (query.status !== "all") out = out.eq("is_active", true);
    if (query.categoryId) out = out.eq("category_id", query.categoryId);
    if (query.vendorId) out = out.eq("default_vendor_id", query.vendorId);
    if (query.itemKind) out = out.eq("item_kind", query.itemKind);
    const term = sanitizeSearch(query.search);
    if (term) {
      out = out.or(
        `name.ilike.%${term}%,sku.ilike.%${term}%,barcode.ilike.%${term}%,variant_label.ilike.%${term}%`,
      );
    }
    return out;
  };

  let rawRows: Record<string, unknown>[] = [];
  let total = 0;

  if (needsComputed) {
    const base = sb.from("inv_items").select(select) as unknown as ItemQuery;
    const { data, error } = await applyFilters(base).limit(5000);
    if (error) throw new InvError(`Items: ${error.message}`, 500);
    rawRows = data ?? [];
    total = rawRows.length;
  } else {
    const column =
      sort === "sku" ? "sku" : sort === "updated" ? "updated_at" : "name";
    const base = sb
      .from("inv_items")
      .select(select, { count: "exact" }) as unknown as ItemQuery;
    const { data, error, count } = await applyFilters(base)
      .order(column, { ascending: dir === "asc" })
      .range((page - 1) * pageSize, page * pageSize - 1);
    if (error) throw new InvError(`Items: ${error.message}`, 500);
    rawRows = data ?? [];
    total = count ?? rawRows.length;
  }

  const itemIds = rawRows.map((r) => String(r.id));
  const [balances, prices] = await Promise.all([
    fetchBalances(ctx, itemIds, query.locationId),
    fetchPrices(ctx, itemIds, query.priceListId),
  ]);

  let rows: InvItemRow[] = rawRows.map((r) => {
    const item = rowToItem(r);
    const price = prices.get(item.id);
    const salePaise = price?.salePaise ?? 0;
    const category = r.category as { name?: string } | null;
    const uom = r.uom as { name?: string; decimals?: number } | null;
    const vendor = r.vendor as { name?: string } | null;
    return {
      ...item,
      categoryName: String(category?.name ?? ""),
      uomName: String(uom?.name ?? ""),
      uomDecimals: Number(uom?.decimals ?? 0),
      defaultVendorName: String(vendor?.name ?? ""),
      qtyOnHand: balances.get(item.id) ?? 0,
      salePaise,
      mrpPaise: price?.mrpPaise ?? 0,
      maxDiscountPct: price?.maxDiscountPct ?? 0,
      marginPaise: salePaise ? salePaise - item.avgCostPaise : 0,
    };
  });

  if (needsComputed) {
    if (query.lowStockOnly) {
      rows = rows.filter((r) => r.reorderLevel > 0 && r.qtyOnHand <= r.reorderLevel);
      total = rows.length;
    }
    const mul = dir === "asc" ? 1 : -1;
    rows.sort((a, b) => {
      if (sort === "stock") return (a.qtyOnHand - b.qtyOnHand) * mul;
      if (sort === "margin") return (a.marginPaise - b.marginPaise) * mul;
      return a.name.localeCompare(b.name) * mul;
    });
    rows = rows.slice((page - 1) * pageSize, page * pageSize);
  }

  return { rows, total, page, pageSize };
}

async function fetchBalances(
  ctx: InvCtx,
  itemIds: string[],
  locationId?: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (itemIds.length === 0) return out;
  let q = ctx.sb
    .from("inv_stock_balances")
    .select("item_id, location_id, qty_on_hand")
    .eq("tenant_id", ctx.tenantId)
    .in("item_id", itemIds);
  if (locationId) q = q.eq("location_id", locationId);
  const { data } = await q;
  for (const r of data ?? []) {
    const row = r as { item_id: string; qty_on_hand: number };
    const k = String(row.item_id);
    out.set(k, (out.get(k) ?? 0) + Number(row.qty_on_hand || 0));
  }
  return out;
}

async function fetchPrices(
  ctx: InvCtx,
  itemIds: string[],
  priceListId?: string,
): Promise<
  Map<string, { salePaise: number; mrpPaise: number; maxDiscountPct: number }>
> {
  const out = new Map<
    string,
    { salePaise: number; mrpPaise: number; maxDiscountPct: number }
  >();
  if (itemIds.length === 0) return out;

  const listId = priceListId || (await defaultPriceListId(ctx));
  if (!listId) return out;

  const { data } = await ctx.sb
    .from("inv_price_list_items")
    .select("item_id, sale_paise, mrp_paise, max_discount_pct")
    .eq("tenant_id", ctx.tenantId)
    .eq("price_list_id", listId)
    .in("item_id", itemIds);

  for (const r of data ?? []) {
    const row = r as Record<string, unknown>;
    out.set(String(row.item_id), {
      salePaise: Math.trunc(Number(row.sale_paise) || 0),
      mrpPaise: Math.trunc(Number(row.mrp_paise) || 0),
      maxDiscountPct: Number(row.max_discount_pct) || 0,
    });
  }
  return out;
}

export async function defaultPriceListId(ctx: InvCtx): Promise<string> {
  const { data } = await ctx.sb
    .from("inv_price_lists")
    .select("id")
    .eq("tenant_id", ctx.tenantId)
    .eq("is_default", true)
    .limit(1)
    .maybeSingle();
  return data?.id ? String(data.id) : "";
}

export async function saveItem(
  input: Partial<InvItem> & { name?: string; sku?: string },
  actor: string,
): Promise<InvItem> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new InvError("Item name is required", 400);

  const { sb, tenantId } = await invCtx();
  const sku = String(input.sku ?? "").trim() || (await autoSku(sb, tenantId, name));

  const row = itemToRow(tenantId, { ...input, name, sku });
  if (!input.id) row.created_by = actor;

  const data = orThrow(
    await sb.from("inv_items").upsert(row, { onConflict: "id" }).select("*").single(),
    "Save item",
  );
  return rowToItem(data);
}

/** Derive a readable SKU from the name, with a numeric suffix on collision. */
async function autoSku(
  sb: InvCtx["sb"],
  tenantId: string,
  name: string,
): Promise<string> {
  const base = slugCode(name, "item").toUpperCase().slice(0, 12).replace(/_/g, "-");
  const { data } = await sb
    .from("inv_items")
    .select("sku")
    .eq("tenant_id", tenantId)
    .ilike("sku", `${base}%`)
    .limit(200);
  const taken = new Set((data ?? []).map((r) => String(r.sku).toUpperCase()));
  if (!taken.has(base)) return base;
  for (let i = 2; i < 500; i += 1) {
    const candidate = `${base}-${i}`;
    if (!taken.has(candidate)) return candidate;
  }
  return `${base}-${Date.now().toString(36).toUpperCase()}`;
}

export async function removeItem(
  itemId: string,
): Promise<{ deleted: boolean; reason: string }> {
  const { sb, tenantId } = await invCtx();
  const { count } = await sb
    .from("inv_stock_ledger")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("item_id", itemId);

  if ((count ?? 0) > 0) {
    const { error } = await sb
      .from("inv_items")
      .update({ is_active: false, updated_at: new Date().toISOString() })
      .eq("tenant_id", tenantId)
      .eq("id", itemId);
    if (error) throw new InvError(`Deactivate item: ${error.message}`, 500);
    return {
      deleted: false,
      reason: "Item has stock movements — marked inactive, history kept",
    };
  }

  const { error } = await sb
    .from("inv_items")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", itemId);
  if (error) throw new InvError(`Delete item: ${error.message}`, 500);
  return { deleted: true, reason: "Item deleted" };
}

/** Bulk activate / deactivate / recategorise from the catalogue's selection bar. */
export async function bulkUpdateItems(input: {
  itemIds: string[];
  isActive?: boolean;
  categoryId?: string;
  defaultVendorId?: string;
  gstRate?: number;
  reorderLevel?: number;
}): Promise<number> {
  const ids = (input.itemIds ?? []).filter(Boolean);
  if (ids.length === 0) return 0;

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (typeof input.isActive === "boolean") patch.is_active = input.isActive;
  if (input.categoryId !== undefined) patch.category_id = nullable(input.categoryId);
  if (input.defaultVendorId !== undefined) {
    patch.default_vendor_id = nullable(input.defaultVendorId);
  }
  if (input.gstRate !== undefined) patch.gst_rate = clampPct(input.gstRate);
  if (input.reorderLevel !== undefined) {
    patch.reorder_level = Math.max(0, Number(input.reorderLevel) || 0);
  }
  if (Object.keys(patch).length === 1) return 0;

  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb
    .from("inv_items")
    .update(patch)
    .eq("tenant_id", tenantId)
    .in("id", ids)
    .select("id");
  if (error) throw new InvError(`Bulk update: ${error.message}`, 500);
  return (data ?? []).length;
}

/* ─── Bulk import ──────────────────────────────────────────── */

export type InvBulkItemRow = {
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
};

export type InvBulkItemResult = {
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

/**
 * Create or update many items from one pasted sheet.
 *
 * `dryRun` validates and reports without writing, so the screen can show
 * exactly what will happen and the clerk confirms a result they have already
 * seen. With `dryRun` false the database still refuses to write anything
 * unless every row is sound — a partial catalogue is worse than none, because
 * nobody can tell what landed.
 */
export async function bulkUpsertItems(input: {
  rows: InvBulkItemRow[];
  dryRun: boolean;
  priceListId?: string;
}): Promise<InvBulkItemResult> {
  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb.rpc("inv_bulk_upsert_items", {
    p_tenant_id: tenantId,
    p_actor: "office",
    p_payload: {
      dry_run: input.dryRun,
      price_list_id: input.priceListId ?? "",
      rows: input.rows.map((r) => ({
        sku: r.sku,
        name: r.name,
        category: r.category ?? "",
        uom: r.uom ?? "",
        item_kind: r.itemKind ?? "consumable",
        hsn_code: r.hsnCode ?? "",
        gst_rate: r.gstRate ?? 0,
        reorder_level: r.reorderLevel ?? 0,
        barcode: r.barcode ?? "",
        notes: r.notes ?? "",
        mrp_paise: r.mrpPaise ?? 0,
        sale_paise: r.salePaise ?? 0,
        max_discount_pct: r.maxDiscountPct ?? 0,
      })),
    },
  });
  if (error) throw new InvError(`Bulk import: ${error.message}`, 500);
  return data as unknown as InvBulkItemResult;
}
