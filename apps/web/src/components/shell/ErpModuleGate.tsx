"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useMemo } from "react";
import { useDemoSession } from "@/components/shell/SessionContext";
import { useAccessData } from "@/components/shell/useAccessData";
import { accessVerdict } from "@/lib/accessDataStatus";
import { canAccessHref } from "@/lib/rbac";

/**
 * Client-side ERP module gate.
 * Allows /home always; otherwise the module permission decides.
 * Includes query (e.g. /students?tab=udise → compliance).
 *
 * It decides only once the roles AND the staff roster have loaded
 * (useAccessData). Until 12 Oct 2026 it waited for roles alone, at most 4 s,
 * then answered from whatever this browser held — before the roster, an
 * assigned office role read as the designation's guess.
 */
export function ErpModuleGate({ children }: { children: React.ReactNode }) {
  const session = useDemoSession();
  const pathname = usePathname() || "/home";
  const searchParams = useSearchParams();
  const access = useAccessData();

  const href =
    searchParams?.toString()
      ? `${pathname}?${searchParams.toString()}`
      : pathname;
  const isHome = pathname === "/home" || pathname.startsWith("/home/");

  const verdict = useMemo(
    () =>
      isHome
        ? "allowed"
        : accessVerdict(access.status, () =>
            // The module permission decides, for everyone. This used to let
            // any staff session whose role code contained "staff", "teacher"
            // or "office" through to every page (found 2026-09-29).
            canAccessHref(session, access.masters, href, access.rbac ?? undefined),
          ),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- access.version tracks the copies
    [isHome, access.status, access.version, session, href],
  );

  if (verdict === "loading") {
    return (
      <div className="p-6 text-sm text-[var(--muted)]">Checking access…</div>
    );
  }

  if (verdict === "failed") {
    return (
      <div className="mx-auto max-w-lg p-8">
        <h1 className="font-brand-name text-xl text-[var(--brand-deep)]">
          Couldn&apos;t check your access
        </h1>
        <p className="mt-2 text-sm text-[var(--muted)]">
          Your roles or the staff list did not load. Check the connection and
          try again.
        </p>
        <button
          type="button"
          onClick={access.retry}
          className="mt-5 inline-flex rounded-xl bg-[var(--primary)] px-4 py-2.5 text-sm font-semibold text-[var(--primary-foreground)]"
        >
          Try again
        </button>
      </div>
    );
  }

  if (verdict === "denied") {
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
