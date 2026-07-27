import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDemoSession } from "@/lib/auth";
import { StaffRegistrationCollectApp } from "@/components/field/StaffRegistrationCollectApp";

export const metadata: Metadata = { title: "Registration UPI" };

export default async function FieldRegisterPage() {
  const session = await getDemoSession();
  if (!session) redirect("/login");
  if (session.persona !== "field" && session.persona !== "staff") {
    redirect("/home");
  }
  return <StaffRegistrationCollectApp session={session} />;
}
