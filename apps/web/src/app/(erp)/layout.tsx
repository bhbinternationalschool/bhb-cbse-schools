import { redirect } from "next/navigation";
import { AppShell } from "@/components/shell/AppShell";
import { getDemoSession } from "@/lib/auth";

export default async function AuthenticatedLayout({
  children,
}: {
  children: React.ReactNode;
}) {
  const session = await getDemoSession();
  if (!session) redirect("/login");
  return <AppShell session={session}>{children}</AppShell>;
}
