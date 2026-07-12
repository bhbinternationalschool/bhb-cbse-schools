"use client";

import type { ReactNode } from "react";

/** Data table card — use in a side-by-side row above the work panel. */
export function MastersTableCard({
  title,
  children,
  className = "",
  maxHeight = "max-h-[min(52vh,420px)]",
}: {
  title: string;
  children: ReactNode;
  className?: string;
  maxHeight?: string;
}) {
  return (
    <div
      className={`overflow-hidden rounded-xl border border-[rgba(32,48,80,0.12)] bg-white ${className}`}
    >
      <div className="border-b border-[rgba(32,48,80,0.08)] px-4 py-3 text-sm font-semibold text-[var(--brand-deep)]">
        {title}
      </div>
      <div className={`${maxHeight} overflow-auto`}>{children}</div>
    </div>
  );
}

/** Side-by-side tables row (1 col mobile, 2+ on large screens). */
export function MastersTablesRow({
  children,
  cols = 2,
}: {
  children: ReactNode;
  cols?: 1 | 2 | 3;
}) {
  const colClass =
    cols === 1
      ? "grid-cols-1"
      : cols === 3
        ? "lg:grid-cols-3"
        : "lg:grid-cols-2";
  return <div className={`grid gap-4 ${colClass}`}>{children}</div>;
}

/** Working form / actions — always below the tables. */
export function MastersWorkCard({
  title,
  children,
  hint,
}: {
  title: string;
  children: ReactNode;
  hint?: string;
}) {
  return (
    <div className="rounded-xl border border-[rgba(32,48,80,0.12)] bg-white p-4">
      <h3 className="text-sm font-semibold text-[var(--brand-deep)]">{title}</h3>
      {hint ? (
        <p className="mt-0.5 text-[11px] text-[var(--muted)]">{hint}</p>
      ) : null}
      <div className="mt-3">{children}</div>
    </div>
  );
}

/** Standard Masters tab stack: tables on top, work below. */
export function MastersTabStack({
  intro,
  tables,
  work,
}: {
  intro?: ReactNode;
  tables: ReactNode;
  work: ReactNode;
}) {
  return (
    <div className="space-y-4">
      {intro ? <div className="text-sm text-[var(--muted)]">{intro}</div> : null}
      {tables}
      {work}
    </div>
  );
}

export function MastersEmptyRow({ label = "No rows yet" }: { label?: string }) {
  return (
    <p className="px-4 py-6 text-center text-sm text-[var(--muted)]">{label}</p>
  );
}
