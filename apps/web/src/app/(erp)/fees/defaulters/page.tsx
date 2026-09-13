import type { Metadata } from "next";
import { DefaultersTabs } from "@/components/fees/DefaultersTabs";

export const metadata: Metadata = { title: "Defaulters" };

export default function DefaultersPage() {
  return <DefaultersTabs />;
}
