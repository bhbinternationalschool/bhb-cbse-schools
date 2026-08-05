/**
 * School communications — notices/circulars, news, gallery.
 * Store: localStorage `bhb_school_comms_v1` + Supabase blob.
 */

import { assertModulePermission } from "@/lib/rbacGuard";
import { DEFAULT_AY } from "@/lib/masters";
import { TENANT } from "@/lib/types";

const STORAGE_KEY = "bhb_school_comms_v1";

let serverSchoolCommsCache: SchoolCommsState | null = null;

export type CommsAudience = "all" | "staff" | "parents" | "students";
export type NoticeStatus = "draft" | "scheduled" | "published" | "archived";

export type SchoolNotice = {
  id: string;
  title: string;
  body: string;
  audience: CommsAudience;
  status: NoticeStatus;
  pinned: boolean;
  academicYearCode: string;
  publishedAt: string;
  scheduledPublishAt: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
};

export type SchoolNewsItem = {
  id: string;
  title: string;
  summary: string;
  body: string;
  coverUrl: string;
  status: NoticeStatus;
  academicYearCode: string;
  publishedAt: string;
  scheduledPublishAt: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
};

export type GalleryPhoto = {
  id: string;
  albumId: string;
  url: string;
  caption: string;
  uploadedAt: string;
  uploadedBy: string;
};

export type GalleryAlbum = {
  id: string;
  title: string;
  description: string;
  coverUrl: string;
  status: NoticeStatus;
  academicYearCode: string;
  publishedAt: string;
  scheduledPublishAt: string;
  createdAt: string;
  createdBy: string;
  updatedAt: string;
};

export type SchoolCommsState = {
  version: 1;
  notices: SchoolNotice[];
  news: SchoolNewsItem[];
  albums: GalleryAlbum[];
  photos: GalleryPhoto[];
};

function nid(prefix: string) {
  return `${prefix}_${Math.random().toString(36).slice(2, 10)}`;
}
function nowIso() {
  return new Date().toISOString();
}

function parseScheduleAt(raw?: string): string {
  const v = raw?.trim();
  if (!v) return "";
  const d = new Date(v);
  if (Number.isNaN(d.getTime())) return "";
  return d.toISOString();
}

function resolvePublishSchedule(opts: {
  publish?: boolean;
  schedule?: boolean;
  scheduledPublishAt?: string;
  explicitStatus?: NoticeStatus;
  prevStatus?: NoticeStatus;
  prevScheduledAt?: string;
}): { status: NoticeStatus; scheduledPublishAt: string; publishNow: boolean } {
  if (opts.publish) {
    return { status: "published", scheduledPublishAt: "", publishNow: true };
  }
  const at = parseScheduleAt(opts.scheduledPublishAt ?? opts.prevScheduledAt);
  if (opts.schedule && at) {
    if (new Date(at).getTime() <= Date.now()) {
      return { status: "published", scheduledPublishAt: "", publishNow: true };
    }
    return { status: "scheduled", scheduledPublishAt: at, publishNow: false };
  }
  if (opts.explicitStatus) {
    return {
      status: opts.explicitStatus,
      scheduledPublishAt:
        opts.explicitStatus === "scheduled" ? at || opts.prevScheduledAt || "" : "",
      publishNow: opts.explicitStatus === "published",
    };
  }
  const status =
    opts.prevStatus === "scheduled" || opts.prevStatus === "published"
      ? "draft"
      : (opts.prevStatus ?? "draft");
  return { status, scheduledPublishAt: "", publishNow: false };
}

export type ScheduledCommsItem = {
  kind: "notice" | "news" | "gallery";
  id: string;
  title: string;
  scheduledPublishAt: string;
  status: NoticeStatus;
};

export function listScheduledComms(state?: SchoolCommsState): ScheduledCommsItem[] {
  const s = state ?? loadSchoolComms();
  const items: ScheduledCommsItem[] = [];
  for (const n of s.notices) {
    if (n.status === "scheduled" && n.scheduledPublishAt) {
      items.push({
        kind: "notice",
        id: n.id,
        title: n.title,
        scheduledPublishAt: n.scheduledPublishAt,
        status: n.status,
      });
    }
  }
  for (const n of s.news) {
    if (n.status === "scheduled" && n.scheduledPublishAt) {
      items.push({
        kind: "news",
        id: n.id,
        title: n.title,
        scheduledPublishAt: n.scheduledPublishAt,
        status: n.status,
      });
    }
  }
  for (const a of s.albums) {
    if (a.status === "scheduled" && a.scheduledPublishAt) {
      items.push({
        kind: "gallery",
        id: a.id,
        title: a.title,
        scheduledPublishAt: a.scheduledPublishAt,
        status: a.status,
      });
    }
  }
  return items.sort((a, b) =>
    a.scheduledPublishAt.localeCompare(b.scheduledPublishAt),
  );
}

function withScheduleDefaults<T extends { scheduledPublishAt?: string }>(row: T): T & {
  scheduledPublishAt: string;
} {
  return { ...row, scheduledPublishAt: row.scheduledPublishAt ?? "" };
}

export function emptySchoolComms(): SchoolCommsState {
  return { version: 1, notices: [], news: [], albums: [], photos: [] };
}

function normalize(raw: Partial<SchoolCommsState> | null): SchoolCommsState {
  const base = emptySchoolComms();
  if (!raw) return base;
  return {
    version: 1,
    notices: Array.isArray(raw.notices)
      ? (raw.notices as SchoolNotice[]).map((n) => withScheduleDefaults(n))
      : [],
    news: Array.isArray(raw.news)
      ? (raw.news as SchoolNewsItem[]).map((n) => withScheduleDefaults(n))
      : [],
    albums: Array.isArray(raw.albums)
      ? (raw.albums as GalleryAlbum[]).map((a) => withScheduleDefaults(a))
      : [],
    photos: Array.isArray(raw.photos) ? (raw.photos as GalleryPhoto[]) : [],
  };
}

export function loadSchoolComms(): SchoolCommsState {
  if (typeof window === "undefined") {
    if (serverSchoolCommsCache) return serverSchoolCommsCache;
    return emptySchoolComms();
  }
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return emptySchoolComms();
    return normalize(JSON.parse(raw) as Partial<SchoolCommsState>);
  } catch {
    return emptySchoolComms();
  }
}

export function writeSchoolCommsLocalRaw(state: SchoolCommsState): void {
  if (typeof window === "undefined") {
    serverSchoolCommsCache = normalize(state);
    return;
  }
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(state)));
  window.dispatchEvent(new CustomEvent("bhb-school-comms"));
}

export function schoolCommsIsEmpty(state: SchoolCommsState): boolean {
  return (
    (state.notices?.length ?? 0) === 0 &&
    (state.news?.length ?? 0) === 0 &&
    (state.albums?.length ?? 0) === 0
  );
}

export function saveSchoolComms(state: SchoolCommsState): void {
  // Publishing uses create/edit on specific modules; raw save gated by notices edit
  // when actor present — allow if any of the three modules can edit.
  if (typeof window === "undefined") return;
  localStorage.setItem(STORAGE_KEY, JSON.stringify(normalize(state)));
  window.dispatchEvent(new CustomEvent("bhb-school-comms"));
  void import("@/lib/schoolCommsPersistence").then(({ scheduleSchoolCommsSync }) => {
    scheduleSchoolCommsSync(state);
  });
}

function canEditComms(module: "notices" | "news" | "gallery"): boolean {
  return assertModulePermission(module, "edit", `save${module}`);
}

function canCreateComms(module: "notices" | "news" | "gallery"): boolean {
  return assertModulePermission(module, "create", `create${module}`);
}

export function audienceLabel(a: CommsAudience): string {
  switch (a) {
    case "staff":
      return "Staff";
    case "parents":
      return "Parents";
    case "students":
      return "Students";
    default:
      return "Everyone";
  }
}

/* ——— Notices ——— */

export function listNotices(
  state?: SchoolCommsState,
  opts?: { status?: NoticeStatus; audience?: CommsAudience; publishedOnly?: boolean },
): SchoolNotice[] {
  const s = state ?? loadSchoolComms();
  return [...s.notices]
    .filter((n) => {
      if (opts?.status && n.status !== opts.status) return false;
      if (opts?.publishedOnly && n.status !== "published") return false;
      if (opts?.audience && n.audience !== "all" && n.audience !== opts.audience) {
        return false;
      }
      return true;
    })
    .sort((a, b) => {
      if (a.pinned !== b.pinned) return a.pinned ? -1 : 1;
      return (b.publishedAt || b.createdAt).localeCompare(
        a.publishedAt || a.createdAt,
      );
    });
}

export function upsertNotice(input: {
  id?: string;
  title: string;
  body: string;
  audience: CommsAudience;
  pinned?: boolean;
  status?: NoticeStatus;
  academicYearCode?: string;
  createdBy: string;
  publish?: boolean;
  schedule?: boolean;
  scheduledPublishAt?: string;
}):
  | { ok: true; notice: SchoolNotice; state: SchoolCommsState }
  | { ok: false; error: string } {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) return { ok: false, error: "Title is required" };
  if (!body) return { ok: false, error: "Body is required" };
  const isNew = !input.id;
  if (isNew && !canCreateComms("notices")) {
    return { ok: false, error: "No permission to create notices" };
  }
  if (!isNew && !canEditComms("notices")) {
    return { ok: false, error: "No permission to edit notices" };
  }

  const state = loadSchoolComms();
  const now = nowIso();
  let notice: SchoolNotice;
  if (input.id) {
    const i = state.notices.findIndex((n) => n.id === input.id);
    if (i < 0) return { ok: false, error: "Notice not found" };
    const prev = state.notices[i]!;
    const resolved = resolvePublishSchedule({
      publish: input.publish,
      schedule: input.schedule,
      scheduledPublishAt: input.scheduledPublishAt,
      explicitStatus: input.status,
      prevStatus: prev.status,
      prevScheduledAt: prev.scheduledPublishAt,
    });
    notice = {
      ...prev,
      title,
      body,
      audience: input.audience,
      pinned: input.pinned ?? prev.pinned,
      status: resolved.status,
      publishedAt: resolved.publishNow ? prev.publishedAt || now : prev.publishedAt,
      scheduledPublishAt: resolved.scheduledPublishAt,
      updatedAt: now,
    };
    const notices = [...state.notices];
    notices[i] = notice;
    const next = { ...state, notices };
    saveSchoolComms(next);
    if (resolved.publishNow && prev.status !== "published") {
      void pushNoticeNotifications(notice);
    }
    return { ok: true, notice, state: next };
  }

  const resolved = resolvePublishSchedule({
    publish: input.publish,
    schedule: input.schedule,
    scheduledPublishAt: input.scheduledPublishAt,
    explicitStatus: input.status,
  });
  notice = {
    id: nid("ntc"),
    title,
    body,
    audience: input.audience,
    status: resolved.status,
    pinned: !!input.pinned,
    academicYearCode: input.academicYearCode || DEFAULT_AY,
    publishedAt: resolved.publishNow ? now : "",
    scheduledPublishAt: resolved.scheduledPublishAt,
    createdAt: now,
    createdBy: input.createdBy || "office",
    updatedAt: now,
  };
  const next = { ...state, notices: [notice, ...state.notices] };
  saveSchoolComms(next);
  if (resolved.publishNow) void pushNoticeNotifications(notice);
  return { ok: true, notice, state: next };
}

export function setNoticeStatus(
  id: string,
  status: NoticeStatus,
): { ok: true; state: SchoolCommsState } | { ok: false; error: string } {
  if (!canEditComms("notices")) return { ok: false, error: "No permission" };
  const state = loadSchoolComms();
  const i = state.notices.findIndex((n) => n.id === id);
  if (i < 0) return { ok: false, error: "Not found" };
  const prev = state.notices[i]!;
  const now = nowIso();
  const notice: SchoolNotice = {
    ...prev,
    status,
    publishedAt:
      status === "published" ? prev.publishedAt || now : prev.publishedAt,
    scheduledPublishAt: status === "published" ? "" : prev.scheduledPublishAt,
    updatedAt: now,
  };
  const notices = [...state.notices];
  notices[i] = notice;
  const next = { ...state, notices };
  saveSchoolComms(next);
  if (status === "published" && prev.status !== "published") {
    void pushNoticeNotifications(notice);
  }
  return { ok: true, state: next };
}

async function pushNoticeNotifications(notice: SchoolNotice) {
  const { pushNotification } = await import("@/lib/notifications");
  pushNotification({
    title: notice.title,
    body: notice.body.slice(0, 160),
    kind: "notice",
    href: "/comms?tab=notices",
    audience: notice.audience,
    sourceId: notice.id,
  });
}

/* ——— News ——— */

export function listNews(
  state?: SchoolCommsState,
  opts?: { publishedOnly?: boolean },
): SchoolNewsItem[] {
  const s = state ?? loadSchoolComms();
  return [...s.news]
    .filter((n) => (opts?.publishedOnly ? n.status === "published" : true))
    .sort((a, b) =>
      (b.publishedAt || b.createdAt).localeCompare(a.publishedAt || a.createdAt),
    );
}

export function upsertNews(input: {
  id?: string;
  title: string;
  summary?: string;
  body: string;
  coverUrl?: string;
  status?: NoticeStatus;
  academicYearCode?: string;
  createdBy: string;
  publish?: boolean;
  schedule?: boolean;
  scheduledPublishAt?: string;
}):
  | { ok: true; item: SchoolNewsItem; state: SchoolCommsState }
  | { ok: false; error: string } {
  const title = input.title.trim();
  const body = input.body.trim();
  if (!title) return { ok: false, error: "Title is required" };
  if (!body) return { ok: false, error: "Body is required" };
  const isNew = !input.id;
  if (isNew && !canCreateComms("news")) {
    return { ok: false, error: "No permission to create news" };
  }
  if (!isNew && !canEditComms("news")) {
    return { ok: false, error: "No permission to edit news" };
  }

  const state = loadSchoolComms();
  const now = nowIso();
  let item: SchoolNewsItem;
  if (input.id) {
    const i = state.news.findIndex((n) => n.id === input.id);
    if (i < 0) return { ok: false, error: "News not found" };
    const prev = state.news[i]!;
    const resolved = resolvePublishSchedule({
      publish: input.publish,
      schedule: input.schedule,
      scheduledPublishAt: input.scheduledPublishAt,
      explicitStatus: input.status,
      prevStatus: prev.status,
      prevScheduledAt: prev.scheduledPublishAt,
    });
    item = {
      ...prev,
      title,
      summary: (input.summary ?? prev.summary).trim(),
      body,
      coverUrl: input.coverUrl ?? prev.coverUrl,
      status: resolved.status,
      publishedAt: resolved.publishNow ? prev.publishedAt || now : prev.publishedAt,
      scheduledPublishAt: resolved.scheduledPublishAt,
      updatedAt: now,
    };
    const news = [...state.news];
    news[i] = item;
    const next = { ...state, news };
    saveSchoolComms(next);
    if (resolved.publishNow && prev.status !== "published") {
      void pushNewsNotifications(item);
    }
    return { ok: true, item, state: next };
  }

  const resolved = resolvePublishSchedule({
    publish: input.publish,
    schedule: input.schedule,
    scheduledPublishAt: input.scheduledPublishAt,
    explicitStatus: input.status,
  });
  item = {
    id: nid("nws"),
    title,
    summary: (input.summary || "").trim() || body.slice(0, 120),
    body,
    coverUrl: input.coverUrl || "",
    status: resolved.status,
    academicYearCode: input.academicYearCode || DEFAULT_AY,
    publishedAt: resolved.publishNow ? now : "",
    scheduledPublishAt: resolved.scheduledPublishAt,
    createdAt: now,
    createdBy: input.createdBy || "office",
    updatedAt: now,
  };
  const next = { ...state, news: [item, ...state.news] };
  saveSchoolComms(next);
  if (resolved.publishNow) void pushNewsNotifications(item);
  return { ok: true, item, state: next };
}

export function setNewsStatus(
  id: string,
  status: NoticeStatus,
): { ok: true; state: SchoolCommsState } | { ok: false; error: string } {
  if (!canEditComms("news")) return { ok: false, error: "No permission" };
  const state = loadSchoolComms();
  const i = state.news.findIndex((n) => n.id === id);
  if (i < 0) return { ok: false, error: "Not found" };
  const prev = state.news[i]!;
  const now = nowIso();
  const item: SchoolNewsItem = {
    ...prev,
    status,
    publishedAt:
      status === "published" ? prev.publishedAt || now : prev.publishedAt,
    scheduledPublishAt: status === "published" ? "" : prev.scheduledPublishAt,
    updatedAt: now,
  };
  const news = [...state.news];
  news[i] = item;
  const next = { ...state, news };
  saveSchoolComms(next);
  if (status === "published" && prev.status !== "published") {
    void pushNewsNotifications(item);
  }
  return { ok: true, state: next };
}

async function pushNewsNotifications(item: SchoolNewsItem) {
  const { pushNotification } = await import("@/lib/notifications");
  pushNotification({
    title: `News · ${item.title}`,
    body: item.summary || item.body.slice(0, 160),
    kind: "news",
    href: "/comms?tab=news",
    audience: "all",
    sourceId: item.id,
  });
}

/* ——— Gallery ——— */

export function listAlbums(
  state?: SchoolCommsState,
  opts?: { publishedOnly?: boolean },
): GalleryAlbum[] {
  const s = state ?? loadSchoolComms();
  return [...s.albums]
    .filter((a) => (opts?.publishedOnly ? a.status === "published" : true))
    .sort((a, b) =>
      (b.publishedAt || b.createdAt).localeCompare(a.publishedAt || a.createdAt),
    );
}

export function photosForAlbum(
  albumId: string,
  state?: SchoolCommsState,
): GalleryPhoto[] {
  const s = state ?? loadSchoolComms();
  return s.photos
    .filter((p) => p.albumId === albumId)
    .sort((a, b) => b.uploadedAt.localeCompare(a.uploadedAt));
}

export function upsertAlbum(input: {
  id?: string;
  title: string;
  description?: string;
  coverUrl?: string;
  status?: NoticeStatus;
  academicYearCode?: string;
  createdBy: string;
  publish?: boolean;
  schedule?: boolean;
  scheduledPublishAt?: string;
}):
  | { ok: true; album: GalleryAlbum; state: SchoolCommsState }
  | { ok: false; error: string } {
  const title = input.title.trim();
  if (!title) return { ok: false, error: "Album title is required" };
  const isNew = !input.id;
  if (isNew && !canCreateComms("gallery")) {
    return { ok: false, error: "No permission to create albums" };
  }
  if (!isNew && !canEditComms("gallery")) {
    return { ok: false, error: "No permission to edit albums" };
  }

  const state = loadSchoolComms();
  const now = nowIso();
  let album: GalleryAlbum;
  if (input.id) {
    const i = state.albums.findIndex((a) => a.id === input.id);
    if (i < 0) return { ok: false, error: "Album not found" };
    const prev = state.albums[i]!;
    const resolved = resolvePublishSchedule({
      publish: input.publish,
      schedule: input.schedule,
      scheduledPublishAt: input.scheduledPublishAt,
      explicitStatus: input.status,
      prevStatus: prev.status,
      prevScheduledAt: prev.scheduledPublishAt,
    });
    album = {
      ...prev,
      title,
      description: (input.description ?? prev.description).trim(),
      coverUrl: input.coverUrl ?? prev.coverUrl,
      status: resolved.status,
      publishedAt: resolved.publishNow ? prev.publishedAt || now : prev.publishedAt,
      scheduledPublishAt: resolved.scheduledPublishAt,
      updatedAt: now,
    };
    const albums = [...state.albums];
    albums[i] = album;
    const next = { ...state, albums };
    saveSchoolComms(next);
    return { ok: true, album, state: next };
  }

  const resolved = resolvePublishSchedule({
    publish: input.publish,
    schedule: input.schedule,
    scheduledPublishAt: input.scheduledPublishAt,
    explicitStatus: input.status,
  });
  album = {
    id: nid("alb"),
    title,
    description: (input.description || "").trim(),
    coverUrl: input.coverUrl || "",
    status: resolved.status,
    academicYearCode: input.academicYearCode || DEFAULT_AY,
    publishedAt: resolved.publishNow ? now : "",
    scheduledPublishAt: resolved.scheduledPublishAt,
    createdAt: now,
    createdBy: input.createdBy || "office",
    updatedAt: now,
  };
  const next = { ...state, albums: [album, ...state.albums] };
  saveSchoolComms(next);
  return { ok: true, album, state: next };
}

export function addGalleryPhoto(input: {
  albumId: string;
  url: string;
  caption?: string;
  uploadedBy: string;
}):
  | { ok: true; photo: GalleryPhoto; state: SchoolCommsState }
  | { ok: false; error: string } {
  if (!canEditComms("gallery") && !canCreateComms("gallery")) {
    return { ok: false, error: "No permission to add photos" };
  }
  if (!input.url.trim()) return { ok: false, error: "Photo URL required" };
  const state = loadSchoolComms();
  if (!state.albums.some((a) => a.id === input.albumId)) {
    return { ok: false, error: "Album not found" };
  }
  const photo: GalleryPhoto = {
    id: nid("pho"),
    albumId: input.albumId,
    url: input.url.trim(),
    caption: (input.caption || "").trim(),
    uploadedAt: nowIso(),
    uploadedBy: input.uploadedBy || "office",
  };
  let albums = state.albums;
  const alb = albums.find((a) => a.id === input.albumId);
  if (alb && !alb.coverUrl) {
    albums = albums.map((a) =>
      a.id === input.albumId ? { ...a, coverUrl: photo.url, updatedAt: nowIso() } : a,
    );
  }
  const next = {
    ...state,
    albums,
    photos: [photo, ...state.photos],
  };
  saveSchoolComms(next);
  return { ok: true, photo, state: next };
}

export function setAlbumStatus(
  id: string,
  status: NoticeStatus,
): { ok: true; state: SchoolCommsState } | { ok: false; error: string } {
  if (!canEditComms("gallery")) return { ok: false, error: "No permission" };
  const state = loadSchoolComms();
  const i = state.albums.findIndex((a) => a.id === id);
  if (i < 0) return { ok: false, error: "Not found" };
  const prev = state.albums[i]!;
  const now = nowIso();
  const album: GalleryAlbum = {
    ...prev,
    status,
    publishedAt:
      status === "published" ? prev.publishedAt || now : prev.publishedAt,
    scheduledPublishAt: status === "published" ? "" : prev.scheduledPublishAt,
    updatedAt: now,
  };
  const albums = [...state.albums];
  albums[i] = album;
  const next = { ...state, albums };
  saveSchoolComms(next);
  if (status === "published" && prev.status !== "published") {
    void import("@/lib/notifications").then(({ pushNotification }) => {
      pushNotification({
        title: `Gallery · ${album.title}`,
        body: album.description || `New album from ${TENANT.nameDisplay}`,
        kind: "gallery",
        href: "/comms?tab=gallery",
        audience: "all",
        sourceId: album.id,
      });
    });
  }
  return { ok: true, state: next };
}

export function deleteNotice(
  id: string,
): { ok: true; state: SchoolCommsState } | { ok: false; error: string } {
  if (!canEditComms("notices")) return { ok: false, error: "No permission" };
  const state = loadSchoolComms();
  if (!state.notices.some((n) => n.id === id)) {
    return { ok: false, error: "Not found" };
  }
  const next = { ...state, notices: state.notices.filter((n) => n.id !== id) };
  saveSchoolComms(next);
  return { ok: true, state: next };
}

export function deleteNews(
  id: string,
): { ok: true; state: SchoolCommsState } | { ok: false; error: string } {
  if (!canEditComms("news")) return { ok: false, error: "No permission" };
  const state = loadSchoolComms();
  if (!state.news.some((n) => n.id === id)) {
    return { ok: false, error: "Not found" };
  }
  const next = { ...state, news: state.news.filter((n) => n.id !== id) };
  saveSchoolComms(next);
  return { ok: true, state: next };
}

export function deleteAlbum(
  id: string,
): { ok: true; state: SchoolCommsState } | { ok: false; error: string } {
  if (!canEditComms("gallery")) return { ok: false, error: "No permission" };
  const state = loadSchoolComms();
  if (!state.albums.some((a) => a.id === id)) {
    return { ok: false, error: "Not found" };
  }
  const next = {
    ...state,
    albums: state.albums.filter((a) => a.id !== id),
    photos: state.photos.filter((p) => p.albumId !== id),
  };
  saveSchoolComms(next);
  return { ok: true, state: next };
}

export function deleteGalleryPhoto(
  id: string,
): { ok: true; state: SchoolCommsState } | { ok: false; error: string } {
  if (!canEditComms("gallery")) return { ok: false, error: "No permission" };
  const state = loadSchoolComms();
  const photo = state.photos.find((p) => p.id === id);
  if (!photo) return { ok: false, error: "Not found" };
  const photos = state.photos.filter((p) => p.id !== id);
  let albums = state.albums;
  const alb = albums.find((a) => a.id === photo.albumId);
  if (alb?.coverUrl === photo.url) {
    const nextCover =
      photos.find((p) => p.albumId === photo.albumId)?.url || "";
    albums = albums.map((a) =>
      a.id === photo.albumId
        ? { ...a, coverUrl: nextCover, updatedAt: nowIso() }
        : a,
    );
  }
  const next = { ...state, albums, photos };
  saveSchoolComms(next);
  return { ok: true, state: next };
}
