import type { Metadata } from "next";
import { generatedAtIst } from "@bhb/time";
import { SchoolHomeDashboard } from "@/components/dashboard/SchoolHomeDashboard";

export const metadata: Metadata = { title: "Home" };

export default function HomePage() {
  return (
    <div>
      <SchoolHomeDashboard />
      <p className="mt-10 text-xs text-[var(--muted)]" suppressHydrationWarning>
        {generatedAtIst()}
      </p>
    </div>
  );
}
