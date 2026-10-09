/**
 * Notifications desk — Supabase normalized tables (notifications_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppNotification, NotificationsState } from "@/lib/notifications";
import { notificationsDualWriteDbEnabled } from "@/lib/notificationsDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";
import { deleteNamedIds, type NamedDeletes } from "@/lib/deskNamedDeletes.server";
import { fetchAllPages, fetchByIds } from "@/lib/supabase/pageAll";

export type NotificationsDeskSyncMeta = {
  itemCount: number;
  lastCreatedAt: string | null;
  updatedAt: string;
};

export type NotificationsDeskBundle = {
  items: AppNotification[];
};

const META_SELECT = "item_count, last_created_at, updated_at";

async function resolveCtx(): Promise<{
  sb: SupabaseClient;
  tenantId: string;
} | null> {
  return getServerTenantContext();
}


function nowIso() {
  return new Date().toISOString();
}

function itemToRow(tenantId: string, n: AppNotification): Record<string, unknown> {
  return {
    id: n.id,
    tenant_id: tenantId,
    title: n.title || "",
    body: n.body || "",
    kind: n.kind || "system",
    href: n.href || "/home",
    audience: n.audience || "all",
    source_id: n.sourceId || "",
    created_at: n.createdAt || nowIso(),
    read_by_json: Array.isArray(n.readBy) ? n.readBy : [],
    updated_at: nowIso(),
  };
}

function rowToItem(r: Record<string, unknown>): AppNotification {
  const readBy = r.read_by_json;
  return {
    id: String(r.id),
    title: String(r.title || ""),
    body: String(r.body || ""),
    kind: String(r.kind || "system") as AppNotification["kind"],
    href: String(r.href || "/home"),
    audience: String(r.audience || "all") as AppNotification["audience"],
    sourceId: String(r.source_id || ""),
    createdAt: String(r.created_at),
    readBy: Array.isArray(readBy) ? readBy.map(String) : [],
  };
}

/** The only notifications table a desk save deletes from — by named id. */
export const NOTIFICATIONS_DELETABLE_TABLES = ["notifications_desk_items"] as const;

export async function pushNotificationsDeskToDb(
  state: NotificationsState,
  deletes: NamedDeletes = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!notificationsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const gone = new Set(deletes["notifications_desk_items"] ?? []);
  const items = (state.items ?? []).filter((n) => !gone.has(n.id));
  const now = nowIso();

  // No prune by absence. Job applications and UDISE document intake add
  // notifications on the server, and every mark-as-read pushed this
  // browser's whole list — so a tab that read before they arrived deleted
  // them, and the 300-item cap deleted everything older. Only the admin's
  // explicit clear deletes, and it arrives named.
  const del = await deleteNamedIds(sb, tenantId, "notifications_desk_items", [...gone]);
  if (!del.ok) return del;

  // No stale copy over a newer one (2026-10-10). Every mark-as-read pushed
  // the browser's whole list, so a tab that loaded before someone else read
  // an item wrote its own older readBy back — the item went unread again
  // for them. A notification never changes after it is made except to gain
  // readers: new items are only inserted, and readers are only ever added.
  const w = await writeNotificationItems(sb, tenantId, items);
  if (!w.ok) return w;

  await touchNotificationsMeta(sb, tenantId, now).catch(() => undefined);
  return { ok: true };
}

/**
 * New notifications are inserted, never over one that exists; for the rest
 * only `read_by_json` is written, as the union of the stored readers and
 * this copy's, and only when this copy adds someone. A failed read writes
 * nothing.
 */
export async function writeNotificationItems(
  sb: SupabaseClient,
  tenantId: string,
  items: AppNotification[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  if (!items.length) return { ok: true };
  const T = "notifications_desk_items";
  const stored = await fetchByIds<{ id: string; read_by_json: unknown }>(
    items.map((i) => i.id),
    (chunk, from, to) =>
      sb.from(T).select("id, read_by_json").eq("tenant_id", tenantId).in("id", chunk).order("id", { ascending: true }).range(from, to),
  );
  if (stored.error) return { ok: false, error: `Could not read the stored notifications: ${stored.error}` };
  const readers = new Map(
    stored.rows.map((r) => [String(r.id), Array.isArray(r.read_by_json) ? r.read_by_json.map(String) : []]),
  );

  const fresh = items.filter((i) => !readers.has(i.id)).map((i) => itemToRow(tenantId, i));
  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await sb.from(T).upsert(fresh.slice(i, i + 200), { onConflict: "id", ignoreDuplicates: true });
    if (error) return { ok: false, error: error.message };
  }
  for (const item of items) {
    const had = readers.get(item.id);
    if (!had) continue;
    const added = (item.readBy ?? []).filter((k) => !had.includes(k));
    if (!added.length) continue;
    const { error } = await sb
      .from(T)
      .update({ read_by_json: [...had, ...added], updated_at: nowIso() })
      .eq("tenant_id", tenantId)
      .eq("id", item.id);
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
}

/** Recount the desk meta from the table (a copy may be partial or capped). */
async function touchNotificationsMeta(sb: SupabaseClient, tenantId: string, now: string): Promise<void> {
  const [all, latest] = await Promise.all([
    sb.from("notifications_desk_items").select("id", { count: "exact", head: true }).eq("tenant_id", tenantId),
    sb
      .from("notifications_desk_items")
      .select("created_at")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false })
      .limit(1)
      .maybeSingle(),
  ]);
  const row: Record<string, unknown> = { tenant_id: tenantId, updated_at: now };
  // A failed count leaves the old figure alone rather than writing a zero.
  if (!all.error && typeof all.count === "number") row.item_count = all.count;
  if (!latest.error) row.last_created_at = (latest.data as { created_at?: string } | null)?.created_at ?? null;
  await sb.from("notifications_desk_sync_meta").upsert(row, { onConflict: "tenant_id" });
}

export async function fetchNotificationsDeskFromDb(): Promise<{
  bundle: NotificationsDeskBundle;
  meta: NotificationsDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; bundle is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  const empty: NotificationsDeskBundle = { items: [] };
  if (!ctx) return { bundle: empty, meta: null, ok: false };
  const { sb, tenantId } = ctx;

  const [{ data: itemRows, error: itemErr }, { data: metaRow }] = await Promise.all([
    // Paged: PostgREST stops at 1,000 rows.
    fetchAllPages<Record<string, unknown>>((from, to) =>
      sb
        .from("notifications_desk_items")
        .select("*")
        .eq("tenant_id", tenantId)
        .order("created_at", { ascending: false })
        .order("id", { ascending: true })
        .range(from, to),
    ).then((r) => ({ data: r.rows, error: r.error ? { message: r.error } : null })),
    sb
      .from("notifications_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (itemErr) {
    console.warn("[notifications-db] fetch failed", itemErr.message);
    return { bundle: empty, meta: null, ok: false };
  }

  const items = (itemRows ?? []).map((r) =>
    rowToItem(r as Record<string, unknown>),
  );

  const meta: NotificationsDeskSyncMeta | null = metaRow
    ? {
        itemCount: Number(metaRow.item_count ?? items.length),
        lastCreatedAt: metaRow.last_created_at
          ? String(metaRow.last_created_at)
          : null,
        updatedAt: String(metaRow.updated_at || ""),
      }
    : null;

  return { bundle: { items }, meta, ok: true };
}
