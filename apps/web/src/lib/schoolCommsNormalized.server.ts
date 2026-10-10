/**
 * School comms desk — Supabase normalized tables (school_comms_desk_*).
 */

import { reviewStatusOf } from "@/lib/classGallery";
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
import { deleteNamedIds, type NamedDeletes } from "@/lib/deskNamedDeletes.server";
import { emptySchoolComms } from "@/lib/schoolComms";
import { storedNewerIds } from "@/lib/rowStampWrite.server";
import { fetchAllPages } from "@/lib/supabase/pageAll";

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

const ISO_TIMESTAMP = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}/;

function canonicalCommsRow(row: unknown): unknown {
  if (!row || typeof row !== "object" || Array.isArray(row)) return row;
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(row as Record<string, unknown>)) {
    if (v === "" || v === null || v === undefined || v === false) continue;
    if (typeof v === "string" && ISO_TIMESTAMP.test(v)) {
      const t = Date.parse(v);
      out[k] = Number.isFinite(t) ? new Date(t).toISOString() : v;
      continue;
    }
    out[k] = v;
  }
  return out;
}

/**
 * A comms desk (notices / news / albums / photos) in one spelling, for
 * comparing a function holder's push with what is stored
 * (lib/deskFeatureAuth.ts).
 *
 * Read back from the tables, a row is not spelt the way the browser holds
 * it: "2026-10-06T10:00:00+00:00" for "…:00.000Z", "" for a field the
 * browser left out. Compared raw, every published notice looked edited on
 * every save — so a role allowed to ADD notices but not change them was
 * refused as soon as one was out. Empty values are dropped and timestamps
 * re-spelt on both sides; the push*DeskToDb row builders fill the same
 * defaults back in, so what is saved does not change.
 */
export function canonicalCommsDesk<T extends object>(desk: T): T {
  const out: Record<string, unknown> = {};
  for (const [k, v] of Object.entries(desk as Record<string, unknown>)) {
    out[k] = Array.isArray(v) ? v.map(canonicalCommsRow) : v;
  }
  return out as T;
}

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

/**
 * The sample notices / album an empty browser seeds before it has read the
 * desk, exactly as seeded. Stamped "now", they would win over the stored
 * rows with the same ids; untouched, they are only ever added.
 */
const SEED_ROWS = (() => {
  const seed = emptySchoolComms();
  return new Map<string, string>(
    [...seed.notices, ...seed.albums].map((r) => [r.id, `${r.title}\u0000${"body" in r ? r.body : r.description}`]),
  );
})();
const isUntouchedSeed = (r: Record<string, unknown>) =>
  SEED_ROWS.get(String(r.id)) === `${r.title}\u0000${r.body ?? r.description}`;

/**
 * Write a comms list without putting an older copy back (2026-10-10).
 *
 * The comms, news and gallery desks each upserted every row they held, so a
 * tab that loaded a notice before someone edited, archived or published it
 * (another office tab, the scheduled-publish cron, the WhatsApp class
 * channel) wrote its old copy back. Notices, news and albums move their own
 * `updatedAt` on every edit: a row the database holds at a later time is
 * skipped. Photos are never edited — added or deleted only — so they are
 * insert-only. A failed read writes nothing.
 */
export async function writeCommsRows(
  sb: SupabaseClient,
  tenantId: string,
  table: string,
  rows: Record<string, unknown>[],
): Promise<{ ok: true; kept: number } | { ok: false; error: string }> {
  if (!rows.length) return { ok: true, kept: 0 };
  if (table === "school_comms_desk_albums") {
    const filled = await keepStoredAudience(sb, tenantId, rows);
    if (!filled.ok) return filled;
  }
  const insertOnly = (r: Record<string, unknown>) => table === "school_comms_desk_photos" || isUntouchedSeed(r);
  const fresh = rows.filter(insertOnly);
  for (let i = 0; i < fresh.length; i += 200) {
    const { error } = await sb
      .from(table)
      .upsert(fresh.slice(i, i + 200), { onConflict: "id", ignoreDuplicates: true });
    if (error) return { ok: false, error: error.message };
  }
  const rest = rows.filter((r) => !insertOnly(r));
  const newer = await storedNewerIds(sb, tenantId, table, rest);
  if (!newer.ok) return newer;
  if (newer.ids.size) console.warn(`[school-comms-db] ${table}: kept ${newer.ids.size} newer row(s) over a stale copy`);
  const r = await upsertChunks(sb, table, rest.filter((x) => !newer.ids.has(String(x.id))));
  if (!r.ok) return { ok: false, error: r.error || "write failed" };
  return { ok: true, kept: newer.ids.size };
}

/**
 * Albums whose copy does not say who sees them take the stored audience
 * (section_ids, class_label); a new one is school-wide. A failed read writes
 * nothing — guessing "school-wide" could show a class's children to everyone.
 */
async function keepStoredAudience(
  sb: SupabaseClient,
  tenantId: string,
  rows: Record<string, unknown>[],
): Promise<{ ok: true } | { ok: false; error: string }> {
  const missing = rows.filter((r) => r.section_ids === undefined);
  if (!missing.length) return { ok: true };
  const { data, error } = await sb
    .from("school_comms_desk_albums")
    .select("id, section_ids, class_label")
    .eq("tenant_id", tenantId)
    .in("id", missing.map((r) => String(r.id)));
  if (error) return { ok: false, error: `Could not read the albums' audience: ${error.message}` };
  const stored = new Map((data ?? []).map((d) => [String(d.id), d as { section_ids?: string[]; class_label?: string }]));
  for (const r of missing) {
    const d = stored.get(String(r.id));
    r.section_ids = Array.isArray(d?.section_ids) ? d!.section_ids : [];
    r.class_label = d?.class_label ?? "";
  }
  return { ok: true };
}

/** Recount the desk meta from the tables (each desk's copy holds only part). */
export async function touchCommsMeta(sb: SupabaseClient, tenantId: string, now: string): Promise<void> {
  const count = (table: string) =>
    sb.from(table).select("id", { count: "exact", head: true }).eq("tenant_id", tenantId);
  const latest = (table: string) =>
    sb
      .from(table)
      .select("published_at")
      .eq("tenant_id", tenantId)
      .eq("status", "published")
      .order("published_at", { ascending: false })
      .limit(1)
      .maybeSingle();
  const [nt, nw, al, ph, l1, l2, l3] = await Promise.all([
    count("school_comms_desk_notices"),
    count("school_comms_desk_news"),
    count("school_comms_desk_albums"),
    count("school_comms_desk_photos"),
    latest("school_comms_desk_notices"),
    latest("school_comms_desk_news"),
    latest("school_comms_desk_albums"),
  ]);
  const row: Record<string, unknown> = { tenant_id: tenantId, updated_at: now };
  // A failed count leaves the old figure alone rather than writing a zero.
  const ok = (r: { error: unknown; count: number | null }) => !r.error && typeof r.count === "number";
  if (ok(nt)) row.notice_count = nt.count;
  if (ok(nw)) row.news_count = nw.count;
  if (ok(al)) row.album_count = al.count;
  if (ok(ph)) row.photo_count = ph.count;
  if (!l1.error && !l2.error && !l3.error) {
    const times = [l1, l2, l3]
      .map((x) => (x.data as { published_at?: string } | null)?.published_at)
      .filter((t): t is string => !!t)
      .sort();
    row.last_published_at = times.at(-1) ?? null;
  }
  await sb.from("school_comms_desk_sync_meta").upsert(row, { onConflict: "tenant_id" });
}

/** Every row of a comms table — paged: PostgREST stops at 1,000 rows. */
async function readAllComms(sb: SupabaseClient, tenantId: string, table: string) {
  const r = await fetchAllPages<Record<string, unknown>>((from, to) =>
    sb.from(table).select("*").eq("tenant_id", tenantId).order("id", { ascending: true }).range(from, to),
  );
  return { data: r.rows, error: r.error ? { message: r.error } : null };
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
    scheduled_publish_at: n.scheduledPublishAt || null,
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
      r.status === "published" ||
      r.status === "archived" ||
      r.status === "scheduled"
        ? r.status
        : "draft",
    pinned: r.pinned === true,
    academicYearCode: String(r.academic_year_code || ""),
    publishedAt: r.published_at ? String(r.published_at) : "",
    scheduledPublishAt: r.scheduled_publish_at
      ? String(r.scheduled_publish_at)
      : "",
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
    scheduled_publish_at: n.scheduledPublishAt || null,
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
      r.status === "published" ||
      r.status === "archived" ||
      r.status === "scheduled"
        ? r.status
        : "draft",
    academicYearCode: String(r.academic_year_code || ""),
    publishedAt: r.published_at ? String(r.published_at) : "",
    scheduledPublishAt: r.scheduled_publish_at
      ? String(r.scheduled_publish_at)
      : "",
    createdAt: String(r.created_at || nowIso()),
    createdBy: String(r.created_by || ""),
    updatedAt: String(r.updated_at || nowIso()),
  };
}

export function albumToRow(tenantId: string, a: GalleryAlbum): Record<string, unknown> {
  return {
    id: a.id,
    tenant_id: tenantId,
    title: a.title || "",
    description: a.description || "",
    cover_url: a.coverUrl || "",
    status: a.status || "draft",
    academic_year_code: a.academicYearCode || "",
    published_at: a.publishedAt || null,
    scheduled_publish_at: a.scheduledPublishAt || null,
    created_at: a.createdAt || nowIso(),
    created_by: a.createdBy || "",
    updated_at: a.updatedAt || nowIso(),
    // Left undefined when the copy does not carry them (an older browser):
    // writeCommsRows then keeps the stored audience — a class album must
    // never become school-wide because someone saved without knowing of it.
    section_ids: Array.isArray(a.sectionIds) ? a.sectionIds : undefined,
    class_label: Array.isArray(a.sectionIds) ? a.classLabel || "" : undefined,
  };
}

export function rowToAlbum(r: Record<string, unknown>): GalleryAlbum {
  return {
    id: String(r.id),
    title: String(r.title || ""),
    description: String(r.description || ""),
    coverUrl: String(r.cover_url || ""),
    status:
      r.status === "published" ||
      r.status === "archived" ||
      r.status === "scheduled"
        ? r.status
        : "draft",
    academicYearCode: String(r.academic_year_code || ""),
    publishedAt: r.published_at ? String(r.published_at) : "",
    scheduledPublishAt: r.scheduled_publish_at
      ? String(r.scheduled_publish_at)
      : "",
    createdAt: String(r.created_at || nowIso()),
    createdBy: String(r.created_by || ""),
    updatedAt: String(r.updated_at || nowIso()),
    sectionIds: Array.isArray(r.section_ids) ? (r.section_ids as unknown[]).map(String) : [],
    classLabel: String(r.class_label || ""),
  };
}

export function photoToRow(tenantId: string, p: GalleryPhoto): Record<string, unknown> {
  return {
    id: p.id,
    tenant_id: tenantId,
    album_id: p.albumId || "",
    url: p.url || "",
    caption: p.caption || "",
    uploaded_at: p.uploadedAt || nowIso(),
    uploaded_by: p.uploadedBy || "",
    updated_at: nowIso(),
    media_kind: p.mediaKind === "video" ? "video" : "photo",
    storage_path: p.storagePath || "",
    // Never the browser's word: a class item a desk save inserts (a stale
    // copy of one removed, say) is checked again. Rows are insert-only, so
    // a save never moves a stored item's status.
    review_status: p.storagePath ? "pending" : "ok",
  };
}

export function rowToPhoto(r: Record<string, unknown>): GalleryPhoto {
  return {
    id: String(r.id),
    albumId: String(r.album_id || ""),
    url: String(r.url || ""),
    caption: String(r.caption || ""),
    uploadedAt: String(r.uploaded_at || nowIso()),
    uploadedBy: String(r.uploaded_by || ""),
    mediaKind: r.media_kind === "video" ? "video" : "photo",
    storagePath: String(r.storage_path || ""),
    reviewStatus: reviewStatusOf(r.review_status),
    reviewNote: String(r.review_note || ""),
  };
}

/** The comms tables a desk save deletes from — by named id only. */
export const SCHOOL_COMMS_DELETABLE_TABLES = [
  "school_comms_desk_notices",
  "school_comms_desk_news",
  "school_comms_desk_albums",
  "school_comms_desk_photos",
] as const;
/** Desk slice each deletable table stores (for function-only writers). */
export const SCHOOL_COMMS_TABLE_SLICES: Record<string, string> = {
  school_comms_desk_notices: "notices",
  school_comms_desk_news: "news",
  school_comms_desk_albums: "albums",
  school_comms_desk_photos: "photos",
};

/**
 * No prune by absence. Notices are published by the WhatsApp class channel
 * and the scheduled-publish cron on the server; the comms, news and gallery
 * pushes each deleted whatever this browser's copy lacked — and the server
 * loader fell back to a stale blob on a failed read. A notice, a news item,
 * an album (with its photos) or a photo goes only when the user deleted it,
 * and the deletion arrives named.
 */
async function applyNamedCommsDeletes(
  sb: SupabaseClient,
  tenantId: string,
  deletes: NamedDeletes,
  tables: readonly string[],
): Promise<{ ok: boolean; error?: string }> {
  for (const table of tables) {
    const del = await deleteNamedIds(sb, tenantId, table, deletes[table]);
    if (!del.ok) return del;
  }
  return { ok: true };
}

const goneOf = (deletes: NamedDeletes, table: string) => new Set(deletes[table] ?? []);

export async function pushSchoolCommsDeskToDb(
  state: SchoolCommsState,
  deletes: NamedDeletes = {},
): Promise<{ ok: boolean; error?: string }> {
  if (!schoolCommsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();

  const goneNotices = goneOf(deletes, "school_comms_desk_notices");
  const goneNews = goneOf(deletes, "school_comms_desk_news");
  const goneAlbums = goneOf(deletes, "school_comms_desk_albums");
  const gonePhotos = goneOf(deletes, "school_comms_desk_photos");
  const notices = (state.notices ?? []).filter((n) => !goneNotices.has(n.id));
  const news = (state.news ?? []).filter((n) => !goneNews.has(n.id));
  const albums = (state.albums ?? []).filter((a) => !goneAlbums.has(a.id));
  const photos = (state.photos ?? []).filter((p) => !gonePhotos.has(p.id));

  const tables: [string, Record<string, unknown>[]][] = [
    ["school_comms_desk_notices", notices.map((n) => noticeToRow(tenantId, n))],
    ["school_comms_desk_news", news.map((n) => newsToRow(tenantId, n))],
    ["school_comms_desk_albums", albums.map((a) => albumToRow(tenantId, a))],
    ["school_comms_desk_photos", photos.map((p) => photoToRow(tenantId, p))],
  ];

  for (const [table, rows] of tables) {
    const r = await writeCommsRows(sb, tenantId, table, rows);
    if (!r.ok) return r;
  }
  {
    const del = await applyNamedCommsDeletes(sb, tenantId, deletes, SCHOOL_COMMS_DELETABLE_TABLES);
    if (!del.ok) return del;
  }

  await touchCommsMeta(sb, tenantId, now).catch(() => undefined);
  return { ok: true };
}

export async function fetchSchoolCommsDeskFromDb(): Promise<{
  bundle: SchoolCommsDeskBundle;
  meta: SchoolCommsDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; bundle is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  const empty: SchoolCommsDeskBundle = {
    notices: [],
    news: [],
    albums: [],
    photos: [],
  };
  if (!ctx) return { bundle: empty, meta: null, ok: false };
  const { sb, tenantId } = ctx;

  const [
    { data: noticeRows, error: noticeErr },
    { data: newsRows, error: newsErr },
    { data: albumRows, error: albumErr },
    { data: photoRows, error: photoErr },
    { data: metaRow },
  ] = await Promise.all([
    readAllComms(sb, tenantId, "school_comms_desk_notices"),
    readAllComms(sb, tenantId, "school_comms_desk_news"),
    readAllComms(sb, tenantId, "school_comms_desk_albums"),
    readAllComms(sb, tenantId, "school_comms_desk_photos"),
    sb
      .from("school_comms_desk_sync_meta")
      .select(META_SELECT)
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (noticeErr || newsErr || albumErr || photoErr) {
    console.warn(
      "[school-comms-db] fetch failed",
      noticeErr?.message,
      newsErr?.message,
      albumErr?.message,
      photoErr?.message,
    );
    return { bundle: empty, meta: null, ok: false };
  }

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
    ok: true,
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
  deletes: NamedDeletes = {},
): Promise<{ ok: boolean; error?: string }> {
  const { galleryDualWriteDbEnabled } = await import("@/lib/galleryDbConfig");
  if (!galleryDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();
  const goneAlbums = goneOf(deletes, "school_comms_desk_albums");
  const gonePhotos = goneOf(deletes, "school_comms_desk_photos");
  const albums = (bundle.albums ?? []).filter((a) => !goneAlbums.has(a.id));
  const photos = (bundle.photos ?? []).filter((p) => !gonePhotos.has(p.id));

  const tables: [string, Record<string, unknown>[]][] = [
    ["school_comms_desk_albums", albums.map((a) => albumToRow(tenantId, a))],
    ["school_comms_desk_photos", photos.map((p) => photoToRow(tenantId, p))],
  ];
  for (const [table, rows] of tables) {
    const r = await writeCommsRows(sb, tenantId, table, rows);
    if (!r.ok) return r;
  }
  {
    const del = await applyNamedCommsDeletes(sb, tenantId, deletes, [
      "school_comms_desk_albums",
      "school_comms_desk_photos",
    ]);
    if (!del.ok) return del;
  }

  await touchCommsMeta(sb, tenantId, now).catch(() => undefined);
  return { ok: true };
}

export async function fetchGalleryDeskFromDb(): Promise<{
  bundle: GalleryDeskBundle;
  meta: GalleryDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; bundle is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  const empty: GalleryDeskBundle = { albums: [], photos: [] };
  if (!ctx) return { bundle: empty, meta: null, ok: false };
  const { sb, tenantId } = ctx;

  const [
    { data: albumRows, error: albumErr },
    { data: photoRows, error: photoErr },
    { data: metaRow },
  ] = await Promise.all([
    readAllComms(sb, tenantId, "school_comms_desk_albums"),
    readAllComms(sb, tenantId, "school_comms_desk_photos"),
    sb
      .from("school_comms_desk_sync_meta")
      .select("album_count, photo_count, updated_at")
      .eq("tenant_id", tenantId)
      .maybeSingle(),
  ]);

  if (albumErr || photoErr) {
    console.warn(
      "[gallery-db] fetch failed",
      albumErr?.message,
      photoErr?.message,
    );
    return { bundle: empty, meta: null, ok: false };
  }

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
    ok: true,
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
  deletes: NamedDeletes = {},
): Promise<{ ok: boolean; error?: string }> {
  const { newsDualWriteDbEnabled } = await import("@/lib/newsDbConfig");
  if (!newsDualWriteDbEnabled()) return { ok: true };
  const ctx = await resolveCtx();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { sb, tenantId } = ctx;
  const now = nowIso();
  const goneNews = goneOf(deletes, "school_comms_desk_news");
  const news = (bundle.news ?? []).filter((n) => !goneNews.has(n.id));

  const r = await writeCommsRows(sb, tenantId, "school_comms_desk_news", news.map((n) => newsToRow(tenantId, n)));
  if (!r.ok) return r;
  {
    const del = await applyNamedCommsDeletes(sb, tenantId, deletes, ["school_comms_desk_news"]);
    if (!del.ok) return del;
  }

  await touchCommsMeta(sb, tenantId, now).catch(() => undefined);
  return { ok: true };
}

export async function fetchNewsDeskFromDb(): Promise<{
  bundle: NewsDeskBundle;
  meta: NewsDeskSyncMeta | null;
  /** false = tenant/query could not be resolved; bundle is NOT a confirmed empty state. */
  ok: boolean;
}> {
  const ctx = await resolveCtx();
  const empty: NewsDeskBundle = { news: [] };
  if (!ctx) return { bundle: empty, meta: null, ok: false };
  const { sb, tenantId } = ctx;

  const [{ data: newsRows, error: newsErr }, { data: metaRow }] =
    await Promise.all([
      readAllComms(sb, tenantId, "school_comms_desk_news"),
      sb
        .from("school_comms_desk_sync_meta")
        .select("news_count, updated_at")
        .eq("tenant_id", tenantId)
        .maybeSingle(),
    ]);

  if (newsErr) {
    console.warn("[news-db] fetch failed", newsErr.message);
    return { bundle: empty, meta: null, ok: false };
  }

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
    ok: true,
  };
}
