"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import {
  MODULE_TAB_CONTAINER_CLASS,
  MODULE_TAB_SIZE_CLASS,
  ModernTabButton,
  moduleTabTriggerClass,
  ModuleTabDot,
  resolveModuleTabTone,
} from "@/components/ui/modern-tab-bar";
import type {
  ModuleTabGroup,
  ModuleTabItem,
  ModuleTabTone,
} from "@/components/ui/module-tab-tones";
import { MODULE_TAB_TONES } from "@/components/ui/module-tab-tones";

export type { ModuleTabGroup, ModuleTabItem, ModuleTabTone };
export { MODULE_TAB_TONES };

/**
 * Bold, colourful module tabs — use across Students, Fees, Exams, Masters, etc.
 */
export function ModuleTabs({
  items,
  value,
  onChange,
  "aria-label": ariaLabel = "Sections",
  size = "md",
  className = "",
  showOpenBadge = false,
}: {
  items: ModuleTabItem[];
  value: string;
  onChange: (id: string) => void;
  "aria-label"?: string;
  size?: keyof typeof MODULE_TAB_SIZE_CLASS;
  className?: string;
  showOpenBadge?: boolean;
}) {
  return (
    <div className="relative mt-4">
      <div
        className="pointer-events-none absolute inset-y-0 left-0 z-10 w-6 bg-gradient-to-r from-[var(--surface)] to-transparent md:hidden"
        aria-hidden
      />
      <div
        className="pointer-events-none absolute inset-y-0 right-0 z-10 w-6 bg-gradient-to-l from-[var(--surface)] to-transparent md:hidden"
        aria-hidden
      />
      <div
        className={cn(MODULE_TAB_CONTAINER_CLASS, className)}
        role="tablist"
        aria-label={ariaLabel}
      >
        {items.map((t, i) => {
          const active = value === t.id;
          const toneKey = resolveModuleTabTone(t, i);
          return (
            <ModernTabButton
              key={t.id}
              active={active}
              toneKey={toneKey}
              size={size}
              onClick={() => onChange(t.id)}
              label={t.label}
              badge={t.badge}
              icon={t.icon}
              showOpenBadge={showOpenBadge}
            />
          );
        })}
      </div>
    </div>
  );
}

/** Single tab button for ad-hoc toolbars (Fee Take style). */
export function ModuleTabButton({
  active,
  onClick,
  children,
  tone = "navy",
  size = "md",
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: ModuleTabTone;
  size?: keyof typeof MODULE_TAB_SIZE_CLASS;
}) {
  return (
    <button
      type="button"
      onClick={onClick}
      className={moduleTabTriggerClass({ active, toneKey: tone, size })}
    >
      {active ? <ModuleTabDot toneKey={tone} /> : null}
      {children}
    </button>
  );
}

/**
 * Related tabs grouped under labelled colour bands (Masters-style).
 */
export function ModuleTabGroups({
  groups,
  value,
  onChange,
  "aria-label": ariaLabel = "Sections",
  size = "md",
  className = "",
}: {
  groups: ModuleTabGroup[];
  value: string;
  onChange: (id: string) => void;
  "aria-label"?: string;
  size?: keyof typeof MODULE_TAB_SIZE_CLASS;
  className?: string;
}) {
  const activeGroup =
    groups.find((g) => g.tabs.some((t) => t.id === value)) ?? groups[0]!;

  function selectGroup(groupId: string) {
    const g = groups.find((x) => x.id === groupId);
    if (!g?.tabs.length) return;
    const stillInGroup = g.tabs.some((t) => t.id === value);
    if (!stillInGroup) onChange(g.tabs[0]!.id);
  }

  return (
    <div className={cn("mt-4 space-y-3", className)}>
      <div
        className={MODULE_TAB_CONTAINER_CLASS}
        role="tablist"
        aria-label={`${ariaLabel} groups`}
      >
        {groups.map((g) => {
          const on = activeGroup.id === g.id;
          return (
            <ModernTabButton
              key={g.id}
              active={on}
              toneKey={g.tone}
              size="lg"
              onClick={() => selectGroup(g.id)}
              label={g.label}
              badge={g.tabs.length}
            />
          );
        })}
      </div>

      <div
        className={cn(
          MODULE_TAB_CONTAINER_CLASS,
          "bg-white/90 shadow-[inset_0_1px_0_rgba(255,255,255,0.9)]",
        )}
        role="tablist"
        aria-label={`${activeGroup.label} tabs`}
      >
        <span className="mr-1 self-center text-xs font-black uppercase tracking-wider text-muted-foreground">
          {activeGroup.label}
        </span>
        {activeGroup.tabs.map((t, i) => {
          const active = value === t.id;
          const toneKey = resolveModuleTabTone(t, i, activeGroup.tone);
          return (
            <ModernTabButton
              key={t.id}
              active={active}
              toneKey={toneKey}
              size={size}
              onClick={() => onChange(t.id)}
              label={t.label}
              badge={t.badge}
              icon={t.icon}
            />
          );
        })}
      </div>
    </div>
  );
}
