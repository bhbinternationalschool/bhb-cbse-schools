import type { Metadata } from "next";
import { HomeworkWorkspace } from "@/components/homework/HomeworkWorkspace";

export const metadata: Metadata = { title: "Homework & Diary" };

export default function HomeworkPage() {
  return <HomeworkWorkspace />;
}
