import type { Metadata } from "next";
import { ExamsWorkspace } from "@/components/exams/ExamsWorkspace";

export const metadata: Metadata = { title: "Exams / report cards" };

export default function ExamsPage() {
  return <ExamsWorkspace />;
}
