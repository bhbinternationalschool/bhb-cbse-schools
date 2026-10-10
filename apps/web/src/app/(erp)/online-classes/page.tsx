import type { Metadata } from "next";
import { OnlineClassesWorkspace } from "@/components/online-classes/OnlineClassesWorkspace";

export const metadata: Metadata = { title: "Online classes" };

export default function OnlineClassesPage() {
  return <OnlineClassesWorkspace />;
}
