"use client";

import { useEffect, useRef } from "react";
import { reportClientMetric } from "@/lib/clientMetrics";
import { pageContentReady } from "@/lib/pageReady";
import { viewLoadMetric } from "@/lib/data/client/viewLoadMetric";

/**
 * The two client measurements wired in data-layer 1.2 (lib/clientMetrics):
 *
 * page-ready — per route, ms from the start of the navigation to the first
 *   frame in which the screen's own content is on the page (lib/pageReady).
 *   `key` says where the clock started:
 *     load   — the route the tab was opened on: from navigation start
 *              (performance time origin), so it includes HTML, JS, shell
 *              boot and the Masters gate — what a person waits for after
 *              opening a link;
 *     nav    — a same-tab link click or back/forward: from that click;
 *     commit — any other route change (router.push from code): from the
 *              moment the new route rendered; a lower bound, labelled so.
 *   Given up silently after 30 s (a screen that never renders is a
 *   different report); nothing is sent for a route left before it renders,
 *   nor for one that spent any of that time hidden (a background tab or a
 *   locked phone: the browser stops painting it, so the number would be
 *   how long nobody looked, not how long the screen took).
 *
 * desk-hydrate — per reference read, ms from the start of the route it
 *   arrived on (the same clock as that route's page-ready) to the moment its
 *   first answer was in place on this page. Since data-layer 2.3a it is sent
 *   by the query kernel (lib/data/client/viewLoadMetric): `key` is the read's
 *   name ("masters", "staff-list", "rbac", …), once per name per page. It
 *   used to ride the `bhb-desk-first-hydrated` event of the old desk
 *   hydrates (deleted in 2.3a); the desks the replica still loads (sis,
 *   fees, …) no longer report one. A read that answers after its route
 *   opened reports the time since then, so read its p95 as "how long after
 *   opening a screen", not as the fetch alone.
 */

/**
 * `load` is timed from the tab's navigation start only for the route the
 * document itself was opened on, once per tab. A shell mounted later (after
 * a sign-in that navigated in-app, or a sign-out and back) would otherwise
 * count the time spent on the login page.
 */
let tabFirstRouteSeen = false;

function documentPath(): string | null {
  try {
    const nav = performance.getEntriesByType("navigation")[0] as PerformanceNavigationTiming | undefined;
    return nav ? new URL(nav.name).pathname : null;
  } catch {
    return null;
  }
}

export function useClientMetrics(pathname: string): void {
  const intentAt = useRef<number | null>(null);

  // Where a navigation starts: a plain left click on a same-origin link, or back/forward.
  useEffect(() => {
    function onClick(e: MouseEvent) {
      try {
        if (e.button !== 0 || e.metaKey || e.ctrlKey || e.shiftKey || e.altKey) return;
        const a = (e.target as Element | null)?.closest?.("a[href]") as HTMLAnchorElement | null;
        if (!a || (a.target && a.target !== "_self")) return;
        if (new URL(a.href, window.location.href).origin !== window.location.origin) return;
        intentAt.current = performance.now();
      } catch {
        /* never */
      }
    }
    function onPop() {
      intentAt.current = performance.now();
    }
    document.addEventListener("click", onClick, true);
    window.addEventListener("popstate", onPop);
    return () => {
      document.removeEventListener("click", onClick, true);
      window.removeEventListener("popstate", onPop);
    };
  }, []);

  // page-ready
  useEffect(() => {
    const now = performance.now();
    let start: number;
    let key: "load" | "nav" | "commit";
    const firstOfTab = !tabFirstRouteSeen;
    tabFirstRouteSeen = true;
    if (firstOfTab && documentPath() === pathname) {
      start = 0;
      key = "load";
    } else if (intentAt.current !== null && now - intentAt.current < 10_000) {
      start = intentAt.current;
      key = "nav";
    } else {
      start = now;
      key = "commit";
    }
    intentAt.current = null;
    // desk-hydrate (the query kernel's first answers) uses this route's clock.
    viewLoadMetric.setRouteStart(start);

    const route = pathname;
    let frame = 0;
    let finished = false;
    let wasHidden = document.visibilityState === "hidden";
    const onVisibility = () => {
      if (document.visibilityState === "hidden") wasHidden = true;
    };
    document.addEventListener("visibilitychange", onVisibility);
    const finish = () => {
      finished = true;
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
      window.clearTimeout(giveUp);
      if (frame) cancelAnimationFrame(frame);
    };
    const check = () => {
      frame = 0;
      if (finished || !pageContentReady(document)) return;
      finish();
      // The frame after the commit is the one the person sees.
      frame = requestAnimationFrame(() => {
        if (wasHidden || document.visibilityState === "hidden") return;
        reportClientMetric({ event: "page-ready", route, key, ms: performance.now() - start });
      });
    };
    const schedule = () => {
      if (!finished && !frame) frame = requestAnimationFrame(check);
    };
    let observer: MutationObserver | null = null;
    try {
      observer = new MutationObserver(schedule);
      observer.observe(document.body, { childList: true, subtree: true });
    } catch {
      observer = null;
    }
    const giveUp = window.setTimeout(finish, 30_000);
    schedule();
    return () => {
      // Left before it rendered: nothing is reported for this route.
      finished = true;
      document.removeEventListener("visibilitychange", onVisibility);
      observer?.disconnect();
      window.clearTimeout(giveUp);
      if (frame) cancelAnimationFrame(frame);
    };
  }, [pathname]);
}
