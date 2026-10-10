import type { Metadata } from "next";
import { PieChart } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/ComingSoonPage";

export const metadata: Metadata = { title: "Operating budget" };

export default function BudgetPage() {
  return (
    <ComingSoonPage
      title="Operating budget"
      blurb="Annual budget planning vs. actuals"
      icon={<PieChart className="size-6" aria-hidden />}
    />
  );
}
