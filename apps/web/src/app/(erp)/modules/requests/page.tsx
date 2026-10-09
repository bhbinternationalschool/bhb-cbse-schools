import type { Metadata } from "next";
import { ModuleRequestsWorkspace } from "@/components/modules/ModuleRequestsWorkspace";

export const metadata: Metadata = { title: "Module requests" };

export default function ModuleRequestsPage() {
  return <ModuleRequestsWorkspace />;
}
