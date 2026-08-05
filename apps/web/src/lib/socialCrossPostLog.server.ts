/**
 * Cross-post idempotency + history (Supabase desk table with in-memory fallback).
 */

import { createServiceSupabase } from "@/lib/supabase/server";
import { TENANT } from "@/lib/types";
import type {
  SocialCrossPostKind,
  SocialCrossPostLogEntry,
  SocialPlatform,
} from "@/lib/socialCrossPost.types";

const mem = new Map<string, SocialCrossPostLogEntry>();

function logKey(
  kind: SocialCrossPostKind,
  contentId: string,
  platform: SocialPlatform,
): string {
  return `${TENANT}:${kind}:${contentId}:${platform}`;
}

function rowToEntry(row: Record<string, unknown>): SocialCrossPostLogEntry {
  return {
    id: String(row.id ?? ""),
    kind: row.content_kind as SocialCrossPostKind,
    contentId: String(row.content_id ?? ""),
    platform: row.platform as SocialPlatform,
    status: row.status as SocialCrossPostLogEntry["status"],
    externalPostId: String(row.external_post_id ?? ""),
    postUrl: String(row.post_url ?? ""),
    error: String(row.error ?? ""),
    postedAt: String(row.posted_at ?? row.created_at ?? ""),
    title: String(row.title ?? ""),
  };
}

export async function findCrossPostLog(
  kind: SocialCrossPostKind,
  contentId: string,
  platform: SocialPlatform,
): Promise<SocialCrossPostLogEntry | null> {
  const key = logKey(kind, contentId, platform);
  const cached = mem.get(key);
  if (cached?.status === "posted") return cached;

  const sb = createServiceSupabase();
  if (!sb) return cached ?? null;

  const { data, error } = await sb
    .from("school_comms_cross_posts")
    .select("*")
    .eq("tenant_slug", TENANT)
    .eq("content_kind", kind)
    .eq("content_id", contentId)
    .eq("platform", platform)
    .maybeSingle();

  if (error || !data) return cached ?? null;
  const entry = rowToEntry(data as Record<string, unknown>);
  mem.set(key, entry);
  return entry;
}

export async function saveCrossPostLog(input: {
  kind: SocialCrossPostKind;
  contentId: string;
  platform: SocialPlatform;
  status: SocialCrossPostLogEntry["status"];
  externalPostId?: string;
  postUrl?: string;
  error?: string;
  title?: string;
}): Promise<void> {
  const key = logKey(input.kind, input.contentId, input.platform);
  const entry: SocialCrossPostLogEntry = {
    id: key,
    kind: input.kind,
    contentId: input.contentId,
    platform: input.platform,
    status: input.status,
    externalPostId: input.externalPostId ?? "",
    postUrl: input.postUrl ?? "",
    error: input.error ?? "",
    postedAt: new Date().toISOString(),
    title: input.title ?? "",
  };
  mem.set(key, entry);

  const sb = createServiceSupabase();
  if (!sb) return;

  await sb.from("school_comms_cross_posts").upsert(
    {
      tenant_slug: TENANT,
      content_kind: input.kind,
      content_id: input.contentId,
      platform: input.platform,
      status: input.status,
      external_post_id: input.externalPostId ?? "",
      post_url: input.postUrl ?? "",
      error: input.error ?? "",
      title: input.title ?? "",
      posted_at: entry.postedAt,
      updated_at: entry.postedAt,
    },
    { onConflict: "tenant_slug,content_kind,content_id,platform" },
  );
}

export async function listCrossPostLogs(opts?: {
  contentId?: string;
  kind?: SocialCrossPostKind;
  limit?: number;
}): Promise<SocialCrossPostLogEntry[]> {
  const limit = opts?.limit ?? 50;
  const sb = createServiceSupabase();
  if (!sb) {
    return [...mem.values()]
      .filter((e) => (opts?.contentId ? e.contentId === opts.contentId : true))
      .filter((e) => (opts?.kind ? e.kind === opts.kind : true))
      .sort((a, b) => b.postedAt.localeCompare(a.postedAt))
      .slice(0, limit);
  }

  let q = sb
    .from("school_comms_cross_posts")
    .select("*")
    .eq("tenant_slug", TENANT)
    .order("posted_at", { ascending: false })
    .limit(limit);

  if (opts?.contentId) q = q.eq("content_id", opts.contentId);
  if (opts?.kind) q = q.eq("content_kind", opts.kind);

  const { data } = await q;
  return (data ?? []).map((row) =>
    rowToEntry(row as Record<string, unknown>),
  );
}
