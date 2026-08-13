"use client";

import { useState } from "react";
import {
  BookOpen,
  Calendar,
  GraduationCap,
  IndianRupee,
  Megaphone,
  MoreHorizontal,
  Newspaper,
  Images,
  UserRound,
} from "lucide-react";
import { ThemeToggle } from "@/components/theme/ThemeToggle";
import { TENANT } from "@/lib/types";

export type ParentNavTab =
  | "fees"
  | "homework"
  | "notices"
  | "ptm"
  | "leave"
  | "subjects"
  | "news"
  | "gallery"
  | "profile";

type PrimaryId = "fees" | "homework" | "notices" | "ptm" | "more";

const PRIMARY: {
  id: PrimaryId;
  tab?: ParentNavTab;
  label: string;
  icon: typeof IndianRupee;
}[] = [
  { id: "fees", tab: "fees", label: "Fees", icon: IndianRupee },
  { id: "homework", tab: "homework", label: "Homework", icon: BookOpen },
  { id: "notices", tab: "notices", label: "Notices", icon: Megaphone },
  { id: "ptm", tab: "ptm", label: "PTM", icon: Calendar },
  { id: "more", label: "More", icon: MoreHorizontal },
];

const MORE_ITEMS: { tab: ParentNavTab; label: string; icon: typeof Newspaper }[] =
  [
    { tab: "profile", label: "Profile", icon: UserRound },
    { tab: "news", label: "News", icon: Newspaper },
    { tab: "gallery", label: "Gallery", icon: Images },
    { tab: "leave", label: "Leave", icon: Calendar },
    { tab: "subjects", label: "Subjects", icon: GraduationCap },
  ];

export function ParentBottomNav({
  active,
  onSelect,
  onSignOut,
}: {
  active: ParentNavTab;
  onSelect: (tab: ParentNavTab) => void;
  onSignOut?: () => void;
}) {
  const [moreOpen, setMoreOpen] = useState(false);
  const moreActive = MORE_ITEMS.some((m) => m.tab === active);
  const primaryActive = (id: PrimaryId) => {
    if (id === "more") return moreActive;
    const p = PRIMARY.find((x) => x.id === id);
    return p?.tab === active;
  };

  return (
    <>
      {moreOpen ? (
        <button
          type="button"
          className="bhb-app-sheet-backdrop fixed inset-0 z-40 bg-black/30"
          aria-label="Close menu"
          onClick={() => setMoreOpen(false)}
        />
      ) : null}
      {moreOpen ? (
        <div className="bhb-app-more-sheet fixed bottom-[calc(3.75rem+env(safe-area-inset-bottom))] left-3 right-3 z-50 rounded-2xl border border-[rgba(32,48,80,0.12)] bg-white p-2 shadow-xl">
          <p className="px-2 py-1 text-[10px] font-bold uppercase tracking-wide text-[var(--muted)]">
            More
          </p>
          <div className="grid grid-cols-2 gap-1">
            {MORE_ITEMS.map((item) => {
              const Icon = item.icon;
              return (
                <button
                  key={item.tab}
                  type="button"
                  onClick={() => {
                    onSelect(item.tab);
                    setMoreOpen(false);
                  }}
                  className={`flex items-center gap-2 rounded-xl px-3 py-3 text-left text-sm font-semibold ${
                    active === item.tab
                      ? "bg-[rgba(32,48,80,0.08)] text-[var(--brand-deep)]"
                      : "text-[var(--brand-deep)]"
                  }`}
                >
                  <Icon className="h-4 w-4 shrink-0 opacity-70" />
                  {item.label}
                </button>
              );
            })}
          </div>
          <div className="mt-2 flex items-center justify-between rounded-xl border border-[rgba(32,48,80,0.1)] px-3 py-2">
            <span className="text-sm font-semibold text-[var(--brand-deep)]">
              Appearance
            </span>
            <ThemeToggle />
          </div>
          {onSignOut ? (
            <button
              type="button"
              onClick={() => {
                setMoreOpen(false);
                onSignOut();
              }}
              className="mt-2 w-full rounded-xl border border-[rgba(32,48,80,0.12)] px-3 py-2.5 text-center text-sm font-semibold text-[var(--brand-deep)]"
            >
              Sign out
            </button>
          ) : null}
        </div>
      ) : null}

      <nav
        className="bhb-app-bottom-nav fixed bottom-0 left-0 right-0 z-50 border-t border-[rgba(32,48,80,0.1)] bg-[rgba(255,255,255,0.96)] backdrop-blur-lg"
        aria-label="Parent navigation"
      >
        <div className="mx-auto flex max-w-lg items-stretch justify-around px-1 pt-1">
          {PRIMARY.map((item) => {
            const Icon = item.icon;
            const isActive = primaryActive(item.id);
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => {
                  if (item.id === "more") {
                    setMoreOpen((v) => !v);
                    return;
                  }
                  if (item.tab) onSelect(item.tab);
                  setMoreOpen(false);
                }}
                className={`flex min-w-0 flex-1 flex-col items-center gap-0.5 rounded-lg px-1 py-1.5 ${
                  isActive
                    ? "text-[var(--brand-deep)]"
                    : "text-[var(--muted)]"
                }`}
              >
                <Icon
                  className={`h-5 w-5 ${isActive ? "text-[var(--brand-gold)]" : ""}`}
                  strokeWidth={isActive ? 2.5 : 2}
                />
                <span className="truncate text-[10px] font-bold">{item.label}</span>
              </button>
            );
          })}
        </div>
        <p className="pb-[max(4px,env(safe-area-inset-bottom))] pt-0.5 text-center text-[9px] text-[var(--muted)]">
          {TENANT.shortName} Parent
        </p>
      </nav>
    </>
  );
}
