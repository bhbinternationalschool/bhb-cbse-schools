import { redirect } from "next/navigation";
import { PublicHome } from "@/components/public/PublicHome";
import { getDemoSession } from "@/lib/auth";

export default async function RootPage() {
  const session = await getDemoSession();
  // Signed-out visitors get the public site rather than a bare login form:
  // the legal name, the fee catalogue and the policy pages have to be
  // reachable without credentials for payment-gateway review.
  if (!session) return <PublicHome />;
  if (session.persona === "parent") redirect("/parent");
  if (session.persona === "field") redirect("/field");
  redirect("/home");
}
