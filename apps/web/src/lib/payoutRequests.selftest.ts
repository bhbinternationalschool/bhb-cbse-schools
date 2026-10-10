/**
 * Self-test: vendor bills and vouchers paid from the Cashfree wallet, and
 * wallet top-ups — the pure half.
 * Run: npx tsx apps/web/src/lib/payoutRequests.selftest.ts
 *
 * The mistakes guarded: a top-up booked the wrong way round, a voucher that
 * moves money between the school's own accounts dressed as a payment, a bill
 * paid twice because an unknown status read as free, and journals that do not
 * balance.
 */
import assert from "node:assert/strict";

import { cashgramPhoneProblem } from "@/lib/cashgram";
import { L_PAYOUTS_WALLET } from "@/lib/ledger/coa";
import { PAYOUT_TRANSFER_ID_RE } from "@/lib/payouts";
import {
  checkVoucherDraft,
  newPayoutRequestId,
  readRequestStatus,
  requestIsOpen,
  requestTransferId,
  topupLines,
  vendorChannel,
  voucherPaymentLines,
} from "@/lib/payoutRequests";

console.log("payoutRequests.selftest.ts");

const sum = (lines: { debitPaise: number; creditPaise: number }[]) => lines.reduce((n, l) => n + l.debitPaise - l.creditPaise, 0);

/* ── top-up: Union Bank debited on the statement = Dr wallet / Cr bank ── */
{
  const t = topupLines({ amountPaise: 50_000_00, bankLedgerCode: "1012", bankAccountId: "bnk_5rx0puwl", reference: "UBIN123", date: "2026-10-10" });
  assert.ok(t.ok);
  if (t.ok) {
    assert.equal(sum(t.lines), 0, "balances");
    assert.deepEqual(t.lines.map((l) => [l.accountCode, l.debitPaise, l.creditPaise]), [
      [L_PAYOUTS_WALLET, 50_000_00, 0],
      ["1012", 0, 50_000_00],
    ], "the wallet goes up, Union Bank comes down");
    assert.equal(t.lines[1]!.subledgerId, "bnk_5rx0puwl", "the bank it left");
  }
  assert.equal(topupLines({ amountPaise: 50, bankLedgerCode: "1012", bankAccountId: "", reference: "x", date: "2026-10-10" }).ok, false);
  assert.equal(topupLines({ amountPaise: 500, bankLedgerCode: L_PAYOUTS_WALLET, bankAccountId: "", reference: "x", date: "2026-10-10" }).ok, false, "wallet to wallet is not a top-up");
}

/* ── request status: unknown is in flight, never free ─────────────────── */
{
  assert.equal(readRequestStatus("PAID"), "PAID");
  assert.equal(readRequestStatus("garbage"), "SENT", "an unreadable status holds the bill");
  assert.equal(requestIsOpen("SENT"), true);
  assert.equal(requestIsOpen("PENDING_APPROVAL"), true);
  for (const s of ["PAID", "FAILED", "REJECTED", "CANCELLED"] as const) assert.equal(requestIsOpen(s), false, s);
  const id = newPayoutRequestId();
  assert.match(requestTransferId(id), PAYOUT_TRANSFER_ID_RE, "Cashfree accepts the transfer id");
  assert.equal(requestTransferId(id), requestTransferId(id), "derived, so a retry is refused rather than repaid");
}

/* ── vendor channel ──────────────────────────────────────────────────── */
{
  const bank = { bankAccountNo: "123456789012", bankIfsc: "UBIN0537101", phone: "9876501234" };
  assert.deepEqual(vendorChannel(bank, "", cashgramPhoneProblem), { ok: true, channel: "transfer" }, "bank on file wins");
  assert.deepEqual(vendorChannel(bank, "link", cashgramPhoneProblem), { ok: true, channel: "link" }, "the office may choose a link");
  assert.deepEqual(vendorChannel({ ...bank, bankIfsc: "bad" }, "", cashgramPhoneProblem), { ok: true, channel: "link" }, "a broken IFSC falls back to the phone");
  assert.equal(vendorChannel({ ...bank, bankIfsc: "bad" }, "transfer", cashgramPhoneProblem).ok, false);
  assert.equal(vendorChannel({ bankAccountNo: "", bankIfsc: "", phone: "0000000000" }, "", cashgramPhoneProblem).ok, false, "a placeholder phone is no way to pay");
}

/* ── voucher drafts: pays someone, never moves the school's own money ─── */
{
  const accounts = new Map([
    ["5040", { postable: true, isMoney: false, name: "Repairs & Maintenance" }],
    ["5000", { postable: false, isMoney: false, name: "Expenses" }],
    ["1012", { postable: true, isMoney: true, name: "UBI -Main" }],
    ["1000", { postable: true, isMoney: true, name: "Cash in Hand" }],
  ]);
  const ok = checkVoucherDraft({ narration: "Electrician — hall wiring", partyName: "", lines: [{ accountCode: "5040", amountPaise: 1_800_00 }] }, accounts);
  assert.deepEqual(ok, { ok: true, totalPaise: 1_800_00, lines: [{ accountCode: "5040", amountPaise: 1_800_00 }] });
  assert.equal(checkVoucherDraft({ narration: "x x x", partyName: "", lines: [{ accountCode: "1012", amountPaise: 500 }] }, accounts).ok, false, "a bank on the debit side is a transfer");
  assert.equal(checkVoucherDraft({ narration: "x x x", partyName: "", lines: [{ accountCode: L_PAYOUTS_WALLET, amountPaise: 500 }] }, accounts).ok, false);
  assert.equal(checkVoucherDraft({ narration: "x x x", partyName: "", lines: [{ accountCode: "5000", amountPaise: 500 }] }, accounts).ok, false, "a heading is not postable");
  assert.equal(checkVoucherDraft({ narration: "x x x", partyName: "", lines: [{ accountCode: "9999", amountPaise: 500 }] }, accounts).ok, false);
  assert.equal(checkVoucherDraft({ narration: "", partyName: "", lines: [{ accountCode: "5040", amountPaise: 500 }] }, accounts).ok, false, "a narration is required");
  assert.equal(checkVoucherDraft({ narration: "x x x", partyName: "", lines: [] }, accounts).ok, false);

  const lines = voucherPaymentLines({
    draft: { narration: "Electrician", partyName: "Ramesh", lines: [{ accountCode: "5040", amountPaise: 1_200_00 }, { accountCode: "5041", amountPaise: 600_00, costCentreCode: "BUS1" }] },
    totalPaise: 1_800_00,
    ref: "123456789012",
    date: "2026-10-12",
    payeePhone: "9876501234",
  });
  assert.equal(sum(lines), 0, "the voucher balances");
  assert.equal(lines[2]!.accountCode, L_PAYOUTS_WALLET);
  assert.equal(lines[2]!.creditPaise, 1_800_00, "the wallet paid");
  assert.equal(lines[2]!.instrument?.mode, "cashfree");
  assert.equal(lines[1]!.costCentreCode, "BUS1", "the spend tag survives");
  assert.equal(lines[0]!.party?.name, "Ramesh");
}

console.log("payoutRequests.selftest.ts: all passed");
