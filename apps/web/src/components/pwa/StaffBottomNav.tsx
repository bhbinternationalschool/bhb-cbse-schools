"use client";

import Link from "next/link";
import { usePathname } from "next/navigation";
import {
  BookOpen,
  ClipboardCheck,
  Home,
  IndianRupee,
  LayoutGrid,
} from "lucide-react";

const TABS = [
  { href: "/home", label: "Home", icon: Home, match: (p: string) => p === "/home" },
  {
    href: "/attendance",
    label: "Attend",
    icon: ClipboardCheck,
    match: (p: string) => p.startsWith("/attendance"),
  },
  {
    href: "/homework",
    label: "Homework",
    icon: BookOpen,
    match: (p: string) => p.startsWith("/homework"),
  },
  {
    href: "/fees",
    label: "Fees",
    icon: IndianRupee,
    match: (p: string) => p.startsWith("/fees"),
  },
] as const;

export function StaffBottomNav({ onOpenMenu }: { onOpenMenu: () => void }) {
  const pathname = usePathname() || "/home";

  return (
    <nav
      className="bhb-app-bottom-nav fixed bottom-0 left-0 right-0 z-50 border-t border-[rgba(32,48,80,0.1)] bg-[rgba(255,255,255,0.96)] backdrop-blur-lg md:hidden"
      aria-label="Staff app navigation"
    >
      <div className="flex items-stretch justify-around px-1 pt-1">
        {TABS.map((tab) => {
          const Icon = tab.icon;
          const active = tab.match(pathname);
          return (
            <Link
              key={tab.href}
              href={tab.href}
              className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 ${
                active ? "text-[var(--brand-deep)]" : "text-[var(--muted)]"
              }`}
            >
              <Icon
                className={`h-5 w-5 ${active ? "text-[var(--brand-gold)]" : ""}`}
                strokeWidth={active ? 2.5 : 2}
              />
              <span className="truncate text-[10px] font-bold">{tab.label}</span>
            </Link>
          );
        })}
        <button
          type="button"
          onClick={onOpenMenu}
          className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 ${
            !TABS.some((t) => t.match(pathname))
              ? "text-[var(--brand-deep)]"
              : "text-[var(--muted)]"
          }`}
        >
          <LayoutGrid
            className={`h-5 w-5 ${
              !TABS.some((t) => t.match(pathname)) ? "text-[var(--brand-gold)]" : ""
            }`}
            strokeWidth={!TABS.some((t) => t.match(pathname)) ? 2.5 : 2}
          />
          <span className="truncate text-[10px] font-bold">Modules</span>
        </button>
      </div>
      <p className="pb-[max(4px,env(safe-area-inset-bottom))] pt-0.5 text-center text-[9px] text-[var(--muted)]">
        BHB Staff
      </p>
    </nav>
  );
}
