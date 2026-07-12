import type { Metadata } from "next";
import { StudentForm } from "@/components/students/StudentForm";

export const metadata: Metadata = { title: "Add student" };

export default function NewStudentPage() {
  return <StudentForm mode="create" />;
}
