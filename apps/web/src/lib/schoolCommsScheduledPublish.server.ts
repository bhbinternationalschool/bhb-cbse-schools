/**
 * Server-side scheduled comms publish + social cross-post.
 */

import { publicPortalOrigin } from "@/lib/admissions";
import { fetchServerBlob, pushServerBlob } from "@/lib/serverBlob";
import {
  fetchSchoolCommsDeskFromDb,
  pushSchoolCommsDeskToDb,
} from "@/lib/schoolCommsNormalized.server";
import { crossPostCommsContent } from "@/lib/socialCrossPost.server";
import type {
  GalleryAlbum,
  SchoolCommsState,
  SchoolNewsItem,
  SchoolNotice,
} from "@/lib/schoolComms";
import type { SocialCrossPostKind } from "@/lib/socialCrossPost.types";

function nowIso() {
  return new Date().toISOString();
}

function portalBase(): string {
  return (
    process.env.NEXT_PUBLIC_APP_URL ||
    publicPortalOrigin() ||
    "https://bhbinternational.school"
  ).replace(/\/$/, "");
}

export async function loadSchoolCommsStateServer(): Promise<SchoolCommsState> {
  const [{ bundle }, { state: blob }] = await Promise.all([
    fetchSchoolCommsDeskFromDb(),
    fetchServerBlob<SchoolCommsState>("school_comms_state"),
  ]);

  const deskCount =
    bundle.notices.length +
    bundle.news.length +
    bundle.albums.length +
    bundle.photos.length;

  if (deskCount > 0) {
    return {
      version: 1,
      notices: bundle.notices,
      news: bundle.news,
      albums: bundle.albums,
      photos: bundle.photos,
    };
  }

  return (
    blob ?? {
      version: 1,
      notices: [],
      news: [],
      albums: [],
      photos: [],
    }
  );
}

async function persistSchoolCommsStateServer(
  state: SchoolCommsState,
): Promise<void> {
  await Promise.all([
    pushServerBlob("school_comms_state", state),
    pushSchoolCommsDeskToDb(state),
  ]);
}

function photosForAlbum(albumId: string, state: SchoolCommsState): string[] {
  return state.photos
    .filter((p) => p.albumId === albumId)
    .map((p) => p.url)
    .filter(Boolean);
}

async function crossPostPublishedItem(
  kind: SocialCrossPostKind,
  state: SchoolCommsState,
  id: string,
): Promise<void> {
  const base = portalBase();
  if (kind === "notice") {
    const n = state.notices.find((x) => x.id === id);
    if (!n || (n.audience !== "all" && n.audience !== "parents")) return;
    await crossPostCommsContent({
      kind: "notice",
      contentId: n.id,
      title: n.title,
      body: n.body,
      linkUrl: `${base}/parent?tab=notices`,
    });
    return;
  }
  if (kind === "news") {
    const n = state.news.find((x) => x.id === id);
    if (!n) return;
    await crossPostCommsContent({
      kind: "news",
      contentId: n.id,
      title: n.title,
      body: n.body,
      summary: n.summary,
      imageUrl: n.coverUrl,
      linkUrl: `${base}/parent?tab=news`,
    });
    return;
  }
  const a = state.albums.find((x) => x.id === id);
  if (!a) return;
  const urls = photosForAlbum(a.id, state);
  await crossPostCommsContent({
    kind: "gallery",
    contentId: a.id,
    title: a.title,
    body: a.description || a.title,
    summary: a.description,
    imageUrl: a.coverUrl || urls[0],
    imageUrls: urls.slice(0, 10),
    linkUrl: `${base}/parent?tab=gallery`,
  });
}

function publishNotice(state: SchoolCommsState, n: SchoolNotice): SchoolNotice {
  const now = nowIso();
  return {
    ...n,
    status: "published",
    publishedAt: n.publishedAt || now,
    scheduledPublishAt: "",
    updatedAt: now,
  };
}

function publishNews(state: SchoolCommsState, n: SchoolNewsItem): SchoolNewsItem {
  const now = nowIso();
  return {
    ...n,
    status: "published",
    publishedAt: n.publishedAt || now,
    scheduledPublishAt: "",
    updatedAt: now,
  };
}

function publishAlbum(state: SchoolCommsState, a: GalleryAlbum): GalleryAlbum {
  const now = nowIso();
  return {
    ...a,
    status: "published",
    publishedAt: a.publishedAt || now,
    scheduledPublishAt: "",
    updatedAt: now,
  };
}

export type ScheduledPublishTickResult = {
  ok: boolean;
  published: number;
  crossPosted: number;
  items: { kind: SocialCrossPostKind; id: string; title: string }[];
  error?: string;
};

export async function processScheduledCommsPublish(): Promise<ScheduledPublishTickResult> {
  const state = await loadSchoolCommsStateServer();
  const now = Date.now();
  const due: { kind: SocialCrossPostKind; id: string; title: string }[] = [];

  for (const n of state.notices) {
    if (
      n.status === "scheduled" &&
      n.scheduledPublishAt &&
      new Date(n.scheduledPublishAt).getTime() <= now
    ) {
      due.push({ kind: "notice", id: n.id, title: n.title });
    }
  }
  for (const n of state.news) {
    if (
      n.status === "scheduled" &&
      n.scheduledPublishAt &&
      new Date(n.scheduledPublishAt).getTime() <= now
    ) {
      due.push({ kind: "news", id: n.id, title: n.title });
    }
  }
  for (const a of state.albums) {
    if (
      a.status === "scheduled" &&
      a.scheduledPublishAt &&
      new Date(a.scheduledPublishAt).getTime() <= now
    ) {
      due.push({ kind: "gallery", id: a.id, title: a.title });
    }
  }

  if (!due.length) {
    return { ok: true, published: 0, crossPosted: 0, items: [] };
  }

  let next: SchoolCommsState = { ...state };
  for (const item of due) {
    if (item.kind === "notice") {
      next = {
        ...next,
        notices: next.notices.map((n) =>
          n.id === item.id ? publishNotice(next, n) : n,
        ),
      };
    } else if (item.kind === "news") {
      next = {
        ...next,
        news: next.news.map((n) =>
          n.id === item.id ? publishNews(next, n) : n,
        ),
      };
    } else {
      next = {
        ...next,
        albums: next.albums.map((a) =>
          a.id === item.id ? publishAlbum(next, a) : a,
        ),
      };
    }
  }

  try {
    await persistSchoolCommsStateServer(next);
  } catch (e) {
    return {
      ok: false,
      published: 0,
      crossPosted: 0,
      items: due,
      error: e instanceof Error ? e.message : "Failed to persist published state",
    };
  }

  let crossPosted = 0;
  for (const item of due) {
    try {
      const r = await crossPostPublishedItem(item.kind, next, item.id);
      void r;
      crossPosted += 1;
    } catch {
      /* cross-post errors logged per platform in cross_post table */
    }
  }

  return {
    ok: true,
    published: due.length,
    crossPosted,
    items: due,
  };
}
