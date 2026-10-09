/**
 * Notifications desk — Supabase normalized tables (notifications_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppNotification, NotificationsState } from "@/lib/notifications";
import { notificationsDualWriteDbEnabled } from "@/lib/notificationsDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";
import { deleteNamedIds, type NamedDeletes } from "@/lib/deskNamedDeletes.server";

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

async function upsertChunks(
  sb: SupabaseClient,
  table: string,
  rows: Record<string, unknown>[],
  chunk = 200,
): Promise<{ ok: boolean; error?: string }> {
  for (let i = 0; i < rows.length; i += chunk) {
    const { error } = await sb.from(table).upsert(rows.slice(i, i + chunk));
    if (error) return { ok: false, error: error.message };
  }
  return { ok: true };
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

function lastCreatedAt(items: AppNotification[]): string | null {
  if (!items.length) return null;
  return items.reduce((max, i) => (i.createdAt > max ? i.createdAt : max), items[0].createdAt);
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

  const rows = items.map((n) => itemToRow(tenantId, n));
  if (rows.length > 0) {
    const up = await upsertChunks(sb, "notifications_desk_items", rows);
    if (!up.ok) return up;
  }

  await sb.from("notifications_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      item_count: items.length,
      last_created_at: lastCreatedAt(items),
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
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
    sb
      .from("notifications_desk_items")
      .select("*")
      .eq("tenant_id", tenantId)
      .order("created_at", { ascending: false }),
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
