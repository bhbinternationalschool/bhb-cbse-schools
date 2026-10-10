import type { Metadata, Viewport } from "next";
import { pwaManifestHref } from "@/lib/pwaApps";
import { TENANT } from "@/lib/types";

export const metadata: Metadata = {
  title: "Parent portal",
  description:
    "BHB International School parent app — fees, homework, notices, PTM.",
  applicationName: "BHB Parent",
  manifest: pwaManifestHref("parent"),
  appleWebApp: {
    capable: true,
    title: "BHB Parent",
    statusBarStyle: "black-translucent",
  },
  formatDetection: { telephone: false },
};

export const viewport: Viewport = {
  themeColor: TENANT.primaryColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function ParentLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return (
    <div className="parent-pwa-shell bhb-pwa-parent min-h-dvh bg-[var(--surface)]">
      {children}
    </div>
  );
}
