import type { Metadata } from "next";
import { FeeTakeWorkspace } from "@/components/fees/FeeTakeWorkspace";

export const metadata: Metadata = { title: "Fee Take" };

export default function FeesPage() {
  return <FeeTakeWorkspace />;
}
