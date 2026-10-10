/**
 * Ledger v2 — shared shapes.
 *
 * The server-side book of account (see supabase/migrations/*_ledger_v2_*).
 * Money is integer paise throughout, as in the desk modules.
 *
 * Deliberately free of imports so both the server module and the client
 * adapter can depend on it without either depending on the other.
 */

export type LedgerAccountKind =
  | "asset"
  | "liability"
  | "income"
  | "expense"
  | "equity";

export type LedgerVoucherType =
  | "receipt"
  | "payment"
  | "contra"
  | "journal"
  | "purchase"
  | "sales"
  | "payroll"
  | "opening"
  | "closing"
  | "reversal";

export type LedgerPartyKind =
  | "vendor"
  | "staff"
  | "household"
  | "student"
  | "trustee"
  | "bank"
  | "other";

export type LedgerSubledgerKind = "cash_pool" | "bank_account";

export type LedgerAccountSeed = {
  code: string;
  name: string;
  kind: LedgerAccountKind;
  /** Empty for a top-level account. */
  parentCode?: string;
  /**
   * The line of the audited statements this account rolls into — Form 10B /
   * Receipts & Payments. Carried on the account so the statutory pack does not
   * need a mapping table rebuilt by hand every year.
   */
  scheduleGroup: string;
  isCash?: boolean;
  isBank?: boolean;
  /** Set when this account IS one desk bank, so a form need not ask again. */
  bankAccountId?: string;
  /** Backed by a party sub-ledger (receivables, payables). */
  isControl?: boolean;
};

export type LedgerLineInput = {
  accountCode: string;
  debitPaise: number;
  creditPaise: number;
  narration?: string;
  subledgerKind?: LedgerSubledgerKind;
  subledgerId?: string;
  costCentreCode?: string;
  party?: {
    kind: LedgerPartyKind;
    externalId: string;
    name?: string;
  };
  instrument?: {
    mode?: string;
    ref?: string;
    date?: string;
  };
};

export type LedgerVoucherInput = {
  voucherType: LedgerVoucherType;
  /** ISO date, YYYY-MM-DD. */
  date: string;
  narration?: string;
  /** With sourceId, the idempotency key — a replay lands exactly once. */
  sourceType?: string;
  sourceId?: string;
  createdBy?: string;
  lines: LedgerLineInput[];
};

export type LedgerPostResult =
  | {
      ok: true;
      /** False when this source event had already been posted. */
      created: boolean;
      voucherId: string;
      voucherNo: string;
      amountPaise?: number;
    }
  | { ok: false; error: string };

export type LedgerTrialBalanceRow = {
  accountId: string;
  code: string;
  name: string;
  kind: LedgerAccountKind;
  scheduleGroup: string;
  debitPaise: number;
  creditPaise: number;
  closingDebitPaise: number;
  closingCreditPaise: number;
  balancePaise: number;
};

export type LedgerPeriodStatus = "open" | "locked" | "closed";
