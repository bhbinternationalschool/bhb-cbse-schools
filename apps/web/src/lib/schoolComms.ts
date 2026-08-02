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
export type NoticeStatus = "draft" | "published" | "archived";

export type SchoolNotice = {
  id: string;
  title: string;
  body: string;
  audience: CommsAudience;
  status: NoticeStatus;
  pinned: boolean;
  academicYearCode: string;
  publishedAt: string;
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

export function emptySchoolComms(): SchoolCommsState {
  return { version: 1, notices: [], news: [], albums: [], photos: [] };
}

function normalize(raw: Partial<SchoolCommsState> | null): SchoolCommsState {
  const base = emptySchoolComms();
  if (!raw) return base;
  return {
    version: 1,
    notices: Array.isArray(raw.notices) ? (raw.notices as SchoolNotice[]) : [],
    news: Array.isArray(raw.news) ? (raw.news as SchoolNewsItem[]) : [],
    albums: Array.isArray(raw.albums) ? (raw.albums as GalleryAlbum[]) : [],
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
  const publish = input.publish === true || input.status === "published";
  let notice: SchoolNotice;
  if (input.id) {
    const i = state.notices.findIndex((n) => n.id === input.id);
    if (i < 0) return { ok: false, error: "Notice not found" };
    const prev = state.notices[i]!;
    notice = {
      ...prev,
      title,
      body,
      audience: input.audience,
      pinned: input.pinned ?? prev.pinned,
      status: publish ? "published" : (input.status ?? prev.status),
      publishedAt: publish
        ? prev.publishedAt || now
        : prev.publishedAt,
      updatedAt: now,
    };
    const notices = [...state.notices];
    notices[i] = notice;
    const next = { ...state, notices };
    saveSchoolComms(next);
    if (publish && prev.status !== "published") {
      void pushNoticeNotifications(notice);
    }
    return { ok: true, notice, state: next };
  }

  notice = {
    id: nid("ntc"),
    title,
    body,
    audience: input.audience,
    status: publish ? "published" : "draft",
    pinned: !!input.pinned,
    academicYearCode: input.academicYearCode || DEFAULT_AY,
    publishedAt: publish ? now : "",
    createdAt: now,
    createdBy: input.createdBy || "office",
    updatedAt: now,
  };
  const next = { ...state, notices: [notice, ...state.notices] };
  saveSchoolComms(next);
  if (publish) void pushNoticeNotifications(notice);
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
  const publish = input.publish === true || input.status === "published";
  let item: SchoolNewsItem;
  if (input.id) {
    const i = state.news.findIndex((n) => n.id === input.id);
    if (i < 0) return { ok: false, error: "News not found" };
    const prev = state.news[i]!;
    item = {
      ...prev,
      title,
      summary: (input.summary ?? prev.summary).trim(),
      body,
      coverUrl: input.coverUrl ?? prev.coverUrl,
      status: publish ? "published" : (input.status ?? prev.status),
      publishedAt: publish ? prev.publishedAt || now : prev.publishedAt,
      updatedAt: now,
    };
    const news = [...state.news];
    news[i] = item;
    const next = { ...state, news };
    saveSchoolComms(next);
    if (publish && prev.status !== "published") {
      void pushNewsNotifications(item);
    }
    return { ok: true, item, state: next };
  }

  item = {
    id: nid("nws"),
    title,
    summary: (input.summary || "").trim() || body.slice(0, 120),
    body,
    coverUrl: input.coverUrl || "",
    status: publish ? "published" : "draft",
    academicYearCode: input.academicYearCode || DEFAULT_AY,
    publishedAt: publish ? now : "",
    createdAt: now,
    createdBy: input.createdBy || "office",
    updatedAt: now,
  };
  const next = { ...state, news: [item, ...state.news] };
  saveSchoolComms(next);
  if (publish) void pushNewsNotifications(item);
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
  const publish = input.publish === true || input.status === "published";
  let album: GalleryAlbum;
  if (input.id) {
    const i = state.albums.findIndex((a) => a.id === input.id);
    if (i < 0) return { ok: false, error: "Album not found" };
    const prev = state.albums[i]!;
    album = {
      ...prev,
      title,
      description: (input.description ?? prev.description).trim(),
      coverUrl: input.coverUrl ?? prev.coverUrl,
      status: publish ? "published" : (input.status ?? prev.status),
      publishedAt: publish ? prev.publishedAt || now : prev.publishedAt,
      updatedAt: now,
    };
    const albums = [...state.albums];
    albums[i] = album;
    const next = { ...state, albums };
    saveSchoolComms(next);
    return { ok: true, album, state: next };
  }

  album = {
    id: nid("alb"),
    title,
    description: (input.description || "").trim(),
    coverUrl: input.coverUrl || "",
    status: publish ? "published" : "draft",
    academicYearCode: input.academicYearCode || DEFAULT_AY,
    publishedAt: publish ? now : "",
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

export function seedSchoolCommsDemo(by = "Office"): SchoolCommsState {
  let state = loadSchoolComms();
  if (!schoolCommsIsEmpty(state)) return state;
  const now = nowIso();
  const notice: SchoolNotice = {
    id: nid("ntc"),
    title: `Welcome to ${TENANT.nameDisplay}`,
    body: "Circulars and school notices will appear here for staff and parents.",
    audience: "all",
    status: "published",
    pinned: true,
    academicYearCode: DEFAULT_AY,
    publishedAt: now,
    createdAt: now,
    createdBy: by,
    updatedAt: now,
  };
  const news: SchoolNewsItem = {
    id: nid("nws"),
    title: "School year highlights",
    summary: "Stay tuned for events, achievements and campus updates.",
    body: "This is your school news feed. Office can publish stories with optional cover images.",
    coverUrl: "",
    status: "published",
    academicYearCode: DEFAULT_AY,
    publishedAt: now,
    createdAt: now,
    createdBy: by,
    updatedAt: now,
  };
  state = {
    version: 1,
    notices: [notice],
    news: [news],
    albums: [],
    photos: [],
  };
  writeSchoolCommsLocalRaw(state);
  void import("@/lib/schoolCommsPersistence").then(({ scheduleSchoolCommsSync }) => {
    scheduleSchoolCommsSync(state);
  });
  return state;
}
