import type { Metadata } from "next";
import { ModulesWorkspace } from "@/components/modules/ModulesWorkspace";

export const metadata: Metadata = { title: "Modules" };

export default function ModulesPage() {
  return <ModulesWorkspace />;
}
