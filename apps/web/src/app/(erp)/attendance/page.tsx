import type { Metadata } from "next";
import { AttendanceWorkspace } from "@/components/attendance/AttendanceWorkspace";

export const metadata: Metadata = { title: "Attendance" };

export default function AttendancePage() {
  return <AttendanceWorkspace />;
}
