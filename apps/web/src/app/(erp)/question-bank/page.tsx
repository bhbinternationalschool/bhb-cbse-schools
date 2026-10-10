import type { Metadata } from "next";
import { HelpCircle } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/ComingSoonPage";

export const metadata: Metadata = { title: "Question bank" };

export default function QuestionBankPage() {
  return (
    <ComingSoonPage
      title="Question bank"
      blurb="Reusable exam question repository"
      icon={<HelpCircle className="size-6" aria-hidden />}
    />
  );
}
