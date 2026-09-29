import type { Metadata } from "next";
import { Suspense } from "react";
import { PunchPage } from "@/components/staff/PunchPage";

export const metadata: Metadata = { title: "Punch attendance" };

/** Where the office QR lands: /punch?c=123456 (30 Sep 2026). */
export default function Page() {
  return (
    <Suspense>
      <PunchPage />
    </Suspense>
  );
}
