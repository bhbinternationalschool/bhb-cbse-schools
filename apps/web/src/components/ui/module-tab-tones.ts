import type { ReactNode } from "react";

export type ModuleTabTone =
  | "navy"
  | "teal"
  | "slate"
  | "amber"
  | "green"
  | "rose"
  | "violet"
  | "sky"
  | "coral";

export const MODULE_TAB_TONES: Record<
  ModuleTabTone,
  { idle: string; hover: string; active: string; dot: string }
> = {
  navy: {
    idle: "bg-[rgba(32,48,80,0.1)] text-[var(--brand-deep)] dark:bg-[rgba(228,234,247,0.12)]",
    hover: "hover:bg-[rgba(32,48,80,0.16)]",
    active:
      "bg-[var(--brand-deep)] text-white shadow-[0_3px_12px_rgba(32,48,80,0.35)] ring-2 ring-[var(--brand-gold)] ring-offset-2 ring-offset-[var(--surface)]",
    dot: "bg-[var(--brand-gold)]",
  },
  teal: {
    idle: "bg-[rgba(15,118,110,0.12)] text-[#0f766e] dark:text-[#5eead4]",
    hover: "hover:bg-[rgba(15,118,110,0.2)]",
    active:
      "bg-[#0f766e] text-white shadow-[0_3px_12px_rgba(15,118,110,0.35)] ring-2 ring-[#5eead4] ring-offset-2 ring-offset-[var(--surface)]",
    dot: "bg-[#5eead4]",
  },
  slate: {
    idle: "bg-[rgba(71,85,105,0.12)] text-[#334155] dark:text-[#94a3b8]",
    hover: "hover:bg-[rgba(71,85,105,0.2)]",
    active:
      "bg-[#334155] text-white shadow-[0_3px_12px_rgba(51,65,85,0.35)] ring-2 ring-[#94a3b8] ring-offset-2 ring-offset-[var(--surface)]",
    dot: "bg-[#94a3b8]",
  },
  amber: {
    idle: "bg-[rgba(197,160,40,0.16)] text-[#8a6d12] dark:text-[#fde68a]",
    hover: "hover:bg-[rgba(197,160,40,0.26)]",
    active:
      "bg-[#b8860b] text-white shadow-[0_3px_12px_rgba(184,134,11,0.4)] ring-2 ring-[var(--brand-gold)] ring-offset-2 ring-offset-[var(--surface)]",
    dot: "bg-[#fde68a]",
  },
  green: {
    idle: "bg-[rgba(22,163,74,0.12)] text-[#15803d] dark:text-[#86efac]",
    hover: "hover:bg-[rgba(22,163,74,0.2)]",
    active:
      "bg-[#15803d] text-white shadow-[0_3px_12px_rgba(21,128,61,0.35)] ring-2 ring-[#86efac] ring-offset-2 ring-offset-[var(--surface)]",
    dot: "bg-[#86efac]",
  },
  rose: {
    idle: "bg-[rgba(190,24,93,0.12)] text-[#9d174d] dark:text-[#f9a8d4]",
    hover: "hover:bg-[rgba(190,24,93,0.2)]",
    active:
      "bg-[#9d174d] text-white shadow-[0_3px_12px_rgba(157,23,77,0.35)] ring-2 ring-[#f9a8d4] ring-offset-2 ring-offset-[var(--surface)]",
    dot: "bg-[#f9a8d4]",
  },
  violet: {
    idle: "bg-[rgba(109,40,217,0.12)] text-[#6d28d9] dark:text-[#c4b5fd]",
    hover: "hover:bg-[rgba(109,40,217,0.2)]",
    active:
      "bg-[#6d28d9] text-white shadow-[0_3px_12px_rgba(109,40,217,0.35)] ring-2 ring-[#c4b5fd] ring-offset-2 ring-offset-[var(--surface)]",
    dot: "bg-[#c4b5fd]",
  },
  sky: {
    idle: "bg-[rgba(2,132,199,0.12)] text-[#0369a1] dark:text-[#7dd3fc]",
    hover: "hover:bg-[rgba(2,132,199,0.2)]",
    active:
      "bg-[#0284c7] text-white shadow-[0_3px_12px_rgba(2,132,199,0.35)] ring-2 ring-[#7dd3fc] ring-offset-2 ring-offset-[var(--surface)]",
    dot: "bg-[#7dd3fc]",
  },
  coral: {
    idle: "bg-[rgba(234,88,12,0.12)] text-[#c2410c] dark:text-[#fdba74]",
    hover: "hover:bg-[rgba(234,88,12,0.2)]",
    active:
      "bg-[#ea580c] text-white shadow-[0_3px_12px_rgba(234,88,12,0.35)] ring-2 ring-[#fdba74] ring-offset-2 ring-offset-[var(--surface)]",
    dot: "bg-[#fdba74]",
  },
};

export type ModuleTabItem = {
  id: string;
  label: ReactNode;
  tone?: ModuleTabTone;
  badge?: ReactNode;
  icon?: ReactNode;
};

export type ModuleTabGroup = {
  id: string;
  label: string;
  tone: ModuleTabTone;
  tabs: ModuleTabItem[];
};
