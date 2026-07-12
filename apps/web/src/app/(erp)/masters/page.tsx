import type { Metadata } from "next";
import { MastersWorkspace } from "@/components/masters/MastersWorkspace";

export const metadata: Metadata = { title: "Masters" };

export default function MastersPage() {
  return <MastersWorkspace />;
}
