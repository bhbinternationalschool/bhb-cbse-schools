import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ErpModuleGate } from "@/components/shell/ErpModuleGate";
import { SkeletonModulePage } from "@/components/ui/skeleton";
import { getDemoSession } from "@/lib/auth";
import { pwaManifestHref } from "@/lib/pwaApps";
import { TENANT } from "@/lib/types";

export const metadata: Metadata = {
  title: "Staff ERP",
  description: "BHB International School ERP — teachers, principal, admin.",
  applicationName: "BHB Staff",
  manifest: pwaManifestHref("staff"),
  appleWebApp: {
    capable: true,
    title: "BHB Staff",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: TENANT.primaryColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

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
    <div className="bhb-pwa-staff min-h-dvh">
      <AppShell session={session}>
        <Suspense fallback={<SkeletonModulePage />}>
          <ErpModuleGate>
            <div className="erp-module-root">{children}</div>
          </ErpModuleGate>
        </Suspense>
      </AppShell>
    </div>
  );
}
