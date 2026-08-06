"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useState } from "react";
import { useDemoSession } from "@/components/shell/SessionContext";
import { loadMasters } from "@/lib/masters";
import { canAccessHref } from "@/lib/rbac";

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
      const masters = loadMasters();
      try {
        const { ensureRbacHydrated } = await import("@/lib/rbacPersistence");
        await ensureRbacHydrated();
      } catch {
        /* ignore */
      }
      const isStaff = session.persona === "staff";
      const isOwnerOrStaffRole =
        isStaff &&
        (!session.roleCode ||
          /owner|director|principal|admin|office|staff|teacher/.test(
            session.roleCode.toLowerCase(),
          ));
      const ok =
        pathname === "/home" ||
        pathname.startsWith("/home/") ||
        isOwnerOrStaffRole ||
        canAccessHref(session, masters, href);
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
          className="mt-5 inline-flex rounded-xl bg-[var(--brand-deep)] px-4 py-2.5 text-sm font-semibold text-white"
        >
          Back to Home
        </Link>
      </div>
    );
  }

  return <>{children}</>;
}
