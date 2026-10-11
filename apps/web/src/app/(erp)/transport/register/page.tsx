import type { Metadata } from "next";
import { BusRegisterWorkspace } from "@/components/transport/BusRegisterPanel";

export const metadata: Metadata = { title: "Bus register" };

export default function BusRegisterPage() {
  return <BusRegisterWorkspace />;
}
