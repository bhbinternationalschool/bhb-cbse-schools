/**
 * Changing or voiding a voucher that is already in the book.
 *
 * THE BOOK WILL NOT LET YOU EDIT ONE
 * `ledger_vouchers` and `ledger_lines` both carry a BEFORE UPDATE OR DELETE
 * trigger that raises: "append-only: correct a posting with ledger_reverse(),
 * never update it". That is not a convention this module chose to respect —
 * it is the database refusing, and it is the whole point of the v2 rebuild.
 *
 * So there are exactly two operations, and both are postings:
 *
 *   VOID   — post the mirror image. Every balance in the system is derived
 *            from ledger_lines, so the trial balance, the account statement,
 *            the party sub-ledger and the server book all move by themselves.
 *            Nothing has to be told; there is nothing else to adjust.
 *
 *   MODIFY — void, then post the corrected voucher. That is the only way to
 *            change a head, a party, an amount or a date, and it leaves the
 *            original, the reversal and the replacement all readable in
 *            sequence, which is what an audit of a corrected entry needs.
 *
 * This module is the part that can be reasoned about without a database: what
 * a replacement must satisfy before anything is written, and what the two
 * postings should say.
 */

import type { VoucherFacts } from "@/lib/ledger/voucherFilter";

export type AmendLine = {
  accountCode: string;
  debitPaise: number;
  creditPaise: number;
  narration?: string;
  /** The sub-head: who the amount is for. Empty leaves the line untagged. */
  party?: { kind: string; externalId: string; name: string } | null;
};

export type AmendInput = {
  voucher: VoucherFacts;
  /** The voucher as it should have been. */
  lines: AmendLine[];
  date: string;
  narration: string;
  reason: string;
  /** Codes that exist and may be posted to — the chart, minus group headings. */
  postableCodes: Set<string>;
};

export type AmendPlan =
  | { ok: false; error: string }
  | {
      ok: true;
      /** Reason recorded on the reversal. */
      voidReason: string;
      /** The narration the replacement carries. */
      narration: string;
      lines: AmendLine[];
      totalPaise: number;
    };

const ISO_DATE = /^\d{4}-\d{2}-\d{2}$/;

/**
 * Everything that must be true before the original is touched.
 *
 * The order matters. A reversal and a repost are two round trips and cannot
 * be one transaction from here, so a replacement that fails validation AFTER
 * the void would leave the book with a voided voucher and no replacement.
 * Every check that can be made without the database is made first.
 */
export function planAmend(input: AmendInput): AmendPlan {
  const { voucher, lines, date, narration, reason, postableCodes } = input;

  if (!reason.trim()) {
    return { ok: false, error: "Give the reason — it is recorded on both the void and the replacement" };
  }
  if (voucher.isReversal) {
    return { ok: false, error: "This is a reversal. Change the voucher it reverses, not the reversal itself" };
  }
  if (voucher.reversed) {
    return { ok: false, error: "This voucher has already been voided — change the one that replaced it" };
  }
  if (!ISO_DATE.test(date)) {
    return { ok: false, error: "A posting date is required, as YYYY-MM-DD" };
  }
  if (lines.length < 2) {
    return { ok: false, error: "A voucher needs at least two lines — something given and something received" };
  }

  let debit = 0;
  let credit = 0;
  for (const [i, l] of lines.entries()) {
    const where = `Line ${i + 1}`;
    if (!l.accountCode.trim()) return { ok: false, error: `${where} has no head` };
    if (!postableCodes.has(l.accountCode)) {
      return { ok: false, error: `${where}: ${l.accountCode} is not a head you can post to` };
    }
    if (!Number.isInteger(l.debitPaise) || !Number.isInteger(l.creditPaise)) {
      return { ok: false, error: `${where}: amounts are in whole paise` };
    }
    if (l.debitPaise < 0 || l.creditPaise < 0) {
      return { ok: false, error: `${where}: an amount cannot be negative — put it on the other side` };
    }
    if (l.debitPaise > 0 && l.creditPaise > 0) {
      return { ok: false, error: `${where} is both a debit and a credit — it can only be one` };
    }
    if (l.debitPaise === 0 && l.creditPaise === 0) {
      return { ok: false, error: `${where} has no amount` };
    }
    // A party is optional, but a half-filled one is a silent mis-tag: the
    // sub-ledger would group by an id that names nobody.
    if (l.party && (!l.party.kind.trim() || !l.party.externalId.trim())) {
      return { ok: false, error: `${where}: that party has no kind or id — pick one from the list rather than typing a name` };
    }
    debit += l.debitPaise;
    credit += l.creditPaise;
  }

  if (debit !== credit) {
    const diff = Math.abs(debit - credit) / 100;
    return {
      ok: false,
      error: `Debits ₹${(debit / 100).toLocaleString("en-IN")} and credits ₹${(credit / 100).toLocaleString("en-IN")} differ by ₹${diff.toLocaleString("en-IN")} — a voucher must balance`,
    };
  }

  const text = narration.trim() || voucher.narration;
  return {
    ok: true,
    voidReason: `Replaced — ${reason.trim()}`,
    narration: `${text} · corrects ${voucher.voucherNo} — ${reason.trim()}`,
    lines,
    totalPaise: debit,
  };
}

/* ─── Voiding on its own ────────────────────────────────────── */

export type VoidPlan = { ok: false; error: string } | { ok: true; reason: string };

/**
 * A void needs only a reason, but it needs a real one: "the reversal is the
 * record" only helps whoever reads it later if the record says why.
 */
export function planVoid(input: { voucher: VoucherFacts; reason: string }): VoidPlan {
  const { voucher, reason } = input;
  if (!reason.trim()) {
    return { ok: false, error: "Give the reason — it is what the reversal will say" };
  }
  if (reason.trim().length < 4) {
    return { ok: false, error: "Give a reason somebody reading the book next year could use" };
  }
  if (voucher.isReversal) {
    return { ok: false, error: "A reversal cannot itself be reversed — void the original instead" };
  }
  if (voucher.reversed) {
    return { ok: false, error: "This voucher is already voided" };
  }
  return { ok: true, reason: reason.trim() };
}

/**
 * The lines a replacement starts from: the voucher as it stands.
 *
 * Presented rather than blank, because most amendments change one field. A
 * blank form invites re-keying, and re-keyed amounts are how a correction
 * becomes a second mistake.
 */
export function linesFromVoucher(voucher: VoucherFacts): AmendLine[] {
  return voucher.lines.map((l) => ({
    accountCode: l.accountCode,
    debitPaise: l.debitPaise,
    creditPaise: l.creditPaise,
    narration: "",
    party: null,
  }));
}
