import type { Metadata, Viewport } from "next";
import { StaffAppListing } from "@/components/pwa/StaffAppListing";
import { pwaManifestHref } from "@/lib/pwaApps";

/**
 * bhbinternational.school/downloads — the staff app, installed like a Play
 * Store app (director, 9 Oct 2026).
 *
 * The staff app IS the website: teachers and office staff use the ERP in the
 * browser (director, 30 Sep 2026 — the QR punch only works there, and a fix
 * reaches every phone on the next open). This page installs that website as
 * an app: one tap on Android (Chrome's own install), Share → Add to Home
 * Screen on iPhone. Nothing to download, nothing to update — every open loads
 * the newest version, so no phone can be left on an old one.
 */

export const metadata: Metadata = {
  title: "BHB Staff — install the app",
  description: "Install the BHB International School staff app on Android or iPhone. Always up to date.",
  manifest: pwaManifestHref("staff"),
  appleWebApp: { capable: true, title: "BHB Staff", statusBarStyle: "default" },
  robots: { index: false, follow: false },
};

export const viewport: Viewport = {
  themeColor: "#203050",
};

export default function DownloadsPage() {
  return <StaffAppListing />;
}
