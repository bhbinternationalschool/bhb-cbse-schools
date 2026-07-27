import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDemoSession } from "@/lib/auth";
import { StaffLeadCaptureApp } from "@/components/field/StaffLeadCaptureApp";

export const metadata: Metadata = { title: "Capture lead" };

export default async function FieldCapturePage() {
  const session = await getDemoSession();
  if (!session) redirect("/login");
  if (session.persona !== "field" && session.persona !== "staff") {
    redirect("/home");
  }
  return <StaffLeadCaptureApp session={session} />;
}
