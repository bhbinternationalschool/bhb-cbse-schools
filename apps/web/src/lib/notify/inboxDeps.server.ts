/**
 * The real dependencies of the notifications inbox (./inbox.ts): the session
 * guard every /api/v1 route uses, reads of the caller's own rows through the
 * service client (always filtered by tenant + recipient), and the write
 * kernel (desk_write_guarded) for read marks and settings.
 */
import "server-only";

import { resolveApiAuth } from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
import { writeRows } from "@/lib/data/server/repo";
import { getServerTenantContext } from "@/lib/serverTenant";
import type { Recipient } from "./kinds";
import type { InboxDeps } from "./inbox";

const COLUMNS =
  "id, kind, topic, title, body, title_hi, body_hi, link, web_link, payload, urgent, group_count, actor, read_at, created_at, updated_at";

export const inboxDeps: InboxDeps = {
  auth: async (req) => {
    try {
      const ctx = await resolveApiAuth(req);
      if (ctx.authKind !== "session") return { ok: false, status: 403, error: "Notifications are for signed-in people." };
      return { ok: true, session: ctx.session };
    } catch (e) {
      const status = e instanceof ApiError ? e.status : 401;
      return { ok: false, status, error: e instanceof ApiError ? e.message : "Unauthorized" };
    }
  },

  list: async (r: Recipient, limit: number) => {
    const ctx = await getServerTenantContext();
    if (!ctx) return null;
    const { data, error } = await ctx.sb
      .from("erp_notifications")
      .select(COLUMNS)
      .eq("tenant_id", ctx.tenantId)
      .eq("recipient_type", r.type)
      .eq("recipient_id", r.id)
      .order("updated_at", { ascending: false })
      .limit(limit);
    if (error) return null;
    return (data ?? []) as Record<string, unknown>[];
  },

  unreadCount: async (r) => {
    const ctx = await getServerTenantContext();
    if (!ctx) return null;
    const { count, error } = await ctx.sb
      .from("erp_notifications")
      .select("id", { count: "exact", head: true })
      .eq("tenant_id", ctx.tenantId)
      .eq("recipient_type", r.type)
      .eq("recipient_id", r.id)
      .is("read_at", null);
    if (error || typeof count !== "number") return null;
    return count;
  },

  unread: async (r, ids) => {
    const ctx = await getServerTenantContext();
    if (!ctx) return null;
    let q = ctx.sb
      .from("erp_notifications")
      .select("id, updated_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("recipient_type", r.type)
      .eq("recipient_id", r.id)
      .is("read_at", null);
    if (ids) q = q.in("id", [...ids]);
    const { data, error } = await q.order("updated_at", { ascending: false }).limit(500);
    if (error) return null;
    return (data ?? []) as { id: string; updated_at: string }[];
  },

  readPrefs: async (r) => {
    const ctx = await getServerTenantContext();
    if (!ctx) return undefined;
    const { data, error } = await ctx.sb
      .from("erp_notification_prefs")
      .select("muted_topics, voice, quiet_enabled, quiet_start, quiet_end, updated_at")
      .eq("tenant_id", ctx.tenantId)
      .eq("recipient_type", r.type)
      .eq("recipient_id", r.id)
      .maybeSingle();
    if (error) return undefined;
    return (data as Record<string, unknown> | null) ?? null;
  },

  write: (table, ops) => writeRows(table, ops),
  now: () => new Date(),
};
