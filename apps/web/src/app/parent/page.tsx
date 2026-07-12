import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDemoSession } from "@/lib/auth";
import { ParentPortalClient } from "@/components/parent/ParentPortalClient";

export const metadata: Metadata = { title: "Parent fees" };

export default async function ParentPage() {
  const session = await getDemoSession();
  if (!session) redirect("/login");
  if (session.persona !== "parent") redirect("/home");

  return <ParentPortalClient guardianName={session.fullName} />;
}
