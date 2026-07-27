import type { Metadata } from "next";
import { PayrollWorkspace } from "@/components/payroll/PayrollWorkspace";

export const metadata: Metadata = { title: "Payroll" };

export default function PayrollPage() {
  return <PayrollWorkspace />;
}
