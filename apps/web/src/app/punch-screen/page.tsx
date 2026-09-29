import type { Metadata } from "next";
import { PunchScreen } from "@/components/staff/PunchScreen";

export const metadata: Metadata = { title: "Staff punch QR" };

/** The office tablet / desktop that staff scan to punch (30 Sep 2026). */
export default function PunchScreenPage() {
  return <PunchScreen />;
}
