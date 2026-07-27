import type { Metadata } from "next";
import { PtmWorkspace } from "@/components/ptm/PtmWorkspace";

export const metadata: Metadata = { title: "PTM Scheduler" };

export default function PtmPage() {
  return <PtmWorkspace />;
}
