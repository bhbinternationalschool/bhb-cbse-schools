import type { Metadata } from "next";
import { GraduationCap } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/ComingSoonPage";

export const metadata: Metadata = { title: "Alumni" };

export default function AlumniPage() {
  return (
    <ComingSoonPage
      title="Alumni"
      blurb="Alumni directory and engagement"
      icon={<GraduationCap className="size-6" aria-hidden />}
    />
  );
}
