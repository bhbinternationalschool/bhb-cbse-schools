import type { Metadata } from "next";
import { LibraryWorkspace } from "@/components/library/LibraryWorkspace";

export const metadata: Metadata = { title: "Library" };

export default function LibraryPage() {
  return <LibraryWorkspace />;
}
