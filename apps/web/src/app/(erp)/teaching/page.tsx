import type { Metadata } from "next";
import { TeachingWorkspace } from "@/components/teaching/TeachingWorkspace";

export const metadata: Metadata = { title: "Teaching & Syllabus" };

export default function TeachingPage() {
  return <TeachingWorkspace />;
}
