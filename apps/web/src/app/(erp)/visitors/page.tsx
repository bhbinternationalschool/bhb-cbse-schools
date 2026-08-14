import type { Metadata } from "next";
import { VisitorsWorkspace } from "@/components/visitors/VisitorsWorkspace";

export const metadata: Metadata = { title: "Visitors" };

export default function VisitorsPage() {
  return <VisitorsWorkspace />;
}
