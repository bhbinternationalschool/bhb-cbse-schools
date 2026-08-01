import type { Metadata, Viewport } from "next";
import { pwaManifestHref } from "@/lib/pwaApps";
import { TENANT } from "@/lib/types";

export const metadata: Metadata = {
  title: "Login",
  description: `Sign in to ${TENANT.name} — parent, staff, principal, admin, or field.`,
  applicationName: "BHB School",
  manifest: pwaManifestHref("login"),
  appleWebApp: {
    capable: true,
    title: "BHB School",
    statusBarStyle: "black-translucent",
  },
};

export const viewport: Viewport = {
  themeColor: TENANT.primaryColor,
  width: "device-width",
  initialScale: 1,
  viewportFit: "cover",
};

export default function LoginLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  return <div className="bhb-pwa-login min-h-dvh">{children}</div>;
}
