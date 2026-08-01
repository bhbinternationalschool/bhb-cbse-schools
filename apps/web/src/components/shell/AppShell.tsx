"use client";

import Image from "next/image";
import Link from "next/link";
import { Suspense, useEffect, useState } from "react";
import { usePathname, useRouter } from "next/navigation";
import { formatIst } from "@bhb/time";
import { SessionSelector } from "./SessionSelector";
import { UniversalSearchBar } from "./UniversalSearchBar";
import { NotificationBell } from "./NotificationBell";
import { StaffInternalChatButton } from "./StaffInternalChatButton";
import { CommsRunningStrip } from "./CommsRunningStrip";
import { ErpAiChatbot } from "./ErpAiChatbot";
import { ErpSidebar, ErpSidebarMenuButton } from "./ErpSidebar";
import { TENANT } from "@/lib/types";
import type { DemoSession } from "@/lib/auth";
import { SessionProvider } from "./SessionContext";
import {
  currentAcademicYearCode,
  listSessionYearOptions,
  syncWorkspaceAcademicYear,
} from "@/lib/masters";
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
  const [mobileNavOpen, setMobileNavOpen] = useState(false);
  const [years, setYears] = useState<
    ReturnType<typeof listSessionYearOptions>
  >([]);
  const [clock, setClock] = useState("");

  // Hydration-safe: pull cloud mirror BEFORE pushing local seed; then hydrate blobs.
  useEffect(() => {
    markModuleRegistryClientReady();
    setYears(listSessionYearOptions());
    setClock(formatIst());
    const t = window.setInterval(() => setClock(formatIst()), 30_000);

    void (async () => {
      const { ensureClientSchoolMirrorHydrated, ensureAllDeskHydrated } =
        await import("@/lib/schoolDataMirrorClientHydrate");
      const { pushFullSchoolMirrorToServer } = await import(
        "@/lib/schoolDataMirror"
      );

      const mirrorChanged = await ensureClientSchoolMirrorHydrated();
      const results = await Promise.allSettled([
        ensureAllDeskHydrated(),
        import("@/lib/admissionsPersistence").then((m) =>
          m.ensureAdmissionsHydrated(),
        ),
      ]);
      const admResult = results[1];
      if (admResult.status === "fulfilled" && admResult.value) {
        window.dispatchEvent(new CustomEvent("bhb-admissions-hydrated"));
      }
      if (mirrorChanged) {
        window.dispatchEvent(new CustomEvent("bhb-desk-hydrated"));
      }
      applyFeeDiscountSeedNow();
      pushFullSchoolMirrorToServer();
    })();

    return () => window.clearInterval(t);
  }, []);

  // Keep header session list aligned with Masters; fix cookie if year was removed
  useEffect(() => {
    const nextYears = listSessionYearOptions();
    setYears(nextYears);
    const known = nextYears.some((y) => y.code === session.academicYearCode);
    if (!known) {
      const mastersCurrent = currentAcademicYearCode();
      if (mastersCurrent && mastersCurrent !== session.academicYearCode) {
        void syncWorkspaceAcademicYear(mastersCurrent).then((ok) => {
          if (ok) router.refresh();
        });
      }
    }
  }, [pathname, session.academicYearCode, router]);

  const ay =
    years.find((y) => y.code === session.academicYearCode) ??
    years.find((y) => y.status === "current");
  const readOnly = ay?.status === "closed";

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
      <div className="flex h-screen overflow-hidden bg-[var(--surface)]">
        <Suspense fallback={null}>
          <ErpSidebar
            mobileOpen={mobileNavOpen}
            onMobileClose={() => setMobileNavOpen(false)}
          />
        </Suspense>

        <div className="flex min-h-0 min-w-0 flex-1 flex-col overflow-y-auto">
          <header className="sticky top-0 z-20 border-b border-[rgba(32,48,80,0.1)] bg-[rgba(248,248,240,0.92)] backdrop-blur-md">
            <div className="flex min-w-0 flex-1 items-center gap-3 px-4 py-3 sm:gap-4 sm:px-6">
              <ErpSidebarMenuButton onClick={() => setMobileNavOpen(true)} />
              <Link href="/home" className="flex shrink-0 items-center gap-2.5">
              <Image
                src={TENANT.logoCrestUrl}
                alt=""
                width={42}
                height={44}
                className="logo-mark object-contain"
                priority
                aria-hidden
              />
              <div className="hidden min-w-0 leading-tight sm:block">
                <div className="font-display truncate text-sm font-bold tracking-wide text-[var(--brand-deep)] uppercase">
                  {TENANT.nameDisplay}
                </div>
                <div className="font-tagline truncate text-[11px]">
                  {TENANT.tagline}
                </div>
              </div>
            </Link>

            <UniversalSearchBar />

            <div className="flex shrink-0 items-center gap-2 sm:gap-3">
              <SessionSelector currentCode={session.academicYearCode} />
              <StaffInternalChatButton />
              <NotificationBell persona="staff" />
              {readOnly ? (
                <span className="hidden rounded-md bg-[rgba(197,160,40,0.18)] px-2 py-1 text-[11px] font-medium text-[var(--brand-deep)] lg:inline">
                  Read-only · {session.academicYearCode}
                </span>
              ) : null}
              <div className="flex items-center gap-2">
                <span
                  className="flex h-8 w-8 items-center justify-center rounded-full text-xs font-semibold"
                  style={{
                    background: TENANT.goldColor,
                    color: TENANT.primaryColor,
                  }}
                  title={session.fullName}
                >
                  {initials(session.fullName)}
                </span>
                <div className="hidden text-right md:block">
                  <div className="text-xs font-medium text-[var(--brand-deep)]">
                    {session.fullName}
                  </div>
                  <div className="text-[10px] text-[var(--muted)]" suppressHydrationWarning>
                    {clock || "\u00a0"}
                  </div>
                </div>
                <button
                  type="button"
                  onClick={logout}
                  className="hidden text-xs text-[var(--muted)] hover:text-[var(--brand-deep)] sm:inline"
                >
                  Sign out
                </button>
              </div>
            </div>
          </div>
          <CommsRunningStrip audience="staff" />
        </header>
        {readOnly ? (
          <div className="border-b border-[rgba(197,160,40,0.35)] bg-[rgba(197,160,40,0.12)] px-4 py-2 text-center text-xs font-medium text-[var(--brand-deep)] sm:px-6">
            Session {session.academicYearCode} is closed — viewing only. Switch
            to the current session to save changes.
          </div>
        ) : null}
        <main className="mx-auto w-full max-w-[90rem] flex-1 px-4 py-6 sm:px-6">
          {children}
        </main>
        <ErpAiChatbot />
        </div>
      </div>
    </SessionProvider>
  );
}

function initials(name: string) {
  return name
    .split(" ")
    .map((p) => p[0])
    .join("")
    .slice(0, 2)
    .toUpperCase();
}
