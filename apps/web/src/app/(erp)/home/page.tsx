import type { Metadata } from "next";
import { formatIst, generatedAtIst } from "@bhb/time";
import { getDemoSession } from "@/lib/auth";
import { HomeHubList } from "@/components/shell/HomeHubList";
import { ACADEMIC_YEARS, TENANT } from "@/lib/types";

export const metadata: Metadata = { title: "Home" };

export default async function HomePage() {
  const session = await getDemoSession();
  const ay = ACADEMIC_YEARS.find((y) => y.code === session?.academicYearCode);

  return (
    <div>
      <p className="text-sm text-[var(--muted)]">
        Welcome, {session?.fullName} · {session?.roleCode}
      </p>
      <h1 className="mt-1 text-2xl font-semibold text-[var(--brand-deep)]">
        Combined home
      </h1>
      <p className="mt-2 max-w-xl text-sm text-[var(--muted)]">
        {TENANT.name} · Session {ay?.label ?? "—"}
        {ay?.status === "closed" ? " (read-only)" : ""} · {formatIst()}
      </p>
      <p className="font-tagline mt-1 text-sm">{TENANT.tagline}</p>

      <HomeHubList />

      <p className="mt-10 text-xs text-[var(--muted)]">{generatedAtIst()}</p>
    </div>
  );
}
