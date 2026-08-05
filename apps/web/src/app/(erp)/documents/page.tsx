import type { Metadata } from "next";
import { DocumentMakerWorkspace } from "@/components/documents/DocumentMakerWorkspace";

export const metadata: Metadata = { title: "Document maker" };

export default function DocumentsPage() {
  return <DocumentMakerWorkspace />;
}
