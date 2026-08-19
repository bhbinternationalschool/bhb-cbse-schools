import type { Metadata } from "next";
import { PublicEnquiryForm } from "@/components/admissions/PublicEnquiryForm";
import { CrmParentChatWidget } from "@/components/admissions/CrmParentChatWidget";
import { loadPublicRegistrationConfig } from "@/lib/publicRegistration.server";

export const metadata: Metadata = {
  title: "Admission enquiry",
  description: "Submit an admission enquiry to BHB International School",
};

/** Classes come from the DB per request — never prerender them. */
export const dynamic = "force-dynamic";

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string; c?: string; ref?: string }>;
}) {
  const [sp, config] = await Promise.all([
    searchParams,
    loadPublicRegistrationConfig(),
  ]);
  return (
    <>
      <PublicEnquiryForm initialSource={sp.src ?? null} initialCampaignId={sp.c ?? null} initialReferralCode={sp.ref ?? null} config={config} />
      <CrmParentChatWidget />
    </>
  );
}
