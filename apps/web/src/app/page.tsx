import { redirect } from "next/navigation";
import { getDemoSession } from "@/lib/auth";

export default async function RootPage() {
  const session = await getDemoSession();
  if (!session) redirect("/login");
  if (session.persona === "parent") redirect("/parent");
  if (session.persona === "field") redirect("/field");
  redirect("/home");
}
