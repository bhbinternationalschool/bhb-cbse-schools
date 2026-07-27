import type { Metadata } from "next";
import { TimetableWorkspace } from "@/components/timetable/TimetableWorkspace";

export const metadata: Metadata = { title: "Timetable" };

export default function TimetablePage() {
  return <TimetableWorkspace />;
}
