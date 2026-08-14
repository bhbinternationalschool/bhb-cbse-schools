import type { Metadata } from "next";
import { DisciplineWorkspace } from "@/components/discipline/DisciplineWorkspace";

export const metadata: Metadata = { title: "Discipline" };

export default function DisciplinePage() {
  return <DisciplineWorkspace />;
}
