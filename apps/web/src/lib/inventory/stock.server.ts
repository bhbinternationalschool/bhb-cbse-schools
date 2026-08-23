/**
 * Inventory — the stock ledger.
 *
 * On-hand quantity is never a stored, editable field. It is the sum of this
 * append-only ledger, so the register always reconciles with its own history
 * and no screen can quietly set a balance to a number nothing explains.
 * Corrections are new rows carrying a reason, not edits to old ones.
 */

import {
  InvError,
  invCtx,
  nullable,
  rowToLedger,
  type InvCtx,
} from "@/lib/inventory/db.server";
import type {
  InvStockBalance,
  InvStockKind,
  InvStockLedgerRow,
} from "@/lib/inventory/types";

export type StockCardRow = InvStockLedgerRow & {
  balance: number;
  locationName: string;
};

/** Full movement history for one item, oldest first, with a running balance. */
export async function stockCard(
  itemId: string,
  opts: { locationId?: string; limit?: number } = {},
): Promise<{ rows: StockCardRow[]; qtyOnHand: number }> {
  if (!itemId) throw new InvError("Item is required", 400);
  const { sb, tenantId } = await invCtx();

  let q = sb
    .from("inv_stock_ledger")
    .select("*, location:inv_locations(name)")
    .eq("tenant_id", tenantId)
    .eq("item_id", itemId);
  if (opts.locationId) q = q.eq("location_id", opts.locationId);

  const { data, error } = await q
    .order("at", { ascending: true })
    .limit(Math.min(2000, Math.max(1, opts.limit ?? 500)));
  if (error) throw new InvError(`Stock card: ${error.message}`, 500);

  let running = 0;
  const rows: StockCardRow[] = (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    const base = rowToLedger(row);
    running += base.qtyDelta;
    const loc = row.location as { name?: string } | null;
    return { ...base, balance: running, locationName: String(loc?.name ?? "") };
  });

  return { rows, qtyOnHand: running };
}

/** On-hand per item (optionally per location) for a set of items. */
export async function balances(opts: {
  itemIds?: string[];
  locationId?: string;
}): Promise<InvStockBalance[]> {
  const { sb, tenantId } = await invCtx();
  let q = sb
    .from("inv_stock_balances")
    .select("item_id, location_id, qty_on_hand, last_move_at")
    .eq("tenant_id", tenantId);
  if (opts.itemIds?.length) q = q.in("item_id", opts.itemIds);
  if (opts.locationId) q = q.eq("location_id", opts.locationId);

  const { data, error } = await q.limit(10000);
  if (error) throw new InvError(`Balances: ${error.message}`, 500);
  return (data ?? []).map((r) => {
    const row = r as Record<string, unknown>;
    return {
      itemId: String(row.item_id),
      locationId: String(row.location_id ?? ""),
      qtyOnHand: Number(row.qty_on_hand) || 0,
      lastMoveAt: String(row.last_move_at ?? ""),
    };
  });
}

/**
 * Write ledger rows. The single entry point for every stock change.
 *
 * Later phases (goods receipt, counter sale, transfer) call this rather than
 * touching the table, so there is exactly one place that decides what a valid
 * movement looks like.
 */
export async function postMovements(
  entries: {
    itemId: string;
    locationId?: string;
    qtyDelta: number;
    kind: InvStockKind;
    unitCostPaise?: number;
    at?: string;
    refType?: string;
    refId?: string;
    refNo?: string;
    note?: string;
  }[],
  actor: string,
  ctxIn?: InvCtx,
): Promise<number> {
  const clean = (entries ?? []).filter(
    (e) => e && e.itemId && Number.isFinite(Number(e.qtyDelta)) && Number(e.qtyDelta) !== 0,
  );
  if (clean.length === 0) return 0;

  const ctx = ctxIn ?? (await invCtx());
  const now = new Date().toISOString();

  const { data, error } = await ctx.sb
    .from("inv_stock_ledger")
    .insert(
      clean.map((e) => ({
        tenant_id: ctx.tenantId,
        item_id: e.itemId,
        location_id: nullable(e.locationId),
        at: e.at || now,
        qty_delta: Number(e.qtyDelta),
        unit_cost_paise: Math.max(0, Math.trunc(e.unitCostPaise ?? 0) || 0),
        kind: e.kind,
        ref_type: String(e.refType ?? ""),
        ref_id: nullable(e.refId),
        ref_no: String(e.refNo ?? ""),
        note: String(e.note ?? ""),
        created_by: actor,
      })),
    )
    .select("id");

  if (error) throw new InvError(`Post stock movement: ${error.message}`, 500);
  return (data ?? []).length;
}

/**
 * Set opening stock for an item at a location.
 *
 * Opening stock is a position, not a movement, so re-entering it must not
 * stack. This replaces any previous `opening` row for the same item and
 * location instead of adding to it — the behaviour a user typing a corrected
 * count expects.
 */
export async function setOpeningStock(
  input: {
    itemId: string;
    locationId: string;
    qty: number;
    unitCostPaise?: number;
    at?: string;
    note?: string;
  },
  actor: string,
): Promise<{ qty: number }> {
  if (!input.itemId) throw new InvError("Item is required", 400);
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty < 0) {
    throw new InvError("Opening quantity must be zero or more", 400);
  }

  const ctx = await invCtx();
  const { sb, tenantId } = ctx;

  let del = sb
    .from("inv_stock_ledger")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("item_id", input.itemId)
    .eq("kind", "opening");
  del = input.locationId
    ? del.eq("location_id", input.locationId)
    : del.is("location_id", null);
  const { error: delError } = await del;
  if (delError) {
    throw new InvError(`Reset opening stock: ${delError.message}`, 500);
  }

  if (qty > 0) {
    await postMovements(
      [
        {
          itemId: input.itemId,
          locationId: input.locationId,
          qtyDelta: qty,
          kind: "opening",
          unitCostPaise: input.unitCostPaise,
          at: input.at,
          refType: "opening",
          note: input.note ?? "Opening stock",
        },
      ],
      actor,
      ctx,
    );

    // Opening stock is also the first cost the school knows for the item, so
    // it seeds the average cost when no purchase has set one yet.
    const cost = Math.max(0, Math.trunc(input.unitCostPaise ?? 0) || 0);
    if (cost > 0) {
      const { data: item } = await sb
        .from("inv_items")
        .select("avg_cost_paise")
        .eq("tenant_id", tenantId)
        .eq("id", input.itemId)
        .maybeSingle();
      if (!item || Math.trunc(Number(item.avg_cost_paise) || 0) === 0) {
        await sb
          .from("inv_items")
          .update({ avg_cost_paise: cost, updated_at: new Date().toISOString() })
          .eq("tenant_id", tenantId)
          .eq("id", input.itemId);
      }
    }
  }

  return { qty };
}

/**
 * Physical-count correction: bring an item to a counted quantity.
 *
 * Writes the difference as adjust_in / adjust_out with the reason attached,
 * so the ledger explains why the number changed.
 */
export async function adjustToCount(
  input: {
    itemId: string;
    locationId: string;
    countedQty: number;
    reason: string;
    at?: string;
  },
  actor: string,
): Promise<{ delta: number; before: number; after: number }> {
  const reason = String(input.reason ?? "").trim();
  if (!reason) {
    throw new InvError("A reason is required for a stock adjustment", 400);
  }
  const counted = Number(input.countedQty);
  if (!Number.isFinite(counted) || counted < 0) {
    throw new InvError("Counted quantity must be zero or more", 400);
  }

  const ctx = await invCtx();
  const current = await balances({
    itemIds: [input.itemId],
    locationId: input.locationId,
  });
  const before = current.reduce((s, b) => s + b.qtyOnHand, 0);
  const delta = Math.round((counted - before) * 1000) / 1000;

  if (delta !== 0) {
    await postMovements(
      [
        {
          itemId: input.itemId,
          locationId: input.locationId,
          qtyDelta: delta,
          kind: delta > 0 ? "adjust_in" : "adjust_out",
          at: input.at,
          refType: "adjustment",
          note: reason,
        },
      ],
      actor,
      ctx,
    );
  }

  return { delta, before, after: counted };
}

/** Move stock between locations — two rows, one atomic intent. */
export async function transferStock(
  input: {
    itemId: string;
    fromLocationId: string;
    toLocationId: string;
    qty: number;
    note?: string;
    at?: string;
  },
  actor: string,
): Promise<{ qty: number }> {
  const qty = Number(input.qty);
  if (!Number.isFinite(qty) || qty <= 0) {
    throw new InvError("Transfer quantity must be more than zero", 400);
  }
  if (!input.fromLocationId || !input.toLocationId) {
    throw new InvError("Both source and destination locations are required", 400);
  }
  if (input.fromLocationId === input.toLocationId) {
    throw new InvError("Source and destination must be different", 400);
  }

  const ctx = await invCtx();
  const { data: settings } = await ctx.sb
    .from("inv_settings")
    .select("allow_negative_stock")
    .eq("tenant_id", ctx.tenantId)
    .maybeSingle();

  if (!settings?.allow_negative_stock) {
    const at = await balances({
      itemIds: [input.itemId],
      locationId: input.fromLocationId,
    });
    const available = at.reduce((s, b) => s + b.qtyOnHand, 0);
    if (available < qty) {
      throw new InvError(
        `Only ${available} in stock at the source location — cannot transfer ${qty}`,
        409,
      );
    }
  }

  const note = String(input.note ?? "");
  await postMovements(
    [
      {
        itemId: input.itemId,
        locationId: input.fromLocationId,
        qtyDelta: -qty,
        kind: "transfer_out",
        at: input.at,
        refType: "transfer",
        note,
      },
      {
        itemId: input.itemId,
        locationId: input.toLocationId,
        qtyDelta: qty,
        kind: "transfer_in",
        at: input.at,
        refType: "transfer",
        note,
      },
    ],
    actor,
    ctx,
  );

  return { qty };
}

/** Stock valuation — quantity × weighted-average cost, per item. */
export async function valuation(opts: { locationId?: string } = {}): Promise<{
  rows: {
    itemId: string;
    sku: string;
    name: string;
    categoryName: string;
    qtyOnHand: number;
    avgCostPaise: number;
    valuePaise: number;
  }[];
  totalPaise: number;
}> {
  const { sb, tenantId } = await invCtx();

  const bal = await balances({ locationId: opts.locationId });
  const byItem = new Map<string, number>();
  for (const b of bal) {
    byItem.set(b.itemId, (byItem.get(b.itemId) ?? 0) + b.qtyOnHand);
  }
  const itemIds = [...byItem.keys()];
  if (itemIds.length === 0) return { rows: [], totalPaise: 0 };

  const { data, error } = await sb
    .from("inv_items")
    .select("id, sku, name, avg_cost_paise, category:inv_categories(name)")
    .eq("tenant_id", tenantId)
    .in("id", itemIds);
  if (error) throw new InvError(`Valuation: ${error.message}`, 500);

  const rows = (data ?? [])
    .map((r) => {
      const row = r as Record<string, unknown>;
      const id = String(row.id);
      const qty = byItem.get(id) ?? 0;
      const cost = Math.trunc(Number(row.avg_cost_paise) || 0);
      const cat = row.category as { name?: string } | null;
      return {
        itemId: id,
        sku: String(row.sku ?? ""),
        name: String(row.name ?? ""),
        categoryName: String(cat?.name ?? ""),
        qtyOnHand: qty,
        avgCostPaise: cost,
        valuePaise: Math.round(qty * cost),
      };
    })
    .filter((r) => r.qtyOnHand !== 0)
    .sort((a, b) => b.valuePaise - a.valuePaise);

  return {
    rows,
    totalPaise: rows.reduce((s, r) => s + r.valuePaise, 0),
  };
}
