import type { Metadata } from "next";
import { DefaultersPlaybook } from "@/components/fees/DefaultersPlaybook";

export const metadata: Metadata = { title: "Defaulters" };

export default function DefaultersPage() {
  return <DefaultersPlaybook />;
}
