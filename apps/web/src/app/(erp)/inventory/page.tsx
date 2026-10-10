import type { Metadata } from "next";
import { InventoryWorkspace } from "@/components/inventory/InventoryWorkspace";

export const metadata: Metadata = { title: "Store & purchase" };

export default function InventoryPage() {
  return <InventoryWorkspace />;
}
