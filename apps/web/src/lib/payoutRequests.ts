/**
 * Paying a store vendor bill or a payment voucher from the Cashfree Payouts
 * wallet — the pure half (director, 10 Oct 2026: "ok make all").
 *
 * A payment request is the one front door. The school's approval rule holds it
 * for the owner, or lets it through; then it goes out as
 *   transfer  a bank transfer to the vendor's account on file, or
 *   link      a Cashgram to a phone (a vendor without bank details, or a
 *             voucher payee the school has no details for).
 * Nothing is booked until Cashfree says the money arrived. Then the vendor bill
 * is settled (mode 'cashfree' → 1110) or the voucher is posted (Cr 1110).
 *
 * Wallet top-ups are the other direction: money leaves a school bank (Union
 * Bank) and lands in the wallet — Dr 1110 / Cr that bank.
 */

import { L_PAYOUTS_WALLET } from "@/lib/ledger/coa";
import type { LedgerLineInput } from "@/lib/ledger/types";

export type PayoutRequestKind = "vendor_bill" | "voucher";
export type PayoutRequestChannel = "transfer" | "link";
export type PayoutRequestStatus = "PENDING_APPROVAL" | "REJECTED" | "SENT" | "PAID" | "FAILED" | "CANCELLED";

export function readRequestStatus(raw: unknown): PayoutRequestStatus {
  const s = String(raw ?? "").toUpperCase();
  return (["PENDING_APPROVAL", "REJECTED", "SENT", "PAID", "FAILED", "CANCELLED"] as const).includes(s as PayoutRequestStatus)
    ? (s as PayoutRequestStatus)
    : // Unknown is in flight, never paid and never free to pay again.
      "SENT";
}

/** Holds its amount: a second request for the same bill would pay it twice. */
export function requestIsOpen(s: PayoutRequestStatus): boolean {
  return s === "PENDING_APPROVAL" || s === "SENT";
}

export function newPayoutRequestId(now = Date.now(), rand = Math.random): string {
  const r = Math.floor(rand() * 36 ** 6).toString(36).padStart(6, "0");
  return `prq${now.toString(36)}${r}`;
}

/** The transfer id Cashfree sees: derived, so a retry is refused, not repaid. */
export function requestTransferId(requestId: string): string {
  return `t_${requestId}`.slice(0, 40);
}

const IFSC_RE = /^[A-Z]{4}0[A-Z0-9]{6}$/;

/**
 * How a vendor can be paid from the wallet: by bank when the account and IFSC
 * on the vendor record look real, else by link to the vendor's phone, else not
 * at all. The office may also ask for a link when bank details exist.
 */
export function vendorChannel(
  vendor: { bankAccountNo: string; bankIfsc: string; phone: string },
  wanted: PayoutRequestChannel | "",
  phoneProblem: (raw: string) => string,
): { ok: true; channel: PayoutRequestChannel } | { ok: false; error: string } {
  const account = String(vendor.bankAccountNo || "").replace(/\s/g, "");
  const ifsc = String(vendor.bankIfsc || "").trim().toUpperCase();
  const hasBank = /^\d{6,18}$/.test(account) && IFSC_RE.test(ifsc);
  const hasPhone = !phoneProblem(vendor.phone || "");
  if (wanted === "transfer") {
    return hasBank ? { ok: true, channel: "transfer" } : { ok: false, error: "This vendor has no usable bank account and IFSC on file — add them in Store → Vendors, or send a pay link" };
  }
  if (wanted === "link") {
    return hasPhone ? { ok: true, channel: "link" } : { ok: false, error: "This vendor has no real mobile number on file — only that phone could collect a link" };
  }
  if (hasBank) return { ok: true, channel: "transfer" };
  if (hasPhone) return { ok: true, channel: "link" };
  return { ok: false, error: "Add the vendor's bank account and IFSC, or a mobile number, in Store → Vendors first" };
}

export type VoucherDraftLine = { accountCode: string; amountPaise: number; costCentreCode?: string };
export type VoucherDraft = { narration: string; partyName: string; lines: VoucherDraftLine[] };

/**
 * A voucher paid by link: what the money was for. Only the debit side — the
 * credit is always the wallet, written by the server when the payee collects.
 * A money account on the debit side (cash, a bank, the gateway, the wallet)
 * would be a transfer dressed as a payment, so it is refused.
 */
export function checkVoucherDraft(
  draft: VoucherDraft,
  accounts: Map<string, { postable: boolean; isMoney: boolean; name: string }>,
): { ok: true; totalPaise: number; lines: VoucherDraftLine[] } | { ok: false; error: string } {
  const lines = (draft.lines || [])
    .map((l) => ({
      accountCode: String(l.accountCode || "").trim(),
      amountPaise: Math.round(Number(l.amountPaise) || 0),
      ...(l.costCentreCode ? { costCentreCode: String(l.costCentreCode) } : {}),
    }))
    .filter((l) => l.accountCode && l.amountPaise > 0);
  if (lines.length === 0) return { ok: false, error: "Add what this payment is for (an expense head and amount)" };
  for (const l of lines) {
    const a = accounts.get(l.accountCode);
    if (!a) return { ok: false, error: `No ledger account ${l.accountCode}` };
    if (!a.postable) return { ok: false, error: `${l.accountCode} ${a.name} is a heading, not a postable account` };
    if (a.isMoney || l.accountCode === L_PAYOUTS_WALLET) {
      return { ok: false, error: `${a.name} is a cash or bank account — a pay link pays someone, it does not move money between the school's own accounts` };
    }
  }
  const totalPaise = lines.reduce((n, l) => n + l.amountPaise, 0);
  if (totalPaise < 100) return { ok: false, error: "A payment must be at least ₹1" };
  if (String(draft.narration || "").trim().length < 3) return { ok: false, error: "Say what the payment is for — it is the voucher's narration" };
  return { ok: true, totalPaise, lines };
}

/** The voucher posted when the payee collects: Dr the heads / Cr the wallet. */
export function voucherPaymentLines(input: {
  draft: VoucherDraft;
  totalPaise: number;
  ref: string;
  date: string;
  payeePhone: string;
}): LedgerLineInput[] {
  const party = input.draft.partyName
    ? { party: { kind: "other" as const, externalId: `phone:${input.payeePhone}`, name: input.draft.partyName } }
    : {};
  return [
    ...input.draft.lines.map((l) => ({
      accountCode: l.accountCode,
      debitPaise: l.amountPaise,
      creditPaise: 0,
      narration: input.draft.narration,
      ...(l.costCentreCode ? { costCentreCode: l.costCentreCode } : {}),
      ...party,
    })),
    {
      accountCode: L_PAYOUTS_WALLET,
      debitPaise: 0,
      creditPaise: input.totalPaise,
      narration: input.draft.narration,
      instrument: { mode: "cashfree", ref: input.ref, date: input.date },
    },
  ];
}

/** A top-up: money from a school bank into the wallet. */
export function topupLines(input: {
  amountPaise: number;
  bankLedgerCode: string;
  bankAccountId: string;
  reference: string;
  date: string;
}): { ok: true; lines: LedgerLineInput[] } | { ok: false; error: string } {
  const amount = Math.round(input.amountPaise);
  if (!(amount >= 100)) return { ok: false, error: "A top-up must be at least ₹1" };
  if (!input.bankLedgerCode || input.bankLedgerCode === L_PAYOUTS_WALLET) return { ok: false, error: "Choose the bank the money left" };
  const instrument = { mode: "neft", ref: input.reference, date: input.date };
  return {
    ok: true,
    lines: [
      { accountCode: L_PAYOUTS_WALLET, debitPaise: amount, creditPaise: 0, narration: "Cashfree Payouts wallet top-up", instrument },
      {
        accountCode: input.bankLedgerCode,
        debitPaise: 0,
        creditPaise: amount,
        narration: "Transferred to the Cashfree Payouts wallet",
        instrument,
        ...(input.bankAccountId ? { subledgerKind: "bank_account" as const, subledgerId: input.bankAccountId } : {}),
      },
    ],
  };
}

export function requestStatusSentence(s: PayoutRequestStatus, channel: PayoutRequestChannel): string {
  switch (s) {
    case "PENDING_APPROVAL":
      return "Waiting for the owner's approval — nothing sent";
    case "REJECTED":
      return "Not approved — nothing was sent";
    case "SENT":
      return channel === "link" ? "Pay link sent — not collected yet" : "Bank transfer sent — waiting for Cashfree to confirm";
    case "PAID":
      return "Paid and booked from the Cashfree wallet";
    case "FAILED":
      return "Did not go through — no money left the wallet";
    case "CANCELLED":
      return "Cancelled — no money left the wallet";
  }
}
