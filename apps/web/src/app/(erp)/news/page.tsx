import type { Metadata } from "next";
import { Suspense } from "react";
import { CommsWorkspace } from "@/components/comms/CommsWorkspace";

export const metadata: Metadata = { title: "News" };

export default function NewsPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
      <CommsWorkspace />
    </Suspense>
  );
}
