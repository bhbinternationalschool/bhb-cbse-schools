import type { Metadata } from "next";
import { MyClassWorkspace } from "@/components/staff/MyClassWorkspace";

export const metadata: Metadata = { title: "My class" };

export default function MyClassPage() {
  return <MyClassWorkspace />;
}
