import type { Metadata, Viewport } from "next";
import { redirect } from "next/navigation";
import { Suspense } from "react";
import { AppShell } from "@/components/shell/AppShell";
import { ErpModuleGate } from "@/components/shell/ErpModuleGate";
import { SkeletonModulePage } from "@/components/ui/skeleton";
import { getDemoSession } from "@/lib/auth";
import {
  loadServerMasters,
  loadServerRbacIfKnown,
  revalidateStaffSession,
} from "@/lib/api/v1/auth";
import { ApiError } from "@/lib/api/v1/errors";
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
  const cookieSession = await getDemoSession();
  if (!cookieSession) redirect("/login");
  if (cookieSession.persona === "parent") redirect("/parent");
  if (cookieSession.persona === "field") redirect("/field");
  // The screens decide menus and pages from this session's role, so give
  // them the role their assignment (else the roster) says TODAY — same
  // re-check as every v1 API call — not the one frozen into the cookie.
  let session = cookieSession;
  try {
    const [masters, rbac] = await Promise.all([
      loadServerMasters(),
      loadServerRbacIfKnown(),
    ]);
    session = revalidateStaffSession(cookieSession, masters, rbac);
  } catch (e) {
    // The roster could not be read (503): nothing is decided, the cookie
    // stands — exactly as when the roster is unknown. Only a real verdict
    // (an inactive staff record, 401) signs the person out.
    if (!(e instanceof ApiError && e.status >= 500)) redirect("/login");
  }
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
