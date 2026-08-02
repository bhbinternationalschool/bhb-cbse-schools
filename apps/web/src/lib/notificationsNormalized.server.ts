/**
 * Notifications desk — Supabase normalized tables (notifications_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type { AppNotification, NotificationsState } from "@/lib/notifications";
import { notificationsDualWriteDbEnabled } from "@/lib/notificationsDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

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

async function deleteStale(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  keepIds: Set<string>,
) {
  const { data } = await sb.from(table).select("id").eq("tenant_id", tenantId);
  const stale = (data ?? [])
    .map((r) => String((r as { id: string }).id))
    .filter((id) => !keepIds.has(id));
  if (stale.length > 0) {
    await sb.from(table).delete().in("id", stale);
  }
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

export async function pushNotificationsDeskToDb(
  state: NotificationsState,
): Promise<{ ok: boolean; error?: string }> {
  if (!notificationsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const items = state.items ?? [];
  const now = nowIso();

  await deleteStale(
    sb,
    tenantId,
    "notifications_desk_items",
    new Set(items.map((n) => n.id)),
  );

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
}> {
  const ctx = await resolveCtx();
  const empty: NotificationsDeskBundle = { items: [] };
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [{ data: itemRows }, { data: metaRow }] = await Promise.all([
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

  return { bundle: { items }, meta };
}
