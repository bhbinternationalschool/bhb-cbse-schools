import type { Metadata } from "next";
import { ComplaintsWorkspace } from "@/components/complaints/ComplaintsWorkspace";

export const metadata: Metadata = { title: "Complaints" };

export default function ComplaintsPage() {
  return <ComplaintsWorkspace />;
}
