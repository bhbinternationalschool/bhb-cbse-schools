import type { Metadata } from "next";
import { HealthWorkspace } from "@/components/health/HealthWorkspace";

export const metadata: Metadata = { title: "Health" };

export default function HealthPage() {
  return <HealthWorkspace />;
}
