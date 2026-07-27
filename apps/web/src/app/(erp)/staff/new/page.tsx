import type { Metadata } from "next";
import { StaffProfileForm } from "@/components/staff/StaffProfileForm";

export const metadata: Metadata = { title: "Add staff" };

export default function NewStaffPage() {
  return <StaffProfileForm mode="create" />;
}
