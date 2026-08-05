"use client";

import type { ReactNode } from "react";
import { ErpModuleHeader, ErpNoticePill } from "@/components/ui/erp-roster";
import { ErpAlerts } from "@/components/ui/erp-alerts";
import { cn } from "@/lib/utils";

/** Module header + alerts — page container lives on `(erp)/layout` `.erp-module-root` */
export function ErpWorkspaceShell({
  title,
  subtitle,
  icon,
  actions,
  notice,
  error,
  toolbar,
  children,
  className,
  embedded = false,
}: {
  title?: ReactNode;
  subtitle?: ReactNode;
  icon?: ReactNode;
  actions?: ReactNode;
  notice?: string | null;
  error?: string | null;
  toolbar?: ReactNode;
  children: ReactNode;
  className?: string;
  embedded?: boolean;
}) {
  return (
    <div className={cn(embedded ? "space-y-4 pb-4" : "space-y-5", className)}>
      {!embedded && title ? (
        <ErpModuleHeader
          title={title}
          subtitle={subtitle}
          icon={icon}
          actions={actions}
          notice={notice ? <ErpNoticePill>{notice}</ErpNoticePill> : null}
        />
      ) : embedded && subtitle ? (
        <p className="text-sm text-muted-foreground">{subtitle}</p>
      ) : null}

      <ErpAlerts error={error} notice={embedded ? notice : null} />

      {toolbar}
      {children}
    </div>
  );
}
