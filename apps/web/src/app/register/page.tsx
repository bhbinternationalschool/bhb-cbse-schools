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
  searchParams: Promise<{ src?: string }>;
}) {
  const [sp, config] = await Promise.all([
    searchParams,
    loadPublicRegistrationConfig(),
  ]);
  return (
    <>
      <PublicFamilyRegisterForm initialSrc={sp.src ?? null} config={config} />
      <CrmParentChatWidget />
    </>
  );
}
