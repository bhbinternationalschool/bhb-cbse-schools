"use client";

import type { ReactNode } from "react";
import {
  ErpPanel,
  ErpTableShell,
} from "@/components/ui/erp-roster";

/** Data table card — roster style */
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
    <ErpTableShell className={className}>
      <div className="border-b border-[var(--border)] px-4 py-3 text-sm font-semibold text-[#2563eb]">
        {title}
      </div>
      <div className={`${maxHeight} overflow-auto`}>{children}</div>
    </ErpTableShell>
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

/** Working form / actions — roster panel */
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
    <ErpPanel title={title} description={hint}>
      {children}
    </ErpPanel>
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
  work?: ReactNode;
}) {
  return (
    <div className="space-y-4">
      {intro ? <div className="text-sm text-muted-foreground">{intro}</div> : null}
      {tables}
      {work}
    </div>
  );
}

export function MastersEmptyRow({
  children,
  label,
  colSpan = 99,
}: {
  children?: ReactNode;
  /** @deprecated use children */
  label?: string;
  colSpan?: number;
}) {
  const content = children ?? label ?? "No records yet.";
  return (
    <tr>
      <td
        colSpan={colSpan}
        className="px-4 py-10 text-center text-sm text-muted-foreground"
      >
        {content}
      </td>
    </tr>
  );
}
