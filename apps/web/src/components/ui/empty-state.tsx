import type { LucideIcon } from "lucide-react";
import { InboxIcon } from "lucide-react";

import { cn } from "@/lib/utils";

/**
 * Shared "nothing here yet" panel — replaces the ad-hoc empty-state strings
 * scattered per module (no consistent icon, spacing, or action slot).
 */
export function EmptyState({
  icon: Icon = InboxIcon,
  title,
  description,
  action,
  className,
}: {
  icon?: LucideIcon;
  title: string;
  description?: string;
  action?: React.ReactNode;
  className?: string;
}) {
  return (
    <div
      className={cn(
        "erp-surface flex flex-col items-center gap-2 py-10 text-center",
        className
      )}
    >
      <Icon className="size-8 text-[var(--muted)]" aria-hidden="true" />
      <p className="text-sm font-semibold text-[var(--brand-deep)]">{title}</p>
      {description ? (
        <p className="max-w-sm text-sm text-[var(--muted)]">{description}</p>
      ) : null}
      {action ? <div className="mt-2">{action}</div> : null}
    </div>
  );
}
