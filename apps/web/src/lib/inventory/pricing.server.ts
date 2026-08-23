/**
 * Inventory — price lists and kits.
 *
 * This is the half of the module that answers "how do we sell it": a price
 * list holds MRP / school price / max discount per item, and a kit bundles
 * items and assigns them to class groups so the counter knows what a Class 6
 * student is supposed to receive.
 */

import {
  clampPct,
  InvError,
  invCtx,
  nullable,
  orThrow,
  rowToKit,
  rowToKitItem,
  rowToPriceList,
  rowToPriceListItem,
  type InvCtx,
} from "@/lib/inventory/db.server";
import { defaultPriceListId } from "@/lib/inventory/catalogue.server";
import {
  slugCode,
  type InvKit,
  type InvKitDetail,
  type InvPriceList,
  type InvPriceListItem,
} from "@/lib/inventory/types";

/* ─── Price lists ──────────────────────────────────────────── */

export async function savePriceList(
  input: Partial<InvPriceList> & { name?: string },
): Promise<InvPriceList> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new InvError("Price list name is required", 400);

  const { sb, tenantId } = await invCtx();
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    name,
    academic_year_code: String(input.academicYearCode ?? ""),
    effective_from: nullable(input.effectiveFrom),
    is_active: input.isActive !== false,
    notes: String(input.notes ?? ""),
    updated_at: new Date().toISOString(),
  };
  if (input.id) row.id = input.id;

  // One default per year is a partial unique index; clear the old one first
  // so the upsert cannot trip over it.
  if (input.isDefault) {
    await sb
      .from("inv_price_lists")
      .update({ is_default: false })
      .eq("tenant_id", tenantId)
      .eq("academic_year_code", String(input.academicYearCode ?? ""))
      .eq("is_default", true);
    row.is_default = true;
  } else if (input.id) {
    row.is_default = false;
  }

  const data = orThrow(
    await sb
      .from("inv_price_lists")
      .upsert(row, { onConflict: "id" })
      .select("*")
      .single(),
    "Save price list",
  );
  return rowToPriceList(data);
}

export async function removePriceList(id: string): Promise<void> {
  const { sb, tenantId } = await invCtx();
  const { data: row } = await sb
    .from("inv_price_lists")
    .select("is_default")
    .eq("tenant_id", tenantId)
    .eq("id", id)
    .maybeSingle();
  if (row?.is_default) {
    throw new InvError(
      "The default price list cannot be deleted — make another list the default first",
      409,
    );
  }
  const { error } = await sb
    .from("inv_price_lists")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", id);
  if (error) throw new InvError(`Delete price list: ${error.message}`, 500);
}

export async function listPriceListItems(
  priceListId: string,
): Promise<InvPriceListItem[]> {
  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb
    .from("inv_price_list_items")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("price_list_id", priceListId)
    .limit(5000);
  if (error) throw new InvError(`Price list items: ${error.message}`, 500);
  return (data ?? []).map(rowToPriceListItem);
}

/**
 * Set prices for one or more items on a list.
 *
 * Takes an array so the catalogue's inline price editing can save a whole
 * edited page in one request instead of one call per cell.
 */
export async function savePrices(input: {
  priceListId: string;
  rows: {
    itemId: string;
    salePaise: number;
    mrpPaise?: number;
    maxDiscountPct?: number;
  }[];
}): Promise<number> {
  const priceListId = String(input.priceListId ?? "").trim();
  if (!priceListId) throw new InvError("Price list is required", 400);
  const rows = (input.rows ?? []).filter((r) => r && r.itemId);
  if (rows.length === 0) return 0;

  const { sb, tenantId } = await invCtx();
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("inv_price_list_items")
    .upsert(
      rows.map((r) => ({
        tenant_id: tenantId,
        price_list_id: priceListId,
        item_id: r.itemId,
        sale_paise: Math.max(0, Math.trunc(r.salePaise) || 0),
        mrp_paise: Math.max(0, Math.trunc(r.mrpPaise ?? 0) || 0),
        max_discount_pct: clampPct(r.maxDiscountPct),
        updated_at: now,
      })),
      { onConflict: "tenant_id,price_list_id,item_id" },
    )
    .select("id");
  if (error) throw new InvError(`Save prices: ${error.message}`, 500);
  return (data ?? []).length;
}

export async function clearPrice(
  priceListId: string,
  itemId: string,
): Promise<void> {
  const { sb, tenantId } = await invCtx();
  const { error } = await sb
    .from("inv_price_list_items")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("price_list_id", priceListId)
    .eq("item_id", itemId);
  if (error) throw new InvError(`Clear price: ${error.message}`, 500);
}

/**
 * Copy every price from one list to another — how next year's list starts.
 *
 * `markupPct` lets the copy raise prices in one step (5 = +5%).
 */
export async function copyPriceList(input: {
  fromId: string;
  toId: string;
  markupPct?: number;
  overwrite?: boolean;
}): Promise<number> {
  const { sb, tenantId } = await invCtx();
  if (!input.fromId || !input.toId || input.fromId === input.toId) {
    throw new InvError("Choose two different price lists", 400);
  }

  const source = await listPriceListItems(input.fromId);
  if (source.length === 0) return 0;

  let rows = source;
  if (!input.overwrite) {
    const existing = await listPriceListItems(input.toId);
    const taken = new Set(existing.map((r) => r.itemId));
    rows = rows.filter((r) => !taken.has(r.itemId));
  }
  if (rows.length === 0) return 0;

  const factor = 1 + (Number(input.markupPct) || 0) / 100;
  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("inv_price_list_items")
    .upsert(
      rows.map((r) => ({
        tenant_id: tenantId,
        price_list_id: input.toId,
        item_id: r.itemId,
        sale_paise: Math.max(0, Math.round(r.salePaise * factor)),
        mrp_paise: Math.max(0, Math.round(r.mrpPaise * factor)),
        max_discount_pct: r.maxDiscountPct,
        updated_at: now,
      })),
      { onConflict: "tenant_id,price_list_id,item_id" },
    )
    .select("id");
  if (error) throw new InvError(`Copy price list: ${error.message}`, 500);
  return (data ?? []).length;
}

/* ─── Kits ─────────────────────────────────────────────────── */

export async function listKits(opts: {
  academicYearCode?: string;
  classId?: string;
  status?: "active" | "all";
}): Promise<InvKitDetail[]> {
  const ctx = await invCtx();
  const { sb, tenantId } = ctx;

  let q = sb.from("inv_kits").select("*").eq("tenant_id", tenantId);
  if (opts.status !== "all") q = q.eq("is_active", true);
  if (opts.academicYearCode) {
    q = q.eq("academic_year_code", opts.academicYearCode);
  }
  const { data, error } = await q.order("sort_order").order("name");
  if (error) throw new InvError(`Kits: ${error.message}`, 500);

  const kits = (data ?? []).map(rowToKit);
  if (kits.length === 0) return [];
  const kitIds = kits.map((k) => k.id);

  const [lineRes, classRes] = await Promise.all([
    sb
      .from("inv_kit_items")
      .select("*, item:inv_items(sku, name, variant_label, avg_cost_paise)")
      .eq("tenant_id", tenantId)
      .in("kit_id", kitIds)
      .order("sort_order"),
    sb
      .from("inv_kit_classes")
      .select("kit_id, class_id")
      .eq("tenant_id", tenantId)
      .in("kit_id", kitIds),
  ]);

  const lineRows = (lineRes.data ?? []) as Record<string, unknown>[];
  const itemIds = [...new Set(lineRows.map((r) => String(r.item_id)))];
  const prices = await priceMap(ctx, itemIds, "");

  const linesByKit = new Map<string, InvKitDetail["items"]>();
  for (const r of lineRows) {
    const base = rowToKitItem(r);
    const item = r.item as Record<string, unknown> | null;
    const entry = {
      ...base,
      sku: String(item?.sku ?? ""),
      name: String(item?.name ?? ""),
      variantLabel: String(item?.variant_label ?? ""),
      salePaise: prices.get(base.itemId) ?? 0,
      avgCostPaise: Math.trunc(Number(item?.avg_cost_paise) || 0),
    };
    const list = linesByKit.get(base.kitId) ?? [];
    list.push(entry);
    linesByKit.set(base.kitId, list);
  }

  const classesByKit = new Map<string, string[]>();
  for (const r of classRes.data ?? []) {
    const row = r as { kit_id: string; class_id: string };
    const list = classesByKit.get(String(row.kit_id)) ?? [];
    list.push(String(row.class_id));
    classesByKit.set(String(row.kit_id), list);
  }

  const details: InvKitDetail[] = kits.map((k) => {
    const items = linesByKit.get(k.id) ?? [];
    const computed = items
      .filter((l) => !l.isOptional)
      .reduce((sum, l) => sum + l.salePaise * l.qty, 0);
    return {
      ...k,
      items,
      classIds: classesByKit.get(k.id) ?? [],
      computedPricePaise: computed,
      effectivePricePaise:
        k.priceMode === "fixed" ? k.fixedPricePaise : computed,
    };
  });

  if (opts.classId) {
    return details.filter((k) => k.classIds.includes(opts.classId as string));
  }
  return details;
}

async function priceMap(
  ctx: InvCtx,
  itemIds: string[],
  priceListId: string,
): Promise<Map<string, number>> {
  const out = new Map<string, number>();
  if (itemIds.length === 0) return out;
  const listId = priceListId || (await defaultPriceListId(ctx));
  if (!listId) return out;
  const { data } = await ctx.sb
    .from("inv_price_list_items")
    .select("item_id, sale_paise")
    .eq("tenant_id", ctx.tenantId)
    .eq("price_list_id", listId)
    .in("item_id", itemIds);
  for (const r of data ?? []) {
    const row = r as { item_id: string; sale_paise: number };
    out.set(String(row.item_id), Math.trunc(Number(row.sale_paise) || 0));
  }
  return out;
}

/**
 * Create or replace a kit together with its lines and class assignments.
 *
 * Lines and classes are replaced wholesale inside one save, because a kit is
 * edited as a single document. The delete is scoped to this kit's id — it can
 * never reach another kit's rows, unlike the blanket "prune anything the
 * client did not send" the old desk sync used.
 */
export async function saveKit(input: {
  id?: string;
  name?: string;
  code?: string;
  academicYearCode?: string;
  priceMode?: "sum" | "fixed";
  fixedPricePaise?: number;
  audience?: "student" | "staff" | "both";
  notes?: string;
  sortOrder?: number;
  isActive?: boolean;
  items?: { itemId: string; qty?: number; isOptional?: boolean }[];
  classIds?: string[];
}): Promise<InvKit> {
  const name = String(input.name ?? "").trim();
  if (!name) throw new InvError("Kit name is required", 400);

  const { sb, tenantId } = await invCtx();
  const row: Record<string, unknown> = {
    tenant_id: tenantId,
    name,
    code: slugCode(String(input.code ?? "") || name),
    academic_year_code: String(input.academicYearCode ?? ""),
    price_mode: input.priceMode === "fixed" ? "fixed" : "sum",
    fixed_price_paise: Math.max(0, Math.trunc(input.fixedPricePaise ?? 0) || 0),
    audience: ["student", "staff", "both"].includes(String(input.audience))
      ? input.audience
      : "student",
    notes: String(input.notes ?? ""),
    sort_order: Math.max(0, Math.trunc(Number(input.sortOrder) || 0)),
    is_active: input.isActive !== false,
    updated_at: new Date().toISOString(),
  };
  if (input.id) row.id = input.id;

  const saved = orThrow(
    await sb.from("inv_kits").upsert(row, { onConflict: "id" }).select("*").single(),
    "Save kit",
  );
  const kit = rowToKit(saved);

  if (Array.isArray(input.items)) {
    await sb
      .from("inv_kit_items")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("kit_id", kit.id);
    const lines = input.items
      .filter((l) => l && l.itemId)
      .map((l, i) => ({
        tenant_id: tenantId,
        kit_id: kit.id,
        item_id: l.itemId,
        qty: Math.max(0, Number(l.qty ?? 1) || 1),
        is_optional: !!l.isOptional,
        sort_order: i + 1,
      }));
    if (lines.length) {
      const { error } = await sb.from("inv_kit_items").insert(lines);
      if (error) throw new InvError(`Save kit items: ${error.message}`, 500);
    }
  }

  if (Array.isArray(input.classIds)) {
    await sb
      .from("inv_kit_classes")
      .delete()
      .eq("tenant_id", tenantId)
      .eq("kit_id", kit.id);
    const classRows = [...new Set(input.classIds.filter(Boolean))].map((c) => ({
      tenant_id: tenantId,
      kit_id: kit.id,
      class_id: String(c),
      section_id: "",
    }));
    if (classRows.length) {
      const { error } = await sb.from("inv_kit_classes").insert(classRows);
      if (error) throw new InvError(`Save kit classes: ${error.message}`, 500);
    }
  }

  return kit;
}

export async function removeKit(kitId: string): Promise<void> {
  const { sb, tenantId } = await invCtx();
  // Lines and class links cascade on the FK; the kit row is the only delete.
  const { error } = await sb
    .from("inv_kits")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", kitId);
  if (error) throw new InvError(`Delete kit: ${error.message}`, 500);
}
