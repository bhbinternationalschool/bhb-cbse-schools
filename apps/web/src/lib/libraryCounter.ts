/**
 * Library counter — the pure pieces the server routes and the screen share:
 * reading what was scanned or typed, due dates, and fine-to-date for loans
 * still out. No I/O here (selftest: libraryFine.selftest.ts).
 */

import { istDateString } from "@bhb/time";
import { computeLateFine, isoDayNumber, type LibraryFineRule } from "@/lib/libraryFine";

/** Today in IST — the school's calendar day, not UTC's (a 1 a.m. return is today, not yesterday). */
export function libraryToday(now: Date = new Date()): string {
  return istDateString(now);
}

/** What a label's barcode/QR carries and what a scanner types: the accession number. */
const CODE_RE = /^[A-Za-z0-9][A-Za-z0-9\-_/.]{0,63}$/;

export function normalizeAccessionCode(raw: string): string | null {
  const s = String(raw ?? "").trim();
  if (!s || !CODE_RE.test(s)) return null;
  return s;
}

/**
 * A box the librarian scans several books into: one code per line (a USB
 * scanner ends each with Enter), or separated by commas/spaces. Order kept,
 * repeats dropped (a double scan must not try to issue the same copy twice),
 * and anything that is not a code reported back rather than ignored.
 */
export function splitScannedCodes(text: string): { codes: string[]; rejected: string[] } {
  const seen = new Set<string>();
  const codes: string[] = [];
  const rejected: string[] = [];
  for (const part of String(text ?? "").split(/[\s,;]+/)) {
    if (!part) continue;
    const code = normalizeAccessionCode(part);
    if (!code) {
      rejected.push(part);
      continue;
    }
    const key = code.toUpperCase();
    if (seen.has(key)) continue;
    seen.add(key);
    codes.push(code);
  }
  return { codes, rejected };
}

/** Due date = issue date + loan days, or null when the issue date is not a date. */
export function dueDateFor(issuedOn: string, loanDays: number): string | null {
  const day = isoDayNumber(issuedOn);
  if (day == null || !Number.isInteger(loanDays) || loanDays < 1) return null;
  return new Date((day + loanDays) * 86_400_000).toISOString().slice(0, 10);
}

/**
 * What a loan still out would owe if it came back on `asOf`. null when the
 * dates cannot be read — the screen shows "?" rather than ₹0.
 */
export function fineToDate(
  rule: Partial<LibraryFineRule>,
  loan: { dueOn: string; returnedOn?: string | null },
  asOf: string,
): number | null {
  if (loan.returnedOn) return null;
  const r = computeLateFine(rule, loan.dueOn, asOf);
  return r.ok ? r.finePaise : null;
}

export type LibraryBorrowerRef = { type: "student" | "staff"; id: string };

/** The key library_desk_issues.student_id holds (staff carry a "staff:" prefix). */
export function borrowerKey(b: LibraryBorrowerRef): string {
  return b.type === "staff" ? `staff:${b.id}` : b.id;
}

export const LIBRARY_COPY_SOURCES = [
  { id: "purchase", label: "Purchased" },
  { id: "donation", label: "Donated" },
  { id: "in_house", label: "In-house" },
] as const;

export type LibraryCopySource = (typeof LIBRARY_COPY_SOURCES)[number]["id"];

export function isCopySource(v: unknown): v is LibraryCopySource {
  return LIBRARY_COPY_SOURCES.some((s) => s.id === v);
}

/** Tender modes a fine can be paid in. Non-cash lands in a named bank account. */
export const LIBRARY_FINE_MODES = [
  { id: "cash", label: "Cash" },
  { id: "upi", label: "UPI" },
  { id: "bank", label: "Bank transfer" },
] as const;

export type LibraryFineMode = (typeof LIBRARY_FINE_MODES)[number]["id"];

/** Cash in Hand. */
export const LIBRARY_FINE_CASH_ACCOUNT = "1000";
/** The bank group heading: money is never posted here, only to a bank under it. */
export const LEDGER_BANK_GROUP = "1010";

/** A ledger bank account a fine can be paid into (a sub-account of 1010 tied to a desk bank account). */
export type FineBankAccount = { code: string; name: string; bankAccountId: string };

/**
 * The ledger line a fine is debited to: Cash 1000 for cash; for UPI/bank,
 * the bank account the clerk chose — which must be one of the school's real
 * bank accounts (never the 1010 heading, never a guess).
 */
export function fineDebitLine(
  mode: string,
  bankCode: string | undefined,
  banks: FineBankAccount[],
):
  | { ok: true; accountCode: string; subledger?: { kind: "bank_account"; id: string } }
  | { ok: false; error: string } {
  if (mode === "cash") return { ok: true, accountCode: LIBRARY_FINE_CASH_ACCOUNT };
  if (mode !== "upi" && mode !== "bank") return { ok: false, error: "Choose how the fine was paid (cash, UPI or bank)" };
  if (!banks.length) return { ok: false, error: "No bank account is set up in Accounts — take this fine in cash, or add the bank account first" };
  if (!bankCode) return { ok: false, error: "Choose which bank account received it" };
  if (bankCode === LEDGER_BANK_GROUP) return { ok: false, error: "1010 is the bank heading — choose the actual bank account" };
  const bank = banks.find((b) => b.code === bankCode);
  if (!bank) return { ok: false, error: "That is not one of the school's bank accounts" };
  return { ok: true, accountCode: bank.code, subledger: { kind: "bank_account", id: bank.bankAccountId } };
}

/** Fines are credited to Other Income (4100): not fee income, and no fee head. */
export const LIBRARY_FINE_INCOME_ACCOUNT = "4100";

/**
 * Which named deletes a library save may carry out. A copy that was ever
 * lent, or a title with such a copy, is KEPT — deleting it would take its
 * loans, fines and receipt links with it. A title that may go takes all its
 * (never-lent) copies with it, named here, so the database's RESTRICT key
 * never meets a leftover copy.
 */
export function planLibraryDeletes(input: {
  titleIds: readonly string[];
  copyIds: readonly string[];
  /** Every stored copy of the named titles, plus the named copies: id → title id. */
  copyTitle: ReadonlyMap<string, string>;
  /** Copies with any loan row, open or returned. */
  lentCopyIds: ReadonlySet<string>;
}): { titleIds: string[]; copyIds: string[]; refusedTitleIds: string[]; refusedCopyIds: string[] } {
  const refusedTitles = new Set<string>();
  for (const t of input.titleIds) {
    for (const [copy, title] of input.copyTitle) {
      if (title === t && input.lentCopyIds.has(copy)) refusedTitles.add(t);
    }
  }
  const titleIds = [...new Set(input.titleIds)].filter((t) => !refusedTitles.has(t));
  const keepTitle = new Set(titleIds);
  const copies = new Set<string>();
  const refusedCopies = new Set<string>();
  for (const c of input.copyIds) {
    if (input.lentCopyIds.has(c)) refusedCopies.add(c);
    else if (!refusedTitles.has(input.copyTitle.get(c) ?? "")) copies.add(c);
  }
  for (const [copy, title] of input.copyTitle) {
    if (keepTitle.has(title) && !input.lentCopyIds.has(copy)) copies.add(copy);
  }
  return {
    titleIds,
    copyIds: [...copies],
    refusedTitleIds: [...refusedTitles],
    refusedCopyIds: [...refusedCopies],
  };
}

/** What the office sees when this build runs before its migration was applied. */
export const LIBRARY_NOT_MIGRATED =
  "Library update pending — the database has not been migrated yet (20261011160000_library_upgrade). Ask the office admin to apply it; nothing was changed.";

/**
 * Does a database error mean "this build's columns/functions are not there
 * yet" (deployed before the migration)? Postgres 42703 / 42883, and
 * PostgREST's schema-cache misses, mentioning a library object.
 */
export function isLibraryMigrationPending(message: string): boolean {
  const m = String(message ?? "");
  if (!/library_|fine_grace_days|fine_cap_paise|fine_status|fine_voucher|location|returned_by/.test(m)) return false;
  return /does not exist|Could not find the function|schema cache|42703|42883|PGRST20[02]/.test(m);
}
