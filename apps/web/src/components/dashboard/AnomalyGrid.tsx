"use client";

import Link from "next/link";
import { AlertTriangle, ArrowRight, Info } from "lucide-react";

export type AnomalyTone = "danger" | "warning" | "info";

export type AnomalyItem = {
  id: string;
  tone: AnomalyTone;
  title: string;
  detail: string;
  href: string;
};

const TONE_ICON: Record<AnomalyTone, typeof AlertTriangle> = {
  danger: AlertTriangle,
  warning: AlertTriangle,
  info: Info,
};

/** Owner-dashboard "active anomalies" grid. Renders nothing for an empty
 * list — callers are responsible for filtering out zero-count items before
 * passing them in, so "no anomalies" is never shown as a styled empty card. */
export function AnomalyGrid({ items }: { items: AnomalyItem[] }) {
  if (items.length === 0) return null;
  return (
    <div className="grid grid-cols-1 gap-3 sm:grid-cols-2 lg:grid-cols-3">
      {items.map((item) => {
        const Icon = TONE_ICON[item.tone];
        return (
          <Link
            key={item.id}
            href={item.href}
            className="flex items-start gap-3 rounded-xl border p-4 transition-colors"
            style={{
              borderColor: `color-mix(in srgb, var(--${item.tone}) 25%, transparent)`,
              backgroundColor: `var(--${item.tone}-soft)`,
            }}
          >
            <Icon
              className="mt-0.5 h-4 w-4 shrink-0"
              style={{ color: `var(--${item.tone})` }}
            />
            <div className="min-w-0 flex-1">
              <div
                className="text-sm font-semibold"
                style={{ color: `var(--${item.tone})` }}
              >
                {item.title}
              </div>
              <div className="mt-0.5 text-xs text-[var(--muted)]">
                {item.detail}
              </div>
            </div>
            <ArrowRight className="mt-0.5 h-4 w-4 shrink-0 opacity-50" />
          </Link>
        );
      })}
    </div>
  );
}
