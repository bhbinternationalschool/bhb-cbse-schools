import type { Metadata } from "next";
import { Suspense } from "react";
import { generatedAtIst } from "@bhb/time";
import { SchoolHomeDashboard } from "@/components/dashboard/SchoolHomeDashboard";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return (
    <div>
      <Suspense
        fallback={
          <p className="text-base text-[var(--muted)]">Loading school dashboard…</p>
        }
      >
        <SchoolHomeDashboard />
      </Suspense>
      <p className="mt-10 text-xs text-[var(--muted)]" suppressHydrationWarning>
        {generatedAtIst()}
      </p>
    </div>
  );
}
