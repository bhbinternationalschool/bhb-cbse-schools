import "server-only";

import { unstable_cache } from "next/cache";
import { getServerTenantContext } from "@/lib/serverTenant";
import {
  isPublicationLive,
  mayPublishMedia,
  rowToMedia,
  rowToPublication,
  type PublicationKind,
  type SiteMedia,
} from "@/lib/website";

/**
 * What the live blocks read.
 *
 * The rule that governs this whole file: nothing from another desk reaches
 * the public because it exists. It reaches the public because someone
 * ticked it on, and `site_publications` is where that tick is recorded.
 * Every reader here starts from that table and works outwards — so a desk
 * full of internal notices stays internal, and the website cannot quietly
 * grow content nobody chose to publish.
 */

export const CONTENT_TAG = "site-content";

/** Short, so a notice published in Comms appears without a Website visit. */
const REVALIDATE_SECONDS = 300;

export type FeedItem = {
  id: string;
  kind: "news" | "notice";
  title: string;
  summary: string;
  publishedAt: string;
  coverUrl: string;
};

export type EventItem = {
  id: string;
  title: string;
  description: string;
  startsOn: string;
  startTime: string;
  location: string;
};

export type AlbumItem = {
  id: string;
  title: string;
  description: string;
  photos: { id: string; url: string; caption: string }[];
};

export type PersonItem = {
  id: string;
  name: string;
  role: string;
};

/** The source ids of everything currently ticked on, per kind. */
async function liveSourceIds(
  kind: PublicationKind,
): Promise<Set<string>> {
  const ctx = await getServerTenantContext();
  if (!ctx) return new Set();
  const { data } = await ctx.sb
    .from("site_publications")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("source_kind", kind);

  const now = new Date();
  const out = new Set<string>();
  for (const row of data ?? []) {
    const pub = rowToPublication(row as Record<string, unknown>);
    if (isPublicationLive(pub, now)) out.add(pub.sourceId);
  }
  return out;
}

async function loadFeed(
  show: "both" | "news" | "notices",
  limit: number,
): Promise<FeedItem[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];

  const items: FeedItem[] = [];

  if (show === "both" || show === "news") {
    const live = await liveSourceIds("news");
    if (live.size > 0) {
      const { data } = await ctx.sb
        .from("school_comms_desk_news")
        .select("*")
        .eq("tenant_id", ctx.tenantId)
        .in("id", [...live]);
      for (const r of data ?? []) {
        const row = r as Record<string, unknown>;
        items.push({
          id: String(row.id ?? ""),
          kind: "news",
          title: String(row.title ?? ""),
          summary: String(row.summary ?? ""),
          publishedAt: String(row.published_at ?? row.created_at ?? ""),
          coverUrl: String(row.cover_url ?? ""),
        });
      }
    }
  }

  if (show === "both" || show === "notices") {
    const live = await liveSourceIds("notice");
    if (live.size > 0) {
      const { data } = await ctx.sb
        .from("school_comms_desk_notices")
        .select("*")
        .eq("tenant_id", ctx.tenantId)
        .in("id", [...live]);
      for (const r of data ?? []) {
        const row = r as Record<string, unknown>;
        items.push({
          id: String(row.id ?? ""),
          kind: "notice",
          title: String(row.title ?? ""),
          // A notice has a body, not a summary. Trim it rather than
          // publishing a wall of text in a three-card row.
          summary: String(row.body ?? "").replace(/\s+/g, " ").slice(0, 200),
          publishedAt: String(row.published_at ?? row.created_at ?? ""),
          coverUrl: "",
        });
      }
    }
  }

  return items
    .sort((a, b) => (a.publishedAt < b.publishedAt ? 1 : -1))
    .slice(0, limit);
}

export async function getFeed(
  show: "both" | "news" | "notices",
  limit: number,
): Promise<FeedItem[]> {
  return unstable_cache(
    () => loadFeed(show, limit),
    ["site-feed", show, String(limit)],
    { tags: [CONTENT_TAG], revalidate: REVALIDATE_SECONDS },
  )();
}

async function loadEvents(limit: number): Promise<EventItem[]> {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  const live = await liveSourceIds("event");
  if (live.size === 0) return [];

  const { data } = await ctx.sb
    .from("school_events")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .in("id", [...live]);

  // Today counts as upcoming: an event happening this afternoon should not
  // vanish from the page at midnight last night.
  const today = new Date().toISOString().slice(0, 10);
  return (data ?? [])
    .map((r) => {
      const row = r as Record<string, unknown>;
      return {
        id: String(row.id ?? ""),
        title: String(row.title ?? ""),
        description: String(row.description ?? ""),
        startsOn: String(row.starts_on ?? ""),
        startTime: String(row.start_time ?? ""),
        location: String(row.location ?? ""),
        // An event cancelled in the Events desk must leave the website
        // when it is cancelled, not when someone edits the page.
        isActive: row.is_active !== false,
      };
    })
    .filter((e) => e.isActive && e.startsOn && e.startsOn >= today)
    .sort((a, b) => (a.startsOn < b.startsOn ? -1 : 1))
    .slice(0, limit)
    .map(({ isActive: _isActive, ...event }) => event);
}

export async function getUpcomingEvents(limit: number): Promise<EventItem[]> {
  return unstable_cache(() => loadEvents(limit), ["site-events", String(limit)], {
    tags: [CONTENT_TAG],
    revalidate: REVALIDATE_SECONDS,
  })();
}

async function loadAlbum(albumId: string): Promise<AlbumItem | null> {
  const ctx = await getServerTenantContext();
  if (!ctx || !albumId) return null;

  // The album must be ticked on. Knowing its id is not permission to show
  // it — a block could outlive the decision that published it.
  const live = await liveSourceIds("album");
  if (!live.has(albumId)) return null;

  const [{ data: albumRows }, { data: photoRows }] = await Promise.all([
    ctx.sb
      .from("school_comms_desk_albums")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .eq("id", albumId)
      .limit(1),
    ctx.sb
      .from("school_comms_desk_photos")
      .select("*")
      .eq("tenant_id", ctx.tenantId)
      .eq("album_id", albumId),
  ]);

  const album = albumRows?.[0] as Record<string, unknown> | undefined;
  if (!album) return null;

  return {
    id: String(album.id ?? ""),
    title: String(album.title ?? ""),
    description: String(album.description ?? ""),
    photos: (photoRows ?? [])
      .map((r) => {
        const row = r as Record<string, unknown>;
        return {
          id: String(row.id ?? ""),
          url: String(row.url ?? ""),
          caption: String(row.caption ?? ""),
        };
      })
      .filter((p) => p.url),
  };
}

export async function getAlbum(albumId: string): Promise<AlbumItem | null> {
  return unstable_cache(() => loadAlbum(albumId), ["site-album", albumId], {
    tags: [CONTENT_TAG],
    revalidate: REVALIDATE_SECONDS,
  })();
}

async function loadFiles(ids: string[]): Promise<Record<string, SiteMedia>> {
  const ctx = await getServerTenantContext();
  if (!ctx || ids.length === 0) return {};
  const { data } = await ctx.sb
    .from("site_media")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .in("id", ids)
    .is("deleted_at", null);

  const out: Record<string, SiteMedia> = {};
  for (const r of data ?? []) {
    const item = rowToMedia(r as Record<string, unknown>);
    // Same consent gate as pictures. A PDF is unlikely to need it, but the
    // rule lives in one place so it cannot be forgotten in this one.
    if (mayPublishMedia(item)) out[item.id] = item;
  }
  return out;
}

export async function getFiles(
  ids: string[],
): Promise<Record<string, SiteMedia>> {
  const key = [...ids].sort().join(",");
  return unstable_cache(() => loadFiles(ids), ["site-files", key], {
    tags: [CONTENT_TAG],
    revalidate: REVALIDATE_SECONDS,
  })();
}

async function loadPeople(ids: string[]): Promise<Record<string, PersonItem>> {
  const ctx = await getServerTenantContext();
  if (!ctx || ids.length === 0) return {};

  const [{ data: staffRows }, { data: desigRows }] = await Promise.all([
    ctx.sb
      .from("sis_staff")
      .select("id, full_name, designation_id, status")
      .eq("tenant_id", ctx.tenantId)
      .in("id", ids),
    ctx.sb
      .from("sis_designations")
      .select("id, name")
      .eq("tenant_id", ctx.tenantId),
  ]);

  const designation = new Map(
    (desigRows ?? []).map((d) => [
      String((d as Record<string, unknown>).id ?? ""),
      String((d as Record<string, unknown>).name ?? ""),
    ]),
  );

  const out: Record<string, PersonItem> = {};
  for (const r of staffRows ?? []) {
    const row = r as Record<string, unknown>;
    // Someone who has left should come off the website when they leave,
    // not when a person remembers to edit the page.
    if (String(row.status ?? "") === "inactive") continue;
    const id = String(row.id ?? "");
    out[id] = {
      id,
      name: String(row.full_name ?? ""),
      role: designation.get(String(row.designation_id ?? "")) ?? "",
    };
  }
  return out;
}

export async function getPeople(
  ids: string[],
): Promise<Record<string, PersonItem>> {
  const key = [...ids].sort().join(",");
  return unstable_cache(() => loadPeople(ids), ["site-people", key], {
    tags: [CONTENT_TAG],
    revalidate: REVALIDATE_SECONDS,
  })();
}
