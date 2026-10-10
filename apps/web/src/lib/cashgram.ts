/**
 * Fee refunds by Cashgram — the pure half.
 *
 * A Cashgram is a Cashfree Payouts link. The parent gets it by SMS, proves the
 * phone number with an OTP, and picks where the money goes (UPI, bank). So the
 * school can refund a family it holds no bank details for — which is every
 * family that paid in cash or by UPI to the school's QR. Online (gateway)
 * payments are NOT refunded this way: those go back down the card or UPI they
 * came from, through /api/fees/refund.
 *
 * THE RULE EVERYTHING HERE SERVES: a link is not money. Creating one, or the
 * owner approving one, changes nothing in the fee book or the ledger. Only
 * REDEEMED does — the parent has the money — and only once. Every status
 * Cashfree might send that we do not recognise reads as UNKNOWN, never as
 * redeemed.
 *
 * Two fee effects, chosen per refund by the office:
 *   excess  money paid over the bill comes back; no receipt changes
 *   void    one receipt is cancelled (withdrawal, double payment); it is
 *           voided only when the money has reached the parent
 *
 * The API is Cashfree Payouts V1 (/payout/v1/createCashgram and friends, a
 * bearer token from /v1/authorize). Amounts there are RUPEES, and the expiry
 * is "YYYY/MM/DD".
 */

import {
  L_BANK,
  L_CASH,
  L_CHEQUES_IN_HAND,
  L_FEE_INCOME,
  L_PAYOUTS_WALLET,
} from "@/lib/ledger/coa";
import type { LedgerLineInput } from "@/lib/ledger/types";

export type CashgramFeeEffect = "excess" | "void" | "none";

/**
 * What the link pays. Every Cashgram the school sends lives in one table, so
 * the wallet check (the sum of every open link) and the webhook see them all.
 *   fee_refund  money back to a parent (fee effect excess / void)
 *   staff_pay   a posted salary line (fee effect none); collected → its UTR
 *               is recorded against the line like any payout
 */
export type CashgramPurpose = "fee_refund" | "staff_pay";

/**
 * Why a salary line cannot be paid by link now, or "" when it can.
 *
 * One way of paying at a time: a recorded UTR (UPI, screenshot, Pay via
 * Cashfree) means it is paid; a live link means it is being paid. Both block.
 */
export function staffLinkProblem(input: {
  runStatus: string;
  payablePaise: number;
  requestedPaise: number;
  alreadyPaidUtr: string;
  liveLinkStatus: CashgramStatus | "";
}): string {
  if (input.runStatus !== "posted" && input.runStatus !== "paid") return "Publish the payroll run before paying it";
  if (!(input.payablePaise >= 100)) return "Nothing payable on this line";
  if (Math.round(input.requestedPaise) !== Math.round(input.payablePaise)) {
    return `The line is for ₹${(input.payablePaise / 100).toFixed(2)} — the screen asked for ₹${(input.requestedPaise / 100).toFixed(2)}. Refresh and try again.`;
  }
  if (input.alreadyPaidUtr) return `Already paid — UTR ${input.alreadyPaidUtr} is recorded on this salary`;
  if (input.liveLinkStatus) {
    return input.liveLinkStatus === "REDEEMED"
      ? "Already paid by a Cashgram link"
      : "A pay link for this salary is already open — cancel it before paying another way";
  }
  return "";
}

export type CashgramStatus =
  /** Prepared by the desk; waits for the owner under the school's rule. */
  | "PENDING_APPROVAL"
  /** The owner said no. Nothing was sent. */
  | "REJECTED"
  /** Our row is written; the create call is going out now. */
  | "SENDING"
  /** We asked and do not know the answer (lost reply, 5XX). Ask Cashfree. */
  | "UNKNOWN"
  /** Cashfree refused to create it. Nothing was sent. */
  | "CREATE_FAILED"
  /** The parent has the link and has not redeemed it. */
  | "ACTIVE"
  /** The parent redeemed; the bank transfer is still in flight. */
  | "REDEEMING"
  /** The parent has the money. The only status that changes the books. */
  | "REDEEMED"
  | "EXPIRED"
  | "DEACTIVATED"
  /** Redemption failed for good (retries used, bank refused). */
  | "FAILED"
  /** Paid out, then the bank sent it back. The parent does NOT have it. */
  | "REVERSED";

export type CashgramApprovalRule = "owner" | "above" | "none";

/** The longest a link may stay open. Cashfree allows about a month. */
export const CASHGRAM_MAX_EXPIRY_DAYS = 30;
export const CASHGRAM_DEFAULT_EXPIRY_DAYS = 7;

/**
 * Read a Cashfree status word. Anything not recognised is UNKNOWN — a new or
 * misspelt word must never become REDEEMED, or a receipt is voided for money
 * that never left.
 */
export function readCashgramStatus(raw: unknown): CashgramStatus {
  const s = String(raw ?? "").trim().toUpperCase();
  switch (s) {
    case "ACTIVE":
      return "ACTIVE";
    case "REDEEMED":
    case "CASHGRAM_REDEEMED":
      return "REDEEMED";
    // Details submitted, bank transfer not yet confirmed (Cashfree polls the
    // bank for up to 72 hours). The money may still fail to arrive.
    case "PENDING":
    case "INITIATED":
    case "PROCESSING":
      return "REDEEMING";
    case "EXPIRED":
    case "CASHGRAM_EXPIRED":
      return "EXPIRED";
    case "DEACTIVATED":
    case "INACTIVE":
      return "DEACTIVATED";
    case "FAILED":
      return "FAILED";
    case "REVERSED":
    case "CASHGRAM_TRANSFER_REVERSAL":
      return "REVERSED";
    default:
      return "UNKNOWN";
  }
}

/** The parent has the money. Nothing else counts as paid. */
export function cashgramIsPaid(s: CashgramStatus): boolean {
  return s === "REDEEMED";
}

/**
 * Over and done with, money NOT out: the amount is refundable again.
 * REVERSED is here because the bank sent the money back.
 */
export function cashgramIsDead(s: CashgramStatus): boolean {
  return (
    s === "REJECTED" ||
    s === "CREATE_FAILED" ||
    s === "EXPIRED" ||
    s === "DEACTIVATED" ||
    s === "FAILED" ||
    s === "REVERSED"
  );
}

/**
 * Money that may leave the wallet on this link without anyone doing anything
 * more. Summed before a new link goes out, so ten open links cannot promise
 * more than the wallet holds — the wallet is only drawn when a parent redeems,
 * which may be days after the link was sent.
 */
export function cashgramCommitsWallet(s: CashgramStatus): boolean {
  return s === "SENDING" || s === "UNKNOWN" || s === "ACTIVE" || s === "REDEEMING";
}

/** Still the office's or Cashfree's to resolve; a webhook or a check may move it. */
export function cashgramIsOpen(s: CashgramStatus): boolean {
  return s === "PENDING_APPROVAL" || cashgramCommitsWallet(s);
}

/** Whether the owner must approve a link of this amount before it goes out. */
export function cashgramNeedsApproval(
  rule: CashgramApprovalRule,
  abovePaise: number,
  amountPaise: number,
): boolean {
  if (rule === "none") return false;
  if (rule === "above") return Math.round(amountPaise) > Math.max(0, Math.round(abovePaise));
  // "owner", and anything unreadable: ask. The safe default for money out.
  return true;
}

export function readApprovalRule(raw: unknown): CashgramApprovalRule {
  const s = String(raw ?? "").trim().toLowerCase();
  return s === "none" || s === "above" ? s : "owner";
}

/**
 * A fresh id for one link. Alphanumeric only (Cashfree's rule), never reused —
 * an expired or rejected refund that is sent again gets a new id.
 */
export function newCashgramId(now = Date.now(), rand = Math.random): string {
  const r = Math.floor(rand() * 36 ** 6).toString(36).padStart(6, "0");
  return `cgr${now.toString(36)}${r}`.slice(0, 30);
}

export const CASHGRAM_ID_RE = /^[A-Za-z0-9]{6,35}$/;

/** IST calendar date `days` from `todayIst` (YYYY-MM-DD), as YYYY-MM-DD. */
export function cashgramExpiryDate(todayIst: string, days: number): string {
  const n = Math.min(CASHGRAM_MAX_EXPIRY_DAYS, Math.max(1, Math.round(Number(days) || CASHGRAM_DEFAULT_EXPIRY_DAYS)));
  const d = new Date(`${todayIst}T12:00:00Z`);
  d.setUTCDate(d.getUTCDate() + n);
  return d.toISOString().slice(0, 10);
}

/**
 * Ten digits, starting 6–9, not a filler like 0000000000 or 9999999999.
 *
 * Only this phone can redeem the link (OTP). A placeholder number is not "no
 * number" — it is somebody else's, or nobody's, and the money would be lost to
 * the family it belongs to.
 */
export function cashgramPhoneProblem(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  const m = digits.length > 10 ? digits.slice(-10) : digits;
  if (m.length !== 10) return "The parent's mobile must be 10 digits";
  if (!/^[6-9]/.test(m) || /^(\d)\1{9}$/.test(m) || m === "1234567890" || m === "9876543210") {
    return "That mobile number looks like a placeholder — only the phone on the link can collect the money";
  }
  return "";
}

export function cashgramPhone(raw: string): string {
  const digits = String(raw || "").replace(/\D/g, "");
  return digits.length > 10 ? digits.slice(-10) : digits;
}

/** Cashfree takes letters, spaces and dots in a name; the rest is dropped. */
export function cashgramName(raw: string): string {
  return String(raw || "")
    .replace(/[^A-Za-z .]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 100);
}

export type CashgramCreateBody = {
  cashgramId: string;
  amount: number;
  name: string;
  phone: string;
  email?: string;
  linkExpiry: string;
  remarks: string;
  notifyCustomer: 1;
};

export function buildCashgramBody(input: {
  cashgramId: string;
  amountPaise: number;
  name: string;
  phone: string;
  email?: string;
  /** YYYY-MM-DD */
  expiryDate: string;
  remarks: string;
}): { ok: true; body: CashgramCreateBody } | { ok: false; error: string } {
  if (!CASHGRAM_ID_RE.test(input.cashgramId)) return { ok: false, error: "Bad Cashgram id" };
  const paise = Math.round(Number(input.amountPaise));
  if (!Number.isFinite(paise) || paise < 100) return { ok: false, error: "A refund must be at least ₹1" };
  const name = cashgramName(input.name);
  if (name.length < 2) return { ok: false, error: "Give the parent's name as it should appear on the link" };
  const phoneProblem = cashgramPhoneProblem(input.phone);
  if (phoneProblem) return { ok: false, error: phoneProblem };
  if (!/^\d{4}-\d{2}-\d{2}$/.test(input.expiryDate)) return { ok: false, error: "Bad expiry date" };
  const email = String(input.email || "").trim();
  const remarks = String(input.remarks || "Fee refund")
    .replace(/[^A-Za-z0-9 ]/g, " ")
    .replace(/\s+/g, " ")
    .trim()
    .slice(0, 70);
  return {
    ok: true,
    body: {
      cashgramId: input.cashgramId,
      // Rupees, two places. Paise sent here would refund a hundred times over.
      amount: Number((paise / 100).toFixed(2)),
      name,
      phone: cashgramPhone(input.phone),
      ...(/^[^@\s]+@[^@\s]+\.[^@\s]+$/.test(email) ? { email } : {}),
      linkExpiry: input.expiryDate.replace(/-/g, "/"),
      remarks: remarks || "Fee refund",
      // Cashfree sends the link by SMS/email itself, so the parent gets it even
      // when the school's WhatsApp is down.
      notifyCustomer: 1,
    },
  };
}

/** What a V1 envelope says: {status, subCode, message, data}. */
function v1Ok(payload: unknown): { ok: boolean; data: Record<string, unknown>; message: string } {
  const p = (payload ?? {}) as Record<string, unknown>;
  const status = String(p.status ?? "").toUpperCase();
  const sub = String(p.subCode ?? "");
  return {
    ok: status === "SUCCESS" && (sub === "" || sub === "200"),
    data: ((p.data ?? {}) as Record<string, unknown>) || {},
    message: String(p.message ?? ""),
  };
}

export function readCashgramCreate(
  payload: unknown,
): { ok: true; referenceId: string; link: string } | { ok: false; error: string } {
  const r = v1Ok(payload);
  if (!r.ok) return { ok: false, error: r.message || "Cashfree did not create the link" };
  const link = String(r.data.cashgramLink ?? r.data.cashgram_link ?? "");
  return { ok: true, referenceId: String(r.data.referenceId ?? r.data.reference_id ?? ""), link };
}

export type CashgramView = {
  cashgramId: string;
  status: CashgramStatus;
  referenceId: string;
  utr: string;
  link: string;
};

/** GET /v1/getCashgramStatus. Unreadable is null — never a status. */
export function readCashgramStatusResponse(cashgramId: string, payload: unknown): CashgramView | null {
  const r = v1Ok(payload);
  if (!r.ok) return null;
  const raw = r.data.cashgramStatus ?? r.data.cashgram_status ?? r.data.status;
  if (raw === undefined || raw === null || raw === "") return null;
  return {
    cashgramId,
    status: readCashgramStatus(raw),
    referenceId: String(r.data.referenceId ?? r.data.reference_id ?? ""),
    utr: String(r.data.utr ?? ""),
    link: String(r.data.cashgramLink ?? ""),
  };
}

/**
 * A Payouts webhook that is about a Cashgram, or null. Field names vary in
 * case between Cashfree's samples (cashgramid / cashgramId), so both are read.
 */
export function readCashgramWebhook(fields: Record<string, unknown> | null | undefined): CashgramView | null {
  if (!fields) return null;
  const event = String(fields.event ?? fields.type ?? "").trim().toUpperCase();
  if (!event.startsWith("CASHGRAM_")) return null;
  const id = String(fields.cashgramid ?? fields.cashgramId ?? fields.cashgram_id ?? "").trim();
  if (!id) return null;
  const status = readCashgramStatus(event);
  return {
    cashgramId: id,
    status,
    referenceId: String(fields.referenceId ?? fields.reference_id ?? ""),
    utr: String(fields.utr ?? ""),
    link: "",
  };
}

/* ── what may be refunded ─────────────────────────────────────────────── */

type HeldRow = { amountPaise: number; status: CashgramStatus; feeEffect: CashgramFeeEffect; voucherId?: string };

/**
 * What a household may still have back as money paid over the bill.
 *
 * Every link not dead holds its amount — including one awaiting approval —
 * so preparing two in a row cannot promise the same excess twice.
 */
export function excessRefundableNow(excessPaise: number, rows: HeldRow[]): number {
  const held = rows
    .filter((r) => r.feeEffect === "excess" && !cashgramIsDead(r.status))
    .reduce((n, r) => n + Math.round(r.amountPaise), 0);
  return Math.max(0, Math.round(excessPaise) - held);
}

/** Why this receipt cannot be refunded by link, or "" when it can. */
export function voidRefundProblem(input: {
  voidedAt?: string | null;
  tenders: { mode: string; gatewayProvider?: string; realisation?: string }[];
  rowsForVoucher: HeldRow[];
}): string {
  if (input.voidedAt) return "This receipt is already voided";
  if (input.tenders.some((t) => (t.gatewayProvider || "").trim() !== "")) {
    return "This was paid online — refund it with Online refund, so the money goes back the way it came";
  }
  if (input.tenders.some((t) => t.realisation === "subject_to_clearance")) {
    return "A cheque on this receipt has not cleared — wait for it, or mark it bounced";
  }
  if (input.rowsForVoucher.some((r) => r.feeEffect === "void" && !cashgramIsDead(r.status))) {
    return "A refund link for this receipt is already open";
  }
  return "";
}

/* ── the journal on REDEEMED ──────────────────────────────────────────── */

/**
 * The money the parent received came out of the Payouts wallet. The lines:
 *
 *   excess  Dr Fee Income      Cr Payouts Wallet
 *           (the excess was booked as income when received; it is given back)
 *
 *   void    Dr <each tender's own account>   Cr Payouts Wallet
 *           The receipt's void already reversed it — Dr Fee Income, Cr the
 *           cash / bank / cheques account it was received into. But the cash
 *           never left the cash box: the wallet paid. This puts the money back
 *           where the void took it from, so the net is Dr Fee Income /
 *           Cr Wallet and the cash book still matches the drawer.
 *
 * The tender mapping is projectionMap's, deliberately: anything else leaves a
 * residue on an account the void touched.
 */
export function cashgramRefundLines(input: {
  feeEffect: Exclude<CashgramFeeEffect, "none">;
  amountPaise: number;
  householdId: string;
  tenders?: { mode: string; amountPaise: number; bankAccountId?: string }[];
  narration: string;
}): { ok: true; lines: LedgerLineInput[] } | { ok: false; error: string } {
  const amount = Math.round(input.amountPaise);
  if (amount <= 0) return { ok: false, error: "Nothing to book" };
  const party = input.householdId ? { party: { kind: "household" as const, externalId: input.householdId } } : {};
  const credit: LedgerLineInput = {
    accountCode: L_PAYOUTS_WALLET,
    debitPaise: 0,
    creditPaise: amount,
    narration: input.narration,
  };
  if (input.feeEffect === "excess") {
    return {
      ok: true,
      lines: [{ accountCode: L_FEE_INCOME, debitPaise: amount, creditPaise: 0, narration: input.narration, ...party }, credit],
    };
  }
  const live = (input.tenders ?? []).filter((t) => Math.round(t.amountPaise) > 0);
  const total = live.reduce((n, t) => n + Math.round(t.amountPaise), 0);
  if (total !== amount) {
    return { ok: false, error: `Receipt tenders total ₹${(total / 100).toFixed(2)} but the refund is ₹${(amount / 100).toFixed(2)}` };
  }
  const debits: LedgerLineInput[] = live.map((t) => {
    const mode = (t.mode || "").toLowerCase();
    const accountCode = mode === "cash" ? L_CASH : mode === "cheque" || mode === "dd" ? L_CHEQUES_IN_HAND : L_BANK;
    return {
      accountCode,
      debitPaise: Math.round(t.amountPaise),
      creditPaise: 0,
      narration: input.narration,
      ...(accountCode === L_BANK && t.bankAccountId ? { subledgerKind: "bank_account" as const, subledgerId: t.bankAccountId } : {}),
      ...party,
    };
  });
  return { ok: true, lines: [...debits, credit] };
}

export function cashgramStatusSentence(s: CashgramStatus): string {
  switch (s) {
    case "PENDING_APPROVAL":
      return "Waiting for the owner's approval — nothing sent yet";
    case "REJECTED":
      return "Not approved — nothing was sent";
    case "SENDING":
    case "UNKNOWN":
      return "Asked Cashfree, answer not confirmed — check status before sending again";
    case "CREATE_FAILED":
      return "Cashfree refused the link — nothing was sent";
    case "ACTIVE":
      return "Link sent — the parent has not collected it yet";
    case "REDEEMING":
      return "Parent collected it — bank transfer in progress";
    case "REDEEMED":
      return "Paid to the parent";
    case "EXPIRED":
      return "Expired unclaimed — no money left the wallet";
    case "DEACTIVATED":
      return "Cancelled — no money left the wallet";
    case "FAILED":
      return "Failed — no money reached the parent";
    case "REVERSED":
      return "The bank sent the money back — the parent does not have it";
  }
}
