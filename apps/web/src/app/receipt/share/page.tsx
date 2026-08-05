"use client";

import { useEffect, useState } from "react";
import { FeeReceiptSheet, printFeeReceipt } from "@/components/fees/FeeReceiptSheet";
import {
  decodeReceiptSharePayload,
  type ReceiptSharePayload,
} from "@/lib/receiptShare";
import { TENANT } from "@/lib/types";

export default function SharedReceiptPage() {
  const [payload, setPayload] = useState<ReceiptSharePayload | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    const raw = window.location.hash.replace(/^#/, "");
    if (!raw) {
      setError("This receipt link is incomplete.");
      return;
    }
    const decoded = decodeReceiptSharePayload(decodeURIComponent(raw));
    if (!decoded) {
      setError("Could not open this fee receipt. Ask the school to resend.");
      return;
    }
    setPayload(decoded);
  }, []);

  if (error) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center">
        <p className="font-brand-name text-lg text-[var(--brand-deep)]">
          {TENANT.shortName}
        </p>
        <p className="mt-4 text-sm text-[var(--muted)]">{error}</p>
      </main>
    );
  }

  if (!payload) {
    return (
      <main className="mx-auto max-w-lg px-4 py-16 text-center text-sm text-[var(--muted)]">
        Opening fee receipt…
      </main>
    );
  }

  return (
    <main className="receipt-share-page mx-auto max-w-2xl px-3 py-6 sm:px-4">
      <div className="mb-4 print:hidden">
        <p className="text-center font-brand-name text-base text-[var(--brand-deep)]">
          {TENANT.nameDisplay}
        </p>
        <p className="mt-1 text-center text-xs text-[var(--muted)]">
          Digital fee receipt · {payload.voucher.receiptNo}
        </p>
        <div className="mt-3 flex justify-center gap-2">
          <button
            type="button"
            className="rounded-lg bg-[var(--brand-deep)] px-4 py-2 text-xs font-bold text-white"
            onClick={() => printFeeReceipt(payload.voucher.id)}
          >
            Print / save PDF
          </button>
        </div>
      </div>
      <FeeReceiptSheet
        voucher={payload.voucher}
        householdHint={payload.householdHint}
        students={payload.students}
      />
    </main>
  );
}
