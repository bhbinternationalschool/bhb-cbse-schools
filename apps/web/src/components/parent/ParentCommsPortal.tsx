"use client";

import { useEffect, useMemo, useState } from "react";
import { Images, Megaphone, Newspaper } from "lucide-react";
import {
  audienceLabel,
  listAlbums,
  listNews,
  listNotices,
  loadSchoolComms,
  photosForAlbum,
  type GalleryAlbum,
  type SchoolCommsState,
  type SchoolNewsItem,
  type SchoolNotice,
} from "@/lib/schoolComms";

type View = "notices" | "news" | "gallery";

export function ParentCommsPortal({
  view,
  guardianDisplayName,
}: {
  view: View;
  guardianDisplayName: string;
}) {
  const [comms, setComms] = useState<SchoolCommsState | null>(null);
  const [albumId, setAlbumId] = useState<string | null>(null);

  useEffect(() => {
    let cancelled = false;
    void (async () => {
      const { ensureSchoolCommsHydrated } = await import(
        "@/lib/schoolCommsPersistence"
      );
      await ensureSchoolCommsHydrated();
      if (cancelled) return;
      setComms(loadSchoolComms());
    })();
    return () => {
      cancelled = true;
    };
  }, [guardianDisplayName]);

  const notices = useMemo(
    () =>
      comms
        ? listNotices(comms, { publishedOnly: true, audience: "parents" })
        : [],
    [comms],
  );
  const news = useMemo(
    () => (comms ? listNews(comms, { publishedOnly: true }) : []),
    [comms],
  );
  const albums = useMemo(
    () => (comms ? listAlbums(comms, { publishedOnly: true }) : []),
    [comms],
  );
  const photos = useMemo(
    () => (albumId && comms ? photosForAlbum(albumId, comms) : []),
    [albumId, comms],
  );

  if (!comms) {
    return (
      <p className="px-4 py-8 text-center text-sm text-[var(--muted)]">
        Loading…
      </p>
    );
  }

  if (view === "notices") {
    return (
      <div className="space-y-3 px-4 py-4">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
          <Megaphone className="h-3.5 w-3.5" /> Circulars
        </p>
        {notices.length === 0 ? (
          <Empty label="No notices published yet." />
        ) : (
          notices.map((n: SchoolNotice) => (
            <article
              key={n.id}
              className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-white p-3"
            >
              <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                {n.pinned ? "📌 " : ""}
                {n.title}
              </h3>
              <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                {audienceLabel(n.audience)}
                {n.publishedAt
                  ? ` · ${new Date(n.publishedAt).toLocaleDateString()}`
                  : ""}
              </p>
              <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--brand-deep)]">
                {n.body}
              </p>
            </article>
          ))
        )}
      </div>
    );
  }

  if (view === "news") {
    return (
      <div className="space-y-3 px-4 py-4">
        <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
          <Newspaper className="h-3.5 w-3.5" /> School news
        </p>
        {news.length === 0 ? (
          <Empty label="No news stories yet." />
        ) : (
          news.map((n: SchoolNewsItem) => (
            <article
              key={n.id}
              className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.1)] bg-white"
            >
              {n.coverUrl ? (
                // eslint-disable-next-line @next/next/no-img-element
                <img src={n.coverUrl} alt="" className="h-40 w-full object-cover" />
              ) : null}
              <div className="p-3">
                <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                  {n.title}
                </h3>
                {n.summary ? (
                  <p className="mt-1 text-xs text-[var(--muted)]">{n.summary}</p>
                ) : null}
                <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--brand-deep)]">
                  {n.body}
                </p>
              </div>
            </article>
          ))
        )}
      </div>
    );
  }

  return (
    <div className="space-y-3 px-4 py-4">
      <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
        <Images className="h-3.5 w-3.5" /> Gallery
      </p>
      {!albumId ? (
        albums.length === 0 ? (
          <Empty label="No albums published yet." />
        ) : (
          <div className="grid grid-cols-2 gap-2">
            {albums.map((a: GalleryAlbum) => (
              <button
                key={a.id}
                type="button"
                onClick={() => setAlbumId(a.id)}
                className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.1)] bg-white text-left"
              >
                <div className="flex h-24 items-center justify-center bg-[rgba(32,48,80,0.06)]">
                  {a.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img src={a.coverUrl} alt="" className="h-full w-full object-cover" />
                  ) : (
                    <Images className="h-6 w-6 text-[var(--muted)]" />
                  )}
                </div>
                <p className="truncate px-2 py-1.5 text-xs font-semibold text-[var(--brand-deep)]">
                  {a.title}
                </p>
              </button>
            ))}
          </div>
        )
      ) : (
        <>
          <button
            type="button"
            className="text-xs font-semibold text-[var(--brand-deep)]"
            onClick={() => setAlbumId(null)}
          >
            ← All albums
          </button>
          {photos.length === 0 ? (
            <Empty label="This album has no photos yet." />
          ) : (
            <div className="grid grid-cols-2 gap-2">
              {photos.map((p) => (
                <figure
                  key={p.id}
                  className="overflow-hidden rounded-lg bg-[rgba(32,48,80,0.05)]"
                >
                  {/* eslint-disable-next-line @next/next/no-img-element */}
                  <img src={p.url} alt={p.caption} className="aspect-square w-full object-cover" />
                </figure>
              ))}
            </div>
          )}
        </>
      )}
    </div>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <p className="rounded-xl border border-dashed border-[rgba(32,48,80,0.15)] px-3 py-8 text-center text-sm text-[var(--muted)]">
      {label}
    </p>
  );
}
