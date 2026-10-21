import type { Metadata, Viewport } from "next";
import { FieldPwaInstallBanner } from "@/components/pwa/FieldPwaInstallBanner";
import { getDemoSession } from "@/lib/auth";
import { ErpQueryProvider } from "@/lib/data/client/hooks";
import { pwaManifestHref } from "@/lib/pwaApps";
import { TENANT } from "@/lib/types";

export const metadata: Metadata = {
  title: "Field app",
  description: "BHB Field — drivers, survey team, lead capture.",
  applicationName: "BHB Field",
  manifest: pwaManifestHref("field"),
  appleWebApp: {
    capable: true,
    title: "BHB Field",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: TENANT.primaryColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default async function FieldLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getDemoSession();
  return (
    <div className="bhb-pwa-field min-h-dvh bg-[var(--surface)]">
      <FieldPwaInstallBanner
        persona={session?.persona}
        roleCode={session?.roleCode}
      />
      {/* data-layer 2.1g: field screens read reference data (Masters) through
          the query kernel like the ERP pages do; there is no AppShell here. */}
      <ErpQueryProvider>{children}</ErpQueryProvider>
    </div>
  );
}
