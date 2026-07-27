import type { Metadata } from "next";
import { TrustWorkspace } from "@/components/trust/TrustWorkspace";

export const metadata: Metadata = { title: "Trust · Construction" };

export default function TrustPage() {
  return <TrustWorkspace />;
}
