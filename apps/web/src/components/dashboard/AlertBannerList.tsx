"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight } from "lucide-react";

export type DashboardAlert = { text: string; href: string };

/** Shared red alert-strip visual used by PrincipalCockpit and owner-only dashboard alerts. */
export function AlertBannerList({ alerts }: { alerts: DashboardAlert[] }) {
  if (alerts.length === 0) return null;
  return (
    <div className="space-y-2">
      {alerts.map((a) => (
        <Link
          key={a.text}
          href={a.href}
          className="flex items-center gap-2 rounded-xl border border-[var(--danger)]/20 bg-[var(--danger-soft)] px-4 py-3 text-sm font-medium text-[var(--brand-deep)]"
        >
          <AlertTriangle className="h-4 w-4 shrink-0 text-[var(--danger)]" />
          {a.text}
          <ArrowRight className="ml-auto h-4 w-4 opacity-50" />
        </Link>
      ))}
    </div>
  );
}
