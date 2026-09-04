import type { Metadata } from "next";
import { WebsiteWorkspace } from "@/components/website/WebsiteWorkspace";

export const metadata: Metadata = { title: "Website" };

export default function WebsitePage() {
  return <WebsiteWorkspace />;
}
