import type { Metadata } from "next";
import { Award } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/ComingSoonPage";

export const metadata: Metadata = { title: "Scholarships" };

export default function ScholarshipsPage() {
  return (
    <ComingSoonPage
      title="Scholarship disbursement"
      blurb="Scholarship awards and disbursement tracking"
      icon={<Award className="size-6" aria-hidden />}
    />
  );
}
