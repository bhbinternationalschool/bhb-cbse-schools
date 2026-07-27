import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDemoSession } from "@/lib/auth";
import { StaffLeadCallingApp } from "@/components/field/StaffLeadCallingApp";

export const metadata: Metadata = { title: "Lead calling" };

export default async function FieldCallingPage() {
  const session = await getDemoSession();
  if (!session) redirect("/login");
  if (session.persona !== "field" && session.persona !== "staff") {
    redirect("/home");
  }
  return <StaffLeadCallingApp session={session} />;
}
