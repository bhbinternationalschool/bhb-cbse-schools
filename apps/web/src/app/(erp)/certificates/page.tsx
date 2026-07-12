import type { Metadata } from "next";
import { CertificatesWorkspace } from "@/components/certificates/CertificatesWorkspace";

export const metadata: Metadata = { title: "Certificates" };

export default function CertificatesPage() {
  return <CertificatesWorkspace />;
}
