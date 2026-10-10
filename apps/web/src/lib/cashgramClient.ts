"use client";

/**
 * Browser side of fee refunds by Cashgram link. The rules live on the server
 * (cashgramRefunds.server.ts); this only carries the calls and the row shape.
 */

import { useEffect, useState } from "react";
import { cashgramIsDead, type CashgramFeeEffect, type CashgramStatus } from "@/lib/cashgram";

export type CashgramRefundView = {
  cashgramId: string;
  purpose?: "fee_refund" | "staff_pay";
  targetId?: string;
  feeEffect: CashgramFeeEffect;
  householdId: string;
  voucherId: string;
  receiptNo: string;
  amountPaise: number;
  payeeName: string;
  payeePhone: string;
  reason: string;
  linkExpiry: string;
  status: CashgramStatus;
  cashgramLink: string;
  utr: string;
  requestedBy: string;
  approvedBy: string;
  approvedAt: string | null;
  decidedNote: string;
  appliedAt: string | null;
  lastError: string;
  createdAt: string;
};

export type HouseholdRefundableView = {
  householdId: string;
  excessPaise: number;
  excessRefundablePaise: number;
  guardianName: string;
  phone: string;
  email: string;
  receipts: {
    voucherId: string;
    receiptNo: string;
    collectionDate: string;
    totalPaise: number;
    modes: string;
    problem: string;
  }[];
};

export type CashgramResponse = {
  ok: boolean;
  error?: string;
  message?: string;
  refund?: CashgramRefundView;
};

export async function cashgramAction(body: Record<string, unknown>): Promise<CashgramResponse> {
  try {
    const r = await fetch("/api/fees/cashgram-refund", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => null)) as CashgramResponse | null;
    return j ?? { ok: false, error: `HTTP ${r.status}` };
  } catch (e) {
    return { ok: false, error: e instanceof Error ? e.message : "Network error" };
  }
}

export function inr(paise: number): string {
  return `₹${(paise / 100).toLocaleString("en-IN", { maximumFractionDigits: 2 })}`;
}

/* ── staff salary links ──────────────────────────────────────────────── */

/**
 * The link that matters for each salary line: a live one (open or collected)
 * if there is one, else the newest — so an expired link does not hide the
 * button, and a live one is never hidden behind an older dead one.
 */
export function useStaffCashgrams(targetIds: string[], tick = 0): Map<string, CashgramRefundView> {
  const [map, setMap] = useState<Map<string, CashgramRefundView>>(new Map());
  const key = targetIds.join(",");
  useEffect(() => {
    if (!key) {
      setMap(new Map());
      return;
    }
    let live = true;
    void fetch(`/api/payouts/cashgram?kind=payroll_line&ids=${encodeURIComponent(key)}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; links?: CashgramRefundView[] }) => {
        if (!live || !j?.ok) return;
        const next = new Map<string, CashgramRefundView>();
        for (const l of j.links ?? []) {
          const id = l.targetId || "";
          const cur = next.get(id);
          if (!cur || (cashgramIsDead(cur.status) && !cashgramIsDead(l.status))) next.set(id, l);
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

export async function staffCashgramAction(body: Record<string, unknown>): Promise<CashgramResponse> {
  try {
    const r = await fetch("/api/payouts/cashgram", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await r.json().catch(() => null)) as CashgramResponse | null;
    return j ?? { ok: false, error: `HTTP ${r.status}` };
  } catch {
    // A lost reply is not "not sent": Check status settles it.
    return { ok: false, error: "No reply from the server — check the link's status before sending again." };
  }
}
