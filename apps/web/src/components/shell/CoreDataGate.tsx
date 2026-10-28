"use client";

import { useCallback, useEffect, useState } from "react";
import { hasDeskLoaded } from "@/lib/deskHydrateGuard";
import { isSupabaseConfigured } from "@/lib/supabase/client";

/**
 * Screens wait for the school's core data (12 Oct 2026).
 *
 * Since desks moved to page memory (10 Oct), Masters — classes, sections,
 * subjects, class-subject links — and the staff list load from the server
 * after the page opens. 63 screens read Masters once when they mount; one
 * that mounted first showed no classes, subjects or teachers and stayed that
 * way (Staff → Allocate teaching / Who teaches what, 12 Oct). Before 10 Oct
 * Masters was always already in the browser, so they never had to wait.
 *
 * This restores that guarantee in one place: the workspace renders once
 * Masters has loaded on this page (normally about a second). Staff records
 * are waited for at most 5 s — some logins cannot read the full roster and
 * must never be locked out. If Masters cannot be loaded, the person gets a
 * retry button instead of half-empty screens.
 */
export function CoreDataGate({ bootReady, children }: { bootReady: boolean; children: React.ReactNode }) {
  const [ready, setReady] = useState(() => !isSupabaseConfigured() || hasDeskLoaded("masters"));
  const [failed, setFailed] = useState(false);

  const load = useCallback(async () => {
    setFailed(false);
    // The route's core tier usually loads Masters first; give it a moment
    // before asking directly (both share one fetch either way).
    for (let i = 0; i < 24 && !hasDeskLoaded("masters"); i++) {
      await new Promise((r) => setTimeout(r, 250));
    }
    if (!hasDeskLoaded("masters")) {
      try {
        const { ensureMastersHydrated } = await import("@/lib/mastersPersistence");
        await ensureMastersHydrated();
      } catch {
        /* reported below */
      }
    }
    if (!hasDeskLoaded("masters")) {
      setFailed(true);
      return;
    }
    if (!hasDeskLoaded("staff")) {
      try {
        const { ensureStaffHydrated } = await import("@/lib/staffPersistence");
        await Promise.race([ensureStaffHydrated().catch(() => false), new Promise((r) => setTimeout(r, 5000))]);
      } catch {
        /* the staff list is best-effort here */
      }
    }
    setReady(true);
    window.dispatchEvent(new CustomEvent("bhb-masters-updated"));
  }, []);

  useEffect(() => {
    if (!ready && bootReady) void load();
  }, [ready, bootReady, load]);

  if (ready) return <>{children}</>;
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-[var(--muted)]" role="status">
      {failed ? (
        <>
          <p className="font-medium text-[var(--danger)]">Could not load the school&apos;s classes, subjects and staff from the server.</p>
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-4 py-2 font-semibold text-[var(--brand-deep)]"
            onClick={() => void load()}
          >
            Try again
          </button>
        </>
      ) : (
        <>
          <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--brand)]" aria-hidden />
          <p>Loading school data…</p>
        </>
      )}
    </div>
  );
}
