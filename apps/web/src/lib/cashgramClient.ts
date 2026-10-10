"use client";

/**
 * Browser side of fee refunds by Cashgram link. The rules live on the server
 * (cashgramRefunds.server.ts); this only carries the calls and the row shape.
 */

import type { CashgramFeeEffect, CashgramStatus } from "@/lib/cashgram";

export type CashgramRefundView = {
  cashgramId: string;
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
