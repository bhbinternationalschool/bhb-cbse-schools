import { MpdFeeDisclosurePage } from "@/components/fees/MpdFeeDisclosurePage";

export const metadata = {
  title: `Fee structure · ${process.env.NEXT_PUBLIC_SCHOOL_NAME ?? "School"}`,
  description: "Mandatory public disclosure — fee structure",
};

export default function MpdPage() {
  return <MpdFeeDisclosurePage />;
}
