"use client";

import type { ReactNode } from "react";
import { cn } from "@/lib/utils";
import type { ModuleTabItem, ModuleTabTone } from "@/components/ui/module-tab-tones";
import { MODULE_TAB_TONES } from "@/components/ui/module-tab-tones";

export const DEFAULT_MODULE_TAB_TONES: ModuleTabTone[] = [
  "navy",
  "teal",
  "amber",
  "green",
  "sky",
  "violet",
  "coral",
  "rose",
];

export const MODULE_TAB_CONTAINER_CLASS =
  "module-tabs flex flex-wrap gap-2 overflow-x-auto rounded-xl border border-[rgba(32,48,80,0.1)] bg-gradient-to-br from-white/95 to-[rgba(248,248,240,0.88)] p-2 shadow-[0_4px_20px_rgba(32,48,80,0.06),inset_0_1px_0_rgba(255,255,255,0.9)] backdrop-blur-sm [-ms-overflow-style:none] [scrollbar-width:none] [&::-webkit-scrollbar]:hidden";

export const MODULE_TAB_SIZE_CLASS = {
  md: "min-h-9 px-3 py-2 text-[13px] font-semibold sm:text-sm",
  lg: "min-h-10 px-3.5 py-2 text-sm font-bold sm:text-[15px]",
  xl: "min-h-10 px-4 py-2.5 text-[15px] font-bold sm:text-base",
} as const;

export function resolveModuleTabTone(
  item: Pick<ModuleTabItem, "tone">,
  index: number,
  fallback?: ModuleTabTone,
): ModuleTabTone {
  return (
    item.tone ??
    fallback ??
    DEFAULT_MODULE_TAB_TONES[index % DEFAULT_MODULE_TAB_TONES.length]!
  );
}

export function moduleTabTriggerClass({
  active,
  toneKey,
  size = "lg",
}: {
  active: boolean;
  toneKey: ModuleTabTone;
  size?: keyof typeof MODULE_TAB_SIZE_CLASS;
}) {
  const tone = MODULE_TAB_TONES[toneKey] ?? MODULE_TAB_TONES.navy;
  return cn(
    "relative inline-flex shrink-0 items-center gap-2 rounded-lg font-bold tracking-wide transition-all duration-200 ease-out",
    "focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)] focus-visible:ring-offset-2",
    "hover:-translate-y-px active:translate-y-0",
    MODULE_TAB_SIZE_CLASS[size],
    active
      ? cn(tone.active, "scale-[1.02] border border-white/20")
      : cn(tone.idle, tone.hover, "border border-transparent opacity-90 hover:opacity-100"),
  );
}

export function ModuleTabBadge({
  active,
  children,
}: {
  active: boolean;
  children: ReactNode;
}) {
  if (children == null || children === "") return null;
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-xs font-black tabular-nums",
        active ? "bg-white/25 text-white" : "bg-black/8 text-current",
      )}
    >
      {children}
    </span>
  );
}

export function ModuleTabDot({ toneKey }: { toneKey: ModuleTabTone }) {
  const tone = MODULE_TAB_TONES[toneKey] ?? MODULE_TAB_TONES.navy;
  return (
    <span
      className={cn(
        "size-2 shrink-0 rounded-full ring-2 ring-white/50",
        tone.dot,
      )}
      aria-hidden
    />
  );
}

export function ModernTabButton({
  active,
  toneKey,
  size = "lg",
  onClick,
  label,
  badge,
  icon,
  showOpenBadge,
  className,
}: {
  active: boolean;
  toneKey: ModuleTabTone;
  size?: keyof typeof MODULE_TAB_SIZE_CLASS;
  onClick?: () => void;
  label: ReactNode;
  badge?: ReactNode;
  icon?: ReactNode;
  showOpenBadge?: boolean;
  className?: string;
}) {
  return (
    <button
      type="button"
      role="tab"
      aria-selected={active}
      onClick={onClick}
      className={cn(moduleTabTriggerClass({ active, toneKey, size }), className)}
    >
      {active ? (
        <ModuleTabDot toneKey={toneKey} />
      ) : icon ? (
        <span className="shrink-0 opacity-70 [&_svg]:size-4 sm:[&_svg]:size-[18px]">
          {icon}
        </span>
      ) : null}
      <span>{label}</span>
      <ModuleTabBadge active={active}>{badge}</ModuleTabBadge>
      {showOpenBadge && active ? (
        <span className="rounded bg-white/25 px-1.5 py-0.5 text-[10px] font-black uppercase tracking-wider">
          Open
        </span>
      ) : null}
    </button>
  );
}
