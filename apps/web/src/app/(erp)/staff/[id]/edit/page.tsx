import type { Metadata } from "next";
import { StaffProfileForm } from "@/components/staff/StaffProfileForm";

export const metadata: Metadata = { title: "Edit staff" };

export default async function EditStaffPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StaffProfileForm mode="edit" staffId={id} />;
}
