import type { Metadata } from "next";
import { ReportsCenterWorkspace } from "@/components/reports/ReportsCenterWorkspace";

export const metadata: Metadata = { title: "Reports Center" };

export default function ReportsPage() {
  return <ReportsCenterWorkspace />;
}
