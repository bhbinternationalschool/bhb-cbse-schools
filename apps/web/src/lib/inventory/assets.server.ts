/**
 * Inventory — the asset register.
 *
 * A consumable is a quantity; an asset is a thing. Furniture, lab gear and IT
 * equipment are tagged individually and tracked by where they are and who
 * holds them, so the register answers "where is projector 14" rather than
 * "how many projectors do we own".
 *
 * Every change is also written to `inv_asset_events`, so an asset that moved
 * three times can say when and by whom, rather than only showing its current
 * room.
 */

import {
  insertOrUpdate,
  InvError,
  invCtx,
  nullable,
  type InvCtx,
} from "@/lib/inventory/db.server";

type Row = Record<string, unknown>;

const str = (v: unknown): string => (v == null ? "" : String(v));
const num = (v: unknown): number => {
  const n = Number(v);
  return Number.isFinite(n) ? n : 0;
};
const int = (v: unknown): number => Math.trunc(num(v));
const dateOnly = (v: unknown): string => str(v).slice(0, 10);

export type InvAssetCondition = "new" | "good" | "fair" | "poor" | "scrapped";
export type InvAssetStatus =
  | "in_use"
  | "in_store"
  | "under_repair"
  | "scrapped"
  | "lost";

export type InvAsset = {
  id: string;
  itemId: string;
  itemName: string;
  sku: string;
  assetTag: string;
  serialNo: string;
  locationId: string;
  locationName: string;
  custodian: string;
  department: string;
  room: string;
  condition: InvAssetCondition;
  status: InvAssetStatus;
  purchaseDate: string;
  purchaseCostPaise: number;
  warrantyUntil: string;
  notes: string;
  createdAt: string;
  updatedAt: string;
};

export type InvAssetEvent = {
  id: string;
  assetId: string;
  at: string;
  kind: string;
  fromValue: string;
  toValue: string;
  note: string;
  createdBy: string;
};

const CONDITIONS: InvAssetCondition[] = ["new", "good", "fair", "poor", "scrapped"];
const STATUSES: InvAssetStatus[] = [
  "in_use",
  "in_store",
  "under_repair",
  "scrapped",
  "lost",
];

function rowToAsset(r: Row): InvAsset {
  const item = r.item as { name?: string; sku?: string } | null;
  const loc = r.location as { name?: string } | null;
  const condition = str(r.condition) as InvAssetCondition;
  const status = str(r.status) as InvAssetStatus;
  return {
    id: str(r.id),
    itemId: str(r.item_id),
    itemName: str(item?.name),
    sku: str(item?.sku),
    assetTag: str(r.asset_tag),
    serialNo: str(r.serial_no),
    locationId: str(r.location_id),
    locationName: str(loc?.name),
    custodian: str(r.custodian),
    department: str(r.department),
    room: str(r.room),
    condition: CONDITIONS.includes(condition) ? condition : "good",
    status: STATUSES.includes(status) ? status : "in_use",
    purchaseDate: dateOnly(r.purchase_date),
    purchaseCostPaise: int(r.purchase_cost_paise),
    warrantyUntil: dateOnly(r.warranty_until),
    notes: str(r.notes),
    createdAt: str(r.created_at),
    updatedAt: str(r.updated_at),
  };
}

export async function listAssets(opts: {
  search?: string;
  itemId?: string;
  locationId?: string;
  status?: string;
}): Promise<InvAsset[]> {
  const { sb, tenantId } = await invCtx();

  let q = sb
    .from("inv_assets")
    .select("*, item:inv_items(name, sku), location:inv_locations(name)")
    .eq("tenant_id", tenantId);

  if (opts.itemId) q = q.eq("item_id", opts.itemId);
  if (opts.locationId) q = q.eq("location_id", opts.locationId);
  if (opts.status && opts.status !== "all") q = q.eq("status", opts.status);

  const term = String(opts.search ?? "")
    .trim()
    .replace(/[,()*\\%]/g, " ")
    .slice(0, 60);
  if (term) {
    q = q.or(
      `asset_tag.ilike.%${term}%,serial_no.ilike.%${term}%,` +
        `custodian.ilike.%${term}%,room.ilike.%${term}%,department.ilike.%${term}%`,
    );
  }

  const { data, error } = await q.order("asset_tag").limit(1000);
  if (error) throw new InvError(`Assets: ${error.message}`, 500);
  return ((data ?? []) as unknown as Row[]).map(rowToAsset);
}

export async function assetHistory(assetId: string): Promise<InvAssetEvent[]> {
  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb
    .from("inv_asset_events")
    .select("*")
    .eq("tenant_id", tenantId)
    .eq("asset_id", assetId)
    .order("at", { ascending: false })
    .limit(200);
  if (error) throw new InvError(`Asset history: ${error.message}`, 500);
  return ((data ?? []) as Row[]).map((r) => ({
    id: str(r.id),
    assetId: str(r.asset_id),
    at: str(r.at),
    kind: str(r.kind),
    fromValue: str(r.from_value),
    toValue: str(r.to_value),
    note: str(r.note),
    createdBy: str(r.created_by),
  }));
}

/**
 * Register a new asset or update an existing one.
 *
 * On update, the fields that matter operationally — where it is, who has it,
 * what condition and status it is in — are compared against what was stored,
 * and each real change is recorded as its own event. Silently overwriting them
 * would leave a register that is current but cannot explain itself.
 */
export async function saveAsset(
  input: {
    id?: string;
    itemId?: string;
    assetTag?: string;
    serialNo?: string;
    locationId?: string;
    custodian?: string;
    department?: string;
    room?: string;
    condition?: InvAssetCondition;
    status?: InvAssetStatus;
    purchaseDate?: string;
    purchaseCostPaise?: number;
    warrantyUntil?: string;
    notes?: string;
    /** Reason shown on the history entries this save creates. */
    changeNote?: string;
  },
  actor: string,
): Promise<InvAsset> {
  const tag = String(input.assetTag ?? "").trim();
  if (!tag) throw new InvError("An asset tag is required", 400);
  if (!input.id && !input.itemId) {
    throw new InvError("Choose what kind of item this asset is", 400);
  }

  const ctx = await invCtx();
  const { sb, tenantId } = ctx;

  let previous: InvAsset | null = null;
  if (input.id) {
    const { data } = await sb
      .from("inv_assets")
      .select("*, item:inv_items(name, sku), location:inv_locations(name)")
      .eq("tenant_id", tenantId)
      .eq("id", input.id)
      .maybeSingle();
    previous = data ? rowToAsset(data as unknown as Row) : null;
  }

  const condition = CONDITIONS.includes(input.condition as InvAssetCondition)
    ? input.condition
    : (previous?.condition ?? "good");
  const status = STATUSES.includes(input.status as InvAssetStatus)
    ? input.status
    : (previous?.status ?? "in_use");

  const row: Row = {
    tenant_id: tenantId,
    asset_tag: tag,
    serial_no: str(input.serialNo).trim(),
    location_id: nullable(input.locationId),
    custodian: str(input.custodian).trim(),
    department: str(input.department).trim(),
    room: str(input.room).trim(),
    condition,
    status,
    purchase_date: nullable(input.purchaseDate),
    purchase_cost_paise: Math.max(0, int(input.purchaseCostPaise)),
    warranty_until: nullable(input.warrantyUntil),
    notes: str(input.notes),
    updated_at: new Date().toISOString(),
  };
  if (input.id) row.id = input.id;
  else {
    row.item_id = input.itemId;
    row.created_by = actor;
  }

  const saved = await insertOrUpdate(
    sb,
    "inv_assets",
    tenantId,
    row,
    "*, item:inv_items(name, sku), location:inv_locations(name)",
    "Save asset",
  );
  const asset = rowToAsset(saved);

  await recordAssetEvents(ctx, asset, previous, actor, str(input.changeNote));
  return asset;
}

async function recordAssetEvents(
  ctx: InvCtx,
  next: InvAsset,
  previous: InvAsset | null,
  actor: string,
  note: string,
): Promise<void> {
  const events: Row[] = [];
  const base = {
    tenant_id: ctx.tenantId,
    asset_id: next.id,
    note,
    created_by: actor,
  };

  if (!previous) {
    events.push({ ...base, kind: "registered", to_value: next.assetTag });
  } else {
    if (previous.locationId !== next.locationId) {
      events.push({
        ...base,
        kind: "moved",
        from_value: previous.locationName || previous.locationId,
        to_value: next.locationName || next.locationId,
      });
    }
    if (previous.custodian !== next.custodian) {
      events.push({
        ...base,
        kind: "assigned",
        from_value: previous.custodian,
        to_value: next.custodian,
      });
    }
    if (previous.condition !== next.condition) {
      events.push({
        ...base,
        kind: "condition",
        from_value: previous.condition,
        to_value: next.condition,
      });
    }
    if (previous.status !== next.status) {
      const kind =
        next.status === "scrapped"
          ? "scrapped"
          : next.status === "lost"
            ? "lost"
            : next.status === "under_repair"
              ? "repair_in"
              : previous.status === "under_repair"
                ? "repair_out"
                : next.status === "in_use" && previous.status === "lost"
                  ? "found"
                  : "note";
      events.push({
        ...base,
        kind,
        from_value: previous.status,
        to_value: next.status,
      });
    }
  }

  if (events.length === 0) return;
  const { error } = await ctx.sb.from("inv_asset_events").insert(events);
  if (error) {
    // The asset itself saved; losing its history entry is worth surfacing but
    // not worth failing the save the user already completed.
    console.error("[inventory] asset history not written:", error.message);
  }
}

/**
 * Register several assets at once from one receipt line.
 *
 * Buying twenty identical chairs means twenty tagged rows, and typing them one
 * at a time is how registers end up half-filled. Tags are generated from a
 * prefix and a starting number.
 */
export async function bulkRegisterAssets(
  input: {
    itemId: string;
    count: number;
    tagPrefix: string;
    startNumber?: number;
    locationId?: string;
    custodian?: string;
    department?: string;
    purchaseDate?: string;
    purchaseCostPaise?: number;
  },
  actor: string,
): Promise<{ created: number; firstTag: string; lastTag: string }> {
  const count = Math.trunc(Number(input.count) || 0);
  if (count < 1 || count > 200) {
    throw new InvError("Register between 1 and 200 assets at a time", 400);
  }
  const prefix = String(input.tagPrefix ?? "").trim();
  if (!prefix) throw new InvError("A tag prefix is required", 400);
  if (!input.itemId) throw new InvError("Choose the item these assets are", 400);

  const ctx = await invCtx();
  const { sb, tenantId } = ctx;

  const start = Math.max(1, Math.trunc(Number(input.startNumber) || 1));
  const tags: string[] = [];
  for (let i = 0; i < count; i += 1) {
    tags.push(`${prefix}${String(start + i).padStart(3, "0")}`);
  }

  // Refuse the whole batch on a collision rather than registering some of it:
  // a half-applied batch leaves the user guessing which tags exist.
  const { data: clash } = await sb
    .from("inv_assets")
    .select("asset_tag")
    .eq("tenant_id", tenantId)
    .in("asset_tag", tags);
  if ((clash ?? []).length > 0) {
    const taken = (clash ?? []).map((r) => str((r as Row).asset_tag)).join(", ");
    throw new InvError(`These tags already exist: ${taken}`, 409);
  }

  const now = new Date().toISOString();
  const { data, error } = await sb
    .from("inv_assets")
    .insert(
      tags.map((tag) => ({
        tenant_id: tenantId,
        item_id: input.itemId,
        asset_tag: tag,
        location_id: nullable(input.locationId),
        custodian: str(input.custodian).trim(),
        department: str(input.department).trim(),
        purchase_date: nullable(input.purchaseDate),
        purchase_cost_paise: Math.max(0, int(input.purchaseCostPaise)),
        condition: "new",
        status: "in_store",
        created_by: actor,
        created_at: now,
        updated_at: now,
      })),
    )
    .select("id, asset_tag");
  if (error) throw new InvError(`Register assets: ${error.message}`, 500);

  const created = (data ?? []) as Row[];
  if (created.length > 0) {
    await sb.from("inv_asset_events").insert(
      created.map((r) => ({
        tenant_id: tenantId,
        asset_id: str(r.id),
        kind: "registered",
        to_value: str(r.asset_tag),
        note: "Registered in a batch",
        created_by: actor,
      })),
    );
  }

  return {
    created: created.length,
    firstTag: tags[0] ?? "",
    lastTag: tags[tags.length - 1] ?? "",
  };
}

/**
 * Remove an asset, or refuse when it has history worth keeping.
 *
 * An asset that has been moved, assigned or repaired is a record. Scrapping is
 * a status, not a deletion.
 */
export async function removeAsset(
  assetId: string,
): Promise<{ deleted: boolean; reason: string }> {
  const { sb, tenantId } = await invCtx();

  const { count } = await sb
    .from("inv_asset_events")
    .select("id", { count: "exact", head: true })
    .eq("tenant_id", tenantId)
    .eq("asset_id", assetId)
    .neq("kind", "registered");

  if ((count ?? 0) > 0) {
    return {
      deleted: false,
      reason:
        "This asset has history — mark it scrapped or lost rather than deleting it",
    };
  }

  const { error } = await sb
    .from("inv_assets")
    .delete()
    .eq("tenant_id", tenantId)
    .eq("id", assetId);
  if (error) throw new InvError(`Delete asset: ${error.message}`, 500);
  return { deleted: true, reason: "Asset removed" };
}

/** Counts for the asset register header. */
export async function assetSummary(): Promise<{
  total: number;
  inUse: number;
  inStore: number;
  underRepair: number;
  scrapped: number;
  lost: number;
  valuePaise: number;
}> {
  const { sb, tenantId } = await invCtx();
  const { data, error } = await sb
    .from("inv_assets")
    .select("status, purchase_cost_paise")
    .eq("tenant_id", tenantId)
    .limit(10000);
  if (error) throw new InvError(`Asset summary: ${error.message}`, 500);

  const rows = (data ?? []) as Row[];
  const by = (s: string) => rows.filter((r) => str(r.status) === s).length;
  return {
    total: rows.length,
    inUse: by("in_use"),
    inStore: by("in_store"),
    underRepair: by("under_repair"),
    scrapped: by("scrapped"),
    lost: by("lost"),
    // Scrapped and lost assets are no longer worth anything to the school.
    valuePaise: rows
      .filter((r) => !["scrapped", "lost"].includes(str(r.status)))
      .reduce((s, r) => s + int(r.purchase_cost_paise), 0),
  };
}
