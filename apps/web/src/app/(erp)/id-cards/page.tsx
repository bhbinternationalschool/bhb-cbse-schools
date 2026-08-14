import type { Metadata } from "next";
import { IdCardsWorkspace } from "@/components/idCards/IdCardsWorkspace";

export const metadata: Metadata = { title: "ID cards" };

export default function IdCardsPage() {
  return <IdCardsWorkspace />;
}
