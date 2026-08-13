import type { Metadata } from "next";
import { EventsWorkspace } from "@/components/events/EventsWorkspace";

export const metadata: Metadata = { title: "Events & Calendar" };

export default function EventsPage() {
  return <EventsWorkspace />;
}
