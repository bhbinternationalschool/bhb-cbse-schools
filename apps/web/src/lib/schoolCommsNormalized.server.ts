/**
 * School comms desk — Supabase normalized tables (school_comms_desk_*).
 */

import type { SupabaseClient } from "@supabase/supabase-js";
import type {
  GalleryAlbum,
  GalleryPhoto,
  SchoolCommsState,
  SchoolNewsItem,
  SchoolNotice,
} from "@/lib/schoolComms";
import { schoolCommsDualWriteDbEnabled } from "@/lib/schoolCommsDbConfig";
import { getServerTenantContext } from "@/lib/serverTenant";

export type SchoolCommsDeskSyncMeta = {
  noticeCount: number;
  newsCount: number;
  albumCount: number;
  photoCount: number;
  lastPublishedAt: string | null;
  updatedAt: string;
};

export type SchoolCommsDeskBundle = Pick<
  SchoolCommsState,
  "notices" | "news" | "albums" | "photos"
>;

const META_SELECT =
  "notice_count, news_count, album_count, photo_count, last_published_at, updated_at";

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

function noticeToRow(tenantId: string, n: SchoolNotice): Record<string, unknown> {
  return {
    id: n.id,
    tenant_id: tenantId,
    title: n.title || "",
    body: n.body || "",
    audience: n.audience || "all",
    status: n.status || "draft",
    pinned: !!n.pinned,
    academic_year_code: n.academicYearCode || "",
    published_at: n.publishedAt || null,
    created_at: n.createdAt || nowIso(),
    created_by: n.createdBy || "",
    updated_at: n.updatedAt || nowIso(),
  };
}

function rowToNotice(r: Record<string, unknown>): SchoolNotice {
  return {
    id: String(r.id),
    title: String(r.title || ""),
    body: String(r.body || ""),
    audience:
      r.audience === "staff" ||
      r.audience === "parents" ||
      r.audience === "students"
        ? r.audience
        : "all",
    status:
      r.status === "published" || r.status === "archived" ? r.status : "draft",
    pinned: r.pinned === true,
    academicYearCode: String(r.academic_year_code || ""),
    publishedAt: r.published_at ? String(r.published_at) : "",
    createdAt: String(r.created_at || nowIso()),
    createdBy: String(r.created_by || ""),
    updatedAt: String(r.updated_at || nowIso()),
  };
}

function newsToRow(tenantId: string, n: SchoolNewsItem): Record<string, unknown> {
  return {
    id: n.id,
    tenant_id: tenantId,
    title: n.title || "",
    summary: n.summary || "",
    body: n.body || "",
    cover_url: n.coverUrl || "",
    status: n.status || "draft",
    academic_year_code: n.academicYearCode || "",
    published_at: n.publishedAt || null,
    created_at: n.createdAt || nowIso(),
    created_by: n.createdBy || "",
    updated_at: n.updatedAt || nowIso(),
  };
}

function rowToNews(r: Record<string, unknown>): SchoolNewsItem {
  return {
    id: String(r.id),
    title: String(r.title || ""),
    summary: String(r.summary || ""),
    body: String(r.body || ""),
    coverUrl: String(r.cover_url || ""),
    status:
      r.status === "published" || r.status === "archived" ? r.status : "draft",
    academicYearCode: String(r.academic_year_code || ""),
    publishedAt: r.published_at ? String(r.published_at) : "",
    createdAt: String(r.created_at || nowIso()),
    createdBy: String(r.created_by || ""),
    updatedAt: String(r.updated_at || nowIso()),
  };
}

function albumToRow(tenantId: string, a: GalleryAlbum): Record<string, unknown> {
  return {
    id: a.id,
    tenant_id: tenantId,
    title: a.title || "",
    description: a.description || "",
    cover_url: a.coverUrl || "",
    status: a.status || "draft",
    academic_year_code: a.academicYearCode || "",
    published_at: a.publishedAt || null,
    created_at: a.createdAt || nowIso(),
    created_by: a.createdBy || "",
    updated_at: a.updatedAt || nowIso(),
  };
}

function rowToAlbum(r: Record<string, unknown>): GalleryAlbum {
  return {
    id: String(r.id),
    title: String(r.title || ""),
    description: String(r.description || ""),
    coverUrl: String(r.cover_url || ""),
    status:
      r.status === "published" || r.status === "archived" ? r.status : "draft",
    academicYearCode: String(r.academic_year_code || ""),
    publishedAt: r.published_at ? String(r.published_at) : "",
    createdAt: String(r.created_at || nowIso()),
    createdBy: String(r.created_by || ""),
    updatedAt: String(r.updated_at || nowIso()),
  };
}

function photoToRow(tenantId: string, p: GalleryPhoto): Record<string, unknown> {
  return {
    id: p.id,
    tenant_id: tenantId,
    album_id: p.albumId || "",
    url: p.url || "",
    caption: p.caption || "",
    uploaded_at: p.uploadedAt || nowIso(),
    uploaded_by: p.uploadedBy || "",
    updated_at: nowIso(),
  };
}

function rowToPhoto(r: Record<string, unknown>): GalleryPhoto {
  return {
    id: String(r.id),
    albumId: String(r.album_id || ""),
    url: String(r.url || ""),
    caption: String(r.caption || ""),
    uploadedAt: String(r.uploaded_at || nowIso()),
    uploadedBy: String(r.uploaded_by || ""),
  };
}

export async function pushSchoolCommsDeskToDb(
  state: SchoolCommsState,
): Promise<{ ok: boolean; error?: string }> {
  if (!schoolCommsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();

  const notices = state.notices ?? [];
  const news = state.news ?? [];
  const albums = state.albums ?? [];
  const photos = state.photos ?? [];

  await Promise.all([
    deleteStale(sb, tenantId, "school_comms_desk_notices", new Set(notices.map((n) => n.id))),
    deleteStale(sb, tenantId, "school_comms_desk_news", new Set(news.map((n) => n.id))),
    deleteStale(sb, tenantId, "school_comms_desk_albums", new Set(albums.map((a) => a.id))),
    deleteStale(sb, tenantId, "school_comms_desk_photos", new Set(photos.map((p) => p.id))),
  ]);

  const tables: [string, Record<string, unknown>[]][] = [
    ["school_comms_desk_notices", notices.map((n) => noticeToRow(tenantId, n))],
    ["school_comms_desk_news", news.map((n) => newsToRow(tenantId, n))],
    ["school_comms_desk_albums", albums.map((a) => albumToRow(tenantId, a))],
    ["school_comms_desk_photos", photos.map((p) => photoToRow(tenantId, p))],
  ];

  for (const [table, rows] of tables) {
    const r = await upsertChunks(sb, table, rows);
    if (!r.ok) return r;
  }

  let lastPublishedAt: string | null = null;
  for (const item of [...notices, ...news, ...albums]) {
    if (item.status === "published" && item.publishedAt) {
      const at = item.publishedAt;
      if (!lastPublishedAt || at > lastPublishedAt) lastPublishedAt = at;
    }
  }

  await sb.from("school_comms_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      notice_count: notices.length,
      news_count: news.length,
      album_count: albums.length,
      photo_count: photos.length,
      last_published_at: lastPublishedAt,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchSchoolCommsDeskFromDb(): Promise<{
  bundle: SchoolCommsDeskBundle;
  meta: SchoolCommsDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  const empty: SchoolCommsDeskBundle = {
    notices: [],
    news: [],
    albums: [],
    photos: [],
  };
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [
    { data: noticeRows },
    { data: newsRows },
    { data: albumRows },
    { data: photoRows },
    { data: metaRow },
  ] = await Promise.all([
    sb.from("school_comms_desk_notices").select("*").eq("tenant_id", tenantId),
    sb.from("school_comms_desk_news").select("*").eq("tenant_id", tenantId),
    sb.from("school_comms_desk_albums").select("*").eq("tenant_id", tenantId),
    sb.from("school_comms_desk_photos").select("*").eq("tenant_id", tenantId),
    sb
      .from("school_comms_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  return {
    bundle: {
      notices: (noticeRows ?? []).map((r) => rowToNotice(r as Record<string, unknown>)),
      news: (newsRows ?? []).map((r) => rowToNews(r as Record<string, unknown>)),
      albums: (albumRows ?? []).map((r) => rowToAlbum(r as Record<string, unknown>)),
      photos: (photoRows ?? []).map((r) => rowToPhoto(r as Record<string, unknown>)),
    },
    meta: metaRow
      ? {
          noticeCount: (metaRow as { notice_count: number }).notice_count,
          newsCount: (metaRow as { news_count: number }).news_count,
          albumCount: (metaRow as { album_count: number }).album_count,
          photoCount: (metaRow as { photo_count: number }).photo_count,
          lastPublishedAt: (metaRow as { last_published_at: string | null })
            .last_published_at,
          updatedAt: String((metaRow as { updated_at: string }).updated_at),
        }
      : null,
  };
}

/* ─── Standalone gallery desk (school_comms_desk_albums / _photos) ─── */

export type GalleryDeskBundle = Pick<SchoolCommsState, "albums" | "photos">;

export type GalleryDeskSyncMeta = {
  albumCount: number;
  photoCount: number;
  updatedAt: string;
};

export async function pushGalleryDeskToDb(
  bundle: GalleryDeskBundle,
): Promise<{ ok: boolean; error?: string }> {
  const { galleryDualWriteDbEnabled } = await import("@/lib/galleryDbConfig");
  if (!galleryDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();
  const albums = bundle.albums ?? [];
  const photos = bundle.photos ?? [];

  await Promise.all([
    deleteStale(
      sb,
      tenantId,
      "school_comms_desk_albums",
      new Set(albums.map((a) => a.id)),
    ),
    deleteStale(
      sb,
      tenantId,
      "school_comms_desk_photos",
      new Set(photos.map((p) => p.id)),
    ),
  ]);

  const tables: [string, Record<string, unknown>[]][] = [
    ["school_comms_desk_albums", albums.map((a) => albumToRow(tenantId, a))],
    ["school_comms_desk_photos", photos.map((p) => photoToRow(tenantId, p))],
  ];
  for (const [table, rows] of tables) {
    const r = await upsertChunks(sb, table, rows);
    if (!r.ok) return r;
  }

  const { data: metaRow } = await sb
    .from("school_comms_desk_sync_meta")
    .select(META_SELECT)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  await sb.from("school_comms_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      notice_count: Number(metaRow?.notice_count ?? 0),
      news_count: Number(metaRow?.news_count ?? 0),
      album_count: albums.length,
      photo_count: photos.length,
      last_published_at: metaRow?.last_published_at ?? null,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchGalleryDeskFromDb(): Promise<{
  bundle: GalleryDeskBundle;
  meta: GalleryDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  const empty: GalleryDeskBundle = { albums: [], photos: [] };
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [{ data: albumRows }, { data: photoRows }, { data: metaRow }] =
    await Promise.all([
      sb.from("school_comms_desk_albums").select("*").eq("tenant_id", tenantId),
      sb.from("school_comms_desk_photos").select("*").eq("tenant_id", tenantId),
      sb
        .from("school_comms_desk_sync_meta")
        .select("album_count, photo_count, updated_at")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);

  return {
    bundle: {
      albums: (albumRows ?? []).map((r) => rowToAlbum(r as Record<string, unknown>)),
      photos: (photoRows ?? []).map((r) => rowToPhoto(r as Record<string, unknown>)),
    },
    meta: metaRow
      ? {
          albumCount: Number(metaRow.album_count ?? 0),
          photoCount: Number(metaRow.photo_count ?? 0),
          updatedAt: String(metaRow.updated_at || ""),
        }
      : null,
  };
}

/* ─── Standalone news desk (school_comms_desk_news) ─── */

export type NewsDeskBundle = Pick<SchoolCommsState, "news">;

export type NewsDeskSyncMeta = {
  newsCount: number;
  updatedAt: string;
};

export async function pushNewsDeskToDb(
  bundle: NewsDeskBundle,
): Promise<{ ok: boolean; error?: string }> {
  const { newsDualWriteDbEnabled } = await import("@/lib/newsDbConfig");
  if (!newsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();
  const news = bundle.news ?? [];

  await deleteStale(
    sb,
    tenantId,
    "school_comms_desk_news",
    new Set(news.map((n) => n.id)),
  );

  const rows = news.map((n) => newsToRow(tenantId, n));
  if (rows.length > 0) {
    const r = await upsertChunks(sb, "school_comms_desk_news", rows);
    if (!r.ok) return r;
  }

  const { data: metaRow } = await sb
    .from("school_comms_desk_sync_meta")
    .select(META_SELECT)
    .eq("tenant_id", tenantId)
    .maybeSingle();

  let lastPublishedAt: string | null = metaRow?.last_published_at
    ? String(metaRow.last_published_at)
    : null;
  for (const item of news) {
    if (item.status === "published" && item.publishedAt) {
      if (!lastPublishedAt || item.publishedAt > lastPublishedAt) {
        lastPublishedAt = item.publishedAt;
      }
    }
  }

  await sb.from("school_comms_desk_sync_meta").upsert(
    {
      tenant_id: tenantId,
      notice_count: Number(metaRow?.notice_count ?? 0),
      news_count: news.length,
      album_count: Number(metaRow?.album_count ?? 0),
      photo_count: Number(metaRow?.photo_count ?? 0),
      last_published_at: lastPublishedAt,
      updated_at: now,
    },
    { onConflict: "tenant_id" },
  );

  return { ok: true };
}

export async function fetchNewsDeskFromDb(): Promise<{
  bundle: NewsDeskBundle;
  meta: NewsDeskSyncMeta | null;
}> {
  const ctx = await resolveCtx();
  const empty: NewsDeskBundle = { news: [] };
  if (!ctx) return { bundle: empty, meta: null };
  const { sb, tenantId } = ctx;

  const [{ data: newsRows }, { data: metaRow }] = await Promise.all([
    sb.from("school_comms_desk_news").select("*").eq("tenant_id", tenantId),
    sb
      .from("school_comms_desk_sync_meta")
      .select("news_count, updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  return {
    bundle: {
      news: (newsRows ?? []).map((r) => rowToNews(r as Record<string, unknown>)),
    },
    meta: metaRow
      ? {
          newsCount: Number(metaRow.news_count ?? 0),
          updatedAt: String(metaRow.updated_at || ""),
        }
      : null,
  };
}
