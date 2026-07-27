import type { Metadata } from "next";
import { VaultWorkspace } from "@/components/vault/VaultWorkspace";

export const metadata: Metadata = { title: "Document Vault" };

export default function VaultPage() {
  return <VaultWorkspace />;
}
