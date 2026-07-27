import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ErpModuleGate } from "@/components/shell/ErpModuleGate";
import { getDemoSession } from "@/lib/auth";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getDemoSession();
  if (!session) redirect("/login");
  if (session.persona === "parent") redirect("/parent");
  if (session.persona === "field") redirect("/field");
  return (
    <AppShell session={session}>
      <Suspense
        fallback={
          <div className="p-6 text-sm text-[var(--muted)]">Loading…</div>
        }
      >
        <ErpModuleGate>{children}</ErpModuleGate>
      </Suspense>
    </AppShell>
  );
}
