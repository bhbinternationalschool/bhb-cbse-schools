import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDemoSession } from "@/lib/auth";
import { StaffFieldHub } from "@/components/field/StaffFieldHub";

export const metadata: Metadata = { title: "Field app" };

export default async function FieldPage() {
  const session = await getDemoSession();
  if (!session) redirect("/login");
  if (session.persona !== "field" && session.persona !== "staff") {
    redirect("/home");
  }
  return <StaffFieldHub session={session} />;
}
