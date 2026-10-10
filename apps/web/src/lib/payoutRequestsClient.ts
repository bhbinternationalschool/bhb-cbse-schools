"use client";

/**
 * Browser side of paying vendor bills and vouchers from the Cashfree wallet,
 * and of wallet top-ups. The rules are on the server (payoutRequests.server).
 */

import { useEffect, useState } from "react";
import type { PayoutRequestChannel, PayoutRequestKind, PayoutRequestStatus, VoucherDraft } from "@/lib/payoutRequests";

export type PayoutRequestView = {
  id: string;
  kind: PayoutRequestKind;
  channel: PayoutRequestChannel;
  amountPaise: number;
  payeeName: string;
  payeePhone: string;
  billId: string;
  billNo: string;
  draft: VoucherDraft | null;
  reason: string;
  status: PayoutRequestStatus;
  utr: string;
  requestedBy: string;
  approvedBy: string;
  approvedAt: string | null;
  appliedAt: string | null;
  resultRef: string;
  lastError: string;
  createdAt: string;
};

export type RequestResponse = { ok: boolean; error?: string; message?: string; request?: PayoutRequestView };

export async function payoutRequestAction(body: Record<string, unknown>): Promise<RequestResponse> {
  try {
    const r = await fetch("/api/payouts/requests", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => null)) as RequestResponse | null;
    return j ?? { ok: false, error: `HTTP ${r.status}` };
  } catch {
    // A lost reply is not "not sent": the status check settles it.
    return { ok: false, error: "No reply from the server — check the payment's status before sending again." };
  }
}

/** The newest request per bill — an open one if there is one. */
export function useBillRequests(billIds: string[], tick = 0): Map<string, PayoutRequestView> {
  const [map, setMap] = useState<Map<string, PayoutRequestView>>(new Map());
  const key = billIds.join(",");
  useEffect(() => {
    if (!key) {
      setMap(new Map());
      return;
    }
    let live = true;
    void fetch(`/api/payouts/requests?billIds=${encodeURIComponent(key)}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; requests?: PayoutRequestView[] }) => {
        if (!live || !j?.ok) return;
        const next = new Map<string, PayoutRequestView>();
        const open = (s: PayoutRequestStatus) => s === "PENDING_APPROVAL" || s === "SENT";
        for (const r of j.requests ?? []) {
          const cur = next.get(r.billId);
          if (!cur || (!open(cur.status) && open(r.status))) next.set(r.billId, r);
        }
        setMap(next);
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [key, tick]);
  return map;
}

export function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}
