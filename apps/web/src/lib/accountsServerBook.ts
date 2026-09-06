"use client";

/**
 * One source for every cash and bank balance on screen.
 *
 * Until 2026-09-06 two books were both on display. Ledger v2 (the server
 * book) held the real account: for UBI-Main, fee receipts, the old-ERP
 * opening, the GPay reconciliation, the vehicle loans, reversals and
 * reclassifications — ₹19,036 closing. The accounts desk's own
 * `bank_ledger` held one kind of row only, `fee_voucher`, 155 of them, all
 * money in, opening balance zero — ₹7,60,767, which is not a bank balance
 * at all but "fees collected by bank mode since this desk started", and can
 * only ever go up. The Masters tab showed the second number, the dashboard
 * the first, and the office was asked to believe both.
 *
 * Every screen now reads the position through here. The desk's bank and
 * cash ledgers remain as the record of what the desk itself did; they are
 * no longer a source for a BALANCE anywhere.
 *
 * The one rule this module exists to keep: when the server cannot be
 * reached, callers get `null` and must render an em dash or a spinner.
 * Falling back to the desk figure is what made the two books look
 * interchangeable in the first place.
 */

import { useEffect, useState } from "react";

export type ServerBookBank = {
  code: string;
  name: string;
  closingPaise: number;
  /** accounts-desk bank id this ledger account stands for. */
  bankAccountId: string;
};

export type ServerBookPosition = {
  asOf: string;
  cashPaise: number;
  bankPaise: number;
  banks: ServerBookBank[];
  chequesInHandPaise: number;
  payablesPaise: number;
  receivablesPaise: number;
  incomeThisYearPaise: number;
  expenditureThisYearPaise: number;
};

function todayIso(): string {
  return new Date().toISOString().slice(0, 10);
}

/** 1 April of the financial year today falls in. */
export function fyStartIso(today = new Date()): string {
  const y = today.getMonth() >= 3 ? today.getFullYear() : today.getFullYear() - 1;
  return `${y}-04-01`;
}

/**
 * Cached for 30s. Several screens ask for the position within one
 * navigation — the accounts dashboard, the bank list, the home tile — and
 * each call runs the whole period-balance query over every voucher.
 */
const TTL_MS = 30_000;
let cached: { at: number; asOf: string; value: ServerBookPosition } | null = null;
let inFlight: Promise<ServerBookPosition | null> | null = null;

export function resetServerBookCache(): void {
  cached = null;
  inFlight = null;
}

export async function fetchServerBookPosition(
  asOf = todayIso(),
): Promise<ServerBookPosition | null> {
  if (cached && cached.asOf === asOf && Date.now() - cached.at < TTL_MS) {
    return cached.value;
  }
  if (inFlight) return inFlight;
  inFlight = (async () => {
    try {
      const res = await fetch("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({
          action: "position",
          asOf,
          fyFrom: fyStartIso(),
        }),
      });
      if (!res.ok) return null;
      const body = (await res.json()) as Partial<ServerBookPosition> & {
        ok?: boolean;
      };
      if (!body.ok) return null;
      const value: ServerBookPosition = {
        asOf,
        cashPaise: Number(body.cashPaise ?? 0),
        bankPaise: Number(body.bankPaise ?? 0),
        banks: Array.isArray(body.banks) ? body.banks : [],
        chequesInHandPaise: Number(body.chequesInHandPaise ?? 0),
        payablesPaise: Number(body.payablesPaise ?? 0),
        receivablesPaise: Number(body.receivablesPaise ?? 0),
        incomeThisYearPaise: Number(body.incomeThisYearPaise ?? 0),
        expenditureThisYearPaise: Number(body.expenditureThisYearPaise ?? 0),
      };
      cached = { at: Date.now(), asOf, value };
      return value;
    } catch {
      return null;
    } finally {
      inFlight = null;
    }
  })();
  return inFlight;
}

/**
 * The server balance for one accounts-desk bank account.
 *
 * `null` — not `0` — when the position is unknown or the desk bank has no
 * ledger account yet. A zero would read as "this account is empty", which is
 * a different and much more alarming statement than "not known yet".
 */
export function serverBankBalancePaise(
  position: ServerBookPosition | null,
  deskBankId: string,
): number | null {
  if (!position) return null;
  const hit = position.banks.find((b) => b.bankAccountId === deskBankId);
  return hit ? hit.closingPaise : null;
}

export type ServerBookState = {
  position: ServerBookPosition | null;
  /** "loading" on first read, "failed" when the server could not be reached. */
  status: "loading" | "ready" | "failed";
  reload: () => void;
};

/** The position, for any client screen that shows a balance. */
export function useServerBookPosition(asOf?: string): ServerBookState {
  const [position, setPosition] = useState<ServerBookPosition | null>(null);
  const [status, setStatus] = useState<"loading" | "ready" | "failed">(
    "loading",
  );
  const [tick, setTick] = useState(0);

  useEffect(() => {
    let cancelled = false;
    setStatus("loading");
    void fetchServerBookPosition(asOf).then((p) => {
      if (cancelled) return;
      setPosition(p);
      setStatus(p ? "ready" : "failed");
    });
    return () => {
      cancelled = true;
    };
  }, [asOf, tick]);

  return {
    position,
    status,
    reload: () => {
      resetServerBookCache();
      setTick((t) => t + 1);
    },
  };
}
