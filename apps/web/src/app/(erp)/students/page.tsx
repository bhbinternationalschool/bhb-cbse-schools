import type { Metadata } from "next";
import { StudentsWorkspace } from "@/components/students/StudentsWorkspace";

export const metadata: Metadata = { title: "Students" };

export default function StudentsPage() {
  return <StudentsWorkspace />;
}
