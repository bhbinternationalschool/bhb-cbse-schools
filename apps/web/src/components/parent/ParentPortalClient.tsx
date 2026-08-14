"use client";

import { useEffect, useState } from "react";
import { useRouter } from "next/navigation";
import { ParentFeesPortal } from "@/components/parent/ParentFeesPortal";
import { ParentHomeworkPortal } from "@/components/parent/ParentHomeworkPortal";
import { ParentPtmPortal } from "@/components/parent/ParentPtmPortal";
import { ParentStudentLeavePortal } from "@/components/parent/ParentStudentLeavePortal";
import { ParentComplaintsPortal } from "@/components/parent/ParentComplaintsPortal";
import { ParentSubjectsPortal } from "@/components/parent/ParentSubjectsPortal";
import { ParentCommsPortal } from "@/components/parent/ParentCommsPortal";
import { ParentProfileDocsPortal } from "@/components/parent/ParentProfileDocsPortal";
import { NotificationBell } from "@/components/shell/NotificationBell";
import { CommsRunningStrip } from "@/components/shell/CommsRunningStrip";
import { ParentVoiceBar } from "@/components/parent/ParentVoiceBar";
import { PwaInstallBanner } from "@/components/pwa/PwaInstallBanner";
import { ParentBottomNav } from "@/components/pwa/ParentBottomNav";
import { parentPwaInstallCopy } from "@/lib/pwaApps";
import { useMobileAppShell, usePwaStandalone } from "@/lib/pwaStandalone";
import { ErpChatButton } from "@/components/shell/StaffInternalChatButton";

type PortalTab =
  | "fees"
  | "homework"
  | "ptm"
  | "leave"
  | "subjects"
  | "notices"
  | "news"
  | "gallery"
  | "profile"
  | "complaints";

export function ParentPortalClient({
  guardianName,
  householdId,
}: {
  guardianName: string;
  /** Bound on login; chat resolves via session context */
  householdId?: string;
}) {
  const router = useRouter();
  const mobileApp = useMobileAppShell();
  const standalone = usePwaStandalone();
  const [portalTab, setPortalTab] = useState<PortalTab>("fees");

  useEffect(() => {
    function applyTab(raw: string | null) {
      if (
        raw === "notices" ||
        raw === "news" ||
        raw === "gallery" ||
        raw === "homework" ||
        raw === "ptm" ||
        raw === "leave" ||
        raw === "subjects" ||
        raw === "fees" ||
        raw === "profile" ||
        raw === "complaints"
      ) {
        setPortalTab(raw);
      }
    }
    if (typeof window !== "undefined") {
      applyTab(new URLSearchParams(window.location.search).get("tab"));
    }
    try {
      const stored = sessionStorage.getItem("bhb_parent_portal_tab");
      if (stored) {
        applyTab(stored);
        sessionStorage.removeItem("bhb_parent_portal_tab");
      }
    } catch {
      /* ignore */
    }
    function onTab(e: Event) {
      const detail = (e as CustomEvent<string>).detail;
      applyTab(detail || null);
      try {
        sessionStorage.removeItem("bhb_parent_portal_tab");
      } catch {
        /* ignore */
      }
    }
    window.addEventListener("bhb-parent-portal-tab", onTab);
    return () => window.removeEventListener("bhb-parent-portal-tab", onTab);
  }, []);

  async function signOut() {
    await fetch("/api/auth/demo", { method: "DELETE" }).catch(() => null);
    router.push("/login");
    router.refresh();
  }

  const tabs = [
    ["fees", "Fees"],
    ["homework", "HW"],
    ["profile", "Profile"],
    ["notices", "Notices"],
    ["news", "News"],
    ["gallery", "Gallery"],
    ["ptm", "PTM"],
    ["leave", "Leave"],
    ["subjects", "Subjects"],
    ["complaints", "Complaints"],
  ] as const;

  const title =
    portalTab === "homework"
      ? "Homework"
      : portalTab === "ptm"
        ? "PTM"
        : portalTab === "leave"
          ? "Leave"
          : portalTab === "complaints"
            ? "Complaints"
            : portalTab === "notices"
            ? "Notices"
            : portalTab === "news"
              ? "News"
              : portalTab === "gallery"
                ? "Gallery"
                : portalTab === "profile"
                  ? "Profile & docs"
                  : "Subjects";

  return (
    <div className={mobileApp ? "bhb-parent-mobile-app" : ""}>
      <div className="sticky top-0 z-30 border-b border-[rgba(32,48,80,0.1)] bg-[rgba(246,245,239,0.96)] backdrop-blur-md">
        <CommsRunningStrip
          audience="parents"
          compact
          onParentNavigate={(tab) => setPortalTab(tab)}
        />
        <div className="px-4 pt-2">
          {mobileApp ? (
            <div className="mx-auto flex max-w-lg items-center justify-between gap-3 pb-2 md:max-w-2xl lg:max-w-3xl">
              <div className="min-w-0">
                <p className="text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
                  BHB Parent
                </p>
                <p className="truncate text-sm font-semibold text-[var(--brand-deep)]">
                  {guardianName}
                </p>
              </div>
              <div className="flex shrink-0 items-center gap-2">
                <ErpChatButton />
                <NotificationBell persona="parent" parentName={guardianName} />
              </div>
            </div>
          ) : (
            <>
              <div className="mx-auto flex max-w-lg items-center justify-end gap-2 pb-1 md:max-w-2xl lg:max-w-3xl">
                <ErpChatButton />
                <NotificationBell persona="parent" parentName={guardianName} />
              </div>
              <div className="mx-auto flex max-w-lg gap-1 overflow-x-auto rounded-lg bg-[rgba(32,48,80,0.06)] p-1 md:max-w-2xl lg:max-w-3xl">
                {tabs.map(([id, label]) => (
                  <button
                    key={id}
                    type="button"
                    onClick={() => setPortalTab(id)}
                    className={`shrink-0 flex-1 rounded-md px-2 py-2 text-[11px] font-bold sm:text-xs ${
                      portalTab === id
                        ? "bg-white text-[var(--brand-deep)] shadow-sm"
                        : "text-[var(--muted)]"
                    }`}
                  >
                    {label}
                  </button>
                ))}
              </div>
            </>
          )}
          {!standalone ? (
            <PwaInstallBanner appId="parent" {...parentPwaInstallCopy()} />
          ) : null}
          <ParentVoiceBar onNavigate={(t) => setPortalTab(t)} />
        </div>
      </div>

      {portalTab === "fees" ? (
        <div className={mobileApp ? "bhb-parent-app-content" : ""}>
          <ParentFeesPortal
            guardianDisplayName={guardianName}
            onSignOut={() => {
              void signOut();
            }}
          />
        </div>
      ) : (
        <div
          className={`mx-auto min-h-screen max-w-lg md:max-w-2xl lg:max-w-3xl ${
            mobileApp ? "bhb-parent-app-content pb-4" : "pb-16"
          }`}
        >
          {!mobileApp ? (
            <div className="flex items-center justify-between px-4 pt-3">
              <p className="text-sm font-semibold text-[var(--brand-deep)]">
                {title} · {guardianName}
              </p>
              <button
                type="button"
                onClick={() => void signOut()}
                className="rounded-lg border border-[rgba(32,48,80,0.15)] px-2.5 py-1 text-[11px] font-semibold text-[var(--brand-deep)]"
              >
                Sign out
              </button>
            </div>
          ) : null}
          {portalTab === "homework" ? (
            <ParentHomeworkPortal guardianDisplayName={guardianName} />
          ) : null}
          {portalTab === "ptm" ? (
            <ParentPtmPortal guardianDisplayName={guardianName} />
          ) : null}
          {portalTab === "leave" ? (
            <ParentStudentLeavePortal guardianDisplayName={guardianName} />
          ) : null}
          {portalTab === "complaints" ? (
            <ParentComplaintsPortal guardianDisplayName={guardianName} />
          ) : null}
          {portalTab === "profile" ? (
            <ParentProfileDocsPortal
              guardianDisplayName={guardianName}
              householdId={householdId}
            />
          ) : null}
          {portalTab === "notices" ||
          portalTab === "news" ||
          portalTab === "gallery" ? (
            <ParentCommsPortal
              view={portalTab}
              guardianDisplayName={guardianName}
            />
          ) : null}
          {portalTab === "subjects" ? (
            <>
              <ParentSubjectsPortal guardianDisplayName={guardianName} />
              <p className="mt-6 px-4 text-[11px] text-[var(--muted)]">
                Parent portal: fees, homework, profile &amp; docs, notices,
                news, gallery, PTM, leave &amp; subjects.
              </p>
            </>
          ) : null}
        </div>
      )}
      {mobileApp ? (
        <ParentBottomNav
          active={portalTab}
          onSelect={setPortalTab}
          onSignOut={() => void signOut()}
        />
      ) : null}
    </div>
  );
}
