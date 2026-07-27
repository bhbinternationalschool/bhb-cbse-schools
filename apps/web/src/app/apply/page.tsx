import type { Metadata } from "next";
import { PublicEnquiryForm } from "@/components/admissions/PublicEnquiryForm";
import { CrmParentChatWidget } from "@/components/admissions/CrmParentChatWidget";

export const metadata: Metadata = {
  title: "Admission enquiry",
  description: "Submit an admission enquiry to BHB International School",
};

export default async function ApplyPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>;
}) {
  const sp = await searchParams;
  return (
    <>
      <PublicEnquiryForm initialSource={sp.src ?? null} />
      <CrmParentChatWidget />
    </>
  );
}
