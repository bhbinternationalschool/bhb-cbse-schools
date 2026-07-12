import type { Metadata } from "next";
import { TransportWorkspace } from "@/components/transport/TransportWorkspace";

export const metadata: Metadata = { title: "Transport" };

export default function TransportPage() {
  return <TransportWorkspace />;
}
