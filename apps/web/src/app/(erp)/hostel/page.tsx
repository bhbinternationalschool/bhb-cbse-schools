import type { Metadata } from "next";
import { Building2 } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/ComingSoonPage";

export const metadata: Metadata = { title: "Hostel" };

export default function HostelPage() {
  return (
    <ComingSoonPage
      title="Hostel"
      blurb="Boarding, room allocation, mess"
      icon={<Building2 className="size-6" aria-hidden />}
    />
  );
}
