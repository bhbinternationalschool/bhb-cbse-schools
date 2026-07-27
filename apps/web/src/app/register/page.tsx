import type { Metadata } from "next";
import { PublicFamilyRegisterForm } from "@/components/admissions/PublicFamilyRegisterForm";
import { CrmParentChatWidget } from "@/components/admissions/CrmParentChatWidget";

export const metadata: Metadata = {
  title: "Online registration",
  description:
    "Register your child online and pay the registration fee at BHB International School",
};

export default async function RegisterPage({
  searchParams,
}: {
  searchParams: Promise<{ src?: string }>;
}) {
  const sp = await searchParams;
  return (
    <>
      <PublicFamilyRegisterForm initialSrc={sp.src ?? null} />
      <CrmParentChatWidget />
    </>
  );
}
