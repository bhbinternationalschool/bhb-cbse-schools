/**
 * Ledger v2 — closing the book on a date against the money that is really there.
 *
 * On a chosen day the school counts the cash box and reads the bank statement,
 * types both figures in, and the book is moved to agree with them. From the
 * next morning every balance the ERP shows is the balance that exists.
 *
 * The difference is not hidden. It posts to its own expense head
 * (L_BALANCE_DIFFERENCE) rather than to corpus, because a book that disagrees
 * with the cash box has lost or gained real money and someone should be able
 * to ask why. Folding it into 3000 would make it vanish from the Income &
 * Expenditure account.
 *
 * Pure: every rule about direction, rounding and what counts as "already
 * agreed" is decided here, with no database, so it can be tested directly.
 */

import { L_BANK, L_BALANCE_DIFFERENCE, L_CASH } from "@/lib/ledger/coa";

export type ClosingBalanceInput = {
  /** The closing date, ISO yyyy-mm-dd. */
  asOn: string;
  /** What the book says on that date, in paise. */
  bookCashPaise: number;
  bookBankPaise: number;
  /** What was counted / read off the statement, in paise. */
  actualCashPaise: number;
  actualBankPaise: number;
};

export type ClosingBalanceLeg = {
  accountCode: string;
  label: string;
  bookPaise: number;
  actualPaise: number;
  /** actual − book. Positive: more money than the book knew about. */
  differencePaise: number;
};

export type ClosingBalancePlan = {
  asOn: string;
  cash: ClosingBalanceLeg;
  bank: ClosingBalanceLeg;
  /** Sum of both differences — what lands in the difference account. */
  netDifferencePaise: number;
  /** True when the book already agrees and there is nothing to post. */
  alreadyAgrees: boolean;
  narration: string;
  lines: { accountCode: string; debitPaise: number; creditPaise: number; narration: string }[];
};

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

export function isClosingDate(v: string): boolean {
  return ISO_DATE.test(v);
}

/** Paise are whole. A rupee figure typed with decimals must not survive as one. */
function paise(v: number): number {
  return Math.round(Number(v) || 0);
}

function leg(
  accountCode: string,
  label: string,
  bookPaise: number,
  actualPaise: number,
): ClosingBalanceLeg {
  const book = paise(bookPaise);
  const actual = paise(actualPaise);
  return { accountCode, label, bookPaise: book, actualPaise: actual, differencePaise: actual - book };
}

/**
 * Build the single journal that moves cash and bank onto the counted figures.
 *
 * Direction, stated once because it is where these go wrong: the difference is
 * `actual − book`. More money than the book knew about is a DEBIT to the asset
 * and a CREDIT to the difference head (a gain). Less is the reverse (a loss).
 *
 * Cash and bank each get their own line so the statement shows which one moved,
 * and a leg that already agrees contributes no line at all.
 */
export function buildClosingBalancePlan(input: ClosingBalanceInput): ClosingBalancePlan {
  const cash = leg(L_CASH, "Cash in hand", input.bookCashPaise, input.actualCashPaise);
  const bank = leg(L_BANK, "Bank", input.bookBankPaise, input.actualBankPaise);
  const netDifferencePaise = cash.differencePaise + bank.differencePaise;
  const alreadyAgrees = cash.differencePaise === 0 && bank.differencePaise === 0;

  const lines: ClosingBalancePlan["lines"] = [];
  for (const l of [cash, bank]) {
    if (l.differencePaise === 0) continue;
    lines.push({
      accountCode: l.accountCode,
      debitPaise: l.differencePaise > 0 ? l.differencePaise : 0,
      creditPaise: l.differencePaise < 0 ? -l.differencePaise : 0,
      narration: `${l.label} counted ${rupees(l.actualPaise)} against book ${rupees(l.bookPaise)}`,
    });
  }
  // The contra, as one line, so the difference head reads as a single event.
  if (netDifferencePaise !== 0) {
    lines.push({
      accountCode: L_BALANCE_DIFFERENCE,
      debitPaise: netDifferencePaise < 0 ? -netDifferencePaise : 0,
      creditPaise: netDifferencePaise > 0 ? netDifferencePaise : 0,
      narration: "Unexplained difference on closing",
    });
  }
  // A net of zero with non-zero legs still needs the two asset lines to
  // balance each other — they already do, so no contra is required.

  return {
    asOn: input.asOn,
    cash,
    bank,
    netDifferencePaise,
    alreadyAgrees,
    narration: `Closing balances as on ${input.asOn} — cash ${rupees(cash.actualPaise)}, bank ${rupees(bank.actualPaise)}`,
    lines,
  };
}

/** Every adjustment for one date is the same posting — re-running replaces it. */
export const CLOSING_BALANCE_SOURCE_TYPE = "closing_balance";
export function closingBalanceSourceId(asOn: string): string {
  return asOn;
}

export function rupees(p: number): string {
  const sign = p < 0 ? "-" : "";
  const abs = Math.abs(Math.round(p));
  return `${sign}₹${(abs / 100).toLocaleString("en-IN", {
    minimumFractionDigits: 2,
    maximumFractionDigits: 2,
  })}`;
}

/** Rupees typed by a human → paise, rejecting anything that is not a number. */
export function parseRupeesToPaise(raw: string): { ok: true; paise: number } | { ok: false; error: string } {
  const t = String(raw ?? "").trim().replace(/[,\s₹]/g, "");
  if (!t) return { ok: false, error: "Enter an amount" };
  if (!/^-?\d+(\.\d{1,2})?$/.test(t)) return { ok: false, error: "Enter rupees, e.g. 282000 or 282000.50" };
  const n = Number(t);
  if (!Number.isFinite(n)) return { ok: false, error: "Enter a number" };
  if (n < 0) return { ok: false, error: "A counted balance cannot be negative" };
  return { ok: true, paise: Math.round(n * 100) };
}
