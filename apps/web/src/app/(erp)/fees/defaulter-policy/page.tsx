import type { Metadata } from "next";
import { DefaulterHoldPanel } from "@/components/fees/DefaulterHoldPanel";

export const metadata: Metadata = { title: "Defaulter policy" };

export default function DefaulterPolicyPage() {
  return <DefaulterHoldPanel />;
}
