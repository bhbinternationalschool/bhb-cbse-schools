/**
 * Accounts — the queue of postings that did not reach the books.
 *
 * fees.ts and store.ts fire their accounts postings from floating promises
 * (`void import(...).then(...)`) so that a books problem never blocks a
 * receipt. Until 2026-08-23 those promises ended in `.catch(() => {})` and
 * the posting itself returned silently when the operator's role lacked
 * `accounts:edit` — a fee receipt was saved, the journal was never written,
 * and nobody was told. The books drifted from the fee desk with no error
 * anywhere.
 *
 * Every failure now lands here instead: recorded with the idempotency key of
 * the posting that failed, surfaced to the UI as `bhb-accounts-posting-failed`,
 * and replayable. Retry is safe because every posting entry point is
 * idempotent by `sourceId` — a posting that did land is skipped, and one that
 * did not is completed.
 *
 * This file must stay dependency-light (no accounts imports) — the posting
 * modules import it, so anything it imported back would close a cycle.
 */

import { writeCacheOrInvalidate } from "@/lib/browserStorage";

const STORAGE_KEY = "bhb_accounts_posting_failures_v1";
const MAX_ROWS = 200;

export type AccountsPostingAction =
  | "fee_receipt"
  | "fee_reversal"
  | "cheque_clearance"
  | "store_sale"
  | "store_return"
  | "day_close"
  /** A desk journal that did not reach the Ledger v2 server book. */
  | "ledger_mirror";

export type AccountsPostingFailure = {
  id: string;
  at: string;
  action: AccountsPostingAction;
  /** Idempotency key of the posting — a retry keys off this. */
  sourceId: string;
  /** What the operator will recognise: receipt no, issue no, cheque no. */
  label: string;
  amountPaise: number;
  reason: string;
  /** The exact argument object, so the retry replays the original call. */
  payload: unknown;
  attempts: number;
  lastTriedAt: string;
  resolvedAt: string | null;
};

function readAll(): AccountsPostingFailure[] {
  if (typeof window === "undefined") return [];
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return [];
    const parsed = JSON.parse(raw) as unknown;
    return Array.isArray(parsed) ? (parsed as AccountsPostingFailure[]) : [];
  } catch {
    return [];
  }
}

function writeAll(rows: AccountsPostingFailure[]): void {
  if (typeof window === "undefined") return;
  try {
    writeCacheOrInvalidate(STORAGE_KEY, JSON.stringify(rows.slice(0, MAX_ROWS)));
  } catch {
    /* the queue is a safety net; never let it break the caller */
  }
}

/**
 * Record a posting that did not reach the books.
 *
 * Keyed by (action, sourceId): a repeated failure for the same posting bumps
 * the attempt count instead of filling the queue with duplicates.
 */
export function recordAccountsPostingFailure(input: {
  action: AccountsPostingAction;
  sourceId: string;
  label?: string;
  amountPaise?: number;
  reason: string;
  payload?: unknown;
}): AccountsPostingFailure {
  const now = new Date().toISOString();
  const rows = readAll();
  const existing = rows.find(
    (r) => r.action === input.action && r.sourceId === input.sourceId && !r.resolvedAt,
  );

  const row: AccountsPostingFailure = existing
    ? {
        ...existing,
        at: now,
        reason: input.reason,
        payload: input.payload ?? existing.payload,
        attempts: existing.attempts + 1,
        lastTriedAt: now,
      }
    : {
        id: `apf_${Math.random().toString(36).slice(2, 10)}`,
        at: now,
        action: input.action,
        sourceId: input.sourceId,
        label: input.label ?? "",
        amountPaise: Math.round(Number(input.amountPaise) || 0),
        reason: input.reason,
        payload: input.payload ?? null,
        attempts: 1,
        lastTriedAt: now,
        resolvedAt: null,
      };

  writeAll([row, ...rows.filter((r) => r.id !== row.id)]);

  console.error(
    `[accounts] posting failed — ${input.action} ${input.sourceId}: ${input.reason}`,
  );
  if (typeof window !== "undefined" && typeof window.dispatchEvent === "function") {
    window.dispatchEvent(
      new CustomEvent("bhb-accounts-posting-failed", { detail: row }),
    );
  }
  return row;
}

/** Open failures, newest first. */
export function listAccountsPostingFailures(opts?: {
  includeResolved?: boolean;
}): AccountsPostingFailure[] {
  const rows = readAll();
  return opts?.includeResolved ? rows : rows.filter((r) => !r.resolvedAt);
}

export function openAccountsPostingFailureCount(): number {
  return listAccountsPostingFailures().length;
}

export function resolveAccountsPostingFailure(failureId: string): void {
  const now = new Date().toISOString();
  writeAll(
    readAll().map((r) => (r.id === failureId ? { ...r, resolvedAt: now } : r)),
  );
}

export function clearResolvedAccountsPostingFailures(): void {
  writeAll(readAll().filter((r) => !r.resolvedAt));
}

/**
 * Replay every open failure against the posting paths.
 *
 * Dynamically imported so this module stays a leaf — see the header. Each
 * posting is idempotent by source id, so a replay of something that did land
 * resolves the row without double-counting the money.
 */
export async function retryAccountsPostingFailures(): Promise<{
  attempted: number;
  resolved: number;
  stillFailing: number;
}> {
  const open = listAccountsPostingFailures();
  if (open.length === 0) return { attempted: 0, resolved: 0, stillFailing: 0 };

  const postings = await import("@/lib/accountsPostings");
  let resolved = 0;

  for (const row of open) {
    let result: { ok: boolean; error?: string };
    try {
      switch (row.action) {
        case "fee_receipt":
          result = postings.postFeeCollectionToAccounts(
            row.payload as Parameters<typeof postings.postFeeCollectionToAccounts>[0],
          );
          break;
        case "fee_reversal":
          result = postings.reverseFeeCollectionInAccounts(
            row.payload as Parameters<typeof postings.reverseFeeCollectionInAccounts>[0],
          );
          break;
        case "cheque_clearance":
          result = postings.postChequeClearanceToAccounts(
            row.payload as Parameters<typeof postings.postChequeClearanceToAccounts>[0],
          );
          break;
        case "store_sale":
          result = postings.postStoreSaleToAccounts(
            row.payload as Parameters<typeof postings.postStoreSaleToAccounts>[0],
          );
          break;
        case "store_return":
          result = postings.postStoreSellReturnToAccounts(
            row.payload as Parameters<typeof postings.postStoreSellReturnToAccounts>[0],
          );
          break;
        case "day_close":
          result = postings.applyDayCloseHandover(
            row.payload as Parameters<typeof postings.applyDayCloseHandover>[0],
          );
          break;
        case "ledger_mirror": {
          // The payload is already a ledger voucher; replaying it is a plain
          // re-POST. ledger_post is idempotent by source id, so a mirror that
          // did land resolves the row rather than duplicating the voucher.
          const res = await fetch("/api/ledger", {
            method: "POST",
            headers: { "Content-Type": "application/json" },
            body: JSON.stringify({ action: "mirror", voucher: row.payload }),
          });
          const body = (await res.json().catch(() => null)) as
            | { ok?: boolean; error?: string }
            | null;
          result = body?.ok
            ? { ok: true }
            : { ok: false, error: body?.error || `HTTP ${res.status}` };
          break;
        }
        default:
          result = { ok: false, error: "Unknown posting action" };
      }
    } catch (e) {
      result = { ok: false, error: e instanceof Error ? e.message : String(e) };
    }

    if (result.ok) {
      resolveAccountsPostingFailure(row.id);
      resolved += 1;
    } else {
      recordAccountsPostingFailure({
        action: row.action,
        sourceId: row.sourceId,
        reason: result.error || "Retry failed",
        payload: row.payload,
      });
    }
  }

  return {
    attempted: open.length,
    resolved,
    stillFailing: open.length - resolved,
  };
}
