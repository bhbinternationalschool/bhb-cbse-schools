import type { Metadata } from "next";
import { StaffWorkspace } from "@/components/staff/StaffWorkspace";

export const metadata: Metadata = { title: "Staff" };

export default function StaffPage() {
  return <StaffWorkspace />;
}
