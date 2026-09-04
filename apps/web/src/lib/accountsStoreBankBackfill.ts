/**
 * Apply the store's historical bank movements to the DESK bank book.
 *
 * The store banks and pays through the server `inv_*` module, which writes
 * the ledger and stops. Until the counter started mirroring its own vendor
 * payments, the desk bank ledger therefore held fee receipts and nothing
 * else — 170 debits and zero credits — and the dashboard's "Bank balances"
 * read about ₹2.6 lakh under what the book said for the same accounts.
 *
 * This applies the history. It runs in the browser on purpose: a desk push
 * deletes accounts_desk_bank_ledger rows whose ids it does not carry, so
 * anything written server-side would be destroyed by the next sync.
 *
 * Idempotent. Every movement is keyed by the store payment row it came from,
 * and one already in the desk book is skipped, so running it twice — or on a
 * second machine that has since hydrated the first machine's entries — adds
 * nothing.
 */

import { bankMovementExists, postBankMovement } from "@/lib/accountsCashBank";
import { loadAccounts } from "@/lib/accountsStore";
import type { AccountsState, PaymentMode } from "@/lib/accountsTypes";

export type StoreBankMovementInput = {
  sourceType: string;
  sourceId: string;
  deskBankId: string;
  date: string;
  direction: "dr" | "cr";
  amountPaise: number;
  /** The tender the store actually recorded. */
  mode: string;
  narration: string;
  reference: string;
};

export type StoreBankBackfillResult = {
  applied: number;
  appliedPaise: number;
  /** Already present from an earlier run — the idempotency path, not an error. */
  skippedExisting: number;
  /** Could not be written, with the reason, e.g. a closed period. */
  failed: { sourceId: string; reason: string }[];
  /** Movements naming a bank this desk does not have. */
  unknownBank: number;
};

/**
 * The store's own tender, mapped onto the desk's list.
 *
 * Never guessed: a movement whose mode is not one the desk recognises is
 * refused rather than filed under an instrument the school never used.
 */
const DESK_MODES = new Set<PaymentMode>([
  "cash",
  "upi",
  "cheque",
  "neft",
  "rtgs",
  "card",
]);

function deskMode(mode: string): PaymentMode | null {
  const m = String(mode ?? "").trim().toLowerCase() as PaymentMode;
  return DESK_MODES.has(m) ? m : null;
}

/** A movement that passed every check, with its mode resolved. */
export type AcceptedMovement = StoreBankMovementInput & { mode: PaymentMode };

export type StoreBankBackfillDecision = {
  accept: AcceptedMovement[];
  skippedExisting: number;
  unknownBank: number;
  rejected: { sourceId: string; reason: string }[];
};

/**
 * Decide what to write, without writing it.
 *
 * Separated from the posting so it can be tested: postBankMovement saves
 * through saveAccounts, which does nothing outside a browser, so a test that
 * called it would prove only that it returned ok.
 */
export function decideStoreBankBackfill(
  state: AccountsState,
  movements: StoreBankMovementInput[],
): StoreBankBackfillDecision {
  const decision: StoreBankBackfillDecision = {
    accept: [],
    skippedExisting: 0,
    unknownBank: 0,
    rejected: [],
  };
  const known = new Set(state.bankAccounts.map((b) => b.id));
  // Guards against the same row appearing twice in one plan, as well as
  // against one already written by an earlier run.
  const seen = new Set<string>();

  for (const m of movements) {
    if (!m.sourceId || m.amountPaise <= 0) continue;
    const key = `${m.sourceType}::${m.sourceId}`;
    if (seen.has(key) || bankMovementExists(m.sourceType, m.sourceId, state)) {
      decision.skippedExisting += 1;
      continue;
    }
    if (!known.has(m.deskBankId)) {
      decision.unknownBank += 1;
      continue;
    }
    const mode = deskMode(m.mode);
    if (!mode) {
      decision.rejected.push({
        sourceId: m.sourceId,
        reason: `unrecognised payment mode "${m.mode}"`,
      });
      continue;
    }
    seen.add(key);
    decision.accept.push({ ...m, mode });
  }
  return decision;
}

export function applyStoreBankBackfill(
  movements: StoreBankMovementInput[],
): StoreBankBackfillResult {
  const decision = decideStoreBankBackfill(loadAccounts(), movements);
  const result: StoreBankBackfillResult = {
    applied: 0,
    appliedPaise: 0,
    skippedExisting: decision.skippedExisting,
    failed: [...decision.rejected],
    unknownBank: decision.unknownBank,
  };

  for (const m of decision.accept) {
    const posted = postBankMovement({
      bankId: m.deskBankId,
      date: m.date || undefined,
      direction: m.direction,
      amountPaise: m.amountPaise,
      mode: m.mode,
      sourceType: m.sourceType,
      sourceId: m.sourceId,
      narration: m.narration,
      transactionRef: m.reference,
    });
    if (posted.ok) {
      result.applied += 1;
      result.appliedPaise +=
        m.direction === "dr" ? m.amountPaise : -m.amountPaise;
    } else {
      result.failed.push({ sourceId: m.sourceId, reason: posted.error });
    }
  }

  return result;
}

/** Fetch the plan from the server and apply it. */
export async function runStoreBankBackfill(): Promise<
  | { ok: true; result: StoreBankBackfillResult; notes: string[] }
  | { ok: false; error: string }
> {
  let plan: {
    ok?: boolean;
    error?: string;
    movements?: StoreBankMovementInput[];
    notes?: string[];
  };
  try {
    const res = await fetch("/api/accounts/store-bank-backfill");
    plan = (await res.json()) as typeof plan;
    if (!res.ok || !plan?.ok) {
      return { ok: false, error: plan?.error || "Could not read the store's bank history" };
    }
  } catch {
    return { ok: false, error: "Could not reach the server" };
  }

  return {
    ok: true,
    result: applyStoreBankBackfill(plan.movements ?? []),
    notes: plan.notes ?? [],
  };
}
