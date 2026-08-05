"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useRef, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { formatIst } from "@bhb/time";
import { SessionSelector } from "./SessionSelector";
import { UniversalSearchBar } from "./UniversalSearchBar";
import { NotificationBell } from "./NotificationBell";
import { StaffInternalChatButton } from "./StaffInternalChatButton";
import { CommsRunningStrip } from "./CommsRunningStrip";
import { ErpAiChatbot } from "./ErpAiChatbot";
import { ErpSidebar, ErpSidebarMenuButton } from "./ErpSidebar";
import { UserAccountMenu } from "./UserAccountMenu";
import { PwaInstallBanner } from "@/components/pwa/PwaInstallBanner";
import { StaffBottomNav } from "@/components/pwa/StaffBottomNav";
import { staffPwaInstallCopy } from "@/lib/pwaApps";
import { useMobileAppShell, usePwaStandalone } from "@/lib/pwaStandalone";
import { TENANT } from "@/lib/types";
import type { DemoSession } from "@/lib/auth";
import { SessionProvider } from "./SessionContext";
import { SchoolFavicon } from "./SchoolFavicon";
import {
  listSessionYearOptions,
} from "@/lib/masters";
import { alignWorkspaceSessionFromMasters } from "@/lib/workspaceSession";
import { markModuleRegistryClientReady } from "@/lib/moduleRegistry";
import { setSessionWriteLock } from "@/lib/sessionWriteGuard";
import { applyFeeDiscountSeedNow } from "@/lib/feeDiscountImportHydrate";

export function AppShell({
  session,
  children,
}: {
  session: DemoSession;
  children: React.ReactNode;
}) {
  const pathname = usePathname();
  const router = useRouter();
  const mobileApp = useMobileAppShell();
  const standalone = usePwaStandalone();
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [years, setYears] = useState<
    ReturnType<typeof listSessionYearOptions>
  >([]);
  const [clock, setClock] = useState("");
  const skipRouteHydrateRef = useRef(true);

  useEffect(() => {
    function flushDeskSync() {
      void import("@/lib/mastersNormalizedClient").then((m) =>
        m.flushMastersDeskSyncPending(),
      );
    }
    window.addEventListener("pagehide", flushDeskSync);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushDeskSync();
    });
    return () => {
      window.removeEventListener("pagehide", flushDeskSync);
    };
  }, []);

  // Hydration-safe: pull cloud mirror, then hydrate desk in background (route-priority + idle).
  useEffect(() => {
    markModuleRegistryClientReady();
    setYears(listSessionYearOptions());
    setClock(formatIst());
    const t = window.setInterval(() => setClock(formatIst()), 30_000);

    void (async () => {
      const {
        ensureClientSchoolMirrorHydrated,
        startDeskHydrationBackground,
      } = await import("@/lib/schoolDataMirrorClientHydrate");
      const { pushFullSchoolMirrorToServer } = await import(
        "@/lib/schoolDataMirror"
      );

      const mirrorChanged = await ensureClientSchoolMirrorHydrated();
      if (mirrorChanged) {
        window.dispatchEvent(new CustomEvent("bhb-desk-hydrated"));
      }
      applyFeeDiscountSeedNow();
      pushFullSchoolMirrorToServer();

      // Non-blocking — priority tier + idle batches; does not delay mirror push.
      startDeskHydrationBackground(pathname);
    })();

    return () => window.clearInterval(t);
  }, []);

  // When navigating, hydrate that module's desk slices early (guards skip already-done).
  useEffect(() => {
    if (skipRouteHydrateRef.current) {
      skipRouteHydrateRef.current = false;
      return;
    }
    void import("@/lib/schoolDataMirrorClientHydrate").then((m) =>
      m.ensureDeskHydratedPriority(pathname),
    );
  }, [pathname]);

  // Keep header session list aligned with Masters; sync cookie once after desk hydrate.
  useEffect(() => {
    setYears(listSessionYearOptions());

    function alignFromMasters() {
      void alignWorkspaceSessionFromMasters(session.academicYearCode).then(
        (changed) => {
          if (changed) router.refresh();
        },
      );
    }

    window.addEventListener("bhb-desk-hydrated", alignFromMasters);
    window.addEventListener("bhb-masters-updated", alignFromMasters);
    const t = window.setTimeout(alignFromMasters, 2000);

    return () => {
      window.clearTimeout(t);
      window.removeEventListener("bhb-desk-hydrated", alignFromMasters);
      window.removeEventListener("bhb-masters-updated", alignFromMasters);
    };
  }, [session.academicYearCode, router]);

  const ay =
    years.find((y) => y.code === session.academicYearCode) ??
    years.find((y) => y.status === "current");
  const readOnly = ay?.status === "closed";
  const staffPwa = staffPwaInstallCopy(session.roleCode);

  useEffect(() => {
    setSessionWriteLock({
      academicYearCode: session.academicYearCode,
      closed: readOnly,
    });
  }, [session.academicYearCode, readOnly]);

  useEffect(() => {
    function onReadonly(e: Event) {
      const detail = (e as CustomEvent<{ academicYearCode?: string }>).detail;
      const code = detail?.academicYearCode || session.academicYearCode;
      window.alert(
        `Session ${code} is closed (read-only). Switch to the current session to make changes.`,
      );
    }
    function onRbacDenied() {
      window.alert(
        "You do not have permission for this action. Ask an admin to update Roles & permissions.",
      );
    }
    window.addEventListener("bhb-session-readonly", onReadonly);
    window.addEventListener("bhb-rbac-denied", onRbacDenied);
    return () => {
      window.removeEventListener("bhb-session-readonly", onReadonly);
      window.removeEventListener("bhb-rbac-denied", onRbacDenied);
    };
  }, [session.academicYearCode]);

  async function logout() {
    const { clearWorkspaceSessionAlignFlag } = await import(
      "@/lib/workspaceSession"
    );
    clearWorkspaceSessionAlignFlag();
    await fetch("/api/auth/demo", { method: "DELETE" });
    try {
      const { createBrowserSupabase, isDemoAuth } = await import(
        "@/lib/supabase/client"
      );
      if (!isDemoAuth()) {
        const sb = createBrowserSupabase();
        await sb?.auth.signOut();
      }
    } catch {
      /* ignore */
    }
    router.push("/login");
    router.refresh();
  }

  return (
    <SessionProvider session={session} readOnly={readOnly}>
      <SchoolFavicon />
      <div className="flex h-screen overflow-hidden bg-[var(--surface)]">
        <Suspense fallback={null}>
          <ErpSidebar
            mobileOpen={mobileNavOpen}
            onMobileClose={() => setMobileNavOpen(false)}
          />
        </Suspense>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <header
            className={`sticky top-0 z-20 border-b border-[rgba(32,48,80,0.1)] bg-[rgba(248,248,240,0.92)] backdrop-blur-md ${
              mobileApp ? "bhb-staff-app-header" : ""
            }`}
          >
            <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
              {!mobileApp ? (
                <ErpSidebarMenuButton onClick={() => setMobileNavOpen(true)} />
              ) : null}
              <Link href="/home" className="flex min-w-0 shrink-0 items-center gap-2.5">
              <Image
                src={TENANT.logoCrestUrl}
                alt=""
                width={42}
                height={44}
                className="logo-mark object-contain"
                priority
                aria-hidden
              />
              <div
                className={`min-w-0 leading-tight ${mobileApp ? "block" : "hidden sm:block"}`}
              >
                <div className="font-display truncate text-sm font-bold tracking-wide text-[var(--brand-deep)] uppercase">
                  {mobileApp ? TENANT.shortName : TENANT.nameDisplay}
                </div>
                <div className="font-tagline truncate text-[11px]">
                  {mobileApp ? session.fullName : TENANT.tagline}
                </div>
              </div>
            </Link>

            {!mobileApp ? <UniversalSearchBar /> : null}

            <div className={`flex shrink-0 items-center gap-2 sm:gap-3 ${mobileApp ? "bhb-staff-header-actions" : ""}`}>
              {!mobileApp ? (
                <SessionSelector currentCode={session.academicYearCode} />
              ) : null}
              <StaffInternalChatButton />
              <NotificationBell persona="staff" />
              {readOnly ? (
                <span className="hidden rounded-md bg-[rgba(197,160,40,0.18)] px-2 py-1 text-[11px] font-medium text-[var(--brand-deep)] lg:inline">
                  Read-only · {session.academicYearCode}
                </span>
              ) : null}
              <UserAccountMenu
                session={session}
                clock={clock}
                onLogout={logout}
              />
            </div>
          </div>
          <CommsRunningStrip audience="staff" />
        </header>
        {!standalone ? (
          <PwaInstallBanner
            appId="staff"
            title={staffPwa.title}
            subtitle={staffPwa.subtitle}
            iosHint={staffPwa.iosHint}
            className="px-4 pt-2 sm:px-6"
          />
        ) : null}
        {readOnly ? (
          <div className="border-b border-[rgba(197,160,40,0.35)] bg-[rgba(197,160,40,0.12)] px-4 py-2 text-center text-xs font-medium text-[var(--brand-deep)] sm:px-6">
            Session {session.academicYearCode} is closed — viewing only. Switch
            to the current session to save changes.
          </div>
        ) : null}
        <main
          className={`bhb-staff-main mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 sm:px-6 ${
            mobileApp ? "max-sm:px-3 max-sm:py-4" : ""
          }`}
        >
          {children}
        </main>
        {mobileApp ? (
          <StaffBottomNav onOpenMenu={() => setMobileNavOpen(true)} />
        ) : null}
        <ErpAiChatbot />
        </div>
      </div>
    </SessionProvider>
  );
}
