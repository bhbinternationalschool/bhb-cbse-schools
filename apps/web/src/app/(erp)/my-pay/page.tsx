import type { Metadata } from "next";
import { MyPayWorkspace } from "@/components/staff/MyPayWorkspace";

export const metadata: Metadata = { title: "My pay & attendance" };

export default function MyPayPage() {
  return <MyPayWorkspace />;
}
