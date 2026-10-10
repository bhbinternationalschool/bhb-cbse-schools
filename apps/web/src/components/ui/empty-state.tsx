import type { LucideIcon } from "lucide-react";
import { InboxIcon } from "lucide-react";

import { cn } from "@/lib/utils";

type EmptyStateVariant = "panel" | "table" | "page";

const VARIANT_CLASS: Record<EmptyStateVariant, string> = {
  panel: "erp-surface py-10",
  table: "border-none bg-transparent py-14",
  page: "border-none bg-transparent py-20",
};

/**
 * Shared "nothing here yet" panel — replaces the ad-hoc empty-state strings
 * scattered per module (no consistent icon, spacing, or action slot).
 * `variant` picks the surrounding chrome: `panel` (default, a bordered
 * card — the original look), `table` for inside an ErpTableShell/empty
 * rows, `page` for a full route with nothing to show.
 */
export function EmptyState({
  icon: Icon = InboxIcon,
  title,
  description,
  action,
  variant = "panel",
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  variant?: EmptyStateVariant;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "flex flex-col items-center gap-2 text-center",
        VARIANT_CLASS[variant],
        className
      )}
    >
      <span className="flex size-14 items-center justify-center rounded-full bg-[var(--surface-sunken)]">
        <Icon className="size-6 text-[var(--muted)]" aria-hidden="true" />
      </span>
      <p className="mt-1 text-sm font-semibold text-[var(--brand-deep)]">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-[var(--muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
