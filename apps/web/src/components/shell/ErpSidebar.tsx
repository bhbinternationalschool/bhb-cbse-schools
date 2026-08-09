"use client";

import Link from "next/link";
import { usePathname, useSearchParams } from "next/navigation";
import { useEffect, useMemo, useRef, useState } from "react";
import {
  ChevronLeft,
  ChevronRight,
  Home,
  PanelLeftOpen,
  X,
} from "lucide-react";
import { HUB_GROUPS, TONE } from "@/lib/erpNav";
import { defaultMasters, loadMasters } from "@/lib/masters";
import { markModuleRegistryClientReady } from "@/lib/moduleRegistry";
import { canAccessHref, defaultRbacState, loadRbac } from "@/lib/rbac";
import { useDemoSession } from "@/components/shell/SessionContext";

type NavView = "main" | "sub";

const DESKTOP_NAV_MQ = "(min-width: 1024px)";

function useIsMobileNav(): boolean | null {
  const [isMobile, setIsMobile] = useState<boolean | null>(null);

  useEffect(() => {
    const mq = window.matchMedia(DESKTOP_NAV_MQ);
    const update = () => setIsMobile(!mq.matches);
    update();
    mq.addEventListener("change", update);
    return () => mq.removeEventListener("change", update);
  }, []);

  return isMobile;
}

function isNavActive(pathname: string, search: string, href: string): boolean {
  const [path, query] = href.split("?");
  if (pathname !== path) return false;
  if (!query) return true;
  const expected = new URLSearchParams(query);
  const actual = new URLSearchParams(search.startsWith("?") ? search.slice(1) : search);
  for (const [key, value] of expected.entries()) {
    if (actual.get(key) !== value) return false;
  }
  return true;
}

function SidebarPanel({
  navView,
  activeGroup,
  groups,
  pathname,
  search,
  sessionYear,
  onOpenGroup,
  onBackToMain,
  onClose,
  showClose,
}: {
  navView: NavView;
  activeGroup: (typeof HUB_GROUPS)[number] | null;
  groups: Array<(typeof HUB_GROUPS)[number] & { hubs: (typeof HUB_GROUPS)[number]["hubs"] }>;
  pathname: string;
  search: string;
  sessionYear: string;
  onOpenGroup: (id: string) => void;
  onBackToMain: () => void;
  onClose: () => void;
  showClose: boolean;
}) {
  const homeActive = pathname === "/home";

  return (
    <aside
      className="erp-sidebar flex h-full w-[min(18rem,88vw)] flex-col border-r border-[rgba(32,48,80,0.1)] bg-[rgba(255,255,255,0.98)] backdrop-blur-md lg:w-[17.5rem]"
      aria-label="Module navigation"
    >
      <div className="flex shrink-0 items-center justify-between gap-2 border-b border-[rgba(32,48,80,0.08)] px-3 py-3">
        {navView === "sub" && activeGroup ? (
          <button
            type="button"
            onClick={onBackToMain}
            className="inline-flex min-h-9 items-center gap-1.5 rounded-lg px-2 text-sm font-semibold text-[var(--brand-deep)] transition hover:bg-[rgba(32,48,80,0.06)]"
          >
            <ChevronLeft className="h-4 w-4 shrink-0" />
            Main menu
          </button>
        ) : (
          <p className="px-1 text-[11px] font-bold uppercase tracking-[0.14em] text-[var(--muted)]">
            Modules
          </p>
        )}
        {showClose ? (
          <button
            type="button"
            onClick={onClose}
            className="inline-flex min-h-9 min-w-9 items-center justify-center rounded-lg text-[var(--muted)] transition hover:bg-[rgba(32,48,80,0.06)] hover:text-[var(--brand-deep)]"
            aria-label="Close menu"
          >
            <X className="h-5 w-5" />
          </button>
        ) : (
          <span className="w-9" aria-hidden />
        )}
      </div>

      <nav className="flex-1 overflow-y-auto overscroll-contain px-2 py-3">
        {navView === "main" ? (
          <>
            <Link
              href="/home"
              title="Home dashboard"
              onClick={() => {
                onClose();
                if (typeof window !== "undefined") {
                  window.location.href = "/home";
                }
              }}
              className={`erp-sidebar-link mb-3 flex min-h-11 items-center gap-3 rounded-xl px-3 text-sm font-semibold transition ${
                homeActive
                  ? "bg-[var(--brand-deep)] text-white shadow-[0_4px_14px_rgba(32,48,80,0.2)]"
                  : "text-[var(--brand-deep)] hover:bg-[rgba(32,48,80,0.06)]"
              }`}
            >
              <Home className="h-5 w-5 shrink-0" strokeWidth={2} />
              <span>Home</span>
            </Link>

            <p className="mb-2 px-2 text-[10px] font-bold uppercase tracking-[0.12em] text-[var(--muted)]">
              Choose area
            </p>
            <ul className="space-y-1">
              {groups.map((group) => {
                const gTone = TONE[group.tone];
                const GroupIcon = group.hubs[0]?.icon;
                const groupHasActive = group.hubs.some((h) =>
                  isNavActive(pathname, search, h.href),
                );
                return (
                  <li key={group.id}>
                    <button
                      type="button"
                      onClick={() => onOpenGroup(group.id)}
                      className={`erp-sidebar-group-btn flex w-full min-h-12 items-center gap-3 rounded-xl px-3 py-2.5 text-left transition hover:bg-[rgba(32,48,80,0.05)] ${
                        groupHasActive
                          ? "bg-[rgba(197,160,40,0.12)] ring-1 ring-[rgba(197,160,40,0.3)]"
                          : ""
                      }`}
                    >
                      {GroupIcon ? (
                        <span
                          className={`inline-flex h-9 w-9 shrink-0 items-center justify-center rounded-lg ${gTone.icon}`}
                        >
                          <GroupIcon className="h-4 w-4" strokeWidth={2} />
                        </span>
                      ) : (
                        <span
                          className={`h-2.5 w-2.5 shrink-0 rounded-full ${gTone.bar}`}
                          aria-hidden
                        />
                      )}
                      <span className="min-w-0 flex-1">
                        <span className="block truncate text-[13px] font-bold text-[var(--brand-deep)]">
                          {group.label}
                        </span>
                        <span className="mt-0.5 block truncate text-[11px] text-[var(--muted)]">
                          {group.hubs.length} module
                          {group.hubs.length === 1 ? "" : "s"}
                        </span>
                      </span>
                      <ChevronRight className="h-4 w-4 shrink-0 text-[var(--muted)]" />
                    </button>
                  </li>
                );
              })}
            </ul>
          </>
        ) : activeGroup ? (
          <>
            <div className="mb-3 rounded-xl bg-[rgba(32,48,80,0.04)] px-3 py-2.5">
              <p className="text-[10px] font-bold uppercase tracking-[0.1em] text-[var(--muted)]">
                {activeGroup.label}
              </p>
              <p className="mt-1 text-[12px] leading-snug text-[var(--muted)]">
                {activeGroup.purpose}
              </p>
            </div>

            <ul className="space-y-0.5">
              {activeGroup.hubs.map((hub) => {
                const Icon = hub.icon;
                const active = isNavActive(pathname, search, hub.href);
                const tone = TONE[hub.tone];
                return (
                  <li key={hub.href}>
                    <Link
                      href={hub.href}
                      title={`${hub.title} — ${hub.blurb}`}
                      onClick={() => {
                        onClose();
                        if (typeof window !== "undefined") {
                          window.location.href = hub.href;
                        }
                      }}
                      className={`erp-sidebar-link flex min-h-11 items-center gap-2.5 rounded-lg px-2.5 py-2 text-[13px] font-medium transition ${
                        active
                          ? "bg-[rgba(197,160,40,0.16)] text-[var(--brand-deep)] ring-1 ring-[rgba(197,160,40,0.35)]"
                          : "text-[var(--ink)] hover:bg-[rgba(32,48,80,0.05)]"
                      }`}
                    >
                      <span
                        className={`inline-flex h-8 w-8 shrink-0 items-center justify-center rounded-lg ${tone.icon}`}
                      >
                        <Icon className="h-4 w-4" strokeWidth={2} />
                      </span>
                      <span className="min-w-0 flex-1">
                        <span className="block truncate">{hub.title}</span>
                        <span className="block truncate text-[11px] font-normal text-[var(--muted)]">
                          {hub.blurb}
                        </span>
                      </span>
                      {active ? (
                        <ChevronRight className="h-4 w-4 shrink-0 text-[var(--brand-gold)]" />
                      ) : null}
                    </Link>
                  </li>
                );
              })}
            </ul>
          </>
        ) : null}
      </nav>

      <div className="shrink-0 border-t border-[rgba(32,48,80,0.08)] px-3 py-3">
        <p className="text-[11px] leading-relaxed text-[var(--muted)]">
          Session {sessionYear}
        </p>
      </div>
    </aside>
  );
}

export function ErpSidebar({
  mobileOpen,
  onMobileClose,
}: {
  mobileOpen: boolean;
  onMobileClose: () => void;
}) {
  const session = useDemoSession();
  const pathname = usePathname();
  const searchParams = useSearchParams();
  const search = searchParams.toString();
  const [navTick, setNavTick] = useState(0);
  const [navView, setNavView] = useState<NavView>("main");
  const [activeGroupId, setActiveGroupId] = useState<string | null>(null);
  const isMobile = useIsMobileNav();
  const routeKeyRef = useRef(`${pathname}?${search}`);

  useEffect(() => {
    markModuleRegistryClientReady();
    setNavTick((n) => n + 1);
    function onRegistry() {
      setNavTick((n) => n + 1);
    }
    window.addEventListener("bhb-module-registry", onRegistry);
    return () => window.removeEventListener("bhb-module-registry", onRegistry);
  }, []);

  const groups = useMemo(() => {
    const masters = navTick > 0 ? loadMasters() : defaultMasters();
    const rbac = navTick > 0 ? loadRbac() : defaultRbacState();
    return HUB_GROUPS.map((g) => ({
      ...g,
      hubs: g.hubs.filter((h) =>
        canAccessHref(session, masters, h.href, rbac),
      ),
    })).filter((g) => g.hubs.length > 0);
     
  }, [session, navTick]);

  useEffect(() => {
    if (isMobile === null) return;

    const routeKey = `${pathname}?${search}`;
    const routeChanged = routeKeyRef.current !== routeKey;
    routeKeyRef.current = routeKey;

    if (isMobile) {
      if (routeChanged) onMobileClose();
      return;
    }

    if (pathname === "/home") {
      setNavView("main");
      setActiveGroupId(null);
      return;
    }
    const match = groups.find((g) =>
      g.hubs.some((h) => isNavActive(pathname, search, h.href)),
    );
    if (match) {
      setActiveGroupId(match.id);
      setNavView("sub");
    }
    // eslint-disable-next-line react-hooks/exhaustive-deps -- route-driven nav sync
  }, [pathname, search, isMobile, groups]);

  const activeGroup = groups.find((g) => g.id === activeGroupId) ?? null;

  function openGroup(id: string) {
    setActiveGroupId(id);
    setNavView("sub");
  }

  function backToMain() {
    setNavView("main");
    setActiveGroupId(null);
  }

  const panelProps = {
    navView,
    activeGroup,
    groups,
    pathname,
    search,
    sessionYear: session.academicYearCode,
    onOpenGroup: openGroup,
    onBackToMain: backToMain,
    onClose: onMobileClose,
  };

  return (
    <>
      {/* Desktop — always visible */}
      <div className="erp-sidebar-desktop hidden h-screen w-[17.5rem] shrink-0 lg:sticky lg:top-0 lg:block lg:self-start">
        <SidebarPanel {...panelProps} showClose={false} />
      </div>

      {/* Mobile drawer */}
      {mobileOpen ? (
        <div className="erp-sidebar-mobile fixed inset-0 z-40 lg:hidden">
          <button
            type="button"
            className="absolute inset-0 bg-[rgba(32,48,80,0.45)] backdrop-blur-[2px]"
            aria-label="Close menu overlay"
            onClick={onMobileClose}
          />
          <div className="absolute inset-y-0 left-0 shadow-2xl">
            <SidebarPanel {...panelProps} showClose />
          </div>
        </div>
      ) : null}
    </>
  );
}

export function ErpSidebarMenuButton({ onClick }: { onClick: () => void }) {
  return (
    <button
      type="button"
      onClick={onClick}
      className="inline-flex min-h-10 min-w-10 items-center justify-center rounded-lg border border-[rgba(32,48,80,0.12)] bg-white text-[var(--brand-deep)] shadow-sm transition hover:border-[rgba(197,160,40,0.4)] lg:hidden"
      aria-label="Open module menu"
    >
      <PanelLeftOpen className="h-5 w-5" />
    </button>
  );
}
