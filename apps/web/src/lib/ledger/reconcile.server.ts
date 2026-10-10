/**
 * Ledger v2 — bank reconciliation against the server book.
 *
 * Import a statement, match it, and produce the reconciliation. The rules live
 * in reconcile.ts; this is the part that talks to the database.
 *
 * Two things it deliberately will not do:
 *
 *   - Apply a weak match. An equal amount ten days from an equal amount is as
 *     likely to be a coincidence as a match, and a wrong match is worse than
 *     no match: it hides the very discrepancy the reconciliation exists to
 *     surface. Weak matches are returned as proposals for a person.
 *   - Post anything on its own. A statement line with nothing in the book —
 *     a bank charge, interest credited, a cheque that finally cleared — is
 *     reported with a suggested entry, and somebody decides. Money is not
 *     moved by a matching heuristic.
 */

import { getServerTenantContext } from "@/lib/serverTenant";
import {
  isAutoApplicable,
  matchStatementToBook,
  parseBankStatementCsv,
  summariseReconciliation,
  type BankBookLine,
  type MatchConfidence,
  type ParsedStatementLine,
  type ProposedMatch,
  type ReconSummary,
} from "@/lib/ledger/reconcile";
import { L_BANK, L_CHEQUES_IN_HAND } from "@/lib/ledger/coa";

export type ImportResult = {
  ok: boolean;
  error?: string;
  statementId?: string;
  parsed: number;
  inserted: number;
  duplicates: number;
  skipped: { lineNo: number; raw: string; reason: string }[];
};

/**
 * Import a bank CSV.
 *
 * Re-importing an overlapping range is normal — a month-end export usually
 * repeats the last statement's tail — so lines are deduplicated on their
 * content hash and a repeat import inserts nothing new.
 */
export async function importBankStatementCsv(input: {
  bankSubledgerId: string;
  statementRef: string;
  csv: string;
  openingBalancePaise?: number | null;
  closingBalancePaise?: number | null;
  importedBy?: string;
}): Promise<ImportResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    return { ok: false, error: "Supabase tenant not configured", parsed: 0, inserted: 0, duplicates: 0, skipped: [] };
  }
  const { sb, tenantId } = ctx;

  if (!input.bankSubledgerId) {
    return { ok: false, error: "a bank account is required", parsed: 0, inserted: 0, duplicates: 0, skipped: [] };
  }

  const parsed = parseBankStatementCsv({
    csv: input.csv,
    bankSubledgerId: input.bankSubledgerId,
  });
  if (parsed.lines.length === 0) {
    return {
      ok: false,
      error: parsed.skipped[0]?.reason ?? "no usable rows in the file",
      parsed: 0,
      inserted: 0,
      duplicates: 0,
      skipped: parsed.skipped,
    };
  }

  const dates = parsed.lines.map((l) => l.txnDate).sort();
  const { data: stmt, error: stmtErr } = await sb
    .from("ledger_bank_statements")
    .upsert(
      {
        tenant_id: tenantId,
        bank_subledger_id: input.bankSubledgerId,
        statement_ref: input.statementRef || `${dates[0]}..${dates[dates.length - 1]}`,
        from_date: dates[0],
        to_date: dates[dates.length - 1],
        opening_balance_paise: input.openingBalancePaise ?? null,
        closing_balance_paise: input.closingBalancePaise ?? null,
        imported_by: input.importedBy ?? "",
      },
      { onConflict: "tenant_id,bank_subledger_id,statement_ref" },
    )
    .select("id")
    .single();
  if (stmtErr || !stmt) {
    return {
      ok: false,
      error: stmtErr?.message ?? "could not record the statement",
      parsed: parsed.lines.length,
      inserted: 0,
      duplicates: 0,
      skipped: parsed.skipped,
    };
  }
  const statementId = String((stmt as { id: string }).id);

  const { data: seen } = await sb
    .from("ledger_bank_statement_lines")
    .select("row_hash")
    .eq("tenant_id", tenantId)
    .in("row_hash", parsed.lines.map((l) => l.rowHash));
  const already = new Set(((seen ?? []) as { row_hash: string }[]).map((r) => r.row_hash));

  const fresh = parsed.lines.filter((l) => !already.has(l.rowHash));
  let inserted = 0;
  for (let i = 0; i < fresh.length; i += 200) {
    const chunk = fresh.slice(i, i + 200);
    const { error } = await sb.from("ledger_bank_statement_lines").insert(
      chunk.map((l) => ({
        tenant_id: tenantId,
        statement_id: statementId,
        bank_subledger_id: input.bankSubledgerId,
        line_no: l.lineNo,
        txn_date: l.txnDate,
        value_date: l.valueDate,
        amount_paise: l.amountPaise,
        direction: l.direction,
        narration: l.narration,
        ref: l.ref,
        balance_paise: l.balancePaise,
        row_hash: l.rowHash,
      })),
    );
    if (error) {
      return {
        ok: false,
        error: error.message,
        statementId,
        parsed: parsed.lines.length,
        inserted,
        duplicates: already.size,
        skipped: parsed.skipped,
      };
    }
    inserted += chunk.length;
  }

  return {
    ok: true,
    statementId,
    parsed: parsed.lines.length,
    inserted,
    duplicates: already.size,
    skipped: parsed.skipped,
  };
}

/* ─── Reading both sides ───────────────────────────────────── */

async function readBankBook(bankSubledgerId: string, asOf?: string) {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  let q = ctx.sb
    .from("ledger_v_bank_book")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("bank_subledger_id", bankSubledgerId);
  if (asOf) q = q.lte("voucher_date", asOf);
  const { data } = await q;
  return ((data ?? []) as Record<string, unknown>[]).map<BankBookLine>((r) => ({
    ledgerLineId: String(r.ledger_line_id),
    voucherDate: String(r.voucher_date ?? ""),
    voucherNo: String(r.voucher_no ?? ""),
    narration: String(r.line_narration || r.voucher_narration || ""),
    instrumentRef: String(r.instrument_ref ?? ""),
    instrumentMode: String(r.instrument_mode ?? ""),
    signedPaise: Number(r.signed_paise ?? 0),
    alreadyMatched: !!r.match_id,
  }));
}

async function readStatementLines(bankSubledgerId: string, asOf?: string) {
  const ctx = await getServerTenantContext();
  if (!ctx) return [];
  let q = ctx.sb
    .from("ledger_v_statement_lines")
    .select("*")
    .eq("tenant_id", ctx.tenantId)
    .eq("bank_subledger_id", bankSubledgerId);
  if (asOf) q = q.lte("txn_date", asOf);
  const { data } = await q;
  return ((data ?? []) as Record<string, unknown>[]).map((r) => ({
    id: String(r.statement_line_id),
    lineNo: 0,
    txnDate: String(r.txn_date ?? ""),
    valueDate: null,
    amountPaise: Number(r.amount_paise ?? 0),
    direction: String(r.direction ?? "credit") as ParsedStatementLine["direction"],
    narration: String(r.narration ?? ""),
    ref: String(r.ref ?? ""),
    balancePaise: r.balance_paise === null ? null : Number(r.balance_paise),
    rowHash: "",
    signedPaise: Number(r.signed_paise ?? 0),
    alreadyMatched: !!r.match_id,
  }));
}

/* ─── Matching ─────────────────────────────────────────────── */

export type AutoMatchResult = {
  ok: boolean;
  error?: string;
  applied: number;
  proposed: (ProposedMatch & { statementNarration: string; bookNarration: string })[];
  unmatchedStatement: number;
  unmatchedBook: number;
};

export async function autoMatchBank(input: {
  bankSubledgerId: string;
  asOf?: string;
  matchedBy?: string;
  /** Apply only what is safe without a person; weak matches stay proposals. */
  applyAuto?: boolean;
}): Promise<AutoMatchResult> {
  const ctx = await getServerTenantContext();
  if (!ctx) {
    return { ok: false, error: "Supabase tenant not configured", applied: 0, proposed: [], unmatchedStatement: 0, unmatchedBook: 0 };
  }

  const [book, statement] = await Promise.all([
    readBankBook(input.bankSubledgerId, input.asOf),
    readStatementLines(input.bankSubledgerId, input.asOf),
  ]);

  const openStatement = statement.filter((s) => !s.alreadyMatched);
  const result = matchStatementToBook({
    statementLines: openStatement.map((s) => ({ ...s, id: s.id })),
    bookLines: book,
  });

  const narrationByStatement = new Map(openStatement.map((s) => [s.id, s.narration]));
  const narrationByBook = new Map(book.map((b) => [b.ledgerLineId, b.narration || b.voucherNo]));

  const toApply = input.applyAuto === false
    ? []
    : result.matches.filter((m) => isAutoApplicable(m.confidence));

  let applied = 0;
  if (toApply.length > 0) {
    const { error } = await ctx.sb.from("ledger_recon_matches").insert(
      toApply.map((m) => ({
        tenant_id: ctx.tenantId,
        statement_line_id: m.statementLineId,
        ledger_line_id: m.ledgerLineId,
        confidence: m.confidence,
        matched_by: input.matchedBy ?? "auto",
        note: m.reason,
      })),
    );
    if (error) {
      return { ok: false, error: error.message, applied: 0, proposed: [], unmatchedStatement: 0, unmatchedBook: 0 };
    }
    applied = toApply.length;
  }

  const appliedIds = new Set(toApply.map((m) => m.statementLineId));
  const proposed = result.matches
    .filter((m) => !appliedIds.has(m.statementLineId))
    .map((m) => ({
      ...m,
      statementNarration: narrationByStatement.get(m.statementLineId) ?? "",
      bookNarration: narrationByBook.get(m.ledgerLineId) ?? "",
    }));

  return {
    ok: true,
    applied,
    proposed,
    unmatchedStatement: result.unmatchedStatement.length,
    unmatchedBook: result.unmatchedBook.length,
  };
}

/** A person's decision, recorded as such. */
export async function applyManualMatch(input: {
  statementLineId: string;
  ledgerLineId: string;
  matchedBy: string;
  note?: string;
}): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { error } = await ctx.sb.from("ledger_recon_matches").insert({
    tenant_id: ctx.tenantId,
    statement_line_id: input.statementLineId,
    ledger_line_id: input.ledgerLineId,
    confidence: "manual" as MatchConfidence,
    matched_by: input.matchedBy,
    note: input.note ?? "",
  });
  return error ? { ok: false, error: error.message } : { ok: true };
}

export async function unmatch(statementLineId: string): Promise<{ ok: boolean; error?: string }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured" };
  const { error } = await ctx.sb
    .from("ledger_recon_matches")
    .delete()
    .eq("tenant_id", ctx.tenantId)
    .eq("statement_line_id", statementLineId);
  return error ? { ok: false, error: error.message } : { ok: true };
}

/* ─── The reconciliation ───────────────────────────────────── */

export type UnexplainedLine = {
  id: string;
  date: string;
  amountPaise: number;
  signedPaise: number;
  narration: string;
  ref: string;
  /** What this most likely is, when the shape of it is recognisable. */
  suggestion?: string;
};

export type BankReconReport = {
  ok: boolean;
  error?: string;
  summary?: ReconSummary;
  /** In the book, not on the statement. */
  unpresented: UnexplainedLine[];
  /** On the statement, not in the book. */
  unrecorded: UnexplainedLine[];
};

/**
 * Suggest what an unrecorded statement line probably is.
 *
 * Only from the bank's own narration, and only as a label for a human to
 * accept — nothing here posts. Anything unrecognised is left blank rather
 * than guessed: "Other income" on a line nobody understood is how a wrong
 * number becomes permanent.
 */
function suggestForStatementLine(narration: string, direction: "credit" | "debit"): string | undefined {
  const n = narration.toLowerCase();
  if (/\b(chrg|charge|fee|commission|comm\b|sms chg|amc)\b/.test(n) && direction === "debit") {
    return "Bank charges — post to an expense account";
  }
  if (/\b(int|interest|int\.pd|intt)\b/.test(n) && direction === "credit") {
    return "Interest credited — post to Other Income";
  }
  if (/\b(rtn|return|reversal|rev|bounce|insufficient|ecs rtn)\b/.test(n)) {
    return "A returned or bounced item — check the original entry";
  }
  if (/\b(neft|imps|upi|rtgs)\b/.test(n) && direction === "credit") {
    return "A direct credit the desk has not recorded — likely a fee receipt";
  }
  return undefined;
}

export async function bankReconciliationReport(input: {
  bankSubledgerId: string;
  asOf: string;
  statementClosingPaise?: number | null;
}): Promise<BankReconReport> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured", unpresented: [], unrecorded: [] };

  const [book, statement] = await Promise.all([
    readBankBook(input.bankSubledgerId, input.asOf),
    readStatementLines(input.bankSubledgerId, input.asOf),
  ]);

  const bookBalance = book.reduce((n, b) => n + b.signedPaise, 0);

  const unpresentedLines = book.filter((b) => !b.alreadyMatched);
  const unrecordedLines = statement.filter((s) => !s.alreadyMatched);

  // Prefer the closing balance the caller gives; otherwise take the running
  // balance from the last statement line, when the bank supplied one.
  let closing = input.statementClosingPaise ?? null;
  if (closing === null && statement.length > 0) {
    const last = [...statement].sort((a, b) => a.txnDate.localeCompare(b.txnDate)).at(-1);
    closing = last?.balancePaise ?? null;
  }

  const summary = summariseReconciliation({
    bankSubledgerId: input.bankSubledgerId,
    asOf: input.asOf,
    bookBalancePaise: bookBalance,
    statementClosingPaise: closing,
    unmatchedBookSignedPaise: unpresentedLines.map((b) => b.signedPaise),
    unmatchedStatementSignedPaise: unrecordedLines.map((s) => s.signedPaise),
  });

  return {
    ok: true,
    summary,
    unpresented: unpresentedLines.map((b) => ({
      id: b.ledgerLineId,
      date: b.voucherDate,
      amountPaise: Math.abs(b.signedPaise),
      signedPaise: b.signedPaise,
      narration: `${b.voucherNo} · ${b.narration}`.trim(),
      ref: b.instrumentRef,
      suggestion:
        b.instrumentMode === "cheque" && b.signedPaise < 0
          ? "A cheque issued but not yet presented"
          : undefined,
    })),
    unrecorded: unrecordedLines.map((s) => ({
      id: s.id,
      date: s.txnDate,
      amountPaise: s.amountPaise,
      signedPaise: s.signedPaise,
      narration: s.narration,
      ref: s.ref,
      suggestion: suggestForStatementLine(s.narration, s.direction),
    })),
  };
}

/* ─── Cheques the bank has now cleared ─────────────────────── */

export type ChequeClearingProposal = {
  statementLineId: string;
  chequeRef: string;
  amountPaise: number;
  clearedOn: string;
  narration: string;
};

/**
 * Cheques sitting in Cheques in Hand that the statement says have landed.
 *
 * Returned as proposals. Posting the clearing entry moves real money between
 * two accounts, so it stays a decision — the statement tells us the cheque
 * cleared, but which cheque, when two carry the same amount, is exactly the
 * judgement a person should make.
 */
export async function proposeChequeClearings(input: {
  bankSubledgerId: string;
  asOf?: string;
}): Promise<{ ok: boolean; error?: string; proposals: ChequeClearingProposal[] }> {
  const ctx = await getServerTenantContext();
  if (!ctx) return { ok: false, error: "Supabase tenant not configured", proposals: [] };

  const { data: chequeLines } = await ctx.sb
    .from("ledger_lines")
    .select("id, debit_paise, credit_paise, instrument_ref, account_id, ledger_accounts!inner(code)")
    .eq("tenant_id", ctx.tenantId)
    .eq("ledger_accounts.code", L_CHEQUES_IN_HAND);

  const inHand = ((chequeLines ?? []) as Record<string, unknown>[])
    .filter((r) => Number(r.debit_paise ?? 0) > 0)
    .map((r) => ({
      amountPaise: Number(r.debit_paise ?? 0),
      ref: String(r.instrument_ref ?? ""),
    }));
  if (inHand.length === 0) return { ok: true, proposals: [] };

  const statement = await readStatementLines(input.bankSubledgerId, input.asOf);
  const proposals: ChequeClearingProposal[] = [];

  for (const s of statement) {
    if (s.alreadyMatched || s.direction !== "credit") continue;
    const hit = inHand.find((c) => c.amountPaise === s.amountPaise);
    if (!hit) continue;
    proposals.push({
      statementLineId: s.id,
      chequeRef: hit.ref || s.ref,
      amountPaise: s.amountPaise,
      clearedOn: s.txnDate,
      narration: s.narration,
    });
  }

  return { ok: true, proposals };
}

/** Well-known code the reconciliation posts against, re-exported for callers. */
export const RECON_BANK_CODE = L_BANK;
