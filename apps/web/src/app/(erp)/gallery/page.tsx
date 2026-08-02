import type { Metadata } from "next";
import { Suspense } from "react";
import { CommsWorkspace } from "@/components/comms/CommsWorkspace";

export const metadata: Metadata = { title: "Gallery" };

export default function GalleryPage() {
  return (
    <Suspense fallback={<p className="text-sm text-[var(--muted)]">Loading…</p>}>
      <CommsWorkspace />
    </Suspense>
  );
}
