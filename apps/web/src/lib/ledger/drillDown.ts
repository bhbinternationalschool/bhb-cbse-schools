/**
 * Drill-down targets for the Accounts tables — where a click on a row goes.
 *
 * Every figure on a Book report is a sum of an account's lines; clicking it
 * opens that account's statement for the same dates, and a statement line
 * opens its voucher. Pure, so the rule "only a real account drills" is held
 * by the self-test: section totals, the surplus line and blank codes are
 * figures, not accounts, and a click there must do nothing rather than open
 * an empty statement that looks like a fact.
 */

/** One voucher whole, as the `voucher-detail` action returns it. */
export type VoucherDetail = {
  id: string;
  voucherNo: string;
  voucherType: string;
  date: string;
  narration: string;
  createdBy: string;
  createdAt: string;
  sourceType: string;
  lines: {
    lineNo: number;
    accountCode: string;
    accountName: string;
    partyName: string;
    debitPaise: number;
    creditPaise: number;
    narration: string;
    instrumentMode: string;
    instrumentRef: string;
  }[];
  /** The reversal that cancelled this voucher, if any. */
  reversedBy: { id: string; voucherNo: string; date: string; narration: string } | null;
  /** The voucher this one reverses, if it is a reversal. */
  reverses: { id: string; voucherNo: string; date: string } | null;
};

export type StatementTarget = { code: string; from: string; to: string };

export function statementDrillTarget(input: {
  code: string;
  knownCodes: ReadonlySet<string>;
  from: string;
  to: string;
}): StatementTarget | null {
  const code = String(input.code ?? "").trim();
  if (!code || !input.knownCodes.has(code)) return null;
  if (!input.from || !input.to) return null;
  return { code, from: input.from, to: input.to };
}

/** Enter or Space on a focused row opens it, as a click would. */
export function isOpenKey(key: string): boolean {
  return key === "Enter" || key === " ";
}
