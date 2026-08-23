/**
 * Accounts — the general ledger.
 *
 * postJournal is the single door into the GL: it refuses unbalanced entries
 * and entries dated into a closed fiscal year, so every posting path in the
 * family routes its double entry through here. Voiding excludes an entry
 * from the trial balance without deleting it — the audit trail stays.
 */

import {
} from "@/lib/accountsTypes";
import type {
  AccountsState,
  FiscalYear,
  FiscalYearStatus,
  JournalEntry,
  JournalLine,
} from "@/lib/accountsTypes";
import {
  fail,
  id,
  todayIso,
} from "@/lib/accountsUtil";
import {
  normalizeJournal,
} from "@/lib/accountsNormalize";
import {
  loadAccounts,
  saveAccounts,
} from "@/lib/accountsStore";

/* ─── Journal / ledger ─────────────────────────────────────── */

export function postJournal(input: {
  date?: string;
  voucherNo?: string;
  narration?: string;
  lines: JournalLine[];
  sourceType?: string;
  sourceId?: string;
  fiscalYearCode?: string;
}): { ok: true; entry: JournalEntry } | { ok: false; error: string } {
  const lines = (input.lines ?? []).filter(
    (l) => l.coaId && (l.debitPaise > 0 || l.creditPaise > 0),
  );
  if (lines.length === 0) return fail("At least one journal line is required");
  const totalDebit = lines.reduce((n, l) => n + Math.round(l.debitPaise), 0);
  const totalCredit = lines.reduce((n, l) => n + Math.round(l.creditPaise), 0);
  if (totalDebit !== totalCredit) return fail("Journal entry is not balanced");
  if (totalDebit <= 0) return fail("Journal entry amount must be greater than zero");

  const state = loadAccounts();
  const date = input.date || todayIso();
  const fy =
    (input.fiscalYearCode
      ? state.fiscalYears.find((f) => f.code === input.fiscalYearCode)
      : undefined) ?? resolveFiscalYearForDate(date, state);
  if (fy?.status === "closed") {
    return fail(`Fiscal year ${fy.label} is closed — reopen to post journals`);
  }

  const entry = normalizeJournal({
    id: id("jv"),
    date,
    voucherNo: input.voucherNo ?? "",
    narration: input.narration ?? "",
    lines,
    sourceType: input.sourceType ?? "",
    sourceId: input.sourceId ?? "",
    fiscalYearCode: fy?.code ?? input.fiscalYearCode ?? "",
    createdAt: new Date().toISOString(),
    voidedAt: null,
  });
  const next = { ...state, journalEntries: [entry, ...state.journalEntries] };
  saveAccounts(next);

  // Parallel run: the same entry also goes to the Ledger v2 server book, so
  // the two can be compared before any read is cut over. No-ops unless the
  // mirror flag is on, and never blocks the desk.
  void import("@/lib/ledger/mirror").then(({ mirrorJournalToLedger }) => {
    mirrorJournalToLedger(entry, next);
  });

  return { ok: true, entry };
}

export function resolveFiscalYearForDate(
  date: string,
  state?: AccountsState,
): FiscalYear | undefined {
  const s = state ?? loadAccounts();
  return s.fiscalYears.find(
    (fy) => fy.startDate <= date && fy.endDate >= date,
  );
}

export function setFiscalYearStatus(
  code: string,
  status: FiscalYearStatus,
): { ok: true; fiscalYear: FiscalYear } | { ok: false; error: string } {
  const state = loadAccounts();
  const fy = state.fiscalYears.find((f) => f.code === code);
  if (!fy) return fail("Fiscal year not found");
  const updated = { ...fy, status };
  saveAccounts({
    ...state,
    fiscalYears: state.fiscalYears.map((f) => (f.code === code ? updated : f)),
  });
  return { ok: true, fiscalYear: updated };
}

export function listJournals(state?: AccountsState): JournalEntry[] {
  const s = state ?? loadAccounts();
  return [...s.journalEntries].sort((a, b) => {
    const byDate = b.date.localeCompare(a.date);
    return byDate !== 0 ? byDate : b.createdAt.localeCompare(a.createdAt);
  });
}

/** Active (non-void) journal lines for one COA in a period, with running balance. */
export function coaLedgerRows(
  coaId: string,
  from: string,
  to: string,
  state?: AccountsState,
): {
  date: string;
  voucherNo: string;
  narration: string;
  sourceType: string;
  debitPaise: number;
  creditPaise: number;
  balancePaise: number;
}[] {
  const s = state ?? loadAccounts();
  const coa = s.coaAccounts.find((c) => c.id === coaId);
  if (!coa) return [];
  const debitNormal = coa.group === "assets" || coa.group === "expense";
  const lines: {
    date: string;
    voucherNo: string;
    narration: string;
    sourceType: string;
    debitPaise: number;
    creditPaise: number;
    sortKey: string;
  }[] = [];
  for (const entry of s.journalEntries) {
    if (entry.voidedAt) continue;
    if (entry.date < from || entry.date > to) continue;
    for (const line of entry.lines) {
      if (line.coaId !== coaId) continue;
      if (!line.debitPaise && !line.creditPaise) continue;
      lines.push({
        date: entry.date,
        voucherNo: entry.voucherNo || entry.id.slice(-8),
        narration: line.narration || entry.narration,
        sourceType: entry.sourceType,
        debitPaise: line.debitPaise,
        creditPaise: line.creditPaise,
        sortKey: `${entry.date}_${entry.createdAt}`,
      });
    }
  }
  lines.sort((a, b) => a.sortKey.localeCompare(b.sortKey));
  let bal = 0;
  return lines.map((l) => {
    bal += debitNormal
      ? l.debitPaise - l.creditPaise
      : l.creditPaise - l.debitPaise;
    return {
      date: l.date,
      voucherNo: l.voucherNo,
      narration: l.narration,
      sourceType: l.sourceType,
      debitPaise: l.debitPaise,
      creditPaise: l.creditPaise,
      balancePaise: bal,
    };
  });
}

/** Group-wise totals from trial balance (assets / liabilities / …). */
export function voidJournalEntry(
  journalId: string,
  reason = "",
): { ok: true } | { ok: false; error: string } {
  const state = loadAccounts();
  const entry = state.journalEntries.find((j) => j.id === journalId);
  if (!entry) return fail("Journal not found");
  if (entry.voidedAt) return fail("Already cancelled");
  const now = new Date().toISOString();
  saveAccounts({
    ...state,
    journalEntries: state.journalEntries.map((j) =>
      j.id === journalId
        ? { ...j, voidedAt: now, cancelReason: reason.trim() || j.cancelReason }
        : j,
    ),
  });
  return { ok: true };
}

