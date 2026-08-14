import type { Metadata } from "next";
import { FileCheck } from "lucide-react";
import { ComingSoonPage } from "@/components/shared/ComingSoonPage";

export const metadata: Metadata = { title: "CBSE LOC" };

export default function CbseLocPage() {
  return (
    <ComingSoonPage
      title="CBSE LOC / registration"
      blurb="CBSE List of Candidates and board registration"
      icon={<FileCheck className="size-6" aria-hidden />}
    />
  );
}
