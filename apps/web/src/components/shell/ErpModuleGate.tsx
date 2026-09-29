"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useDemoSession } from "@/components/shell/SessionContext";
import { loadMasters } from "@/lib/masters";
import { canAccessHref, loadRbac } from "@/lib/rbac";

/**
 * Client-side ERP module gate (RBAC is localStorage-backed).
 * Allows /home always when the user can view home; otherwise redirects messaging.
 * Includes query (e.g. /students?tab=udise → compliance).
 */
export function ErpModuleGate({ children }: { children: React.ReactNode }) {
  const session = useDemoSession();
  const pathname = usePathname() || "/home";
  const searchParams = useSearchParams();
  const [allowed, setAllowed] = useState(true);
  const [ready, setReady] = useState(false);

  const href =
    searchParams?.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname;

  useEffect(() => {
    let active = true;
    void (async () => {
      try {
        const [{ ensureRbacHydrated }, { withHydrationSlot }] =
          await Promise.all([
            import("@/lib/rbacPersistence"),
            import("@/lib/deskHydrateGuard"),
          ]);
        // Never let the gate wait on a slow desk: after 4 s decide from what
        // this browser already holds (the built-in role defaults at worst).
        await Promise.race([
          withHydrationSlot(() => ensureRbacHydrated()),
          new Promise((r) => window.setTimeout(r, 4000)),
        ]);
      } catch {
        /* ignore */
      }
      const masters = loadMasters();
      // The module permission decides, for everyone. This used to let any
      // staff session whose role code contained "staff", "teacher" or
      // "office" through to every page — a teacher could open Fees,
      // Accounts, Payroll and Masters by URL (found 2026-09-29).
      const ok =
        pathname === "/home" ||
        pathname.startsWith("/home/") ||
        canAccessHref(session, masters, href, loadRbac());
      if (active) {
        setAllowed(ok);
        setReady(true);
      }
    })();
    return () => {
      active = false;
    };
  }, [session, pathname, href]);

  if (!ready) {
    return (
      <div className="p-6 text-sm text-[var(--muted)]">Checking access…</div>
    );
  }

  if (!allowed) {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="font-brand-name text-xl text-[var(--brand-deep)]">
          Access restricted
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Your role does not include this module. Ask an admin to update Roles
          &amp; permissions, or return to Home.
        </p>
        <Link
          href="/home"
          className="mt-5 inline-flex rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)]"
        >
          Back to Home
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
