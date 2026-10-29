"use client";

import Link from "next/link";
import { useEffect, useMemo, useState } from "react";
import { Megaphone } from "lucide-react";
import {
  listNews,
  listNotices,
  loadSchoolComms,
  type SchoolNewsItem,
  type SchoolNotice,
} from "@/lib/schoolComms";

export type CommsStripAudience = "staff" | "parents";

export type StripItem = {
  id: string;
  kind: "notice" | "news";
  label: string;
  title: string;
  pinned?: boolean;
  href: string;
};

function buildItems(audience: CommsStripAudience): StripItem[] {
  const state = loadSchoolComms();
  const notices = listNotices(state, {
    publishedOnly: true,
    audience: audience === "parents" ? "parents" : "staff",
  }).filter((n: SchoolNotice) => {
    // staff strip also shows "all"; listNotices already keeps all + matching
    return true;
  });
  const news = listNews(state, { publishedOnly: true });

  const noticeItems: StripItem[] = notices.slice(0, 8).map((n) => ({
    id: n.id,
    kind: "notice" as const,
    label: n.pinned ? "Pinned" : "Notice",
    title: n.title,
    pinned: n.pinned,
    href:
      audience === "parents"
        ? "/parent"
        : `/comms?tab=notices&notice=${encodeURIComponent(n.id)}`,
  }));

  const newsItems: StripItem[] = news.slice(0, 5).map((n: SchoolNewsItem) => ({
    id: n.id,
    kind: "news" as const,
    label: "News",
    title: n.title,
    href: audience === "parents" ? "/parent" : "/comms?tab=news",
  }));

  // Pinned notices first, then other notices, then news
  return [...noticeItems, ...newsItems];
}

export function CommsRunningStrip({
  audience = "staff",
  compact = false,
  onParentNavigate,
  items: given,
}: {
  audience?: CommsStripAudience;
  /** Tighter strip for parent sticky header */
  compact?: boolean;
  /** Parent portal: switch tab instead of /parent navigation */
  onParentNavigate?: (tab: "notices" | "news") => void;
  /**
   * Items read elsewhere (the parent portal reads them from the server, see
   * ParentRunningStrip). Given, this component reads no desk of its own.
   */
  items?: StripItem[];
}) {
  const [ready, setReady] = useState(false);
  const [tick, setTick] = useState(0);
  const [paused, setPaused] = useState(false);

  useEffect(() => {
    if (given) return;
    let cancelled = false;
    void (async () => {
      const [{ ensureSchoolCommsHydrated }, { withHydrationSlot }] =
        await Promise.all([
          import("@/lib/schoolCommsPersistence"),
          import("@/lib/deskHydrateGuard"),
        ]);
      await withHydrationSlot(() => ensureSchoolCommsHydrated());
      if (cancelled) return;
      setReady(true);
      setTick((n) => n + 1);
    })();
    function refresh() {
      setTick((n) => n + 1);
    }
    window.addEventListener("bhb-school-comms", refresh);
    window.addEventListener("storage", refresh);
    return () => {
      cancelled = true;
      window.removeEventListener("bhb-school-comms", refresh);
      window.removeEventListener("storage", refresh);
    };
  }, [given]);

  const built = useMemo(
    () => (ready && !given ? buildItems(audience) : []),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- tick forces reload
    [ready, audience, tick, given],
  );
  const items = given ?? built;

  // Until this tab's notices are read, the bar holds its place (data-layer
  // 2.3a follow-up, 29 Oct 2026). The strip sits in the sticky header ABOVE
  // every screen, and since the shell stopped waiting for the old core
  // hydrate (2.3a) a screen is shown before the comms desk has landed —
  // which waits its turn in the hydration queue behind the boot hydrates.
  // Inserted late, the strip pushed the whole screen down ~40 px under the
  // pointer: a tap pressed on a tab and released on the card above it (the
  // tab moved between press and release) did nothing — on CI a step tab on
  // Masters, the Subject rules tab, a picker; on a slow phone, a staff
  // member's first tap. An empty bar of the same height is drawn instead, so
  // the notices fill in without moving anything. A school with no notices
  // still loses the bar once that is known (never while it is unknown).
  if (!given && !ready) return <StripBar compact={compact} pending />;
  if (items.length === 0) return null;

  // Duplicate for seamless loop
  const loop = items.length === 1 ? [...items, ...items, ...items] : [...items, ...items];
  const durationSec = Math.max(28, loop.length * 7);

  function openItem(item: StripItem) {
    if (onParentNavigate) {
      onParentNavigate(item.kind === "news" ? "news" : "notices");
      try {
        sessionStorage.setItem(
          "bhb_parent_portal_tab",
          item.kind === "news" ? "news" : "notices",
        );
      } catch {
        /* ignore */
      }
      return;
    }
  }

  return (
    <StripBar compact={compact} onPause={setPaused}>
          <div
            className={`comms-strip-track ${paused ? "is-paused" : ""}`}
            style={{ animationDuration: `${durationSec}s` }}
          >
            {loop.map((item, i) => {
              const inner = (
                <>
                  <span
                    className={`rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide ${
                      item.kind === "news"
                        ? "bg-[rgba(15,118,110,0.35)] text-[#99f6e4]"
                        : item.pinned
                          ? "bg-[rgba(197,160,40,0.35)] text-[var(--brand-gold-soft)]"
                          : "bg-[rgba(255,255,255,0.12)] text-white/80"
                    }`}
                  >
                    {item.label}
                  </span>
                  <span
                    className={`font-medium text-white ${
                      compact ? "text-[12px]" : "text-[13px]"
                    }`}
                  >
                    {item.title}
                  </span>
                </>
              );

              if (onParentNavigate) {
                return (
                  <button
                    key={`${item.id}-${i}`}
                    type="button"
                    className="comms-strip-item inline-flex items-center gap-2 whitespace-nowrap px-4 text-left"
                    onClick={() => openItem(item)}
                  >
                    {inner}
                    <span className="comms-strip-dot" aria-hidden />
                  </button>
                );
              }

              return (
                <Link
                  key={`${item.id}-${i}`}
                  href={item.href}
                  className="comms-strip-item inline-flex items-center gap-2 whitespace-nowrap px-4"
                >
                  {inner}
                  <span className="comms-strip-dot" aria-hidden />
                </Link>
              );
            })}
          </div>
    </StripBar>
  );
}

/**
 * The strip's bar: the badge and the track's mask. `pending` draws it empty
 * (hidden from assistive tech: there is nothing to announce yet) at exactly
 * the height it has with notices in it — the same paddings, badge and line.
 */
function StripBar({
  compact,
  pending = false,
  onPause,
  children,
}: {
  compact: boolean;
  pending?: boolean;
  onPause?: (paused: boolean) => void;
  children?: React.ReactNode;
}) {
  return (
    <div
      className={`comms-strip relative overflow-hidden border-b border-[rgba(197,160,40,0.35)] ${
        compact ? "py-1.5" : "py-2"
      }`}
      {...(pending
        ? { "aria-hidden": true, "data-testid": "comms-strip-pending" }
        : { role: "region", "aria-label": "School announcements" })}
      onMouseEnter={onPause ? () => onPause(true) : undefined}
      onMouseLeave={onPause ? () => onPause(false) : undefined}
    >
      <div className="comms-strip-sheen pointer-events-none absolute inset-0" aria-hidden />
      <div className="relative flex items-center gap-2">
        <div
          className={`comms-strip-badge z-10 flex shrink-0 items-center gap-1.5 pl-3 sm:pl-4 ${
            compact ? "text-[10px]" : "text-[11px]"
          }`}
        >
          <span className="flex h-6 w-6 items-center justify-center rounded-md bg-[rgba(197,160,40,0.25)] text-[var(--brand-gold-soft)] shadow-[inset_0_0_0_1px_rgba(197,160,40,0.35)]">
            <Megaphone className="h-3.5 w-3.5" strokeWidth={2.4} />
          </span>
          <span className="hidden font-bold uppercase tracking-[0.14em] text-[var(--brand-gold-soft)] sm:inline">
            Live
          </span>
        </div>

        <div className="comms-strip-mask min-w-0 flex-1 overflow-hidden">
          {children ?? (
            // One item's line — the same boxes as a notice, with nothing in them.
            <div className="comms-strip-track">
              <span className="comms-strip-item inline-flex items-center gap-2 whitespace-nowrap px-4">
                <span className="rounded px-1.5 py-0.5 text-[9px] font-extrabold uppercase tracking-wide">&nbsp;</span>
                <span className={`font-medium ${compact ? "text-[12px]" : "text-[13px]"}`}>&nbsp;</span>
              </span>
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
