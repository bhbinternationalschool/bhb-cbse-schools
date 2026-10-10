import type { Metadata } from "next";
import { VisitorSelfServiceApp } from "@/components/visitors/VisitorSelfServiceApp";

export const metadata: Metadata = {
  title: "Visitor check-in · BHB International School",
  description: "Scan the gate QR to check in and out as a visitor",
};

export const dynamic = "force-dynamic";

export default async function VisitPage({
  searchParams,
}: {
  searchParams: Promise<{ out?: string; v?: string; lang?: string; gate?: string }>;
}) {
  const sp = await searchParams;
  return (
    <VisitorSelfServiceApp
      initialMode={sp.out === "1" ? "checkout" : "checkin"}
      visitId={sp.v ?? null}
      initialLang={sp.lang === "hi" ? "hi" : sp.lang === "en" ? "en" : null}
      gate={sp.gate ?? null}
    />
  );
}
