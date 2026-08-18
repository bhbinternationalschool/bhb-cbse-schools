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
import { StaffBroadcastButton } from "@/components/staff/StaffBroadcastButton";
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
import { alignWorkspaceSessionFromMasters, bootstrapWorkspaceSession } from "@/lib/workspaceSession";
import { markModuleRegistryClientReady } from "@/lib/moduleRegistry";
import {
  setSessionWriteLock,
  setWorkspaceBootstrapPending,
} from "@/lib/sessionWriteGuard";
import { applyFeeDiscountSeedNow } from "@/lib/feeDiscountImportHydrate";
import { consumeFreshLoginSession, flushAllDeskSyncPending, resetAllWorkspacePersistenceCaches } from "@/lib/workspaceClientSession";
import { useWorkspaceInactivityLogout } from "./useWorkspaceInactivityLogout";
import { ToastHost } from "./Toast";

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
  const [bootReady, setBootReady] = useState(false);
  const skipRouteHydrateRef = useRef(true);
  const bootstrapAyRef = useRef<string | null>(null);

  useEffect(() => {
    setWorkspaceBootstrapPending(true);
    return () => setWorkspaceBootstrapPending(false);
  }, []);

  // Last line of defence: a promise nobody handled must still be visible.
  //
  // The four gates in front of this (typed results, the no-void ratchet,
  // useSaveMutation, and the push paths' own toasts) all depend on someone
  // having written the handling. This one does not. On 2026-08-09 a rejected
  // save reached a console.warn and the user was told the opposite; a
  // failure the user never sees is worse than a crash.
  useEffect(() => {
    function onUnhandled(e: PromiseRejectionEvent) {
      const detail =
        e.reason instanceof Error
          ? e.reason.message
          : typeof e.reason === "string"
            ? e.reason
            : "Unexpected error";
      console.error("[unhandled rejection]", e.reason);
      void import("@/components/shell/Toast").then(({ pushToast }) => {
        pushToast({
          kind: "error",
          message: `Something failed and was not reported properly: ${detail}. If you were saving, check the change was kept.`,
          durationMs: 0,
        });
      });
    }
    window.addEventListener("unhandledrejection", onUnhandled);
    return () => window.removeEventListener("unhandledrejection", onUnhandled);
  }, []);

  // A push that gave up must be visible. Until 2026-08-18 "bhb-sync-error"
  // had no listener anywhere and the retry ladder's terminal "failed" state
  // was rendered only inside the Attendance workspace; every other module's
  // failed save ended in a console.warn while the screen said nothing.
  useEffect(() => {
    const labels: Record<string, string> = {
      sis: "student records",
      rbac: "roles & permissions",
      module_registry: "module settings",
      wa_templates: "WhatsApp templates",
      automation: "automation rules",
      staff_hr: "staff HR",
      staff_advances: "staff advances",
      staff_agreements: "staff agreements",
      certificates: "certificates",
      exam_papers: "exam papers",
      fee_recovery_tasks: "fee recovery tasks",
      erp_chat: "chat",
      staff_chat: "staff chat",
    };
    function onSyncError(e: Event) {
      const d = (e as CustomEvent<{ id?: string; label?: string; error?: string }>).detail;
      const what = d?.label || labels[d?.id ?? ""] || d?.id || "this module";
      void import("@/components/shell/Toast").then(({ pushToast }) => {
        pushToast({
          kind: "error",
          message: `Your change to ${what} was NOT saved to the server (${d?.error || "sync failed"}). It is still on this computer — keep the page open and try saving again, or it will be lost on logout.`,
          durationMs: 0,
        });
      });
    }
    function onSyncStatus(e: Event) {
      const d = (e as CustomEvent<{ key: string; state: { status: string; error?: string } }>).detail;
      if (d?.state?.status !== "failed") return;
      const key = d.key.replace(/^blob:/, "").replace(/_state$/, "").replace(/_/g, " ");
      void import("@/components/shell/Toast").then(({ pushToast }) => {
        pushToast({
          kind: "error",
          message: `Saving ${key} to the server failed after several retries (${d.state.error || "sync failed"}). Your change is still on this computer — try again before logging out.`,
          durationMs: 0,
        });
      });
    }
    window.addEventListener("bhb-sync-error", onSyncError);
    window.addEventListener("bhb:sync-status", onSyncStatus);
    return () => {
      window.removeEventListener("bhb-sync-error", onSyncError);
      window.removeEventListener("bhb:sync-status", onSyncStatus);
    };
  }, []);

  useEffect(() => {
    function flushDeskSync() {
      void flushAllDeskSyncPending();
    }
    window.addEventListener("pagehide", flushDeskSync);
    document.addEventListener("visibilitychange", () => {
      if (document.visibilityState === "hidden") flushDeskSync();
    });
    return () => {
      window.removeEventListener("pagehide", flushDeskSync);
    };
  }, []);

  // Pull cloud data, align session, then reveal ERP (avoids stale 2025-26 flash).
  useEffect(() => {
    if (bootReady) return;

    markModuleRegistryClientReady();
    setClock(formatIst());
    const t = window.setInterval(() => setClock(formatIst()), 30_000);
    let cancelled = false;

    void (async () => {
      if (consumeFreshLoginSession()) {
        await resetAllWorkspacePersistenceCaches();
      }

      bootstrapAyRef.current = session.academicYearCode;
      setYears(listSessionYearOptions());
      applyFeeDiscountSeedNow();
      setWorkspaceBootstrapPending(false);
      setBootReady(true);

      void (async () => {
        try {
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

          const boot = await bootstrapWorkspaceSession(
            pathname,
            session.academicYearCode,
          );
          if (cancelled) return;
          if (boot === "refresh") {
            router.refresh();
            return;
          }

          pushFullSchoolMirrorToServer();
          startDeskHydrationBackground(pathname);
          window.dispatchEvent(new CustomEvent("bhb-desk-hydrated"));
        } catch {
          /* ignore */
        }
      })();
    })();

    return () => {
      cancelled = true;
      window.clearInterval(t);
    };
  }, [pathname, router, session.academicYearCode, bootReady]);



  // After Masters edits, re-align header session if needed (once per tab).
  useEffect(() => {
    if (!bootReady) return;

    function alignFromMasters() {
      setYears(listSessionYearOptions());
      void alignWorkspaceSessionFromMasters(session.academicYearCode).then(
        (changed) => {
          if (changed) router.refresh();
        },
      );
    }

    window.addEventListener("bhb-masters-updated", alignFromMasters);
    window.addEventListener("bhb-desk-hydrated", alignFromMasters);
    return () => {
      window.removeEventListener("bhb-masters-updated", alignFromMasters);
      window.removeEventListener("bhb-desk-hydrated", alignFromMasters);
    };
  }, [session.academicYearCode, router, bootReady]);

  const ay =
    years.find((y) => y.code === session.academicYearCode) ??
    years.find((y) => y.status === "current");
  const readOnly = ay?.status === "closed";
  const staffPwa = staffPwaInstallCopy(session.roleCode);

  useWorkspaceInactivityLogout(bootReady);

  useEffect(() => {
    setSessionWriteLock({
      academicYearCode: session.academicYearCode,
      closed: readOnly,
    });
  }, [session.academicYearCode, readOnly]);

  useEffect(() => {
    // Toasts, not window.alert.
    //
    // window.alert BLOCKS the page and has to be dismissed by hand. These
    // events fire per attempted action, so a read-only session produced a
    // modal on every tap — the director reported dismissing it "many times".
    // A refusal should be visible, not obstructive: the user already knows
    // what they tried to do, and stopping them from doing anything else
    // teaches nothing.
    //
    // Deduplicated too: the same refusal repeated within a few seconds is one
    // fact, not several.
    let lastMessage = "";
    let lastAt = 0;
    async function notify(message: string) {
      const now = Date.now();
      if (message === lastMessage && now - lastAt < 5000) return;
      lastMessage = message;
      lastAt = now;
      const { pushToast } = await import("@/components/shell/Toast");
      pushToast({ kind: "error", message, durationMs: 6000 });
    }

    function onReadonly(e: Event) {
      const detail = (e as CustomEvent<{ academicYearCode?: string }>).detail;
      const code = detail?.academicYearCode || session.academicYearCode;
      void notify(
        `Session ${code} is closed, so this cannot be changed. Switch to the current session to make edits.`,
      );
    }
    function onRbacDenied() {
      void notify(
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
    await flushAllDeskSyncPending();
    const { clearWorkspaceSessionAlignFlag } = await import(
      "@/lib/workspaceSession"
    );
    clearWorkspaceSessionAlignFlag();
    bootstrapAyRef.current = null;
    setBootReady(false);
    setWorkspaceBootstrapPending(true);
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

  if (!bootReady) {
    return (
      <SessionProvider session={session} readOnly={false}>
        <SchoolFavicon />
        <div className="flex h-screen items-center justify-center bg-[var(--surface)]">
          <p className="text-sm text-[var(--muted)]">Loading workspace…</p>
        </div>
      </SessionProvider>
    );
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
            className={`sticky top-0 z-20 border-b border-[var(--border)] bg-[rgba(248,248,240,0.92)] backdrop-blur-md ${
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
              <StaffBroadcastButton />
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
        <ToastHost />
        </div>
      </div>
    </SessionProvider>
  );
}
