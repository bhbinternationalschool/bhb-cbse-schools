"use client";

import { useEffect, useRef, useState } from "react";
import {
  MODULE_TAB_TONES,
  type ModuleTabTone,
} from "@/components/ui/ModuleTabs";

export type StoreTab =
  | "dashboard"
  | "master"
  | "purchase"
  | "issue"
  | "inv_report"
  | "acct_report"
  | "inv_allocation"
  | "asset_allocation";

export type StoreSubScreen = "allocation" | "report";

const MAIN_TABS: { id: StoreTab; label: string; tone: ModuleTabTone }[] = [
  { id: "dashboard", label: "Dashboard", tone: "navy" },
  { id: "master", label: "Stock Master", tone: "navy" },
  { id: "purchase", label: "Purchase", tone: "sky" },
  { id: "issue", label: "Sell / Issue", tone: "teal" },
  { id: "inv_report", label: "Inventory Report", tone: "green" },
  { id: "acct_report", label: "Accounts", tone: "green" },
];

type AllocationMenu = {
  tab: StoreTab;
  label: string;
  tone: ModuleTabTone;
  items: { id: StoreSubScreen; label: string }[];
};

const ALLOCATION_MENUS: AllocationMenu[] = [
  {
    tab: "inv_allocation",
    label: "Inventory allocation",
    tone: "violet",
    items: [
      { id: "allocation", label: "Allocation" },
      { id: "report", label: "Report" },
    ],
  },
  {
    tab: "asset_allocation",
    label: "Asset allocation",
    tone: "coral",
    items: [
      { id: "allocation", label: "Allocation" },
      { id: "report", label: "Report" },
    ],
  },
];

const SIZE = "px-4 py-2.5 text-[15px]";

function AllocationDropdown({
  menu,
  active,
  subScreen,
  onSelect,
}: {
  menu: AllocationMenu;
  active: boolean;
  subScreen: StoreSubScreen;
  onSelect: (tab: StoreTab, sub: StoreSubScreen) => void;
}) {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  const tone = MODULE_TAB_TONES[menu.tone];

  useEffect(() => {
    function onDocClick(e: MouseEvent) {
      if (!ref.current?.contains(e.target as Node)) setOpen(false);
    }
    document.addEventListener("mousedown", onDocClick);
    return () => document.removeEventListener("mousedown", onDocClick);
  }, []);

  const activeLabel =
    menu.items.find((i) => i.id === subScreen)?.label ?? menu.label;

  return (
    <div ref={ref} className="relative">
      <button
        type="button"
        role="tab"
        aria-selected={active}
        onClick={() => {
          if (active) setOpen((v) => !v);
          else {
            onSelect(menu.tab, "allocation");
            setOpen(true);
          }
        }}
        className={`relative inline-flex shrink-0 items-center gap-2 rounded-xl font-extrabold tracking-wide transition ${SIZE} ${
          active ? tone.active : `${tone.idle} ${tone.hover}`
        }`}
      >
        {active ? (
          <span
            className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot} ring-2 ring-white/50`}
            aria-hidden
          />
        ) : null}
        <span>{menu.label}</span>
        {active ? (
          <span className="rounded-md bg-[var(--card)]/20 px-1.5 py-0.5 text-[10px] font-black">
            {activeLabel}
          </span>
        ) : null}
        <span className="text-[10px]">{open ? "▲" : "▼"}</span>
      </button>
      {open && active ? (
        <ul className="absolute left-0 top-full z-20 mt-1 min-w-[200px] overflow-hidden rounded-lg border border-[var(--border)] bg-[var(--card)] py-1 shadow-lg">
          {menu.items.map((item) => (
            <li key={item.id}>
              <button
                type="button"
                className={`block w-full px-4 py-2 text-left text-sm ${
                  subScreen === item.id
                    ? "bg-[var(--surface-sunken)] font-semibold text-[var(--brand-deep)]"
                    : "text-[var(--brand-deep)] hover:bg-[var(--surface-sunken)]"
                }`}
                onClick={() => {
                  onSelect(menu.tab, item.id);
                  setOpen(false);
                }}
              >
                {item.label}
              </button>
            </li>
          ))}
        </ul>
      ) : null}
    </div>
  );
}

export function StoreModuleNav({
  tab,
  subScreen,
  onTabChange,
  onSubScreenChange,
}: {
  tab: StoreTab;
  subScreen: StoreSubScreen;
  onTabChange: (tab: StoreTab) => void;
  onSubScreenChange: (sub: StoreSubScreen) => void;
}) {
  const activeMenu = ALLOCATION_MENUS.find((m) => m.tab === tab);

  return (
    <div className="mt-4 space-y-3">
      <div
        className="module-tabs flex flex-wrap gap-2.5 rounded-2xl border border-[var(--border)] bg-[var(--surface-sunken)] p-3"
        role="tablist"
        aria-label="Store"
      >
        {MAIN_TABS.map((t) => {
          const active = tab === t.id;
          const tone = MODULE_TAB_TONES[t.tone];
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onTabChange(t.id)}
              className={`relative inline-flex shrink-0 items-center gap-2 rounded-xl font-extrabold tracking-wide transition ${SIZE} ${
                active ? tone.active : `${tone.idle} ${tone.hover}`
              }`}
            >
              {active ? (
                <span
                  className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot} ring-2 ring-white/50`}
                  aria-hidden
                />
              ) : null}
              <span>{t.label}</span>
            </button>
          );
        })}
        {ALLOCATION_MENUS.map((menu) => (
          <AllocationDropdown
            key={menu.tab}
            menu={menu}
            active={tab === menu.tab}
            subScreen={subScreen}
            onSelect={(t, sub) => {
              onTabChange(t);
              onSubScreenChange(sub);
            }}
          />
        ))}
      </div>

      {activeMenu ? (
        <div className="flex flex-wrap gap-2 rounded-xl border border-[var(--border)] bg-[var(--card)] px-3 py-2">
          <span className="self-center text-[11px] font-black uppercase tracking-wider text-[var(--muted)]">
            {activeMenu.label}
          </span>
          {activeMenu.items.map((item) => {
            const on = subScreen === item.id;
            const tone = MODULE_TAB_TONES[activeMenu.tone];
            return (
              <button
                key={item.id}
                type="button"
                onClick={() => onSubScreenChange(item.id)}
                className={`rounded-lg px-3 py-1.5 text-sm font-bold transition ${
                  on ? tone.active : `${tone.idle} ${tone.hover}`
                }`}
              >
                {item.label}
              </button>
            );
          })}
        </div>
      ) : null}
    </div>
  );
}
