/**
 * The pure half of bank-account verification: the request, the verdict, and
 * the fingerprint that stops the school paying twice for the same check.
 * No network, no env, no clock — testable.
 *
 * WHAT THIS IS FOR. Nothing in the ERP checks a bank account before money is
 * sent to it. A staff member's account number is typed into Masters once and
 * then used every month; a wrong digit surfaces as ₹40,000 gone to a stranger,
 * and the bank will not reverse it. A penny drop asks the bank "does this
 * account exist, and whose name is on it" for ₹1. The only thing that makes
 * that worth doing is doing it BEFORE the first payment, not after a failure.
 *
 * THREE THINGS THIS FILE IS CAREFUL ABOUT.
 *
 * A verification costs money, every time. So results are fingerprinted and
 * cached, and the fingerprint is over the account AND the IFSC — the pair is
 * what was verified, and treating a changed IFSC as the same check would pass
 * off a stale answer as a fresh one.
 *
 * An account number must never be stored or logged in full. The fingerprint is
 * a hash, and everything human-readable is masked. A verification table that
 * quietly became a second copy of everyone's bank details would be a worse
 * problem than the one it set out to solve.
 *
 * A name that nearly matches is not a match. The bank returns the name on the
 * account and a score; this file refuses to turn "close enough" into a silent
 * yes, because the whole value of the check is catching the account that
 * exists but belongs to somebody else.
 */

/** Cashfree's account_status values, plus what we hold before it answers. */
export type BankAccountStatus = "VALID" | "INVALID" | "RECEIVED" | "FAILED";

export type BankVerifyRequest = {
  bank_account: string;
  ifsc: string;
  name?: string;
  phone?: string;
};

export const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * Banks Cashfree cannot verify. Refused before the call so the desk is told
 * why rather than being handed a failure it cannot interpret — and so the
 * school is not billed for a check that was never going to work.
 */
const UNVERIFIABLE_BANK_PREFIXES = ["DEUT", "PYTM"] as const;

export function ifscLooksValid(ifsc: string): boolean {
  return IFSC_RE.test((ifsc || "").trim().toUpperCase());
}

export function bankIsUnverifiable(ifsc: string): boolean {
  const code = (ifsc || "").trim().toUpperCase().slice(0, 4);
  return (UNVERIFIABLE_BANK_PREFIXES as readonly string[]).includes(code);
}

/** Everything after the last four digits hidden. Used on screen and in logs. */
export function maskAccount(accountNumber: string): string {
  const digits = (accountNumber || "").replace(/\s/g, "");
  if (digits.length <= 4) return "•".repeat(Math.max(0, digits.length));
  return `${"•".repeat(digits.length - 4)}${digits.slice(-4)}`;
}

export function buildBankVerifyRequest(input: {
  accountNumber: string;
  ifsc: string;
  /** Sent only when known: it turns the check into a name match too. */
  name?: string;
  phone?: string;
}): { ok: true; body: BankVerifyRequest } | { ok: false; error: string } {
  const bank_account = (input.accountNumber || "").replace(/\s/g, "");
  const ifsc = (input.ifsc || "").trim().toUpperCase();

  // Cashfree's own bounds, checked here so a bad row is refused without
  // spending a paid call on it.
  if (bank_account.length < 6 || bank_account.length > 40) {
    return { ok: false, error: "An account number must be 6 to 40 characters" };
  }
  if (!/^[A-Za-z0-9]+$/.test(bank_account)) {
    return { ok: false, error: "An account number must be letters and digits only" };
  }
  if (!ifscLooksValid(ifsc)) {
    return { ok: false, error: `"${ifsc}" is not a valid IFSC` };
  }
  if (bankIsUnverifiable(ifsc)) {
    return {
      ok: false,
      error: "Cashfree cannot verify Deutsche Bank or Paytm Payments Bank accounts",
    };
  }

  const body: BankVerifyRequest = { bank_account, ifsc };
  const name = (input.name || "").trim();
  if (name) body.name = name.slice(0, 120);
  const phone = (input.phone || "").replace(/\D/g, "");
  // Cashfree wants 8–13 digits. A malformed phone is dropped rather than
  // failing the verification: the account is the thing being checked.
  if (phone.length >= 8 && phone.length <= 13) body.phone = phone;
  return { ok: true, body };
}

/**
 * What was verified, as an opaque key.
 *
 * Over the account AND the IFSC, upper-cased and stripped, so the same pair
 * typed with different spacing is one cached result and a changed IFSC is a
 * new check. The caller hashes this; it is never stored as-is.
 */
export function bankFingerprintSource(accountNumber: string, ifsc: string): string {
  return `${(accountNumber || "").replace(/\s/g, "").toUpperCase()}|${(ifsc || "").trim().toUpperCase()}`;
}

export type BankVerifyResult = {
  status: BankAccountStatus;
  /** The name the bank holds against the account. Empty when it did not say. */
  nameAtBank: string;
  /** 0–100 where Cashfree gave one, null where no name was sent to match. */
  nameMatchScore: number | null;
  reference: string;
  message: string;
};

/**
 * Read the verification reply.
 *
 * Null when the payload is not a verification result, so a caller never reads
 * an error body as a VALID account.
 */
export function readBankVerifyResult(payload: unknown): BankVerifyResult | null {
  if (!payload || typeof payload !== "object" || Array.isArray(payload)) return null;
  const p = payload as Record<string, unknown>;
  const raw = String(p.account_status ?? "").trim().toUpperCase();
  if (!raw) return null;

  // Only the two statuses Cashfree documents as conclusive are mapped to
  // themselves. Anything else becomes FAILED rather than being guessed into
  // VALID — an unrecognised status must never read as "safe to pay".
  const status: BankAccountStatus =
    raw === "VALID" ? "VALID" : raw === "INVALID" ? "INVALID" : raw === "RECEIVED" ? "RECEIVED" : "FAILED";

  const score = Number(p.name_match_score);
  return {
    status,
    nameAtBank: String(p.name_at_bank ?? "").trim(),
    nameMatchScore: Number.isFinite(score) ? Math.round(score) : null,
    reference: p.reference != null ? String(p.reference) : "",
    message: String(p.account_status_code ?? p.message ?? "").trim(),
  };
}

export type BankVerdict =
  /** The account exists and the name matches what the school holds. */
  | { kind: "ok"; nameAtBank: string; score: number | null }
  /** The account exists but is in a different name. The dangerous case. */
  | { kind: "name_mismatch"; nameAtBank: string; score: number | null; expected: string }
  /** The account exists; no name was given to check it against. */
  | { kind: "unnamed"; nameAtBank: string }
  /** The bank says no such account. */
  | { kind: "invalid"; message: string }
  /** We could not tell. Never treated as either of the above. */
  | { kind: "unknown"; message: string };

/**
 * A score at or above this is a match. Below it, a human decides.
 *
 * 80 rather than something laxer because the failure this exists to catch is
 * an account that is real and belongs to somebody else — initials, married
 * names and bank abbreviations score well above 80, whereas a different person
 * does not. Set too low, the check silently approves the exact case it was
 * bought to prevent.
 */
export const NAME_MATCH_THRESHOLD = 80;

export function bankVerdict(input: {
  result: BankVerifyResult;
  /** The name the school holds for this person or vendor, if any. */
  expectedName?: string;
}): BankVerdict {
  const { result } = input;
  if (result.status === "INVALID") {
    return { kind: "invalid", message: result.message || "The bank does not recognise this account" };
  }
  if (result.status !== "VALID") {
    // RECEIVED means still in flight; FAILED means we do not know. Neither is
    // a licence to pay, and neither is a reason to say the account is bad.
    return {
      kind: "unknown",
      message:
        result.status === "RECEIVED"
          ? "The bank has not answered yet"
          : result.message || "The verification did not complete",
    };
  }

  const expected = (input.expectedName || "").trim();
  if (!expected) return { kind: "unnamed", nameAtBank: result.nameAtBank };

  // No score from Cashfree but both names present: fall back to an exact
  // comparison after normalising, and treat anything else as a mismatch for a
  // person to look at. Guessing a similarity here would be inventing a score.
  const score = result.nameMatchScore;
  const matched =
    score !== null
      ? score >= NAME_MATCH_THRESHOLD
      : normaliseName(result.nameAtBank) === normaliseName(expected) && !!result.nameAtBank;

  return matched
    ? { kind: "ok", nameAtBank: result.nameAtBank, score }
    : { kind: "name_mismatch", nameAtBank: result.nameAtBank, score, expected };
}

/** Case, punctuation and runs of space removed. Not a similarity measure. */
export function normaliseName(name: string): string {
  return (name || "")
    .toUpperCase()
    .replace(/[^A-Z ]/g, " ")
    .replace(/\s+/g, " ")
    .trim();
}

/** One line for the desk. Never optimistic about a verdict it does not have. */
export function verdictSentence(verdict: BankVerdict): string {
  switch (verdict.kind) {
    case "ok":
      return `Verified — the bank holds this account as ${verdict.nameAtBank}.`;
    case "name_mismatch":
      return `The account exists but the bank holds it as ${verdict.nameAtBank}, not ${verdict.expected}. Do not pay it until somebody has checked.`;
    case "unnamed":
      return `The account exists. The bank holds it as ${verdict.nameAtBank} — check that is who you mean to pay.`;
    case "invalid":
      return `The bank does not recognise this account. ${verdict.message}`.trim();
    case "unknown":
      return `Not verified — ${verdict.message}. This is not the same as the account being wrong.`;
  }
}

/** True only where the school may pay without somebody looking first. */
export function safeToPay(verdict: BankVerdict): boolean {
  return verdict.kind === "ok";
}
