"use client";

import { useEffect, useRef, useState } from "react";
import { usePathname } from "next/navigation";
import { RefreshCw } from "lucide-react";
import { isEditableElement, shouldReloadForUpdate } from "@/lib/updateReload";
import { failingDeskSyncs } from "@/lib/deskSyncStatus";
import { noteLoadedBuild } from "@/lib/clientBuild";

/** Least time between two checks, however often the phone is reopened. */
const MIN_GAP_MS = 60_000;
/** While the ERP stays open on screen. */
const POLL_MS = 15 * 60_000;

/**
 * "A new version of the ERP is ready — tap to refresh".
 *
 * WHY (director, 30 Sep 2026): staff keep the ERP open on their phones for
 * days, so after a deploy they go on using the old screens — and after the
 * teacher-scope fixes the old screens call routes that now refuse them.
 * Nobody should have to be told on WhatsApp to "close and reopen".
 *
 * The first build id this page hears from /api/app-version is the one it
 * was loaded with; a different one later means it is out of date. Checked
 * when the phone comes back to the page (at most once a minute) and every
 * 15 minutes while it is on screen — never in the background. A code chunk
 * that fails to load (the old build's files are gone after a deploy) shows
 * the bar straight away. Unknown is not "new": a failed check shows nothing.
 *
 * Once stale, the tab also reloads itself on the next client-side
 * navigation (data-layer 0.5g) — never mid-form and never with a save
 * outstanding; the rule is lib/updateReload.ts.
 */
export function UpdateBar() {
  const [stale, setStale] = useState(false);
  const loaded = useRef<string | null>(null);
  const lastCheck = useRef(0);
  const pathname = usePathname();
  const previousPath = useRef<string | null>(null);
  /** Save keys (lib/syncRetryStatus) not back to idle yet. */
  const unsaved = useRef(new Set<string>());

  useEffect(() => {
    function onSyncStatus(e: Event) {
      const d = (e as CustomEvent<{ key?: string; state?: { status?: string } }>).detail;
      if (!d?.key) return;
      if (d.state?.status && d.state.status !== "idle") unsaved.current.add(d.key);
      else unsaved.current.delete(d.key);
    }
    window.addEventListener("bhb:sync-status", onSyncStatus);
    return () => window.removeEventListener("bhb:sync-status", onSyncStatus);
  }, []);

  useEffect(() => {
    const prev = previousPath.current;
    previousPath.current = pathname;
    if (
      shouldReloadForUpdate({
        stale,
        previousPath: prev,
        path: pathname,
        editing: isEditableElement(document.activeElement as HTMLInputElement | null),
        savesPending: unsaved.current.size > 0 || failingDeskSyncs().length > 0,
      })
    ) {
      window.location.reload();
    }
    // Runs on navigation only: a build turning stale mid-page waits for the next one.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [pathname]);

  useEffect(() => {
    let alive = true;

    async function check() {
      const now = Date.now();
      if (now - lastCheck.current < MIN_GAP_MS) return;
      lastCheck.current = now;
      try {
        const res = await fetch("/api/app-version", { cache: "no-store" });
        if (!res.ok) return;
        const { build } = (await res.json()) as { build?: string };
        if (!build || build === "unknown") return;
        // The page's first answer is also the build every ERP request and
        // client metric reports (lib/clientBuild; later answers are ignored
        // there). Recorded before the `alive` check: a remount (React's dev
        // double effect) must not leave the page without a build.
        noteLoadedBuild(build);
        if (!alive) return;
        if (loaded.current === null) loaded.current = build;
        else if (build !== loaded.current) setStale(true);
      } catch {
        /* offline — ask again later */
      }
    }

    function onVisible() {
      if (document.visibilityState === "visible") void check();
    }
    function onChunkError(e: ErrorEvent | PromiseRejectionEvent) {
      const err = "reason" in e ? e.reason : e.error;
      const text = `${(err as Error)?.name || ""} ${(err as Error)?.message || ""}`;
      if (/ChunkLoadError|Loading chunk|Failed to fetch dynamically imported module/i.test(text)) {
        setStale(true);
      }
    }

    void check();
    const timer = window.setInterval(() => {
      if (document.visibilityState === "visible") void check();
    }, POLL_MS);
    document.addEventListener("visibilitychange", onVisible);
    window.addEventListener("focus", onVisible);
    window.addEventListener("error", onChunkError);
    window.addEventListener("unhandledrejection", onChunkError);
    return () => {
      alive = false;
      window.clearInterval(timer);
      document.removeEventListener("visibilitychange", onVisible);
      window.removeEventListener("focus", onVisible);
      window.removeEventListener("error", onChunkError);
      window.removeEventListener("unhandledrejection", onChunkError);
    };
  }, []);

  if (!stale) return null;
  return (
    <div
      role="status"
      className="fixed inset-x-3 top-3 z-[100] mx-auto flex max-w-md items-center gap-3 rounded-2xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 shadow-lg"
    >
      <RefreshCw className="size-5 shrink-0 text-[var(--primary)]" aria-hidden />
      <p className="min-w-0 flex-1 text-sm text-[var(--brand-deep)]">
        <span className="block font-semibold">नया संस्करण तैयार है</span>
        <span className="block text-xs text-[var(--muted)]">A new version of the ERP is ready.</span>
      </p>
      <button
        type="button"
        onClick={() => window.location.reload()}
        className="min-h-10 shrink-0 rounded-xl bg-[var(--primary)] px-4 text-sm font-bold text-[var(--primary-foreground)]"
      >
        Refresh
      </button>
    </div>
  );
}
