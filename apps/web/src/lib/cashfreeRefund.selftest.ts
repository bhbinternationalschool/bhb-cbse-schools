/**
 * Self-test: the pure half of a Cashfree refund.
 * Run: npx tsx apps/web/src/lib/cashfreeRefund.selftest.ts
 *
 * A refund is the one money movement the school initiates that it cannot take
 * back, and it is asynchronous, so two mistakes are unrecoverable and both are
 * pinned here: refunding twice, and reopening a fee book on a refund that has
 * not actually happened.
 */
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { join } from "node:path";

import {
  buildCashfreeRefundBody,
  cashfreeRefundId,
  readCashfreeRefundEvent,
  refundIsDead,
  refundIsSettled,
  splitRefund,
} from "@/lib/cashfreeRefund";

console.log("cashfreeRefund.selftest.ts");

/* ── only SUCCESS means the parent has their money ────────────────────── */
{
  assert.equal(refundIsSettled("SUCCESS"), true);
  assert.equal(refundIsSettled("success"), true, "case is not a signal");
  assert.equal(refundIsSettled(" SUCCESS "), true);
  // Every one of these must be false. Treating any of them as done would
  // reopen the fee dues for money the parent has not received, and the office
  // would chase a family that already paid.
  for (const s of ["PENDING", "PENDING_APPROVAL", "ONHOLD", "FAILED", "CANCELLED", "", "OK", "DONE"]) {
    assert.equal(refundIsSettled(s), false, `${s || "(empty)"} must not count as refunded`);
  }

  // Dead is its own answer, so the desk can say "try again" instead of leaving
  // a row that looks like it is still on its way for ever.
  assert.equal(refundIsDead("FAILED"), true);
  assert.equal(refundIsDead("CANCELLED"), true);
  for (const s of ["PENDING", "PENDING_APPROVAL", "ONHOLD", "SUCCESS", ""]) {
    assert.equal(refundIsDead(s), false, `${s || "(empty)"} is not dead yet`);
  }
}

/* ── the id is deterministic, because that is what stops a double refund ── */
{
  const a = cashfreeRefundId("rcv_p1r2vnl2", 250000);
  const b = cashfreeRefundId("rcv_p1r2vnl2", 250000);
  assert.equal(a, b, "the same refund asked for twice must carry the same id");
  assert.match(a, /^[A-Za-z0-9_-]{3,40}$/, "and be a valid Cashfree refund id");

  // A DIFFERENT amount is a different refund — a second partial is allowed.
  assert.notEqual(cashfreeRefundId("rcv_p1r2vnl2", 100000), a);
  // A different receipt is a different refund.
  assert.notEqual(cashfreeRefundId("rcv_other", 250000), a);

  // Ids stay valid however ugly the voucher id, and never exceed 40 chars —
  // an over-long id is rejected by Cashfree and the refund silently never happens.
  for (const raw of ["rcv/with slashes", "rcv.dots.and.more", "x", "a".repeat(80), "«unicode»"]) {
    const id = cashfreeRefundId(raw, 1);
    assert.ok(id.length <= 40, `${raw}: ${id} is ${id.length} chars`);
    assert.match(id, /^[A-Za-z0-9_-]{3,40}$/, `${raw} produced an invalid id: ${id}`);
  }
}

/* ── the parent gets the payment charge back too ─────────────────────── */
{
  // Full refund: the whole charge comes back. The school is not entitled to
  // keep a payment charge on money it did not keep.
  const full = splitRefund({ feePaise: 250000, originalFeePaise: 250000, originalSurchargePaise: 4700 });
  assert.deepEqual(full, { feePaise: 250000, surchargePaise: 4700, totalPaise: 254700 });

  // Half the fee returns half the charge.
  const half = splitRefund({ feePaise: 125000, originalFeePaise: 250000, originalSurchargePaise: 4700 });
  assert.equal(half.feePaise, 125000);
  assert.equal(half.surchargePaise, 2350);
  assert.equal(half.totalPaise, 127350);

  // Never more charge than was collected, at any proportion.
  for (const fee of [1, 100, 99999, 249999, 250000]) {
    const s = splitRefund({ feePaise: fee, originalFeePaise: 250000, originalSurchargePaise: 4700 });
    assert.ok(s.surchargePaise <= 4700, `fee ${fee} returned ${s.surchargePaise} of a 4700 charge`);
    assert.equal(s.totalPaise, s.feePaise + s.surchargePaise);
  }

  // A refund larger than the fee is capped at the fee, not allowed to overflow
  // into inventing a charge that was never paid.
  const over = splitRefund({ feePaise: 900000, originalFeePaise: 250000, originalSurchargePaise: 4700 });
  assert.deepEqual(over, { feePaise: 250000, surchargePaise: 4700, totalPaise: 254700 });

  // No charge was passed on: nothing extra comes back.
  const noCharge = splitRefund({ feePaise: 250000, originalFeePaise: 250000, originalSurchargePaise: 0 });
  assert.deepEqual(noCharge, { feePaise: 250000, surchargePaise: 0, totalPaise: 250000 });

  // Degenerate inputs return nothing rather than NaN — a NaN would reach the
  // API as a refund amount.
  assert.deepEqual(splitRefund({ feePaise: 0, originalFeePaise: 250000, originalSurchargePaise: 4700 }), {
    feePaise: 0,
    surchargePaise: 0,
    totalPaise: 0,
  });
  assert.deepEqual(splitRefund({ feePaise: 5000, originalFeePaise: 0, originalSurchargePaise: 4700 }), {
    feePaise: 0,
    surchargePaise: 0,
    totalPaise: 0,
  });
  assert.deepEqual(splitRefund({ feePaise: -5000, originalFeePaise: 250000, originalSurchargePaise: -1 }), {
    feePaise: 0,
    surchargePaise: 0,
    totalPaise: 0,
  });
}

/* ── the request body, and the ceiling ───────────────────────────────── */
{
  const ok = buildCashfreeRefundBody({
    refundId: cashfreeRefundId("rcv_p1r2vnl2", 254700),
    amountPaise: 254700,
    note: "Transport withdrawn — Sep 2026",
    originalPaidPaise: 254700,
  });
  assert.ok(ok.ok, ok.ok ? "" : ok.error);
  if (!ok.ok) throw new Error("unreachable");
  assert.equal(ok.body.refund_amount, 2547, "rupees, to two places, not paise");
  assert.equal(ok.body.refund_speed, "STANDARD", "INSTANT costs more and is never chosen silently");
  assert.equal(ok.body.refund_note, "Transport withdrawn — Sep 2026");
  assert.equal(ok.body.refund_id, "rf_rcv_p1r2vnl2_254700");

  // Over the ceiling is refused HERE, with a sentence the desk can act on,
  // and without spending a request.
  const over = buildCashfreeRefundBody({
    refundId: "rf_x_1",
    amountPaise: 300000,
    note: "",
    originalPaidPaise: 254700,
  });
  assert.equal(over.ok, false);
  if (!over.ok) {
    assert.match(over.error, /2547\.00/, "the error names what the parent actually paid");
  }

  // Exactly at the ceiling is allowed — a full refund is the common case.
  assert.equal(
    buildCashfreeRefundBody({ refundId: "rf_x_1", amountPaise: 254700, note: "", originalPaidPaise: 254700 }).ok,
    true,
  );

  for (const bad of [0, 99, -1, Number.NaN]) {
    const r = buildCashfreeRefundBody({
      refundId: "rf_x_1",
      amountPaise: bad,
      note: "",
      originalPaidPaise: 254700,
    });
    assert.equal(r.ok, false, `${bad} must not be refundable`);
  }
  assert.equal(
    buildCashfreeRefundBody({ refundId: "not/valid", amountPaise: 5000, note: "", originalPaidPaise: 250000 }).ok,
    false,
    "an id Cashfree would reject is refused before the call",
  );
  // A long note is trimmed rather than rejected: losing the tail of a note is
  // not worth failing a refund over.
  const longNote = buildCashfreeRefundBody({
    refundId: "rf_x_1",
    amountPaise: 5000,
    note: "n".repeat(400),
    originalPaidPaise: 250000,
  });
  assert.ok(longNote.ok);
  if (longNote.ok) assert.equal(longNote.body.refund_note.length, 150);
}

/* ── reading the webhook, and the API reply, with one reader ──────────── */
{
  const hook = readCashfreeRefundEvent({
    type: "REFUND_STATUS_WEBHOOK",
    data: {
      refund: {
        refund_id: "rf_rcv_p1r2vnl2_254700",
        order_id: "fee_pl_gyi5n90y",
        cf_refund_id: 8812345,
        refund_status: "SUCCESS",
        refund_amount: 2547,
        refund_arn: "2026092812345678",
        processed_at: "2026-09-28T09:40:00+05:30",
      },
    },
  });
  assert.ok(hook, "the webhook must be readable");
  assert.equal(hook!.status, "SUCCESS");
  assert.equal(hook!.amountPaise, 254700, "rupees come back as paise, exactly");
  assert.equal(hook!.cfRefundId, "8812345", "a numeric id is stringified, never left as a float");
  assert.equal(hook!.orderId, "fee_pl_gyi5n90y");
  assert.equal(hook!.refundArn, "2026092812345678");

  // The same reader handles the create/read API reply, which is unwrapped.
  const reply = readCashfreeRefundEvent({
    refund_id: "rf_a_100",
    order_id: "ord_1",
    refund_status: "PENDING",
    refund_amount: 1,
  });
  assert.ok(reply);
  assert.equal(reply!.status, "PENDING");
  assert.equal(reply!.amountPaise, 100);

  // Lowercase from the API is normalised, so refundIsSettled never misses one.
  const lower = readCashfreeRefundEvent({ refund_id: "rf_a_100", refund_status: "success" });
  assert.ok(lower && refundIsSettled(lower.status));

  // Anything that is not a refund is null, so the webhook route falls through
  // to its other handlers instead of acting on a misread.
  for (const other of [
    {},
    { type: "PAYMENT_SUCCESS_WEBHOOK", data: { order: { order_id: "x" }, payment: {} } },
    { type: "SETTLEMENT_SUCCESS", data: { settlement: { utr: "1" } } },
  ]) {
    assert.equal(readCashfreeRefundEvent(other), null, `${JSON.stringify(other)} is not a refund`);
  }
}

/* ── the wiring: the fee book reopens only on SUCCESS ────────────────── */
{
  const src = readFileSync(
    join(
      process.cwd(),
      process.cwd().endsWith("apps/web") ? "src/lib" : "apps/web/src/lib",
      "cashfreeRefunds.server.ts",
    ),
    "utf8",
  );
  // THE assertion of this tranche. Voiding on anything but SUCCESS reopens
  // dues for money the parent never got back, and the office chases a family
  // that already paid.
  //
  // Scoped to applyRefundOutcome, not the whole file: the header comment names
  // voidVoucher to explain why no extra journal is posted, and comparing
  // positions across the whole source measures the prose rather than the code.
  const applyFn = src.slice(src.indexOf("export async function applyRefundOutcome"));
  assert.ok(applyFn.length > 0, "applyRefundOutcome must exist");
  const guardAt = applyFn.indexOf("if (!refundIsSettled(");
  const voidAt = applyFn.indexOf("voidVoucher(voucherId)");
  assert.ok(guardAt >= 0, "the SUCCESS guard is in applyRefundOutcome");
  assert.ok(voidAt >= 0, "and so is the void it guards");
  assert.ok(guardAt < voidAt, "the status is checked BEFORE anything is voided");
  // And the guard must return, not merely warn.
  assert.match(
    applyFn.slice(guardAt, voidAt),
    /return \{ applied: false/,
    "a refund that has not succeeded stops there",
  );
  // A refund must survive being delivered twice: Cashfree redelivers webhooks.
  assert.match(
    src,
    /already|voidedAt|idempot/i,
    "a redelivered refund webhook must not act twice",
  );
}

console.log("  ok");
