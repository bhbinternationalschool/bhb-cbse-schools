/**
 * Library counter — the pure pieces the server routes and the screen share:
 * reading what was scanned or typed, due dates, and fine-to-date for loans
 * still out. No I/O here (selftest: libraryFine.selftest.ts).
 */

import { computeLateFine, isoDayNumber, type LibraryFineRule } from "@/lib/libraryFine";

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

/** Tender modes a fine can be paid in, and the ledger account each lands in. */
export const LIBRARY_FINE_MODES = [
  { id: "cash", label: "Cash", accountCode: "1000" },
  { id: "upi", label: "UPI", accountCode: "1010" },
  { id: "bank", label: "Bank transfer", accountCode: "1010" },
] as const;

export type LibraryFineMode = (typeof LIBRARY_FINE_MODES)[number]["id"];

/** Ledger account a fine is debited to, or null for a mode we do not take. */
export function fineDebitAccount(mode: string): string | null {
  return LIBRARY_FINE_MODES.find((m) => m.id === mode)?.accountCode ?? null;
}

/** Fines are credited to Other Income (4100): not fee income, and no fee head. */
export const LIBRARY_FINE_INCOME_ACCOUNT = "4100";
