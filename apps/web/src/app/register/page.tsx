import type { Metadata } from "next";
import { PublicFamilyRegisterForm } from "@/components/admissions/PublicFamilyRegisterForm";
import { CrmParentChatWidget } from "@/components/admissions/CrmParentChatWidget";
import { loadPublicRegistrationConfig } from "@/lib/publicRegistration.server";

export const metadata: Metadata = {
  title: "Online registration",
  description:
    "Register your child online and pay the registration fee at BHB International School",
};

/** Classes / fee head come from the DB per request — never prerender them. */
export const dynamic = "force-dynamic";

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; lead?: string }>;
}) {
  const [sp, config] = await Promise.all([
    searchParams,
    loadPublicRegistrationConfig(),
  ]);
  // `lead` is the signed token from the WhatsApp registration link. It is
  // resolved in the browser (not here) so a bad or expired token shows the
  // parent an ordinary form rather than an error page.
  return (
    <>
      <PublicFamilyRegisterForm
        initialSrc={sp.src ?? null}
        linkToken={sp.lead ?? null}
        config={config}
      />
      <CrmParentChatWidget />
    </>
  );
}
