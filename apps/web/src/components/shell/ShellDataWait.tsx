"use client";

import { useEffect, useState } from "react";
import { QueryError } from "@/components/data/QueryError";
import { useMasters } from "@/lib/data/client/hooks";
import { hasDeskLoaded } from "@/lib/deskHydrateGuard";
import { isSupabaseConfigured } from "@/lib/supabase/client";

/** How long the page copies of the roles and the roster are waited for (as CoreDataGate did for staff). */
const PAGE_COPY_WAIT_MS = 5_000;

/** One wait per tab for every mount that asks (the shell mounts once per page load). */
let pageCopies: Promise<void> | null = null;

/**
 * Keep the page copies of the roles and the roster filled for the lib/
 * readers that still read them synchronously until 2.3b — the save checks
 * (lib/rbacGuard assertModulePermission: loadMasters().staff + loadRbac())
 * above all. Until 2.3a useAccessData started these two hydrates on every
 * page and the module gate waited for them; the access DECISIONS now come
 * from the views (useAccessData), but a save made before the copies landed
 * would be judged on built-in defaults. Each is waited for at most 5 s and a
 * failure does not block: nothing on screen is decided from them.
 */
function loadPageCopies(): Promise<void> {
  if (pageCopies) return pageCopies;
  pageCopies = (async () => {
    try {
      const [{ ensureRbacHydrated }, { ensureStaffHydrated }, { ensureModuleRegistryHydrated }, { withHydrationSlot }] =
        await Promise.all([
          import("@/lib/rbacPersistence"),
          import("@/lib/staffPersistence"),
          import("@/lib/moduleRegistryPersistence"),
          import("@/lib/deskHydrateGuard"),
        ]);
      const capped = (run: () => Promise<unknown>) =>
        Promise.race([
          withHydrationSlot(run).catch(() => false),
          new Promise((r) => setTimeout(r, PAGE_COPY_WAIT_MS)),
        ]);
      await Promise.all([
        hasDeskLoaded("rbac") ? null : capped(() => ensureRbacHydrated()),
        hasDeskLoaded("staff") ? null : capped(() => ensureStaffHydrated()),
        // Which modules are switched on (canAccessModuleHref reads its page
        // copy): a default-off module the school enabled must not be refused
        // before the registry is in. Until 2.3a the access copy re-decided
        // on its hydrate event.
        hasDeskLoaded("module_registry") ? null : capped(() => ensureModuleRegistryHydrated()),
      ]);
    } catch {
      /* best-effort: the views decide what is shown */
    }
  })().finally(() => {
    pageCopies = null;
  });
  return pageCopies;
}

/**
 * Screens wait for the school's Masters (data-layer 2.3a; replaces
 * CoreDataGate). The workspace renders once the masters VIEW has answered
 * (useMasters — ~1 request; its answer is laid on the tab's page copy by the
 * 2.1 bridge before the query resolves, so the ~346 synchronous loadMasters()
 * readers see the school's classes, subjects and settings), and once the
 * page copies of the roles and the roster have loaded or 5 s have passed.
 *
 * A failed masters read is never an empty school (R6): when the tab's copy
 * holds Masters anyway (the old hydrate below) the screens render and each
 * converted one shows its own "could not load" + Try again; with no Masters
 * at all the whole page is that failure. No event is raised: screens that must follow a later Masters
 * change read useMasters() (the versions poll refetches it).
 *
 * The old core masters hydrate (masters-desk, ~235 KB) still runs from the
 * route scheduler; nothing waits for it any more. It is kept because it is
 * not proven unneeded: the reports' data guard (lib/reportDataGuard) and the
 * subject-request approvals call it directly, and it merges the database desk
 * into the page copy (mergeDbDeskIntoMastersState) in ways the view's bridge
 * does not. Deleting it is 2.3b's.
 */
export function ShellDataWait({ children }: { children: React.ReactNode }) {
  const remote = isSupabaseConfigured();
  const masters = useMasters({ enabled: remote });
  const [copiesReady, setCopiesReady] = useState(
    () => !remote || (hasDeskLoaded("rbac") && hasDeskLoaded("staff") && hasDeskLoaded("module_registry")),
  );
  // The masters view failed: is the tab's copy filled anyway (the old
  // masters-desk hydrate)? Then the screens render and each says what it
  // could not load (useScreenMasters' own error) — the infirmary and the
  // gate stay usable (2.1i). Only with no Masters at all is the whole page
  // the failure.
  const failedNoAnswer = remote && masters.data === undefined && masters.isError;
  const [copyHasMasters, setCopyHasMasters] = useState<boolean | null>(null);
  useEffect(() => {
    if (!failedNoAnswer) {
      setCopyHasMasters(null);
      return;
    }
    if (hasDeskLoaded("masters")) {
      setCopyHasMasters(true);
      return;
    }
    let live = true;
    void (async () => {
      try {
        const { ensureMastersHydrated } = await import("@/lib/mastersPersistence");
        await ensureMastersHydrated();
      } catch {
        /* decided below */
      }
      if (live) setCopyHasMasters(hasDeskLoaded("masters"));
    })();
    return () => {
      live = false;
    };
  }, [failedNoAnswer]);

  useEffect(() => {
    if (copiesReady) return;
    let live = true;
    void loadPageCopies().then(() => {
      if (live) setCopiesReady(true);
    });
    return () => {
      live = false;
    };
  }, [copiesReady]);

  // Once the screens are shown they stay shown. A screen mounting its own
  // useMasters() re-asks a failed read, and React Query puts a query with no
  // answer back to "pending" while it does: without this latch the shell
  // would take the screen away again on every retry (a mount/retry loop).
  const show = !remote || (copiesReady && (masters.data !== undefined || (failedNoAnswer && copyHasMasters === true)));
  const [released, setReleased] = useState(false);
  useEffect(() => {
    if (show && !released) setReleased(true);
  }, [show, released]);

  if (show || released) return <>{children}</>;
  if (failedNoAnswer && copyHasMasters === false) {
    return <QueryError what="the school's classes, subjects and staff" error={masters.error} retry={masters.refetch} />;
  }
  return (
    <div className="flex min-h-[40vh] flex-col items-center justify-center gap-3 text-sm text-[var(--muted)]" role="status">
      <span className="h-6 w-6 animate-spin rounded-full border-2 border-[var(--border)] border-t-[var(--brand)]" aria-hidden />
      <p>Loading school data…</p>
    </div>
  );
}
