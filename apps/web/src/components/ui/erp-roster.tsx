"use client";

import Link from "next/link";
import type { ReactNode } from "react";
import { cn } from "@/lib/utils";

export type ErpMetricTone = "green" | "rose" | "sky" | "violet" | "amber" | "navy";

// "title" is the same accent blue across every tone — it equals --chart-1,
// so route it through the token rather than a repeated literal. The icon
// colors below are a genuine categorical tone system (unrelated to
// danger/success semantics), so they're left as-is.
const METRIC_TITLE_CLASS = "text-[var(--chart-1)]";
const METRIC_TONES: Record<
  ErpMetricTone,
  { title: string; icon: string }
> = {
  green: { title: METRIC_TITLE_CLASS, icon: "bg-[#dcfce7] text-[#15803d]" },
  rose: { title: METRIC_TITLE_CLASS, icon: "bg-[#fee2e2] text-[#b91c1c]" },
  sky: { title: METRIC_TITLE_CLASS, icon: "bg-[#dbeafe] text-[#1d4ed8]" },
  violet: { title: METRIC_TITLE_CLASS, icon: "bg-[#ede9fe] text-[#6d28d9]" },
  amber: { title: METRIC_TITLE_CLASS, icon: "bg-[#fef3c7] text-[#b45309]" },
  navy: { title: METRIC_TITLE_CLASS, icon: "bg-[rgba(32,48,80,0.1)] text-[var(--brand-deep)]" },
};

/** KPI card with icon circle — staff roster style. Pass `href` to navigate
 * (renders as a Link) or `onClick` for in-page behavior (e.g. a drill-down
 * drawer); `href` takes priority when both are given. */
export function ErpMetricCard({
  title,
  value,
  tone = "sky",
  icon,
  hint,
  footer,
  href,
  onClick,
  className,
}: {
  title: string;
  value: string | number;
  tone?: ErpMetricTone;
  icon?: ReactNode;
  hint?: string;
  footer?: ReactNode;
  href?: string;
  onClick?: () => void;
  className?: string;
}) {
  const t = METRIC_TONES[tone];
  const interactive = !!href || !!onClick;

  const cardClassName = cn(
    "erp-metric-card flex w-full items-center justify-between gap-3 rounded-2xl border border-[rgba(32,48,80,0.1)] bg-white px-5 py-4 text-left shadow-sm transition",
    interactive &&
      "hover:-translate-y-0.5 hover:shadow-md focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-[var(--brand-gold)] focus-visible:ring-offset-2",
    className,
  );

  const content = (
    <>
      <div className="min-w-0">
        <div className={cn("text-sm font-semibold", t.title)}>{title}</div>
        <div className="mt-1 text-3xl font-bold tabular-nums text-[#0f172a]">
          {value}
        </div>
        {hint ? (
          <p className="mt-1 text-xs text-muted-foreground">{hint}</p>
        ) : null}
        {footer}
      </div>
      {icon ? (
        <span
          className={cn(
            "inline-flex h-14 w-14 shrink-0 items-center justify-center rounded-full",
            t.icon,
          )}
        >
          {icon}
        </span>
      ) : null}
    </>
  );

  if (href) {
    return (
      <Link href={href} className={cardClassName}>
        {content}
      </Link>
    );
  }

  const Comp = onClick ? "button" : "div";
  return (
    <Comp type={onClick ? "button" : undefined} onClick={onClick} className={cardClassName}>
      {content}
    </Comp>
  );
}

export function ErpMetricGrid({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-3 sm:grid-cols-2 xl:grid-cols-4",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** Chart / analytics panel — blue title */
export function ErpChartCard({
  title,
  children,
  className,
}: {
  title: string;
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "erp-panel rounded-2xl border border-[rgba(32,48,80,0.1)] bg-white p-4 shadow-sm",
        className,
      )}
    >
      <h2 className="text-base font-semibold text-[var(--chart-1)]">{title}</h2>
      <div className="mt-3">{children}</div>
    </div>
  );
}

export function ErpChartGrid({
  children,
  cols = 3,
  className,
}: {
  children: ReactNode;
  cols?: 2 | 3;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "grid gap-4",
        cols === 3 ? "lg:grid-cols-3" : "lg:grid-cols-2",
        className,
      )}
    >
      {children}
    </div>
  );
}

/** White content panel */
export function ErpPanel({
  title,
  description,
  children,
  className,
  id,
}: {
  title?: string;
  description?: string;
  children: ReactNode;
  className?: string;
  id?: string;
}) {
  return (
    <div
      id={id}
      className={cn(
        "erp-panel rounded-2xl border border-[rgba(32,48,80,0.1)] bg-white p-4 shadow-sm sm:p-5",
        className,
      )}
    >
      {title ? (
        <div className="mb-3">
          <h2 className="text-sm font-bold text-[var(--brand-deep)]">{title}</h2>
          {description ? (
            <p className="mt-1 text-xs text-muted-foreground">{description}</p>
          ) : null}
        </div>
      ) : null}
      {children}
    </div>
  );
}

/** Toolbar action button with blue icon */
export function ErpToolbarBtn({
  icon,
  label,
  onClick,
  href,
  className,
}: {
  icon: ReactNode;
  label: string;
  onClick?: () => void;
  href?: string;
  className?: string;
}) {
  const cls = cn(
    "inline-flex items-center gap-2 rounded-xl border border-[rgba(32,48,80,0.12)] bg-white px-3.5 py-2 text-sm font-semibold text-[var(--brand-deep)] shadow-sm transition hover:border-[rgba(37,99,235,0.35)] hover:bg-[#eff6ff]",
    className,
  );
  if (href) {
    return (
      <a href={href} className={cls}>
        <span className="text-[var(--chart-1)]">{icon}</span>
        {label}
      </a>
    );
  }
  return (
    <button type="button" onClick={onClick} className={cls}>
      <span className="text-[var(--chart-1)]">{icon}</span>
      {label}
    </button>
  );
}

export function ErpToolbar({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div className={cn("flex flex-wrap justify-end gap-2", className)}>
      {children}
    </div>
  );
}

/** Table shell — roster list style */
export function ErpTableShell({
  children,
  className,
}: {
  children: ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "erp-table-shell overflow-hidden rounded-2xl border border-[rgba(32,48,80,0.12)] bg-white shadow-sm",
        className,
      )}
    >
      {children}
    </div>
  );
}

export function ErpTable({
  children,
  className,
  minWidth = "min-w-[720px]",
}: {
  children: ReactNode;
  className?: string;
  minWidth?: string;
}) {
  return (
    <table
      className={cn("w-full text-left text-sm", minWidth, className)}
    >
      {children}
    </table>
  );
}

export function ErpTableHead({ children }: { children: ReactNode }) {
  return (
    <thead className="border-b border-[rgba(32,48,80,0.1)] bg-[rgba(32,48,80,0.03)] text-[11px] uppercase tracking-wide text-muted-foreground">
      {children}
    </thead>
  );
}

export function ErpTableBody({ children }: { children: ReactNode }) {
  return (
    <tbody className="divide-y divide-[rgba(32,48,80,0.08)]">{children}</tbody>
  );
}

export function ErpStatusBadge({
  active,
  activeLabel = "Active",
  inactiveLabel = "Inactive",
}: {
  active: boolean;
  activeLabel?: string;
  inactiveLabel?: string;
}) {
  return (
    <span
      className={cn(
        "rounded-md px-2 py-0.5 text-[10px] font-black uppercase",
        active
          ? "bg-[rgba(21,128,61,0.12)] text-[var(--success)]"
          : "bg-[rgba(32,48,80,0.08)] text-muted-foreground",
      )}
    >
      {active ? activeLabel : inactiveLabel}
    </span>
  );
}

export function ErpModuleHeader({
  title,
  subtitle,
  icon,
  actions,
  notice,
}: {
  title: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  notice?: ReactNode;
}) {
  return (
    <div className="flex flex-wrap items-end justify-between gap-3">
      <div>
        <h1 className="flex items-center gap-2 text-2xl font-semibold text-[var(--brand-deep)]">
          {icon ? <span className="text-[var(--chart-1)]">{icon}</span> : null}
          {title}
        </h1>
        {subtitle ? (
          <p className="mt-1 text-sm text-muted-foreground">{subtitle}</p>
        ) : null}
      </div>
      <div className="flex flex-wrap items-center gap-2">
        {notice}
        {actions}
      </div>
    </div>
  );
}

export function ErpNoticePill({ children }: { children: ReactNode }) {
  return (
    <span className="rounded-lg bg-[rgba(197,160,40,0.18)] px-3 py-1.5 text-xs font-medium text-[var(--brand-deep)]">
      {children}
    </span>
  );
}
