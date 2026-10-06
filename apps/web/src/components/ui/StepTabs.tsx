"use client";

import type { ReactNode } from "react";
import { ModuleTabs, type ModuleTabTone } from "@/components/ui/ModuleTabs";

/**
 * Work done in an order: each step needs the one before it (a policy before
 * the schemes that inherit it, leave types before the approval flow, the day
 * book before the cash count). One step shows at a time, numbered, with a
 * line saying what it is for and Back / Next.
 *
 * Two shapes:
 *  - <StepTabs>  — sub-tabs inside one tab (Exams → Exams & policy).
 *  - <StepGuide> — the guide card alone, for an order that runs across a
 *    module's existing top-level tabs (Masters → Fee setup).
 *
 * Layout only: steps never gate each other. A step that is not ready yet
 * says so in its own panel; the order is advice, not a lock.
 */

export type StepDef<T extends string = string> = {
  id: T;
  title: string;
  /** One line: what this step is for, in the office's words. */
  what: string;
  /** A count worth seeing from the tab (schemes, exams, rules…). */
  badge?: number | string;
};

const STEP_TONES: ModuleTabTone[] = ["navy", "violet", "sky", "amber", "teal", "green", "rose", "slate"];

export function StepGuide<T extends string>({
  steps,
  value,
  onChange,
  label,
  className = "",
}: {
  steps: StepDef<T>[];
  value: T;
  onChange: (id: T) => void;
  /** Names the whole flow ("Fee setup") when the guide sits over plain tabs. */
  label?: string;
  className?: string;
}) {
  const i = Math.max(0, steps.findIndex((s) => s.id === value));
  const cur = steps[i];
  if (!cur) return null;
  const prev = steps[i - 1];
  const next = steps[i + 1];
  return (
    <div
      className={`flex flex-wrap items-start justify-between gap-3 rounded-xl border border-[var(--border)] bg-[var(--card)] px-4 py-3 ${className}`}
    >
      <div className="min-w-0 flex-1">
        <p className="text-[11px] font-semibold uppercase tracking-wide text-[var(--muted)]">
          {label ? `${label} · ` : ""}Step {i + 1} of {steps.length}
        </p>
        <p className="text-sm font-bold text-[var(--brand-deep)]">{cur.title}</p>
        <p className="mt-0.5 text-xs text-[var(--muted)]">{cur.what}</p>
      </div>
      <div className="flex shrink-0 gap-2">
        {prev ? (
          <button
            type="button"
            className="rounded-lg border border-[var(--border)] px-3 py-1.5 text-xs font-semibold text-[var(--brand-deep)]"
            onClick={() => onChange(prev.id)}
          >
            ← {prev.title}
          </button>
        ) : null}
        {next ? (
          <button
            type="button"
            className="btn-accent rounded-lg px-3 py-1.5 text-xs font-semibold"
            onClick={() => onChange(next.id)}
          >
            Next: {next.title} →
          </button>
        ) : null}
      </div>
    </div>
  );
}

export function StepTabs<T extends string>({
  steps,
  value,
  onChange,
  "aria-label": ariaLabel,
  children,
  className = "",
}: {
  steps: StepDef<T>[];
  value: T;
  onChange: (id: T) => void;
  "aria-label": string;
  /** The current step's content. */
  children?: ReactNode;
  className?: string;
}) {
  return (
    <div className={`space-y-4 ${className}`}>
      <ModuleTabs
        aria-label={ariaLabel}
        size="md"
        value={value}
        onChange={(id) => onChange(id as T)}
        items={steps.map((st, i) => ({
          id: st.id,
          label: `${i + 1} · ${st.title}`,
          tone: STEP_TONES[i % STEP_TONES.length],
          badge: st.badge,
        }))}
      />
      <StepGuide steps={steps} value={value} onChange={onChange} />
      {children}
    </div>
  );
}
