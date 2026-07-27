import type { Metadata } from "next";
import { AccountsWorkspace } from "@/components/accounts/AccountsWorkspace";

export const metadata: Metadata = { title: "Accounts" };

export default function AccountsPage() {
  return <AccountsWorkspace />;
}
