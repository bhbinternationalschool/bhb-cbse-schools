"use client";

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
    idle: "bg-[rgba(32,48,80,0.1)] text-[var(--brand-deep)]",
    hover: "hover:bg-[rgba(32,48,80,0.16)]",
    active:
      "bg-[var(--brand-deep)] text-white shadow-[0_3px_12px_rgba(32,48,80,0.35)] ring-2 ring-[var(--brand-gold)] ring-offset-2",
    dot: "bg-[var(--brand-gold)]",
  },
  teal: {
    idle: "bg-[rgba(15,118,110,0.12)] text-[#0f766e]",
    hover: "hover:bg-[rgba(15,118,110,0.2)]",
    active:
      "bg-[#0f766e] text-white shadow-[0_3px_12px_rgba(15,118,110,0.35)] ring-2 ring-[#5eead4] ring-offset-2",
    dot: "bg-[#5eead4]",
  },
  slate: {
    idle: "bg-[rgba(71,85,105,0.12)] text-[#334155]",
    hover: "hover:bg-[rgba(71,85,105,0.2)]",
    active:
      "bg-[#334155] text-white shadow-[0_3px_12px_rgba(51,65,85,0.35)] ring-2 ring-[#94a3b8] ring-offset-2",
    dot: "bg-[#94a3b8]",
  },
  amber: {
    idle: "bg-[rgba(197,160,40,0.16)] text-[#8a6d12]",
    hover: "hover:bg-[rgba(197,160,40,0.26)]",
    active:
      "bg-[#b8860b] text-white shadow-[0_3px_12px_rgba(184,134,11,0.4)] ring-2 ring-[var(--brand-gold)] ring-offset-2",
    dot: "bg-[#fde68a]",
  },
  green: {
    idle: "bg-[rgba(22,163,74,0.12)] text-[#15803d]",
    hover: "hover:bg-[rgba(22,163,74,0.2)]",
    active:
      "bg-[#15803d] text-white shadow-[0_3px_12px_rgba(21,128,61,0.35)] ring-2 ring-[#86efac] ring-offset-2",
    dot: "bg-[#86efac]",
  },
  rose: {
    idle: "bg-[rgba(190,24,93,0.12)] text-[#9d174d]",
    hover: "hover:bg-[rgba(190,24,93,0.2)]",
    active:
      "bg-[#9d174d] text-white shadow-[0_3px_12px_rgba(157,23,77,0.35)] ring-2 ring-[#f9a8d4] ring-offset-2",
    dot: "bg-[#f9a8d4]",
  },
  violet: {
    idle: "bg-[rgba(109,40,217,0.12)] text-[#6d28d9]",
    hover: "hover:bg-[rgba(109,40,217,0.2)]",
    active:
      "bg-[#6d28d9] text-white shadow-[0_3px_12px_rgba(109,40,217,0.35)] ring-2 ring-[#c4b5fd] ring-offset-2",
    dot: "bg-[#c4b5fd]",
  },
  sky: {
    idle: "bg-[rgba(2,132,199,0.12)] text-[#0369a1]",
    hover: "hover:bg-[rgba(2,132,199,0.2)]",
    active:
      "bg-[#0284c7] text-white shadow-[0_3px_12px_rgba(2,132,199,0.35)] ring-2 ring-[#7dd3fc] ring-offset-2",
    dot: "bg-[#7dd3fc]",
  },
  coral: {
    idle: "bg-[rgba(234,88,12,0.12)] text-[#c2410c]",
    hover: "hover:bg-[rgba(234,88,12,0.2)]",
    active:
      "bg-[#ea580c] text-white shadow-[0_3px_12px_rgba(234,88,12,0.35)] ring-2 ring-[#fdba74] ring-offset-2",
    dot: "bg-[#fdba74]",
  },
};

export type ModuleTabItem = {
  id: string;
  label: ReactNode;
  tone?: ModuleTabTone;
  /** Optional badge / count next to label */
  badge?: ReactNode;
};

const SIZE_CLASS = {
  md: "px-3.5 py-2 text-[13px]",
  lg: "px-4 py-2.5 text-[15px]",
  xl: "px-5 py-3 text-base",
} as const;

/**
 * Bold, colourful module tabs — use across Students, Fees, Exams, Masters, etc.
 */
export function ModuleTabs({
  items,
  value,
  onChange,
  "aria-label": ariaLabel = "Sections",
  size = "lg",
  className = "",
  showOpenBadge = false,
}: {
  items: ModuleTabItem[];
  value: string;
  onChange: (id: string) => void;
  "aria-label"?: string;
  size?: keyof typeof SIZE_CLASS;
  className?: string;
  showOpenBadge?: boolean;
}) {
  return (
    <div
      className={`module-tabs mt-5 flex flex-wrap gap-2.5 rounded-2xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] p-3 ${className}`}
      role="tablist"
      aria-label={ariaLabel}
    >
      {items.map((t, i) => {
        const active = value === t.id;
        const toneKey =
          t.tone ??
          (["navy", "teal", "amber", "green", "sky", "violet", "coral", "rose"][
            i % 8
          ] as ModuleTabTone);
        const tone = MODULE_TAB_TONES[toneKey] ?? MODULE_TAB_TONES.navy;
        return (
          <button
            key={t.id}
            type="button"
            role="tab"
            aria-selected={active}
            onClick={() => onChange(t.id)}
            className={`relative inline-flex shrink-0 items-center gap-2 rounded-xl font-extrabold tracking-wide transition ${SIZE_CLASS[size]} ${
              active
                ? tone.active
                : `${tone.idle} ${tone.hover}`
            }`}
          >
            {active ? (
              <span
                className={`h-2.5 w-2.5 shrink-0 rounded-full ${tone.dot} ring-2 ring-white/50`}
                aria-hidden
              />
            ) : null}
            <span>{t.label}</span>
            {t.badge != null && t.badge !== "" ? (
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${
                  active ? "bg-white/25 text-white" : "bg-black/10"
                }`}
              >
                {t.badge}
              </span>
            ) : null}
            {showOpenBadge && active ? (
              <span className="rounded bg-white/25 px-1.5 py-0.5 text-[9px] font-black uppercase tracking-wider">
                Open
              </span>
            ) : null}
          </button>
        );
      })}
    </div>
  );
}

/** Single tab button for ad-hoc toolbars (Fee Take style). */
export function ModuleTabButton({
  active,
  onClick,
  children,
  tone = "navy",
  size = "lg",
}: {
  active: boolean;
  onClick: () => void;
  children: ReactNode;
  tone?: ModuleTabTone;
  size?: keyof typeof SIZE_CLASS;
}) {
  const t = MODULE_TAB_TONES[tone];
  return (
    <button
      type="button"
      onClick={onClick}
      className={`inline-flex items-center gap-1.5 rounded-xl font-extrabold tracking-wide transition ${SIZE_CLASS[size]} ${
        active ? t.active : `${t.idle} ${t.hover}`
      }`}
    >
      {active ? (
        <span
          className={`h-2 w-2 rounded-full ${t.dot} ring-2 ring-white/40`}
          aria-hidden
        />
      ) : null}
      {children}
    </button>
  );
}

export type ModuleTabGroup = {
  id: string;
  label: string;
  tone: ModuleTabTone;
  tabs: ModuleTabItem[];
};

/**
 * Related tabs grouped under labelled colour bands (Masters-style).
 * Top row = group switcher; second row = tabs inside the active group.
 */
export function ModuleTabGroups({
  groups,
  value,
  onChange,
  "aria-label": ariaLabel = "Sections",
  size = "lg",
  className = "",
}: {
  groups: ModuleTabGroup[];
  value: string;
  onChange: (id: string) => void;
  "aria-label"?: string;
  size?: keyof typeof SIZE_CLASS;
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
    <div className={`mt-5 space-y-3 ${className}`}>
      <div
        className="module-tabs flex flex-wrap gap-2.5 rounded-2xl border border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] p-3"
        role="tablist"
        aria-label={`${ariaLabel} groups`}
      >
        {groups.map((g) => {
          const on = activeGroup.id === g.id;
          const tone = MODULE_TAB_TONES[g.tone];
          return (
            <button
              key={g.id}
              type="button"
              role="tab"
              aria-selected={on}
              onClick={() => selectGroup(g.id)}
              className={`inline-flex items-center gap-2 rounded-xl px-5 py-3 text-base font-extrabold tracking-wide transition ${
                on ? tone.active : `${tone.idle} ${tone.hover}`
              }`}
            >
              {on ? (
                <span
                  className={`h-2.5 w-2.5 rounded-full ${tone.dot} ring-2 ring-white/50`}
                  aria-hidden
                />
              ) : null}
              {g.label}
              <span
                className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${
                  on ? "bg-white/25" : "bg-black/10"
                }`}
              >
                {g.tabs.length}
              </span>
            </button>
          );
        })}
      </div>

      <div
        className="module-tabs flex flex-wrap gap-2 rounded-2xl border border-[rgba(32,48,80,0.08)] bg-white p-3 shadow-[inset_0_1px_0_rgba(255,255,255,0.8)]"
        role="tablist"
        aria-label={`${activeGroup.label} tabs`}
      >
        <span className="mr-1 self-center text-[11px] font-black uppercase tracking-wider text-[var(--muted)]">
          {activeGroup.label}
        </span>
        {activeGroup.tabs.map((t, i) => {
          const active = value === t.id;
          const toneKey = t.tone ?? activeGroup.tone;
          const tone = MODULE_TAB_TONES[toneKey] ?? MODULE_TAB_TONES.navy;
          return (
            <button
              key={t.id}
              type="button"
              role="tab"
              aria-selected={active}
              onClick={() => onChange(t.id)}
              className={`relative inline-flex shrink-0 items-center gap-2 rounded-xl font-extrabold tracking-wide transition ${SIZE_CLASS[size]} ${
                active ? tone.active : `${tone.idle} ${tone.hover}`
              }`}
            >
              {active ? (
                <span
                  className={`h-2 w-2 shrink-0 rounded-full ${tone.dot} ring-2 ring-white/50`}
                  aria-hidden
                />
              ) : null}
              <span>{t.label}</span>
              {t.badge != null && t.badge !== "" ? (
                <span
                  className={`rounded-md px-1.5 py-0.5 text-[10px] font-black ${
                    active ? "bg-white/25 text-white" : "bg-black/10"
                  }`}
                >
                  {t.badge}
                </span>
              ) : null}
            </button>
          );
        })}
      </div>
    </div>
  );
}
