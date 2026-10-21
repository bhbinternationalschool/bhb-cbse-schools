import type { Metadata } from "next";
import { Suspense } from "react";
import { SchoolChatWorkspace } from "@/components/schoolChat/SchoolChatWorkspace";

export const metadata: Metadata = { title: "School chat" };

export default function SchoolChatPage() {
  return (
    <Suspense fallback={null}>
      <SchoolChatWorkspace />
    </Suspense>
  );
}
