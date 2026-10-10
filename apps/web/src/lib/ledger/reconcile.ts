/**
 * Ledger v2 — matching a bank statement against the book.
 *
 * Pure functions: parsing, hashing, and the matching rules. No database, so
 * every judgement about what counts as a match can be tested directly.
 *
 * The sign convention, stated once because it is where reconciliations go
 * wrong: the bank's "credit" is money arriving, which the book records as a
 * DEBIT to the bank account. Everything here is normalised to the book's view
 * — `signedPaise`, positive for money in — before anything is compared.
 */

import { createHash } from "node:crypto";

export type StatementDirection = "credit" | "debit";
export type MatchConfidence = "exact" | "strong" | "weak" | "manual";

export type ParsedStatementLine = {
  lineNo: number;
  txnDate: string;
  valueDate: string | null;
  amountPaise: number;
  direction: StatementDirection;
  narration: string;
  ref: string;
  balancePaise: number | null;
  rowHash: string;
  /** Book convention: positive is money into the bank. */
  signedPaise: number;
};

export type BankBookLine = {
  ledgerLineId: string;
  voucherDate: string;
  voucherNo: string;
  narration: string;
  instrumentRef: string;
  instrumentMode: string;
  /** Book convention: positive is money into the bank. */
  signedPaise: number;
  alreadyMatched: boolean;
};

/* ─── Parsing ──────────────────────────────────────────────── */

/**
 * Bank exports agree on almost nothing, so the column names are matched by
 * intent rather than by a fixed schema. Every Indian bank CSV this was built
 * against uses some spelling of these.
 */
const HEADER_ALIASES: Record<string, string[]> = {
  txnDate: ["txn date", "transaction date", "date", "tran date", "post date", "value dt"],
  valueDate: ["value date", "value dt", "val date"],
  narration: ["narration", "description", "particulars", "remarks", "transaction remarks", "details"],
  ref: ["ref no", "reference", "chq no", "cheque no", "chq./ref.no.", "ref no./cheque no", "utr", "transaction id", "chq/ref number"],
  debit: ["debit", "withdrawal", "withdrawal amt", "dr", "withdrawal amount", "debit amount"],
  credit: ["credit", "deposit", "deposit amt", "cr", "deposit amount", "credit amount"],
  amount: ["amount", "txn amount", "transaction amount"],
  drcr: ["dr/cr", "type", "cr/dr", "transaction type"],
  balance: ["balance", "closing balance", "running balance", "balance amt"],
};

function normaliseHeader(h: string): string {
  return h.trim().toLowerCase().replace(/[_\s]+/g, " ").replace(/[."]/g, "");
}

function resolveColumns(headers: string[]): Record<string, number> {
  const out: Record<string, number> = {};
  const norm = headers.map(normaliseHeader);
  for (const [field, aliases] of Object.entries(HEADER_ALIASES)) {
    const idx = norm.findIndex((h) => aliases.includes(h));
    if (idx >= 0) out[field] = idx;
  }
  return out;
}

/** "1,23,456.78" / "(1234.50)" / "1234.5 Cr" → paise. Empty → null. */
export function parseAmountToPaise(raw: string): number | null {
  if (raw == null) return null;
  let s = String(raw).trim();
  if (!s) return null;
  const negative = /^\(.*\)$/.test(s) || /-\s*$/.test(s) || /^-/.test(s);
  s = s.replace(/[()]/g, "").replace(/(cr|dr)\.?$/i, "").replace(/[₹,\s]/g, "").replace(/-/g, "");
  if (!s || !/^\d*\.?\d*$/.test(s)) return null;
  const n = Number(s);
  if (!Number.isFinite(n)) return null;
  // Round at the paise, never truncate: a statement in rupees to two places
  // must land on the same integer the book used.
  const paise = Math.round(n * 100);
  return negative ? -paise : paise;
}

/** Accepts dd/mm/yyyy, dd-mm-yyyy, yyyy-mm-dd, dd-MMM-yy. */
export function parseStatementDate(raw: string): string | null {
  if (!raw) return null;
  const s = String(raw).trim();
  let m = /^(\d{4})-(\d{2})-(\d{2})/.exec(s);
  if (m) return `${m[1]}-${m[2]}-${m[3]}`;
  m = /^(\d{1,2})[/-](\d{1,2})[/-](\d{2,4})/.exec(s);
  if (m) {
    const d = m[1].padStart(2, "0");
    const mo = m[2].padStart(2, "0");
    let y = m[3];
    if (y.length === 2) y = Number(y) > 70 ? `19${y}` : `20${y}`;
    return `${y}-${mo}-${d}`;
  }
  const MONTHS = ["jan", "feb", "mar", "apr", "may", "jun", "jul", "aug", "sep", "oct", "nov", "dec"];
  m = /^(\d{1,2})[-\s]([A-Za-z]{3})[a-z]*[-\s](\d{2,4})/.exec(s);
  if (m) {
    const mi = MONTHS.indexOf(m[2].toLowerCase());
    if (mi >= 0) {
      let y = m[3];
      if (y.length === 2) y = Number(y) > 70 ? `19${y}` : `20${y}`;
      return `${y}-${String(mi + 1).padStart(2, "0")}-${m[1].padStart(2, "0")}`;
    }
  }
  return null;
}

/** Split a CSV row, honouring quoted fields. */
function splitCsvRow(row: string): string[] {
  const out: string[] = [];
  let cur = "";
  let inQuotes = false;
  for (let i = 0; i < row.length; i += 1) {
    const c = row[i];
    if (c === '"') {
      if (inQuotes && row[i + 1] === '"') {
        cur += '"';
        i += 1;
      } else inQuotes = !inQuotes;
    } else if (c === "," && !inQuotes) {
      out.push(cur);
      cur = "";
    } else cur += c;
  }
  out.push(cur);
  return out;
}

/**
 * The content hash a re-import is deduplicated on.
 *
 * Deliberately excludes the running balance: some banks recompute it when a
 * statement is re-exported over a wider range, and a line is the same line
 * whether or not the balance column drifted.
 */
export function statementRowHash(input: {
  bankSubledgerId: string;
  txnDate: string;
  amountPaise: number;
  direction: StatementDirection;
  narration: string;
  ref: string;
}): string {
  return createHash("sha256")
    .update(
      [
        input.bankSubledgerId,
        input.txnDate,
        String(input.amountPaise),
        input.direction,
        input.narration.trim().replace(/\s+/g, " ").toLowerCase(),
        input.ref.trim().toLowerCase(),
      ].join("|"),
    )
    .digest("hex");
}

export type ParseResult = {
  lines: ParsedStatementLine[];
  skipped: { lineNo: number; raw: string; reason: string }[];
  columns: Record<string, number>;
};

/**
 * Parse a bank CSV export into statement lines.
 *
 * A row that cannot be understood is reported, never guessed at — a bank
 * statement with a silently dropped row is worse than one that failed to
 * import, because the reconciliation will look clean and be wrong.
 */
export function parseBankStatementCsv(input: {
  csv: string;
  bankSubledgerId: string;
}): ParseResult {
  const rows = input.csv
    .split(/\r?\n/)
    .map((r) => r.trim())
    .filter((r) => r.length > 0);

  const skipped: ParseResult["skipped"] = [];
  if (rows.length === 0) return { lines: [], skipped, columns: {} };

  // The header is not always the first row — statements often carry a few
  // lines of account preamble first.
  let headerIdx = -1;
  let columns: Record<string, number> = {};
  for (let i = 0; i < Math.min(rows.length, 25); i += 1) {
    const cols = resolveColumns(splitCsvRow(rows[i]!));
    if (cols.txnDate !== undefined && (cols.debit !== undefined || cols.credit !== undefined || cols.amount !== undefined)) {
      headerIdx = i;
      columns = cols;
      break;
    }
  }
  if (headerIdx < 0) {
    return {
      lines: [],
      skipped: [{ lineNo: 0, raw: rows[0] ?? "", reason: "no recognisable header row (need a date column and a debit/credit or amount column)" }],
      columns: {},
    };
  }

  const lines: ParsedStatementLine[] = [];
  for (let i = headerIdx + 1; i < rows.length; i += 1) {
    const raw = rows[i]!;
    const cells = splitCsvRow(raw);
    const cell = (k: string) => (columns[k] === undefined ? "" : (cells[columns[k]!] ?? "").trim());

    const txnDate = parseStatementDate(cell("txnDate"));
    if (!txnDate) {
      // Trailing totals and footers land here; they carry no date.
      skipped.push({ lineNo: i + 1, raw, reason: "no readable transaction date" });
      continue;
    }

    let amountPaise: number | null = null;
    let direction: StatementDirection | null = null;

    const debit = parseAmountToPaise(cell("debit"));
    const credit = parseAmountToPaise(cell("credit"));
    if (debit && Math.abs(debit) > 0) {
      amountPaise = Math.abs(debit);
      direction = "debit";
    } else if (credit && Math.abs(credit) > 0) {
      amountPaise = Math.abs(credit);
      direction = "credit";
    } else {
      const amt = parseAmountToPaise(cell("amount"));
      const drcr = cell("drcr").toLowerCase();
      if (amt !== null && amt !== 0) {
        amountPaise = Math.abs(amt);
        if (drcr.startsWith("c")) direction = "credit";
        else if (drcr.startsWith("d")) direction = "debit";
        else direction = amt > 0 ? "credit" : "debit";
      }
    }

    if (amountPaise === null || !direction || amountPaise === 0) {
      skipped.push({ lineNo: i + 1, raw, reason: "no usable amount" });
      continue;
    }

    const narration = cell("narration");
    const ref = cell("ref");
    lines.push({
      lineNo: i + 1,
      txnDate,
      valueDate: parseStatementDate(cell("valueDate")),
      amountPaise,
      direction,
      narration,
      ref,
      balancePaise: parseAmountToPaise(cell("balance")),
      rowHash: statementRowHash({
        bankSubledgerId: input.bankSubledgerId,
        txnDate,
        amountPaise,
        direction,
        narration,
        ref,
      }),
      signedPaise: direction === "credit" ? amountPaise : -amountPaise,
    });
  }

  return { lines, skipped, columns };
}

/* ─── Matching ─────────────────────────────────────────────── */

export type ProposedMatch = {
  statementLineId: string;
  ledgerLineId: string;
  confidence: MatchConfidence;
  reason: string;
};

/** Bank references are written inconsistently; compare them stripped. */
export function normaliseRef(ref: string): string {
  return (ref || "").toLowerCase().replace(/[^a-z0-9]/g, "");
}

function daysBetween(a: string, b: string): number {
  const da = Date.parse(`${a}T00:00:00Z`);
  const db = Date.parse(`${b}T00:00:00Z`);
  if (Number.isNaN(da) || Number.isNaN(db)) return Number.MAX_SAFE_INTEGER;
  return Math.abs(Math.round((da - db) / 86_400_000));
}

export const STRONG_MATCH_WINDOW_DAYS = 3;
export const WEAK_MATCH_WINDOW_DAYS = 10;

/**
 * Match statement lines to book lines.
 *
 * Three passes, strongest first, because a weaker rule must never consume a
 * line that a stronger one would have claimed. Within a pass, candidates are
 * taken in date order so that two identical amounts land in the order they
 * occurred rather than in whatever order the query returned.
 *
 * Amount and direction must agree exactly, always. Only the reference and the
 * date tolerance vary between passes: a rupee difference is a different
 * transaction, not a weaker match.
 */
export function matchStatementToBook(input: {
  statementLines: (ParsedStatementLine & { id: string })[];
  bookLines: BankBookLine[];
}): { matches: ProposedMatch[]; unmatchedStatement: string[]; unmatchedBook: string[] } {
  const stmt = [...input.statementLines]
    .filter((s) => !("matched" in s))
    .sort((a, b) => a.txnDate.localeCompare(b.txnDate) || a.lineNo - b.lineNo);
  const book = [...input.bookLines]
    .filter((b) => !b.alreadyMatched)
    .sort((a, b) => a.voucherDate.localeCompare(b.voucherDate));

  const usedStmt = new Set<string>();
  const usedBook = new Set<string>();
  const matches: ProposedMatch[] = [];

  const claim = (s: { id: string }, b: BankBookLine, confidence: MatchConfidence, reason: string) => {
    usedStmt.add(s.id);
    usedBook.add(b.ledgerLineId);
    matches.push({
      statementLineId: s.id,
      ledgerLineId: b.ledgerLineId,
      confidence,
      reason,
    });
  };

  // Pass 1 — the bank's own reference, plus the amount.
  for (const s of stmt) {
    if (usedStmt.has(s.id)) continue;
    const sref = normaliseRef(s.ref);
    if (!sref) continue;
    const hit = book.find(
      (b) =>
        !usedBook.has(b.ledgerLineId) &&
        b.signedPaise === s.signedPaise &&
        normaliseRef(b.instrumentRef) !== "" &&
        normaliseRef(b.instrumentRef) === sref,
    );
    if (hit) claim(s, hit, "exact", `reference ${s.ref} and amount both match`);
  }

  // Pass 2 — amount and direction, within a few days.
  for (const s of stmt) {
    if (usedStmt.has(s.id)) continue;
    const candidates = book
      .filter(
        (b) =>
          !usedBook.has(b.ledgerLineId) &&
          b.signedPaise === s.signedPaise &&
          daysBetween(b.voucherDate, s.txnDate) <= STRONG_MATCH_WINDOW_DAYS,
      )
      .sort((a, b) => daysBetween(a.voucherDate, s.txnDate) - daysBetween(b.voucherDate, s.txnDate));
    const hit = candidates[0];
    if (hit) {
      claim(
        s,
        hit,
        "strong",
        `amount matches and the dates are ${daysBetween(hit.voucherDate, s.txnDate)} day(s) apart`,
      );
    }
  }

  // Pass 3 — amount only, further out. Proposed, never applied automatically:
  // at this distance an equal amount is as likely to be a coincidence as a
  // match, and two similar payments a fortnight apart are common.
  for (const s of stmt) {
    if (usedStmt.has(s.id)) continue;
    const candidates = book
      .filter(
        (b) =>
          !usedBook.has(b.ledgerLineId) &&
          b.signedPaise === s.signedPaise &&
          daysBetween(b.voucherDate, s.txnDate) <= WEAK_MATCH_WINDOW_DAYS,
      )
      .sort((a, b) => daysBetween(a.voucherDate, s.txnDate) - daysBetween(b.voucherDate, s.txnDate));
    const hit = candidates[0];
    if (hit) {
      claim(
        s,
        hit,
        "weak",
        `amount matches but the dates are ${daysBetween(hit.voucherDate, s.txnDate)} day(s) apart — confirm before accepting`,
      );
    }
  }

  return {
    matches,
    unmatchedStatement: stmt.filter((s) => !usedStmt.has(s.id)).map((s) => s.id),
    unmatchedBook: book.filter((b) => !usedBook.has(b.ledgerLineId)).map((b) => b.ledgerLineId),
  };
}

/** Confidences safe to apply without a person looking. */
export const AUTO_APPLY_CONFIDENCES: MatchConfidence[] = ["exact", "strong"];

export function isAutoApplicable(c: MatchConfidence): boolean {
  return AUTO_APPLY_CONFIDENCES.includes(c);
}

/* ─── Reconciliation arithmetic ────────────────────────────── */

export type ReconSummary = {
  bankSubledgerId: string;
  asOf: string;
  bookBalancePaise: number;
  statementClosingPaise: number | null;
  /** In the book, not yet on the statement — cheques issued, deposits in transit. */
  unpresentedPaise: number;
  /** On the statement, not yet in the book — charges, interest, direct credits. */
  unrecordedPaise: number;
  /** Book balance adjusted for both. Should equal the statement's closing balance. */
  reconciledPaise: number;
  reconciles: boolean;
  unmatchedBookCount: number;
  unmatchedStatementCount: number;
};

/**
 * The bank reconciliation statement, as arithmetic.
 *
 *   book balance
 *     − what the book has recorded that the bank has not yet seen
 *     + what the bank has recorded that the book has not
 *   = the bank's closing balance
 *
 * When that identity holds, the month is reconciled and the two unmatched
 * lists are the explanation. When it does not, something is wrong that neither
 * side has noticed — which is the entire reason for doing this.
 */
export function summariseReconciliation(input: {
  bankSubledgerId: string;
  asOf: string;
  bookBalancePaise: number;
  statementClosingPaise: number | null;
  unmatchedBookSignedPaise: number[];
  unmatchedStatementSignedPaise: number[];
}): ReconSummary {
  const unpresented = input.unmatchedBookSignedPaise.reduce((n, v) => n + v, 0);
  const unrecorded = input.unmatchedStatementSignedPaise.reduce((n, v) => n + v, 0);
  const reconciled = input.bookBalancePaise - unpresented + unrecorded;

  return {
    bankSubledgerId: input.bankSubledgerId,
    asOf: input.asOf,
    bookBalancePaise: input.bookBalancePaise,
    statementClosingPaise: input.statementClosingPaise,
    unpresentedPaise: unpresented,
    unrecordedPaise: unrecorded,
    reconciledPaise: reconciled,
    reconciles:
      input.statementClosingPaise !== null && reconciled === input.statementClosingPaise,
    unmatchedBookCount: input.unmatchedBookSignedPaise.length,
    unmatchedStatementCount: input.unmatchedStatementSignedPaise.length,
  };
}
