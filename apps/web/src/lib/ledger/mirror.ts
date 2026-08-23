/**
 * Ledger v2 — mirror desk journals into the server book.
 *
 * The bridge for the parallel run. The accounts desk keeps posting exactly as
 * it does today; every journal it writes is also sent to `ledger_post`, so the
 * server book fills up with the same entries and the two can be compared
 * (see ledgerParityAgainstDesk) before any read is cut over.
 *
 * postJournal is the one door into the desk's GL — every posting path in the
 * accounts family routes its double entry through it — so hooking it here
 * captures fee receipts, expense vouchers, vendor bills, owner loans, capex,
 * store sales and day-close handovers with a single hook.
 *
 * What this mirror does NOT carry is the sub-ledger and party detail: which
 * cash pool, which bank account, which household. That lives on the desk's
 * cash/bank ledger rows rather than on its journal lines, and inventing it
 * here would be guessing. The GL is complete and correct; per-pool and
 * per-party detail arrives in P2, when each business event posts to the ledger
 * natively with its full context instead of being reconstructed after the
 * fact.
 *
 * Failures land in the accounts posting-failure queue, the same place a
 * refused desk posting goes, so nothing is lost silently.
 */

import type { AccountsState, JournalEntry } from "@/lib/accountsTypes";
import { isPostableLedgerCode } from "@/lib/ledger/coa";
import type { LedgerVoucherInput, LedgerVoucherType } from "@/lib/ledger/types";

/**
 * Which kind of voucher a desk journal really is.
 *
 * The desk stamps a `sourceType` on every posting, which is enough to file it
 * correctly: an auditor expects a fee collection under receipts and a vendor
 * payment under payments, not everything lumped into one journal series.
 */
export function voucherTypeForSource(sourceType: string): LedgerVoucherType {
  switch (sourceType) {
    case "fee_voucher":
    case "fee_cheque":
    case "store_issue":
      return "receipt";
    case "expense_voucher":
    case "vendor_payment":
    case "owner_loan_repayment":
      return "payment";
    case "cash_transfer":
    case "bank_deposit":
    case "day_close":
      return "contra";
    case "vendor_bill":
    case "grn":
      return "purchase";
    case "store_sell_return":
      return "sales";
    case "payroll_run":
      return "payroll";
    default:
      return "journal";
  }
}

/**
 * Desk source types the projection owns.
 *
 * Both paths are idempotent, but they key on different source ids — the mirror
 * on the desk journal's own key, the projection on the business record's — so
 * a receipt reaching the ledger down both roads would be counted twice. The
 * projection carries far more (party, sub-ledger, instrument, the right
 * voucher series) and is self-healing, so where it applies it wins outright
 * and the mirror stands aside.
 *
 * The mirror still earns its place for everything else the desk journals:
 * owner loans, capex, day-close handovers, pool transfers, bank deposits.
 */
const PROJECTED_SOURCE_TYPES = new Set([
  "fee_voucher",
  "fee_cheque",
  "expense_voucher",
  "vendor_bill",
  "grn",
  "payroll_run",
]);

/**
 * Translate one desk journal entry into a ledger voucher.
 *
 * Returns null when the entry cannot be represented — a void entry (the
 * ledger records those as reversals, not as entries with a flag), or one whose
 * COA ids no longer resolve to codes.
 */
export function deskJournalToLedgerVoucher(
  entry: JournalEntry,
  state: AccountsState,
): LedgerVoucherInput | null {
  if (entry.voidedAt) return null;
  if (PROJECTED_SOURCE_TYPES.has(entry.sourceType)) return null;

  const codeById = new Map(state.coaAccounts.map((c) => [c.id, c.code]));
  const lines: LedgerVoucherInput["lines"] = [];

  for (const line of entry.lines) {
    const code = codeById.get(line.coaId);
    if (!code || !isPostableLedgerCode(code)) return null;
    const debitPaise = Math.round(line.debitPaise || 0);
    const creditPaise = Math.round(line.creditPaise || 0);
    if (debitPaise <= 0 && creditPaise <= 0) continue;
    lines.push({
      accountCode: code,
      debitPaise,
      creditPaise,
      narration: line.narration || "",
    });
  }

  if (lines.length < 2) return null;

  return {
    voucherType: voucherTypeForSource(entry.sourceType),
    date: entry.date,
    narration: entry.narration || "",
    // The desk's own source key, so a mirror is idempotent and a desk entry
    // can always be traced to its ledger voucher and back.
    sourceType: entry.sourceType ? `desk_${entry.sourceType}` : "desk_journal",
    sourceId: entry.sourceId || entry.id,
    lines,
  };
}

/**
 * Send one desk journal to the server book.
 *
 * Fire-and-forget by design — the desk must not block on the ledger during the
 * parallel run — but never silent: a refusal is queued for retry.
 */
export function mirrorJournalToLedger(
  entry: JournalEntry,
  state: AccountsState,
): void {
  if (typeof window === "undefined") return;
  if (!ledgerMirrorEnabled()) return;

  const voucher = deskJournalToLedgerVoucher(entry, state);
  if (!voucher) return;

  void (async () => {
    const { recordAccountsPostingFailure } = await import(
      "@/lib/accountsPostingFailures"
    );
    try {
      const res = await fetch("/api/ledger", {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ action: "mirror", voucher }),
      });
      const body = (await res.json().catch(() => null)) as
        | { ok?: boolean; error?: string }
        | null;
      if (!res.ok || !body?.ok) {
        recordAccountsPostingFailure({
          action: "ledger_mirror",
          sourceId: voucher.sourceId || entry.id,
          label: `Ledger mirror · ${entry.voucherNo || entry.narration || entry.id}`,
          amountPaise: entry.lines.reduce((n, l) => n + (l.debitPaise || 0), 0),
          reason: body?.error || `Ledger refused the mirror (HTTP ${res.status})`,
          payload: voucher,
        });
      }
    } catch (e) {
      recordAccountsPostingFailure({
        action: "ledger_mirror",
        sourceId: voucher.sourceId || entry.id,
        label: `Ledger mirror · ${entry.voucherNo || entry.narration || entry.id}`,
        amountPaise: entry.lines.reduce((n, l) => n + (l.debitPaise || 0), 0),
        reason: e instanceof Error ? e.message : String(e),
        payload: voucher,
      });
    }
  })();
}

/**
 * Off unless switched on.
 *
 * The mirror writes to a live book, so it stays behind a flag until the
 * ledger masters are installed for the tenant. Same shape as the desk cutover
 * flags this codebase already uses.
 */
export function ledgerMirrorEnabled(): boolean {
  if (typeof window === "undefined") {
    return process.env.LEDGER_MIRROR === "true";
  }
  return process.env.NEXT_PUBLIC_LEDGER_MIRROR === "true";
}
