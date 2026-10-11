import type { Metadata } from "next";
import { FeeToolsTabs } from "@/components/fees/FeeToolsTabs";

export const metadata: Metadata = { title: "Bulk & PDC" };

export default function FeeToolsPage() {
  return <FeeToolsTabs />;
}
