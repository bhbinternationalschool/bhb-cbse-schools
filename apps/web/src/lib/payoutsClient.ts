"use client";

/**
 * Browser side of Cashfree Payouts (director, 7 Oct 2026): is "Pay via
 * Cashfree" available right now — the owner's switch, the wallet balance —
 * and the pay / status calls. The switch state is read once per page and
 * shared by every button on it.
 */

import { useEffect, useState } from "react";
import type { UpiTargetKind } from "@/lib/upiProofMatch";

export type PayoutState = {
  configured: boolean;
  enabled: boolean;
  why: string;
  switchOn: boolean;
  testPassedAt: string | null;
  /** Who approves a fee-refund link: "owner" | "above" | "none". */
  refundApproval: "owner" | "above" | "none";
  refundApprovalAbovePaise: number;
  /** Who approves a vendor bill / voucher paid from the wallet. */
  paymentApproval: "owner" | "above" | "none";
  paymentApprovalAbovePaise: number;
  updatedBy: string;
  updatedAt: string | null;
  /** null = could not be read — neither zero nor plenty. */
  balancePaise: number | null;
  balanceError: string;
  canToggle: boolean;
};

let shared: Promise<PayoutState | null> | null = null;

export function loadPayoutState(fresh = false): Promise<PayoutState | null> {
  if (!shared || fresh) {
    shared = fetch("/api/payouts/state", { credentials: "same-origin" })
      .then((r) => (r.ok ? r.json() : null))
      .then((j: (PayoutState & { ok?: boolean }) | null) => (j?.ok ? j : null))
      .catch(() => null);
  }
  return shared;
}

export function usePayoutState(tick = 0): PayoutState | null {
  const [state, setState] = useState<PayoutState | null>(null);
  useEffect(() => {
    let live = true;
    void loadPayoutState(tick > 0).then((s) => {
      if (live) setState(s);
    });
    return () => {
      live = false;
    };
  }, [tick]);
  return state;
}

export type PayoutPayBody = {
  targetKind: UpiTargetKind;
  targetId: string;
  targetLabel: string;
  subjectId: string;
  period: string;
  amountPaise: number;
  payee: { name: string; vpa?: string; accountNumber?: string; ifsc?: string; phone?: string };
  remarks?: string;
};

export type PayoutPayResult =
  | { ok: true; transferId: string; status: string; utr: string; message: string }
  | { ok: false; error: string; fallback?: "off" | "wallet_low" | "wallet_unknown"; availablePaise?: number; warning?: string };

export async function sendPayout(body: PayoutPayBody): Promise<PayoutPayResult> {
  try {
    const res = await fetch("/api/payouts/pay", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => null)) as PayoutPayResult | null;
    if (!j) return { ok: false, error: `HTTP ${res.status}` };
    return j;
  } catch {
    // A lost response is NOT "not sent": the status check settles it.
    return { ok: false, error: "No reply from the server — check the transfer's status before paying again." };
  }
}

export async function payoutStatus(transferId: string): Promise<{ status: string; utr: string } | null> {
  try {
    const r = await fetch(`/api/payouts/pay?transferId=${encodeURIComponent(transferId)}`, { credentials: "same-origin" });
    const j = (await r.json()) as { ok?: boolean; status?: string; utr?: string };
    return j?.ok ? { status: String(j.status || ""), utr: String(j.utr || "") } : null;
  } catch {
    return null;
  }
}
