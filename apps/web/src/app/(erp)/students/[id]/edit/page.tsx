import type { Metadata } from "next";
import { StudentForm } from "@/components/students/StudentForm";

export const metadata: Metadata = { title: "Student profile" };

export default async function EditStudentPage({
  params,
}: {
  params: Promise<{ id: string }>;
}) {
  const { id } = await params;
  return <StudentForm mode="edit" studentId={id} />;
}
