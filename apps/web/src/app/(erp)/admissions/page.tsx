import type { Metadata } from "next";
import { AdmissionsWorkspace } from "@/components/admissions/AdmissionsWorkspace";

export const metadata: Metadata = { title: "Admissions" };

export default function AdmissionsPage() {
  return <AdmissionsWorkspace />;
}
