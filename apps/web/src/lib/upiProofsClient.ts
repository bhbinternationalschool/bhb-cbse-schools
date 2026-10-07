"use client";

/**
 * Browser side of the recorded UPI payments (api/payments/upi-proofs): record
 * one from the ERP's Pay by UPI button, and read which items already carry a
 * UTR — including ones confirmed from a WhatsApp screenshot — so the screens
 * show "Paid ✓ UTR …".
 */

import { useEffect, useState } from "react";
import type { UpiTargetKind } from "@/lib/upiProofMatch";

export async function recordUpiProof(body: {
  utr: string;
  amountPaise: number;
  paidOn: string;
  payeeName: string;
  payeeVpa: string;
  targetKind: UpiTargetKind;
  targetId: string;
  targetLabel: string;
}): Promise<{ ok: true } | { ok: false; error: string }> {
  try {
    const res = await fetch("/api/payments/upi-proofs", {
      method: "POST",
      credentials: "same-origin",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(body),
    });
    const j = (await res.json().catch(() => null)) as { ok?: boolean; error?: string } | null;
    return res.ok && j?.ok ? { ok: true } : { ok: false, error: j?.error || `HTTP ${res.status}` };
  } catch {
    return { ok: false, error: "Could not reach the server" };
  }
}

/** targetId → { utr, paidOn } for the given items. Re-reads when `tick` changes. */
export function useRecordedUpiProofs(
  kind: UpiTargetKind,
  ids: string[],
  tick = 0,
): Map<string, { utr: string; paidOn: string }> {
  const [map, setMap] = useState<Map<string, { utr: string; paidOn: string }>>(new Map());
  const key = ids.join(",");
  useEffect(() => {
    if (!key) {
      setMap(new Map());
      return;
    }
    let live = true;
    void fetch(`/api/payments/upi-proofs?kind=${kind}&ids=${encodeURIComponent(key)}`, { credentials: "same-origin" })
      .then((r) => r.json())
      .then((j: { ok?: boolean; proofs?: { utr: string; paid_on: string | null; target_id: string }[] }) => {
        if (!live || !j?.ok) return;
        setMap(new Map((j.proofs ?? []).map((p) => [p.target_id, { utr: p.utr, paidOn: p.paid_on || "" }])));
      })
      .catch(() => undefined);
    return () => {
      live = false;
    };
  }, [kind, key, tick]);
  return map;
}
