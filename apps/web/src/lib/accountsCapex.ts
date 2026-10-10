/**
 * Accounts — trust construction spend.
 *
 * Cost lines accumulate in capital work in progress (with retention held
 * back where applicable) and are capitalised to fixed assets when the
 * project completes. Both paths are idempotent by source id.
 */

import {
  COA_BANK_ACCOUNTS,
  COA_CASH_IN_HAND,
  COA_CWIP,
  COA_FIXED_ASSETS,
  COA_RETENTION_PAYABLE,
} from "@/lib/accountsTypes";
import type {
  JournalLine,
} from "@/lib/accountsTypes";
import {
  fail,
  todayIso,
} from "@/lib/accountsUtil";
import {
} from "@/lib/accountsNormalize";
import {
  loadAccounts,
  seedAccountsIfEmpty,
} from "@/lib/accountsStore";
import {
  getCoaByCode,
} from "@/lib/accountsLookups";
import {
  postJournal,
} from "@/lib/accountsJournal";
import {
  postBankMovement,
  postCashMovement,
} from "@/lib/accountsCashBank";

export function postTrustCostLineToCwip(input: {
  costLineId: string;
  projectCode: string;
  projectName: string;
  amountPaise: number;
  retentionPaise?: number;
  date?: string;
  narration?: string;
  poolId?: string;
  bankId?: string;
}): { ok: true } | { ok: false; error: string } {
  seedAccountsIfEmpty();
  const state = loadAccounts();
  const sourceId = `trust_cost_${input.costLineId}`;
  if (
    state.journalEntries.some((j) => j.sourceId === sourceId) ||
    state.cashLedger.some((e) => e.sourceId === sourceId) ||
    state.bankLedger.some((e) => e.sourceId === sourceId)
  ) {
    return { ok: true };
  }

  const net = Math.max(0, Math.round(input.amountPaise));
  const retention = Math.max(0, Math.round(input.retentionPaise ?? 0));
  const totalCwip = net + retention;
  if (totalCwip <= 0) return fail("Payment amount must be greater than zero");

  const date = input.date || todayIso();
  const narration =
    input.narration?.trim() ||
    `CWIP · ${input.projectCode} · ${input.projectName}`;

  if (input.poolId) {
    const res = postCashMovement({
      poolId: input.poolId,
      date,
      direction: "out",
      amountPaise: net,
      sourceType: "trust_cwip",
      sourceId,
      narration,
    });
    if (!res.ok) return res;
  } else if (input.bankId) {
    const res = postBankMovement({
      bankId: input.bankId,
      date,
      direction: "cr",
      amountPaise: net,
      mode: "neft",
      sourceType: "trust_cwip",
      sourceId,
      narration,
    });
    if (!res.ok) return res;
  } else {
    const drawer = state.cashPools.find((p) => p.code === "main") ?? state.cashPools[0];
    if (!drawer) return fail("No cash pool for payment");
    const res = postCashMovement({
      poolId: drawer.id,
      date,
      direction: "out",
      amountPaise: net,
      sourceType: "trust_cwip",
      sourceId,
      narration,
    });
    if (!res.ok) return res;
  }

  const cwipCoa = getCoaByCode(COA_CWIP, state);
  const settleCoa = getCoaByCode(
    input.poolId || !input.bankId ? COA_CASH_IN_HAND : COA_BANK_ACCOUNTS,
    state,
  );
  const retentionCoa = getCoaByCode(COA_RETENTION_PAYABLE, state);
  if (!cwipCoa || !settleCoa) return fail("CWIP or settlement COA missing");

  const lines: JournalLine[] = [
    {
      coaId: cwipCoa.id,
      debitPaise: totalCwip,
      creditPaise: 0,
      narration: input.projectCode,
    },
    {
      coaId: settleCoa.id,
      debitPaise: 0,
      creditPaise: net,
      narration: "Net payment",
    },
  ];
  if (retention > 0 && retentionCoa) {
    lines.push({
      coaId: retentionCoa.id,
      debitPaise: 0,
      creditPaise: retention,
      narration: "Retention held",
    });
  }

  const jv = postJournal({
    date,
    narration,
    sourceType: "trust_cwip",
    sourceId,
    lines,
  });
  if (!jv.ok) return jv;
  return { ok: true };
}

/** Capitalise project CWIP → fixed asset on completion (idempotent). */
export function capitaliseTrustProject(input: {
  projectId: string;
  projectCode: string;
  projectName: string;
  amountPaise: number;
  date?: string;
  assetName?: string;
}): { ok: true } | { ok: false; error: string } {
  seedAccountsIfEmpty();
  const state = loadAccounts();
  const sourceId = `trust_capitalise_${input.projectId}`;
  if (state.journalEntries.some((j) => j.sourceId === sourceId)) {
    return { ok: true };
  }

  const amount = Math.max(0, Math.round(input.amountPaise));
  if (amount <= 0) return fail("Nothing to capitalise");

  const cwipCoa = getCoaByCode(COA_CWIP, state);
  const assetCoa = getCoaByCode(COA_FIXED_ASSETS, state);
  if (!cwipCoa || !assetCoa) return fail("CWIP or Fixed Asset COA missing");

  const date = input.date || todayIso();
  const narration =
    input.assetName?.trim() ||
    `Capitalise · ${input.projectCode} · ${input.projectName}`;

  const jv = postJournal({
    date,
    narration,
    sourceType: "trust_capitalise",
    sourceId,
    lines: [
      {
        coaId: assetCoa.id,
        debitPaise: amount,
        creditPaise: 0,
        narration: input.projectCode,
      },
      {
        coaId: cwipCoa.id,
        debitPaise: 0,
        creditPaise: amount,
        narration: "CWIP cleared",
      },
    ],
  });
  if (!jv.ok) return jv;
  return { ok: true };
}
