"use client";

import type { ReactNode } from "react";
import { Construction } from "lucide-react";
import { ErpWorkspaceShell } from "@/components/ui/erp-workspace-shell";

/** Honest status page for a Tier B module that's on the roadmap but not
 * built yet — visible via Settings → Modules, not the main nav hub.
 * `icon` takes a rendered element (e.g. `<Building2 .../>`), matching
 * ErpWorkspaceShell's own icon prop — a bare component reference can't
 * cross the server/client boundary from a page.tsx server component. */
export function ComingSoonPage({
  title,
  blurb,
  icon,
}: {
  title: string;
  blurb: string;
  icon?: ReactNode;
}) {
  return (
    <ErpWorkspaceShell
      title={title}
      subtitle={blurb}
      icon={icon ?? <Construction className="size-6" aria-hidden />}
    >
      <div className="mt-5 rounded-xl border border-[var(--border)] bg-[var(--card)] px-6 py-10 text-center">
        <Construction className="mx-auto size-8 text-[var(--muted)]" aria-hidden />
        <p className="mt-3 text-sm font-bold">On the roadmap</p>
        <p className="mx-auto mt-1 max-w-md text-sm text-[var(--muted)]">
          This module is planned but not built yet. It&apos;s enabled in
          Settings → Modules so you can see it&apos;s coming, and toggled
          visible to the main navigation once it ships.
        </p>
      </div>
    </ErpWorkspaceShell>
  );
}
