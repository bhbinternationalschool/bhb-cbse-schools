import type { Metadata } from "next";
import { UtensilsCrossed } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/ComingSoonPage";

export const metadata: Metadata = { title: "Canteen" };

export default function CanteenPage() {
  return (
    <ComingSoonPage
      title="Canteen / POS"
      blurb="Cashless canteen point of sale"
      icon={<UtensilsCrossed className="size-6" aria-hidden />}
    />
  );
}
