import type { Metadata } from "next";
import { redirect } from "next/navigation";
import { getDemoSession } from "@/lib/auth";
import { SurveyAgentApp } from "@/components/field/SurveyAgentApp";

export const metadata: Metadata = { title: "Field survey" };

export default async function FieldSurveyAppPage() {
  const session = await getDemoSession();
  if (!session) redirect("/login");
  // Staff, field persona, or any logged-in user with team assignment may open.
  return <SurveyAgentApp session={session} />;
}
