"use client";

import { Megaphone, Newspaper } from "lucide-react";
import { ParentReadState, useParentRead } from "@/components/parent/parentData";

/** GET /api/v1/comms/feed — published notices for parents, and school news. */
export type CommsFeed = {
  notices: {
    id: string;
    title: string;
    body: string;
    pinned: boolean;
    publishedAt: string;
  }[];
  news: {
    id: string;
    title: string;
    summary: string;
    body: string;
    coverUrl: string | null;
    publishedAt: string;
  }[];
};

export const COMMS_FEED_KEY = ["comms-feed"] as const;

/** The feed the notices tab, the running strip and the bell share (one request). */
export function useCommsFeed() {
  return useParentRead<CommsFeed>(
    COMMS_FEED_KEY,
    "/api/v1/comms/feed",
    (v) => Array.isArray(v.notices) && Array.isArray(v.news),
    "Notices",
  );
}

/**
 * Notices and school news as the parent app shows them — read on the server
 * for the signed-in parent (GET /api/v1/comms/feed: published notices
 * addressed to parents or everyone, never staff-only ones). The old tab read
 * the office's comms desk, which refuses a parent, and fell back to the
 * browser's built-in SAMPLE notices — so real parents were shown "Annual Sports
 * Day & Cultural Meet 2026" as if the school had posted it. Nothing here has a
 * sample or demo fallback: a failed read says "Could not load".
 */
export function ParentNoticesNews({ view }: { view: "notices" | "news" }) {
  return <Feed view={view} />;
}

function Feed({ view }: { view: "notices" | "news" }) {
  const feed = useCommsFeed();
  return (
    <ParentReadState
      query={feed}
      what={view === "notices" ? "notices" : "school news"}
    >
      {(f) =>
        view === "notices" ? (
          <div className="space-y-3 px-4 py-4" data-testid="parent-notices">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              <Megaphone className="h-3.5 w-3.5" /> Circulars
            </p>
            {f.notices.length === 0 ? (
              <Empty label="No notices published yet." />
            ) : (
              f.notices.map((n) => (
                <article
                  key={n.id}
                  data-notice-id={n.id}
                  className="rounded-xl border border-[rgba(32,48,80,0.1)] bg-[var(--card)] p-3"
                >
                  <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                    {n.pinned ? "📌 " : ""}
                    {n.title}
                  </h3>
                  <p className="mt-0.5 text-[10px] text-[var(--muted)]">
                    {n.publishedAt
                      ? new Date(n.publishedAt).toLocaleDateString("en-IN")
                      : ""}
                  </p>
                  <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--brand-deep)]">
                    {n.body}
                  </p>
                </article>
              ))
            )}
          </div>
        ) : (
          <div className="space-y-3 px-4 py-4" data-testid="parent-news">
            <p className="flex items-center gap-2 text-xs font-bold uppercase tracking-wide text-[var(--muted)]">
              <Newspaper className="h-3.5 w-3.5" /> School news
            </p>
            {f.news.length === 0 ? (
              <Empty label="No news stories yet." />
            ) : (
              f.news.map((n) => (
                <article
                  key={n.id}
                  data-news-id={n.id}
                  className="overflow-hidden rounded-xl border border-[rgba(32,48,80,0.1)] bg-[var(--card)]"
                >
                  {n.coverUrl ? (
                    // eslint-disable-next-line @next/next/no-img-element
                    <img
                      src={n.coverUrl}
                      alt=""
                      className="h-40 w-full object-cover"
                    />
                  ) : null}
                  <div className="p-3">
                    <h3 className="text-sm font-semibold text-[var(--brand-deep)]">
                      {n.title}
                    </h3>
                    {n.summary ? (
                      <p className="mt-1 text-xs text-[var(--muted)]">
                        {n.summary}
                      </p>
                    ) : null}
                    <p className="mt-2 whitespace-pre-wrap text-sm text-[var(--brand-deep)]">
                      {n.body}
                    </p>
                  </div>
                </article>
              ))
            )}
          </div>
        )
      }
    </ParentReadState>
  );
}

function Empty({ label }: { label: string }) {
  return (
    <p className="rounded-xl border border-dashed border-[rgba(32,48,80,0.15)] px-3 py-8 text-center text-sm text-[var(--muted)]">
      {label}
    </p>
  );
}
