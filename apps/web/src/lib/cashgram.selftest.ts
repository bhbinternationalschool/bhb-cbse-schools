/**
 * Self-test: fee refunds by Cashgram, the pure half.
 * Run: npx tsx apps/web/src/lib/cashgram.selftest.ts
 *
 * The mistakes that cannot be walked back: a receipt voided for money the
 * parent never got, the same excess refunded twice, rupees sent as paise, a
 * link to a placeholder phone, and a journal that leaves the cash book wrong.
 */
import assert from "node:assert/strict";
import { createHmac } from "node:crypto";

import {
  buildCashgramBody,
  cashgramCommitsWallet,
  cashgramExpiryDate,
  cashgramIsDead,
  cashgramIsPaid,
  cashgramNeedsApproval,
  cashgramPhoneProblem,
  cashgramRefundLines,
  excessRefundableNow,
  newCashgramId,
  CASHGRAM_ID_RE,
  readApprovalRule,
  readCashgramCreate,
  readCashgramStatus,
  readCashgramStatusResponse,
  readCashgramWebhook,
  voidRefundProblem,
  type CashgramStatus,
} from "@/lib/cashgram";
import { L_BANK, L_CASH, L_FEE_INCOME, L_PAYOUTS_WALLET } from "@/lib/ledger/coa";
import { verifyPayoutWebhookV1 } from "@/lib/payoutsSignature";

console.log("cashgram.selftest.ts");

/* ── only REDEEMED is money ───────────────────────────────────────────── */
{
  assert.equal(readCashgramStatus("REDEEMED"), "REDEEMED");
  assert.equal(readCashgramStatus("CASHGRAM_REDEEMED"), "REDEEMED");
  assert.equal(cashgramIsPaid("REDEEMED"), true);
  for (const s of [
    "PENDING_APPROVAL", "SENDING", "UNKNOWN", "ACTIVE", "REDEEMING", "EXPIRED",
    "DEACTIVATED", "FAILED", "REVERSED", "REJECTED", "CREATE_FAILED",
  ] as CashgramStatus[]) {
    assert.equal(cashgramIsPaid(s), false, `${s} must not void a receipt`);
  }
  // Cashfree's "Pending" is a redemption in flight — the bank may still refuse.
  assert.equal(readCashgramStatus("PENDING"), "REDEEMING");
  assert.equal(cashgramIsPaid(readCashgramStatus("PENDING")), false);
  for (const odd of ["PAID", "SUCCESS", "COMPLETED", "", "redeemed!", null, undefined]) {
    assert.equal(readCashgramStatus(odd), "UNKNOWN", `${String(odd)} must not become REDEEMED`);
  }
  assert.equal(readCashgramStatus(" redeemed "), "REDEEMED", "case and spaces are not signals");
  assert.equal(readCashgramStatus("CASHGRAM_TRANSFER_REVERSAL"), "REVERSED");
}

/* ── what holds an amount, what holds the wallet ──────────────────────── */
{
  // Dead = the amount is refundable again. REVERSED: the bank sent it back.
  for (const s of ["REJECTED", "CREATE_FAILED", "EXPIRED", "DEACTIVATED", "FAILED", "REVERSED"] as CashgramStatus[]) {
    assert.equal(cashgramIsDead(s), true, s);
    assert.equal(cashgramCommitsWallet(s), false, s);
  }
  // UNKNOWN is NOT dead: Cashfree may have it, and a second link pays twice.
  for (const s of ["PENDING_APPROVAL", "SENDING", "UNKNOWN", "ACTIVE", "REDEEMING", "REDEEMED"] as CashgramStatus[]) {
    assert.equal(cashgramIsDead(s), false, `${s} still holds its amount`);
  }
  for (const s of ["SENDING", "UNKNOWN", "ACTIVE", "REDEEMING"] as CashgramStatus[]) {
    assert.equal(cashgramCommitsWallet(s), true, `${s} may still draw on the wallet`);
  }
  // Already paid is out of the wallet; waiting for approval has not gone out.
  assert.equal(cashgramCommitsWallet("REDEEMED"), false);
  assert.equal(cashgramCommitsWallet("PENDING_APPROVAL"), false);
}

/* ── the same excess cannot go out twice ─────────────────────────────── */
{
  assert.equal(excessRefundableNow(5000_00, []), 5000_00);
  const rows = [
    { amountPaise: 2000_00, status: "PENDING_APPROVAL" as const, feeEffect: "excess" as const },
    { amountPaise: 1000_00, status: "UNKNOWN" as const, feeEffect: "excess" as const },
    { amountPaise: 999_00, status: "EXPIRED" as const, feeEffect: "excess" as const },
    // A receipt cancellation does not draw on the excess.
    { amountPaise: 700_00, status: "ACTIVE" as const, feeEffect: "void" as const },
  ];
  assert.equal(excessRefundableNow(5000_00, rows), 2000_00, "pending and unknown hold; expired frees");
  // A REDEEMED excess refund stays counted. The fee book is not changed by an
  // excess refund, so the dues still show the excess — only this row stops a
  // second refund of the same money.
  assert.equal(
    excessRefundableNow(3000_00, [{ amountPaise: 3000_00, status: "REDEEMED", feeEffect: "excess" }]),
    0,
  );
  assert.equal(excessRefundableNow(100_00, [{ amountPaise: 500_00, status: "ACTIVE", feeEffect: "excess" }]), 0, "never negative");
}

/* ── which receipts may be cancelled by link ─────────────────────────── */
{
  const cash = [{ mode: "cash", realisation: "cleared" }];
  assert.equal(voidRefundProblem({ voidedAt: null, tenders: cash, rowsForVoucher: [] }), "");
  assert.match(voidRefundProblem({ voidedAt: "2026-10-01", tenders: cash, rowsForVoucher: [] }), /already voided/);
  assert.match(
    voidRefundProblem({ voidedAt: null, tenders: [{ mode: "upi", gatewayProvider: "cashfree" }], rowsForVoucher: [] }),
    /Online refund/,
    "gateway money goes back the way it came",
  );
  assert.match(
    voidRefundProblem({ voidedAt: null, tenders: [{ mode: "cheque", realisation: "subject_to_clearance" }], rowsForVoucher: [] }),
    /not cleared/,
  );
  assert.match(
    voidRefundProblem({ voidedAt: null, tenders: cash, rowsForVoucher: [{ amountPaise: 1, status: "UNKNOWN", feeEffect: "void" }] }),
    /already open/,
  );
  assert.equal(
    voidRefundProblem({ voidedAt: null, tenders: cash, rowsForVoucher: [{ amountPaise: 1, status: "EXPIRED", feeEffect: "void" }] }),
    "",
    "an expired link does not block a new one",
  );
}

/* ── approval rule ───────────────────────────────────────────────────── */
{
  assert.equal(cashgramNeedsApproval("owner", 0, 100), true);
  assert.equal(cashgramNeedsApproval("none", 0, 10_00_000_00), false);
  assert.equal(cashgramNeedsApproval("above", 5000_00, 5000_00), false, "at the limit goes straight out");
  assert.equal(cashgramNeedsApproval("above", 5000_00, 5000_01), true);
  assert.equal(readApprovalRule("garbage"), "owner", "unreadable rule asks the owner");
  assert.equal(readApprovalRule(null), "owner");
  assert.equal(readApprovalRule("NONE"), "none");
}

/* ── phones: only this phone can collect ─────────────────────────────── */
{
  assert.equal(cashgramPhoneProblem("9876501234"), "");
  assert.equal(cashgramPhoneProblem("+91 98765 01234"), "");
  for (const bad of ["0000000000", "9999999999", "1234567890", "9876543210", "5876501234", "98765", ""]) {
    assert.notEqual(cashgramPhoneProblem(bad), "", `${bad || "(empty)"} must be refused`);
  }
}

/* ── the request: rupees, not paise ──────────────────────────────────── */
{
  const id = newCashgramId(1760000000000, () => 0.5);
  assert.match(id, CASHGRAM_ID_RE);
  assert.notEqual(newCashgramId(), newCashgramId(), "never reused");

  const b = buildCashgramBody({
    cashgramId: id,
    amountPaise: 1250_50,
    name: "Ram Kumar (Father) #2",
    phone: "+91-98765-01234",
    email: "not an email",
    expiryDate: "2026-10-17",
    remarks: "Refund R-00123/26",
  });
  assert.ok(b.ok);
  if (b.ok) {
    assert.equal(b.body.amount, 1250.5, "rupees — paise here refunds a hundred times over");
    assert.equal(b.body.phone, "9876501234");
    assert.equal(b.body.linkExpiry, "2026/10/17");
    assert.equal(b.body.name, "Ram Kumar Father");
    assert.equal("email" in b.body, false, "a bad email is left out, not sent");
    assert.equal(b.body.remarks, "Refund R 00123 26");
    assert.equal(b.body.notifyCustomer, 1);
  }
  assert.equal(buildCashgramBody({ cashgramId: id, amountPaise: 99, name: "Ram", phone: "9876501234", expiryDate: "2026-10-17", remarks: "" }).ok, false);
  assert.equal(buildCashgramBody({ cashgramId: id, amountPaise: 500, name: "Ram", phone: "0000000000", expiryDate: "2026-10-17", remarks: "" }).ok, false);
  assert.equal(buildCashgramBody({ cashgramId: "bad id!", amountPaise: 500, name: "Ram", phone: "9876501234", expiryDate: "2026-10-17", remarks: "" }).ok, false);

  assert.equal(cashgramExpiryDate("2026-10-10", 7), "2026-10-17");
  assert.equal(cashgramExpiryDate("2026-10-10", 90), "2026-11-09", "capped at 30 days");
  assert.equal(cashgramExpiryDate("2026-10-10", 1), "2026-10-11");
  assert.equal(cashgramExpiryDate("2026-10-10", 0), "2026-10-17", "blank or zero is the 7-day default");
  assert.equal(cashgramExpiryDate("2026-10-10", -5), "2026-10-11", "never in the past");
}

/* ── reading Cashfree ────────────────────────────────────────────────── */
{
  const ok = readCashgramCreate({ status: "SUCCESS", subCode: "200", data: { referenceId: 123, cashgramLink: "https://cfre.in/x" } });
  assert.deepEqual(ok, { ok: true, referenceId: "123", link: "https://cfre.in/x" });
  // V1 refuses with HTTP 200 and status ERROR.
  assert.equal(readCashgramCreate({ status: "ERROR", subCode: "409", message: "Cashgram with id exists" }).ok, false);

  const v = readCashgramStatusResponse("cgr1", { status: "SUCCESS", subCode: "200", data: { cashgramStatus: "REDEEMED", referenceId: "9" } });
  assert.equal(v?.status, "REDEEMED");
  assert.equal(readCashgramStatusResponse("cgr1", { status: "ERROR", message: "Token is not valid" }), null, "an error is not a status");
  assert.equal(readCashgramStatusResponse("cgr1", { status: "SUCCESS", data: {} }), null, "no status word is not a status");

  const hook = readCashgramWebhook({ event: "CASHGRAM_REDEEMED", cashgramid: "cgrabc123", referenceId: "77", eventTime: "x" });
  assert.equal(hook?.cashgramId, "cgrabc123");
  assert.equal(hook?.status, "REDEEMED");
  assert.equal(readCashgramWebhook({ event: "CASHGRAM_EXPIRED", cashgramId: "cgrabc123" })?.status, "EXPIRED");
  assert.equal(readCashgramWebhook({ event: "TRANSFER_SUCCESS", transferId: "t1" }), null, "transfers are not cashgrams");
  assert.equal(readCashgramWebhook({ event: "CASHGRAM_REDEEMED" }), null, "no id, nothing to apply");

  // The V1 webhook signature the route verifies covers Cashgram events too.
  const secret = "s3cret";
  const fields: Record<string, string> = { event: "CASHGRAM_REDEEMED", cashgramid: "cgrabc123", referenceId: "77", eventTime: "2026-10-10 12:00:00" };
  const joined = Object.keys(fields).sort().map((k) => fields[k]).join("");
  const signature = createHmac("sha256", secret).update(joined).digest("base64");
  assert.equal(verifyPayoutWebhookV1({ ...fields, signature }, secret), true);
  assert.equal(verifyPayoutWebhookV1({ ...fields, event: "CASHGRAM_EXPIRED", signature }, secret), false, "a changed event fails");
}

/* ── the journal ─────────────────────────────────────────────────────── */
{
  const sum = (lines: { debitPaise: number; creditPaise: number }[]) =>
    lines.reduce((n, l) => n + l.debitPaise - l.creditPaise, 0);

  const ex = cashgramRefundLines({ feeEffect: "excess", amountPaise: 800_00, householdId: "hh1", narration: "n" });
  assert.ok(ex.ok);
  if (ex.ok) {
    assert.equal(sum(ex.lines), 0, "balances");
    assert.deepEqual(ex.lines.map((l) => [l.accountCode, l.debitPaise, l.creditPaise]), [
      [L_FEE_INCOME, 800_00, 0],
      [L_PAYOUTS_WALLET, 0, 800_00],
    ]);
  }

  // Void: put back what the void took from cash / bank, take it from the wallet.
  const vd = cashgramRefundLines({
    feeEffect: "void",
    amountPaise: 1500_00,
    householdId: "hh1",
    narration: "n",
    tenders: [
      { mode: "cash", amountPaise: 1000_00 },
      { mode: "upi", amountPaise: 500_00, bankAccountId: "bnk_1" },
    ],
  });
  assert.ok(vd.ok);
  if (vd.ok) {
    assert.equal(sum(vd.lines), 0, "balances");
    assert.deepEqual(vd.lines.map((l) => [l.accountCode, l.debitPaise, l.creditPaise]), [
      [L_CASH, 1000_00, 0],
      [L_BANK, 500_00, 0],
      [L_PAYOUTS_WALLET, 0, 1500_00],
    ]);
    assert.equal(vd.lines[1]!.subledgerId, "bnk_1", "the bank it was received into");
    assert.equal(vd.lines[0]!.subledgerId, undefined, "no guessed cash pool");
  }
  // Tenders that disagree with the refund are refused, not balanced off.
  assert.equal(
    cashgramRefundLines({ feeEffect: "void", amountPaise: 1500_00, householdId: "", narration: "n", tenders: [{ mode: "cash", amountPaise: 1000_00 }] }).ok,
    false,
  );
  assert.equal(cashgramRefundLines({ feeEffect: "excess", amountPaise: 0, householdId: "", narration: "n" }).ok, false);
}

console.log("cashgram.selftest.ts: all passed");
