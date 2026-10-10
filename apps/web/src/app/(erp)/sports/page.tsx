import type { Metadata } from "next";
import { Trophy } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/ComingSoonPage";

export const metadata: Metadata = { title: "Sports" };

export default function SportsPage() {
  return (
    <ComingSoonPage
      title="Sports / houses / co-curricular"
      blurb="House points, teams, co-curricular records"
      icon={<Trophy className="size-6" aria-hidden />}
    />
  );
}
